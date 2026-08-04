'use strict';

const VERSION = '1.0.0';

const CONFIG = Object.freeze({
  version: VERSION,
  projectName: 'BMS Difficulty Table Downloader',
  requiredHost: 'horieyuuka.github.io',
  requiredPathPrefix: '/Songs',
  songsPageUrl: 'https://horieyuuka.github.io/Songs',
  songsApi: 'https://horie.synology.me:8443/api/v1/folders/Songs/files',
  sabunsApi: 'https://horie.synology.me:8443/api/v1/sabuns',
  songGrantUrl: 'https://horie.synology.me:8443/api/v1/files/{id}/download-grants',
  sabunGrantUrl: 'https://horie.synology.me:8443/api/v1/sabuns/{id}/download-grants',
  downloadBaseUrl: 'https://horie.synology.me:8443',
  panelId: 'starlight-difficulty-downloader',
  loaderId: 'starlight-difficulty-downloader-loader',
  searchDelayMs: 650,
  downloadDelayMs: 5000,
  defaultBatchSize: 3,
  allowedBatchSizes: Object.freeze([1, 3, 5, 10]),
  safeBatchValue: 'safe',
  storage: Object.freeze({
    prefs: 'starlight-difficulty-downloader:prefs:v3',
    queue: 'starlight-difficulty-downloader:queue:v3',
    history: 'starlight-difficulty-downloader:history:v3',
    searchResults: 'starlight-difficulty-downloader:search-results:v3',
    legacyPrefs: 'starlight-level-downloader:prefs:v2',
    legacyQueue: 'starlight-level-downloader:queue:v2'
  }),
  supportedLanguages: Object.freeze(['ko', 'ja', 'en']),
  defaultTableId: 'starlight',
  historyLimit: 5000,
  searchCacheLimit: 8,
  searchResultLimit: 30,
  maxCandidatesPerSource: 3
});

const DIRECT_FALLBACKS = Object.freeze([
  { title: 'opia', labelKey: 'fallback.formatService', format: 'OGG', service: 'Google Drive', url: 'https://drive.google.com/file/d/1f9F2AxUh6wUTB6zQ3-YhNPmHGMcgQmvy/view?usp=sharing' },
  { title: 'opia', labelKey: 'fallback.formatService', format: 'WAV', service: 'Google Drive', url: 'https://drive.google.com/file/d/1y_A_i8z8uCczfjFMorF7IBkT3o1V3Zth/view?usp=sharing' },
  { title: 'Vis10ns', labelKey: 'fallback.formatService', format: 'OGG', service: 'Google Drive', url: 'https://drive.google.com/uc?export=download&id=1iaMltI2Mvdn5sOchKJL9VIloYvYV3Ydx' },
  { title: 'Vis10ns', labelKey: 'fallback.formatService', format: 'WAV', service: 'Google Drive', url: 'https://drive.google.com/uc?export=download&id=1jtfCwId5XZzMnZLFuRAWAJ01jFj9Y-KR' },
  { title: '海神寓拝', labelKey: 'fallback.archiveMirror', service: 'Archive.org', url: 'https://archive.org/download/sasakure_UK_bms' },
  { title: '-雪月花-', labelKey: 'fallback.service', service: 'Dropbox', url: 'https://www.dropbox.com/s/v3kcas8wwxg3den/%5BSOMON%5D-setsugekka-.zip?dl=1' },
  { title: '白と青の狭間', labelKey: 'fallback.service', service: 'Dropbox', url: 'https://www.dropbox.com/s/n3ej69ij5boenwu/%5BTake-Ma%5D%E7%99%BD%E3%81%A8%E9%9D%92%E3%81%AE%E7%8B%AD%E9%96%93.zip?dl=1' },
  { title: 'Azure Rays', labelKey: 'fallback.mainAndChart', service: 'Google Drive', url: 'https://drive.google.com/file/d/1essSFR88YXjfLffp5ETUrqnexSs0u3BJ/view?usp=sharing' },
  { title: 'Azure Rays', labelKey: 'fallback.chartOnly', service: 'Google Drive', url: 'https://drive.google.com/file/d/1ubDMYFr0-31Blb_NpAPGhrI_eRGNEw-D/view?usp=sharing' },
  { title: 'いなずまねこの踊り', labelKey: 'fallback.eventPackage', service: 'YURUYURU', url: 'https://9domu46i.com/yuruyuru/package/YURUYURU_Phase_16.zip' },
  { title: 'Holy Lightbringer', labelKey: 'fallback.service', service: 'BMSworld', url: 'https://www.bmsworld.nz/download/wire-puller-4-%E7%90%B4%E7%80%AC%E6%82%A0-holy-lightbringer/' },
  { title: 'Freefall', labelKey: 'fallback.service', service: 'Google Drive', url: 'https://drive.google.com/file/d/1FhML7CMg31G0HbPHxjsa6ctsMNZTI74u/view?usp=sharing' },
  { title: '夜間飛行トラベラー', labelKey: 'fallback.service', service: 'Dropbox', url: 'https://www.dropbox.com/s/7n1b7n25ad1a34t/qfeileadh_nightflighttravler.zip?dl=1' },
  { title: '詠訣へ連れる', labelKey: 'fallback.service', service: 'Dropbox', url: 'https://www.dropbox.com/s/om3td0f9zc23bva/EIKETSU%20HE%20TSURERU_fix_ogg.zip?dl=1' },
  { title: 'Qronostasis', labelKey: 'fallback.service', service: 'Dropbox', url: 'https://www.dropbox.com/s/gq8f430jk0fp10o/Qronostasis.zip' },
  { title: 'LOSTAIR', labelKey: 'fallback.service', service: 'Google Drive', url: 'https://drive.google.com/file/d/0B41RH3Mq-Zs_Y2tvN0V3MEZMMzg/view?usp=sharing' }
]);

module.exports = { CONFIG, DIRECT_FALLBACKS };
