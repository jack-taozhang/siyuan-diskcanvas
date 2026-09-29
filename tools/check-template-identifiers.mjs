/**
 * 闸门：`.vue` 里「模板 / 脚本用到了、但既没声明也没 import」的标识符。
 * ============================================================================
 *
 * 为什么需要它（真实事故，2026-09-29）
 * ---------------------------------------------------------------------------
 *   画布"点开网格弹层 → 整个界面空白"的根因是**两个构建期发现不了的名字问题**：
 *
 *     ① 脚本里用了 `normalizeCanvasGridSettings`，但 import 那行漏了它；
 *     ② 模板里写了 `stageGridStyle.visible`，而脚本里的名字是 `stageGridBackground`。
 *
 *   打包器（esbuild/rollup）**不解析名字来源**：未声明的标识符被当成全局变量原样发出，
 *   构建照样成功；运行时才抛错。而 Vue 会**吞掉渲染期异常**（只 console.error，
 *   不重新 patch），于是表现成"界面整块空白、且没有任何提示"。
 *
 *   本项目没有可用的类型检查（`tsc --noEmit` 有 100+ 既有错误），
 *   所以这里只做很窄的一件事：**找"名字没有来源"**。
 *
 * ---------------------------------------------------------------------------
 * 扫描范围（两处刻意不同，都是为了"准"）
 * ---------------------------------------------------------------------------
 *   · **模板**：只扫**表达式**（`{{ … }}` 与属性值 `:x="…"` / `@x="…"` / `v-…="…"`），
 *     在其中做**全量标识符**检查。
 *     ★ 这一点踩过坑：如果直接对整段 `<template>` 做扫描、又先把字符串字面量抹掉，
 *       会把属性值里的**代码**一起抹掉，反而把 `:bootstrap="…"` 里的属性名当成标识符
 *       （实测一次报出 771 条假阳性）。只扫表达式才既准又全。
 *   · **脚本**：只看**调用目标** `foo(` 与**成员基座** `foo.`。
 *     TS 的类型位置（`Partial<T>`、`as Foo`、泛型）不构成这两种形态，
 *     参数解构也不会被误判 ⇒ 误报接近零；而"漏 import"的真实形态恰好就是 `foo(...)`。
 *
 *   一个满是假阳性的闸门比没有闸门更糟 —— 它会训练人忽略红色输出。
 *
 * 用法：node tools/check-template-identifiers.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import process from "node:process"

/**
 * 扫描根目录。
 *
 * 支持 `--dir <path>`：单测用临时夹具目录来验证"该报的报、不该报的不报"，
 * 不去改动真实源码（改源码做反向验证很危险，跑完忘了还原就麻烦了）。
 */
const dirArgIndex = process.argv.indexOf("--dir")
const ROOT = dirArgIndex >= 0 && process.argv[dirArgIndex + 1]
  ? resolve(process.argv[dirArgIndex + 1])
  : process.cwd()
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".baseline", ".stripped", ".verify", ".worktrees",
  "dist", "dev", "assets", "docs", "developer_docs",
  "_verify", "_verify-dist", "_verify-chrome-profile",
  /**
   * ★ 跳过 tests/ ★
   *   闸门的夹具（`tests/fixtures/template-identifiers/bad-*.vue`）**故意**是坏的，
   *   用来验证"该报的能报、不该报的不报"。若扫到它们，真正的闸门会永远红 ——
   *   而那正是"闸门被训练成可以忽略"的开始。
   *   单测通过 `--dir` 指定夹具目录来单独跑闸门。
   */
  "tests",
])

