'use strict';

const { start } = require('./app');

start().catch((error) => {
  console.error('[BMS Difficulty Table Downloader]', error);
});
