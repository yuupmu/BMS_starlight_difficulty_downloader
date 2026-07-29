# Contributing

Thanks for improving Starlight Difficulty Downloader.

## Before opening a pull request

```bash
npm test
npm run check
npm run build
```

Commit both source changes and the rebuilt files under `dist/` and `docs/assets/`.

## Translation changes

All runtime translations are in `src/i18n.js`. Korean, Japanese, and English dictionaries must contain the same keys; the automated i18n test enforces this.

The GitHub Pages installer translations are in `docs/index.html`.

## Download history behavior

Do not mark an item as requested before a download URL has been returned and handed to the browser. The history write should remain before queue removal so a restart can prune a duplicate queue item safely.

## Reports

Include the browser, selected level, the visible error, and whether the problem occurred during search, download grant creation, or the browser’s own file transfer.
