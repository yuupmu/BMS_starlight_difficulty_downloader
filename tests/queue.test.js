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

test('browser downloads stay queued until the user confirms the save', async () => {
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
    const delivery = await manager.process(1);
    assert.equal(delivery.awaitingConfirmation, undefined);
    assert.equal(state.downloadQueue.length, 1);
    assert.equal(state.downloadQueue[0].deliveryStatus, 'browser-pending');
    assert.equal(history.has('song', '100'), false);

    const blockedRepeat = await manager.process(1);
    assert.equal(blockedRepeat.awaitingConfirmation, 1);
    assert.equal(manager.confirmBrowserDownload(), true);
    assert.equal(state.downloadQueue.length, 0);
    assert.equal(history.has('song', '100'), true);
    assert.equal(history.latest().status, 'browser-confirmed');

    const result = manager.enqueue([{ type: 'song', id: '100', title: 'Example', level: '10' }]);
    assert.equal(result.added, 0);
    assert.equal(result.alreadyRequested, 1);

    const redownload = manager.enqueue(
      [{ type: 'song', id: '100', title: 'Example', level: '10' }],
      { allowCompleted: true }
    );
    assert.equal(redownload.added, 1);
    assert.equal(history.has('song', '100'), false);
    assert.equal(state.downloadQueue.length, 1);
  } finally {
    global.document = originalDocument;
  }
});

test('safe batch runs until the server reports that the current window is exhausted', async () => {
  const directory = {
    name: 'BMS',
    async getFileHandle(name, options) {
      if (!options.create) {
        const error = new Error('missing');
        error.name = 'NotFoundError';
        throw error;
      }
      return { async createWritable() { return { async write() {}, async close() {} }; } };
    }
  };

  {
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
      downloadDirectoryHandle: directory
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
      fetchFn: async (url) => ({
        ok: true,
        url,
        headers: { get(name) { return name === 'content-type' ? 'application/zip' : null; } },
        body: null,
        async blob() { return new Blob(['PK archive bytes']); }
      }),
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
      headers: { get(name) {
        if (name === 'content-disposition') return 'attachment; filename="example.zip"';
        if (name === 'content-type') return 'application/zip';
        return null;
      } },
      body: null,
      async blob() { return new Blob(['PK archive bytes']); }
    }),
    translator: createTranslator('en'),
    savePrefs() {},
    config: { ...CONFIG, downloadDelayMs: 0 }
  });
  manager.enqueue([{ type: 'song', id: 'folder-1', title: 'Folder example', level: '10' }]);

  const result = await manager.process(1);
  assert.equal(result.completed, 1);
  assert.equal(writes.length, 2);
  assert.equal(await writes[0].text(), 'PK archive bytes');
  assert.equal(writes[1], 'closed');
  assert.equal(history.has('song', 'folder-1'), true);
  assert.equal(history.latest().status, 'saved');
});

