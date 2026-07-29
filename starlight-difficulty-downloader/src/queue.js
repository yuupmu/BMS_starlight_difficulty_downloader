'use strict';

const { CONFIG } = require('./config');
const { extractRateInfo, isRateLimitError } = require('./api');
const { sleep, fileKey, formatLocalDate } = require('./utils');

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
    state.downloadQueue = state.downloadQueue.filter((item) => !history.has(item.type, item.id));
    const removed = before - state.downloadQueue.length;
    if (removed > 0) saveQueue();
    return removed;
  }

  function enqueue(items) {
    const existing = new Set(state.downloadQueue.map((item) => fileKey(item.type, item.id)));
    let added = 0;
    let alreadyRequested = 0;
    let alreadyQueued = 0;

    for (const rawItem of items || []) {
      if (!rawItem?.id || (rawItem.type !== 'song' && rawItem.type !== 'sabun')) continue;
      const key = fileKey(rawItem.type, rawItem.id);
      if (history.has(rawItem.type, rawItem.id)) {
        alreadyRequested += 1;
        continue;
      }
      if (existing.has(key)) {
        alreadyQueued += 1;
        continue;
      }
      existing.add(key);
      state.downloadQueue.push({
        type: rawItem.type,
        id: String(rawItem.id),
        title: String(rawItem.title || rawItem.id),
        sourceName: String(rawItem.sourceName || ''),
        level: String(rawItem.level ?? state.selectedLevel ?? ''),
        addedAt: new Date().toISOString(),
        attempts: 0,
        lastAttemptAt: null,
        lastError: ''
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
    storage.clearQueue();
    state.queueMessage = translator.t('queue.cleared');
    notify('clear-queue');
  }

  function triggerBrowserDownload(downloadUrl) {
    const absolute = new URL(downloadUrl, config.downloadBaseUrl).toString();
    const link = document.createElement('a');
    link.href = absolute;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function process(maxItems = state.batchSize) {
    if (state.downloadRunning || !state.downloadQueue.length) return { completed: 0, skipped: 0 };
    expireBlockIfNeeded();
    if (state.blockedUntil > Date.now()) {
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
    state.queueMessage = translator.t('queue.downloadStarting');
    notify('download-start');

    let completed = 0;
    let skipped = initiallyPruned;
    const requestedTarget = Math.max(1, Number(maxItems) || config.defaultBatchSize);
    const knownWindowRemaining = Number(state.rateInfo?.remainingInWindow);
    const target = Number.isFinite(knownWindowRemaining) && knownWindowRemaining > 0
      ? Math.min(requestedTarget, knownWindowRemaining)
      : requestedTarget;

    while (state.downloadQueue.length && completed < target) {
      const item = state.downloadQueue[0];
      if (history.has(item.type, item.id)) {
        state.downloadQueue.shift();
        skipped += 1;
        saveQueue();
        notify('skip-history-duplicate');
        continue;
      }

      state.queueMessage = translator.t('queue.processingItem', {
        current: completed + 1,
        target,
        level: item.level,
        title: item.title
      });
      item.attempts = Number(item.attempts || 0) + 1;
      item.lastAttemptAt = new Date().toISOString();
      item.lastError = '';
      saveQueue();
      notify('download-item-start');

      try {
        const payload = await api.grant(item.type, item.id);
        applyRateInfo(payload, false);
        triggerBrowserDownload(payload.downloadUrl);

        // Record first, then remove from the queue. If execution is interrupted between
        // these two writes, the next run prunes the remaining queue item by history key.
        history.markRequested(item, payload);
        state.downloadQueue.shift();
        saveQueue();
        completed += 1;
        notify('download-item-requested');

        if (state.blockedUntil > Date.now()) {
          state.queueMessage = translator.t('queue.windowUsed', { time: formatTime(state.blockedUntil) });
          break;
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
          state.queueMessage = translator.t('queue.limitReached', {
            time: resetText,
            today: todaySuffix
          });
          notify('rate-limit');
          break;
        }

        state.queueMessage = translator.t('queue.currentFailure', { error: item.lastError });
        notify('download-error');
        break;
      }

      if (state.downloadQueue.length && completed < target) await sleep(config.downloadDelayMs);
    }

    state.downloadRunning = false;
    if (completed > 0 && state.blockedUntil <= Date.now()) {
      state.queueMessage = state.downloadQueue.length
        ? translator.t('queue.batchComplete', { completed, remaining: state.downloadQueue.length })
        : translator.t('queue.allComplete', { completed });
    } else if (completed === 0 && skipped > 0 && !state.downloadQueue.length) {
      state.queueMessage = translator.t('queue.skippedCompleted', { count: skipped });
    }
    saveQueue();
    notify('download-finished');
    return { completed, skipped };
  }

  function removeHistoryAndRequeue(entry) {
    history.remove(entry.type, entry.id);
    const result = enqueue([entry]);
    state.queueMessage = translator.t('history.retryQueued');
    notify('history-retry');
    return result;
  }

  return {
    enqueue,
    clear,
    process,
    pruneCompleted,
    expireBlockIfNeeded,
    applyRateInfo,
    removeHistoryAndRequeue,
    formatTime
  };
}

module.exports = { createQueueManager };
