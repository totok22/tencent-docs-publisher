#!/usr/bin/env node
/**
 * 把 Obsidian 里的 Markdown 同步到腾讯文档「智能文档」。
 *
 * 用法：
 *   node sync.mjs                 # 只同步有改动的条目
 *   node sync.mjs --all           # 全量同步（忽略改动检测）
 *   node sync.mjs --only ESF      # 只同步名字/标题匹配的条目
 *   node sync.mjs --changed       # 只同步最近一次 commit 里改动过的文件（给 git hook 用）
 *   node sync.mjs --dry-run       # 只生成 MDX，不写入腾讯文档
 *   node sync.mjs --list          # 列出配置的同步条目
 *   node sync.mjs --verify        # 回读腾讯文档，汇报同步结果的结构统计
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { McpClient } from "./lib/mcp.mjs";
import { findVaultRoot, VaultIndex, IMAGE_EXTS } from "./lib/vault.mjs";
import { Converter, applyAssets } from "./lib/convert.mjs";
import { DocConverter } from "./lib/convert-doc.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "config.json");
const CACHE_DIR = path.join(HERE, ".cache");
const ASSET_CACHE = path.join(CACHE_DIR, "assets.json");
const STATE_PATH = path.join(CACHE_DIR, "state.json");
const BACKUP_DIR = path.join(CACHE_DIR, "backups");
const CHUNK_CHARS = 8000;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const optValue = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};

const log = (...a) => process.stdout.write(a.join(" ") + "\n");
const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 上传文件到 COS。国内网络下连接层抖动很常见，这里带退避重试。 */
async function putFile(url, buf, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: buf,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.status;
    } catch (e) {
      if (i === tries) throw new Error(`上传失败：${e.message}`);
      log(`     上传重试 ${i}/${tries - 1}（${e.message.slice(0, 60)}）`);
      await sleep(1200 * i);
    }
  }
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
}

// ───────────────────────────── 目标文档定位 ─────────────────────────────

const EXT_BY_FORMAT = {
  smartcanvas: ["smartcanvas"],
  doc: ["doc", "tencentdoc"],
};

async function resolveTargetDoc(client, target, cache, format = "smartcanvas") {
  if (target.fileId) return { fileId: target.fileId, title: target.title || "" };
  const exts = EXT_BY_FORMAT[format] || EXT_BY_FORMAT.smartcanvas;
  const key = `title:${format}:${target.title}`;
  if (cache.targets?.[key]) return cache.targets[key];
  const res = await client.callJson("manage.search_file", { search_key: target.title });
  const hit = (res.list || []).find(
    (f) => exts.includes(f.ext) && f.title === target.title
  );
  if (!hit) {
    throw new Error(
      `没找到名为「${target.title}」的${format === "doc" ? " Word 文档" : "智能文档"}。` +
        `可先手动在腾讯文档里建好，或在 config.json 里直接写 fileId。`
    );
  }
  const found = { fileId: hit.file_id, title: hit.title, url: hit.url };
  cache.targets = cache.targets || {};
  cache.targets[key] = found;
  return found;
}

// ───────────────────────────── 资源解析 ─────────────────────────────