/** 语言 / 运行时自带的全局（够用即可，不求穷举） */
const GLOBALS = new Set([
  "Infinity", "NaN", "undefined", "null", "true", "false", "this", "super", "void", "typeof",
  "instanceof", "new", "delete", "in", "of", "as", "keyof", "infer", "is", "satisfies",
  "$attrs", "$el", "$emit", "$event", "$forceUpdate", "$nextTick", "$props", "$refs", "$slots", "$watch",
  "AbortController", "Array", "ArrayBuffer", "BigInt", "Blob", "Boolean", "CustomEvent", "DOMParser",
  "DataView", "Date", "DragEvent", "Element", "Error", "Event", "File", "FileReader", "Float64Array",
  "FormData", "Function", "HTMLButtonElement", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement",
  "Headers", "Image", "Int32Array", "IntersectionObserver", "Intl", "JSON", "KeyboardEvent", "Map",
  "Math", "MouseEvent", "MutationObserver", "Node", "NodeList", "Number", "Object", "PointerEvent",
  "Promise", "Proxy", "RangeError", "Reflect", "RegExp", "Request", "ResizeObserver", "Response",
  "SVGElement", "Set", "String", "Symbol", "SyntaxError", "TextDecoder", "TextEncoder", "TypeError",
  "URL", "URLSearchParams", "Uint32Array", "Uint8Array", "WeakMap", "WeakSet", "WheelEvent",
  "XMLSerializer", "alert", "atob", "btoa", "cancelAnimationFrame", "clearInterval", "clearTimeout",
  "confirm", "console", "crypto", "decodeURI", "decodeURIComponent", "document", "encodeURI",
  "encodeURIComponent", "fetch", "getComputedStyle", "globalThis", "history", "isFinite", "isNaN",
  "localStorage", "location", "matchMedia", "navigator", "parseFloat", "parseInt", "performance",
  "process", "prompt", "queueMicrotask", "requestAnimationFrame", "require", "sessionStorage",
  "setInterval", "setTimeout", "structuredClone", "window",
  // JS 关键字 —— 它们后面跟 `(` 时会被"调用目标"扫描命中（`if (` / `catch (` / `async (`…）
  "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "export", "extends", "finally", "for", "from", "function", "if", "import",
  "instanceof", "let", "new", "return", "switch", "throw", "try", "typeof", "var", "while", "with",
  "yield",
  // Vue 编译器宏（不是运行时名字，也不需要 import）
  "defineEmits", "defineExpose", "defineModel", "defineOptions", "defineProps", "defineSlots", "withDefaults",
  // Vue 选项式写法里常见的对象方法名（`{ mounted(el) {…} }` 会被"调用目标"扫到）
  "activated", "beforeCreate", "beforeDestroy", "beforeMount", "beforeUnmount", "beforeUpdate",
  "created", "deactivated", "destroyed", "methods", "mounted", "render", "setup", "unmounted", "updated",
])

/** import 语句里的绑定名（默认 / 命名 / 别名 / 命名空间） */
function collectImportNames(script) {
  const names = new Set()
  for (const match of script.matchAll(/import\s+([\s\S]*?)\s+from\s+["'][^"']+["']/g)) {
    const clause = match[1].trim().replace(/^type\s+/, "")
    const braced = clause.match(/\{([\s\S]*?)\}/)
    if (braced) {
      for (const part of braced[1].split(",")) {
        const piece = part.trim().replace(/^type\s+/, "")
        if (!piece) continue
        const alias = piece.split(/\s+as\s+/)
        names.add((alias[1] || alias[0]).trim())
      }
    }
    const outside = clause.replace(/\{[\s\S]*?\}/, "")
    for (const part of outside.split(",")) {
      const piece = part.trim().replace(/^type\s+/, "").replace(/,$/, "")
      if (!piece) continue
      if (piece.startsWith("*")) {
        names.add(piece.replace(/^\*\s*as\s*/, "").trim())
      } else {
        names.add(piece)
      }
    }
  }
  return names
}

