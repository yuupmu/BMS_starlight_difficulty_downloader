# Starlight Difficulty Downloader

[한국어](README.ko.md) · [日本語](README.ja.md) · **English**

A multilingual bookmarklet that reads the official Starlight difficulty table, searches BMS Library for song packages and chart patches, and requests downloads sequentially while respecting the server’s rate limits.

## Features

- Select any available Starlight level, normally `sr0` through `sr13`.
- Korean, Japanese, and English UI with a selector in the upper-right corner.
- Searches both the BMS Library Songs and Sabuns endpoints.
- Persistent queue, rate-limit reset time, preferences, and requested-file history.
- Resumes from the first pending item after the page is closed or a request limit is reached.
- Prevents duplicate requests by storing each successful request as `song:<file-id>` or `sabun:<file-id>`.
- Download history window with **Download again**, record removal, and CSV export.
- Migrates queue and preferences from the previous `starlight-level-downloader:*:v2` storage keys.
- No runtime dependencies and no build dependencies.

## Install for users

Open the project’s GitHub Pages site and drag **★ Starlight Downloader** to the browser bookmarks bar. Then open [BMS Library Songs](https://horieyuuka.github.io/Songs) and run the bookmarklet.

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
│   └── assets/
│       └── starlight-difficulty-downloader.js
├── dist/
│   ├── starlight-difficulty-downloader.js
│   └── SHA256SUMS.txt
├── scripts/
│   ├── build.mjs                      # dependency-free CommonJS browser bundler
│   └── check.mjs                      # syntax checks
├── src/
│   ├── api.js                         # Starlight and BMS Library network access
│   ├── app.js                         # application orchestration
│   ├── config.js                      # URLs, constants, fallback links
│   ├── history.js                     # requested-file history and duplicate keys
│   ├── i18n.js                        # ko / ja / en translations
│   ├── main.js                        # bundle entry point
│   ├── matcher.js                     # search queries, scoring, selections
│   ├── queue.js                       # sequential downloads and resume logic
│   ├── storage.js                     # localStorage and v2 migration
│   ├── styles.js                      # scoped overlay CSS
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

### Important limitation

**Requested** means the server issued a URL and the tool handed it to the browser. A web page cannot reliably verify that the browser or disk completed the transfer. If a browser download fails after it was handed off, open **Download history** and choose **Download again** for that file.

## Stored data

The tool stores only local preferences and operational metadata:

- selected language and level;
- batch size;
- pending queue;
- rate-limit counters and reset time returned by the server;
- requested file type, ID, title, level, and timestamp.

The project does not operate a separate server and does not upload this history elsewhere.

## Data sources and attribution

- Starlight table data: <https://github.com/DJKuroakari/DJKuroakari.github.io>
- BMS Library: <https://horieyuuka.github.io/Songs>

This project is an independent utility and is not affiliated with or endorsed by the Starlight table maintainers or BMS Library. Download and use BMS content only under the terms provided by its creators and distributors.

## License

MIT. See [LICENSE](LICENSE).
