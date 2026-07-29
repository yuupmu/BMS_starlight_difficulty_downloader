'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DICTIONARIES, createTranslator, detectLanguage } = require('../src/i18n');

test('all supported languages contain the same translation keys', () => {
  const reference = Object.keys(DICTIONARIES.en).sort();
  assert.deepEqual(Object.keys(DICTIONARIES.ko).sort(), reference);
  assert.deepEqual(Object.keys(DICTIONARIES.ja).sort(), reference);
});

test('translator interpolates values and language can be changed', () => {
  const translator = createTranslator('ko');
  assert.equal(translator.t('queue.pendingCount', { count: 3 }), '3개 대기');
  translator.setLanguage('ja');
  assert.equal(translator.t('queue.pendingCount', { count: 3 }), '3件待機');
  translator.setLanguage('en');
  assert.equal(translator.t('queue.pendingCount', { count: 3 }), '3 pending');
});

test('language detection supports Korean, Japanese and English', () => {
  assert.equal(detectLanguage('', 'ko-KR'), 'ko');
  assert.equal(detectLanguage('', 'ja-JP'), 'ja');
  assert.equal(detectLanguage('', 'fr-FR'), 'en');
  assert.equal(detectLanguage('ja', 'ko-KR'), 'ja');
});
