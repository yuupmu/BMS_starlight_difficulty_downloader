'use strict';

const { CONFIG } = require('./config');
const { extractRateInfo, isRateLimitError, parseRetryAfter } = require('./api');
const { sleep, fileKey, formatLocalDate } = require('./utils');

const TRANSIENT_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

function isTransientDownloadError(error) {
  if (isRateLimitError(error)) return false;
  if (error?.name === 'AbortError') return false;
  return !Number.isFinite(Number(error?.status)) || TRANSIENT_STATUSES.has(Number(error.status));
}

function retryDelayMs(error, attempt, config = CONFIG, random = Math.random) {
  if (Number.isFinite(Number(error?.retryAfterMs))) {
    return Math.min(config.downloadRetryMaxMs, Math.max(0, Number(error.retryAfterMs)));
  }
  const exponential = Math.min(
    config.downloadRetryMaxMs,
    config.downloadRetryBaseMs * (2 ** Math.max(0, attempt - 1))
  );
  return Math.round(exponential * (0.75 + random() * 0.5));
}

function byteLength(value) {
  if (value === undefined || value === null) return 0;
  if (Number.isFinite(Number(value.byteLength))) return Number(value.byteLength);
  if (Number.isFinite(Number(value.size))) return Number(value.size);
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
  return 0;
}

