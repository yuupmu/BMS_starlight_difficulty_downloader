'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFilterState,
  isFilterActive,
  toggleFilter,
  matchesFilters
} = require('../src/filters');

test('filters from different groups combine with AND logic', () => {
  let filters = toggleFilter(createFilterState(), 'pending');
  filters = toggleFilter(filters, 'matched');

  assert.equal(isFilterActive(filters, 'pending'), true);
  assert.equal(isFilterActive(filters, 'matched'), true);
  assert.equal(matchesFilters(filters, {
    download: 'pending', installation: 'uninstalled', match: 'matched'
  }), true);
  assert.equal(matchesFilters(filters, {
    download: 'requested', installation: 'uninstalled', match: 'matched'
  }), false);
  assert.equal(matchesFilters(filters, {
    download: 'pending', installation: 'uninstalled', match: 'review'
  }), false);
});

test('selecting within one group replaces that group and active filters toggle off', () => {
  let filters = toggleFilter(createFilterState(), 'pending');
  filters = toggleFilter(filters, 'requested');
  assert.equal(isFilterActive(filters, 'pending'), false);
  assert.equal(isFilterActive(filters, 'requested'), true);

  filters = toggleFilter(filters, 'requested');
  assert.equal(isFilterActive(filters, 'requested'), false);
  assert.equal(isFilterActive(filters, 'all'), true);
});

test('All clears every filter group', () => {
  let filters = { download: 'pending', installation: 'installed', match: 'review' };
  filters = toggleFilter(filters, 'all');
  assert.deepEqual(filters, createFilterState());
  assert.equal(isFilterActive(filters, 'all'), true);
});
