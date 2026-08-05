'use strict';

const { CONFIG } = require('./config');
const { createTranslator, detectLanguage } = require('./i18n');
const { createStorage } = require('./storage');
const { createHistoryStore } = require('./history');
const { createApi } = require('./api');
const { createQueueManager } = require('./queue');
const { createUi } = require('./ui');
const {
  scanLibrary,
  createInventoryLookup,
  chartInstallation,
  createInventoryStore,
  rootNameFromFiles
} = require('./inventory');
const {
  TABLE_CATALOG,
  getTable,
  normalizeTableRows,
  sortLevels,
  formatLevel
} = require('./tables');
const {
  classify,
  getFallbacks,
  findMatches,
  itemDisplay,
  scoreForResult,
  selectionItemsForResult,
  downloadCoverage
} = require('./matcher');
const {
  createCsv,
  downloadTextFile
} = require('./utils');

async function start() {
  if (globalThis.__STARLIGHT_DIFFICULTY_DOWNLOADER__?.destroy) {
    globalThis.__STARLIGHT_DIFFICULTY_DOWNLOADER__.destroy();
  }

  const storage = createStorage();
  const inventoryStore = createInventoryStore();
  const savedPrefs = storage.loadPrefs();
  const translator = createTranslator(detectLanguage(savedPrefs.language, navigator.language));

  const validHost = location.hostname === CONFIG.requiredHost;
  const validPath = location.pathname.startsWith(CONFIG.requiredPathPrefix);
  if (!validHost || !validPath) {
    alert(`${translator.t('app.requiredPage')}\n\n${CONFIG.songsPageUrl}\n\n${translator.t('app.openRequiredPage')}`);
    return null;
  }

  const history = createHistoryStore({
    storage,
    initialEntries: storage.loadHistory(),
    limit: CONFIG.historyLimit
  });

  const batchSize = savedPrefs.batchSize === CONFIG.safeBatchValue
    ? CONFIG.safeBatchValue
    : CONFIG.allowedBatchSizes.includes(Number(savedPrefs.batchSize))
      ? Number(savedPrefs.batchSize)
      : CONFIG.defaultBatchSize;

  const selectedTable = getTable(savedPrefs.selectedTableId || CONFIG.defaultTableId);
  const savedSelectedLevels = savedPrefs.selectedLevels && typeof savedPrefs.selectedLevels === 'object'
    ? savedPrefs.selectedLevels
    : {};
  const initialLevel = savedSelectedLevels[selectedTable.id]
    ?? (selectedTable.id === 'starlight' ? savedPrefs.selectedLevel : null)
    ?? selectedTable.defaultLevel;

  const state = {
    tables: TABLE_CATALOG,
    table: [],
    levels: [],
    levelCounts: new Map(),
    charts: [],
    rows: [],
    selectedTableId: selectedTable.id,
    selectedTable,
    selectedLevels: { ...savedSelectedLevels, [selectedTable.id]: String(initialLevel) },
    selectedLevel: String(initialLevel),
    selectedFilter: 'all',
    searchStopped: false,
    searchRunning: false,
    searchRunId: 0,
    tableLoadRunId: 0,
    statusDescriptor: { key: 'status.loadingTable', variables: { table: selectedTable.name } },
    downloadQueue: storage.loadQueue(),
    downloadRunning: false,
    downloadStopRequested: false,
    downloadDirectoryHandle: null,
    libraryInventory: null,
    libraryScanRunning: false,
    libraryScanStopRequested: false,
    libraryScanStats: null,
    libraryScanMessage: '',
    batchSize,
    blockedUntil: Number(savedPrefs.blockedUntil) || 0,
    rateInfo: savedPrefs.rateInfo && typeof savedPrefs.rateInfo === 'object' ? savedPrefs.rateInfo : null,
    queueMessage: '',
    rateTimer: null,
    destroyed: false
  };

  if (state.blockedUntil && state.blockedUntil <= Date.now()) state.blockedUntil = 0;

  const api = createApi();
  let ui = null;
  let queueManager = null;

  function savePrefs() {
    storage.savePrefs({
      selectedLevel: state.selectedLevel,
      selectedTableId: state.selectedTableId,
      selectedLevels: state.selectedLevels,
      batchSize: state.batchSize,
      blockedUntil: state.blockedUntil,
      rateInfo: state.rateInfo,
      language: translator.language
    });
  }

  function setStatus(key, variables = {}) {
    state.statusDescriptor = { key, variables };
    ui?.setStatus(translator.t(key, variables));
  }

  function refreshStatus() {
    const descriptor = state.statusDescriptor || { key: 'status.loadingTable', variables: { table: state.selectedTable.name } };
    ui?.setStatus(translator.t(descriptor.key, descriptor.variables));
  }

  function refreshAfterHistoryChange() {
    ui?.renderQueue();
    ui?.renderAllRows();
    if (ui && !ui.els.historyOverlay.hidden) ui.renderHistory();
  }

  queueManager = createQueueManager({
    state,
    storage,
    history,
    api,
    translator,
    savePrefs,
    onChange(reason) {
      if (!ui || state.destroyed) return;
      ui.renderQueue();
      ui.renderLibraryStatus();
      if (['download-item-requested', 'history-retry'].includes(reason)) {
        ui.renderAllRows();
        if (!ui.els.historyOverlay.hidden) ui.renderHistory();
      }
    }
  });

  const initiallyPruned = queueManager.pruneCompleted();
  if (initiallyPruned > 0) {
    state.queueMessage = translator.t('queue.pruned', { count: initiallyPruned });
  }

  async function loadTable(tableId, options = {}) {
    const descriptor = getTable(tableId);
    const loadRunId = state.tableLoadRunId + 1;
    state.tableLoadRunId = loadRunId;
    state.searchStopped = true;
    state.searchRunning = false;
    state.searchRunId += 1;
    state.selectedTableId = descriptor.id;
    state.selectedTable = descriptor;
    state.selectedLevel = String(state.selectedLevels[descriptor.id] ?? descriptor.defaultLevel);
    state.table = [];
    state.levels = [];
    state.levelCounts = new Map();
    state.charts = [];
    state.rows = [];
    state.selectedFilter = 'all';
    savePrefs();

    if (ui) {
      ui.els.table.value = descriptor.id;
      ui.els.level.innerHTML = '<option></option>';
      ui.els.body.innerHTML = '';
      ui.setProgress(0, 1);
      ui.setSearchRunning(false);
      ui.setTableLoading(true);
      ui.updateTranslations();
    }
    setStatus('status.loadingTable', { table: descriptor.name });

    try {
      const rawRows = await api.fetchTable(descriptor);
      if (state.destroyed || loadRunId !== state.tableLoadRunId) return false;
      const table = normalizeTableRows(rawRows, descriptor);
      if (!table.length) throw new Error('No usable charts found in the official table.');
      state.table = table;

      const counts = new Map();
      for (const entry of table) counts.set(entry.level, (counts.get(entry.level) || 0) + 1);
      state.levelCounts = counts;
      state.levels = sortLevels(counts.keys(), descriptor);
      if (!state.levels.includes(state.selectedLevel)) {
        state.selectedLevel = state.levels.includes(descriptor.defaultLevel)
          ? descriptor.defaultLevel
          : state.levels[0];
      }
      state.selectedLevels[descriptor.id] = state.selectedLevel;

      ui.setLevels(state.levels, counts);
      ui.setTableLoading(false);
      savePrefs();

      const restored = state.downloadQueue.length || history.size()
        ? translator.t('status.tableRestoredSuffix', {
          queue: state.downloadQueue.length,
          history: history.size()
        })
        : '';
      setStatus('status.tableLoaded', { table: descriptor.name, count: table.length, restored });
      ui.renderQueue();
      return true;
    } catch (error) {
      if (state.destroyed || loadRunId !== state.tableLoadRunId) return false;
      console.error(error);
      ui.setTableLoading(false);
      setStatus('status.failure', { table: descriptor.name, error: error?.message || String(error) });
      if (options.initial) {
        alert(`${translator.t('app.loadFailureTitle')}\n\n${error?.message || error}\n\n${translator.t('app.verifySongsPage')}`);
      }
      return false;
    }
  }

  function chartIdentity(chart) {
    return String(chart?.sha256 || chart?.url_diff || chart?.url || `${chart?.title || ''}|${chart?.artist || ''}`);
  }

  function cacheableRows(rows) {
    const compactSource = (source) => ({
      error: String(source?.error || ''),
      matches: (source?.matches || []).map((match) => ({
        score: Number(match.score) || 0,
        query: String(match.query || ''),
        item: {
          id: String(match.item?.id || ''),
          title: String(match.item?.title || ''),
          subtitle: String(match.item?.subtitle || ''),
          name: String(match.item?.name || ''),
          path: String(match.item?.path || ''),
          artist: String(match.item?.artist || '')
        }
      }))
    });
    return rows.map((row) => ({
      chart: {
        title: String(row.chart?.title || ''),
        subtitle: String(row.chart?.subtitle || ''),
        artist: String(row.chart?.artist || ''),
        level: String(row.chart?.level || ''),
        url: String(row.chart?.url || ''),
        url_diff: String(row.chart?.url_diff || ''),
        md5: String(row.chart?.md5 || ''),
        sha256: String(row.chart?.sha256 || ''),
        tableId: String(row.chart?.tableId || ''),
        tableName: String(row.chart?.tableName || ''),
        levelSymbol: String(row.chart?.levelSymbol || ''),
        tableSourceUrl: String(row.chart?.tableSourceUrl || '')
      },
      song: compactSource(row.song),
      sabun: compactSource(row.sabun),
      fallbacks: (row.fallbacks || []).map((fallback) => ({ ...fallback })),
      classification: { ...row.classification }
    }));
  }

  function saveSearchCache(level, complete) {
    return storage.saveSearchResult(
      state.selectedTableId,
      level,
      cacheableRows(state.rows),
      complete
    );
  }

  function compatibleCachedRows(cached, charts) {
    return Boolean(cached?.rows?.length <= charts.length && cached.rows.every((row, index) => (
      row?.chart && chartIdentity(row.chart) === chartIdentity(charts[index])
    )));
  }

  async function startLevelSearch(level, options = {}) {
    const normalizedLevel = String(level).trim();
    if (!state.table.length || !normalizedLevel) return;

    const runId = state.searchRunId + 1;
    state.searchRunId = runId;
    state.searchStopped = false;
    state.searchRunning = true;
    state.selectedLevel = normalizedLevel;
    state.selectedLevels[state.selectedTableId] = normalizedLevel;
    state.selectedFilter = 'all';
    state.charts = state.table.filter((entry) => String(entry.level).trim() === normalizedLevel);
    state.rows = [];
    if (options.force) storage.clearSearchResult(state.selectedTableId, normalizedLevel);
    savePrefs();

    ui.els.level.value = normalizedLevel;
    const levelLabel = formatLevel(state.selectedTable, normalizedLevel);
    ui.els.chartHeading.textContent = `${levelLabel} ${translator.t('table.chart')}`;
    ui.els.body.innerHTML = '';
    ui.setProgress(0, state.charts.length);
    ui.setSearchRunning(true);
    ui.refreshFilter();
    ui.renderCounts();

    if (!state.charts.length) {
      state.searchRunning = false;
      ui.setSearchRunning(false);
      setStatus('status.noLevel', { levelLabel });
      return;
    }

    const cached = options.force ? null : storage.loadSearchResult(state.selectedTableId, normalizedLevel);
    if (cached && compatibleCachedRows(cached, state.charts)) {
      state.rows = cached.rows;
      ui.renderAllRows({ preserveSelection: false });
      ui.setProgress(state.rows.length, state.charts.length);
      if (cached.complete && state.rows.length === state.charts.length) {
        state.searchRunning = false;
        ui.setSearchRunning(false);
        setStatus('status.searchCacheRestored', {
          levelLabel,
          count: state.rows.length,
          time: new Date(cached.savedAt).toLocaleString(translator.locale())
        });
        return;
      }
      setStatus('status.searchCacheResumed', {
        levelLabel,
        current: state.rows.length,
        total: state.charts.length
      });
    }

    if (!state.rows.length) setStatus('status.levelConfirmed', { levelLabel, count: state.charts.length });

    const isCancelled = () => state.searchStopped || runId !== state.searchRunId || state.destroyed;

    for (let index = state.rows.length; index < state.charts.length; index += 1) {
      if (isCancelled()) break;
      const chart = state.charts[index];
      ui.setProgress(index, state.charts.length);
      setStatus('status.searching', {
        levelLabel,
        current: index + 1,
        total: state.charts.length,
        title: chart.title
      });

      const song = await findMatches({
        api,
        chart,
        sourceType: 'song',
        maxQueries: 4,
        isCancelled
      });
      if (isCancelled()) break;

      let sabun = { matches: [], error: '' };
      if (chart.url_diff || !song.matches.length || song.matches[0].score < 75) {
        sabun = await findMatches({
          api,
          chart,
          sourceType: 'sabun',
          maxQueries: chart.url_diff ? 4 : 2,
          isCancelled
        });
      }
      if (isCancelled()) break;

      const bestScore = scoreForResult({ chart, song, sabun });
      const fallbacks = getFallbacks(chart);
      let classification;
      if (bestScore) {
        classification = classify(bestScore);
      } else if (fallbacks.length) {
        classification = {
          key: 'review',
          className: 'warn',
          labelKey: 'classification.fallbackOnly',
          fallbackOnly: true
        };
      } else {
        classification = classify(0);
      }

      state.rows.push({ chart, song, sabun, fallbacks, classification });
      if (state.rows.length % 5 === 0) {
        saveSearchCache(normalizedLevel, false);
      }
      ui.renderRow(state.rows.length - 1);
      ui.renderCounts();
      ui.setProgress(index + 1, state.charts.length);
    }

    if (runId !== state.searchRunId || state.destroyed) return;
    state.searchRunning = false;
    ui.setSearchRunning(false);
    saveSearchCache(normalizedLevel, !state.searchStopped && state.rows.length === state.charts.length);
    if (state.searchStopped) {
      setStatus('status.searchStopped', {
        levelLabel,
        count: state.rows.length
      });
    } else {
      setStatus('status.searchComplete', {
        levelLabel,
        count: state.charts.length
      });
    }
  }

  function stopSearch() {
    state.searchStopped = true;
    state.searchRunId += 1;
    state.searchRunning = false;
    saveSearchCache(state.selectedLevel, false);
    ui.setSearchRunning(false);
    setStatus('status.searchStopped', {
      levelLabel: formatLevel(state.selectedTable, state.selectedLevel),
      count: state.rows.length
    });
  }

  function selectionsFromRows(indexes) {
    const selections = [];
    for (const index of indexes) {
      const result = state.rows[index];
      if (!result) continue;
      if (chartInstallation(result.chart, state.libraryInventory).status === 'installed') continue;
      selections.push(...selectionItemsForResult(result));
    }
    return selections;
  }

  async function handleCandidate({ type, id, rowIndex }) {
    const result = state.rows[rowIndex];
    if (!result) return;
    const matches = type === 'sabun' ? result.sabun.matches : result.song.matches;
    const match = matches.find((candidate) => String(candidate.item?.id) === String(id));
    if (!match) return;

    const enqueueResult = queueManager.enqueue([{
      type,
      id,
      title: result.chart.title,
      sourceName: itemDisplay(match.item),
      level: result.chart.level,
      levelLabel: formatLevel(state.selectedTable, result.chart.level),
      tableId: result.chart.tableId,
      tableName: result.chart.tableName,
      levelSymbol: result.chart.levelSymbol,
      sha256: result.chart.sha256,
      md5: result.chart.md5
    }]);
    if (enqueueResult.added > 0) await queueManager.process(1);
  }

  function exportSearchResults() {
    const headers = [
      'index', 'table_id', 'table_name', 'level', 'level_label', 'title', 'subtitle', 'artist', 'sha256', 'installation_status', 'installed_path', 'match_status', 'download_status',
      'song_match', 'song_file_id', 'song_score', 'sabun_match', 'sabun_file_id', 'sabun_score',
      'fallbacks', 'table_url', 'table_diff_url'
    ];
    const rows = [headers];

    state.rows.forEach((result, index) => {
      const song = result.song.matches[0];
      const sabun = result.sabun.matches[0];
      const coverage = downloadCoverage(result, history);
      const installation = chartInstallation(result.chart, state.libraryInventory);
      const downloadStatus = coverage.all
        ? 'requested'
        : coverage.partial
          ? `partial:${coverage.done}/${coverage.total}`
          : 'not_requested';

      rows.push([
        index + 1,
        result.chart.tableId,
        result.chart.tableName,
        result.chart.level,
        formatLevel(state.selectedTable, result.chart.level),
        result.chart.title,
        result.chart.subtitle || '',
        result.chart.artist || '',
        result.chart.sha256 || '',
        installation.status,
        installation.entry?.path || '',
        result.classification.key,
        downloadStatus,
        song ? itemDisplay(song.item) : '',
        song?.item?.id || '',
        song?.score || '',
        sabun ? itemDisplay(sabun.item) : '',
        sabun?.item?.id || '',
        sabun?.score || '',
        result.fallbacks.map((fallback) => `${translator.t(fallback.labelKey, fallback)}: ${fallback.url}`).join(' | '),
        result.chart.url || '',
        result.chart.url_diff || ''
      ]);
    });

    const date = new Date().toISOString().slice(0, 10);
    const safeLevel = formatLevel(state.selectedTable, state.selectedLevel).replace(/[^\p{L}\p{N}_+-]+/gu, '-');
    downloadTextFile(
      createCsv(rows),
      `${state.selectedTableId}_${safeLevel}_live_results_${date}.csv`,
      'text/csv;charset=utf-8'
    );
  }

  function exportHistory() {
    const rows = [[
      'requested_at', 'table_id', 'table_name', 'level', 'level_label', 'type', 'title', 'source_name', 'file_id', 'file_name', 'status'
    ]];
    for (const entry of history.list()) {
      rows.push([
        entry.requestedAt,
        entry.tableId,
        entry.tableName,
        entry.level,
        entry.levelLabel,
        entry.type,
        entry.title,
        entry.sourceName,
        entry.id,
        entry.fileName,
        entry.status
      ]);
    }
    const date = new Date().toISOString().slice(0, 10);
    const filename = translator.t('history.exportName', { date });
    downloadTextFile(createCsv(rows), filename, 'text/csv;charset=utf-8');
  }

  function changeLanguage(language) {
    translator.setLanguage(language);
    state.queueMessage = '';
    savePrefs();
    ui.updateTranslations();
    refreshStatus();
  }

  async function chooseDownloadDirectory() {
    if (typeof globalThis.showDirectoryPicker !== 'function') {
      state.queueMessage = translator.t('download.folderUnsupported');
      ui.renderQueue();
      return;
    }
    try {
      const handle = await globalThis.showDirectoryPicker({
        id: 'bms-difficulty-table-downloader',
        mode: 'readwrite'
      });
      state.downloadDirectoryHandle = handle;
      state.queueMessage = translator.t('download.folderSelected', { name: handle.name });
      ui.renderQueue();
    } catch (error) {
      if (error?.name !== 'AbortError') {
        state.queueMessage = translator.t('download.folderFailure', { error: error?.message || String(error) });
        ui.renderQueue();
      }
    }
  }

  async function scanLibrarySource(source, rootName) {
    if (state.libraryScanRunning) return;
    if (state.downloadRunning) {
      state.libraryScanMessage = translator.t('inventory.downloadBusy');
      ui.renderLibraryStatus();
      return;
    }
    state.libraryScanRunning = true;
    state.libraryScanStopRequested = false;
    state.libraryScanStats = { discovered: 0, rehashed: 0, reused: 0, errors: 0 };
    state.libraryScanMessage = translator.t('inventory.preparing', { name: rootName });
    ui.renderLibraryStatus();
    ui.renderQueue();

    try {
      const cached = await inventoryStore.load(rootName);
      let previous = null;
      if (source?.kind === 'directory'
        && cached?.rootHandle
        && typeof source.isSameEntry === 'function') {
        try {
          if (await source.isSameEntry(cached.rootHandle)) previous = cached;
        } catch {}
      }
      const snapshot = await scanLibrary(source, previous, {
        rootName,
        isCancelled: () => state.libraryScanStopRequested || state.destroyed,
        onProgress(stats) {
          state.libraryScanStats = stats;
          state.libraryScanMessage = translator.t('inventory.scanning', {
            count: stats.discovered,
            rehashed: stats.rehashed,
            reused: stats.reused
          });
          ui.renderLibraryStatus();
        }
      });

      if (!snapshot.complete || state.destroyed) {
        state.libraryScanMessage = translator.t('inventory.stopped', { count: snapshot.stats.discovered });
        return;
      }

      state.libraryInventory = createInventoryLookup(snapshot);
      const persistedSnapshot = source?.kind === 'directory'
        ? { ...snapshot, rootHandle: source }
        : snapshot;
      await inventoryStore.save(persistedSnapshot);
      const queueBefore = state.downloadQueue.length;
      state.downloadQueue = state.downloadQueue.filter((item) => (
        chartInstallation(item, state.libraryInventory).status !== 'installed'
      ));
      const queueRemoved = queueBefore - state.downloadQueue.length;
      if (queueRemoved > 0) storage.saveQueue(state.downloadQueue);
      state.libraryScanMessage = translator.t('inventory.complete', {
        name: snapshot.rootName,
        count: snapshot.files.length,
        rehashed: snapshot.stats.rehashed,
        reused: snapshot.stats.reused,
        errors: snapshot.stats.errors,
        queueRemoved
      });
      ui.renderAllRows();
      ui.renderQueue();
    } catch (error) {
      if (error?.name !== 'AbortError') {
        state.libraryScanMessage = translator.t('inventory.failure', { error: error?.message || String(error) });
      }
    } finally {
      state.libraryScanRunning = false;
      ui.renderLibraryStatus();
      ui.renderQueue();
    }
  }

  async function chooseLibraryFolder() {
    if (state.libraryScanRunning) {
      state.libraryScanStopRequested = true;
      state.libraryScanMessage = translator.t('inventory.stopRequested');
      ui.renderLibraryStatus();
      return;
    }
    if (state.downloadRunning) {
      state.libraryScanMessage = translator.t('inventory.downloadBusy');
      ui.renderLibraryStatus();
      return;
    }
    if (typeof globalThis.showDirectoryPicker !== 'function') {
      ui.openLibraryFilePicker();
      return;
    }
    try {
      const handle = await globalThis.showDirectoryPicker({
        id: 'bms-difficulty-table-library-scan',
        mode: 'read'
      });
      await scanLibrarySource(handle, handle.name);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        state.libraryScanMessage = translator.t('inventory.failure', { error: error?.message || String(error) });
        ui.renderLibraryStatus();
      }
    }
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    state.searchStopped = true;
    state.searchRunId += 1;
    state.libraryScanStopRequested = true;
    queueManager?.stop();
    if (state.rateTimer) clearInterval(state.rateTimer);
    ui?.destroy();
    if (globalThis.__STARLIGHT_DIFFICULTY_DOWNLOADER__?.destroy === destroy) {
      delete globalThis.__STARLIGHT_DIFFICULTY_DOWNLOADER__;
    }
  }

  ui = createUi({
    state,
    translator,
    history,
    handlers: {
      onTableChange: loadTable,
      onLevelChange(level) {
        state.selectedLevel = String(level);
        state.selectedLevels[state.selectedTableId] = state.selectedLevel;
        savePrefs();
      },
      onSearchLevel: startLevelSearch,
      onRefreshLevel(level) {
        startLevelSearch(level, { force: true });
      },
      onStopSearch: stopSearch,
      onScanLibrary: chooseLibraryFolder,
      onLibraryFiles(files) {
        if (files?.length) scanLibrarySource(files, rootNameFromFiles(files));
      },
      onClose: destroy,
      onCandidate: handleCandidate,
      onQueueSelected(indexes) {
        const selections = selectionsFromRows(indexes);
        if (!selections.length) {
          state.queueMessage = translator.t('queue.selectFirst');
          ui.renderQueue();
          return;
        }
        queueManager.enqueue(selections);
      },
      onExportSearch: exportSearchResults,
      onBatchSizeChange(value) {
        state.batchSize = value === CONFIG.safeBatchValue
          ? CONFIG.safeBatchValue
          : CONFIG.allowedBatchSizes.includes(Number(value))
            ? Number(value)
            : CONFIG.defaultBatchSize;
        savePrefs();
      },
      onChooseDirectory: chooseDownloadDirectory,
      onUseBrowserDownloads() {
        state.downloadDirectoryHandle = null;
        state.queueMessage = translator.t('download.browserSelected');
        ui.renderQueue();
      },
      onRunQueue() {
        if (state.libraryScanRunning) return;
        queueManager.process(state.batchSize);
      },
      onStopQueue() {
        queueManager.stop();
      },
      onClearQueue() {
        queueManager.clear();
      },
      onLanguageChange: changeLanguage,
      onExportHistory: exportHistory,
      onClearHistory() {
        history.clear();
        state.queueMessage = translator.t('history.cleared');
        refreshAfterHistoryChange();
      },
      onHistoryAction(action, entry) {
        if (action === 'retry') {
          queueManager.removeHistoryAndRequeue(entry);
        } else if (action === 'remove') {
          history.remove(entry.type, entry.id, entry.providerId);
          state.queueMessage = translator.t('history.recordRemoved');
        }
        refreshAfterHistoryChange();
      }
    }
  });

  ui.setTables(TABLE_CATALOG);

  globalThis.__STARLIGHT_DIFFICULTY_DOWNLOADER__ = { destroy, state };

  state.rateTimer = setInterval(() => {
    if (state.destroyed) return;
    queueManager.expireBlockIfNeeded();
    ui.renderQueue();
  }, 1000);

  await loadTable(state.selectedTableId, { initial: true });

  return globalThis.__STARLIGHT_DIFFICULTY_DOWNLOADER__;
}

module.exports = { start };
