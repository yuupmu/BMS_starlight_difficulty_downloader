# BMS Difficulty Table Downloader

[한국어](README.ko.md) · [日本語](README.ja.md) · **English**

A multilingual bookmarklet that lets you choose among six BMS difficulty tables, searches BMS Library for song packages and chart patches, and requests downloads sequentially while respecting the server’s rate limits.

## Quick install

1. Open the [installer page](https://yuupmu.github.io/BMS_starlight_difficulty_downloader/).
2. Show the bookmarks bar with `⌘/Ctrl + Shift + B` if it is hidden.
3. Drag **★ BMS Table Downloader** or **★ Standalone Downloader** onto the bookmarks bar.
4. Open [BMS Library Songs](https://horieyuuka.github.io/Songs) and click the bookmark you added.

GitHub README pages cannot safely execute a `javascript:` bookmark directly. Dragging the blue button on the installer page is the simplest setup. Use **Standalone Downloader** if the hosted loader is blocked by page security policy.

## Features

- Choose Starlight, Stardust, Satellite, Stella, NEW GENERATION Normal, or NEW GENERATION Insane on the first screen.
- Select only levels that actually exist in the chosen table, with chart counts shown beside them.
- Korean, Japanese, and English UI with a selector in the upper-right corner.
- Searches both the BMS Library Songs and Sabuns endpoints.
- Restores cached results per table and level without repeating API searches, and resumes partial searches.
- A **Not downloaded** filter plus **Select all visible** for flexible bulk selection.
- Direct folder selection and streamed writes in Chrome/Edge without overwriting existing files.
- An **Up to server allowance (auto)** batch mode in addition to fixed batch sizes.
- Persistent queue, rate-limit reset time, preferences, and requested-file history.
- Resumes from the first pending item after the page is closed or a request limit is reached.
- Prevents duplicate requests by storing each successful request as `song:<file-id>` or `sabun:<file-id>`.
- Download history window with **Download again**, record removal, and CSV export.
- Migrates queue and preferences from the previous `starlight-level-downloader:*:v2` storage keys.
- No runtime dependencies and no build dependencies.

## Install for users

Open the project’s [GitHub Pages installer](https://yuupmu.github.io/BMS_starlight_difficulty_downloader/) and drag **★ BMS Table Downloader** to the browser bookmarks bar. Then open [BMS Library Songs](https://horieyuuka.github.io/Songs) and run the bookmarklet.

The installer offers two forms:

- **Hosted loader:** a short bookmarklet that loads the current script from the project’s GitHub Pages site.
- **Standalone:** embeds the full bundle in the bookmark and can be used when a page security policy blocks an external script loader.

## Publish with GitHub Pages

The repository already contains a built site under `docs/`.

1. Create a GitHub repository and upload this project.
2. Open **Settings → Pages**.
3. Select **Deploy from a branch**.
4. Select the `main` branch and `/docs` folder.
5. Save, then open the published Pages URL.

The installer computes its script URL from the current Pages address, so it works for both user sites and project sites without editing a username or repository name.

## Development

Node.js 20 or newer is recommended.

```bash
npm test
npm run check
npm run build
```

Run `npm run sync:tables` to refresh the official Stardust, Satellite, and Stella snapshots under `docs/data/`. These sources do not allow browser cross-origin reads, so the project serves unmodified snapshots and keeps their official source links visible.

`npm run build` uses the dependency-free bundler in `scripts/build.mjs` and writes:

```text
dist/starlight-difficulty-downloader.js
dist/SHA256SUMS.txt
docs/assets/starlight-difficulty-downloader.js
```

The generated bundle should not be edited directly. Edit the files under `src/`, then rebuild.

## Project structure

```text
starlight-difficulty-downloader/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── workflows/ci.yml             # Tests and build verification
├── docs/
│   ├── index.html                     # multilingual installer / GitHub Pages
│   ├── data/                          # browser-compatible table snapshots
│   └── assets/
│       └── starlight-difficulty-downloader.js
├── dist/
│   ├── starlight-difficulty-downloader.js
│   └── SHA256SUMS.txt
├── scripts/
│   ├── build.mjs                      # dependency-free CommonJS browser bundler
│   ├── sync-tables.mjs                # refreshes official table snapshots
│   └── check.mjs                      # syntax checks
├── src/
│   ├── api.js                         # table and BMS Library network access
│   ├── app.js                         # application orchestration
│   ├── config.js                      # URLs, constants, fallback links
│   ├── history.js                     # requested-file history and duplicate keys
│   ├── i18n.js                        # ko / ja / en translations
│   ├── main.js                        # bundle entry point
│   ├── matcher.js                     # search queries, scoring, selections
│   ├── queue.js                       # sequential downloads and resume logic
│   ├── storage.js                     # localStorage and v2 migration
│   ├── styles.js                      # scoped overlay CSS
│   ├── tables.js                      # table catalog, levels, normalization
│   ├── ui.js                          # panel, history dialog, event wiring
│   └── utils.js                       # shared helpers and CSV export
├── tests/
├── LICENSE
└── package.json
```

## How resume and duplicate prevention work

The queue and history are stored in `localStorage` on the BMS Library origin.

After the server returns a download URL, the tool triggers the browser download and records the source type and file ID. It then removes the item from the queue. If execution stops between those writes, the next run sees the history key and prunes the duplicate queue item automatically.

A chart with a separate chart patch can require two records: one Song package and one Sabun file. Partial progress is displayed as `1/2 requested`.

Search results are also cached in `localStorage` per table and level. **Search** restores that cache; **Search again** clears it and starts fresh.

## Save folder and automatic batches

In Chrome/Edge, **Choose save folder** selects a folder for the current run and streams files there without overwriting an existing name. Browser security does not expose the full local path and may require the folder to be selected again after reopening the page. Other browsers use their normal download-location settings.

**Up to server allowance (auto)** follows the remaining count reported by the server and stops with the queue preserved when the count reaches zero. Browser-managed downloads can still be subject to the browser’s multiple-download permission; selected-folder mode is preferable for large batches.

### Important limitation

**Requested** means the server issued a URL and the tool handed it to the browser. A web page cannot reliably verify that the browser or disk completed the transfer. If a browser download fails after it was handed off, open **Download history** and choose **Download again** for that file.

## Stored data

The tool stores only local preferences and operational metadata:

- selected language, difficulty table, and per-table level;
- batch size;
- pending queue;
- rate-limit counters and reset time returned by the server;
- requested file type, ID, title, level, and timestamp.
- up to eight recent per-table/per-level search result caches.

The project does not operate a separate server and does not upload this history elsewhere.

## Data sources and attribution

- Starlight: <https://djkuroakari.github.io/starlighttable.html>
- Stardust: <https://mqppppp.neocities.org/ChartView>
- Satellite: <https://stellabms.xyz/sl/table.html>
- Stella: <https://stellabms.xyz/st/table.html>
- NEW GENERATION Normal / Insane: <https://rattoto10.jounin.jp/table.html>
- BMS Library: <https://horieyuuka.github.io/Songs>

This project is an independent utility and is not affiliated with or endorsed by the included table maintainers or BMS Library. Download and use BMS content only under the terms provided by its creators and distributors.

## License

MIT. See [LICENSE](LICENSE).
