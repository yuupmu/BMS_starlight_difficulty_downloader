'use strict';

const FILTER_GROUP_BY_ID = Object.freeze({
  pending: 'download',
  requested: 'download',
  uninstalled: 'installation',
  installed: 'installation',
  matched: 'match',
  review: 'match',
  missing: 'match'
});

function createFilterState(value = {}) {
  return {
    download: FILTER_GROUP_BY_ID[value.download] === 'download' ? value.download : '',
    installation: FILTER_GROUP_BY_ID[value.installation] === 'installation' ? value.installation : '',
    match: FILTER_GROUP_BY_ID[value.match] === 'match' ? value.match : ''
  };
}

function isFilterStateEmpty(value) {
  const filters = createFilterState(value);
  return !filters.download && !filters.installation && !filters.match;
}

function isFilterActive(value, filterId) {
  if (filterId === 'all') return isFilterStateEmpty(value);
  const group = FILTER_GROUP_BY_ID[filterId];
  return Boolean(group && createFilterState(value)[group] === filterId);
}

function toggleFilter(value, filterId) {
  if (filterId === 'all') return createFilterState();
  const group = FILTER_GROUP_BY_ID[filterId];
  if (!group) return createFilterState(value);
  const next = createFilterState(value);
  next[group] = next[group] === filterId ? '' : filterId;
  return next;
}

function matchesFilters(value, facets) {
  const filters = createFilterState(value);
  return (!filters.download || filters.download === facets.download)
    && (!filters.installation || filters.installation === facets.installation)
    && (!filters.match || filters.match === facets.match);
}

module.exports = {
  FILTER_GROUP_BY_ID,
  createFilterState,
  isFilterStateEmpty,
  isFilterActive,
  toggleFilter,
  matchesFilters
};
