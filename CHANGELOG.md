# Changelog

All notable changes to Tencent Docs Publisher will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Write into a sub page by anchoring on an ordinary block that belongs to it; an empty sub page is now skipped with an actionable message instead of silently appending its content to the document root page.
- Convert block math into a MathBlock component so formulas keep their backslash text and backslash Omega escapes and no longer collect a random id suffix.
- Drop empty Markdown headings, which Tencent rendered as a stray placeholder heading block.

## [0.1.6] - 2026-09-11

### Fixed

- Append content without an anchor when a Tencent page is empty or contains only child Pages, instead of trying to insert at a Page block rejected by Tencent.
- Bump the converter fingerprint so pages published before the Markdown math fix are not incorrectly skipped as unchanged.

## [0.1.5] - 2026-09-11

### Fixed

- Preserve Markdown math and allow LaTeX grouping braces instead of rejecting valid formulas as MDX expressions.
- Escape literal prose braces while retaining the MDX expression safety check outside Markdown math and code.

## [0.1.4] - 2026-09-11

### Fixed

- Preserve a sole child Page when Tencent omits the current-page wrapper from a SmartCanvas read response.

## [0.1.3] - 2026-09-11

### Fixed

- Paginate recent Tencent files and efficiently filter up to 20 SmartCanvas documents instead of stopping after the first mixed-type page.
- Explain the actual and selected parent pages when a manual binding violates the remote hierarchy.

## [0.1.2] - 2026-09-11

### Fixed

- Read child-page titles from direct text inside deployed `<Page>` responses.
- Parse root-page titles from Tencent's deployed `page:{title:"..."}` element representation.

## [0.1.1] - 2026-09-11

### Fixed

- Support the deployed Tencent Docs `top_level_pages[].id` root-page response and titles encoded in the page `element` field.
- Reflect selected document IDs in the setup input and prevent duplicate project creation requests.
- Add the official Tencent Docs Token acquisition link to settings and documentation.

## [0.1.0] - 2026-09-11

### Added

- Initial Obsidian plugin implementation for manually publishing notes and linked note trees to Tencent Docs.
- BRAT-compatible GitHub Release workflow.
