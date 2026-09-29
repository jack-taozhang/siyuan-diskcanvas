// 审计 CanvasWorkspace.vue 里所有 editor.X 引用，与 use-canvas-editor.ts
// 的返回对象键做差集 —— 找出"模板引用了但 editor 没提供"的键。
//
// ★ 为什么要做这个（踩坑记录 2026-09-28）★
//
//   「只借用内核」剥离上游业务（演示模式 presentation / AI 搜索 / PNG 导出）时，
//   从 `use-canvas-editor.ts` 的返回对象里删掉了 `presentation`，
//   但 `CanvasWorkspace.vue` 的模板里还有 17 处 `editor.presentation.xxx`。
//
//   后果：**页签能打开，但面板全空白**。因为 Vue 在 render 期间读到
//   `undefined.isActive` 抛 TypeError，而 Vue **自己在内部捕获**这个错误
//   （不会同步抛到 mountCanvasApp 的调用者），所以：
//     - 我们包的 try/catch 捕获不到（不是同步抛出）
//     - 构建通过、断链检查通过、宿主契约检查通过
//     - 内核日志干净（错误只在前端 console）
//   → 只有"模板引用 vs return 键"的差集检查能提前发现。
//
// 退出码：有缺失键 → 1

import fs from "node:fs"

const vuePath = "src/components/canvas/CanvasWorkspace.vue"
const tsPath = "src/canvas/use-canvas-editor.ts"

const vue = fs.readFileSync(vuePath, "utf8")
const ts = fs.readFileSync(tsPath, "utf8")

// 1) 收集模板里的 editor.X（排除 editor. 后跟非标识符的情况）
const used = new Set()
for (const m of vue.matchAll(/\beditor\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
  used.add(m[1])
}

// 2) 收集 use-canvas-editor.ts 末尾 return 对象里的键
//    return { ... },  ["fileInputRef", "stageRef"] )
const retIdx = ts.lastIndexOf("return {")
const retEnd = ts.indexOf('["fileInputRef"', retIdx)
const retBody = ts.slice(retIdx, retEnd > retIdx ? retEnd : retIdx + 6000)

const provided = new Set()
// 形如 `      addNode,`  或 `      settings: computed(...)`
for (const m of retBody.matchAll(/^\s{6}([A-Za-z_$][A-Za-z0-9_$]*)\s*[,:]/gm)) {
  provided.add(m[1])
}
// 展开的 spread（workspaceTree.* 形式已显式列出）
// 但注意：模板用的 editor.expandAllFolders 等已在 return 里显式给出

console.log("editor 引用审计（模板 ↔ 返回对象）")
console.log("─".repeat(56))
console.log(`  模板引用 editor.X 的键：${used.size} 个`)
console.log(`  use-canvas-editor return 的键：${provided.size} 个`)

const missing = [...used].filter(k => !provided.has(k)).sort()

if (missing.length === 0) {
  console.log("  ✔ 无缺失：模板引用的每个 editor.X 都在 return 对象里")
  console.log("─".repeat(56))
  console.log("通过 1 项，失败 0 项")
  process.exit(0)
}

console.log(`  ✘ 缺失 ${missing.length} 个键 —— 会导致渲染期 TypeError、面板空白！`)
console.log("─".repeat(56))
const lines = vue.split("\n")
for (const key of missing) {
  const re = new RegExp("\\beditor\\." + key + "\\b")
  const hits = []
  lines.forEach((l, i) => { if (re.test(l)) hits.push(i + 1) })
  console.log(`  ✘ editor.${key}`)
  console.log(`      ${vuePath} 行 ${hits.join(", ")}`)
  console.log(`      该键未出现在 use-canvas-editor.ts 的 return 对象中。`)
  console.log(`      Vue 在 render 期读 undefined.xxx 会抛 TypeError 并被内部吞掉，`)
  console.log(`      症状是「页签打开但面板空白」，且 try/catch 捕获不到。`)
}
console.log("─".repeat(56))
console.log(`通过 0 项，失败 ${missing.length} 项`)
process.exit(1)
