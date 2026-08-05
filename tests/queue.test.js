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

test('safe batch runs until the server reports that the current window is exhausted', async () => {
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
      batchSize: CONFIG.safeBatchValue,
      blockedUntil: 0,
      rateInfo: null,
      queueMessage: '',
      downloadDirectoryHandle: null
    };
    let calls = 0;
    const api = {
      async grant() {
        calls += 1;
        return {
          downloadUrl: `/download/${calls}.zip`,
          remainingInWindow: 3 - calls,
          remainingToday: 70,
          windowResetsAt: new Date(Date.now() + 60_000).toISOString()
        };
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
    manager.enqueue([1, 2, 3, 4].map((id) => ({ type: 'song', id, title: `Song ${id}`, level: '10' })));

    const result = await manager.process(CONFIG.safeBatchValue);
    assert.equal(result.completed, 3);
    assert.equal(calls, 3);
    assert.equal(state.downloadQueue.length, 1);
    assert.equal(history.size(), 3);
    assert.ok(state.blockedUntil > Date.now());
  } finally {
    global.document = originalDocument;
  }
});

test('selected-folder mode writes the response before recording download history', async () => {
  const storage = createStorage(memoryStorage());
  const history = createHistoryStore({ storage, initialEntries: [] });
  const writes = [];
  const writable = {
    async write(value) { writes.push(value); },
    async close() { writes.push('closed'); }
  };
  const directory = {
    name: 'BMS',
    async getFileHandle(name, options) {
      if (!options.create) {
        const error = new Error('missing');
        error.name = 'NotFoundError';
        throw error;
      }
      return { async createWritable() { return writable; } };
    }
  };
  const state = {
    selectedLevel: '10',
    downloadQueue: [],
    downloadRunning: false,
    batchSize: 1,
    blockedUntil: 0,
    rateInfo: null,
    queueMessage: '',
    downloadDirectoryHandle: directory
  };
  const manager = createQueueManager({
    state,
    storage,
    history,
    api: { async grant() { return { downloadUrl: '/download/example.zip' }; } },
    fetchFn: async () => ({
      ok: true,
      url: 'https://example.com/example.zip',
      headers: { get() { return 'attachment; filename="example.zip"'; } },
      body: null,
      async blob() { return 'archive bytes'; }
    }),
    translator: createTranslator('en'),
    savePrefs() {},
    config: { ...CONFIG, downloadDelayMs: 0 }
  });
  manager.enqueue([{ type: 'song', id: 'folder-1', title: 'Folder example', level: '10' }]);

  const result = await manager.process(1);
  assert.equal(result.completed, 1);
  assert.deepEqual(writes, ['archive bytes', 'closed']);
  assert.equal(history.has('song', 'folder-1'), true);
});

test('transient grant failures use bounded backoff and keep queue state durable', async () => {
  const originalDocument = global.document;
  global.document = {
    body: { appendChild() {} },
    createElement() { return { style: {}, click() {}, remove() {} }; }
  };
  try {
    const storage = createStorage(memoryStorage());
    const history = createHistoryStore({ storage, initialEntries: [] });
    const state = {
      selectedLevel: '10', downloadQueue: [], downloadRunning: false,
      batchSize: 1, blockedUntil: 0, rateInfo: null, queueMessage: ''
    };
    let calls = 0;
    const delays = [];
    const manager = createQueueManager({
      state,
      storage,
      history,
      api: {
        async grant() {
          calls += 1;
          if (calls === 1) {
            const error = new Error('temporary outage');
            error.status = 503;
            throw error;
          }
          return { downloadUrl: '/download/recovered.zip' };
        }
      },
      translator: createTranslator('en'),
      savePrefs() {},
      sleepFn: async (ms) => { delays.push(ms); },
      randomFn: () => 0.5,
      config: { ...CONFIG, downloadDelayMs: 0, hiddenFrameCleanupMs: 0 }
    });
    manager.enqueue([{ type: 'song', id: 'retry-1', title: 'Retry example', level: '10' }]);

    const result = await manager.process(1);
    assert.equal(result.completed, 1);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [CONFIG.downloadRetryBaseMs]);
    assert.equal(state.downloadQueue.length, 0);
    assert.equal(history.has('song', 'retry-1'), true);
  } finally {
    global.document = originalDocument;
  }
});
