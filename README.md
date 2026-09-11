# Tencent Docs Publisher

English | [简体中文](./README_ZH.md)

Publish Obsidian Markdown notes and linked note trees to Tencent Docs (Smart Documents).

---

## Network & Third-Party Account Disclosures

- **Third-Party Account**: This plugin requires a Tencent Docs account. You need to obtain an authorization Token from the [Tencent Docs Open Platform](https://docs.qq.com/open/wiki/open-service/mcp.html#_2-1-%E8%8E%B7%E5%8F%96-token).
- **Network Access**: HTTPS requests are sent exclusively to the official Tencent Docs OpenAPI endpoint (`https://docs.qq.com/openapi/mcp`) when triggered manually by the user (e.g., clicking "Test Connection", "Fetch Page Tree", or "Start Publishing"). There is no background synchronization or automatic requests during normal note editing.
- **Credential Storage**: Your Token is stored securely in Obsidian's credential store and is never written into note files, `data.json`, or logs.

---

## Prerequisites

1. **Get Tencent Docs Token**: Visit the [Tencent Docs Authorization Page](https://docs.qq.com/open/wiki/open-service/mcp.html#_2-1-%E8%8E%B7%E5%8F%96-token), log in, and copy your Token.
2. **Prepare Target Document**: If publishing a note tree with multiple notes, manually create the corresponding sub-pages in the Tencent Docs web interface beforehand (the API currently does not support creating sub-pages programmatically).

---

## Installation

### Option 1: Obsidian Community Plugins (Recommended)

> This plugin is submitted to the Obsidian Community Plugin directory. Once approved, install directly inside Obsidian:

1. Open Obsidian **Settings -> Community plugins**.
2. Turn off Restricted mode and click **Browse**.
3. Search for `Tencent Docs Publisher`, click **Install**, and then **Enable**.

### Option 2: Manual Installation via Release

1. Download the latest release assets (`main.js`, `manifest.json`, `styles.css`) from [GitHub Releases](https://github.com/totok22/tencent-docs-publisher/releases).
2. Navigate to your vault's plugin folder: `.obsidian/plugins/`.
3. Create a directory named `tencent-docs-publisher` and place the downloaded files inside.
4. Reload plugins in Obsidian **Settings -> Community plugins** and enable it.

### Option 3: Build from Source

```bash
git clone https://github.com/totok22/tencent-docs-publisher.git
cd tencent-docs-publisher
npm install
npm run build
```

Copy the built files to `.obsidian/plugins/tencent-docs-publisher/` and enable the plugin.

---

## Workflow & Operating Steps

1. **Configure Token**: Enter and save your Token in the plugin settings, then click "Test Connection" to verify.
2. **Create Publishing Project**: Right-click on a note or folder and select "Tencent Docs: New publishing project...". Enter or select the target document ID.
3. **Map Pages**: Match each local note with its corresponding sub-page in the Page Binding modal. Click "Refresh remote tree" after adding new sub-pages in Tencent Docs web app.
4. **Preview & Publish**: Review changes in the Preview modal. Click "Start Publishing" to upload contents and images.

---

## Controls & Interface Reference

### 1. Settings Tab
- **Tencent Docs Token**: Enter and save your Token. Supports connection testing and clearing.
- **Open Authorization Page**: Opens the official token generation page in your browser.
- **Default Public Read Permission**: Enable public read-only permission by default for new projects.
- **Treat `![[Markdown]]` as Sub-page**: When enabled, embedded notes are published as independent sub-pages; otherwise, content is inlined.
- **Stop on Conflict**: Pauses publishing if remote pages were modified externally, requiring manual confirmation.
- **Skip Unchanged Pages**: Skips writing pages that have no local or remote changes.
- **Max Recursion Depth / Max Page Count**: Limits traversal depth and total note count.
- **Show Ribbon Icon**: Displays a shortcut icon on Obsidian's left sidebar.
- **Page Binding**: Opens the page mapping modal for a project.
- **Open in Tencent Docs (External Link)**: Opens the corresponding document in your browser.
- **Remove Project (Trash Icon)**: Removes the local project configuration without deleting anything in Tencent Docs.
- **Clear Remote Cache**: Clears cached remote document structures.

### 2. New Project Modal
- **Root Note**: File path of the selected starting note.
- **Allowed Folder Scope**: Limits child link resolution to this folder. Links outside this scope remain plain text.
- **Target Document ID (file_ID)**: The file_ID of the target Tencent Smart Document.
- **Select from Existing Documents**: Pick from recently edited documents or search by title.
- **Create New Smart Document**: Creates a blank document on Tencent Docs and fills in its ID.
- **Request Public Read Access**: Grants public read-only permission upon publishing.
- **Create & Fetch Page Tree**: Saves project configuration, fetches page structure, and opens the binding modal.

### 3. Page Binding Modal
- **Sub-page Dropdowns**: Map each local note to a specific Tencent Docs sub-page.
- **Refresh Remote Tree**: Refreshes the list of sub-pages from Tencent Docs.
- **Save Bindings**: Persists mapping configuration.

### 4. Preview & Pre-publish Modal
- **Status Indicators**:
  - `changed`: Local note was modified; publishing will overwrite remote content.
  - `unchanged`: Content is identical; publishing will skip this page.
  - `conflict`: Remote page has external edits; requires confirmation before overwriting.
  - `unbound`: Note is not mapped to any remote sub-page.
  - `error`: Contains errors (e.g. missing images) that must be resolved.
- **Allow Overwriting N Modified Pages**: Confirms overwriting remote changes.
- **Start Publishing**: Executes document content update and image uploads.

### 5. Sidebar Project View
- **Project List**: Displays root path, mapped page counts, publishing status, and shortcuts for publishing, binding, opening, and removing projects.
- **Recent Runs**: Shows past execution steps, durations, and results.

---

## Notes & Boundaries

1. **Manual Execution**: Synchronization runs only when you click "Publish". There is no automatic background sync or file watcher.
2. **Sub-page Creation**: Due to Tencent Docs API limits, sub-pages cannot be created programmatically. Create sub-pages in Tencent Docs web app first, then refresh bindings in the plugin.
3. **Content Overwrite**: Publishing replaces remote page content based on local Markdown. Remote changes will trigger a conflict warning.
4. **Format Support**:
   - Supports headings, bold, italics, lists, tables, code blocks, and blockquotes.
   - Automatically uploads local and web images (including width syntax like `![[image.png|400]]`).
   - Converts internal wiki-links (`[[Note]]`) within the project into native Tencent Docs mentions.
   - Unsupported complex markup falls back to plain text or code blocks.
5. **Data Safety**: Removing a project locally only deletes the plugin's local configuration; it never deletes any files from Tencent Docs.
