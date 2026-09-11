# Tencent Docs Publisher

[English](#tencent-docs-publisher) | [简体中文](#腾讯文档发布器-tencent-docs-publisher)

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


---

# 腾讯文档发布器 (Tencent Docs Publisher)

[English](#tencent-docs-publisher) | [简体中文](#腾讯文档发布器-tencent-docs-publisher)

将 Obsidian 中的 Markdown 笔记与知识树发布到腾讯智能文档。

---

## 网络与第三方账号披露

- **第三方账号**：本插件需要配合腾讯文档账号使用。需在[腾讯文档开放服务平台](https://docs.qq.com/open/wiki/open-service/mcp.html#_2-1-%E8%8E%B7%E5%8F%96-token)获取授权 Token。
- **网络访问**：仅在用户手动点击「测试连接」、「读取页面树」或「开始发布」等操作时，向腾讯文档官方 OpenAPI 服务（`https://docs.qq.com/openapi/mcp`）发起 HTTPS 请求。插件无后台自动上传，不会在编辑笔记时主动发送网络请求。
- **凭据安全**：Token 仅保存在 Obsidian 的安全存储中，不会写入笔记正文、`data.json` 或日志中。

---

## 准备工作

1. **获取腾讯文档 Token**：访问 [腾讯文档授权页面](https://docs.qq.com/open/wiki/open-service/mcp.html#_2-1-%E8%8E%B7%E5%8F%96-token) 登录并复制 Token。
2. **准备目标文档**：如果包含多篇笔记，需先在腾讯智能文档网页端建好对应的子页面（腾讯智能文档暂不支持通过第三方接口新建子页面）。

---

## 安装方法

### 方式一：Obsidian 官方社区插件市场（推荐）

> 待审核上架后可直接在软件内安装：

1. 打开 Obsidian 的 **设置 -> 社区插件**。
2. 确保已关闭「安全模式」，点击「浏览」。
3. 搜索 `Tencent Docs Publisher` 或 `腾讯文档`，点击「安装」并「启用」。

### 方式二：从 Release 手动安装

1. 前往 [GitHub Releases](https://github.com/totok22/tencent-docs-publisher/releases) 页面下载最新版本的发布文件（`main.js`、`manifest.json`、`styles.css`）。
2. 进入 Obsidian 仓库目录下的插件目录：`.obsidian/plugins/`。
3. 新建文件夹 `tencent-docs-publisher`，并将上述三个文件放入该目录。
4. 打开 Obsidian 的 **设置 -> 社区插件**，刷新并启用。

### 方式三：从源码构建

```bash
git clone https://github.com/totok22/tencent-docs-publisher.git
cd tencent-docs-publisher
npm install
npm run build
```

构建完成后，将生成的文件复制到 `.obsidian/plugins/tencent-docs-publisher/` 目录并启用。

---

## 操作顺序

1. **配置 Token**：在插件设置页中粘贴 Token 并点击「保存」，可点击「测试连接」验证是否有效。
2. **新建发布项目**：在需要发布的 Markdown 笔记或文件夹上右键，选择「腾讯文档：新建发布项目…」，填入或搜索选择目标文档。
3. **页面绑定**：在页面绑定窗口核对本地笔记与腾讯文档页面的对应关系。若远端新增了子页面，点击「刷新远端页面树」。
4. **检查与发布**：点击「发布」或「预览」，确认改动无误后点击「开始发布」。

---

## 操作按钮与界面说明

### 1. 插件设置页
- **腾讯文档 token**：填入并保存 Token。支持「测试连接」与「清除」。
- **打开授权页面**：跳转到官方网页获取 Token。
- **默认请求全员可读**：新建项目时默认开启公开只读访问权限。
- **把「![[Markdown]]」当作子页面**：开启时嵌入的 Markdown 独立作为子页面发布；关闭时内容直接平铺在当前页。
- **遇到冲突时停下来**：远端被修改时暂停发布并等待人工确认。
- **跳过没有变化的页面**：内容无变化时跳过写入。
- **最大递归深度** / **最大页面数**：限制发布遍历的层级与笔记总量。
- **在侧边栏显示入口**：在 Obsidian 左侧工具栏显示发布管理图标。
- **页面绑定**：打开项目的映射关系管理面板。
- **在腾讯文档中打开（外链图标）**：直接在浏览器中打开对应的腾讯文档。
- **移除项目（垃圾桶图标）**：移除本地项目配置，不会删除腾讯文档内容。
- **清理远端缓存**：清除本地缓存的远端页面结构数据。

### 2. 新建发布项目窗口
- **发布树根节点**：当前选中的起始笔记路径。
- **允许跟随的文件夹**：限制子页面引用的目录范围，范围外的链接只保留文本。
- **目标文档 ID (file_ID)**：填入腾讯智能文档的 file_ID。
- **从已有文档中选择**：可点击「最近」查看近期编辑文档，或输入标题后点击「搜索」。
- **新建智能文档**：在腾讯文档云端新建一篇空智能文档并自动填入 ID。
- **请求全员可读**：发布时开启公开只读访问权限。
- **创建并读取页面树**：保存配置并读取远端页面结构，进入页面绑定。

### 3. 页面绑定窗口
- **下拉选择框**：为每篇本地笔记指定对应的远端子页面。
- **刷新远端页面树**：重新获取腾讯文档最新的子页面列表。
- **保存绑定**：保存匹配结果。

### 4. 发布前检查与预览窗口
- **状态指示**：
  - `changed`：本地有改动，发布将更新该页面。
  - `unchanged`：内容一致，发布自动跳过。
  - `conflict`：远端有新的手动修改，需确认覆盖后才能发布。
  - `unbound`：尚未绑定对应页面，需先完成绑定。
  - `error`：存在错误，需根据提示修正。
- **允许覆盖 N 个被修改页面**：勾选后确认覆盖远端的手动修改。
- **开始发布**：执行正文写入与图片上传。

### 5. 侧边栏管理面板
- **项目列表**：显示各项目根路径、绑定页数、发布状态，提供快速发布、刷新绑定、打开文档和移除项目操作。
- **最近任务**：查看历史任务的执行步骤、耗时与状态。

---

## 注意事项与使用边界

1. **手动触发**：插件仅在点击发布时执行同步，不会监听文件修改，无后台自动同步。
2. **子页面创建**：因腾讯文档接口限制，无法通过插件自动新建子页面。多页面项目需先在腾讯文档网页端手动建好子页面卡片，再使用插件绑定。
3. **内容覆盖**：以本地 Markdown 为准全量覆盖远端对应页面正文。若远端被手动修改，会触发冲突提示。
4. **格式支持**：
   - 支持常用 Markdown 语法（标题、粗斜体、列表、表格、代码块、引用等）。
   - 支持本地与网络图片自动上传转存，支持指定宽度语法（如 `![[image.png|400]]`）。
   - 支持双链引用，同项目内的链接转换为腾讯文档内部页面提及。
   - 暂不支持的复杂排版将降级为文本或代码块显示。
5. **数据安全**：移除本地项目仅删除本地配置文件，绝不删除腾讯文档云端内容；Token 仅保存在本地存储中。
