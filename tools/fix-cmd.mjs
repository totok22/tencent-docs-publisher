/**
 * 把本目录下的 .cmd 启动器统一成「纯 ASCII + CRLF」。
 * 原因：cmd.exe 对无 BOM 的 UTF-8 和 LF 换行解析不稳定，
 * 所以批处理只留 ASCII，中文提示交给 Node 输出。
 * 用法：node tools/fix-cmd.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fixed = 0;

for (const name of fs.readdirSync(dir)) {
  if (!name.toLowerCase().endsWith(".cmd")) continue;
  const p = path.join(dir, name);
  const raw = fs.readFileSync(p, "utf8");
  const nonAscii = [...raw].filter((c) => c.charCodeAt(0) > 127);
  if (nonAscii.length) {
    console.warn(`跳过 ${name}：含有 ${nonAscii.length} 个非 ASCII 字符，请先改成 ASCII`);
    continue;
  }
  const crlf = raw.replace(/\r?\n/g, "\r\n");
  if (crlf !== raw) {
    fs.writeFileSync(p, crlf, "ascii");
    console.log(`已转换换行为 CRLF：${name}`);
    fixed++;
  } else {
    console.log(`已是 CRLF：${name}`);
  }
}
console.log(`完成，转换 ${fixed} 个文件。`);