/** 脚本里声明的名字（声明 / 函数 / 类 / 解构 / 参数解构 / 类型名） */
function collectDeclaredNames(script) {
  const names = new Set()
  const addPattern = (raw) => {
    for (const part of String(raw || "").split(",")) {
      const piece = part.trim()
      if (!piece) continue
      const afterColon = piece.includes(":") ? piece.split(":").pop() : piece
      const clean = afterColon
        /**
         * ★ 剩余项（`const [head, ...rest]`）也是**声明** ★
         *   漏掉 `...` 会产生假阳性：`rest` 被当成"没有来源的标识符"报出来，
         *   而它其实是同一行解构出来的。
         */
        .replace(/^\.\.\./, "")
        .split(/[=\s]/).filter(Boolean)[0]
      if (clean && /^[A-Za-z_$][\w$]*$/.test(clean)) {
        names.add(clean)
      }
    }
  }

  for (const match of script.matchAll(/\b(?:const|let|var|function|class|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1])
  }
  for (const match of script.matchAll(/\b(?:const|let|var)\s*[{[]([\s\S]*?)[}\]]\s*=/g)) {
    addPattern(match[1])
  }
  for (const match of script.matchAll(/\(\s*\{([\s\S]*?)\}\s*(?::[\s\S]*?)?\)\s*(?:=>|\{)/g)) {
    addPattern(match[1])
  }
  for (const match of script.matchAll(/\b(?:interface|type)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1])
  }

  /**
   * ★ 函数/箭头函数的**形参**、`catch (e)` 的绑定，都算"声明" ★
   *   漏了它们会产生一类典型假阳性：`(candidate) => candidate.id` 里的 `candidate`
   *   会被当成"成员基座"报出来 —— 实测占误报的一大部分。
   */
  for (const match of script.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const part of match[1].split(",")) {
      const clean = part.trim().replace(/[:=?][\s\S]*$/, "").trim()
      if (/^[A-Za-z_$][\w$]*$/.test(clean)) {
        names.add(clean)
      }
    }
  }
  for (const match of script.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^()]*)\)/g)) {
    for (const part of match[1].split(",")) {
      const clean = part.trim().replace(/[:=?][\s\S]*$/, "").trim()
      if (/^[A-Za-z_$][\w$]*$/.test(clean)) {
        names.add(clean)
      }
    }
  }
  for (const match of script.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1])
  }
  // 无括号的单参箭头函数：`n => n.id`
  for (const match of script.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*=>/g)) {
    names.add(match[1])
  }

  /**
   * ★ `defineProps` 的两种写法都要收 ★
   *   · 类型式：`defineProps<{ a: string, b?: number }>()`
   *     —— 类型块里可能有**嵌套泛型**（`Record<string, any>`），
   *        所以必须用**配对括号扫描**找 `<>` 的终点，
   *        非贪婪正则会在第一个 `>` 就截断，导致后面的成员收不全（实测踩过）。
   *   · 运行时式：`defineProps({ name: String, size: { type: Number } })` 取**键名**。
   */
  for (const start of script.matchAll(/defineProps\s*</g)) {
    const from = start.index + start[0].length
    let depth = 1
    let at = from
    while (at < script.length && depth > 0) {
      const char = script[at]
      if (char === "<" || char === "{" || char === "(" || char === "[") depth += 1
      if (char === ">" || char === "}" || char === ")" || char === "]") depth -= 1
      at += 1
    }
    const body = script.slice(from, at - 1)
    for (const member of body.split(/[;,\n]/)) {
      // 去掉包裹的花括号/括号：类型式写法是 `defineProps<{ a: string }>()`，
      // 直接 split 出来的第一段会带上 `{`（实测因此漏收成员 ⇒ 误报组件自己的 prop）
      const clean = member.trim()
        .replace(/^[{(\[]+/, "")
        .split(/[?:]/)[0]
        .trim()
        .replace(/^readonly\s+/, "")
      if (/^[A-Za-z_$][\w$]*$/.test(clean)) names.add(clean)
    }
  }
  for (const match of script.matchAll(/defineProps\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    for (const member of match[1].split(/[,\n]/)) {
      const clean = member.trim().split(":")[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(clean)) names.add(clean)
    }
  }

  return names
}

/** 取模板里的**表达式**（`{{ }}` 与属性值），只在这些片段里找标识符 */
function extractTemplateExpressions(template) {
  const chunks = []
  for (const match of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    chunks.push(match[1])
  }
  // 带引号的属性值：`:x="…"` / `@x="…"` / `#default="…"` / `v-xxx="…"`
  /**
   * ★ 必须要求 `v-` 而不是「以 v 开头」★
   *   写成 `[:@#v][-\w:.]*=` 会把 `viewBox="0 0 16 16"`、`version="1"` 这类
   *   普通属性值也当表达式扫，于是 SVG 坐标、`xMidYMid meet` 里的词都会被报成
   *    "没有来源的标识符"（实测就是这批假阳性）。
   */
  for (const match of template.matchAll(/(?::|@|#|v-)[-\w:.]*\s*=\s*"([^"]*)"/g)) {
    chunks.push(match[1])
  }
  for (const match of template.matchAll(/(?::|@|#|v-)[-\w:.]*\s*=\s*'([^']*)'/g)) {
    chunks.push(match[1])
  }
  return chunks
}

/** 模板里 `v-for="x in y"` / `v-slot="{ x }"` 声明的局部名字 */
function collectTemplateLocals(template) {
  const locals = new Set()
  for (const match of template.matchAll(/v-for\s*=\s*"\s*\(?([^")]*?)\)?\s+(?:in|of)\s/g)) {
    for (const part of match[1].split(",")) {
      const clean = part.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(clean)) locals.add(clean)
    }
  }
  for (const match of template.matchAll(/v-slot(?::[\w-]+)?\s*=\s*"\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const clean = part.trim().split(":").pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(clean)) locals.add(clean)
    }
  }
  return locals
}

/** 在代码片段里找标识符（跳过成员访问与对象键） */
function findIdentifiers(code) {
  const used = new Map()
  const cleaned = code
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")

  for (const match of cleaned.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
    const name = match[1]
    const at = match.index ?? 0
    const before = cleaned.slice(Math.max(0, at - 2), at)
    const after = cleaned.slice(at + name.length, at + name.length + 6)

    if (before.endsWith(".")) continue
    // 对象字面量键 / 具名参数：`{ key: v }`、`f(key: v)`
    if (/^\s*:/.test(after)) continue
    if (!used.has(name)) {
      used.set(name, cleaned.slice(Math.max(0, at - 30), at + name.length + 24).replace(/\s+/g, " "))
    }
  }
  return used
}

/** 脚本里只找"调用目标"与"成员基座"—— 这两种形态不可能来自 TS 类型位置 */
function findScriptReferences(script) {
  const used = new Map()
  const cleaned = script
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")

  for (const match of cleaned.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*[.(]/g)) {
    const name = match[1]
    const at = match.index ?? 0

    /**
     * ★ 跳过正则字面量的标志位 ★
     *   `/…/i.test(x)` 会被"成员基座"扫描看成 `i.test(` ⇒ 把 `i` 报成没有来源。
     *   正则标志只有这几个字母，且紧跟在 `/` 后面 —— 这个判据足够准。
     */
    if (/^[dgimsuvy]+$/.test(name) && cleaned[at - 1] === "/") continue

    if (!used.has(name)) {
      used.set(name, cleaned.slice(Math.max(0, at - 30), at + name.length + 24).replace(/\s+/g, " "))
    }
  }
  return used
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, acc)
    } else if (full.endsWith(".vue")) {
      acc.push(full)
    }
  }
  return acc
}

