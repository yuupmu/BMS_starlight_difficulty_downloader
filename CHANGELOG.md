# Changelog

## Unreleased

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
