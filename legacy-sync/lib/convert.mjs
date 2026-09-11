/**
 * Obsidian Markdown → 腾讯文档智能文档 MDX 转换。
 *
 * 返回一组「顶层块」，便于后续按块分批写入（避免单次请求体过大）。
 * 图片 / 附件先以占位符形式产出，由调用方解析成真实资源（上传图片、导入 PDF）。
 */
import { IMAGE_EXTS } from "./vault.mjs";

const TOKEN_IMG = "\u0000TDIMG";
const TOKEN_FILE = "\u0000TDFILE";
const TOKEN_END = "\u0000";

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function stripFrontmatter(lines) {
  if (lines.length && lines[0].trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") return lines.slice(i + 1);
    }
  }
  return lines;
}

function stripComments(text) {
  return text.replace(/%%[\s\S]*?%%/g, "");
}

function escAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

export class Converter {
  constructor({ vault, sourceFile }) {
    this.vault = vault;
    this.sourceFile = sourceFile;
    this.assets = []; // { kind: 'image'|'file', absPath, label }
    this.warnings = [];
  }

  #addAsset(kind, absPath, label) {
    const idx = this.assets.length;
    this.assets.push({ index: idx, kind, absPath, label });
    const head = kind === "image" ? TOKEN_IMG : TOKEN_FILE;
    return `${head}${idx}${TOKEN_END}`;
  }

  #wikilink(inner, isEmbed) {
    const [rawTarget, ...aliasParts] = inner.split("|");
    const alias = aliasParts.join("|").trim();
    const target = rawTarget.split("#")[0].trim();
    const abs = this.vault.resolve(rawTarget, this.sourceFile);
    const ext = abs ? (abs.match(/\.[^./\\]+$/) || [""])[0].toLowerCase() : "";

    if (abs && IMAGE_EXTS.has(ext)) {
      // ![[img.png|300]] 里的别名可能是尺寸，忽略它
      const label = isEmbed && alias && !/^\d+$/.test(alias) ? alias : "";
      return this.#addAsset("image", abs, label);
    }
    if (abs && ext === ".pdf") {
      const label = alias || this.vault.relative(abs).split("/").pop();
      return this.#addAsset("file", abs, label);
    }
    if (abs && ext && ext !== ".md") {
      const label = alias || this.vault.relative(abs).split("/").pop();
      return this.#addAsset("file", abs, label);
    }
    if (!abs) {
      this.warnings.push(`链接未解析：[[${inner}]]`);
    }
    if (alias) return alias;
    return target.split("/").pop().replace(/\.md$/i, "");
  }

  /** 行内转换：只在「非代码、非行内公式」片段上工作。 */
  #inline(text) {
    const PROTECT = /(`[^`\n]*`|\$[^$\n]*\$)/g;
    // 行内代码 / 行内公式先换成占位符，避免它们的符号干扰后面的样式替换；
    // 用「先整体替换、再还原」而不是 split，这样 **加粗** 可以跨过行内公式。
    const stash = [];
    let s = text.replace(PROTECT, (m) => {
      stash.push(m);
      return `\u0001${stash.length - 1}\u0001`;
    });

    // Obsidian 链接与嵌入
    s = s.replace(/!\[\[([^\]]+)\]\]/g, (_, inner) => this.#wikilink(inner, true));
    s = s.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => this.#wikilink(inner, false));
    // 行内样式：必须用 <Mark>，腾讯侧不接受 markdown 的 ** 写法
    s = s.replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, "<Mark bold>$1</Mark>");
    s = s.replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, "<Mark italic>$1</Mark>");
    s = s.replace(/~~(?!\s)([^~\n]+?)(?<!\s)~~/g, "<Mark strike>$1</Mark>");
    s = s.replace(/==(?!\s)([^=\n]+?)(?<!\s)==/g, '<Mark backgroundColor="yellow">$1</Mark>');

    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => stash[Number(i)]);
  }

  #splitRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  }

  #table(lines, start) {
    const rows = [];
    let i = start;
    rows.push(this.#splitRow(lines[i]));
    i += 2; // 跳过分隔行
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || !l.includes("|")) break;
      rows.push(this.#splitRow(l));
    }
    const P = "    ";
    const out = ["<Table>"];
    for (const row of rows) {
      out.push(P + "<TableRow>");
      for (const cell of row) {
        out.push(P.repeat(2) + "<TableCell>");
        out.push(P.repeat(3) + this.#inline(cell));
        out.push(P.repeat(2) + "</TableCell>");
      }
      out.push(P + "</TableRow>");
    }
    out.push("</Table>");
    return { block: out.join("\n"), next: i };
  }

  /** 主入口：返回 { blocks: string[], assets, warnings } */
  convert(markdown) {
    let lines = stripFrontmatter(stripComments(markdown).split(/\r?\n/));
    const blocks = [];
    let buf = [];
    let fence = null;

    const flush = () => {
      const text = buf.join("\n").replace(/\s+$/, "");
      if (text.trim()) blocks.push(text);
      buf = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fenceHit = line.match(FENCE_RE);

      if (fence) {
        buf.push(line);
        if (fenceHit && fenceHit[1][0] === fence[0] && fenceHit[1].length >= fence.length) fence = null;
        continue;
      }
      if (fenceHit) {
        fence = fenceHit[1];
        buf.push(line);
        continue;
      }

      // 表格
      if (line.includes("|") && lines[i + 1] && TABLE_SEP_RE.test(lines[i + 1])) {
        flush();
        const { block, next } = this.#table(lines, i);
        blocks.push(block);
        i = next - 1;
        continue;
      }

      // 块级公式
      if (/^\s*\$\$/.test(line)) {
        // 保留缩进：公式常常写在列表项的续行里，去掉缩进会让它跳出列表
        const indent = (line.match(/^[ \t]*/) || [""])[0];
        const collected = [line];
        const sameLineEnd = /\$\$\s*$/.test(line) && line.replace(/^\s*/, "").length > 4;
        if (!sameLineEnd) {
          for (let j = i + 1; j < lines.length; j++) {
            collected.push(lines[j]);
            if (/\$\$\s*$/.test(lines[j])) {
              i = j;
              break;
            }
          }
        }
        const body = collected
          .join("\n")
          .replace(/^\s*\$\$/, "")
          .replace(/\$\$\s*$/, "")
          .trim();
        flush();
        const inner1 = indent + "    ";
        blocks.push(`${indent}<MathBlock>\n${inner1}$$\n${inner1}${body}\n${inner1}$$\n${indent}</MathBlock>`);
        continue;
      }

      // 标题单独成块：源文件里标题常紧跟在列表后面没有空行，
      // 直接拼在一起会被当成列表项的续行。
      if (/^#{1,6}\s+\S/.test(line)) {
        flush();
        blocks.push(this.#inline(line.trimEnd()));
        continue;
      }

      // 空行 → 断块
      if (!line.trim()) {
        flush();
        continue;
      }

      // 待办
      const todo = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/);
      if (todo) {
        flush();
        const indent = " ".repeat(todo[1].length);
        const checked = todo[2].toLowerCase() === "x" ? " checked" : "";
        blocks.push(`${indent}<Todo${checked}>\n${indent}    ${this.#inline(todo[3])}\n${indent}</Todo>`);
        continue;
      }

      buf.push(this.#inline(line));
    }
    flush();

    return { blocks, assets: this.assets, warnings: this.warnings };
  }
}

/** 把解析出的资源替换回占位符，得到可提交的 MDX 文本。 */
export function applyAssets(mdx, assets, resolved) {
  let out = mdx;
  for (const a of assets) {
    const token =
      (a.kind === "image" ? TOKEN_IMG : TOKEN_FILE) + a.index + TOKEN_END;
    const info = resolved.get(a.index);
    if (!info) {
      out = out.split(token).join("");
      continue;
    }
    if (a.kind === "image") {
      const alt = escAttr(a.label || "图片");
      out = out.split(token).join(`<Image src="${info.url}" alt="${alt}" />`);
    } else {
      out = out
        .split(token)
        .join(`<Link href="${info.url}">${a.label || "附件"}</Link>`);
    }
  }
  return out;
}

export { TOKEN_IMG, TOKEN_FILE, TOKEN_END };
