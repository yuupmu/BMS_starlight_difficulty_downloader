'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQueries,
  scoreItem,
  classify,
  selectionItemsForResult,
  downloadCoverage
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
