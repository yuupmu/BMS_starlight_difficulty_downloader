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
