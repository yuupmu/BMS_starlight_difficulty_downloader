'use strict';

const { CONFIG } = require('./config');
const { createTranslator, detectLanguage } = require('./i18n');
const { createStorage } = require('./storage');
const { createHistoryStore } = require('./history');
const { createApi } = require('./api');
const { createQueueManager } = require('./queue');
const { createUi } = require('./ui');
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
  levelSort,
  createCsv,
  downloadTextFile
} = require('./utils');

async function start() {
  if (globalThis.__STARLIGHT_DIFFICULTY_DOWNLOADER__?.destroy) {
    globalThis.__STARLIGHT_DIFFICULTY_DOWNLOADER__.destroy();
  }

  const storage = createStorage();
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

  const batchSize = CONFIG.allowedBatchSizes.includes(Number(savedPrefs.batchSize))
    ? Number(savedPrefs.batchSize)
    : CONFIG.defaultBatchSize;

  const state = {
    table: [],
    levels: [],
    levelCounts: new Map(),
    charts: [],
    rows: [],
    selectedLevel: String(savedPrefs.selectedLevel ?? CONFIG.defaultLevel),
    selectedFilter: 'all',
    searchStopped: false,
    searchRunning: false,
    searchRunId: 0,
    statusDescriptor: { key: 'status.loadingTable', variables: {} },
    downloadQueue: storage.loadQueue(),
    downloadRunning: false,
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
    const descriptor = state.statusDescriptor || { key: 'status.loadingTable', variables: {} };
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

  async function startLevelSearch(level) {
    const normalizedLevel = String(level).trim();
    if (!state.table.length || !normalizedLevel) return;

    const runId = state.searchRunId + 1;
    state.searchRunId = runId;
    state.searchStopped = false;
    state.searchRunning = true;
    state.selectedLevel = normalizedLevel;
    state.selectedFilter = 'all';
    state.charts = state.table.filter((entry) => String(entry.level).trim() === normalizedLevel);
    state.rows = [];
    savePrefs();

    ui.els.level.value = normalizedLevel;
    ui.els.chartHeading.textContent = `sr${normalizedLevel} ${translator.t('table.chart')}`;
    ui.els.body.innerHTML = '';
    ui.setProgress(0, state.charts.length);
    ui.setSearchRunning(true);
    ui.refreshFilter();
    ui.renderCounts();

    if (!state.charts.length) {
      state.searchRunning = false;
      ui.setSearchRunning(false);
      setStatus('status.noLevel', { level: normalizedLevel });
      return;
    }

    setStatus('status.levelConfirmed', { level: normalizedLevel, count: state.charts.length });

    const isCancelled = () => state.searchStopped || runId !== state.searchRunId || state.destroyed;

    for (let index = 0; index < state.charts.length; index += 1) {
      if (isCancelled()) break;
      const chart = state.charts[index];
      ui.setProgress(index, state.charts.length);
      setStatus('status.searching', {
        level: normalizedLevel,
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
      ui.renderRow(state.rows.length - 1);
      ui.renderCounts();
      ui.setProgress(index + 1, state.charts.length);
    }

    if (runId !== state.searchRunId || state.destroyed) return;
    state.searchRunning = false;
    ui.setSearchRunning(false);
    if (state.searchStopped) {
      setStatus('status.searchStopped', {
        level: normalizedLevel,
        count: state.rows.length
      });
    } else {
      setStatus('status.searchComplete', {
        level: normalizedLevel,
        count: state.charts.length
      });
    }
  }

  function stopSearch() {
    state.searchStopped = true;
    state.searchRunId += 1;
    state.searchRunning = false;
    ui.setSearchRunning(false);
    setStatus('status.searchStopped', {
      level: state.selectedLevel,
      count: state.rows.length
    });
  }

  function selectionsFromRows(indexes) {
    const selections = [];
    for (const index of indexes) {
      const result = state.rows[index];
      if (!result) continue;
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
      level: result.chart.level
    }]);
    if (enqueueResult.added > 0) await queueManager.process(1);
  }

  function exportSearchResults() {
    const headers = [
      'index', 'level', 'title', 'subtitle', 'artist', 'sha256', 'match_status', 'download_status',
      'song_match', 'song_file_id', 'song_score', 'sabun_match', 'sabun_file_id', 'sabun_score',
      'fallbacks', 'table_url', 'table_diff_url'
    ];
    const rows = [headers];

    state.rows.forEach((result, index) => {
      const song = result.song.matches[0];
      const sabun = result.sabun.matches[0];
      const coverage = downloadCoverage(result, history);
      const downloadStatus = coverage.all
        ? 'requested'
        : coverage.partial
          ? `partial:${coverage.done}/${coverage.total}`
          : 'not_requested';

      rows.push([
        index + 1,
        result.chart.level,
        result.chart.title,
        result.chart.subtitle || '',
        result.chart.artist || '',
        result.chart.sha256 || '',
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
    downloadTextFile(
      createCsv(rows),
      `starlight_sr${state.selectedLevel}_live_results_${date}.csv`,
      'text/csv;charset=utf-8'
    );
  }

  function exportHistory() {
    const rows = [[
      'requested_at', 'level', 'type', 'title', 'source_name', 'file_id', 'file_name', 'status'
    ]];
    for (const entry of history.list()) {
      rows.push([
        entry.requestedAt,
        entry.level,
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

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    state.searchStopped = true;
    state.searchRunId += 1;
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
      onSearchLevel: startLevelSearch,
      onStopSearch: stopSearch,
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
        state.batchSize = CONFIG.allowedBatchSizes.includes(value) ? value : CONFIG.defaultBatchSize;
        savePrefs();
      },
      onRunQueue() {
        queueManager.process(state.batchSize);
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
          history.remove(entry.type, entry.id);
          state.queueMessage = translator.t('history.recordRemoved');
        }
        refreshAfterHistoryChange();
      }
    }
  });

  globalThis.__STARLIGHT_DIFFICULTY_DOWNLOADER__ = { destroy, state };

  state.rateTimer = setInterval(() => {
    if (state.destroyed) return;
    queueManager.expireBlockIfNeeded();
    ui.renderQueue();
  }, 1000);

  try {
    const table = await api.fetchTable();
    if (state.destroyed) return null;
    state.table = table;

    const counts = new Map();
    for (const entry of table) {
      const level = String(entry.level ?? '').trim();
      if (!level) continue;
      counts.set(level, (counts.get(level) || 0) + 1);
    }
    state.levelCounts = counts;
    state.levels = [...counts.keys()].sort(levelSort);
    if (!state.levels.length) throw new Error('No levels found in the official table.');
    if (!state.levels.includes(state.selectedLevel)) {
      state.selectedLevel = state.levels.includes(CONFIG.defaultLevel)
        ? CONFIG.defaultLevel
        : state.levels[0];
    }

    ui.setLevels(state.levels, counts);
    savePrefs();

    const restored = state.downloadQueue.length || history.size()
      ? translator.t('status.tableRestoredSuffix', {
        queue: state.downloadQueue.length,
        history: history.size()
      })
      : '';
    setStatus('status.tableLoaded', { level: state.selectedLevel, restored });
    ui.renderQueue();
    await startLevelSearch(state.selectedLevel);
  } catch (error) {
    console.error(error);
    setStatus('status.failure', { error: error?.message || String(error) });
    ui.els.loadLevel.disabled = true;
    alert(`${translator.t('app.loadFailureTitle')}\n\n${error?.message || error}\n\n${translator.t('app.verifySongsPage')}`);
  }

  return globalThis.__STARLIGHT_DIFFICULTY_DOWNLOADER__;
}

module.exports = { start };
