#!/usr/bin/env node
/**
 * 安装 / 卸载 git 钩子，让提交（或推送）时自动把改动过的文档同步到腾讯文档。
 *
 *   node install-hooks.mjs                 # 安装 post-commit（默认，提交后触发）
 *   node install-hooks.mjs --hook pre-push # 安装 pre-push（推送时触发）
 *   node install-hooks.mjs --uninstall     # 卸载
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { findVaultRoot } from "./lib/vault.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const pick = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};

const hookName = pick("--hook", "post-commit");
const uninstall = argv.includes("--uninstall");
const vaultRoot = findVaultRoot(HERE);
const hookPath = path.join(vaultRoot, ".git", "hooks", hookName);
const marker = "# >>> tencent-docs-sync >>>";

const SCRIPT = `#!/bin/sh
${marker}
# 自动同步：把本次提交里改动过的、已在 config.json 里登记的文档推送到腾讯文档。
# 后台执行，不阻塞 git。日志见 Script/tencent-docs-sync/.cache/hook.log
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$ROOT" ] && exit 0
command -v node >/dev/null 2>&1 || exit 0
LOGDIR="$ROOT/Script/tencent-docs-sync/.cache"
mkdir -p "$LOGDIR"
{
    echo ""
    echo "===== $(date '+%Y-%m-%d %H:%M:%S') ${hookName} ====="
} >>"$LOGDIR/hook.log"
nohup node "$ROOT/Script/tencent-docs-sync/sync.mjs" --changed >>"$LOGDIR/hook.log" 2>&1 </dev/null &
exit 0
# <<< tencent-docs-sync <<<
`;

fs.mkdirSync(path.dirname(hookPath), { recursive: true });

if (uninstall) {
  if (fs.existsSync(hookPath)) {
    const cur = fs.readFileSync(hookPath, "utf8");
    if (cur.includes(marker)) {
      fs.unlinkSync(hookPath);
      console.log(`已卸载钩子：${hookPath}`);
    } else {
      console.log(`该钩子不是本工具安装的，未改动：${hookPath}`);
    }
  } else {
    console.log(`没有可卸载的钩子：${hookPath}`);
  }
  process.exit(0);
}

if (fs.existsSync(hookPath)) {
  const cur = fs.readFileSync(hookPath, "utf8");
  if (!cur.includes(marker)) {
    console.error(
      `已存在同名钩子且不是本工具安装的，为避免覆盖你的设置已中止：\n  ${hookPath}\n` +
        `请手动合并，或用 --hook 选择另一个钩子。`
    );
    process.exit(1);
  }
}

fs.writeFileSync(hookPath, SCRIPT, "utf8");
try {
  fs.chmodSync(hookPath, 0o755);
} catch {
  /* Windows 上无所谓 */
}

console.log(`✓ 已安装 ${hookName} 钩子：${hookPath}`);
console.log(`  触发时机：${hookName === "pre-push" ? "git push 之前" : "每次 git commit 之后"}`);
console.log(`  只同步本次提交里改动过、且已在 config.json 登记的文档。`);
console.log(`  日志：Script/tencent-docs-sync/.cache/hook.log`);

// 用 git 自己的方式跑一遍，确认能被识别
try {
  execFileSync("git", ["hook", "run", hookName], { cwd: vaultRoot, stdio: "pipe" });
  console.log("  自检：git hook run 通过 ✓");
} catch (e) {
  console.log(`  自检未通过（可能因 git 版本过旧，不影响使用）：${e.message.split("\n")[0]}`);
}
