'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../src/api');
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