async function resolveAssets(client, assets, assetCache) {
  const resolved = new Map();
  const byHash = new Map();

  for (const a of assets) {
    const buf = fs.readFileSync(a.absPath);
    const hash = md5(buf);

    if (a.kind === "image") {
      if (byHash.has(hash)) {
        resolved.set(a.index, { url: byHash.get(hash) });
        log(`   图片复用：${a.label || path.basename(a.absPath)}`);
        continue;
      }
      const r = await client.callJson("upload_image", {
        file_name: path.basename(a.absPath),
        image_base64: buf.toString("base64"),
      });
      if (!r.image_id) throw new Error(`图片上传失败：${a.absPath} → ${JSON.stringify(r)}`);
      byHash.set(hash, r.image_id);
      resolved.set(a.index, { url: r.image_id });
      log(`   图片已上传：${path.basename(a.absPath)} (${(buf.length / 1024).toFixed(0)} KB)`);
      continue;
    }

    // 附件（PDF 等）：先查缓存，避免重复导入产生副本
    const cached = assetCache.files?.[a.absPath];
    if (cached && cached.md5 === hash && cached.url) {
      resolved.set(a.index, { url: cached.url });
      log(`   附件复用：${path.basename(a.absPath)}`);
      continue;
    }
    log(`   正在导入附件：${path.basename(a.absPath)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
    const imported = await importFile(client, a.absPath, buf);
    assetCache.files = assetCache.files || {};
    assetCache.files[a.absPath] = { md5: hash, file_id: imported.file_id, url: imported.file_url };
    resolved.set(a.index, { url: imported.file_url });
    log(`   附件已导入：${imported.file_url}`);
  }
  return resolved;
}

async function importFile(client, absPath, buf) {
  const name = path.basename(absPath);
  const size = buf.length;
  const hash = md5(buf);

  const pre = await client.callJson("manage.pre_import", {
    file_name: name,
    file_size: size,
    file_md5: hash,
  });
  if (!pre.upload_url) throw new Error(`pre_import 未返回上传地址：${JSON.stringify(pre)}`);

  await putFile(pre.upload_url, buf);

  const kick = await client.callJson("manage.async_import", {
    task_id: pre.task_id,
    file_key: pre.file_key,
    file_name: name,
    file_md5: hash,
    file_size: size,
  });
  const taskId = kick.task_id || pre.task_id;

  for (let i = 0; i < 45; i++) {
    await sleep(4000);
    const p = await client.callJson("manage.import_progress", { task_id: taskId });
    if (p.file_url) return p;
    if (p.error) throw new Error(`导入失败：${p.error}`);
  }
  throw new Error(`导入超时：${name}`);
}

// ───────────────────────────── 读 / 写文档 ─────────────────────────────

async function readWholeDoc(client, fileId) {
  let token;
  let all = "";
  for (let i = 0; i < 60; i++) {
    const r = await client.callJson("smartcanvas.read", {
      file_id: fileId,
      size: 20,
      ...(token ? { next_token: token } : {}),
    });
    all += r.content || "";
    if (!r.next_token) break;
    token = r.next_token;
  }
  return all;
}

/** 回读目标文档，汇报结构统计，用来确认同步结果。 */
async function verifyAll(client, entries, assetCache) {
  for (const entry of entries) {
    const label = entry.name || path.basename(entry.source);
    const format = entry.format || "smartcanvas";
    try {
      const target = await resolveTargetDoc(client, entry.target, assetCache, format);

      if (format === "doc") {
        const doc = new McpClient("doc-mcp");
        const gc = await client.callJson("get_content", { file_id: target.fileId });
        const text = typeof gc === "string" ? gc : gc.content || "";
        const st = await doc.callJson("resolve_document_structure", { file_id: target.fileId });
        const nodes = st.nodes || [];
        const cards = (text.match(/ATTACHMENT /g) || []).length;
        const headings = nodes.filter((n) => n.type === "Heading").length;
        const tables = nodes.filter((n) => n.type === "Table").length;
        const images = nodes.filter((n) => (n.text_preview || "").includes("[Image]")).length;
        log(`▸ ${label}  [Word 文档]`);
        log(`   目标：${target.title || entry.target.title || ""} (${target.fileId})`);
        log(`   正文字符：${text.length}`);
        log(`   标题 ${headings} 个 · 段落 ${nodes.filter((n) => n.type === "Paragraph").length} 个 · 表格 ${tables} 个`);
        log(`   图片 ${images} 张 · 附件卡片 ${cards} 个`);
        log(`   https://docs.qq.com/doc/${target.fileId}`);
        continue;
      }

      const content = await readWholeDoc(client, target.fileId);
      const count = (re) => (content.match(re) || []).length;
      log(`▸ ${label}`);
      log(`   目标：${target.title || entry.target.title || ""} (${target.fileId})`);
      log(`   正文字符：${content.length}`);
      log(`   标题 ${count(/<Heading /g)} 个 · 段落 ${count(/<Paragraph /g)} 个 · 列表项 ${count(/<(BulletedList|NumberedList) /g)} 个`);
      log(`   图片 ${count(/<Image /g)} 张 · 块级公式 ${count(/<MathBlock/g)} 个 · 超链接 ${count(/\]\(/g)} 处`);
      if (target.url) log(`   ${target.url}`);
    } catch (e) {
      log(`▸ ${label}`);
      log(`   ✗ 读取失败：${e.message}`);
    }
  }
}

const ROOT_BLOCK_RE =
  /^<(Heading|Paragraph|BulletedList|NumberedList|Todo|Image|Table|BlockQuote|Callout|ColumnList|Divider|MathBlock)\b[^>]*\bid="([^"]+)"/;

function collectRootBlockIds(mdx) {
  const ids = [];
  for (const line of mdx.split(/\r?\n/)) {
    const m = line.match(ROOT_BLOCK_RE);
    if (m) ids.push(m[2]);
  }
  return ids;
}