function looksLikeErrorDocument(value) {
  let bytes;
  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else if (typeof value === 'string') bytes = new TextEncoder().encode(value);
  else return false;
  const text = new TextDecoder().decode(bytes.slice(0, 1024)).replace(/^\uFEFF/, '').trimStart().toLowerCase();
  return text.startsWith('<!doctype html')
    || text.startsWith('<html')
    || text.startsWith('<head')
    || text.startsWith('<body')
    || /^\{\s*"(?:error|message)"\s*:/.test(text);
}

function createQueueManager(options) {
  const {
    state,
    storage,
    history,
    api,
    translator,
    savePrefs,
    onChange = () => {},
    config = CONFIG
  } = options;
  const sleepFn = options.sleepFn || sleep;
  const randomFn = options.randomFn || Math.random;

  function notify(reason) {
    onChange(reason);
  }

  function saveQueue() {
    storage.saveQueue(state.downloadQueue);
  }

  function setMessage(message) {
    state.queueMessage = message;
    notify('queue-message');
  }

  function formatTime(value) {
    return formatLocalDate(value, translator.locale(), translator.t('time.unknown'));
  }

  function applyRateInfo(payload, forceBlock = false) {
    const info = extractRateInfo(payload);
    if (!info) return null;
    state.rateInfo = info;
    const resetMs = info.windowResetsAt ? Date.parse(info.windowResetsAt) : NaN;
    if ((forceBlock || info.remainingInWindow === 0) && Number.isFinite(resetMs) && resetMs > Date.now()) {
      state.blockedUntil = resetMs;
    }
    savePrefs();
    notify('rate-info');
    return info;
  }

  function expireBlockIfNeeded() {
    if (!(state.blockedUntil > 0 && state.blockedUntil <= Date.now())) return false;
    state.blockedUntil = 0;
    if (state.rateInfo?.remainingInWindow === 0) {
      state.rateInfo = { ...state.rateInfo, remainingInWindow: null };
    }
    savePrefs();
    if (state.downloadQueue.length) state.queueMessage = translator.t('queue.limitExpired');
    notify('rate-expired');
    return true;
  }

  function pruneCompleted() {
    const before = state.downloadQueue.length;
    state.downloadQueue = state.downloadQueue.filter((item) => !history.has(item.type, item.id, item.providerId));
    const removed = before - state.downloadQueue.length;
    if (removed > 0) saveQueue();
    return removed;
  }

  function enqueue(items, enqueueOptions = {}) {
    const allowCompleted = Boolean(enqueueOptions.allowCompleted);
    const existing = new Set(state.downloadQueue.map((item) => fileKey(item.type, item.id, item.providerId)));
    let added = 0;
    let alreadyRequested = 0;
    let alreadyQueued = 0;

    for (const rawItem of items || []) {
      if (!rawItem?.id || (rawItem.type !== 'song' && rawItem.type !== 'sabun')) continue;
      const providerId = String(rawItem.providerId || config.defaultProviderId);
      const key = fileKey(rawItem.type, rawItem.id, providerId);
      if (history.has(rawItem.type, rawItem.id, providerId)) {
        if (allowCompleted) history.remove(rawItem.type, rawItem.id, providerId);
        else {
          alreadyRequested += 1;
          continue;
        }
      }
      if (existing.has(key)) {
        alreadyQueued += 1;
        continue;
      }
      existing.add(key);
      state.downloadQueue.push({
        providerId,
        type: rawItem.type,
        id: String(rawItem.id),
        title: String(rawItem.title || rawItem.id),
        sourceName: String(rawItem.sourceName || ''),
        level: String(rawItem.level ?? state.selectedLevel ?? ''),
        levelLabel: String(rawItem.levelLabel || `${state.selectedTable?.symbol || 'sr'}${rawItem.level ?? state.selectedLevel ?? ''}`),
        levelSymbol: String(rawItem.levelSymbol || state.selectedTable?.symbol || 'sr'),
        tableId: String(rawItem.tableId || state.selectedTableId || 'starlight'),
        tableName: String(rawItem.tableName || state.selectedTable?.name || 'Starlight'),
        sha256: String(rawItem.sha256 || ''),
        md5: String(rawItem.md5 || ''),
        addedAt: new Date().toISOString(),
        attempts: 0,
        lastAttemptAt: null,
        lastError: '',
        deliveryStatus: '',
        lastGrantedAt: null,
        lastGrantedFileName: ''
      });
      added += 1;
    }

    saveQueue();
    if (added > 0 && (alreadyRequested > 0 || alreadyQueued > 0)) {
      state.queueMessage = translator.t('queue.addedWithSkips', {
        added,
        requested: alreadyRequested,
        queued: alreadyQueued
      });
    } else if (added > 0) {
      state.queueMessage = translator.t('queue.added', { added });
    } else {
      state.queueMessage = translator.t('queue.nothingAdded');
    }
    notify('enqueue');
    return { added, alreadyRequested, alreadyQueued };
  }

  function clear() {
    state.downloadQueue = [];
    state.browserPendingDownload = null;
    state.reusableGrant = null;
    storage.clearQueue();
    state.queueMessage = translator.t('queue.cleared');
    notify('clear-queue');
  }

  function triggerBrowserDownload(downloadUrl) {
    const absolute = new URL(downloadUrl, config.downloadBaseUrl).toString();
    // Keep error/limit pages out of the current tab. A response without an
    // attachment header is rendered inside this hidden frame instead.
    const frame = document.createElement('iframe');
    frame.name = `sld-download-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    frame.style.display = 'none';
    document.body.appendChild(frame);
    const link = document.createElement('a');
    link.href = absolute;
    link.target = frame.name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    const cleanupTimer = setTimeout(() => frame.remove(), config.hiddenFrameCleanupMs);
    cleanupTimer?.unref?.();
  }

  function safeFileName(value, fallback) {
    const cleaned = String(value || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim();
    return cleaned || fallback;
  }

  function fileNameFromResponse(response, payload, item) {
    const disposition = response.headers?.get?.('content-disposition') || '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const basic = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    let headerName = basic || '';
    if (encoded) {
      try { headerName = decodeURIComponent(encoded); } catch { headerName = encoded; }
    }
    let urlName = '';
    try { urlName = decodeURIComponent(new URL(response.url || payload.downloadUrl, config.downloadBaseUrl).pathname.split('/').pop() || ''); } catch {}
    return safeFileName(
      headerName || payload.fileName || payload.filename || urlName,
      `${item.type}-${item.id}.zip`
    );
  }

  async function unusedFileHandle(directory, fileName) {
    const dot = fileName.lastIndexOf('.');
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const extension = dot > 0 ? fileName.slice(dot) : '';
    for (let suffix = 0; suffix < 10000; suffix += 1) {
      const candidate = suffix ? `${stem} (${suffix})${extension}` : fileName;
      try {
        await directory.getFileHandle(candidate, { create: false });
      } catch (error) {
        if (error?.name === 'NotFoundError') {
          return {
            fileName: candidate,
            fileHandle: await directory.getFileHandle(candidate, { create: true })
          };
        }
        throw error;
      }
    }
    throw new Error('Could not create a unique filename in the selected folder.');
  }

  async function responseError(response) {
    let payload = {};
    try {
      const readable = typeof response.clone === 'function' ? response.clone() : response;
      if (typeof readable.json === 'function') payload = await readable.json();
    } catch {}
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `File download failed: ${response.status} ${response.statusText || ''}`.trim();
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload && typeof payload === 'object' ? payload : {};
    error.retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
    if (error.status === 429 && error.retryAfterMs !== null && !error.payload.windowResetsAt) {
      error.payload.remainingInWindow = 0;
      error.payload.windowResetsAt = new Date(Date.now() + error.retryAfterMs).toISOString();
    }
    return error;
  }

  function validateDownloadStart(value, contentType) {
    if (!byteLength(value)) throw new Error('The download server returned an empty file.');
    if (/^(?:text\/html|application\/json)\b/i.test(contentType) || looksLikeErrorDocument(value)) {
      throw new Error(`The download server returned ${contentType || 'an error document'} instead of a BMS file.`);
    }
  }

  async function saveToSelectedDirectory(directory, payload, item) {
    const absolute = new URL(payload.downloadUrl, config.downloadBaseUrl).toString();
    const fetchFn = options.fetchFn || globalThis.fetch?.bind(globalThis);
    if (!fetchFn) throw new Error('This browser cannot save directly to a selected folder.');
    const response = await fetchFn(absolute, { credentials: 'include' });
    if (!response.ok) throw await responseError(response);
    const contentType = response.headers?.get?.('content-type') || '';
    const contentEncoding = response.headers?.get?.('content-encoding') || '';
    const declaredLengthHeader = response.headers?.get?.('content-length');
    const declaredLength = declaredLengthHeader === null || declaredLengthHeader === undefined || declaredLengthHeader === ''
      ? null
      : Number(declaredLengthHeader);
    if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength <= 0) {
      throw new Error('The download server returned an empty file.');
    }

    let firstChunk = null;
    let reader = null;
    let blob = null;
    if (response.body?.getReader) {
      reader = response.body.getReader();
      while (!firstChunk) {
        const part = await reader.read();
        if (part.done) break;
        if (byteLength(part.value)) firstChunk = part.value;
      }
      validateDownloadStart(firstChunk, contentType);
    } else {
      blob = await response.blob();
      const prefix = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
      validateDownloadStart(prefix, contentType);
    }

    const target = await unusedFileHandle(directory, fileNameFromResponse(response, payload, item));
    let writable = null;
    let written = 0;
    try {
      writable = await target.fileHandle.createWritable();
      if (reader) {
        await writable.write(firstChunk);
        written += byteLength(firstChunk);
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          if (!byteLength(part.value)) continue;
          await writable.write(part.value);
          written += byteLength(part.value);
        }
      } else {
        await writable.write(blob);
        written = byteLength(blob);
      }
      if (declaredLength !== null && Number.isFinite(declaredLength) && !contentEncoding && written !== declaredLength) {
        throw new Error(`The download ended early (${written}/${declaredLength} bytes).`);
      }
      await writable.close();
    } catch (error) {
      await writable?.abort?.().catch?.(() => {});
      await directory.removeEntry?.(target.fileName).catch?.(() => {});
      throw error;
    }
    return { mode: 'folder', fileName: target.fileName, bytesWritten: written };
  }

  async function deliverDownload(payload, item) {
    if (state.downloadDirectoryHandle) {
      return saveToSelectedDirectory(state.downloadDirectoryHandle, payload, item);
    }
    triggerBrowserDownload(payload.downloadUrl);
    return { mode: 'browser' };
  }

  function itemKey(item) {
    return fileKey(item.type, item.id, item.providerId);
  }

  function pendingBrowserItem() {
    const item = state.downloadQueue[0];
    return item?.deliveryStatus === 'browser-pending' ? item : null;
  }

  function matchingGrant(holder, item) {
    return holder?.key === itemKey(item) && holder.payload?.downloadUrl ? holder : null;
  }

  async function process(maxItems = state.batchSize) {
    if (state.downloadRunning || !state.downloadQueue.length) return { completed: 0, skipped: 0 };
    const awaitingConfirmation = pendingBrowserItem();
    if (awaitingConfirmation) {
      setMessage(translator.t('queue.browserConfirmationRequired', {
        levelLabel: awaitingConfirmation.levelLabel || `sr${awaitingConfirmation.level}`,
        title: awaitingConfirmation.title
      }));
      return { completed: 0, skipped: 0, awaitingConfirmation: 1 };
    }

    expireBlockIfNeeded();
    const firstItem = state.downloadQueue[0];
    const reusableAtStart = matchingGrant(state.reusableGrant, firstItem);
    if (state.blockedUntil > Date.now() && !reusableAtStart) {
      setMessage(translator.t('queue.limitBlocked', { time: formatTime(state.blockedUntil) }));
      return { completed: 0, skipped: 0 };
    }

    const initiallyPruned = pruneCompleted();
    if (!state.downloadQueue.length) {
      state.queueMessage = initiallyPruned
        ? translator.t('queue.skippedCompleted', { count: initiallyPruned })
        : translator.t('queue.empty');
      notify('queue-empty-after-prune');
      return { completed: 0, skipped: initiallyPruned };
    }

    state.downloadRunning = true;
    state.downloadStopRequested = false;
    state.queueMessage = translator.t('queue.downloadStarting');
    notify('download-start');

    let completed = 0;
    let skipped = initiallyPruned;
    let finalReason = '';
    const safeMode = maxItems === config.safeBatchValue;
    const requestedTarget = state.downloadDirectoryHandle
      ? safeMode
        ? state.downloadQueue.length
        : Math.max(1, Number(maxItems) || config.defaultBatchSize)
      : 1;
    const knownWindowRemaining = Number(state.rateInfo?.remainingInWindow);
    const target = Number.isFinite(knownWindowRemaining) && knownWindowRemaining > 0
      ? Math.min(requestedTarget, knownWindowRemaining)
      : requestedTarget;

    try {
      while (state.downloadQueue.length && completed < target && !state.downloadStopRequested) {
        const item = state.downloadQueue[0];
        if (history.has(item.type, item.id, item.providerId)) {
          state.downloadQueue.shift();
          skipped += 1;
          saveQueue();
          notify('skip-history-duplicate');
          continue;
        }

        let attemptsThisRun = 0;
        let itemComplete = false;
        let payload = matchingGrant(state.reusableGrant, item)?.payload || null;
        if (payload) state.reusableGrant = null;
        while (!itemComplete && !state.downloadStopRequested) {
          attemptsThisRun += 1;
          state.queueMessage = translator.t('queue.processingItem', {
            current: completed + 1,
            target,
            levelLabel: item.levelLabel || `sr${item.level}`,
            title: item.title
          });
          item.attempts = Number(item.attempts || 0) + 1;
          item.lastAttemptAt = new Date().toISOString();
          item.lastError = '';
          saveQueue();
          notify('download-item-start');

          try {
            if (!payload) {
              payload = await api.grant(item);
              applyRateInfo(payload, false);
            }
            const delivery = await deliverDownload(payload, item);

            if (delivery.mode === 'browser') {
              item.deliveryStatus = 'browser-pending';
              item.lastGrantedAt = new Date().toISOString();
              item.lastGrantedFileName = String(payload.fileName || payload.filename || payload.name || '');
              state.browserPendingDownload = { key: itemKey(item), payload };
              state.queueMessage = translator.t('queue.browserAwaitingConfirmation', {
                levelLabel: item.levelLabel || `sr${item.level}`,
                title: item.title
              });
              saveQueue();
              itemComplete = true;
              finalReason = 'browser-confirmation';
              notify('browser-download-pending');
              break;
            }

            // Record first, then remove from the queue. If execution is interrupted between
            // these two writes, the next run prunes the remaining queue item by history key.
            history.markRequested(item, {
              ...payload,
              fileName: delivery.fileName || payload.fileName,
              status: 'saved'
            });
            state.downloadQueue.shift();
            saveQueue();
            completed += 1;
            itemComplete = true;
            notify('download-item-requested');

            if (state.blockedUntil > Date.now()) {
              state.queueMessage = translator.t('queue.windowUsed', { time: formatTime(state.blockedUntil) });
              finalReason = 'rate-limit';
            }
          } catch (error) {
            item.lastError = error?.message || String(error);
            saveQueue();

            if (isRateLimitError(error)) {
              const info = applyRateInfo(error.payload, true);
              const resetText = state.blockedUntil > Date.now()
                ? formatTime(state.blockedUntil)
                : translator.t('rate.nextReset');
              const todaySuffix = info?.remainingToday === null || info?.remainingToday === undefined
                ? ''
                : translator.t('queue.limitTodaySuffix', { count: info.remainingToday });
              state.queueMessage = translator.t('queue.limitReached', { time: resetText, today: todaySuffix });
              notify('rate-limit');
              finalReason = 'rate-limit';
              break;
            }

            const transient = isTransientDownloadError(error);
            if (transient && attemptsThisRun < config.downloadRetryMaxAttempts) {
              const delay = retryDelayMs(error, attemptsThisRun, config, randomFn);
              state.queueMessage = translator.t('queue.retrying', {
                attempt: attemptsThisRun + 1,
                max: config.downloadRetryMaxAttempts,
                seconds: Math.ceil(delay / 1000),
                error: item.lastError
              });
              notify('download-retry');
              await sleepFn(delay);
              continue;
            }

            if (transient && payload?.downloadUrl) {
              state.reusableGrant = { key: itemKey(item), payload };
            }

            state.queueMessage = translator.t('queue.currentFailure', { error: item.lastError });
            notify('download-error');
            finalReason = 'error';
            break;
          }
        }

        if (finalReason) break;
        if (state.downloadQueue.length && completed < target && !state.downloadStopRequested) {
          await sleepFn(config.downloadDelayMs);
        }
      }
    } finally {
      state.downloadRunning = false;
      if (state.downloadStopRequested) {
        state.queueMessage = translator.t('queue.stopped', { remaining: state.downloadQueue.length });
      } else if (!finalReason && completed > 0) {
        state.queueMessage = state.downloadQueue.length
          ? translator.t('queue.batchComplete', { completed, remaining: state.downloadQueue.length })
          : translator.t('queue.allComplete', { completed });
      } else if (!finalReason && completed === 0 && skipped > 0 && !state.downloadQueue.length) {
        state.queueMessage = translator.t('queue.skippedCompleted', { count: skipped });
      }
      saveQueue();
      notify('download-finished');
    }
    return { completed, skipped };
  }

  function confirmBrowserDownload() {
    if (state.downloadRunning) return false;
    const item = pendingBrowserItem();
    if (!item) return false;
    const cached = matchingGrant(state.browserPendingDownload, item);
    history.markRequested(item, {
      ...(cached?.payload || {}),
      fileName: item.lastGrantedFileName || cached?.payload?.fileName || cached?.payload?.filename || '',
      status: 'browser-confirmed'
    });
    state.downloadQueue.shift();
    state.browserPendingDownload = null;
    state.reusableGrant = null;
    state.queueMessage = translator.t('queue.browserConfirmed', {
      levelLabel: item.levelLabel || `sr${item.level}`,
      title: item.title
    });
    saveQueue();
    notify('download-item-requested');
    return true;
  }

  async function retryPendingBrowserDownload() {
    if (state.downloadRunning) return false;
    const item = pendingBrowserItem();
    const cached = item && matchingGrant(state.browserPendingDownload, item);
    if (!item || !cached) return false;
    item.deliveryStatus = '';
    item.lastError = '';
    state.browserPendingDownload = null;
    state.reusableGrant = cached;
    state.queueMessage = translator.t('queue.browserRetryingSameLink');
    saveQueue();
    notify('browser-download-retry');
    return process(1);
  }

  async function requestNewGrantForPending() {
    if (state.downloadRunning) return false;
    const item = pendingBrowserItem();
    if (!item) return false;
    item.deliveryStatus = '';
    item.lastError = '';
    state.browserPendingDownload = null;
    state.reusableGrant = null;
    state.queueMessage = translator.t('queue.browserRequestingNewLink');
    saveQueue();
    notify('browser-download-new-grant');
    return process(1);
  }

  function stop() {
    if (!state.downloadRunning) return false;
    state.downloadStopRequested = true;
    state.queueMessage = translator.t('queue.stopRequested');
    notify('download-stop-requested');
    return true;
  }

  function removeHistoryAndRequeue(entry) {
    history.remove(entry.type, entry.id, entry.providerId);
    const result = enqueue([entry]);
    state.queueMessage = translator.t('history.retryQueued');
    notify('history-retry');
    return result;
  }

  return {
    enqueue,
    clear,
    stop,
    process,
    confirmBrowserDownload,
    retryPendingBrowserDownload,
    requestNewGrantForPending,
    pruneCompleted,
    expireBlockIfNeeded,
    applyRateInfo,
    removeHistoryAndRequeue,
    formatTime
  };
}

module.exports = { createQueueManager, isTransientDownloadError, retryDelayMs };
