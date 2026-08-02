'use strict';

const { CONFIG } = require('./config');
const { normalize } = require('./utils');

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload || {};
  }
}

function extractRateInfo(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload.rateLimit && typeof payload.rateLimit === 'object' ? payload.rateLimit : payload;
  const parseCount = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  const remainingInWindow = parseCount(source.remainingInWindow);
  const remainingToday = parseCount(source.remainingToday);
  const windowResetsAt = typeof source.windowResetsAt === 'string' ? source.windowResetsAt : null;
  if (remainingInWindow === null && remainingToday === null && !windowResetsAt) return null;
  return { remainingInWindow, remainingToday, windowResetsAt };
}

function isRateLimitError(error) {
  const serverMessage = String(error?.payload?.error || error?.message || '');
  return error?.status === 429 || /download\s*limit\s*reached/i.test(serverMessage);
}

function createApi(options = {}) {
  const fetchFn = options.fetchFn || fetch.bind(globalThis);
  const config = options.config || CONFIG;
  const queryCache = new Map();

  async function fetchJson(url, requestOptions = {}) {
    const response = await fetchFn(url, { credentials: 'include', ...requestOptions });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const serverMessage = typeof payload.error === 'string' ? payload.error : '';
      const message = serverMessage || `${response.status} ${response.statusText}`;
      throw new ApiError(message, response.status, payload);
    }
    return payload;
  }

  async function fetchTable() {
    const response = await fetchFn(config.tableUrl, { cache: 'no-store' });
    if (!response.ok) throw new ApiError(`Difficulty table request failed: ${response.status}`, response.status, {});
    const table = await response.json();
    if (!Array.isArray(table)) throw new ApiError('Unexpected difficulty table format.', 500, {});
    return table;
  }

  async function search(sourceType, query) {
    const endpoint = sourceType === 'sabun' ? config.sabunsApi : config.songsApi;
    const cacheKey = `${sourceType}|${normalize(query)}`;
    if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);

    const url = new URL(endpoint);
    url.searchParams.set('limit', String(config.searchResultLimit));
    url.searchParams.set('offset', '0');
    url.searchParams.set('q', query);

    const payload = await fetchJson(url.toString());
    const items = Array.isArray(payload.items) ? payload.items
      : Array.isArray(payload.files) ? payload.files
        : Array.isArray(payload) ? payload
          : [];
    queryCache.set(cacheKey, items);
    return items;
  }

  async function grant(type, id) {
    const template = type === 'sabun' ? config.sabunGrantUrl : config.songGrantUrl;
    const url = template.replace('{id}', encodeURIComponent(id));
    const payload = await fetchJson(url, { method: 'POST' });
    if (!payload.downloadUrl) {
      throw new ApiError('The server did not return a download URL.', 500, payload);
    }
    return payload;
  }

  return {
    fetchJson,
    fetchTable,
    search,
    grant,
    clearSearchCache() {
      queryCache.clear();
    }
  };
}

module.exports = {
  ApiError,
  extractRateInfo,
  isRateLimitError,
  createApi
};
