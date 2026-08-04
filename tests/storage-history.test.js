'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../src/storage');
const { createHistoryStore } = require('../src/history');
const { CONFIG } = require('../src/config');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    dump() { return Object.fromEntries(data); }
  };
}

test('legacy v2 queue and preferences are migrated to v3', () => {
  const backing = memoryStorage({
    [CONFIG.storage.legacyPrefs]: JSON.stringify({ selectedLevel: '11', batchSize: 5 }),
    [CONFIG.storage.legacyQueue]: JSON.stringify([
      { type: 'song', id: 12, title: 'Example', level: '11' },
      { type: 'song', id: 12, title: 'Duplicate', level: '11' }
    ])
  });
  const storage = createStorage(backing);
  assert.equal(storage.loadPrefs().selectedLevel, '11');
  assert.equal(storage.loadQueue().length, 1);
  assert.ok(backing.getItem(CONFIG.storage.prefs));
  assert.ok(backing.getItem(CONFIG.storage.queue));
});

test('history is keyed by source type and file id', () => {
  const storage = createStorage(memoryStorage());
  const history = createHistoryStore({ storage, initialEntries: [] });
  history.markRequested({ type: 'song', id: '42', title: 'Song', level: '10' });
  assert.equal(history.has('song', '42'), true);
  assert.equal(history.has('sabun', '42'), false);
  assert.equal(history.size(), 1);
  history.remove('song', '42');
  assert.equal(history.size(), 0);
});

test('queue and history preserve difficulty table metadata', () => {
  const storage = createStorage(memoryStorage());
  storage.saveQueue([{
    type: 'song',
    id: '77',
    title: 'Satellite Example',
    level: '10',
    levelLabel: 'sl10',
    levelSymbol: 'sl',
    tableId: 'satellite',
    tableName: 'Satellite'
  }]);
  const [queued] = storage.loadQueue();
  assert.equal(queued.levelLabel, 'sl10');
  assert.equal(queued.tableId, 'satellite');

  const history = createHistoryStore({ storage, initialEntries: [] });
  history.markRequested(queued);
  assert.equal(history.latest().levelLabel, 'sl10');
  assert.equal(history.latest().tableName, 'Satellite');
});

test('search caches are isolated by table id and level', () => {
  const storage = createStorage(memoryStorage());
  storage.saveSearchResult('starlight', '10', [{ chart: { title: 'SR' } }], true);
  storage.saveSearchResult('satellite', '10', [{ chart: { title: 'SL' } }], true);
  assert.equal(storage.loadSearchResult('starlight', '10').rows[0].chart.title, 'SR');
  assert.equal(storage.loadSearchResult('satellite', '10').rows[0].chart.title, 'SL');
});

test('search results are cached per table and level with newest entries first', () => {
  const storage = createStorage(memoryStorage());
  const rows = [{ chart: { title: 'Cached chart', sha256: 'abc' }, song: { matches: [] }, sabun: { matches: [] } }];
  assert.equal(storage.saveSearchResult('starlight', '10', rows, true), true);
  const restored = storage.loadSearchResult('starlight', '10');
  assert.equal(restored.complete, true);
  assert.equal(restored.rows[0].chart.title, 'Cached chart');
  assert.equal(storage.loadSearchResult('starlight', '11'), null);
  storage.clearSearchResult('starlight', '10');
  assert.equal(storage.loadSearchResult('starlight', '10'), null);
});
