import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const TARGET_DIRS = ["src"];

const FORBIDDEN = [
  { name: "Math 浮動小数点関数", re: /\bMath\s*\.\s*(sqrt|cbrt|hypot|pow|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|fround|random)\b/ },
  { name: "Date.now / new Date", re: /\b(Date\s*\.\s*now|new\s+Date)\b/ },
  { name: "performance.now", re: /\bperformance\s*\.\s*now\b/ },
  { name: "crypto 乱数", re: /\bcrypto\s*\.\s*(getRandomValues|randomUUID)\b/ },
  { name: "べき乗演算子", re: /\*\*/ },
];

const root = fileURLToPath(new URL("..", import.meta.url));
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith(".js")) scan(full);
  }
}

function scan(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
    for (const rule of FORBIDDEN) {
      if (rule.re.test(line)) {
        violations.push(`${file.replace(root, "")}:${i + 1}  [${rule.name}]  ${line.trim()}`);
      }
    }
  });
}

for (const dir of TARGET_DIRS) walk(join(root, dir));

if (violations.length > 0) {
  console.error("決定論を破る禁止APIを検出しました:\n");
  violations.forEach((v) => console.error("  " + v));
  console.error(`\n合計 ${violations.length} 件`);
  process.exit(1);
}
console.log(`OK: ${TARGET_DIRS.join(", ")} に禁止APIはありません`);
