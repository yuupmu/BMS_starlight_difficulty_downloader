'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  md5Hex,
  scanLibrary,
  createInventoryLookup,
  chartInstallation
} = require('../src/inventory');

const encoder = new TextEncoder();

function sha256(buffer) {
  return createHash('sha256').update(Buffer.from(buffer)).digest('hex');
}

function mockFile(name, contents, lastModified, reads) {
  const bytes = encoder.encode(contents);
  return {
    name,
    size: bytes.byteLength,
    lastModified,
    async arrayBuffer() {
      reads.count += 1;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function fileHandle(file) {
  return { kind: 'file', async getFile() { return file; } };
}

function directory(name, children) {
  return {
    kind: 'directory',
    name,
    async *entries() {
      for (const child of children) yield child;
    }
  };
}

test('MD5 implementation matches standard vectors', () => {
  assert.equal(md5Hex(encoder.encode('')), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5Hex(encoder.encode('abc')), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5Hex(encoder.encode('message digest')), 'f96b697d7cb7938d525a2f31aaf161d0');
});

test('folder scans hash only BMS charts and reuse unchanged cached entries', async () => {
  const firstReads = { count: 0 };
  const first = directory('Songs', [
    ['Song A', directory('Song A', [
      ['normal.bms', fileHandle(mockFile('normal.bms', '#TITLE A', 100, firstReads))],
      ['audio.ogg', fileHandle(mockFile('audio.ogg', 'audio', 100, firstReads))]
    ])],
    ['chart.pms', fileHandle(mockFile('chart.pms', '#TITLE P', 200, firstReads))]
  ]);

  const initial = await scanLibrary(first, null, { sha256, yieldEvery: 1, yieldFn: async () => {} });
  assert.equal(initial.complete, true);
  assert.equal(initial.files.length, 2);
  assert.equal(initial.stats.rehashed, 2);
  assert.equal(firstReads.count, 2);

  const secondReads = { count: 0 };
  const second = directory('Songs', [
    ['Song A', directory('Song A', [
      ['normal.bms', fileHandle(mockFile('normal.bms', '#TITLE A', 100, secondReads))]
    ])],
    ['chart.pms', fileHandle(mockFile('chart.pms', '#TITLE P changed', 300, secondReads))]
  ]);
  const refreshed = await scanLibrary(second, initial, { sha256, yieldEvery: 1, yieldFn: async () => {} });

  assert.equal(refreshed.stats.reused, 1);
  assert.equal(refreshed.stats.rehashed, 1);
  assert.equal(secondReads.count, 1);
  assert.equal(refreshed.files.find((entry) => entry.path === 'Song A/normal.bms').sha256, initial.files[0].sha256);
});

test('difficulty charts are classified by SHA-256 first and MD5 as fallback', async () => {
  const reads = { count: 0 };
  const root = directory('Songs', [
    ['installed.bme', fileHandle(mockFile('installed.bme', '#TITLE Installed', 100, reads))]
  ]);
  const snapshot = await scanLibrary(root, null, { sha256, yieldFn: async () => {} });
  const lookup = createInventoryLookup(snapshot);
  const [entry] = snapshot.files;

  assert.equal(chartInstallation({ sha256: entry.sha256 }, lookup).status, 'installed');
  assert.equal(chartInstallation({ md5: entry.md5 }, lookup).status, 'installed');
  assert.equal(chartInstallation({ sha256: '0'.repeat(64) }, lookup).status, 'uninstalled');
  assert.equal(chartInstallation({}, lookup).status, 'unknown');
  assert.equal(chartInstallation({ sha256: entry.sha256 }, null).status, 'unscanned');
});
