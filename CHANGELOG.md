# Changelog

## 1.2.0 — 2026-08-05

- Added a user-authorized recursive scan of an extracted BMS library folder.
- Added exact SHA-256 and MD5 matching against difficulty-table chart hashes.
- Added an IndexedDB inventory that reuses hashes only when the same directory is selected and the relative path, size, and modification time are unchanged.
- Added local installed/missing status, filters, counts, and CSV columns.
- Prevented locally installed charts from bulk selection and removed hash-identical items from the pending queue after a completed scan.
- Added a directory-upload fallback for browsers without `showDirectoryPicker()`.

## 1.1.0 — 2026-08-04

- Added a provider registry and provider-scoped queue/history keys so download backends can be added without duplicating the downloader core.
- Added bounded exponential retries for temporary network and server failures, including `Retry-After` support.
- Added a cooperative stop control that preserves the pending queue for a later run.
- Cleaned up hidden browser-download frames after use and preserved rate-limit/error messages at batch completion.
- Fixed the repository layout so development commands and the `docs/` Pages site live at the repository root.
- Fixed separate-patch classification and progress tracking so both Song and Sabun sources are required.
- Fixed request-history recognition for manually selected alternate search candidates.
- Avoided stale search errors after a later query succeeds and removed the final unnecessary search delay.
- Stopped the bundle generator from emitting trailing whitespace on blank lines.
- Added CI, issue templates, and baseline repository configuration files.

## 1.0.0 — 2026-07-29

- Split the bookmarklet into maintainable source modules.
- Added Korean, Japanese, and English interfaces.
- Added persistent requested-file history keyed by source type and file ID.
- Added automatic duplicate skipping and resume after interruption.
- Added a download history dialog with retry, removal, and CSV export.
- Added migration from v2 preferences and queue storage.
- Added a multilingual GitHub Pages installer.
- Added dependency-free build, syntax checks, and automated tests.
