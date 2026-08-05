'use strict';

const { CONFIG } = require('./config');
const { normalize } = require('./utils');

function createProviderRegistry(providers, defaultProviderId = CONFIG.defaultProviderId) {
  const map = new Map();
  for (const provider of providers || []) {
    if (!provider?.id || typeof provider.search !== 'function' || typeof provider.prepare !== 'function') {
      throw new TypeError('A download provider needs id, search(), and prepare().');
    }
    map.set(provider.id, provider);
  }
  if (!map.has(defaultProviderId)) throw new Error(`Default provider is not registered: ${defaultProviderId}`);
  return {
    defaultProviderId,
    get(providerId = defaultProviderId) {
      const provider = map.get(providerId);
      if (!provider) throw new Error(`Unknown download provider: ${providerId}`);
      return provider;
    },
    list() { return [...map.values()]; }
  };
}

function createBmsLibraryProvider(options) {
  const { requestJson, config = CONFIG } = options;
  const queryCache = new Map();

  return Object.freeze({
    id: 'bms-library',
    label: 'BMS Library',
    capabilities: Object.freeze({
      search: true,
      directDownload: false,
      downloadGrant: true,
      corsFetch: true,
      loginRequired: false,
      bulkDownload: false
    }),

    async search(sourceType, query) {
      const endpoint = sourceType === 'sabun' ? config.sabunsApi : config.songsApi;
      const cacheKey = `${sourceType}|${normalize(query)}`;
      if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);

      const url = new URL(endpoint);
      url.searchParams.set('limit', String(config.searchResultLimit));
      url.searchParams.set('offset', '0');
      url.searchParams.set('q', query);
      const { payload } = await requestJson(url.toString());
      const items = Array.isArray(payload.items) ? payload.items
        : Array.isArray(payload.files) ? payload.files
          : Array.isArray(payload) ? payload
            : [];
      queryCache.set(cacheKey, items);
      return items;
    },

    async prepare(item, requestOptions = {}) {
      const template = item.type === 'sabun' ? config.sabunGrantUrl : config.songGrantUrl;
      const url = template.replace('{id}', encodeURIComponent(item.id));
      const { payload } = await requestJson(url, { method: 'POST', ...requestOptions });
      if (!payload.downloadUrl) throw new Error('The server did not return a download URL.');
      return payload;
    },

    clearSearchCache() { queryCache.clear(); }
  });
}

module.exports = { createProviderRegistry, createBmsLibraryProvider };
