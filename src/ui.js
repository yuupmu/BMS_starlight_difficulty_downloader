'use strict';

const { CONFIG } = require('./config');
const { buildStyles } = require('./styles');
const { formatLevel } = require('./tables');
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
const { chartInstallation } = require('./inventory');

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
      <label class="sld-inline"><strong id="sld-table-label"></strong><select id="sld-table"></select></label>
      <label class="sld-inline"><strong id="sld-level-label"></strong><select id="sld-level" disabled><option></option></select></label>
      <button id="sld-load-level" class="sld-primary" disabled></button>
      <button id="sld-refresh-level" disabled></button>
      <button id="sld-scan-library"></button>
      <input id="sld-library-files" type="file" webkitdirectory multiple hidden>
      <button id="sld-select-matched"></button>
      <button id="sld-select-uninstalled"></button>
      <button id="sld-clear-selection"></button>
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
      <span id="sld-library-status" class="sld-library-status sld-muted"></span>
      <span class="grow"></span>
      <div class="sld-filters">
        <button class="sld-filter sld-active" data-filter="all"></button>
        <button class="sld-filter" data-filter="pending"></button>
        <button class="sld-filter" data-filter="uninstalled"></button>
        <button class="sld-filter" data-filter="installed"></button>
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
      <label class="sld-inline"><span id="sld-batch-prefix"></span><select id="sld-batch-size">${config.allowedBatchSizes.map((size) => `<option value="${size}">${size}</option>`).join('')}<option value="${escapeHtml(config.safeBatchValue)}"></option></select><span id="sld-batch-suffix"></span></label>
      <button id="sld-download-folder"></button>
      <button id="sld-browser-downloads" hidden></button>
      <button id="sld-run-queue" class="sld-primary"></button>
      <button id="sld-stop-queue" class="sld-danger"></button>
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
          <th id="sld-th-local"></th>
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
    tableLabel: get('#sld-table-label'),
    table: get('#sld-table'),
    levelLabel: get('#sld-level-label'),
    level: get('#sld-level'),
    loadLevel: get('#sld-load-level'),
    refreshLevel: get('#sld-refresh-level'),
    scanLibrary: get('#sld-scan-library'),
    libraryFiles: get('#sld-library-files'),
    selectMatched: get('#sld-select-matched'),
    selectUninstalled: get('#sld-select-uninstalled'),
    clearSelection: get('#sld-clear-selection'),
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
    libraryStatus: get('#sld-library-status'),
    body: get('#sld-body'),
    chartHeading: get('#sld-chart-heading'),
    queueTitle: get('#sld-queue-title'),
    queueCount: get('#sld-queue-count'),
    historyCount: get('#sld-history-count'),
    batchPrefix: get('#sld-batch-prefix'),
    batchSize: get('#sld-batch-size'),
    downloadFolder: get('#sld-download-folder'),
    browserDownloads: get('#sld-browser-downloads'),
    batchSuffix: get('#sld-batch-suffix'),
    runQueue: get('#sld-run-queue'),
    stopQueue: get('#sld-stop-queue'),
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
      local: get('#sld-th-local'),
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
    const installation = chartInstallation(result.chart, state.libraryInventory);
    if (state.selectedFilter === 'installed') return installation.status === 'installed';
    if (state.selectedFilter === 'uninstalled') return installation.status !== 'installed';
    const coverage = downloadCoverage(result, history);
    if (state.selectedFilter === 'pending') return !coverage.all;
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

  function installationStatusHtml(chart) {
    const installation = chartInstallation(chart, state.libraryInventory);
    if (installation.status === 'installed') {
      const path = installation.entry?.path || '';
      return `<span class="sld-pill installed" title="${escapeHtml(path)}">${escapeHtml(translator.t('inventory.installed'))}</span>${path ? `<div class="sld-local-path" title="${escapeHtml(path)}">${escapeHtml(path)}</div>` : ''}`;
    }
    if (installation.status === 'uninstalled') {
      return `<span class="sld-pill bad">${escapeHtml(translator.t('inventory.uninstalled'))}</span>`;
    }
    if (installation.status === 'unknown') {
      return `<span class="sld-pill warn">${escapeHtml(translator.t('inventory.unknown'))}</span>`;
    }
    return `<span class="sld-muted">${escapeHtml(translator.t('inventory.notScanned'))}</span>`;
  }

  function renderRow(index, checked = false) {
    const result = state.rows[index];
    if (!result) return;
    const chart = result.chart;
    const tr = document.createElement('tr');
    const coverage = downloadCoverage(result, history);
    const installation = chartInstallation(chart, state.libraryInventory);
    const selections = selectionItemsForResult(result);
    const selectable = Boolean(
      selections.length
      && !coverage.all
      && installation.status !== 'installed'
      && result.classification?.key !== 'missing'
    );
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
      <td>${installationStatusHtml(chart)}</td>
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
    const stats = { matched: 0, review: 0, missing: 0, requested: 0, installed: 0 };
    for (const row of state.rows) {
      stats[row.classification?.key || 'missing'] += 1;
      if (downloadCoverage(row, history).all) stats.requested += 1;
      if (chartInstallation(row.chart, state.libraryInventory).status === 'installed') stats.installed += 1;
    }
    els.counts.textContent = translator.t('status.counts', {
      levelLabel: formatLevel(state.selectedTable, state.selectedLevel),
      total: state.charts.length,
      matched: stats.matched,
      review: stats.review,
      missing: stats.missing,
      requested: stats.requested,
      installed: stats.installed
    });
  }

  function refreshFilterButtons() {
    panel.querySelectorAll('.sld-filter').forEach((button) => {
      button.classList.toggle('sld-active', button.dataset.filter === state.selectedFilter);
      if (['installed', 'uninstalled'].includes(button.dataset.filter)) {
        button.disabled = !state.libraryInventory;
      }
    });
  }

  function renderLibraryStatus() {
    els.libraryStatus.textContent = state.libraryScanMessage || translator.t('inventory.notScannedSummary');
    els.scanLibrary.textContent = state.libraryScanRunning
      ? translator.t('button.stopLibraryScan')
      : state.libraryInventory
        ? translator.t('button.rescanLibrary')
        : translator.t('button.scanLibrary');
    els.scanLibrary.classList.toggle('sld-danger', state.libraryScanRunning);
    els.scanLibrary.disabled = state.downloadRunning && !state.libraryScanRunning;
    els.selectUninstalled.disabled = !state.libraryInventory;
    refreshFilterButtons();
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
      ? `${translator.t('queue.saved')} ${translator.t('queue.nextItem', { levelLabel: nextItem.levelLabel || `sr${nextItem.level}`, title: nextItem.title })}`
      : translator.t('queue.empty');
    els.queueMessage.textContent = state.queueMessage || defaultQueueMessage;

    const latest = history.latest();
    els.lastRequested.textContent = latest
      ? translator.t('queue.lastRequested', { levelLabel: latest.levelLabel || `sr${latest.level}`, title: latest.title })
      : '';
    els.lastRequested.title = latest?.sourceName || latest?.title || '';

    const blocked = state.blockedUntil > Date.now();
    els.runQueue.disabled = state.downloadRunning || state.libraryScanRunning || !state.downloadQueue.length || blocked;
    els.stopQueue.disabled = !state.downloadRunning;
    els.clearQueue.disabled = state.downloadRunning || !state.downloadQueue.length;
    els.batchSize.disabled = state.downloadRunning;
    els.downloadFolder.disabled = state.downloadRunning;
    els.downloadFolder.textContent = state.downloadDirectoryHandle
      ? translator.t('button.changeFolder', { name: state.downloadDirectoryHandle.name })
      : translator.t('button.chooseFolder');
    els.browserDownloads.hidden = !state.downloadDirectoryHandle;
    els.browserDownloads.disabled = state.downloadRunning;
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
        <td>${escapeHtml(entry.levelLabel || `sr${entry.level}`)}</td>
        <td>${escapeHtml(translator.t(entry.type === 'sabun' ? 'history.sabun' : 'history.song'))}</td>
        <td><div class="sld-title">${escapeHtml(entry.title)}</div>${entry.sourceName ? `<div class="sld-muted">${escapeHtml(entry.sourceName)}</div>` : ''}</td>
        <td><span class="sld-id">${escapeHtml(entry.id)}</span></td>
        <td><div class="sld-history-actions"><button data-history-action="retry" data-history-provider="${escapeHtml(entry.providerId)}" data-history-type="${entry.type}" data-history-id="${escapeHtml(entry.id)}">${escapeHtml(translator.t('button.retry'))}</button><button data-history-action="remove" data-history-provider="${escapeHtml(entry.providerId)}" data-history-type="${entry.type}" data-history-id="${escapeHtml(entry.id)}">${escapeHtml(translator.t('button.removeRecord'))}</button></div></td>
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
    els.tableLabel.textContent = translator.t('app.table');
    els.levelLabel.textContent = translator.t('app.level');
    els.loadLevel.textContent = translator.t('button.searchSpecificLevel', {
      levelLabel: formatLevel(state.selectedTable, els.level.value || state.selectedLevel)
    });
    els.refreshLevel.textContent = translator.t('button.refreshSearch');
    renderLibraryStatus();
    els.selectMatched.textContent = translator.t('button.selectVisible');
    els.selectUninstalled.textContent = translator.t('button.selectUninstalled');
    els.clearSelection.textContent = translator.t('button.clearSelection');
    els.queueSelected.textContent = translator.t('button.queueSelected');
    els.export.textContent = translator.t('button.exportCsv');
    els.stop.textContent = translator.t('button.stopSearch');
    els.openHistory.textContent = translator.t('button.history');
    els.languageLabel.textContent = translator.t('app.language');
    els.close.textContent = translator.t('button.close');
    els.language.value = translator.language;

    const filterKeys = { all: 'filter.all', pending: 'filter.pending', uninstalled: 'filter.uninstalled', installed: 'filter.installed', matched: 'filter.matched', review: 'filter.review', missing: 'filter.missing', requested: 'filter.requested' };
    panel.querySelectorAll('.sld-filter').forEach((button) => {
      button.textContent = translator.t(filterKeys[button.dataset.filter]);
    });

    els.queueTitle.textContent = translator.t('queue.title');
    els.batchPrefix.textContent = translator.t('queue.batchPrefix');
    els.batchSuffix.textContent = translator.t('queue.batchSuffix');
    els.batchSize.querySelector(`[value="${config.safeBatchValue}"]`).textContent = translator.t('queue.safeBatch');
    els.browserDownloads.textContent = translator.t('button.useBrowserDownloads');
    els.stopQueue.textContent = translator.t('button.stopQueue');
    els.clearQueue.textContent = translator.t('button.clearQueue');

    els.tableHeadings.select.textContent = translator.t('table.select');
    els.tableHeadings.index.textContent = translator.t('table.index');
    els.chartHeading.textContent = `${formatLevel(state.selectedTable, state.selectedLevel)} ${translator.t('table.chart')}`;
    els.tableHeadings.artist.textContent = translator.t('table.artist');
    els.tableHeadings.song.textContent = translator.t('table.songResults');
    els.tableHeadings.sabun.textContent = translator.t('table.sabunResults');
    els.tableHeadings.fallback.textContent = translator.t('table.fallbacks');
    els.tableHeadings.match.textContent = translator.t('table.matchStatus');
    els.tableHeadings.local.textContent = translator.t('table.localStatus');
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

  function setTables(tables) {
    els.table.innerHTML = tables.map((table) => `<option value="${escapeHtml(table.id)}">${escapeHtml(table.name)} (${escapeHtml(table.symbol)})</option>`).join('');
    els.table.value = state.selectedTableId;
  }

  function setLevels(levels, counts) {
    els.level.innerHTML = levels.map((level) => `<option value="${escapeHtml(level)}">${escapeHtml(formatLevel(state.selectedTable, level))} (${counts.get(level)})</option>`).join('');
    els.level.value = state.selectedLevel;
    els.level.disabled = false;
    els.loadLevel.disabled = false;
    els.refreshLevel.disabled = false;
    els.loadLevel.textContent = translator.t('button.searchSpecificLevel', {
      levelLabel: formatLevel(state.selectedTable, state.selectedLevel)
    });
  }

  function setTableLoading(loading) {
    els.table.disabled = loading || state.searchRunning;
    els.level.disabled = loading || state.searchRunning || !state.levels.length;
    els.loadLevel.disabled = loading || state.searchRunning || !state.levels.length;
    els.refreshLevel.disabled = loading || state.searchRunning || !state.levels.length;
  }

  function setSearchRunning(running) {
    els.stop.disabled = !running;
    if (running) {
      els.table.disabled = true;
      els.level.disabled = true;
      els.loadLevel.disabled = true;
      els.refreshLevel.disabled = true;
    } else if (state.levels.length) {
      els.table.disabled = false;
      els.level.disabled = false;
      els.loadLevel.disabled = false;
      els.refreshLevel.disabled = false;
    }
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setProgress(value, max) {
    if (max !== undefined) els.progress.max = Math.max(1, Number(max) || 1);
    els.progress.value = Math.max(0, Number(value) || 0);
  }

  function selectVisibleRows() {
    panel.querySelectorAll('tbody tr').forEach((tr) => {
      const checkbox = tr.querySelector('.sld-row-select');
      if (checkbox) checkbox.checked = !tr.hidden && !checkbox.disabled;
    });
  }

  function clearSelectedRows() {
    panel.querySelectorAll('.sld-row-select').forEach((checkbox) => { checkbox.checked = false; });
  }

  function selectUninstalledRows() {
    panel.querySelectorAll('tbody tr').forEach((tr) => {
      const checkbox = tr.querySelector('.sld-row-select');
      const result = state.rows[Number(tr.dataset.rowIndex)];
      const installation = result && chartInstallation(result.chart, state.libraryInventory);
      if (checkbox) checkbox.checked = Boolean(
        !checkbox.disabled && installation?.status !== 'installed'
      );
    });
  }

  function selectedRowIndexes() {
    return [...checkedRowIndexes()];
  }

  function openLibraryFilePicker() {
    els.libraryFiles.value = '';
    els.libraryFiles.click();
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
  els.refreshLevel.addEventListener('click', () => handlers.onRefreshLevel?.(els.level.value));
  els.scanLibrary.addEventListener('click', () => handlers.onScanLibrary?.());
  els.libraryFiles.addEventListener('change', () => handlers.onLibraryFiles?.(els.libraryFiles.files));
  els.table.addEventListener('change', () => handlers.onTableChange?.(els.table.value));
  els.level.addEventListener('change', () => {
    state.selectedLevel = els.level.value;
    els.loadLevel.textContent = translator.t('button.searchSpecificLevel', {
      levelLabel: formatLevel(state.selectedTable, els.level.value)
    });
    handlers.onLevelChange?.(els.level.value);
  });
  els.stop.addEventListener('click', () => handlers.onStopSearch?.());
  els.close.addEventListener('click', () => handlers.onClose?.());
  els.selectMatched.addEventListener('click', () => selectVisibleRows());
  els.selectUninstalled.addEventListener('click', () => selectUninstalledRows());
  els.clearSelection.addEventListener('click', () => clearSelectedRows());
  els.queueSelected.addEventListener('click', () => handlers.onQueueSelected?.(selectedRowIndexes()));
  els.export.addEventListener('click', () => handlers.onExportSearch?.());
  els.batchSize.addEventListener('change', () => handlers.onBatchSizeChange?.(els.batchSize.value));
  els.downloadFolder.addEventListener('click', () => handlers.onChooseDirectory?.());
  els.browserDownloads.addEventListener('click', () => handlers.onUseBrowserDownloads?.());
  els.runQueue.addEventListener('click', () => handlers.onRunQueue?.());
  els.stopQueue.addEventListener('click', () => handlers.onStopQueue?.());
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
    const entry = history.get(button.dataset.historyType, button.dataset.historyId, button.dataset.historyProvider);
    if (entry) handlers.onHistoryAction?.(button.dataset.historyAction, entry);
  });

  updateTranslations();
  setStatus(translator.t('status.loadingTable', { table: state.selectedTable?.name || '' }));
  setSearchRunning(false);

  return {
    panel,
    style,
    els,
    setTables,
    setLevels,
    setTableLoading,
    setStatus,
    setProgress,
    setSearchRunning,
    renderRow,
    renderAllRows,
    renderCounts,
    renderQueue,
    renderLibraryStatus,
    renderHistory,
    refreshFilter,
    updateTranslations,
    openHistory,
    closeHistory,
    openLibraryFilePicker,
    selectedRowIndexes,
    destroy() {
      panel.remove();
      style.remove();
    }
  };
}

module.exports = { createUi };
