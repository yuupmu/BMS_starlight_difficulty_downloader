'use strict';

const MIRROR_BASE = 'https://raw.githubusercontent.com/yuupmu/BMS_starlight_difficulty_downloader/main/docs/data';

const TABLE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'starlight',
    name: 'Starlight',
    symbol: 'sr',
    defaultLevel: '10',
    sourceUrl: 'https://djkuroakari.github.io/starlighttable.html',
    dataUrl: 'https://raw.githubusercontent.com/DJKuroakari/DJKuroakari.github.io/refs/heads/main/data.json',
    levelOrder: Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '?', '!'])
  }),
  Object.freeze({
    id: 'stardust',
    name: 'Stardust',
    symbol: 'ξ',
    defaultLevel: '10',
    sourceUrl: 'https://mqppppp.neocities.org/ChartView',
    dataUrl: `${MIRROR_BASE}/stardust.json`,
    levelOrder: Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '?'])
  }),
  Object.freeze({
    id: 'satellite',
    name: 'Satellite',
    symbol: 'sl',
    defaultLevel: '10',
    sourceUrl: 'https://stellabms.xyz/sl/table.html',
    dataUrl: `${MIRROR_BASE}/satellite.json`,
    levelOrder: Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
  }),
  Object.freeze({
    id: 'stella',
    name: 'Stella',
    symbol: 'st',
    defaultLevel: '10',
    sourceUrl: 'https://stellabms.xyz/st/table.html',
    dataUrl: `${MIRROR_BASE}/stella.json`,
    levelOrder: Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
  }),
  Object.freeze({
    id: 'new-generation-normal',
    name: 'NEW GENERATION Normal',
    symbol: '▽',
    defaultLevel: '10',
    sourceUrl: 'https://rattoto10.jounin.jp/table.html',
    dataUrl: 'https://rattoto10.github.io/second_table/score.json',
    levelOrder: Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '11+', '12-', '12', '12+', '?'])
  }),
  Object.freeze({
    id: 'new-generation-insane',
    name: 'NEW GENERATION Insane',
    symbol: '▼',
    defaultLevel: '10',
    sourceUrl: 'https://rattoto10.jounin.jp/table_insane.html',
    dataUrl: 'https://rattoto10.github.io/second_table/insane_data.json',
    levelOrder: Object.freeze(['0-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '?'])
  })
]);

function getTable(tableId) {
  return TABLE_CATALOG.find((table) => table.id === tableId) || TABLE_CATALOG[0];
}

function normalizeLevel(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function normalizeTableRows(rows, table) {
  if (!Array.isArray(rows)) return [];
  return rows.map((raw) => ({
    ...raw,
    title: String(raw?.title || '').trim(),
    subtitle: String(raw?.subtitle || '').trim(),
    artist: String(raw?.artist || '').trim(),
    level: normalizeLevel(raw?.level),
    url: String(raw?.url || '').trim(),
    url_diff: String(raw?.url_diff || '').trim(),
    md5: String(raw?.md5 || '').trim(),
    sha256: String(raw?.sha256 || '').trim(),
    tableId: table.id,
    tableName: table.name,
    levelSymbol: table.symbol,
    tableSourceUrl: table.sourceUrl
  })).filter((row) => row.title && row.level);
}

function sortLevels(levels, table) {
  const order = new Map((table?.levelOrder || []).map((level, index) => [level, index]));
  return [...levels].sort((left, right) => {
    const a = order.has(left) ? order.get(left) : Number.MAX_SAFE_INTEGER;
    const b = order.has(right) ? order.get(right) : Number.MAX_SAFE_INTEGER;
    if (a !== b) return a - b;
    return String(left).localeCompare(String(right), undefined, { numeric: true });
  });
}

function formatLevel(table, level) {
  return `${table?.symbol || ''}${normalizeLevel(level)}`;
}

module.exports = {
  TABLE_CATALOG,
  getTable,
  normalizeLevel,
  normalizeTableRows,
  sortLevels,
  formatLevel
};