/** Page 容器里的空段落也清掉，避免同步后顶部残留空白。 */
function collectEmptyInnerParagraphIds(mdx) {
  const ids = [];
  const pageRe = /<Page\b[^>]*>([\s\S]*?)<\/Page>/g;
  let m;
  while ((m = pageRe.exec(mdx))) {
    const inner = m[1];
    const pRe = /^\s*<Paragraph\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/Paragraph>/gm;
    let p;
    while ((p = pRe.exec(inner))) {
      if (!p[2].trim()) ids.push(p[1]);
    }
  }
  return ids;
}

function chunkBlocks(blocks, maxChars = CHUNK_CHARS) {
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const b of blocks) {
    const add = b.length + 2;
    if (cur.length && len + add > maxChars) {
      chunks.push(cur.join("\n\n"));
      cur = [];
      len = 0;
    }
    cur.push(b);
    len += add;
  }
  if (cur.length) chunks.push(cur.join("\n\n"));
  return chunks;
}

async function syncOne(client, entry, ctx) {
  const { vault, assetCache, state, dryRun, force } = ctx;
  const sourceAbs = path.resolve(vault.root, entry.source);
  if (!fs.existsSync(sourceAbs)) throw new Error(`源文件不存在：${entry.source}`);

  const raw = fs.readFileSync(sourceAbs);
  const hash = md5(raw);
  const label = entry.name || path.basename(entry.source);
  const stateKey = stateKeyFor(entry);
  const format = entry.format || "smartcanvas";

  if (!force && state.docs?.[stateKey]?.sourceHash === hash) {
    log(`  ⏭  ${label}：源文件未变化，跳过`);
    return { skipped: true };
  }

  const target = await resolveTargetDoc(client, entry.target, assetCache, format);
  log(`  → 目标文档：${target.title || entry.target.title} (${target.fileId})`);

  if (format === "doc") {
    return syncOneDoc(client, entry, { ...ctx, sourceAbs, hash, label, target, raw });
  }

  const converter = new Converter({ vault, sourceFile: sourceAbs });
  const { blocks, assets, warnings } = converter.convert(raw.toString("utf8"));
  for (const w of warnings) log(`  ⚠  ${w}`);

  const resolved = await resolveAssets(client, assets, assetCache);
  const finalBlocks = blocks.map((b) => applyAssets(b, assets, resolved));

  if (dryRun) {
    const preview = finalBlocks.join("\n\n");
    const out = path.join(CACHE_DIR, `dryrun-${label.replace(/[\\/:*?"<>|]/g, "_")}.mdx`);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(out, preview, "utf8");
    log(`  📝 试运行：已写出 ${out}（${preview.length} 字符，${finalBlocks.length} 个块）`);
    return { dryRun: true, chars: preview.length };
  }

  // 1) 备份现状
  const current = await readWholeDoc(client, target.fileId);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(BACKUP_DIR, `${target.fileId}-${stamp}.mdx`), current, "utf8");

  // 2) 清空正文
  const ids = [
    ...collectRootBlockIds(current),
    ...collectEmptyInnerParagraphIds(current),
  ];
  for (let i = 0; i < ids.length; i++) {
    await client.callJson("smartcanvas.edit", {
      file_id: target.fileId,
      action: "DELETE",
      id: ids[i],
    });
    if ((i + 1) % 20 === 0) log(`  已删除 ${i + 1}/${ids.length}`);
  }
  log(`  清空旧内容：删除 ${ids.length} 个块`);

  // 3) 分批写入新内容
  const chunks = chunkBlocks(finalBlocks);
  for (let i = 0; i < chunks.length; i++) {
    await client.callJson("smartcanvas.edit", {
      file_id: target.fileId,
      action: "INSERT_AFTER",
      id: "",
      content: chunks[i],
    });
    log(`  写入 ${i + 1}/${chunks.length} 批（${chunks[i].length} 字符）`);
    if (i < chunks.length - 1) await sleep(400);
  }

  state.docs = state.docs || {};
  state.docs[stateKey] = {
    sourceHash: hash,
    targetFileId: target.fileId,
    syncedAt: new Date().toISOString(),
    chars: finalBlocks.join("\n\n").length,
  };
  return { synced: true, blocks: finalBlocks.length, chars: finalBlocks.join("\n\n").length };
}

// ───────────────────────────── 入口 ─────────────────────────────

// ───────────────────────────── Word 文档模式 ─────────────────────────────

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

/**
 * 状态键。同一份源文件可能同步到多个目标（或两种格式），
 * 只用路径当键会互相覆盖，所以要带上格式和目标。
 */
function stateKeyFor(entry) {
  const format = entry.format || "smartcanvas";
  const target = entry.target?.fileId || entry.target?.title || "?";
  return `${format}|${target}|${entry.source}`;
}

