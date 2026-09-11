# Contributing

Bug reports, fixes, and new features are welcome through [GitHub issues](https://github.com/totok22/tencent-docs-publisher/issues) and pull requests.

## Setup

Requires Node.js 20 or newer; CI builds on Node 24.

```bash
git clone https://github.com/totok22/tencent-docs-publisher.git
cd tencent-docs-publisher
npm install
npm run dev    # watch build
npm run build  # production bundle
```

Copying the built plugin into a test vault is covered in the [README](README.md).

## Before you open a pull request

Run `npm run check`. It chains the typecheck, lint, tests, and build, which is the same sequence CI runs.

Fix lint warnings, not only errors. The community plugin directory publishes them in the Scorecard a user sees when browsing, so a warning is a visible defect rather than a private one.

Add a `CHANGELOG.md` entry under `## [Unreleased]` for anything user-visible, using the Keep a Changelog sections already in that file.

Match the surrounding style: tabs, LF line endings, and sentence-case UI text as enforced by the linter.

## Where code goes

[DESIGN.md](DESIGN.md) documents product behavior; [AGENTS.md](AGENTS.md) records the constraints an editor must not break. In short:

- `src/domain/`, `src/application/`, and `src/convert/` are pure logic and must not import `obsidian`. These are the layers with unit tests.
- `src/obsidian/` wraps vault, metadata, and credential access.
- `src/tencent/` holds the MCP client, transport, upload, and permission calls.
- `src/ui/` holds modals and the sidebar view, and `src/main.ts` wires them to commands and menus.

## Tests

Tests are vitest files colocated with the code as `src/**/*.test.ts`. They must not perform network I/O; the pure layers are structured so they run without an Obsidian instance.

## Releasing

Maintainers only. The tag must equal both the `manifest.json` and `package.json` versions, and `.github/workflows/release.yml` verifies that before it builds.

```bash
npm version <x.y.z> --no-git-tag-version
git commit -am "<x.y.z>"
git tag -a <x.y.z> -m "<x.y.z>"
git push origin main --follow-tags
```

The tag creates a draft release with `main.js`, `manifest.json`, and `styles.css` attached alongside a build attestation. Write the release notes and publish the draft.
