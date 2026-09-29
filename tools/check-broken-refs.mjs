#!/usr/bin/env node
/**
 * 断链检测器 —— 找出「被调用但既未 import、也非本地定义」的标识符。
 *
 * 背景：本轮剥离上游业务层时，用 Python 脚本删掉了 import 语句，
 * 但代码体里的调用点还在。vite/esbuild 不做跨模块符号解析，构建**照样通过**，
 * 运行时才崩（ReferenceError / is not a function）。教训：构建通过 ≠ 运行正确。
 *
 * 于是写了这个检测器，作为剥离过程中的硬验证手段。
 *
 * 用法：
 *   node tools/check-broken-refs.mjs                 # 检查默认目标（被剥离的核心装配器）
 *   node tools/check-broken-refs.mjs --all           # 检查 src 下全部文件（噪声较多，见下）
 *   node tools/check-broken-refs.mjs <文件...>       # 检查指定文件
 *
 * ★ 关于 --all 的噪声 ★
 *   全项目扫描会报出大量**假阳性**：class 方法调用、对象字面量键、
 *   SQL 关键字（WHERE/AND）、SVG path 数据（M23）、Vue 生命周期（setup/updated）、
 *   宿主字典取值（dict.get）等。这些都不是「被删掉的 import」。
 *   所以默认只扫**剥离过的文件**，全量扫描需显式 --all。
 */
import fs from "node:fs"
import path from "node:path"

const SRC = path.resolve("src")

/** 默认检查目标：本轮剥离实际动过的文件 */
const DEFAULT_TARGETS = [
  "src/canvas/use-canvas-editor.ts",
]

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p)
  }
  return out
}

const files = walk(SRC)

/** symbol -> [module,...] 全项目导出符号表 */
const exportIndex = new Map()
function addExport(sym, file) {
  if (!sym) return
  if (!exportIndex.has(sym)) exportIndex.set(sym, new Set())
  exportIndex.get(sym).add(path.relative(SRC, file))
}

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  let m
  const reDecl = /export\s+(?:declare\s+)?(?:async\s+)?(?:default\s+)?(?:function|const|let|var|class|type|interface|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g
  while ((m = reDecl.exec(src))) addExport(m[1], f)
  // export { a, b as c }
  const reList = /export\s*\{([^}]*)\}/g
  while ((m = reList.exec(src))) {
    for (const raw of m[1].split(",")) {
      const parts = raw.trim().split(/\s+as\s+/)
      addExport((parts[1] ?? parts[0]).trim(), f)
    }
  }
  // export * from "..." —— 保守处理，跳过（无法静态解析）
}

/** 从源码中提取 import 引入的符号 + 本地定义 + 参数/变量声明 */
function collectBound(src) {
  const bound = new Set()

  // import 段（跨行）
  const lines = src.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*import\b/.test(lines[i])) continue
    let block = lines[i]
    let j = i
    while (!/\bfrom\b\s*["']/.test(block) && j < lines.length - 1) {
      j++
      block += "\n" + lines[j]
    }
    // 去掉 import 关键字，取花括号内 + default + namespace
    const withoutKeyword = block.replace(/^\s*import\b/, "")
    const fromIdx = withoutKeyword.search(/\bfrom\b\s*["']/)
    const clause = fromIdx >= 0 ? withoutKeyword.slice(0, fromIdx) : withoutKeyword
    for (const raw of clause.split(/[{},]/)) {
      const t = raw.trim().split(/\s+as\s+/).pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(t) && t !== "type" && t !== "import") bound.add(t)
    }
    i = j
  }

  // 本地声明
  const declRes = [
    /\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  ]
  for (const re of declRes) {
    let m
    while ((m = re.exec(src))) bound.add(m[1])
  }

  // 解构声明 const { a, b } = / const [a, b] = / 函数参数解构
  const reDestr = /(?:const|let|var|\()\s*[{[]([^}\]]*)[}\]]\s*(?:=|:|\)|=>)/g
  let m
  while ((m = reDestr.exec(src))) {
    for (const raw of m[1].split(",")) {
      const t = raw.trim().split(/[:=]/)[0].trim().split(/\s+as\s+/).pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(t)) bound.add(t)
    }
  }

  // 解构重命名别名： const { save: saveImpl } = ...  → 绑定 saveImpl
  const reAlias = /[{,]\s*[A-Za-z_$][\w$]*\s*:\s*([A-Za-z_$][\w$]*)\s*[,}]/g
  while ((m = reAlias.exec(src))) bound.add(m[1])

  // 函数参数（简单形式 fn(a, b) / fn(a: X, b: Y)）
  const reParams = /\b(?:function\s+[A-Za-z_$][\w$]*|\([^()]*\)\s*=>|async\s*\([^()]*\)\s*=>)\s*\(([^)]*)\)/g
  while ((m = reParams.exec(src))) {
    for (const raw of m[1].split(",")) {
      const t = raw.trim().split(/[:=]/)[0].trim().split(/\s+as\s+/).pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(t)) bound.add(t)
    }
  }

  // catch / for 绑定
  const reMisc = /\b(?:catch|for)\s*\(\s*([A-Za-z_$][\w$]*)/g
  while ((m = reMisc.exec(src))) bound.add(m[1])

  return bound
}

