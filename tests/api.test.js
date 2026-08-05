'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiError, createApi, parseRetryAfter } = require('../src/api');
const { getTable } = require('../src/tables');

test('difficulty table requests use the selected catalog URL without credentials', async () => {
  let request = null;
  const api = createApi({
    fetchFn: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() { return [{ title: 'Example', level: '1' }]; }
      };
    }
  });
  const table = getTable('satellite');
  const rows = await api.fetchTable(table);
  assert.equal(request.url, table.dataUrl);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(rows.length, 1);
});

test('Retry-After is converted into a resumable rate-limit window', async () => {
  const api = createApi({
    fetchFn: async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get(name) { return name === 'retry-after' ? '7' : null; } },
      async json() { return { error: 'Download limit reached' }; }
    })
  });
  await assert.rejects(
    api.grant({ type: 'song', id: 'limited' }),
    (error) => error instanceof ApiError
      && error.retryAfterMs === 7000
      && error.payload.remainingInWindow === 0
      && Date.parse(error.payload.windowResetsAt) > Date.now()
  );
  assert.equal(parseRetryAfter('3'), 3000);
});

test('additional providers are routed without replacing the built-in provider', async () => {
  const mirror = {
    id: 'documented-mirror',
    async search(sourceType, query) { return [{ id: `${sourceType}:${query}` }]; },
    async prepare(item) { return { downloadUrl: `https://example.test/${item.id}.zip` }; }
  };
  const api = createApi({ fetchFn: async () => { throw new Error('unexpected request'); }, providers: [mirror] });

  assert.equal(api.providers.get().id, 'bms-library');
  assert.deepEqual(await api.search('song', 'query', mirror.id), [{ id: 'song:query' }]);
  assert.deepEqual(
    await api.grant({ type: 'song', id: '42', providerId: mirror.id }),
    { downloadUrl: 'https://example.test/42.zip' }
  );
});
