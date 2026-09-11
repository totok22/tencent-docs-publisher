# Obsidian → 腾讯文档 同步

把仓库里的 Markdown 文档同步到腾讯文档的**智能文档**（smartcanvas）。
图片会重新上传并嵌入，PDF 等附件自动导入成腾讯文档并在正文里插入链接，
公式、标题、列表、表格、代码、引用都能保留。

> **附：Word 模式（`format: "doc"`）**
>
> 工具里还留着一种 Word 在线文档格式，它的好处是能把 PDF 显示成**文件卡片**
> （图标 + 文件名 + 大小 +【查看】按钮），而智能文档只能给超链接——
> 智能文档的接口没有附件组件，这是格式本身的限制。
> 当前配置没有启用它；需要的话在 `config.json` 里加一条 `"format": "doc"` 即可，
> 两种格式可以共存、各写各的目标文档。

## 快速使用

双击 **`一键同步.cmd`**：把「有改动」的文档推上去（没改动会显示跳过）。

命令行方式（参数可叠加）：

```bash
node sync.mjs              # 只同步有改动的条目
node sync.mjs --all        # 全量重推（忽略改动检测）
node sync.mjs --only ESF   # 只同步名字/标题里含 ESF 的条目
node sync.mjs --dry-run    # 只生成 MDX 存到 .cache/，不写入腾讯文档
node sync.mjs --list       # 查看当前配置了哪些条目
node sync.mjs --verify     # 回读腾讯文档，确认同步结果（图片/公式/链接数量）
```

## 配置：config.json

每条记录是「本地文件 → 腾讯文档」的映射：

```json
{
  "docs": [
    {
      "name": "安回延时断开 · 设计说明书",
      "source": "车队/electrical/安回板子与焊接/安回延时断开/设计说明书.md",
      "target": { "title": "ESF", "fileId": "ZlmJdLpVGKHq" }
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `name` | 可选，日志里显示的名字 |
| `source` | 仓库相对路径（相对 Obsidian 仓库根目录） |
| `format` | 可选，`smartcanvas`（默认，智能文档）或 `doc`（Word 在线文档） |
| `target.title` | 腾讯文档标题，仅用于显示和按标题查找 |
| `target.fileId` | 智能文档的 file_id。填了就直接用；不填则按 title 搜索 |

同一个 Markdown 可以同时同步到多个目标（`config.json` 里写多条，`source` 相同、`target` 或 `format` 不同），
各自的同步状态分开记录，不会互相干扰。

**新建目标文档**：需要先有文档，可以在腾讯文档里手动新建一个空的智能文档 / Word 文档，
或者让 Codex 调用 `manage.create_file` 建好再把 file_id 填进来。

`fileId` 最省事的拿法：**不填**，靠 `title` 精确匹配（标题必须和腾讯文档里完全一致）。
填的话必须是文档的内部 file_id，不是 URL 里那串（两者不通用）。
查 file_id 可以问 Codex「用 manage.search_file 搜 XXX」，或者在 `--list` 的输出里对照。

## 自动触发：git 钩子

双击 **`安装Git钩子.cmd`**（默认装 `post-commit`，即每次 `git commit` 之后自动同步）。
只处理「本次提交里改动过、且已在 config.json 登记」的文件，后台执行，不阻塞 git。

```bash
node install-hooks.mjs --hook pre-push   # 改成推送时触发
node install-hooks.mjs --uninstall       # 卸载
```

钩子日志：`.cache/hook.log`。

> `.git/hooks/` 不受版本控制，换电脑或重新克隆后需要再装一次。

## 同步行为

**整篇替换**：先把目标文档现有内容清空，再写入新内容。也就是说，直接在线改的图文会在下次同步时被覆盖。
每次同步前会把原内容备份到 `.cache/backups/<fileId>-<时间>.mdx`。

支持的 Obsidian 语法：

| Obsidian 写法 | 同步后 |
| --- | --- |
| `![[图片.png]]` | 上传为腾讯文档图片并嵌入正文 |
| `![[图片.png\|说明]]` | 同上，并带上 alt 说明 |
| `[[笔记]]` / `[[笔记\|别名]]` | 纯文本（别名优先） |
| `[[规格书.pdf]]` | 自动导入为腾讯文档 PDF，正文里插入超链接 |
| `**加粗**` `*斜体*` `~~删除~~` `==高亮==` | 转为 `<Mark>` 行内样式 |
| `$行内公式$` | 保留为行内公式 |
| `$$块级公式$$` | 转为 `<MathBlock>`，缩进保留（列表内的公式仍在列表里） |
| Markdown 表格 | 转为 `<Table>` 组件 |
| `- [ ]` / `- [x]` | 转为 `<Todo>` / `<Todo checked>` |
| `` 代码块 `` / 行内代码 / 引用 / 分割线 | 原样保留 |
| `%%注释%%` | 丢弃 |

## 已知事项

- **图片每次同步都会重新上传**，文档里拿到的是新的 CDN 地址；用 md5 在同一次运行内去重。
- **PDF 会缓存**（`.cache/assets.json`），只要文件内容没变就复用已导入的文档，不会重复产生副本；改动后重新导入会生成一个新文档，旧的需要手动删。
- 腾讯文档的读取接口不返回超链接的 href（显示成 `[文字]()`），这是它的序列化限制，文档里的链接本身是好的（导出 docx 可验证 `HYPERLINK` 字段）。
- 智能文档导出 docx 时不带块级公式，属于导出限制，文档里正常显示。
- 腾讯文档智能文档的根 `Page` 节点不能删，同步后会保留一个空的根页，不影响内容。

### Word（`doc`）模式补充

- 清空用的是「用空 HTML 整篇覆盖」；`insert_attachment` 要求插入点是**段落起始位置**，
  所以每插一段都会重新取一次 `get_last_operable_pos`，调用次数比智能文档多一些。
- Word 模式每次同步都会重新上传附件（`pre_insert_attachment` 的对象是一次性的），
  不参与 `.cache/assets.json` 的缓存。
- 行内公式 `$...$` 和块级公式 `$$...$$` 会被 `insert_markdown` 直接转成公式，不用特殊处理。
- 智能文档模式里的 `<Mark>` / `<Table>` / `<MathBlock>` 是智能文档专有写法，Word 模式走的是
  原生 Markdown，所以两种模式共用同一份源文件、各自转换（`lib/convert.mjs` 和 `lib/convert-doc.mjs`）。

## 依赖

- Node.js（已在 PATH 里）
- 已授权的腾讯文档 MCP 配置：`%USERPROFILE%\.mcporter\mcporter.json`（由 tencent-docs skill 的 `setup.sh` 写入）

## 维护提醒

改动 `*.cmd` 启动器之后，跑一次 `node tools/fix-cmd.mjs`。
cmd.exe 对无 BOM 的 UTF-8 和 LF 换行解析不稳定，这个脚本会把启动器统一成「纯 ASCII + CRLF」，
所以中文提示一律由 Node 输出，批处理里不写中文。
