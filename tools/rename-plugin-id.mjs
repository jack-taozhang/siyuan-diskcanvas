/**
 * 重命名插件标识：`siyuan-diskcanvas` → `siyuan-diskcanvas`
 *
 * 做三类替换，顺序不能反：
 *   ① JSON 清单里的 name / url（结构字段）
 *   ② 源码里的**路径与标识**常量（petal 目录、样式 id、日志前缀、兜底名）
 *   ③ 文档 / 测试 / 验证脚本里的字面量
 *
 * ★ 不改的东西（改了会出事）★
 *   · `STORAGE_KEY = "diskcanvas-plugin-data"` —— petal 里的**设置文件名**。
 *     它不是插件标识，是数据文件名；改了等于把用户设置丢掉。
 *   · 用户已有的 `.canvas` 文件路径 —— 最近文件列表里存的是绝对路径。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
/**
 * 用法：node tools/rename-plugin-id.mjs <旧名> <新名>
 *
 * ★ 为什么改成命令行传参 ★
 *   本脚本会把自己也扫进去（它在仓库里），第一次运行时把
 *   `const OLD = "siyuan-diskcanvas-next"` 这行**也替换掉了** ——
 *   脚本于是变成"旧名=新名"，再跑就是空操作，而且没人看得出来。
 *   写死双方名字的"批量替换脚本"必须把自己排除，或者干脆用参数传。
 */
const OLD = process.argv[2]
const NEW = process.argv[3]
if (!OLD || !NEW) {
  console.error("用法：node tools/rename-plugin-id.mjs <旧名> <新名>")
  process.exit(1)
}

/** 要处理的扩展名（收窄范围，避免误改二进制 / 构建产物） */
const EXTENSIONS = [".ts", ".vue", ".js", ".mjs", ".cjs", ".json", ".scss", ".md"]
/** 跳过的目录 */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "dev", ".verify", ".baseline", ".stripped", "assets", "docs", "developer_docs"])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
    } else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

const files = walk(ROOT)
const changed = []

for (const file of files) {
  const before = readFileSync(file, "utf8")
  if (!before.includes(OLD)) continue
  const after = before.split(OLD).join(NEW)
  writeFileSync(file, after, "utf8")
  const count = before.split(OLD).length - 1
  changed.push(`${relative(ROOT, file)}  ×${count}`)
}

console.log(`已替换 ${changed.length} 个文件：`)
for (const line of changed) console.log("  " + line)

/* 兜底：确认没有漏网的（排除刻意保留的兼容常量） */
const leftovers = []
for (const file of files) {
  const text = readFileSync(file, "utf8")
  const lines = text.split("\n")
  lines.forEach((line, index) => {
    if (!line.includes(OLD)) return
    // 允许：兼容用的旧名常量 / 注释里说明"旧名"
    if (/LEGACY|旧名|兼容|legacy/i.test(line)) return
    leftovers.push(`${relative(ROOT, file)}:${index + 1}  ${line.trim().slice(0, 100)}`)
  })
}
if (leftovers.length) {
  console.log("\n⚠ 仍引用了旧名的位置（请确认是否刻意保留）：")
  for (const line of leftovers) console.log("  " + line)
}
