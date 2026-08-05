'use strict';

const { CONFIG } = require('./config');

const CHART_EXTENSION = /\.(?:bms|bme|bml|pms)$/i;

function hex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function md5Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const tail = new DataView(padded.buffer);
  const bitLengthLow = (bytes.length * 8) >>> 0;
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000) >>> 0;
  tail.setUint32(paddedLength - 8, bitLengthLow, true);
  tail.setUint32(paddedLength - 4, bitLengthHigh, true);

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const constants = Array.from({ length: 64 }, (_, index) => (
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
  ));
  const rotateLeft = (value, count) => ((value << count) | (value >>> (32 - count))) >>> 0;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const view = new DataView(padded.buffer, offset, 64);
    const words = Array.from({ length: 16 }, (_, index) => view.getUint32(index * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let f;
      let wordIndex;
      if (index < 16) {
        f = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const nextD = d;
      d = c;
      c = b;
      const sum = (a + f + constants[index] + words[wordIndex]) >>> 0;
      b = (b + rotateLeft(sum, shifts[index])) >>> 0;
      a = nextD;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const output = new Uint8Array(16);
  const view = new DataView(output.buffer);
  view.setUint32(0, a0, true);
  view.setUint32(4, b0, true);
  view.setUint32(8, c0, true);
  view.setUint32(12, d0, true);
  return hex(output);
}

async function sha256Hex(input, subtle = globalThis.crypto?.subtle) {
  if (!subtle?.digest) throw new Error('SHA-256 is not available in this browser.');
  return hex(new Uint8Array(await subtle.digest('SHA-256', input)));
}

function normalizeHash(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSnapshot(value, rootName = '') {
  if (!value || typeof value !== 'object' || !Array.isArray(value.files)) {
    return { version: 1, rootName: String(rootName || ''), scannedAt: '', files: [] };
  }
  return {
    version: 1,
    rootName: String(value.rootName || rootName || ''),
    scannedAt: String(value.scannedAt || ''),
    files: value.files.filter((entry) => entry && typeof entry.path === 'string').map((entry) => ({
      path: entry.path,
      size: Number(entry.size) || 0,
      lastModified: Number(entry.lastModified) || 0,
      sha256: normalizeHash(entry.sha256),
      md5: normalizeHash(entry.md5)
    }))
  };
}

async function* directoryFiles(directory, prefix = '', isCancelled = () => false) {
  for await (const [name, handle] of directory.entries()) {
    if (isCancelled()) return;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') yield* directoryFiles(handle, path, isCancelled);
    else if (handle.kind === 'file' && CHART_EXTENSION.test(name)) {
      yield { path, handle };
    }
  }
}

async function* selectedFiles(files, isCancelled = () => false) {
  for (const file of Array.from(files || [])) {
    if (isCancelled()) return;
    const path = String(file.webkitRelativePath || file.name || '');
    if (CHART_EXTENSION.test(path)) yield { path, file };
  }
}

function rootNameFromFiles(files) {
  const first = Array.from(files || []).find((file) => file?.webkitRelativePath || file?.name);
  const path = String(first?.webkitRelativePath || first?.name || 'selected-folder');
  return path.split('/')[0] || 'selected-folder';
}

async function scanLibrary(source, previousValue, options = {}) {
  const isDirectory = source?.kind === 'directory' && typeof source.entries === 'function';
  const rootName = String(options.rootName || (isDirectory ? source.name : rootNameFromFiles(source)) || 'BMS');
  const previous = normalizeSnapshot(previousValue, rootName);
  const previousByPath = new Map(previous.files.map((entry) => [entry.path, entry]));
  const files = [];
  const stats = { discovered: 0, rehashed: 0, reused: 0, errors: 0 };
  const isCancelled = options.isCancelled || (() => false);
  const iterator = isDirectory
    ? directoryFiles(source, '', isCancelled)
    : selectedFiles(source, isCancelled);
  const onProgress = options.onProgress || (() => {});
  const yieldFn = options.yieldFn || (() => new Promise((resolve) => setTimeout(resolve, 0)));

  for await (const entry of iterator) {
    if (isCancelled()) break;
    stats.discovered += 1;
    try {
      const file = entry.file || await entry.handle.getFile();
      const signature = {
        path: entry.path,
        size: Number(file.size) || 0,
        lastModified: Number(file.lastModified) || 0
      };
      const cached = previousByPath.get(entry.path);
      if (cached
        && cached.size === signature.size
        && cached.lastModified === signature.lastModified
        && cached.sha256
        && cached.md5) {
        files.push({ ...signature, sha256: cached.sha256, md5: cached.md5 });
        stats.reused += 1;
      } else {
        const buffer = await file.arrayBuffer();
        const digest = options.sha256 || ((value) => sha256Hex(value));
        files.push({
          ...signature,
          sha256: normalizeHash(await digest(buffer)),
          md5: md5Hex(buffer)
        });
        stats.rehashed += 1;
      }
    } catch {
      stats.errors += 1;
    }
    onProgress({ ...stats, path: entry.path });
    if (stats.discovered % (options.yieldEvery || CONFIG.inventoryYieldEvery) === 0) await yieldFn();
  }

  return {
    version: 1,
    rootName,
    scannedAt: new Date().toISOString(),
    complete: !isCancelled(),
    files,
    stats
  };
}

function createInventoryLookup(snapshotValue) {
  const snapshot = normalizeSnapshot(snapshotValue);
  const sha256 = new Map();
  const md5 = new Map();
  for (const entry of snapshot.files) {
    if (entry.sha256 && !sha256.has(entry.sha256)) sha256.set(entry.sha256, entry);
    if (entry.md5 && !md5.has(entry.md5)) md5.set(entry.md5, entry);
  }
  return { snapshot, sha256, md5 };
}

function chartInstallation(chart, lookup) {
  if (!lookup) return { status: 'unscanned', entry: null, algorithm: '' };
  const sha256 = normalizeHash(chart?.sha256);
  const md5 = normalizeHash(chart?.md5);
  if (sha256 && lookup.sha256.has(sha256)) {
    return { status: 'installed', entry: lookup.sha256.get(sha256), algorithm: 'SHA-256' };
  }
  if (md5 && lookup.md5.has(md5)) {
    return { status: 'installed', entry: lookup.md5.get(md5), algorithm: 'MD5' };
  }
  if (!sha256 && !md5) return { status: 'unknown', entry: null, algorithm: '' };
  return { status: 'uninstalled', entry: null, algorithm: sha256 ? 'SHA-256' : 'MD5' };
}

function createInventoryStore(indexedDb = globalThis.indexedDB) {
  let databasePromise = null;

  function open() {
    if (!indexedDb) return Promise.resolve(null);
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve) => {
      const request = indexedDb.open(CONFIG.storage.inventoryDb, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(CONFIG.storage.inventoryStore)) {
          request.result.createObjectStore(CONFIG.storage.inventoryStore, { keyPath: 'rootName' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return databasePromise;
  }

  async function transact(mode, action, fallback) {
    const database = await open();
    if (!database) return fallback;
    return new Promise((resolve) => {
      try {
        const transaction = database.transaction(CONFIG.storage.inventoryStore, mode);
        const store = transaction.objectStore(CONFIG.storage.inventoryStore);
        const request = action(store);
        request.onsuccess = () => resolve(request.result ?? fallback);
        request.onerror = () => resolve(fallback);
        transaction.onabort = () => resolve(fallback);
      } catch {
        resolve(fallback);
      }
    });
  }

  return {
    load(rootName) {
      return transact('readonly', (store) => store.get(String(rootName || '')), null);
    },
    save(snapshot) {
      if (!snapshot?.rootName) return Promise.resolve(false);
      return transact('readwrite', (store) => store.put(snapshot), false).then((result) => result !== false);
    }
  };
}

module.exports = {
  CHART_EXTENSION,
  md5Hex,
  sha256Hex,
  normalizeSnapshot,
  scanLibrary,
  createInventoryLookup,
  chartInstallation,
  createInventoryStore,
  rootNameFromFiles
};
