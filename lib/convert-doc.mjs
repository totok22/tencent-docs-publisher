/**
 * Obsidian Markdown → 腾讯 Word 在线文档（doc）的内容分段。
 *
 * 与智能文档不同，Word 版走的是「Markdown 富文本 + 独立资源插入」的路线：
 *   - 文字 / 标题 / 列表 / 表格 / 公式 → insert_markdown 一次搞定（LaTeX 会转成真公式）
 *   - 图片 → insert_image
 *   - PDF 等附件 → insert_attachment(layout_type=2) → 文档里的「文件卡片」（带【查看】按钮）
 *
 * 因此这里产出的是「分段」而不是一整份文档：md 段可以合并批量写入，
 * 图片/附件段需要单独调用对应接口。
 */
import { IMAGE_EXTS } from "./vault.mjs";

const EMBED_RE = /(!?)\[\[([^\]]+)\]\]/g;
const LEADING_PUNCT = /^[：:，,。.、；;）)】」』]+/;

export class DocConverter {
  constructor({ vault, sourceFile }) {
    this.vault = vault;
    this.sourceFile = sourceFile;
    this.assets = []; // { kind:'image'|'attach', absPath, label }
    this.warnings = [];
  }

  #addAsset(kind, absPath, label) {
    const index = this.assets.length;
    this.assets.push({ index, kind, absPath, label });
    return { type: "asset", kind, index };
  }

  /** 把一段 `[[...]]` 归类：图片 / 附件 / 普通笔记链接。 */
  #classify(inner, isEmbed) {
    const [rawTarget, ...aliasParts] = inner.split("|");
    const alias = aliasParts.join("|").trim();
    const target = rawTarget.split("#")[0].trim();
    const abs = this.vault.resolve(rawTarget, this.sourceFile);
    const ext = abs ? (abs.match(/\.[^./\\]+$/) || [""])[0].toLowerCase() : "";

    if (abs && IMAGE_EXTS.has(ext) && isEmbed) {
      const label = alias && !/^\d+$/.test(alias) ? alias : "";
      return this.#addAsset("image", abs, label);
    }
    if (abs && ext && ext !== ".md") {
      const label = alias || abs.split(/[/\\]/).pop();
      return this.#addAsset("attach", abs, label);
    }
    if (!abs) this.warnings.push(`链接未解析：[[${inner}]]`);
    return { type: "text", text: alias || target.split("/").pop().replace(/\.md$/i, "") };
  }

  /** 拆一行，产出 text / asset 片段序列。 */
  #splitLine(line) {
    const out = [];
    let last = 0;
    let m;
    EMBED_RE.lastIndex = 0;
    while ((m = EMBED_RE.exec(line))) {
      const before = line.slice(last, m.index);
      if (before) out.push({ type: "text", text: before });
      const info = this.#classify(m[2], m[1] === "!");
      if (info.type === "asset") {
        // 紧跟在资源后面的标点（如「：」）挪到资源前面，避免形成 ":在..." 这样的残句
        const rest = line.slice(EMBED_RE.lastIndex);
        const punct = (rest.match(LEADING_PUNCT) || [""])[0];
        if (punct) {
          for (let i = out.length - 1; i >= 0; i--) {
            if (out[i].type === "text") { out[i].text += punct; break; }
          }
          EMBED_RE.lastIndex += punct.length;
        }
      }
      out.push(info);
      last = EMBED_RE.lastIndex;
    }
    if (last < line.length) out.push({ type: "text", text: line.slice(last) });
    return out;
  }

  /**
   * @returns {{ segments: Array, assets: Array, warnings: string[] }}
   *   segment: { kind:'md', text } | { kind:'image', index } | { kind:'attach', index }
   */
  convert(markdown) {
    let text = markdown.replace(/%%[\s\S]*?%%/g, "");
    let lines = text.split(/\r?\n/);

    // 去掉 frontmatter
    if (lines.length && lines[0].trim() === "---") {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") { lines = lines.slice(i + 1); break; }
      }
    }

    const items = []; // { type:'line', text } | { type:'md' } | asset
    let fence = null;

    for (const line of lines) {
      const fenceHit = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        items.push({ type: "line", text: line });
        if (fenceHit && fenceHit[1][0] === fence[0] && fenceHit[1].length >= fence.length) fence = null;
        continue;
      }
      if (fenceHit) {
        fence = fenceHit[1];
        items.push({ type: "line", text: line });
        continue;
      }

      // 同一行里的相邻文本片段要拼回一行，不能被当成独立行
      const parts = this.#splitLine(line);
      let pending = "";
      const takePending = () => {
        items.push({ type: "line", text: pending });
        pending = "";
      };
      for (const p of parts) {
        if (p.type === "text") pending += p.text;
        else { takePending(); items.push(p); }
      }
      takePending();
    }

    // 组装分段：连续的文本行合成一个 md 段
    const segments = [];
    let buf = [];
    const flush = () => {
      const text = buf
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (text) segments.push({ kind: "md", text: this.#clean(text) });
      buf = [];
    };

    for (const it of items) {
      if (it.type === "line") {
        buf.push(it.text);
      } else {
        flush();
        segments.push(it.kind === "image" ? { kind: "image", index: it.index } : { kind: "attach", index: it.index });
      }
    }
    flush();

    return { segments, assets: this.assets, warnings: this.warnings };
  }

  /** Word 侧用原生 markdown 表达，所以把 Obsidian 专属写法抹平。 */
  #clean(s) {
    return s
      .replace(/==(?=\S)([^=\n]+?)(?<=\S)==/g, "$1")            // 高亮 → 纯文本
      .replace(/^(\s*)-\s+\[([ xX])\]\s+/gm, "$1- ")            // 待办 → 普通项目符号
      .replace(/[ \t]+$/gm, "");
  }
}