test('transient grant failures use bounded backoff and keep queue state durable', async () => {
  const directory = {
    name: 'BMS',
    async getFileHandle(name, options) {
      if (!options.create) {
        const error = new Error('missing');
        error.name = 'NotFoundError';
        throw error;
      }
      return { async createWritable() { return { async write() {}, async close() {} }; } };
    }
  };
  {
    const storage = createStorage(memoryStorage());
    const history = createHistoryStore({ storage, initialEntries: [] });
    const state = {
      selectedLevel: '10', downloadQueue: [], downloadRunning: false,
      batchSize: 1, blockedUntil: 0, rateInfo: null, queueMessage: '',
      downloadDirectoryHandle: directory
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
      fetchFn: async (url) => ({
        ok: true,
        url,
        headers: { get(name) { return name === 'content-type' ? 'application/zip' : null; } },
        body: null,
        async blob() { return new Blob(['PK recovered archive']); }
      }),
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
  }
});

test('selected-folder retries reuse one issued grant', async () => {
  const storage = createStorage(memoryStorage());
  const history = createHistoryStore({ storage, initialEntries: [] });
  const directory = {
    name: 'BMS',
    async getFileHandle(name, options) {
      if (!options.create) {
        const error = new Error('missing');
        error.name = 'NotFoundError';
        throw error;
      }
      return { async createWritable() { return { async write() {}, async close() {} }; } };
    }
  };
  const state = {
    selectedLevel: '10', downloadQueue: [], downloadRunning: false,
    batchSize: 1, blockedUntil: 0, rateInfo: null, queueMessage: '',
    downloadDirectoryHandle: directory
  };
  let grantCalls = 0;
  let fetchCalls = 0;
  const manager = createQueueManager({
    state,
    storage,
    history,
    api: { async grant() { grantCalls += 1; return { downloadUrl: '/download/reuse.zip' }; } },
    fetchFn: async (url) => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return {
          ok: false, status: 503, statusText: 'Unavailable', url,
          headers: { get() { return null; } },
          async json() { return {}; }
        };
      }
      return {
        ok: true, url,
        headers: { get(name) { return name === 'content-type' ? 'application/zip' : null; } },
        body: null,
        async blob() { return new Blob(['PK reused archive']); }
      };
    },
    translator: createTranslator('en'),
    savePrefs() {},
    sleepFn: async () => {},
    randomFn: () => 0.5,
    config: { ...CONFIG, downloadDelayMs: 0 }
  });
  manager.enqueue([{ type: 'song', id: 'reuse-1', title: 'Reuse grant', level: '10' }]);

  const result = await manager.process(1);
  assert.equal(result.completed, 1);
  assert.equal(grantCalls, 1);
  assert.equal(fetchCalls, 2);
  assert.equal(history.has('song', 'reuse-1'), true);
});

test('selected-folder rejects an error document disguised as a file', async () => {
  const storage = createStorage(memoryStorage());
  const history = createHistoryStore({ storage, initialEntries: [] });
  const directory = {
    name: 'BMS',
    async getFileHandle() { throw new Error('A file should not be created for an error document.'); }
  };
  const state = {
    selectedLevel: '10', downloadQueue: [], downloadRunning: false,
    batchSize: 1, blockedUntil: 0, rateInfo: null, queueMessage: '',
    downloadDirectoryHandle: directory
  };
  const manager = createQueueManager({
    state,
    storage,
    history,
    api: { async grant() { return { downloadUrl: '/download/error.zip' }; } },
    fetchFn: async (url) => ({
      ok: true, url,
      headers: { get(name) { return name === 'content-type' ? 'application/octet-stream' : null; } },
      body: null,
      async blob() { return new Blob(['<html>download limit reached</html>']); }
    }),
    translator: createTranslator('en'),
    savePrefs() {},
    config: { ...CONFIG, downloadRetryMaxAttempts: 1, downloadDelayMs: 0 }
  });
  manager.enqueue([{ type: 'song', id: 'error-1', title: 'Error document', level: '10' }]);

  const result = await manager.process(1);
  assert.equal(result.completed, 0);
  assert.equal(state.downloadQueue.length, 1);
  assert.equal(history.has('song', 'error-1'), false);
});

