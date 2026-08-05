'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQueries,
  scoreItem,
  scoreForResult,
  classify,
  selectionItemsForResult,
  downloadCoverage,
  findMatches,
  getFallbacks
} = require('../src/matcher');

test('matcher builds useful queries and gives exact titles a high score', () => {
  const chart = { title: 'Altale [HYPER]', artist: '削除', url: 'https://example.com/Altale.zip' };
  const queries = buildQueries(chart);
  assert.ok(queries.some((query) => /Altale/i.test(query)));
  const score = scoreItem({ id: '1', title: 'Altale', artist: '削除', name: 'Altale.zip' }, chart, 'Altale');
  assert.ok(score >= 120);
  assert.equal(classify(score).key, 'matched');
});

test('a chart with a separate patch requires both song and sabun files', () => {
  const result = {
    chart: { title: 'Example', level: '10', url_diff: 'https://example.com/patch.zip' },
    song: { matches: [{ item: { id: 'song-1', name: 'song.zip' }, score: 150 }] },
    sabun: { matches: [{ item: { id: 'sabun-1', name: 'patch.zip' }, score: 150 }] }
  };
  const items = selectionItemsForResult(result);
  assert.equal(items.length, 2);
  const history = { has(type, id) { return type === 'song' && id === 'song-1'; } };
  assert.deepEqual(downloadCoverage(result, history), {
    done: 1,
    total: 2,
    all: false,
    partial: true,
    selections: items
  });
});

test('selected files keep their difficulty table metadata', () => {
  const [item] = selectionItemsForResult({
    chart: {
      title: 'Example',
      level: '10',
      levelSymbol: 'sl',
      tableId: 'satellite',
      tableName: 'Satellite',
      sha256: 'abc123',
      md5: 'def456'
    },
    song: { matches: [{ item: { id: 'song-1', name: 'song.zip' }, score: 150 }] },
    sabun: { matches: [] }
  });
  assert.equal(item.levelLabel, 'sl10');
  assert.equal(item.tableId, 'satellite');
  assert.equal(item.tableName, 'Satellite');
  assert.equal(item.sha256, 'abc123');
  assert.equal(item.md5, 'def456');
});

test('Starlight-only fallback links do not leak into other tables', () => {
  assert.ok(getFallbacks({ title: 'opia', tableId: 'starlight' }).length > 0);
  assert.equal(getFallbacks({ title: 'opia', tableId: 'satellite' }).length, 0);
});

test('a separate patch result is classified by its weakest required source', () => {
  const result = {
    chart: { title: 'Example', url_diff: 'https://example.com/patch.zip' },
    song: { matches: [{ item: { id: 'song-1' }, score: 150 }] },
    sabun: { matches: [{ item: { id: 'sabun-1' }, score: 40 }] }
  };
  assert.equal(scoreForResult(result), 40);
  assert.equal(classify(scoreForResult(result)).key, 'missing');
});

test('a separate patch remains incomplete when one required source is missing', () => {
  const result = {
    chart: { title: 'Example', url_diff: 'https://example.com/patch.zip' },
    song: { matches: [{ item: { id: 'song-1' }, score: 150 }] },
    sabun: { matches: [] }
  };
  const history = { has(type, id) { return type === 'song' && id === 'song-1'; } };
  assert.deepEqual(downloadCoverage(result, history), {
    done: 1,
    total: 2,
    all: false,
    partial: true,
    selections: selectionItemsForResult(result)
  });
});

test('requesting an alternate displayed candidate completes a single-file result', () => {
  const result = {
    chart: { title: 'Example' },
    song: {
      matches: [
        { item: { id: 'song-1' }, score: 150 },
        { item: { id: 'song-2' }, score: 130 }
      ]
    },
    sabun: { matches: [] }
  };
  const history = { has(type, id) { return type === 'song' && id === 'song-2'; } };
  assert.equal(downloadCoverage(result, history).all, true);
});

test('a successful fallback query clears an earlier transient search error', async () => {
  let calls = 0;
  const result = await findMatches({
    api: {
      async search() {
        calls += 1;
        if (calls === 1) throw new Error('temporary failure');
        return [{ id: 'song-1', title: 'Example' }];
      }
    },
    chart: {
      title: 'Example',
      url: 'https://example.com/archive.zip'
    },
    sourceType: 'song',
    maxQueries: 2,
    delayMs: 0
  });
  assert.equal(calls, 2);
  assert.equal(result.matches[0].item.id, 'song-1');
  assert.equal(result.error, '');
});
