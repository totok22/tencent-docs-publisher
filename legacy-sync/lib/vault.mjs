/**
 * Obsidian 仓库相关的路径解析：定位仓库根目录、解析 [[wikilink]] / ![[embed]]。
 */
import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  ".obsidian",
  ".trash",
  ".tmp",
  ".venv",
  ".kilo",
  ".claudian",
  ".claude",
  ".agents",
  ".codex",
  ".matplotlib-cache",
  "node_modules",
  "Waste bin",
]);

/** 从任意起点向上找到包含 .obsidian 的目录。 */
export function findVaultRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".obsidian"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`向上未找到 Obsidian 仓库根目录（起点 ${startDir}）`);
    dir = parent;
  }
}

export const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
]);

export class VaultIndex {
  constructor(root) {
    this.root = root;
    this.byName = new Map(); // 文件名 -> 绝对路径数组
    this.#walk(root);
  }

  #walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        this.#walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        const full = path.join(dir, e.name);
        const arr = this.byName.get(e.name);
        if (arr) arr.push(full);
        else this.byName.set(e.name, [full]);
      }
    }
  }

  /** 按 basename 找候选，优先离 sourceFile 最近的。 */
  #byBasename(name, fromDir) {
    const hits = this.byName.get(name);
    if (!hits || !hits.length) return null;
    if (hits.length === 1) return hits[0];
    const score = (p) => {
      const a = p.split(path.sep);
      const b = fromDir.split(path.sep);
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return i; // 公共前缀越长越靠近
    };
    return hits.slice().sort((x, y) => score(y) - score(x))[0];
  }

  /**
   * 解析 Obsidian 链接目标（`[[...]]` 里的内容）到绝对路径。
   * 顺序：笔记同目录 → 仓库根 → 全库按文件名匹配。
   */
  resolve(target, sourceFile) {
    let t = target.trim();
    if (!t) return null;
    // 去掉 |别名 与 #标题锚点
    t = t.split("|")[0].split("#")[0].trim();
    if (!t) return null;
    t = t.replace(/^\/+/, "");

    const dir = path.dirname(sourceFile);
    const attempts = [
      path.resolve(dir, t),
      path.resolve(this.root, t),
    ];
    for (const a of attempts) {
      if (fs.existsSync(a) && fs.statSync(a).isFile()) return a;
    }

    const base = path.basename(t);
    for (const a of attempts) {
      const withMd = a + ".md";
      if (fs.existsSync(withMd)) return withMd;
    }
    return this.#byBasename(base, dir);
  }

  relative(absPath) {
    return path.relative(this.root, absPath).split(path.sep).join("/");
  }
}
