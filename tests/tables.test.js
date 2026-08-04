'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TABLE_CATALOG,
  getTable,
  normalizeTableRows,
  sortLevels,
  formatLevel
} = require('../src/tables');

test('the supported table catalog exposes six distinct tables', () => {
  assert.deepEqual(TABLE_CATALOG.map((table) => table.id), [
    'starlight',
    'stardust',
    'satellite',
    'stella',
    'new-generation-normal',
    'new-generation-insane'
  ]);
  assert.equal(new Set(TABLE_CATALOG.map((table) => table.id)).size, TABLE_CATALOG.length);
  assert.equal(getTable('stardust').symbol, 'ξ');
});

test('table rows are normalized with source and level metadata', () => {
  const table = getTable('new-generation-normal');
  const [row] = normalizeTableRows([{
    title: ' Example ',
    artist: ' Artist ',
    level: '１２＋',
    url: 'https://example.com/song.zip'
  }], table);
  assert.equal(row.title, 'Example');
  assert.equal(row.artist, 'Artist');
  assert.equal(row.level, '12+');
  assert.equal(row.tableId, table.id);
  assert.equal(row.levelSymbol, '▽');
  assert.equal(formatLevel(table, row.level), '▽12+');
});

test('levels follow each table-defined order', () => {
  const table = getTable('new-generation-normal');
  assert.deepEqual(sortLevels(['?', '12+', '2', '12-', '11+'], table), ['2', '11+', '12-', '12+', '?']);
});

test('browser-compatible snapshots contain official table rows', () => {
  const expectedMinimums = { stardust: 900, satellite: 2300, stella: 2200 };
  for (const [id, minimum] of Object.entries(expectedMinimums)) {
    const file = path.resolve(__dirname, `../docs/data/${id}.json`);
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(rows.length >= minimum, `${id} snapshot should contain at least ${minimum} charts`);
    assert.ok(rows.every((row) => row.title && row.level !== undefined));
  }
});
