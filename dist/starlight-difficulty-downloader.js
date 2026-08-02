/*!
 * Starlight Difficulty Downloader
 * Built from the files in /src. Do not edit this generated file directly.
 */
(function () {
  'use strict';

  const __modules = {
  "api.js": function(module, exports, require) {
    'use strict';

    const { CONFIG } = require('./config');
    const { normalize } = require('./utils');

    class ApiError extends Error {
      constructor(message, status, payload) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.payload = payload || {};
      }
    }

    function extractRateInfo(payload) {
      if (!payload || typeof payload !== 'object') return null;
      const source = payload.rateLimit && typeof payload.rateLimit === 'object' ? payload.rateLimit : payload;
      const parseCount = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
      const remainingInWindow = parseCount(source.remainingInWindow);
      const remainingToday = parseCount(source.remainingToday);
      const windowResetsAt = typeof source.windowResetsAt === 'string' ? source.windowResetsAt : null;
      if (remainingInWindow === null && remainingToday === null && !windowResetsAt) return null;
      return { remainingInWindow, remainingToday, windowResetsAt };
    }

    function isRateLimitError(error) {
      const serverMessage = String(error?.payload?.error || error?.message || '');
      return error?.status === 429 || /download\s*limit\s*reached/i.test(serverMessage);
    }

    function createApi(options = {}) {
      const fetchFn = options.fetchFn || fetch.bind(globalThis);
      const config = options.config || CONFIG;
      const queryCache = new Map();

      async function fetchJson(url, requestOptions = {}) {
        const response = await fetchFn(url, { credentials: 'include', ...requestOptions });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const serverMessage = typeof payload.error === 'string' ? payload.error : '';
          const message = serverMessage || `${response.status} ${response.statusText}`;
          throw new ApiError(message, response.status, payload);
        }
        return payload;
      }

      async function fetchTable() {
        const response = await fetchFn(config.tableUrl, { cache: 'no-store' });
        if (!response.ok) throw new ApiError(`Difficulty table request failed: ${response.status}`, response.status, {});
        const table = await response.json();
        if (!Array.isArray(table)) throw new ApiError('Unexpected difficulty table format.', 500, {});
        return table;
      }

      async function search(sourceType, query) {
        const endpoint = sourceType === 'sabun' ? config.sabunsApi : config.songsApi;
        const cacheKey = `${sourceType}|${normalize(query)}`;
        if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);

        const url = new URL(endpoint);
        url.searchParams.set('limit', String(config.searchResultLimit));
        url.searchParams.set('offset', '0');
        url.searchParams.set('q', query);

        const payload = await fetchJson(url.toString());
        const items = Array.isArray(payload.items) ? payload.items
          : Array.isArray(payload.files) ? payload.files
            : Array.isArray(payload) ? payload
              : [];
        queryCache.set(cacheKey, items);
        return items;
      }

      async function grant(type, id) {
        const template = type === 'sabun' ? config.sabunGrantUrl : config.songGrantUrl;
        const url = template.replace('{id}', encodeURIComponent(id));
        const payload = await fetchJson(url, { method: 'POST' });
        if (!payload.downloadUrl) {
          throw new ApiError('The server did not return a download URL.', 500, payload);
        }
        return payload;
      }

      return {
        fetchJson,
        fetchTable,
        search,
        grant,
        clearSearchCache() {
          queryCache.clear();
        }
      };
    }

    module.exports = {
      ApiError,
      extractRateInfo,
      isRateLimitError,
      createApi
    };
  },
  "app.js": function(module, exports, require) {
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
  },
  "config.js": function(module, exports, require) {
    'use strict';

    const VERSION = '1.0.0';

    const CONFIG = Object.freeze({
      version: VERSION,
      projectName: 'Starlight Difficulty Downloader',
      requiredHost: 'horieyuuka.github.io',
      requiredPathPrefix: '/Songs',
      songsPageUrl: 'https://horieyuuka.github.io/Songs',
      tableUrl: 'https://raw.githubusercontent.com/DJKuroakari/DJKuroakari.github.io/refs/heads/main/data.json',
      songsApi: 'https://horie.synology.me:8443/api/v1/folders/Songs/files',
      sabunsApi: 'https://horie.synology.me:8443/api/v1/sabuns',
      songGrantUrl: 'https://horie.synology.me:8443/api/v1/files/{id}/download-grants',
      sabunGrantUrl: 'https://horie.synology.me:8443/api/v1/sabuns/{id}/download-grants',
      downloadBaseUrl: 'https://horie.synology.me:8443',
      panelId: 'starlight-difficulty-downloader',
      loaderId: 'starlight-difficulty-downloader-loader',
      searchDelayMs: 650,
      downloadDelayMs: 5000,
      defaultBatchSize: 3,
      allowedBatchSizes: Object.freeze([1, 3, 5, 10]),
      storage: Object.freeze({
        prefs: 'starlight-difficulty-downloader:prefs:v3',
        queue: 'starlight-difficulty-downloader:queue:v3',
        history: 'starlight-difficulty-downloader:history:v3',
        legacyPrefs: 'starlight-level-downloader:prefs:v2',
        legacyQueue: 'starlight-level-downloader:queue:v2'
      }),
      supportedLanguages: Object.freeze(['ko', 'ja', 'en']),
      defaultLevel: '10',
      historyLimit: 5000,
      searchResultLimit: 30,
      maxCandidatesPerSource: 3
    });

    const DIRECT_FALLBACKS = Object.freeze([
      { title: 'opia', labelKey: 'fallback.formatService', format: 'OGG', service: 'Google Drive', url: 'https://drive.google.com/file/d/1f9F2AxUh6wUTB6zQ3-YhNPmHGMcgQmvy/view?usp=sharing' },
      { title: 'opia', labelKey: 'fallback.formatService', format: 'WAV', service: 'Google Drive', url: 'https://drive.google.com/file/d/1y_A_i8z8uCczfjFMorF7IBkT3o1V3Zth/view?usp=sharing' },
      { title: 'Vis10ns', labelKey: 'fallback.formatService', format: 'OGG', service: 'Google Drive', url: 'https://drive.google.com/uc?export=download&id=1iaMltI2Mvdn5sOchKJL9VIloYvYV3Ydx' },
      { title: 'Vis10ns', labelKey: 'fallback.formatService', format: 'WAV', service: 'Google Drive', url: 'https://drive.google.com/uc?export=download&id=1jtfCwId5XZzMnZLFuRAWAJ01jFj9Y-KR' },
      { title: '海神寓拝', labelKey: 'fallback.archiveMirror', service: 'Archive.org', url: 'https://archive.org/download/sasakure_UK_bms' },
      { title: '-雪月花-', labelKey: 'fallback.service', service: 'Dropbox', url: 'https://www.dropbox.com/s/v3kcas8wwxg3den/%5BSOMON%5D-setsugekka-.zip?dl=1' },
      { title: '白と青の狭間', labelKey: 'fallback.service', service: 'Dropbox', url: 'https://www.dropbox.com/s/n3ej69ij5boenwu/%5BTake-Ma%5D%E7%99%BD%E3%81%A8%E9%9D%92%E3%81%AE%E7%8B%AD%E9%96%93.zip?dl=1' },
      { title: 'Azure Rays', labelKey: 'fallback.mainAndChart', service: 'Google Drive', url: 'https://drive.google.com/file/d/1essSFR88YXjfLffp5ETUrqnexSs0u3BJ/view?usp=sharing' },
      { title: 'Azure Rays', labelKey: 'fallback.chartOnly', service: 'Google Drive', url: 'https://drive.google.com/file/d/1ubDMYFr0-31Blb_NpAPGhrI_eRGNEw-D/view?usp=sharing' },
      { title: 'いなずまねこの踊り', labelKey: 'fallback.eventPackage', service: 'YURUYURU', url: 'https://9domu46i.com/yuruyuru/package/YURUYURU_Phase_16.zip' },
      { title: 'Holy Lightbringer', labelKey: 'fallback.service', service: 'BMSworld', url: 'https://www.bmsworld.nz/download/wire-puller-4-%E7%90%B4%E7%80%AC%E6%82%A0-holy-lightbringer/' },
      { title: 'Freefall', labelKey: 'fallback.service', service: 'Google Drive', url: 'https://drive.google.com/file/d/1FhML7CMg31G0HbPHxjsa6ctsMNZTI74u/view?usp=sharing' },
      { title: '夜間飛行トラベラー', labelKey: 'fallback.service', service: 'Dropbox', url: 'https://www.dropbox.com/s/7n1b7n25ad1a34t/qfeileadh_nightflighttravler.zip?dl=1' },
      { title: '詠訣へ連れる', labelKey: 'fallback.service', service: 'Dropbox', url: 'https://www.dropbox.com/s/om3td0f9zc23bva/EIKETSU%20HE%20TSURERU_fix_ogg.zip?dl=1' },
      { title: 'Qronostasis', labelKey: 'fallback.service', service: 'Dropbox', url: 'https://www.dropbox.com/s/gq8f430jk0fp10o/Qronostasis.zip' },
      { title: 'LOSTAIR', labelKey: 'fallback.service', service: 'Google Drive', url: 'https://drive.google.com/file/d/0B41RH3Mq-Zs_Y2tvN0V3MEZMMzg/view?usp=sharing' }
    ]);

    module.exports = { CONFIG, DIRECT_FALLBACKS };
  },
  "history.js": function(module, exports, require) {
    'use strict';

    const { CONFIG } = require('./config');
    const { fileKey } = require('./utils');

    function normalizeEntry(entry) {
      if (!entry || (entry.type !== 'song' && entry.type !== 'sabun') || entry.id === undefined || entry.id === null) return null;
      const requestedAt = entry.requestedAt || entry.completedAt || entry.timestamp || new Date().toISOString();
      return {
        key: fileKey(entry.type, entry.id),
        type: entry.type,
        id: String(entry.id),
        title: String(entry.title || entry.id),
        sourceName: String(entry.sourceName || ''),
        level: String(entry.level ?? ''),
        requestedAt,
        fileName: String(entry.fileName || ''),
        status: 'requested'
      };
    }

    function createHistoryStore(options) {
      const storage = options.storage;
      const limit = Number(options.limit || CONFIG.historyLimit);
      const map = new Map();

      for (const rawEntry of options.initialEntries || []) {
        const entry = normalizeEntry(rawEntry);
        if (!entry) continue;
        const previous = map.get(entry.key);
        if (!previous || Date.parse(entry.requestedAt) >= Date.parse(previous.requestedAt)) {
          map.set(entry.key, entry);
        }
      }

      function persist() {
        const entries = list();
        if (entries.length > limit) entries.length = limit;
        map.clear();
        for (const entry of entries) map.set(entry.key, entry);
        storage.saveHistory(entries);
        return entries;
      }

      function list() {
        return [...map.values()].sort((a, b) => {
          const aTime = Date.parse(a.requestedAt) || 0;
          const bTime = Date.parse(b.requestedAt) || 0;
          return bTime - aTime;
        });
      }

      function has(type, id) {
        return map.has(fileKey(type, id));
      }

      function get(type, id) {
        return map.get(fileKey(type, id)) || null;
      }

      function markRequested(item, payload = {}) {
        const entry = normalizeEntry({
          ...item,
          requestedAt: new Date().toISOString(),
          fileName: payload.fileName || payload.filename || payload.name || item.fileName || ''
        });
        if (!entry) return null;
        map.set(entry.key, entry);
        persist();
        return entry;
      }

      function remove(type, id) {
        const removed = map.delete(fileKey(type, id));
        if (removed) persist();
        return removed;
      }

      function clear() {
        map.clear();
        storage.clearHistory();
      }

      function countForLevel(level) {
        const target = String(level);
        return [...map.values()].filter((entry) => String(entry.level) === target).length;
      }

      function latest() {
        return list()[0] || null;
      }

      persist();

      return {
        has,
        get,
        list,
        size() {
          return map.size;
        },
        countForLevel,
        latest,
        markRequested,
        remove,
        clear,
        persist
      };
    }

    module.exports = { createHistoryStore, normalizeEntry };
  },
  "i18n.js": function(module, exports, require) {
    'use strict';

    const { CONFIG } = require('./config');

    const DICTIONARIES = Object.freeze({
      ko: Object.freeze({
        'app.title': 'Starlight 난이도 다운로더',
        'app.language': '언어',
        'app.level': '레벨',
        'app.loading': '불러오는 중…',
        'app.requiredPage': '이 도구는 BMS Library의 Songs 페이지에서 실행해야 합니다.',
        'app.openRequiredPage': 'Songs 페이지를 연 뒤 북마크를 다시 실행해 주세요.',
        'app.loadFailureTitle': 'Starlight 난이도 다운로더 실행 실패',
        'app.verifySongsPage': 'BMS Library Songs 페이지가 정상적으로 열리는지 확인해 주세요.',

        'button.searchLevel': '이 레벨 검색',
        'button.searchSpecificLevel': 'sr{level} 검색',
        'button.selectMatched': '높은 확률 선택',
        'button.queueSelected': '선택 → 대기열',
        'button.exportCsv': '검색 결과 CSV',
        'button.stopSearch': '검색 중지',
        'button.close': '닫기',
        'button.runQueue': '대기열 다운로드 / 재개',
        'button.processing': '다운로드 처리 중…',
        'button.resumeAfterLimit': '제한 초기화 후 재개',
        'button.clearQueue': '대기열 비우기',
        'button.history': '다운로드 이력',
        'button.exportHistory': '이력 CSV 저장',
        'button.clearHistory': '이력 전체 삭제',
        'button.retry': '다시 받기',
        'button.removeRecord': '기록 삭제',

        'filter.all': '전체',
        'filter.matched': '높은 확률',
        'filter.review': '검토',
        'filter.missing': '미매칭',
        'filter.requested': '요청 완료',

        'queue.title': '다운로드 대기열',
        'queue.batchPrefix': '한 번에',
        'queue.batchSuffix': '개',
        'queue.pendingCount': '{count}개 대기',
        'queue.historyCount': '요청 이력 {count}개',
        'queue.empty': '대기열이 비어 있습니다.',
        'queue.saved': '대기열과 진행 상황은 페이지를 닫아도 저장됩니다.',
        'queue.nextItem': '다음 파일: sr{level} {title}',
        'queue.added': '{added}개를 대기열에 추가했습니다.',
        'queue.addedWithSkips': '{added}개 추가 · 이미 요청 완료 {requested}개 · 대기열 중복 {queued}개 건너뜀',
        'queue.nothingAdded': '새로 추가할 파일이 없습니다. 이미 대기열에 있거나 요청 완료된 파일입니다.',
        'queue.selectFirst': '먼저 받을 채보를 선택해 주세요.',
        'queue.cleared': '대기열을 비웠습니다.',
        'queue.restored': '이전 대기열 {pending}개와 요청 이력 {history}개를 복원했습니다.',
        'queue.pruned': '요청 완료 이력과 겹친 대기열 {count}개를 자동으로 건너뛰었습니다.',
        'queue.downloadStarting': '다운로드 요청을 시작합니다. 브라우저가 여러 파일 허용 여부를 물으면 허용해 주세요.',
        'queue.processingItem': '이번 배치 {current}/{target}: sr{level} {title}',
        'queue.batchComplete': '이번 배치 {completed}개 요청 완료 · {remaining}개 남음. 다음 배치는 재개 버튼을 누르세요.',
        'queue.allComplete': '대기열 {completed}개를 모두 브라우저로 전달했습니다.',
        'queue.skippedCompleted': '이미 요청 완료된 {count}개를 건너뛰고 다음 파일부터 이어갑니다.',
        'queue.currentFailure': '다운로드 준비 실패: {error}. 현재 파일은 대기열 맨 앞에 유지했습니다.',
        'queue.limitBlocked': '현재 단기 제한 중입니다. {time} 이후 재개하세요.',
        'queue.limitReached': '서버 단기 제한에 도달했습니다. 현재 파일부터 대기열에 보존했습니다. {time} 이후 재개하세요.{today}',
        'queue.limitTodaySuffix': ' 오늘 잔여 {count}개',
        'queue.windowUsed': '이번 창의 허용량을 모두 사용했습니다. {time} 이후 재개하세요.',
        'queue.limitExpired': '제한 시간이 끝났습니다. 재개 버튼을 눌러 주세요.',
        'queue.lastRequested': '마지막 요청: sr{level} {title}',

        'rate.unknown': '서버 제한: 첫 다운로드 때 확인',
        'rate.blocked': '단기 제한 중 · {time} 초기화 · {remaining} 남음',
        'rate.remaining': '서버 잔여량 · 이번 창 {window} · 오늘 {today}',
        'rate.nextReset': '서버가 안내한 다음 초기화 시각',

        'status.loadingTable': '공식 난이도표를 읽는 중…',
        'status.tableLoaded': '공식표를 불러왔습니다. sr{level} 검색을 시작합니다.{restored}',
        'status.tableRestoredSuffix': ' 저장된 대기열 {queue}개와 이력 {history}개를 복원했습니다.',
        'status.noLevel': '공식표에서 sr{level} 항목을 찾지 못했습니다.',
        'status.levelConfirmed': '공식 sr{level} {count}개를 확인했습니다. 라이브 미러를 대조합니다.',
        'status.searching': 'sr{level} 검색 {current}/{total}: {title}',
        'status.searchStopped': 'sr{level} 검색을 중지했습니다. 현재까지 {count}개 결과는 사용할 수 있습니다.',
        'status.searchComplete': '완료: 공식 sr{level} {count}개 대조 결과입니다. 파일 이름을 확인한 뒤 대기열에 추가하세요.',
        'status.failure': '실패: {error}',
        'status.counts': 'sr{level} 전체 {total} · 높은 확률 {matched} · 검토 {review} · 미매칭 {missing} · 요청 완료 {requested}',

        'classification.matched': '높은 확률',
        'classification.review': '검토 권장',
        'classification.missing': '미매칭',
        'classification.fallbackOnly': '보조 링크만',

        'download.none': '미요청',
        'download.requested': '요청 완료',
        'download.partial': '{done}/{total} 요청 완료',
        'download.allRequested': '필요 파일 모두 요청 완료',
        'download.candidateRequested': '브라우저 전달 완료',
        'download.definition': '“요청 완료”는 서버가 다운로드 주소를 발급하고 파일을 브라우저에 전달한 상태입니다. 브라우저나 디스크에서 실제 저장이 끝났는지는 웹페이지가 확인할 수 없습니다.',

        'table.select': '선택',
        'table.index': '#',
        'table.chart': '채보',
        'table.artist': '아티스트',
        'table.songResults': '곡 본체 검색 결과',
        'table.sabunResults': '차분 검색 결과',
        'table.fallbacks': '보조 링크',
        'table.matchStatus': '매칭 상태',
        'table.downloadStatus': '다운로드 상태',
        'table.noResults': '검색 결과 없음',
        'table.none': '없음',
        'table.hash': 'SHA-256 {hash}…',
        'table.originalUrl': '난이도표 원래 주소',
        'table.openMayExpire': '열기(만료 가능)',
        'table.chartDiff': '차분',
        'table.candidateTooltip': '클릭하면 대기열에 추가하고 1개를 요청합니다 · 검색어: {query} · 점수 {score}',
        'table.requestedTooltip': '이미 요청 완료 이력에 있습니다. 다시 받으려면 다운로드 이력에서 “다시 받기”를 선택하세요.',

        'history.title': '다운로드 이력',
        'history.summary': '총 {count}개 · 최신 요청부터 표시',
        'history.empty': '저장된 다운로드 요청 이력이 없습니다.',
        'history.time': '요청 시각',
        'history.level': '레벨',
        'history.type': '종류',
        'history.titleColumn': '파일 / 곡',
        'history.id': '파일 ID',
        'history.actions': '작업',
        'history.song': '곡 본체',
        'history.sabun': '차분',
        'history.cleared': '다운로드 이력을 모두 삭제했습니다.',
        'history.recordRemoved': '요청 완료 기록을 삭제했습니다.',
        'history.retryQueued': '기록을 해제하고 파일을 대기열에 추가했습니다.',
        'history.exportName': 'starlight_download_history_{date}.csv',

        'confirm.clearQueue': '대기열 {count}개를 모두 비울까요?',
        'confirm.clearHistory': '요청 완료 이력 {count}개를 모두 삭제할까요? 이후 같은 파일이 중복 다운로드될 수 있습니다.',

        'csv.index': 'index',
        'csv.level': 'level',
        'csv.title': 'title',
        'csv.subtitle': 'subtitle',
        'csv.artist': 'artist',
        'csv.sha256': 'sha256',
        'csv.matchStatus': 'match_status',
        'csv.downloadStatus': 'download_status',
        'csv.songMatch': 'song_match',
        'csv.songFileId': 'song_file_id',
        'csv.songScore': 'song_score',
        'csv.sabunMatch': 'sabun_match',
        'csv.sabunFileId': 'sabun_file_id',
        'csv.sabunScore': 'sabun_score',
        'csv.fallbacks': 'fallbacks',
        'csv.tableUrl': 'table_url',
        'csv.tableDiffUrl': 'table_diff_url',

        'fallback.formatService': '{format} · {service}',
        'fallback.service': '{service}',
        'fallback.archiveMirror': '보존 미러 · {service}',
        'fallback.mainAndChart': '곡 본체+차분 · {service}',
        'fallback.chartOnly': '차분만 · {service}',
        'fallback.eventPackage': '이벤트 패키지 · {service}',

        'footer.notice': '모든 다운로드 요청은 순차 처리됩니다. 서버 제한이 발생하면 현재 파일부터 대기열에 보존하며, 이미 브라우저로 전달한 파일 ID는 이력에 기록해 다음 실행에서 자동으로 건너뜁니다.',

        'time.unknown': '알 수 없음',
        'time.hours': '{count}시간',
        'time.minutes': '{count}분',
        'time.seconds': '{count}초'
      }),

      ja: Object.freeze({
        'app.title': 'Starlight 難易度ダウンローダー',
        'app.language': '言語',
        'app.level': 'レベル',
        'app.loading': '読み込み中…',
        'app.requiredPage': 'このツールは BMS Library の Songs ページで実行してください。',
        'app.openRequiredPage': 'Songs ページを開いてから、ブックマークレットをもう一度実行してください。',
        'app.loadFailureTitle': 'Starlight 難易度ダウンローダーの起動に失敗しました',
        'app.verifySongsPage': 'BMS Library の Songs ページが正常に開けるか確認してください。',

        'button.searchLevel': 'このレベルを検索',
        'button.searchSpecificLevel': 'sr{level} を検索',
        'button.selectMatched': '高確度を選択',
        'button.queueSelected': '選択 → キュー',
        'button.exportCsv': '検索結果 CSV',
        'button.stopSearch': '検索を停止',
        'button.close': '閉じる',
        'button.runQueue': 'キューをダウンロード / 再開',
        'button.processing': 'ダウンロード処理中…',
        'button.resumeAfterLimit': '制限解除後に再開',
        'button.clearQueue': 'キューを空にする',
        'button.history': 'ダウンロード履歴',
        'button.exportHistory': '履歴を CSV 保存',
        'button.clearHistory': '履歴をすべて削除',
        'button.retry': '再ダウンロード',
        'button.removeRecord': '履歴を削除',

        'filter.all': 'すべて',
        'filter.matched': '高確度',
        'filter.review': '要確認',
        'filter.missing': '未一致',
        'filter.requested': '送信済み',

        'queue.title': 'ダウンロードキュー',
        'queue.batchPrefix': '1回に',
        'queue.batchSuffix': '件',
        'queue.pendingCount': '{count}件待機',
        'queue.historyCount': '送信履歴 {count}件',
        'queue.empty': 'キューは空です。',
        'queue.saved': 'キューと進行状況はページを閉じても保存されます。',
        'queue.nextItem': '次のファイル: sr{level} {title}',
        'queue.added': '{added}件をキューに追加しました。',
        'queue.addedWithSkips': '{added}件追加 · 送信済み {requested}件 · キュー重複 {queued}件をスキップ',
        'queue.nothingAdded': '追加できる新しいファイルがありません。すでにキュー内、または送信済みです。',
        'queue.selectFirst': '先にダウンロードする譜面を選択してください。',
        'queue.cleared': 'キューを空にしました。',
        'queue.restored': '以前のキュー {pending}件と送信履歴 {history}件を復元しました。',
        'queue.pruned': '送信済み履歴と重複するキュー {count}件を自動的にスキップしました。',
        'queue.downloadStarting': 'ダウンロード要求を開始します。複数ファイルの許可をブラウザーに求められた場合は許可してください。',
        'queue.processingItem': '今回 {current}/{target}: sr{level} {title}',
        'queue.batchComplete': '今回 {completed}件を送信 · 残り {remaining}件。次は再開ボタンを押してください。',
        'queue.allComplete': 'キューの {completed}件をすべてブラウザーへ送信しました。',
        'queue.skippedCompleted': '送信済み {count}件をスキップし、次のファイルから再開します。',
        'queue.currentFailure': 'ダウンロード準備に失敗: {error}。現在のファイルはキュー先頭に保持しました。',
        'queue.limitBlocked': '現在、短時間制限中です。{time} 以降に再開してください。',
        'queue.limitReached': 'サーバーの短時間制限に達しました。現在のファイル以降をキューに保存しました。{time} 以降に再開してください。{today}',
        'queue.limitTodaySuffix': ' 本日の残り {count}件',
        'queue.windowUsed': '今回の許容量を使い切りました。{time} 以降に再開してください。',
        'queue.limitExpired': '制限時間が終了しました。再開ボタンを押してください。',
        'queue.lastRequested': '最後の送信: sr{level} {title}',

        'rate.unknown': 'サーバー制限: 最初のダウンロード時に確認',
        'rate.blocked': '短時間制限中 · {time} に解除 · 残り {remaining}',
        'rate.remaining': 'サーバー残数 · 今回 {window} · 本日 {today}',
        'rate.nextReset': 'サーバーが案内した次の解除時刻',

        'status.loadingTable': '公式難易度表を読み込み中…',
        'status.tableLoaded': '公式表を読み込みました。sr{level} の検索を開始します。{restored}',
        'status.tableRestoredSuffix': ' 保存済みキュー {queue}件と履歴 {history}件を復元しました。',
        'status.noLevel': '公式表に sr{level} の項目が見つかりません。',
        'status.levelConfirmed': '公式 sr{level} の {count}譜面を確認しました。ライブミラーと照合します。',
        'status.searching': 'sr{level} 検索 {current}/{total}: {title}',
        'status.searchStopped': 'sr{level} の検索を停止しました。現在までの {count}件は利用できます。',
        'status.searchComplete': '完了: 公式 sr{level} {count}件の照合結果です。ファイル名を確認してキューへ追加してください。',
        'status.failure': '失敗: {error}',
        'status.counts': 'sr{level} 全{total} · 高確度 {matched} · 要確認 {review} · 未一致 {missing} · 送信済み {requested}',

        'classification.matched': '高確度',
        'classification.review': '要確認',
        'classification.missing': '未一致',
        'classification.fallbackOnly': '補助リンクのみ',

        'download.none': '未送信',
        'download.requested': '送信済み',
        'download.partial': '{done}/{total} 送信済み',
        'download.allRequested': '必要ファイルをすべて送信済み',
        'download.candidateRequested': 'ブラウザーへ送信済み',
        'download.definition': '「送信済み」は、サーバーがダウンロード URL を発行し、ファイルをブラウザーへ渡した状態です。ブラウザーまたはディスクで保存が完了したかどうかは、このページから確認できません。',

        'table.select': '選択',
        'table.index': '#',
        'table.chart': '譜面',
        'table.artist': 'アーティスト',
        'table.songResults': '本体検索結果',
        'table.sabunResults': '差分検索結果',
        'table.fallbacks': '補助リンク',
        'table.matchStatus': '一致状態',
        'table.downloadStatus': 'ダウンロード状態',
        'table.noResults': '検索結果なし',
        'table.none': 'なし',
        'table.hash': 'SHA-256 {hash}…',
        'table.originalUrl': '難易度表の元 URL',
        'table.openMayExpire': '開く（失効の可能性あり）',
        'table.chartDiff': '差分',
        'table.candidateTooltip': 'クリックするとキューに追加し、1件を要求します · 検索語: {query} · スコア {score}',
        'table.requestedTooltip': 'すでに送信履歴にあります。再取得する場合はダウンロード履歴から「再ダウンロード」を選択してください。',

        'history.title': 'ダウンロード履歴',
        'history.summary': '合計 {count}件 · 新しい順',
        'history.empty': '保存されたダウンロード要求履歴はありません。',
        'history.time': '送信日時',
        'history.level': 'レベル',
        'history.type': '種類',
        'history.titleColumn': 'ファイル / 曲',
        'history.id': 'ファイル ID',
        'history.actions': '操作',
        'history.song': '曲本体',
        'history.sabun': '差分',
        'history.cleared': 'ダウンロード履歴をすべて削除しました。',
        'history.recordRemoved': '送信済み履歴を削除しました。',
        'history.retryQueued': '履歴を解除し、ファイルをキューに追加しました。',
        'history.exportName': 'starlight_download_history_{date}.csv',

        'confirm.clearQueue': 'キュー {count}件をすべて削除しますか？',
        'confirm.clearHistory': '送信履歴 {count}件をすべて削除しますか？ 以後、同じファイルが重複ダウンロードされる可能性があります。',

        'csv.index': 'index',
        'csv.level': 'level',
        'csv.title': 'title',
        'csv.subtitle': 'subtitle',
        'csv.artist': 'artist',
        'csv.sha256': 'sha256',
        'csv.matchStatus': 'match_status',
        'csv.downloadStatus': 'download_status',
        'csv.songMatch': 'song_match',
        'csv.songFileId': 'song_file_id',
        'csv.songScore': 'song_score',
        'csv.sabunMatch': 'sabun_match',
        'csv.sabunFileId': 'sabun_file_id',
        'csv.sabunScore': 'sabun_score',
        'csv.fallbacks': 'fallbacks',
        'csv.tableUrl': 'table_url',
        'csv.tableDiffUrl': 'table_diff_url',

        'fallback.formatService': '{format} · {service}',
        'fallback.service': '{service}',
        'fallback.archiveMirror': '保存ミラー · {service}',
        'fallback.mainAndChart': '本体+差分 · {service}',
        'fallback.chartOnly': '差分のみ · {service}',
        'fallback.eventPackage': 'イベントパッケージ · {service}',

        'footer.notice': 'ダウンロード要求はすべて順番に処理されます。サーバー制限が発生した場合は現在のファイル以降をキューに保存し、すでにブラウザーへ送信したファイル ID は履歴に記録して次回自動的にスキップします。',

        'time.unknown': '不明',
        'time.hours': '{count}時間',
        'time.minutes': '{count}分',
        'time.seconds': '{count}秒'
      }),

      en: Object.freeze({
        'app.title': 'Starlight Difficulty Downloader',
        'app.language': 'Language',
        'app.level': 'Level',
        'app.loading': 'Loading…',
        'app.requiredPage': 'Run this tool on the BMS Library Songs page.',
        'app.openRequiredPage': 'Open the Songs page, then run the bookmarklet again.',
        'app.loadFailureTitle': 'Starlight Difficulty Downloader failed to start',
        'app.verifySongsPage': 'Make sure the BMS Library Songs page opens correctly.',

        'button.searchLevel': 'Search this level',
        'button.searchSpecificLevel': 'Search sr{level}',
        'button.selectMatched': 'Select high confidence',
        'button.queueSelected': 'Selection → Queue',
        'button.exportCsv': 'Search results CSV',
        'button.stopSearch': 'Stop search',
        'button.close': 'Close',
        'button.runQueue': 'Download queue / Resume',
        'button.processing': 'Processing downloads…',
        'button.resumeAfterLimit': 'Resume after reset',
        'button.clearQueue': 'Clear queue',
        'button.history': 'Download history',
        'button.exportHistory': 'Export history CSV',
        'button.clearHistory': 'Clear all history',
        'button.retry': 'Download again',
        'button.removeRecord': 'Remove record',

        'filter.all': 'All',
        'filter.matched': 'High confidence',
        'filter.review': 'Review',
        'filter.missing': 'No match',
        'filter.requested': 'Requested',

        'queue.title': 'Download queue',
        'queue.batchPrefix': 'Batch',
        'queue.batchSuffix': 'files',
        'queue.pendingCount': '{count} pending',
        'queue.historyCount': '{count} requested',
        'queue.empty': 'The queue is empty.',
        'queue.saved': 'The queue and progress remain saved after the page is closed.',
        'queue.nextItem': 'Next file: sr{level} {title}',
        'queue.added': 'Added {added} files to the queue.',
        'queue.addedWithSkips': 'Added {added} · skipped {requested} already requested · skipped {queued} queue duplicates',
        'queue.nothingAdded': 'There are no new files to add. They are already queued or recorded as requested.',
        'queue.selectFirst': 'Select the charts you want to download first.',
        'queue.cleared': 'The queue was cleared.',
        'queue.restored': 'Restored {pending} queued files and {history} requested files.',
        'queue.pruned': 'Automatically skipped {count} queued files already present in request history.',
        'queue.downloadStarting': 'Starting download requests. Allow multiple file downloads if your browser asks.',
        'queue.processingItem': 'Batch {current}/{target}: sr{level} {title}',
        'queue.batchComplete': 'Requested {completed} in this batch · {remaining} remaining. Press Resume for the next batch.',
        'queue.allComplete': 'Sent all {completed} queued files to the browser.',
        'queue.skippedCompleted': 'Skipped {count} already requested files and resumed from the next item.',
        'queue.currentFailure': 'Could not prepare the download: {error}. The current file remains at the front of the queue.',
        'queue.limitBlocked': 'A short-term limit is active. Resume after {time}.',
        'queue.limitReached': 'The server short-term limit was reached. The current and remaining files stay in the queue. Resume after {time}.{today}',
        'queue.limitTodaySuffix': ' {count} requests remain today.',
        'queue.windowUsed': 'This window’s allowance has been used. Resume after {time}.',
        'queue.limitExpired': 'The limit window has reset. Press Resume to continue.',
        'queue.lastRequested': 'Last requested: sr{level} {title}',

        'rate.unknown': 'Server limit: checked on first download',
        'rate.blocked': 'Short-term limit · resets {time} · {remaining} remaining',
        'rate.remaining': 'Server allowance · window {window} · today {today}',
        'rate.nextReset': 'the next reset time reported by the server',

        'status.loadingTable': 'Loading the official difficulty table…',
        'status.tableLoaded': 'Official table loaded. Starting the sr{level} search.{restored}',
        'status.tableRestoredSuffix': ' Restored {queue} queued files and {history} history records.',
        'status.noLevel': 'No sr{level} entries were found in the official table.',
        'status.levelConfirmed': 'Found {count} official sr{level} charts. Comparing live mirror results.',
        'status.searching': 'Searching sr{level} {current}/{total}: {title}',
        'status.searchStopped': 'Stopped the sr{level} search. The {count} results found so far remain available.',
        'status.searchComplete': 'Done: {count} official sr{level} charts were compared. Verify file names before adding them to the queue.',
        'status.failure': 'Failed: {error}',
        'status.counts': 'sr{level} total {total} · high confidence {matched} · review {review} · no match {missing} · requested {requested}',

        'classification.matched': 'High confidence',
        'classification.review': 'Review recommended',
        'classification.missing': 'No match',
        'classification.fallbackOnly': 'Fallback link only',

        'download.none': 'Not requested',
        'download.requested': 'Requested',
        'download.partial': '{done}/{total} requested',
        'download.allRequested': 'All required files requested',
        'download.candidateRequested': 'Sent to browser',
        'download.definition': '“Requested” means the server issued a download URL and the file was handed to the browser. A web page cannot verify that the browser or disk finished saving it.',

        'table.select': 'Select',
        'table.index': '#',
        'table.chart': 'Chart',
        'table.artist': 'Artist',
        'table.songResults': 'Song package results',
        'table.sabunResults': 'Chart patch results',
        'table.fallbacks': 'Fallback links',
        'table.matchStatus': 'Match status',
        'table.downloadStatus': 'Download status',
        'table.noResults': 'No search results',
        'table.none': 'None',
        'table.hash': 'SHA-256 {hash}…',
        'table.originalUrl': 'Original table URL',
        'table.openMayExpire': 'Open (may be expired)',
        'table.chartDiff': 'Chart patch',
        'table.candidateTooltip': 'Click to add this candidate to the queue and request one file · query: {query} · score {score}',
        'table.requestedTooltip': 'This file is already in request history. Choose “Download again” in Download history to retry it.',

        'history.title': 'Download history',
        'history.summary': '{count} total · newest first',
        'history.empty': 'No saved download request history.',
        'history.time': 'Requested at',
        'history.level': 'Level',
        'history.type': 'Type',
        'history.titleColumn': 'File / Song',
        'history.id': 'File ID',
        'history.actions': 'Actions',
        'history.song': 'Song package',
        'history.sabun': 'Chart patch',
        'history.cleared': 'All download history was cleared.',
        'history.recordRemoved': 'The requested-file record was removed.',
        'history.retryQueued': 'Removed the record and added the file back to the queue.',
        'history.exportName': 'starlight_download_history_{date}.csv',

        'confirm.clearQueue': 'Clear all {count} files from the queue?',
        'confirm.clearHistory': 'Clear all {count} requested-file records? The same files may be downloaded again afterward.',

        'csv.index': 'index',
        'csv.level': 'level',
        'csv.title': 'title',
        'csv.subtitle': 'subtitle',
        'csv.artist': 'artist',
        'csv.sha256': 'sha256',
        'csv.matchStatus': 'match_status',
        'csv.downloadStatus': 'download_status',
        'csv.songMatch': 'song_match',
        'csv.songFileId': 'song_file_id',
        'csv.songScore': 'song_score',
        'csv.sabunMatch': 'sabun_match',
        'csv.sabunFileId': 'sabun_file_id',
        'csv.sabunScore': 'sabun_score',
        'csv.fallbacks': 'fallbacks',
        'csv.tableUrl': 'table_url',
        'csv.tableDiffUrl': 'table_diff_url',

        'fallback.formatService': '{format} · {service}',
        'fallback.service': '{service}',
        'fallback.archiveMirror': 'Archive mirror · {service}',
        'fallback.mainAndChart': 'Song + chart patch · {service}',
        'fallback.chartOnly': 'Chart patch only · {service}',
        'fallback.eventPackage': 'Event package · {service}',

        'footer.notice': 'All download requests run sequentially. If the server limit is reached, the current and remaining files stay queued. File IDs already sent to the browser are recorded and automatically skipped on the next run.',

        'time.unknown': 'Unknown',
        'time.hours': '{count}h',
        'time.minutes': '{count}m',
        'time.seconds': '{count}s'
      })
    });

    function normalizeLanguage(value) {
      const language = String(value || '').toLowerCase().split(/[-_]/)[0];
      return CONFIG.supportedLanguages.includes(language) ? language : 'en';
    }

    function detectLanguage(savedLanguage, navigatorLanguage) {
      if (savedLanguage) return normalizeLanguage(savedLanguage);
      return normalizeLanguage(navigatorLanguage || (typeof navigator !== 'undefined' ? navigator.language : 'en'));
    }

    function interpolate(template, variables = {}) {
      return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
        Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match
      ));
    }

    function createTranslator(initialLanguage) {
      let language = normalizeLanguage(initialLanguage);

      return {
        get language() {
          return language;
        },
        setLanguage(nextLanguage) {
          language = normalizeLanguage(nextLanguage);
          return language;
        },
        t(key, variables) {
          const dictionary = DICTIONARIES[language] || DICTIONARIES.en;
          const template = dictionary[key] ?? DICTIONARIES.en[key] ?? key;
          return interpolate(template, variables);
        },
        locale() {
          if (language === 'ko') return 'ko-KR';
          if (language === 'ja') return 'ja-JP';
          return 'en-US';
        }
      };
    }

    module.exports = {
      DICTIONARIES,
      normalizeLanguage,
      detectLanguage,
      interpolate,
      createTranslator
    };
  },
  "main.js": function(module, exports, require) {
    'use strict';

    const { start } = require('./app');

    start().catch((error) => {
      console.error('[Starlight Difficulty Downloader]', error);
    });
  },
  "matcher.js": function(module, exports, require) {
    'use strict';

    const { CONFIG, DIRECT_FALLBACKS } = require('./config');
    const {
      normalize,
      stripDifficulty,
      archiveStem,
      unique,
      sleep,
      fileKey
    } = require('./utils');

    function buildQueries(chart) {
      const fullTitle = [chart.title, chart.subtitle].filter(Boolean).join(' ').trim();
      const stripped = stripDifficulty(chart.title);
      const stem = archiveStem(chart.url);
      const stemDiff = archiveStem(chart.url_diff);
      const artist = String(chart.artist || '').replace(/\s*(?:feat\.|vs\.|\/).*$/i, '').trim();
      const titleBeforeBracket = String(chart.title || '').split(/[\[【（(]/)[0].trim();
      const values = [stem, fullTitle, chart.title, stripped, titleBeforeBracket, stemDiff];
      if (normalize(stripped).length <= 2 && artist) values.push(`${stripped} ${artist}`);
      return unique(values).slice(0, 5);
    }

    function itemDisplay(item) {
      const title = item?.title ? `${item.title}${item.subtitle ? ` ${item.subtitle}` : ''}` : '';
      return title || item?.name || item?.path || '(unnamed)';
    }

    function itemText(item) {
      return [item?.title, item?.subtitle, item?.name, item?.path, item?.artist].filter(Boolean).join(' ');
    }

    function scoreItem(item, chart, query) {
      const target = normalize(itemText(item));
      const display = normalize(itemDisplay(item));
      const q = normalize(query);
      const fullTitle = normalize([chart.title, chart.subtitle].filter(Boolean).join(' '));
      const title = normalize(chart.title);
      const stripped = normalize(stripDifficulty(chart.title));
      const stem = normalize(archiveStem(chart.url));
      const artist = normalize(chart.artist);
      let score = 0;

      if (q && display === q) score += 120;
      else if (q && target.includes(q)) score += 70;
      else if (q && q.includes(display) && display.length >= 4) score += 50;

      if (stem && target.includes(stem)) score += 100;
      if (fullTitle && target.includes(fullTitle)) score += 80;
      if (title && target.includes(title)) score += 70;
      if (stripped && stripped.length >= 3 && target.includes(stripped)) score += 55;
      if (artist && target.includes(artist)) score += 12;

      const chartTokens = new Set((stripped || title).match(/[\p{L}\p{N}]{2,}/gu) || []);
      const itemTokens = new Set(target.match(/[\p{L}\p{N}]{2,}/gu) || []);
      let overlap = 0;
      for (const token of chartTokens) if (itemTokens.has(token)) overlap += 1;
      score += Math.min(20, overlap * 5);

      return score;
    }

    function classify(score) {
      if (score >= 120) return { key: 'matched', className: 'ok', labelKey: 'classification.matched' };
      if (score >= 75) return { key: 'review', className: 'warn', labelKey: 'classification.review' };
      return { key: 'missing', className: 'bad', labelKey: 'classification.missing' };
    }

    function getFallbacks(chart) {
      const title = normalize(stripDifficulty(chart.title));
      return DIRECT_FALLBACKS.filter((entry) => {
        const key = normalize(entry.title);
        return title === key || normalize(chart.title) === key;
      });
    }

    function bestAvailable(result) {
      const candidates = [];
      if (result?.song?.matches?.[0]) candidates.push({ type: 'song', ...result.song.matches[0] });
      if (result?.sabun?.matches?.[0]) candidates.push({ type: 'sabun', ...result.sabun.matches[0] });
      return candidates.sort((a, b) => b.score - a.score)[0] || null;
    }

    function scoreForResult(result) {
      const songScore = Number(result?.song?.matches?.[0]?.score) || 0;
      const sabunScore = Number(result?.sabun?.matches?.[0]?.score) || 0;
      return result?.chart?.url_diff
        ? Math.min(songScore, sabunScore)
        : Math.max(songScore, sabunScore);
    }

    function selectionItemsForResult(result) {
      const selections = [];
      const topSong = result?.song?.matches?.[0];
      const topSabun = result?.sabun?.matches?.[0];
      const chart = result?.chart || {};

      if (chart.url_diff && topSong?.item?.id && topSabun?.item?.id) {
        selections.push({
          type: 'song',
          id: String(topSong.item.id),
          title: String(chart.title || itemDisplay(topSong.item)),
          sourceName: itemDisplay(topSong.item),
          level: String(chart.level ?? '')
        });
        selections.push({
          type: 'sabun',
          id: String(topSabun.item.id),
          title: String(chart.title || itemDisplay(topSabun.item)),
          sourceName: itemDisplay(topSabun.item),
          level: String(chart.level ?? '')
        });
        return selections;
      }

      const top = bestAvailable(result);
      if (top?.item?.id) {
        selections.push({
          type: top.type,
          id: String(top.item.id),
          title: String(chart.title || itemDisplay(top.item)),
          sourceName: itemDisplay(top.item),
          level: String(chart.level ?? '')
        });
      }
      return selections;
    }

    function downloadCoverage(result, history) {
      const selections = selectionItemsForResult(result);
      const hasRequestedMatch = (type, matches) => (matches || []).some((match) => (
        match?.item?.id && history.has(type, match.item.id)
      ));
      const needsPatch = Boolean(result?.chart?.url_diff);
      const total = needsPatch ? 2 : (selections.length ? 1 : 0);
      const done = needsPatch
        ? Number(hasRequestedMatch('song', result?.song?.matches))
          + Number(hasRequestedMatch('sabun', result?.sabun?.matches))
        : Number(
          hasRequestedMatch('song', result?.song?.matches)
          || hasRequestedMatch('sabun', result?.sabun?.matches)
        );
      return {
        done,
        total,
        all: total > 0 && done === total,
        partial: done > 0 && done < total,
        selections
      };
    }

    async function findMatches(options) {
      const {
        api,
        chart,
        sourceType,
        maxQueries,
        isCancelled = () => false,
        delayMs = CONFIG.searchDelayMs
      } = options;

      const queries = buildQueries(chart).slice(0, maxQueries);
      const candidates = new Map();
      let lastError = '';

      for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
        const query = queries[queryIndex];
        if (isCancelled()) break;
        try {
          const items = await api.search(sourceType, query);
          if (isCancelled()) break;
          lastError = '';
          for (const item of items) {
            if (!item?.id) continue;
            const score = scoreItem(item, chart, query);
            const previous = candidates.get(String(item.id));
            if (!previous || score > previous.score) candidates.set(String(item.id), { item, score, query });
          }
          const best = [...candidates.values()].sort((a, b) => b.score - a.score)[0];
          if (best?.score >= 120) break;
        } catch (error) {
          lastError = error?.message || String(error);
        }
        if (delayMs > 0 && queryIndex < queries.length - 1 && !isCancelled()) await sleep(delayMs);
      }

      return {
        matches: [...candidates.values()]
          .sort((a, b) => b.score - a.score)
          .slice(0, CONFIG.maxCandidatesPerSource),
        error: lastError
      };
    }

    function candidateHistoryKey(type, match) {
      return match?.item?.id ? fileKey(type, match.item.id) : '';
    }

    module.exports = {
      buildQueries,
      itemDisplay,
      itemText,
      scoreItem,
      classify,
      getFallbacks,
      bestAvailable,
      scoreForResult,
      selectionItemsForResult,
      downloadCoverage,
      findMatches,
      candidateHistoryKey
    };
  },
  "queue.js": function(module, exports, require) {
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
  },
  "storage.js": function(module, exports, require) {
    'use strict';

    const { CONFIG } = require('./config');

    function createStorage(storageLike) {
      const backing = storageLike || (typeof localStorage !== 'undefined' ? localStorage : null);

      function readJson(key, fallback) {
        if (!backing) return fallback;
        try {
          const raw = backing.getItem(key);
          if (!raw) return fallback;
          const value = JSON.parse(raw);
          return value ?? fallback;
        } catch {
          return fallback;
        }
      }

      function writeJson(key, value) {
        if (!backing) return false;
        try {
          backing.setItem(key, JSON.stringify(value));
          return true;
        } catch {
          return false;
        }
      }

      function remove(key) {
        if (!backing) return false;
        try {
          backing.removeItem(key);
          return true;
        } catch {
          return false;
        }
      }

      function loadPrefs() {
        const current = readJson(CONFIG.storage.prefs, null);
        if (current && typeof current === 'object' && !Array.isArray(current)) return current;

        const legacy = readJson(CONFIG.storage.legacyPrefs, {});
        if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return {};

        const migrated = {
          selectedLevel: legacy.selectedLevel,
          batchSize: legacy.batchSize,
          blockedUntil: legacy.blockedUntil,
          rateInfo: legacy.rateInfo,
          language: legacy.language
        };
        writeJson(CONFIG.storage.prefs, migrated);
        return migrated;
      }

      function normalizeQueueItem(item) {
        if (!item || (item.type !== 'song' && item.type !== 'sabun') || item.id === undefined || item.id === null) return null;
        return {
          type: item.type,
          id: String(item.id),
          title: String(item.title || item.id),
          level: String(item.level ?? ''),
          sourceName: String(item.sourceName || ''),
          addedAt: item.addedAt || new Date().toISOString(),
          attempts: Number.isFinite(Number(item.attempts)) ? Number(item.attempts) : 0,
          lastAttemptAt: item.lastAttemptAt || null,
          lastError: item.lastError || ''
        };
      }

      function normalizeQueue(value) {
        if (!Array.isArray(value)) return [];
        const deduped = new Map();
        for (const rawItem of value) {
          const item = normalizeQueueItem(rawItem);
          if (!item) continue;
          const key = `${item.type}:${item.id}`;
          if (!deduped.has(key)) deduped.set(key, item);
        }
        return [...deduped.values()];
      }

      function loadQueue() {
        const current = readJson(CONFIG.storage.queue, null);
        if (Array.isArray(current)) return normalizeQueue(current);

        const legacy = readJson(CONFIG.storage.legacyQueue, []);
        const migrated = normalizeQueue(legacy);
        if (migrated.length) writeJson(CONFIG.storage.queue, migrated);
        return migrated;
      }

      function loadHistory() {
        const value = readJson(CONFIG.storage.history, []);
        return Array.isArray(value) ? value : [];
      }

      return {
        readJson,
        writeJson,
        remove,
        loadPrefs,
        savePrefs(value) {
          return writeJson(CONFIG.storage.prefs, value);
        },
        loadQueue,
        saveQueue(value) {
          return writeJson(CONFIG.storage.queue, normalizeQueue(value));
        },
        loadHistory,
        saveHistory(value) {
          return writeJson(CONFIG.storage.history, Array.isArray(value) ? value : []);
        },
        clearQueue() {
          return writeJson(CONFIG.storage.queue, []);
        },
        clearHistory() {
          return writeJson(CONFIG.storage.history, []);
        }
      };
    }

    module.exports = { createStorage };
  },
  "styles.js": function(module, exports, require) {
    'use strict';

    function buildStyles(panelId) {
      return `
        #${panelId}{position:fixed;z-index:2147483647;inset:2vh 1.5vw;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.62);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","Noto Sans JP",sans-serif;display:flex;flex-direction:column;overflow:hidden;text-align:left}
        #${panelId} *{box-sizing:border-box}
        #${panelId} header{padding:12px 14px;background:#0b1220;border-bottom:1px solid #374151;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        #${panelId} h2{font-size:17px;line-height:1.25;margin:0 4px 0 0;white-space:nowrap;color:#f9fafb}
        #${panelId} .grow{flex:1}
        #${panelId} button,#${panelId} a.sld-action,#${panelId} select{font:inherit;color:#f9fafb;background:#1f2937;border:1px solid #4b5563;border-radius:8px;padding:7px 9px;text-decoration:none;cursor:pointer;line-height:1.2}
        #${panelId} button,#${panelId} a.sld-action{display:inline-flex;align-items:center;justify-content:center;gap:5px}
        #${panelId} select{padding-right:26px}
        #${panelId} button:hover,#${panelId} a.sld-action:hover{background:#374151}
        #${panelId} button:disabled,#${panelId} select:disabled{opacity:.45;cursor:not-allowed}
        #${panelId} .sld-primary{background:#2563eb!important;border-color:#3b82f6!important}
        #${panelId} .sld-danger{background:#7f1d1d!important;border-color:#991b1b!important}
        #${panelId} .sld-language-wrap{display:inline-flex;gap:6px;align-items:center;white-space:nowrap;margin-left:auto}
        #${panelId} .sld-statusbar,#${panelId} .sld-queuebar{padding:9px 14px;border-bottom:1px solid #374151;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#111827}
        #${panelId} .sld-queuebar{background:#0f172a}
        #${panelId} progress{width:min(420px,42vw);height:14px}
        #${panelId} .sld-filters{display:flex;gap:5px;flex-wrap:wrap}
        #${panelId} .sld-filter.sld-active{background:#4f46e5}
        #${panelId} .sld-tablewrap{overflow:auto;flex:1;min-height:0}
        #${panelId} table{width:100%;border-collapse:separate;border-spacing:0;min-width:1300px;color:#f9fafb;background:transparent}
        #${panelId} th{position:sticky;top:0;background:#0b1220;z-index:2;text-align:left;padding:9px;border-bottom:1px solid #4b5563;white-space:nowrap;color:#f9fafb;font-weight:700}
        #${panelId} td{padding:8px 9px;border-bottom:1px solid #263244;vertical-align:top;background:transparent;color:#f9fafb}
        #${panelId} tbody tr:hover td{background:#172033}
        #${panelId} .sld-muted{color:#9ca3af;font-size:12px}
        #${panelId} .sld-title{font-weight:650}
        #${panelId} .sld-pill{display:inline-block;border-radius:999px;padding:2px 7px;font-size:11px;white-space:nowrap;margin:0 4px 4px 0}
        #${panelId} .sld-pill.ok{background:#064e3b;color:#a7f3d0}
        #${panelId} .sld-pill.warn{background:#78350f;color:#fde68a}
        #${panelId} .sld-pill.bad{background:#7f1d1d;color:#fecaca}
        #${panelId} .sld-pill.info{background:#1e3a8a;color:#bfdbfe}
        #${panelId} .sld-pill.partial{background:#164e63;color:#a5f3fc}
        #${panelId} .sld-matchbtn{display:block!important;margin:0 0 5px;width:100%;text-align:left;justify-content:flex-start!important;max-width:370px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #${panelId} .sld-matchbtn.sld-requested{border-color:#047857;background:#064e3b}
        #${panelId} .sld-fallback{background:#164e63!important;border-color:#0e7490!important;margin:0 4px 5px 0}
        #${panelId} .sld-oldlink{color:#93c5fd}
        #${panelId} footer{padding:8px 14px;border-top:1px solid #374151;color:#9ca3af;background:#0b1220}
        #${panelId} .sld-error{color:#fca5a5;max-width:300px;word-break:break-word;margin-top:5px}
        #${panelId} .sld-rate-blocked{color:#fbbf24;font-weight:650}
        #${panelId} .sld-rate-ok{color:#a7f3d0}
        #${panelId} label.sld-inline{display:inline-flex;gap:6px;align-items:center;white-space:nowrap}
        #${panelId} .sld-queue-message{min-width:210px;max-width:620px}
        #${panelId} .sld-last-requested{max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #${panelId} .sld-history-overlay{position:absolute;inset:0;background:rgba(2,6,23,.86);z-index:20;display:flex;align-items:center;justify-content:center;padding:24px}
        #${panelId} .sld-history-overlay[hidden]{display:none}
        #${panelId} .sld-history-dialog{width:min(1100px,96%);max-height:88%;background:#111827;border:1px solid #4b5563;border-radius:14px;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.7);overflow:hidden}
        #${panelId} .sld-history-header{padding:13px 14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#0b1220;border-bottom:1px solid #374151}
        #${panelId} .sld-history-header h3{margin:0;font-size:17px;color:#f9fafb}
        #${panelId} .sld-history-body{overflow:auto;min-height:180px;max-height:65vh}
        #${panelId} .sld-history-body table{min-width:920px}
        #${panelId} .sld-history-note{padding:10px 14px;color:#cbd5e1;border-top:1px solid #374151;background:#0f172a}
        #${panelId} .sld-history-empty{padding:32px 18px;text-align:center;color:#9ca3af}
        #${panelId} .sld-history-actions{display:flex;gap:5px;flex-wrap:wrap}
        #${panelId} .sld-id{font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cbd5e1;word-break:break-all}
        @media (max-width:900px){
          #${panelId}{inset:1vh 1vw}
          #${panelId} header{align-items:flex-start}
          #${panelId} .sld-language-wrap{margin-left:0}
          #${panelId} progress{width:100%}
        }
      `;
    }

    module.exports = { buildStyles };
  },
  "ui.js": function(module, exports, require) {
    'use strict';

    const { CONFIG } = require('./config');
    const { buildStyles } = require('./styles');
    const {
      escapeHtml,
      formatLocalDate,
      formatRemaining
    } = require('./utils');
    const {
      itemDisplay,
      downloadCoverage,
      selectionItemsForResult
    } = require('./matcher');

    function createUi(options) {
      const {
        state,
        translator,
        history,
        handlers = {},
        config = CONFIG
      } = options;

      document.getElementById(config.panelId)?.remove();
      document.getElementById(`${config.panelId}-style`)?.remove();
      document.getElementById('starlight-level-downloader')?.remove();
      document.getElementById('starlight-level-downloader-style')?.remove();
      document.getElementById('starlight-sr10-live-finder')?.remove();
      document.getElementById('starlight-sr10-live-finder-style')?.remove();

      const style = document.createElement('style');
      style.id = `${config.panelId}-style`;
      style.textContent = buildStyles(config.panelId);
      document.head.appendChild(style);

      const panel = document.createElement('section');
      panel.id = config.panelId;
      panel.innerHTML = `
        <header>
          <h2 id="sld-title"></h2>
          <span class="sld-muted">v${escapeHtml(config.version)}</span>
          <label class="sld-inline"><strong id="sld-level-label"></strong><select id="sld-level" disabled><option></option></select></label>
          <button id="sld-load-level" class="sld-primary" disabled></button>
          <button id="sld-select-matched"></button>
          <button id="sld-queue-selected" class="sld-primary"></button>
          <button id="sld-export"></button>
          <button id="sld-stop" class="sld-danger"></button>
          <span class="grow"></span>
          <button id="sld-open-history"></button>
          <label class="sld-language-wrap"><span id="sld-language-label"></span><select id="sld-language" aria-label="Language"><option value="ko">한국어</option><option value="ja">日本語</option><option value="en">English</option></select></label>
          <button id="sld-close"></button>
        </header>
        <div class="sld-statusbar">
          <progress id="sld-progress" max="1" value="0"></progress>
          <strong id="sld-status"></strong>
          <span id="sld-counts" class="sld-muted"></span>
          <span class="grow"></span>
          <div class="sld-filters">
            <button class="sld-filter sld-active" data-filter="all"></button>
            <button class="sld-filter" data-filter="matched"></button>
            <button class="sld-filter" data-filter="review"></button>
            <button class="sld-filter" data-filter="missing"></button>
            <button class="sld-filter" data-filter="requested"></button>
          </div>
        </div>
        <div class="sld-queuebar">
          <strong id="sld-queue-title"></strong>
          <span id="sld-queue-count" class="sld-muted"></span>
          <span id="sld-history-count" class="sld-muted"></span>
          <label class="sld-inline"><span id="sld-batch-prefix"></span><select id="sld-batch-size">${config.allowedBatchSizes.map((size) => `<option value="${size}">${size}</option>`).join('')}</select><span id="sld-batch-suffix"></span></label>
          <button id="sld-run-queue" class="sld-primary"></button>
          <button id="sld-clear-queue"></button>
          <span id="sld-queue-message" class="sld-queue-message sld-muted"></span>
          <span class="grow"></span>
          <span id="sld-last-requested" class="sld-last-requested sld-muted"></span>
          <span id="sld-rate-status" class="sld-muted"></span>
        </div>
        <div class="sld-tablewrap">
          <table>
            <thead><tr>
              <th id="sld-th-select"></th>
              <th id="sld-th-index"></th>
              <th id="sld-chart-heading"></th>
              <th id="sld-th-artist"></th>
              <th id="sld-th-song"></th>
              <th id="sld-th-sabun"></th>
              <th id="sld-th-fallback"></th>
              <th id="sld-th-match"></th>
              <th id="sld-th-download"></th>
            </tr></thead>
            <tbody id="sld-body"></tbody>
          </table>
        </div>
        <footer id="sld-footer"></footer>
        <div id="sld-history-overlay" class="sld-history-overlay" hidden>
          <section class="sld-history-dialog" role="dialog" aria-modal="true" aria-labelledby="sld-history-title">
            <div class="sld-history-header">
              <h3 id="sld-history-title"></h3>
              <span id="sld-history-summary" class="sld-muted"></span>
              <span class="grow"></span>
              <button id="sld-export-history"></button>
              <button id="sld-clear-history" class="sld-danger"></button>
              <button id="sld-close-history"></button>
            </div>
            <div id="sld-history-body" class="sld-history-body"></div>
            <div id="sld-history-note" class="sld-history-note"></div>
          </section>
        </div>
      `;
      document.body.appendChild(panel);

      const get = (selector) => panel.querySelector(selector);
      const els = {
        title: get('#sld-title'),
        levelLabel: get('#sld-level-label'),
        level: get('#sld-level'),
        loadLevel: get('#sld-load-level'),
        selectMatched: get('#sld-select-matched'),
        queueSelected: get('#sld-queue-selected'),
        export: get('#sld-export'),
        stop: get('#sld-stop'),
        openHistory: get('#sld-open-history'),
        languageLabel: get('#sld-language-label'),
        language: get('#sld-language'),
        close: get('#sld-close'),
        progress: get('#sld-progress'),
        status: get('#sld-status'),
        counts: get('#sld-counts'),
        body: get('#sld-body'),
        chartHeading: get('#sld-chart-heading'),
        queueTitle: get('#sld-queue-title'),
        queueCount: get('#sld-queue-count'),
        historyCount: get('#sld-history-count'),
        batchPrefix: get('#sld-batch-prefix'),
        batchSize: get('#sld-batch-size'),
        batchSuffix: get('#sld-batch-suffix'),
        runQueue: get('#sld-run-queue'),
        clearQueue: get('#sld-clear-queue'),
        queueMessage: get('#sld-queue-message'),
        lastRequested: get('#sld-last-requested'),
        rateStatus: get('#sld-rate-status'),
        footer: get('#sld-footer'),
        historyOverlay: get('#sld-history-overlay'),
        historyTitle: get('#sld-history-title'),
        historySummary: get('#sld-history-summary'),
        historyBody: get('#sld-history-body'),
        historyNote: get('#sld-history-note'),
        exportHistory: get('#sld-export-history'),
        clearHistory: get('#sld-clear-history'),
        closeHistory: get('#sld-close-history'),
        tableHeadings: {
          select: get('#sld-th-select'),
          index: get('#sld-th-index'),
          artist: get('#sld-th-artist'),
          song: get('#sld-th-song'),
          sabun: get('#sld-th-sabun'),
          fallback: get('#sld-th-fallback'),
          match: get('#sld-th-match'),
          download: get('#sld-th-download')
        }
      };

      els.batchSize.value = String(state.batchSize);
      els.language.value = translator.language;

      function labelForFallback(fallback) {
        return translator.t(fallback.labelKey, {
          format: fallback.format || '',
          service: fallback.service || ''
        });
      }

      function rowMatchesFilter(result) {
        if (state.selectedFilter === 'all') return true;
        const coverage = downloadCoverage(result, history);
        if (state.selectedFilter === 'requested') return coverage.all;
        return result.classification?.key === state.selectedFilter;
      }

      function checkedRowIndexes() {
        const values = new Set();
        panel.querySelectorAll('tbody tr').forEach((tr) => {
          if (tr.querySelector('.sld-row-select')?.checked) values.add(Number(tr.dataset.rowIndex));
        });
        return values;
      }

      function candidateButtonHtml(match, type, rowIndex) {
        if (!match?.item?.id) return '';
        const name = itemDisplay(match.item);
        const requested = history.has(type, match.item.id);
        const title = requested
          ? translator.t('table.requestedTooltip')
          : translator.t('table.candidateTooltip', { query: match.query, score: match.score });
        const statusSuffix = requested ? ` · ✓ ${translator.t('download.candidateRequested')}` : '';
        return `<button class="sld-matchbtn${requested ? ' sld-requested' : ''}" data-download-type="${type}" data-file-id="${escapeHtml(match.item.id)}" data-row-index="${rowIndex}" title="${escapeHtml(title)}" ${requested ? 'disabled' : ''}>${escapeHtml(name)} <span class="sld-muted">(${match.score})${escapeHtml(statusSuffix)}</span></button>`;
      }

      function downloadStatusHtml(result) {
        const coverage = downloadCoverage(result, history);
        if (!coverage.total) return `<span class="sld-muted">${escapeHtml(translator.t('download.none'))}</span>`;
        if (coverage.all) return `<span class="sld-pill info">${escapeHtml(translator.t('download.allRequested'))}</span>`;
        if (coverage.partial) return `<span class="sld-pill partial">${escapeHtml(translator.t('download.partial', { done: coverage.done, total: coverage.total }))}</span>`;
        return `<span class="sld-muted">${escapeHtml(translator.t('download.none'))}</span>`;
      }

      function renderRow(index, checked = false) {
        const result = state.rows[index];
        if (!result) return;
        const chart = result.chart;
        const tr = document.createElement('tr');
        const coverage = downloadCoverage(result, history);
        const selections = selectionItemsForResult(result);
        const selectable = Boolean(selections.length && !coverage.all && result.classification?.key !== 'missing');
        tr.dataset.rowIndex = String(index);
        tr.dataset.status = result.classification?.key || 'missing';
        tr.dataset.requested = coverage.all ? 'true' : 'false';
        tr.hidden = !rowMatchesFilter(result);

        const songButtons = result.song.matches.map((match) => candidateButtonHtml(match, 'song', index)).join('');
        const sabunButtons = result.sabun.matches.map((match) => candidateButtonHtml(match, 'sabun', index)).join('');
        const fallbacks = result.fallbacks.map((fallback) => `<a class="sld-action sld-fallback" href="${escapeHtml(fallback.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(labelForFallback(fallback))}</a>`).join(' ');
        const official = chart.url
          ? `<details><summary class="sld-oldlink">${escapeHtml(translator.t('table.originalUrl'))}</summary><a class="sld-oldlink" href="${escapeHtml(chart.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(translator.t('table.openMayExpire'))}</a>${chart.url_diff ? ` · <a class="sld-oldlink" href="${escapeHtml(chart.url_diff)}" target="_blank" rel="noopener noreferrer">${escapeHtml(translator.t('table.chartDiff'))}</a>` : ''}</details>`
          : '';
        const errors = [result.song.error, result.sabun.error].filter(Boolean).join(' / ');
        const matchLabelKey = result.classification?.fallbackOnly
          ? 'classification.fallbackOnly'
          : result.classification?.labelKey || 'classification.missing';

        tr.innerHTML = `
          <td><input type="checkbox" class="sld-row-select" ${selectable ? '' : 'disabled'} ${checked && selectable ? 'checked' : ''}></td>
          <td>${index + 1}</td>
          <td><div class="sld-title">${escapeHtml(chart.title)}${chart.subtitle ? ` <span class="sld-muted">${escapeHtml(chart.subtitle)}</span>` : ''}</div><div class="sld-muted">${escapeHtml(translator.t('table.hash', { hash: String(chart.sha256 || '').slice(0, 12) }))}</div>${official}</td>
          <td>${escapeHtml(chart.artist || '')}</td>
          <td>${songButtons || `<span class="sld-muted">${escapeHtml(translator.t('table.noResults'))}</span>`}</td>
          <td>${sabunButtons || `<span class="sld-muted">${escapeHtml(translator.t('table.noResults'))}</span>`}</td>
          <td>${fallbacks || `<span class="sld-muted">${escapeHtml(translator.t('table.none'))}</span>`}</td>
          <td><span class="sld-pill ${escapeHtml(result.classification?.className || 'bad')}">${escapeHtml(translator.t(matchLabelKey))}</span>${errors ? `<div class="sld-error">${escapeHtml(errors)}</div>` : ''}</td>
          <td>${downloadStatusHtml(result)}</td>
        `;
        els.body.appendChild(tr);
      }

      function renderAllRows(options = {}) {
        const preserve = options.preserveSelection !== false;
        const checked = preserve ? checkedRowIndexes() : new Set();
        els.body.innerHTML = '';
        state.rows.forEach((_, index) => renderRow(index, checked.has(index)));
        renderCounts();
        refreshFilterButtons();
      }

      function renderCounts() {
        const stats = { matched: 0, review: 0, missing: 0, requested: 0 };
        for (const row of state.rows) {
          stats[row.classification?.key || 'missing'] += 1;
          if (downloadCoverage(row, history).all) stats.requested += 1;
        }
        els.counts.textContent = translator.t('status.counts', {
          level: state.selectedLevel,
          total: state.charts.length,
          matched: stats.matched,
          review: stats.review,
          missing: stats.missing,
          requested: stats.requested
        });
      }

      function refreshFilterButtons() {
        panel.querySelectorAll('.sld-filter').forEach((button) => {
          button.classList.toggle('sld-active', button.dataset.filter === state.selectedFilter);
        });
      }

      function refreshFilter() {
        panel.querySelectorAll('tbody tr').forEach((tr) => {
          const result = state.rows[Number(tr.dataset.rowIndex)];
          tr.hidden = result ? !rowMatchesFilter(result) : true;
        });
        refreshFilterButtons();
      }

      function renderRateStatus() {
        if (state.blockedUntil > Date.now()) {
          const remaining = formatRemaining(state.blockedUntil - Date.now(), translator);
          els.rateStatus.className = 'sld-rate-blocked';
          els.rateStatus.textContent = translator.t('rate.blocked', {
            time: formatLocalDate(state.blockedUntil, translator.locale(), translator.t('time.unknown')),
            remaining
          });
        } else if (state.rateInfo) {
          const windowText = state.rateInfo.remainingInWindow === null ? '?' : state.rateInfo.remainingInWindow;
          const todayText = state.rateInfo.remainingToday === null ? '?' : state.rateInfo.remainingToday;
          els.rateStatus.className = 'sld-rate-ok';
          els.rateStatus.textContent = translator.t('rate.remaining', { window: windowText, today: todayText });
        } else {
          els.rateStatus.className = 'sld-muted';
          els.rateStatus.textContent = translator.t('rate.unknown');
        }
      }

      function renderQueue() {
        els.queueCount.textContent = translator.t('queue.pendingCount', { count: state.downloadQueue.length });
        els.historyCount.textContent = translator.t('queue.historyCount', { count: history.size() });
        const nextItem = state.downloadQueue[0];
        const defaultQueueMessage = nextItem
          ? `${translator.t('queue.saved')} ${translator.t('queue.nextItem', { level: nextItem.level, title: nextItem.title })}`
          : translator.t('queue.empty');
        els.queueMessage.textContent = state.queueMessage || defaultQueueMessage;

        const latest = history.latest();
        els.lastRequested.textContent = latest
          ? translator.t('queue.lastRequested', { level: latest.level, title: latest.title })
          : '';
        els.lastRequested.title = latest?.sourceName || latest?.title || '';

        const blocked = state.blockedUntil > Date.now();
        els.runQueue.disabled = state.downloadRunning || !state.downloadQueue.length || blocked;
        els.clearQueue.disabled = state.downloadRunning || !state.downloadQueue.length;
        els.batchSize.disabled = state.downloadRunning;
        if (state.downloadRunning) els.runQueue.textContent = translator.t('button.processing');
        else if (blocked) els.runQueue.textContent = translator.t('button.resumeAfterLimit');
        else els.runQueue.textContent = translator.t('button.runQueue');
        renderRateStatus();
      }

      function renderHistory() {
        const entries = history.list();
        els.historySummary.textContent = translator.t('history.summary', { count: entries.length });
        els.clearHistory.disabled = entries.length === 0;
        els.exportHistory.disabled = entries.length === 0;

        if (!entries.length) {
          els.historyBody.innerHTML = `<div class="sld-history-empty">${escapeHtml(translator.t('history.empty'))}</div>`;
          return;
        }

        const rows = entries.map((entry) => `
          <tr>
            <td>${escapeHtml(formatLocalDate(entry.requestedAt, translator.locale(), translator.t('time.unknown')))}</td>
            <td>sr${escapeHtml(entry.level)}</td>
            <td>${escapeHtml(translator.t(entry.type === 'sabun' ? 'history.sabun' : 'history.song'))}</td>
            <td><div class="sld-title">${escapeHtml(entry.title)}</div>${entry.sourceName ? `<div class="sld-muted">${escapeHtml(entry.sourceName)}</div>` : ''}</td>
            <td><span class="sld-id">${escapeHtml(entry.id)}</span></td>
            <td><div class="sld-history-actions"><button data-history-action="retry" data-history-type="${entry.type}" data-history-id="${escapeHtml(entry.id)}">${escapeHtml(translator.t('button.retry'))}</button><button data-history-action="remove" data-history-type="${entry.type}" data-history-id="${escapeHtml(entry.id)}">${escapeHtml(translator.t('button.removeRecord'))}</button></div></td>
          </tr>
        `).join('');

        els.historyBody.innerHTML = `
          <table>
            <thead><tr><th>${escapeHtml(translator.t('history.time'))}</th><th>${escapeHtml(translator.t('history.level'))}</th><th>${escapeHtml(translator.t('history.type'))}</th><th>${escapeHtml(translator.t('history.titleColumn'))}</th><th>${escapeHtml(translator.t('history.id'))}</th><th>${escapeHtml(translator.t('history.actions'))}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        `;
      }

      function openHistory() {
        renderHistory();
        els.historyOverlay.hidden = false;
      }

      function closeHistory() {
        els.historyOverlay.hidden = true;
      }

      function updateTranslations() {
        els.title.textContent = translator.t('app.title');
        els.levelLabel.textContent = translator.t('app.level');
        els.loadLevel.textContent = translator.t('button.searchSpecificLevel', { level: els.level.value || state.selectedLevel });
        els.selectMatched.textContent = translator.t('button.selectMatched');
        els.queueSelected.textContent = translator.t('button.queueSelected');
        els.export.textContent = translator.t('button.exportCsv');
        els.stop.textContent = translator.t('button.stopSearch');
        els.openHistory.textContent = translator.t('button.history');
        els.languageLabel.textContent = translator.t('app.language');
        els.close.textContent = translator.t('button.close');
        els.language.value = translator.language;

        const filterKeys = { all: 'filter.all', matched: 'filter.matched', review: 'filter.review', missing: 'filter.missing', requested: 'filter.requested' };
        panel.querySelectorAll('.sld-filter').forEach((button) => {
          button.textContent = translator.t(filterKeys[button.dataset.filter]);
        });

        els.queueTitle.textContent = translator.t('queue.title');
        els.batchPrefix.textContent = translator.t('queue.batchPrefix');
        els.batchSuffix.textContent = translator.t('queue.batchSuffix');
        els.clearQueue.textContent = translator.t('button.clearQueue');

        els.tableHeadings.select.textContent = translator.t('table.select');
        els.tableHeadings.index.textContent = translator.t('table.index');
        els.chartHeading.textContent = `sr${state.selectedLevel} ${translator.t('table.chart')}`;
        els.tableHeadings.artist.textContent = translator.t('table.artist');
        els.tableHeadings.song.textContent = translator.t('table.songResults');
        els.tableHeadings.sabun.textContent = translator.t('table.sabunResults');
        els.tableHeadings.fallback.textContent = translator.t('table.fallbacks');
        els.tableHeadings.match.textContent = translator.t('table.matchStatus');
        els.tableHeadings.download.textContent = translator.t('table.downloadStatus');
        els.footer.textContent = translator.t('footer.notice');

        els.historyTitle.textContent = translator.t('history.title');
        els.exportHistory.textContent = translator.t('button.exportHistory');
        els.clearHistory.textContent = translator.t('button.clearHistory');
        els.closeHistory.textContent = translator.t('button.close');
        els.historyNote.textContent = translator.t('download.definition');

        renderQueue();
        renderAllRows();
        if (!els.historyOverlay.hidden) renderHistory();
      }

      function setLevels(levels, counts) {
        els.level.innerHTML = levels.map((level) => `<option value="${escapeHtml(level)}">sr${escapeHtml(level)} (${counts.get(level)})</option>`).join('');
        els.level.value = state.selectedLevel;
        els.level.disabled = false;
        els.loadLevel.disabled = false;
        els.loadLevel.textContent = translator.t('button.searchSpecificLevel', { level: state.selectedLevel });
      }

      function setSearchRunning(running) {
        els.stop.disabled = !running;
        if (running) {
          els.level.disabled = true;
          els.loadLevel.disabled = true;
        } else if (state.levels.length) {
          els.level.disabled = false;
          els.loadLevel.disabled = false;
        }
      }

      function setStatus(text) {
        els.status.textContent = text;
      }

      function setProgress(value, max) {
        if (max !== undefined) els.progress.max = Math.max(1, Number(max) || 1);
        els.progress.value = Math.max(0, Number(value) || 0);
      }

      function selectMatchedRows() {
        panel.querySelectorAll('tbody tr').forEach((tr) => {
          const checkbox = tr.querySelector('.sld-row-select');
          if (checkbox) checkbox.checked = !checkbox.disabled && tr.dataset.status === 'matched';
        });
      }

      function selectedRowIndexes() {
        return [...checkedRowIndexes()];
      }

      panel.addEventListener('click', (event) => {
        const filter = event.target.closest('.sld-filter');
        if (filter) {
          state.selectedFilter = filter.dataset.filter;
          refreshFilter();
          handlers.onFilterChange?.(state.selectedFilter);
          return;
        }

        const candidate = event.target.closest('[data-download-type][data-file-id]');
        if (candidate && !candidate.disabled) {
          handlers.onCandidate?.({
            type: candidate.dataset.downloadType,
            id: candidate.dataset.fileId,
            rowIndex: Number(candidate.dataset.rowIndex)
          });
        }
      });

      els.loadLevel.addEventListener('click', () => handlers.onSearchLevel?.(els.level.value));
      els.level.addEventListener('change', () => {
        els.loadLevel.textContent = translator.t('button.searchSpecificLevel', { level: els.level.value });
      });
      els.stop.addEventListener('click', () => handlers.onStopSearch?.());
      els.close.addEventListener('click', () => handlers.onClose?.());
      els.selectMatched.addEventListener('click', () => selectMatchedRows());
      els.queueSelected.addEventListener('click', () => handlers.onQueueSelected?.(selectedRowIndexes()));
      els.export.addEventListener('click', () => handlers.onExportSearch?.());
      els.batchSize.addEventListener('change', () => handlers.onBatchSizeChange?.(Number(els.batchSize.value)));
      els.runQueue.addEventListener('click', () => handlers.onRunQueue?.());
      els.clearQueue.addEventListener('click', () => {
        if (!state.downloadQueue.length) return;
        if (confirm(translator.t('confirm.clearQueue', { count: state.downloadQueue.length }))) handlers.onClearQueue?.();
      });
      els.openHistory.addEventListener('click', openHistory);
      els.closeHistory.addEventListener('click', closeHistory);
      els.historyOverlay.addEventListener('click', (event) => {
        if (event.target === els.historyOverlay) closeHistory();
      });
      els.language.addEventListener('change', () => handlers.onLanguageChange?.(els.language.value));
      els.exportHistory.addEventListener('click', () => handlers.onExportHistory?.());
      els.clearHistory.addEventListener('click', () => {
        const count = history.size();
        if (count && confirm(translator.t('confirm.clearHistory', { count }))) handlers.onClearHistory?.();
      });
      els.historyBody.addEventListener('click', (event) => {
        const button = event.target.closest('[data-history-action]');
        if (!button) return;
        const entry = history.get(button.dataset.historyType, button.dataset.historyId);
        if (entry) handlers.onHistoryAction?.(button.dataset.historyAction, entry);
      });

      updateTranslations();
      setStatus(translator.t('status.loadingTable'));
      setSearchRunning(false);

      return {
        panel,
        style,
        els,
        setLevels,
        setStatus,
        setProgress,
        setSearchRunning,
        renderRow,
        renderAllRows,
        renderCounts,
        renderQueue,
        renderHistory,
        refreshFilter,
        updateTranslations,
        openHistory,
        closeHistory,
        selectedRowIndexes,
        destroy() {
          panel.remove();
          style.remove();
        }
      };
    }

    module.exports = { createUi };
  },
  "utils.js": function(module, exports, require) {
    'use strict';

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function normalize(value) {
      return String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '');
    }

    function stripDifficulty(value) {
      let text = String(value ?? '').normalize('NFKC').trim();
      const labels = '(?:SP\\s*)?(?:BEGINNER|NORMAL|HYPER|ANOTHER|HARD|EASY|LIGHT|INSANE|EX|MX|HD|7K|14K|LN|BEGIN|BASIC|ADVANCED|EXPERT|HARDCORE|PRO)';
      const patterns = [
        new RegExp(`\\s*[\\[\\(（【]\\s*${labels}(?:\\s*\\d+)?\\s*[\\]\\)）】]\\s*$`, 'i'),
        new RegExp(`\\s*[-_～~]\\s*${labels}(?:\\s*\\d+)?\\s*[-_～~]?\\s*$`, 'i'),
        new RegExp(`\\s+${labels}(?:\\s*\\d+)?\\s*$`, 'i')
      ];

      for (let pass = 0; pass < 3; pass += 1) {
        const before = text;
        for (const pattern of patterns) text = text.replace(pattern, '').trim();
        if (text === before) break;
      }
      return text || String(value ?? '').trim();
    }

    function archiveStem(url, baseUrl = 'https://example.invalid/') {
      if (!url) return '';
      try {
        const parsed = new URL(url, baseUrl);
        let last = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
        last = last.replace(/\.(?:zip|rar|7z|lzh|tar|gz)$/i, '').trim();
        if (/^[A-Za-z0-9_-]{5,16}$/.test(last) && /(?:cncncloud|drive\.google)/i.test(parsed.hostname)) return '';
        return last;
      } catch {
        return '';
      }
    }

    function unique(values) {
      const seen = new Set();
      return values.filter((value) => {
        const trimmed = String(value ?? '').trim();
        const key = normalize(trimmed);
        if (!trimmed || !key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function levelSort(a, b) {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    }

    function fileKey(type, id) {
      return `${String(type)}:${String(id)}`;
    }

    function formatLocalDate(value, locale, unknownText) {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return unknownText;
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      }).format(date);
    }

    function formatRemaining(ms, translator) {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      const parts = [];
      if (hours > 0) parts.push(translator.t('time.hours', { count: hours }));
      if (minutes > 0 || hours > 0) parts.push(translator.t('time.minutes', { count: minutes }));
      parts.push(translator.t('time.seconds', { count: seconds }));
      return parts.join(' ');
    }

    function csvEscape(value) {
      return `"${String(value ?? '').replaceAll('"', '""')}"`;
    }

    function createCsv(rows) {
      return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    }

    function downloadTextFile(content, filename, mime = 'text/plain;charset=utf-8') {
      const blob = new Blob(['\uFEFF', content], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    module.exports = {
      sleep,
      escapeHtml,
      normalize,
      stripDifficulty,
      archiveStem,
      unique,
      levelSort,
      fileKey,
      formatLocalDate,
      formatRemaining,
      createCsv,
      downloadTextFile
    };
  }
  };
  const __cache = Object.create(null);

  function __resolve(parentId, request) {
    if (!request.startsWith('.')) return request.endsWith('.js') ? request : request + '.js';
    const base = parentId.split('/');
    base.pop();
    for (const part of request.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') base.pop();
      else base.push(part);
    }
    let resolved = base.join('/');
    if (!resolved.endsWith('.js')) resolved += '.js';
    return resolved;
  }

  function __require(request, parentId = '') {
    const id = parentId ? __resolve(parentId, request) : request;
    if (__cache[id]) return __cache[id].exports;
    const factory = __modules[id];
    if (!factory) throw new Error('Module not found: ' + id + (parentId ? ' (required by ' + parentId + ')' : ''));
    const module = { exports: {} };
    __cache[id] = module;
    factory(module, module.exports, (childRequest) => __require(childRequest, id));
    return module.exports;
  }

  __require('main.js');
})();
