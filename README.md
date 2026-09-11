# Tencent Docs Publisher

Tencent Docs Publisher（腾讯文档发布器）是一个 Obsidian 桌面插件，用于把当前 Markdown 或由总览 Markdown 组织的链接树，手动发布到腾讯智能文档的根页面和已有子页面。

项目仓库：[github.com/totok22/tencent-docs-publisher](https://github.com/totok22/tencent-docs-publisher)

本项目遵循 [DESIGN.md](DESIGN.md) 0.4 实现基线。Obsidian 是内容源，腾讯文档是展示端；插件不监听保存、不安装 Git 钩子，也不把远端修改自动合并回本地。

## 第一版能力

- 单篇笔记或总览链接树的手动预览与发布；
- 递归发现已有腾讯子页面并保存稳定的 Page ID 绑定；
- 发布图片与 PDF 引用，只处理发布树实际引用的资源；
- 增量哈希、远端冲突提示、任务内恢复快照和发布后回读验证；
- Ctrl+P 命令、文件树/编辑器右键菜单、设置页和发布管理视图；
- 可选请求智能文档与引用 PDF 全员可读。

腾讯公开接口目前不支持可靠地创建、移动、重命名或删除智能文档子页面。缺失的子页面需要先在腾讯文档界面中手动创建，再在插件中刷新并绑定。

## 安装

要求 Obsidian 1.11.4 或更高版本。当前版本仅支持桌面端。

### 通过 BRAT 安装

发布首个 GitHub Release 后，可使用 BRAT 1.1.0 或更高版本安装测试版：

1. 在 Obsidian 社区插件市场安装并启用 BRAT；
2. 执行 BRAT 的 “Add a beta plugin for testing” 命令；
3. 输入 `https://github.com/totok22/tencent-docs-publisher` 或 `totok22/tencent-docs-publisher`；
4. 选择最新版本，随后在社区插件列表中启用 Tencent Docs Publisher。

BRAT 从 GitHub Release 下载 `main.js`、`manifest.json` 和 `styles.css`。因此仓库必须至少发布一个 Release，且 Release 标签、名称和 `manifest.json` 中的版本应完全一致。

### 手动安装

从 [Releases](https://github.com/totok22/tencent-docs-publisher/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，放入 Vault 的 `.obsidian/plugins/tencent-docs-publisher/`，然后重新加载 Obsidian 并启用插件。

## 使用

1. 启用插件后，打开“设置 → Tencent Docs Publisher”；
2. 从[腾讯文档官方授权页面](https://docs.qq.com/scenario/open-claw.html?nlc=1)获取 Token，在设置中粘贴、保存并执行只读连接测试；
3. 从命令面板创建发布项目，选择总览 Markdown，并绑定腾讯智能文档及其已有子页面；
4. 使用快速预览或刷新后预览检查变化，再执行单页或整棵树发布。

首次绑定前，缺失的腾讯子页面需要在腾讯文档界面中手动创建。发布项目移除操作只删除本地配置，不会删除远端文档。

## 本地开发

要求 Node.js 22.12 或更高版本。

```bash
npm ci
npm run check
```

构建产物为 `main.js`。`npm run dev` 会监听源码并持续重建，`npm run check` 会依次完成类型检查、代码规范检查、测试和生产构建。

自动化测试包括 7 个测试文件、47 个测试用例，并覆盖两层页面树、超过 20 个 Block、远端冲突、恢复路径、JSON/SSE MCP 响应、图片和 PDF。发布前仍需在真实 Obsidian Vault 与腾讯测试文档中执行人工验收。

## 发布

`0.1.0` 已作为 [GitHub 预发布版](https://github.com/totok22/tencent-docs-publisher/releases/tag/0.1.0)发布，可用于 BRAT 安装测试。

后续版本使用 `npm version patch`（或 `minor`、`major`），该命令会同步 `package.json`、`manifest.json` 和 `versions.json`，并创建不带 `v` 前缀的 Git 标签。随后执行：

```bash
git push origin main --follow-tags
```

[GitHub Actions 发布工作流](.github/workflows/release.yml)会验证标签、清单和包版本一致，运行完整检查并生成草稿 Release。确认三个发布资产无误后发布草稿，BRAT 即可发现该版本。

Token 获取地址固定为 `https://docs.qq.com/scenario/open-claw.html?nlc=1`。Token 只保存在 Obsidian `SecretStorage`，不会写入 Vault、`data.json` 或日志。网络请求固定发送到 `https://docs.qq.com/openapi/mcp`。

## 数据与安全

- 项目、Page ID 映射、缓存元数据和脱敏任务记录保存在插件 `data.json`；
- Token、Authorization 请求头、正文、资源 base64 和上传 URL 不进入诊断日志；
- 快速预览不发起远端请求，刷新后预览只读；
- 移除项目只删除本地配置，不删除腾讯文档；
- 当前清单标记为仅桌面端；完成设计要求的移动端真实 Vault 验收后，才会取消该限制。

## 范围说明

插件不提供双向同步、自动发布、Git 钩子、Word 模式或任意 MCP Endpoint 配置。完整产品行为、限制、验收标准和测试矩阵见 [DESIGN.md](DESIGN.md)。