/** TS 全局 / 内置，及已知的运行期全局 */
const GLOBALS = new Set([
  // JS 内置
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Math", "JSON", "Date",
  "RegExp", "Error", "TypeError", "RangeError", "SyntaxError", "EvalError", "ReferenceError",
  "Promise", "Map", "Set", "WeakMap", "WeakSet", "Proxy", "Reflect", "Function", "Infinity",
  "NaN", "undefined", "globalThis", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI",
  "encodeURIComponent", "decodeURI", "decodeURIComponent", "eval", "escape", "unescape",
  "Intl", "ArrayBuffer", "DataView", "Uint8Array", "Int8Array", "Uint16Array", "Int16Array",
  "Uint32Array", "Int32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "SharedArrayBuffer", "Atomics", "WeakRef", "FinalizationRegistry", "structuredClone", "queueMicrotask",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame",
  "cancelAnimationFrame", "fetch", "URL", "URLSearchParams", "TextEncoder", "TextDecoder",
  "AbortController", "AbortSignal", "Blob", "File", "FileReader", "FormData", "Headers", "Request",
  "Response", "Event", "CustomEvent", "EventTarget", "Document", "Window", "Navigator", "Location",
  "History", "Storage", "HTMLElement", "HTMLInputElement", "HTMLDivElement", "HTMLCanvasElement",
  "SVGElement", "Element", "Node", "NodeList", "DOMParser", "XMLSerializer", "MutationObserver",
  "ResizeObserver", "IntersectionObserver", "Image", "ImageData", "OffscreenCanvas", "Path2D",
  "DOMMatrix", "matchMedia", "getComputedStyle", "CSS", "crypto", "performance", "localStorage",
  "sessionStorage", "indexedDB", "atob", "btoa", "alert", "confirm", "prompt", "console",
  "WebSocket", "Worker", "MessageChannel", "MessagePort", "BroadcastChannel", "ClipboardItem",
  // TS 内置类型
  "Partial", "Required", "Readonly", "Pick", "Omit", "Record", "Exclude", "Extract", "NonNullable",
  "Parameters", "ReturnType", "InstanceType", "ConstructorParameters", "Awaited", "ThisType",
  "Uppercase", "Lowercase", "Capitalize", "Uncapitalize", "PropertyKey", "TemplateStringsArray",
  "Iterable", "Iterator", "IterableIterator", "AsyncIterable", "AsyncIterator", "Generator",
  "AsyncGenerator", "ArrayLike", "ReadonlyArray", "PromiseLike", "ConcatArray", "PropertyDescriptor",
  "PropertyDescriptorMap", "ThisParameterType", "OmitThisParameter", "NoInfer", "Disposable",
  "AsyncDisposable", "ArrayIterator",
  // 环境全局（思源 / 浏览器 / 构建期）
  "window", "document", "self", "global", "process", "require", "module", "exports", "__dirname",
  "__filename", "Buffer", "React", "Vue", "defineProps", "defineEmits", "defineExpose", "withDefaults",
  "$ref", "$computed", "$shallowRef", "$", "$$",
  "NodeJS", "Timeout", "HTMLElementTagNameMap", "CSSStyleDeclaration", "DOMRect", "Selection", "Range",
  "KeyboardEvent", "MouseEvent", "PointerEvent", "WheelEvent", "DragEvent", "FocusEvent", "InputEvent",
  "TouchEvent", "UIEvent", "CloseEvent", "ErrorEvent", "ProgressEvent", "AnimationEvent",
  "TransformStream", "ReadableStream", "WritableStream", "CompressionStream", "DecompressionStream",
  "Notification", "FileList", "DataTransfer", "DataTransferItem", "DataTransferItemList",
  "HTMLElementEventMap", "IDBDatabase", "IDBTransaction", "IDBObjectStore", "IDBRequest", "IDBKeyRange",
])

