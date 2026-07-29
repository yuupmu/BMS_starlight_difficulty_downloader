'use strict';

const { start } = require('./app');

start().catch((error) => {
  console.error('[Starlight Difficulty Downloader]', error);
});
