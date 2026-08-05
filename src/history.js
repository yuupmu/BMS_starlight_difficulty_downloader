'use strict';

const { CONFIG } = require('./config');
const { fileKey } = require('./utils');

function normalizeEntry(entry) {
  if (!entry || (entry.type !== 'song' && entry.type !== 'sabun') || entry.id === undefined || entry.id === null) return null;
  const requestedAt = entry.requestedAt || entry.completedAt || entry.timestamp || new Date().toISOString();
  return {
    key: fileKey(entry.type, entry.id, entry.providerId),
    providerId: String(entry.providerId || CONFIG.defaultProviderId),
    type: entry.type,
    id: String(entry.id),
    title: String(entry.title || entry.id),
    sourceName: String(entry.sourceName || ''),
    level: String(entry.level ?? ''),
    levelLabel: String(entry.levelLabel || `sr${entry.level ?? ''}`),
    levelSymbol: String(entry.levelSymbol || 'sr'),
    tableId: String(entry.tableId || 'starlight'),
    tableName: String(entry.tableName || 'Starlight'),
    sha256: String(entry.sha256 || ''),
    md5: String(entry.md5 || ''),
    requestedAt,
    fileName: String(entry.fileName || ''),
    status: 'requested'
  };
}

function createHistoryStore(options) {
  const storage = options.storage;
  const limit = Number(options.limit || CONFIG.historyLimit);
  const map = new Map();

  for (const rawEntry of options.initialEntries || []) {
    const entry = normalizeEntry(rawEntry);
    if (!entry) continue;
    const previous = map.get(entry.key);
    if (!previous || Date.parse(entry.requestedAt) >= Date.parse(previous.requestedAt)) {
      map.set(entry.key, entry);
    }
  }

  function persist() {
    const entries = list();
    if (entries.length > limit) entries.length = limit;
    map.clear();
    for (const entry of entries) map.set(entry.key, entry);
    storage.saveHistory(entries);
    return entries;
  }

  function list() {
    return [...map.values()].sort((a, b) => {
      const aTime = Date.parse(a.requestedAt) || 0;
      const bTime = Date.parse(b.requestedAt) || 0;
      return bTime - aTime;
    });
  }

  function has(type, id, providerId = CONFIG.defaultProviderId) {
    return map.has(fileKey(type, id, providerId));
  }

  function get(type, id, providerId = CONFIG.defaultProviderId) {
    return map.get(fileKey(type, id, providerId)) || null;
  }

  function markRequested(item, payload = {}) {
    const entry = normalizeEntry({
      ...item,
      requestedAt: new Date().toISOString(),
      fileName: payload.fileName || payload.filename || payload.name || item.fileName || ''
    });
    if (!entry) return null;
    map.set(entry.key, entry);
    persist();
    return entry;
  }

  function remove(type, id, providerId = CONFIG.defaultProviderId) {
    const removed = map.delete(fileKey(type, id, providerId));
    if (removed) persist();
    return removed;
  }

  function clear() {
    map.clear();
    storage.clearHistory();
  }

  function countForLevel(level) {
    const target = String(level);
    return [...map.values()].filter((entry) => String(entry.level) === target).length;
  }

  function latest() {
    return list()[0] || null;
  }

  persist();

  return {
    has,
    get,
    list,
    size() {
      return map.size;
    },
    countForLevel,
    latest,
    markRequested,
    remove,
    clear,
    persist
  };
}

module.exports = { createHistoryStore, normalizeEntry };
