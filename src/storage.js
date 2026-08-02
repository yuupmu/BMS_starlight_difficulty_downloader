'use strict';

const { CONFIG } = require('./config');

function createStorage(storageLike) {
  const backing = storageLike || (typeof localStorage !== 'undefined' ? localStorage : null);

  function readJson(key, fallback) {
    if (!backing) return fallback;
    try {
      const raw = backing.getItem(key);
      if (!raw) return fallback;
      const value = JSON.parse(raw);
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    if (!backing) return false;
    try {
      backing.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function remove(key) {
    if (!backing) return false;
    try {
      backing.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function loadPrefs() {
    const current = readJson(CONFIG.storage.prefs, null);
    if (current && typeof current === 'object' && !Array.isArray(current)) return current;

    const legacy = readJson(CONFIG.storage.legacyPrefs, {});
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return {};

    const migrated = {
      selectedLevel: legacy.selectedLevel,
      batchSize: legacy.batchSize,
      blockedUntil: legacy.blockedUntil,
      rateInfo: legacy.rateInfo,
      language: legacy.language
    };
    writeJson(CONFIG.storage.prefs, migrated);
    return migrated;
  }

  function normalizeQueueItem(item) {
    if (!item || (item.type !== 'song' && item.type !== 'sabun') || item.id === undefined || item.id === null) return null;
    return {
      type: item.type,
      id: String(item.id),
      title: String(item.title || item.id),
      level: String(item.level ?? ''),
      sourceName: String(item.sourceName || ''),
      addedAt: item.addedAt || new Date().toISOString(),
      attempts: Number.isFinite(Number(item.attempts)) ? Number(item.attempts) : 0,
      lastAttemptAt: item.lastAttemptAt || null,
      lastError: item.lastError || ''
    };
  }

  function normalizeQueue(value) {
    if (!Array.isArray(value)) return [];
    const deduped = new Map();
    for (const rawItem of value) {
      const item = normalizeQueueItem(rawItem);
      if (!item) continue;
      const key = `${item.type}:${item.id}`;
      if (!deduped.has(key)) deduped.set(key, item);
    }
    return [...deduped.values()];
  }

  function loadQueue() {
    const current = readJson(CONFIG.storage.queue, null);
    if (Array.isArray(current)) return normalizeQueue(current);

    const legacy = readJson(CONFIG.storage.legacyQueue, []);
    const migrated = normalizeQueue(legacy);
    if (migrated.length) writeJson(CONFIG.storage.queue, migrated);
    return migrated;
  }

  function loadHistory() {
    const value = readJson(CONFIG.storage.history, []);
    return Array.isArray(value) ? value : [];
  }

  return {
    readJson,
    writeJson,
    remove,
    loadPrefs,
    savePrefs(value) {
      return writeJson(CONFIG.storage.prefs, value);
    },
    loadQueue,
    saveQueue(value) {
      return writeJson(CONFIG.storage.queue, normalizeQueue(value));
    },
    loadHistory,
    saveHistory(value) {
      return writeJson(CONFIG.storage.history, Array.isArray(value) ? value : []);
    },
    clearQueue() {
      return writeJson(CONFIG.storage.queue, []);
    },
    clearHistory() {
      return writeJson(CONFIG.storage.history, []);
    }
  };
}

module.exports = { createStorage };