async function docLastPos(doc, fileId) {
  const p = await doc.callJson("get_last_operable_pos", { file_id: fileId });
  return Number(p.position ?? p.idx ?? p.last_index);
}

/** 把连续的 md 段合并成几次 insert_markdown 调用，减少往返。 */
function mergeMdSegments(segments, maxChars = 6000) {
  const out = [];
  let cur = null;
  for (const s of segments) {
    if (s.kind === "md") {
      if (cur && cur.text.length + s.text.length + 2 > maxChars) {
        out.push(cur);
        cur = null;
      }
      if (cur) cur.text += "\n\n" + s.text;
      else cur = { kind: "md", text: s.text };
    } else {
      if (cur) { out.push(cur); cur = null; }
      out.push(s);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 清空目标文档，然后按分段把内容写进去。 */
async function writeDocPhase(doc, target, plan, assets) {
  await doc.callJson("overwrite_doc_with_html", {
    file_id: target.fileId,
    base64_html_text: b64("<p></p>"),
  });
  log("  已清空旧内容");

  let idx = await docLastPos(doc, target.fileId);
  let step = 0;
  for (const seg of plan) {
    step++;
    const tag = `${step}/${plan.length}`;
    // 每个插入点都重新取一次：附件要求「段落起始位置」，last_index 不保证满足
    idx = await docLastPos(doc, target.fileId);

    if (seg.kind === "md") {
      await doc.callJson("insert_markdown", {
        file_id: target.fileId,
        idx,
        base64_markdown: b64(seg.text),
      });
      log(`  [${tag}] 文本 ${seg.text.length} 字符`);
    } else if (seg.kind === "image") {
      const asset = assets[seg.index];
      const buf = fs.readFileSync(asset.absPath);
      await doc.callJson("insert_image", {
        file_id: target.fileId,
        idx,
        content: buf.toString("base64"),
      });
      log(`  [${tag}] 图片 ${path.basename(asset.absPath)} (${(buf.length / 1024).toFixed(0)} KB)`);
    } else {
      const asset = assets[seg.index];
      const buf = fs.readFileSync(asset.absPath);
      const ext = path.extname(asset.absPath).replace(".", "").toLowerCase();
      const pre = await doc.callJson("pre_insert_attachment", {
        file_id: target.fileId,
        file_name: path.basename(asset.absPath),
        size: buf.length,
        ext,
      });
      await putFile(pre.upload_url, buf);
      await doc.callJson("insert_attachment", {
        file_id: target.fileId,
        idx,
        object_key: pre.object_key,
        upload_success: true,
        file_name: path.basename(asset.absPath),
        size: buf.length,
        file_type: ext,
        layout_type: 2, // 卡片态：图标 + 文件名 + 大小 +【查看】
        classify: 3, // 文档
        text: asset.label || path.basename(asset.absPath),
      });
      log(`  [${tag}] 附件卡片 ${path.basename(asset.absPath)} (${(buf.length / 1024).toFixed(0)} KB)`);
    }
    await sleep(250);
  }
}

async function syncOneDoc(coreClient, entry, ctx) {
  const { vault, assetCache, state, dryRun, force, sourceAbs, hash, label, target, raw } = ctx;
  const doc = new McpClient("doc-mcp");
  const stateKey = stateKeyFor(entry);

  const converter = new DocConverter({ vault, sourceFile: sourceAbs });
  const { segments, assets, warnings } = converter.convert(raw.toString("utf8"));
  for (const w of warnings) log(`  ⚠  ${w}`);

  const plan = mergeMdSegments(segments);
  const stats = {
    md: plan.filter((s) => s.kind === "md").length,
    image: plan.filter((s) => s.kind === "image").length,
    attach: plan.filter((s) => s.kind === "attach").length,
  };

  if (dryRun) {
    const preview = plan
      .map((s) => (s.kind === "md" ? s.text : `【${s.kind === "image" ? "图片" : "附件卡片"}：${assets[s.index]?.label || ""}】`))
      .join("\n\n");
    const out = path.join(CACHE_DIR, `dryrun-${label.replace(/[\\/:*?"<>|]/g, "_")}.doc.md`);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(out, preview, "utf8");
    log(`  📝 试运行：${stats.md} 段文本 · ${stats.image} 张图 · ${stats.attach} 个附件卡片`);
    log(`     预览：${out}`);
    return { dryRun: true, chars: preview.length };
  }

  // 1) 备份现状
  const before = await coreClient.callJson("get_content", { file_id: target.fileId });
  const beforeText = typeof before === "string" ? before : before.content || "";
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(BACKUP_DIR, `${target.fileId}-${stamp}.txt`), beforeText, "utf8");

  // 2) 清空 + 逐段写入。中途失败会留下半成品，所以整体再重来一次（开头会重新清空，重跑是安全的）。
  let writeErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await writeDocPhase(doc, target, plan, assets);
      writeErr = undefined;
      break;
    } catch (e) {
      writeErr = e;
      if (attempt === 1) {
        log(`  ⚠  写入中断：${e.message.slice(0, 90)}，2 秒后整体重来一次`);
        await sleep(2000);
      }
    }
  }
  if (writeErr) throw writeErr;

  state.docs = state.docs || {};
  state.docs[stateKey] = {
    sourceHash: hash,
    targetFileId: target.fileId,
    format: "doc",
    syncedAt: new Date().toISOString(),
    segments: plan.length,
  };
  const mdChars = plan.filter((s) => s.kind === "md").reduce((a, s) => a + s.text.length, 0);
  return { synced: true, chars: mdChars, blocks: plan.length, images: stats.image, attachments: stats.attach };
}

