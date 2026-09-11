# Changelog

All notable changes to Tencent Docs Publisher will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
