import fs from "node:fs"
import path from "node:path"

const root = path.resolve("src")
const files = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(ts|vue)$/.test(e.name)) files.push(p)
  }
})(root)

// 收集所有模块的导出符号
const exported = new Map() // symbol -> module
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const re = /export\s+(?:async\s+)?(?:function|const|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g
  let m
  while ((m = re.exec(src))) {
    if (!exported.has(m[1])) exported.set(m[1], [])
    exported.get(m[1]).push(path.relative(root, f))
  }
  // export { a, b }
  const re2 = /export\s*\{([^}]+)\}/g
  while ((m = re2.exec(src))) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim()
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue
      if (!exported.has(name)) exported.set(name, [])
      exported.get(name).push(path.relative(root, f))
    }
  }
}

// 检查目标文件中「使用了但既无 import 也无本地定义」的大写开头符号
const target = "src/canvas/use-canvas-editor.ts"
const src = fs.readFileSync(target, "utf8")
const lines = src.split("\n")
const imported = new Set()
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  const im = l.match(/^\s*import\s/)
  if (!im) continue
  // 收集 import 段（含多行）
  let block = l
  let j = i
  while (!/\bfrom\b/.test(block) && j < lines.length - 1) { j++; block += "\n" + lines[j] }
  for (const raw of block.match(/[A-Za-z_$][\w$]*/g) ?? []) imported.add(raw)
}
console.log("导入符号数:", imported.size)