/**
 * 检查一个文件：找出「看起来是外部符号引用」但未绑定的标识符。
 * 策略：只报告「出现在明显的位置」（如 `await X(`、`new X(`、`X(`、`X.`、`X?.`）
 * 且首字母大写 或 属于常见工厂命名（create / use / get / is / has / find / parse / register / collect 前缀）
 * 的标识符，降低误报。
 */
function checkFile(file) {
  const src = fs.readFileSync(file, "utf8")
  const bound = collectBound(src)
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")

  const suspects = new Map() // name -> [lineNo]

  const patterns = [
    /\bnew\s+([A-Za-z_$][\w$]*)/g,
    /\bawait\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|[^.\w$])([a-z][\w$]*)\s*\(/g,
    /(?:^|[^.\w$])([A-Z][\w$]*)\s*\./g,
    /(?:^|[^.\w$])([A-Z][\w$]*)\s*\(/g,
  ]

  for (const re of patterns) {
    let m
    while ((m = re.exec(stripped))) {
      const name = m[1]
      if (bound.has(name)) continue
      if (GLOBALS.has(name)) continue
      // 只保留「工厂命名」或「大写开头」的，降低误报
      const looksFactory = /^(create|use|get|set|is|has|find|parse|register|collect|build|make|apply|format|resolve|validate|normalize|load|save|open|close|refresh|update|emit|run|start|stop|handle|on|render|draw|measure|clone|compare|convert|toggle|test|assert|abbr|try|wrap|unwrap)/.test(name)
      const looksClass = /^[A-Z]/.test(name)
      if (!looksFactory && !looksClass) continue
      if (!suspects.has(name)) suspects.set(name, [])
      suspects.get(name).push(stripped.slice(0, m.index).split("\n").length)
    }
  }

  const hits = []
  for (const [name, where] of suspects) {
    const definedSomewhere = exportIndex.has(name)
    hits.push({ name, lines: [...new Set(where)].slice(0, 6), exportedSomewhere: definedSomewhere })
  }
  return hits
}

function main() {
  const args = process.argv.slice(2)
  let targets
  if (args.includes("--all")) {
    targets = files
  } else if (args.length) {
    targets = args.filter(a => !a.startsWith("--")).map(p => path.resolve(p))
  } else {
    targets = DEFAULT_TARGETS.map(p => path.resolve(p))
  }

  let totalIssues = 0
  for (const f of targets) {
    const hits = checkFile(f)
    if (!hits.length) continue
    totalIssues += hits.length
    console.log(`\n${path.relative(process.cwd(), f)}`)
    for (const h of hits) {
      const tag = h.exportedSomewhere ? "未 import" : "★ 全项目无此导出"
      console.log(`  ${tag}  ${h.name}   @ line ${h.lines.join(", ")}`)
    }
  }

  if (!totalIssues) {
    console.log(`断链检查通过（${targets.length} 个文件，0 处断链）`)
  } else {
    console.log(`\n合计可疑引用 ${totalIssues} 处。`)
  }
  process.exit(0)
}

main()