const problems = []
let files = 0
let names = 0

for (const file of walk(ROOT)) {
  const source = readFileSync(file, "utf8")
  /**
   * ★ 要把**所有** `<script>` 块拼起来 ★
   *   有的组件同时有 `<script lang="ts">` 与 `<script setup>`，
   *   只取第一个会漏掉 setup 里的声明 ⇒ 把组件自己的 prop / i18n 函数全报成"没有来源"。
   */
  const scriptBlocks = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  if (scriptBlocks.length === 0) continue

  files += 1
  const script = scriptBlocks.join("\n")
  const template = source.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? ""

  const declared = new Set([
    ...collectImportNames(script),
    ...collectDeclaredNames(script),
    ...collectTemplateLocals(template),
  ])

  const candidates = []
  for (const chunk of extractTemplateExpressions(template)) {
    for (const [name, context] of findIdentifiers(chunk)) {
      candidates.push({ context, name, where: "模板" })
    }
  }
  for (const [name, context] of findScriptReferences(script)) {
    candidates.push({ context, name, where: "脚本" })
  }

  for (const candidate of candidates) {
    names += 1
    if (declared.has(candidate.name) || GLOBALS.has(candidate.name)) continue
    problems.push({ ...candidate, file: relative(ROOT, file) })
  }
}

console.log(`[check-template-identifiers] 扫描 ${files} 个 .vue，检查 ${names} 处标识符引用`)

if (problems.length > 0) {
  const seen = new Set()
  const unique = []
  for (const item of problems) {
    const key = `${item.file}::${item.name}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  console.error(`\n发现 ${unique.length} 处「没有来源的标识符」（构建期不报错，运行时才炸）：`)
  for (const item of unique) {
    console.error(`  ✗ [${item.where}] ${item.file} :: ${item.name}`)
    console.error(`      …${item.context}…`)
  }
  process.exit(1)
}

console.log("[check-template-identifiers] OK")
