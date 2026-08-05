'use strict';

const { CONFIG } = require('./config');
const { createProviderRegistry, createBmsLibraryProvider } = require('./providers');

class ApiError extends Error {
  constructor(message, status, payload, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload || {};
    this.retryAfterMs = Number.isFinite(details.retryAfterMs) ? details.retryAfterMs : null;
  }
}

function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
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

  async function requestJson(url, requestOptions = {}) {
    const response = await fetchFn(url, { credentials: 'include', ...requestOptions });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const serverMessage = typeof payload.error === 'string' ? payload.error : '';
      const message = serverMessage || `${response.status} ${response.statusText}`;
      const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
      if (response.status === 429 && retryAfterMs !== null && !payload.windowResetsAt) {
        payload.remainingInWindow = 0;
        payload.windowResetsAt = new Date(Date.now() + retryAfterMs).toISOString();
      }
      throw new ApiError(message, response.status, payload, { retryAfterMs });
    }
    return { payload, response };
  }

  async function fetchJson(url, requestOptions = {}) {
    return (await requestJson(url, requestOptions)).payload;
  }

  async function fetchTable(table) {
    if (!table?.dataUrl) throw new ApiError('Difficulty table URL is missing.', 500, {});
    const response = await fetchFn(table.dataUrl, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new ApiError(`Difficulty table request failed: ${response.status}`, response.status, {});
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new ApiError('Unexpected difficulty table format.', 500, {});
    return rows;
  }

  const builtIn = createBmsLibraryProvider({ requestJson, config });
  const registry = createProviderRegistry([builtIn, ...(options.providers || [])], config.defaultProviderId);

  async function search(sourceType, query, providerId = registry.defaultProviderId) {
    return registry.get(providerId).search(sourceType, query);
  }

  async function grant(typeOrItem, id, requestOptions = {}) {
    const item = typeof typeOrItem === 'object'
      ? typeOrItem
      : { type: typeOrItem, id, providerId: registry.defaultProviderId };
    return registry.get(item.providerId).prepare(item, requestOptions);
  }

  return {
    fetchJson,
    fetchTable,
    search,
    grant,
    providers: registry,
    clearSearchCache() {
      for (const provider of registry.list()) provider.clearSearchCache?.();
    }
  };
}

module.exports = {
  ApiError,
  extractRateInfo,
  isRateLimitError,
  parseRetryAfter,
  createApi
};
