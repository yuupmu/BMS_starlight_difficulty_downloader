'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/config');

test('file-system picker ids satisfy the browser specification', () => {
  for (const id of Object.values(CONFIG.pickerIds)) {
    assert.match(id, /^[A-Za-z0-9_-]+$/);
    assert.ok(id.length <= 32, `${id} exceeds the 32-character picker ID limit`);
  }
});
