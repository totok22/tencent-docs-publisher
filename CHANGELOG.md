# Changelog

All notable changes to Tencent Docs Publisher will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.14] - 2026-09-11

### Changed

- Declare the settings with Obsidian's declarative settings API, so every option shows up in settings search. This raises `minAppVersion` to 1.13.0.
- Style destructive buttons with `setDestructive()` instead of the deprecated `setWarning()`.
- Drop the redundant `README_EN.md` now that `README.md` is the English readme; the language links point at `README.md` and `README_ZH.md`.
- Fill in release notes automatically when a tag creates a release.

### Fixed

- Refresh the settings tab and the sidebar project list only after you confirm that a project should be removed; both used to re-render as soon as the confirmation dialog opened.
- Give the settings row that clears the remote page cache a label and description that match what it does; the button used to sit under an unrelated "publish history" row.

## [0.1.13] - 2026-09-11

### Changed

- Add `README_ZH.md` and make `README.md` the English readme, so the plugin directory sees an English description.

### Fixed

- Remove the word "Obsidian" from the plugin description, which the community plugin directory rejects.

## [0.1.12] - 2026-09-11

### Changed

- Reword command names, menus, dialogs and status labels so each one says what it does and what to do next.
- Split the readme into separate English and Chinese files.

## [0.1.11] - 2026-09-11

### Changed

- Make menus and command checks use indexed project lookups, avoid rewriting unchanged plugin data during startup, and let the interface render a progress notice before longer operations.
- Reuse fresh remote page snapshots during whole-tree preflight instead of immediately reading every bound page a second time, and avoid unnecessary Vault reads when metadata is already cached.

### Fixed

- Treat the number in an Obsidian image size hint (`![[photo.png|514]]`) as a size, not as a caption: it no longer shows up as text under the image, and it becomes the Tencent `<Image>` width. A `514x300` hint sets both values.
- Compute the proportional height from the image's own pixel size when only a width is given. Tencent keeps whatever width/height it receives and otherwise falls back to the intrinsic height, which stretched the image.
- Correctly detect SVG files whose opening tag contains attributes, and reject malformed or zero-sized image dimensions.

## [0.1.10] - 2026-09-11

### Fixed

- Place text that follows the last child page card of the document root directly below that card; the previous logic merged it into an earlier block.
- Warn instead of silently misplacing text that belongs above a leading card or below a trailing card inside a sub page, and never fall back to an anchorless insert on a sub page.

## [0.1.9] - 2026-09-11

### Fixed

- Keep an inline mention of a child page (for example a table cell or a sentence containing the link) as plain text; it used to leave an internal marker in the body and abort the publish.
- Ignore the presentation values Tencent recomputes on its own (computed width/height on images and math blocks, and the internal reference id inside inline formulas) when comparing remote content, so merely opening the document no longer reports every page as remotely edited.

## [0.1.8] - 2026-09-11

### Changed

- Reword every menu entry, dialog, status label and setting so it says what will happen and what to do next; plugin menu items now sit in their own menu section and only appear when they can run.
- The publish check always offers a publish button: pages whose remote copy changed since the last publish are listed with an "overwrite these N pages" switch instead of silently disabling publishing.
- "Stop on conflict" is now optional in practice: turning it off overwrites remotely edited pages without asking each time.

### Fixed

- Place content around child page cards instead of collapsing it to one block at the top: every standalone local link to a child page becomes a boundary, so text before and after a card stays on that side when the card was dragged in the Tencent UI.
- Warn instead of silently misplacing content when two child page cards are adjacent and Tencent refuses to insert between them.
- Never write unresolved image or attachment placeholders into the document.

## [0.1.7] - 2026-09-11

### Fixed

- Write into a sub page by anchoring on an ordinary block that belongs to it; an empty sub page is now skipped with an actionable message instead of silently appending its content to the document root page.
- Convert block math into a MathBlock component, outside code fences, so formulas keep their backslash text and backslash Omega escapes and no longer collect a random id suffix.
- Warn about unpaired $$ delimiters instead of writing them silently.
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