function changedFilesInHead(vaultRoot) {
  try {
    return execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], {
      cwd: vaultRoot,
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (e) {
    log(`  ⚠  读取 git 变更失败（${e.message.split("\n")[0]}），将同步全部条目`);
    return null;
  }
}

async function main() {
  const config = readJson(CONFIG_PATH, null);
  if (!config?.docs?.length) throw new Error(`config.json 里没有配置任何 docs：${CONFIG_PATH}`);

  if (flag("--list")) {
    for (const d of config.docs) {
      log(`· ${d.name || path.basename(d.source)}  [${d.format === "doc" ? "Word 文档" : "智能文档"}]`);
      log(`    源：${d.source}`);
      log(`    目标：${d.target?.title || "?"} ${d.target?.fileId ? `(${d.target.fileId})` : "(按标题查找)"}`);
    }
    return;
  }

  const vaultRoot = findVaultRoot(HERE);
  const vault = new VaultIndex(vaultRoot);
  const assetCache = readJson(ASSET_CACHE, { files: {}, targets: {} });
  const state = readJson(STATE_PATH, { docs: {} });

  let entries = config.docs.slice();
  const only = optValue("--only");
  if (only) {
    entries = entries.filter(
      (d) =>
        (d.name && d.name.includes(only)) ||
        d.source.includes(only) ||
        (d.target?.title && d.target.title.includes(only))
    );
    if (!entries.length) throw new Error(`没有条目匹配 --only ${only}`);
  }
  if (flag("--changed")) {
    const changed = changedFilesInHead(vaultRoot);
    if (changed) {
      const set = new Set(changed.map((p) => p.split("/").join(path.sep)));
      entries = entries.filter((d) => set.has(d.source.split("/").join(path.sep)));
      if (!entries.length) {
        log("本次提交没有涉及已配置的同步文档，跳过。");
        return;
      }
    }
  }

  const client = new McpClient("tencent-docs");
  await client.initialize();

  if (flag("--verify")) {
    await verifyAll(client, entries, assetCache);
    writeJson(ASSET_CACHE, assetCache);
    return;
  }

  log("▸ Obsidian → 腾讯文档 同步");
  log(`▸ 待处理 ${entries.length} 个文档`);
  const results = [];
  for (const entry of entries) {
    const label = entry.name || path.basename(entry.source);
    log(`\n▸ ${label}`);
    try {
      const r = await syncOne(client, entry, {
        vault,
        assetCache,
        state,
        dryRun: flag("--dry-run"),
        force: flag("--all") || flag("--force"),
      });
      results.push({ label, ok: true, ...r });
    } catch (e) {
      log(`  ✗ 失败：${e.message}`);
      results.push({ label, ok: false, error: e.message });
    }
  }

  writeJson(ASSET_CACHE, assetCache);
  writeJson(STATE_PATH, state);

  const failed = results.filter((r) => !r.ok);
  log("\n──────── 汇总 ────────");
  for (const r of results) {
    const status = !r.ok ? "✗ 失败" : r.skipped ? "⏭ 跳过" : r.dryRun ? "📝 试运行" : "✓ 已同步";
    const detail = r.attachments != null
      ? `（${r.chars} 字符 · ${r.images} 图 · ${r.attachments} 个附件卡片）`
      : r.chars ? `（${r.chars} 字符）` : "";
    log(`  ${status}  ${r.label}${detail}`);
  }
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  log(`\n运行失败：${e.message}`);
  process.exitCode = 1;
});