test('selected-folder removes a partial file when the response ends early', async () => {
  const storage = createStorage(memoryStorage());
  const history = createHistoryStore({ storage, initialEntries: [] });
  const removed = [];
  const writes = [];
  const directory = {
    name: 'BMS',
    async getFileHandle(name, options) {
      if (!options.create) {
        const error = new Error('missing');
        error.name = 'NotFoundError';
        throw error;
      }
      return {
        async createWritable() {
          return {
            async write(value) { writes.push(value); },
            async close() {},
            async abort() { writes.push('aborted'); }
          };
        }
      };
    },
    async removeEntry(name) { removed.push(name); }
  };
  const state = {
    selectedLevel: '10', downloadQueue: [], downloadRunning: false,
    batchSize: 1, blockedUntil: 0, rateInfo: null, queueMessage: '',
    downloadDirectoryHandle: directory
  };
  const manager = createQueueManager({
    state,
    storage,
    history,
    api: { async grant() { return { downloadUrl: '/download/partial.zip' }; } },
    fetchFn: async (url) => ({
      ok: true, url,
      headers: { get(name) {
        if (name === 'content-type') return 'application/zip';
        if (name === 'content-length') return '100';
        return null;
      } },
      body: null,
      async blob() { return new Blob(['PK short']); }
    }),
    translator: createTranslator('en'),
    savePrefs() {},
    config: { ...CONFIG, downloadRetryMaxAttempts: 1, downloadDelayMs: 0 }
  });
  manager.enqueue([{ type: 'song', id: 'partial-1', title: 'Partial file', level: '10' }]);

  const result = await manager.process(1);
  assert.equal(result.completed, 0);
  assert.equal(state.downloadQueue.length, 1);
  assert.equal(history.has('song', 'partial-1'), false);
  assert.ok(writes.includes('aborted'));
  assert.deepEqual(removed, ['partial.zip']);
});

test('selected-folder removes the placeholder when opening the writable fails', async () => {
  const storage = createStorage(memoryStorage());
  const history = createHistoryStore({ storage, initialEntries: [] });
  const removed = [];
  const directory = {
    name: 'BMS',
    async getFileHandle(name, options) {
      if (!options.create) {
        const error = new Error('missing');
        error.name = 'NotFoundError';
        throw error;
      }
      return {
        async createWritable() { throw new Error('disk permission changed'); }
      };
    },
    async removeEntry(name) { removed.push(name); }
  };
  const state = {
    selectedLevel: '10', downloadQueue: [], downloadRunning: false,
    batchSize: 1, blockedUntil: 0, rateInfo: null, queueMessage: '',
    downloadDirectoryHandle: directory
  };
  const manager = createQueueManager({
    state,
    storage,
    history,
    api: { async grant() { return { downloadUrl: '/download/not-writable.zip' }; } },
    fetchFn: async (url) => ({
      ok: true, url,
      headers: { get(name) { return name === 'content-type' ? 'application/zip' : null; } },
      body: null,
      async blob() { return new Blob(['PK archive']); }
    }),
    translator: createTranslator('en'),
    savePrefs() {},
    config: { ...CONFIG, downloadRetryMaxAttempts: 1, downloadDelayMs: 0 }
  });
  manager.enqueue([{ type: 'song', id: 'not-writable', title: 'Not writable', level: '10' }]);

  const result = await manager.process(1);
  assert.equal(result.completed, 0);
  assert.equal(state.downloadQueue.length, 1);
  assert.equal(history.has('song', 'not-writable'), false);
  assert.deepEqual(removed, ['not-writable.zip']);
});

test('selected-folder stops when the issued file URL returns a rate limit', async () => {
  const storage = createStorage(memoryStorage());
  const history = createHistoryStore({ storage, initialEntries: [] });
  const directory = { name: 'BMS' };
  const state = {
    selectedLevel: '10', downloadQueue: [], downloadRunning: false,
    batchSize: 1, blockedUntil: 0, rateInfo: null, queueMessage: '',
    downloadDirectoryHandle: directory
  };
  const manager = createQueueManager({
    state,
    storage,
    history,
    api: { async grant() { return { downloadUrl: '/download/limited.zip' }; } },
    fetchFn: async (url) => ({
      ok: false, status: 429, statusText: 'Too Many Requests', url,
      headers: { get(name) { return name === 'retry-after' ? '60' : null; } },
      async json() { return { error: 'download limit reached' }; }
    }),
    translator: createTranslator('en'),
    savePrefs() {},
    config: { ...CONFIG, downloadDelayMs: 0 }
  });
  manager.enqueue([{ type: 'song', id: 'limited-1', title: 'Limited file', level: '10' }]);

  const result = await manager.process(1);
  assert.equal(result.completed, 0);
  assert.equal(state.downloadQueue.length, 1);
  assert.equal(history.has('song', 'limited-1'), false);
  assert.ok(state.blockedUntil > Date.now());
});
