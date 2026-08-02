'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../src/storage');
const { createHistoryStore } = require('../src/history');
const { createQueueManager } = require('../src/queue');
const { createTranslator } = require('../src/i18n');
const { CONFIG } = require('../src/config');

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}

test('successful requests are persisted and skipped on the next enqueue', async () => {
  const originalDocument = global.document;
  global.document = {
    body: { appendChild() {} },
    createElement() {
      return { style: {}, click() {}, remove() {} };
    }
  };

  try {
    const storage = createStorage(memoryStorage());
    const history = createHistoryStore({ storage, initialEntries: [] });
    const state = {
      selectedLevel: '10',
      downloadQueue: [],
      downloadRunning: false,
      batchSize: 1,
      blockedUntil: 0,
      rateInfo: null,
      queueMessage: ''
    };
    const api = {
      async grant() {
        return { downloadUrl: '/download/example.zip', remainingInWindow: 4, remainingToday: 74 };
      }
    };
    const manager = createQueueManager({
      state,
      storage,
      history,
      api,
      translator: createTranslator('en'),
      savePrefs() {},
      config: { ...CONFIG, downloadDelayMs: 0 }
    });

    assert.equal(manager.enqueue([{ type: 'song', id: '100', title: 'Example', level: '10' }]).added, 1);
    await manager.process(1);
    assert.equal(state.downloadQueue.length, 0);
    assert.equal(history.has('song', '100'), true);

    const result = manager.enqueue([{ type: 'song', id: '100', title: 'Example', level: '10' }]);
    assert.equal(result.added, 0);
    assert.equal(result.alreadyRequested, 1);
  } finally {
    global.document = originalDocument;
  }
});
