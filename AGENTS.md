# AGENTS.md

Constraints for agents editing this repository. Product behavior and design rationale are in `DESIGN.md`; installation and usage are in `README.md`. Read those rather than restating them here.

## Commands

- `npm run check` — typecheck, lint, test, build. Run it before committing.
- `npm test` — vitest. `npm run lint` — ESLint with the community-scanner ruleset.
- `npm version <x.y.z> --no-git-tag-version` — updates `manifest.json` and `versions.json`. Do not edit those version fields by hand. The release tag must equal both versions or `.github/workflows/release.yml` fails.

## Review-failing constraints

The community-plugin review inspects the built release; these rules decide whether it passes.

- `minAppVersion` is 1.13.0 and must not be lowered. `getSettingDefinitions()` and `ButtonComponent.setDestructive()` require it.
- The settings tab declares rows in `getSettingDefinitions()`. Do not reintroduce `display()` — Obsidian bypasses it once definitions exist. Refresh with `this.update()`.
- Settings persist through `plugin.data` and `savePluginData()`. The tab overrides `getControlValue`/`setControlValue` for this; do not read or write `plugin.settings`.
- Never use `window.confirm`, `alert`, or `prompt`. Use `ConfirmationModal`, whose `result` is a `Promise<boolean>`.
- Timers must be `window.setTimeout`/`window.clearTimeout`. The `obsidianmd/prefer-window-timers` rule rejects `activeWindow.setTimeout`.
- Destructive buttons use `setDestructive()`; `setWarning()` is deprecated.
- Text passed to `setName`, `setDesc`, `setButtonText`, `setTooltip`, `setPlaceholder`, `addRibbonIcon`, and `new Notice(...)` is checked for sentence case. Pure-CJK strings pass; do not introduce English title case.
- `addCommand` must omit `hotkeys`, and command ids/names must not contain `command` or repeat the plugin id/name.
- `manifest.json` `description` must not contain "Obsidian" and must end with `.`, `!`, or `?`.

## Boundaries

- `src/domain/`, `src/application/`, and `src/convert/` must not import `obsidian`. Vitest runs without an Obsidian runtime, and only these layers are unit-tested. Reach Obsidian through `src/obsidian/` or the transport and upload adapters in `src/tencent/`.
- `src/main.ts` is the plugin controller: commands, menus, modals, wiring. Keep logic in the layers below it.
- `main.js` is a generated bundle and is gitignored. Never edit or commit it.
- The Tencent token lives only in Obsidian `secretStorage` (`TencentTokenStore`). Never write it to `data.json`, notes, logs, or error text.
- HTTPS traffic goes only to `TENCENT_MCP_ENDPOINT`, and only after an explicit user action. No background sync, polling, or file watchers.

## Conventions

- Keep line endings LF, as `.gitattributes` and `.editorconfig` require.
- UI copy and `DESIGN.md` are Chinese; `CHANGELOG.md`, identifiers, and code comments are English.
- Record user-visible changes in `CHANGELOG.md` under `## [Unreleased]` using Keep a Changelog sections.
- Tests are colocated `src/**/*.test.ts` and must not perform network I/O.
- `.agents/skills/obsidian/` is vendored third-party guidance (MIT, gapmiss). Where it disagrees with ESLint, ESLint wins.
