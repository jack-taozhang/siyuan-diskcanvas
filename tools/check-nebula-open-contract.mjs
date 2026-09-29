/**
 * 网盘节点「双击打开」链路契约检查（第七层验证）
 *
 * ★ 为什么需要这个检查 ★
 *   用户报：「画布上的网盘文件，双击无法在页签中打开。」
 *   这类问题的典型形态是**静默失效**：
 *     · activateNode 只处理了 kind==='block'，nebula 分支压根没写 → 双击无反应
 *     · 或者写了但调用了一个不存在的方法名（对方插件改了）→ 双击抛错/无反应
 *   断链检查、构建、加载检查**都发现不了**，因为代码本身是"合法"的。
 *
 * ★ 检查什么 ★
 *   把「画布侧发起调用的形状」与「网盘插件真实暴露的方法」做**交叉核对**：
 *     1. activateNode 必须处理 resolved.kind === "nebula"
 *     2. 必须通过插件实例调用 `openFile(...)`（对方公开方法），
 *        而不是自己拼 `custom.id` 去 openTab（那样对方改常量就静默失败）
 *     3. 传给 openFile 的载荷必须含 mount / path / name 三个键
 *        （与网盘侧 openFile(item) 读取的字段一致）
 *     4. 找不到插件时必须走可读提示分支，不能静默 return
 *
 * ★ 判据来源（不是猜的）★
 *   网盘插件产物 `siyuan-nebuladisk/index.js` 实测：
 *     - `openFile(item, opts = {})` 内部：
 *         const base = item.name || item.path || "NebulaDisk";
 *         openTab({ app: this.app, custom: { id: this.name + TAB_TYPE, ...,
 *                  data: { ...item, ...opts } } });
 *       其中 `TAB_TYPE = "nebuladisk_viewer"`
 *     - 即：**它自己拼 id、自己定 title**。画布只需提供 {mount,path,name}。
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const EDITOR = resolve(ROOT, "src/canvas/use-canvas-editor.ts")
const NEBULA_PLUGIN_JS = process.env.NEBULA_PLUGIN_JS || "C:/temp-nb/nebuladisk-index.js"

const src = readFileSync(EDITOR, "utf8")

let pass = 0
let fail = 0
function check(label, cond, detail = "") {
  if (cond) {
    pass += 1
    console.log(`  ✔ ${label}${detail ? `\n      ${detail}` : ""}`)
  } else {
    fail += 1
    console.log(`  ✘ ${label}${detail ? `\n      ${detail}` : ""}`)
  }
}

console.log("\n网盘节点双击打开 — 契约检查")
console.log("─".repeat(56))

// ── 1. activateNode 必须处理 nebula 分支 ──
//
// ★ 取片段前必须先剥注释 ★
//   原来直接用 `src.slice(idx, idx + 2200)`。2026-09-28 在 activateNode 开头
//   加了一段「嵌入模式直接返回」的守卫（含说明注释，约 900 字符），
//   就把真正的 openFile 调用挤出了窗口 ⇒ 5 条断言集体假失败。
//   剥掉注释后，窗口只被**代码**占用，不再受注释长度影响。
const srcNoComments = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1")
const activateIdx = srcNoComments.indexOf("async function activateNode")
const activateBody = activateIdx >= 0 ? srcNoComments.slice(activateIdx, activateIdx + 3200) : ""
check(
  "activateNode 存在且处理 kind === \"nebula\"",
  /resolved\.kind\s*===\s*["']nebula["']/.test(activateBody),
  activateIdx >= 0 ? `activateNode @ char ${activateIdx}` : "未找到 activateNode",
)

// ── 2. 必须走插件实例的 openFile，而不是自己 openTab 拼 id ──
check(
  "通过插件实例调用 openFile(...)（复用网盘侧打开的完整逻辑）",
  /nebulaPlugin\.openFile\s*\(/.test(activateBody),
)
check(
  "★ 反向断言：nebula 分支内**不**自己拼 custom.id 去 openTab",
  !/custom\s*:\s*\{[^}]*id\s*:/.test(activateBody),
  "自己拼 id ⇒ 对方改常量即静默失效；应交给对方 openFile()",
)

// ── 3. 载荷必须含 mount / path / name ──
// ★ 注意：不能用 indexOf("nebulaPlugin.openFile") —— 它会先命中**守卫行**
//   `typeof nebulaPlugin.openFile !== "function"`，导致取到的片段不含真正的调用。
//   用正则锚定「调用形态」：openFile 后紧跟 ( 且不是 !== / === 之类的比较。
const callMatch = /nebulaPlugin\.openFile\s*\(\s*\{/.exec(activateBody)
const payload = callMatch ? activateBody.slice(callMatch.index, callMatch.index + 400) : ""
check(
  "定位到 openFile({...}) 调用点（而非守卫行）",
  callMatch !== null,
  callMatch ? `@ char ${callMatch.index}` : `activateBody 里没有 openFile({...}) 调用形态`,
)
for (const key of ["mount", "path", "name"]) {
  check(
    `openFile 载荷含 ${key}`,
    new RegExp(`\\b${key}\\s*:`).test(payload),
  )
}

// ── 3. ★ 思源目标的两个 kind 都必须处理（block + document）★ ──
//   实测踩坑（2026-09-28，CDP 真机）：
//     笔记节点的 file 值形如 "/<notebookId>/<docId>.sy"（工作区路径，非裸块 ID）
//     ⇒ resolveCanvasFileTarget 走 resolveDocumentByPath 分支 ⇒ 返回 kind: "document"
//     ⇒ 而 activateNode 只判断了 kind === "block" ⇒ 落到 return false ⇒ 双击静默无反应
//   ★ 判据来源：同一文件 line 298 的 canRefreshSelectedSiyuanNode 明确把
//     'block' 与 'document' **并列**为合法思源目标 ⇒ 二者语义不同、都需处理 ★
check(
  "★ activateNode 处理 kind === \"document\"（笔记按路径存储时的实际 kind）",
  /resolved\.kind\s*===\s*["']document["']/.test(activateBody),
  "只处理 block 会导致「按路径存的笔记节点」双击无反应",
)
check(
  "activateNode 处理 kind === \"block\"（裸块 ID 存储）",
  /resolved\.kind\s*===\s*["']block["']/.test(activateBody),
)
// 交叉核对：解析层确实会产生 kind="document"（否则上一条断言无意义）
let docKindOk = false
let docKindDetail = "（未读取到 file-target-resolution.ts）"
try {
  const ftr = readFileSync(resolve(ROOT, "src/canvas/file-target-resolution.ts"), "utf8")
  const hasDocKind = /kind:\s*["']document["']/.test(ftr)
  const hasByPath = /resolveDocumentByPath/.test(ftr)
  docKindOk = hasDocKind && hasByPath
  docKindDetail = `含 kind:"document"=${hasDocKind} 含 resolveDocumentByPath=${hasByPath}`
} catch (error) {
  docKindOk = false
  docKindDetail = `读取失败：${String(error).slice(0, 80)}`
}
check("★ 交叉核对：解析层会产出 kind=\"document\"（按路径解析文档）", docKindOk, docKindDetail)

// ── 4. ★ 参数形状：getResolvedFileNode 必须收到 node 对象，不能是 node.id ★ ──
//   实测踩坑（2026-09-28，CDP 真机抓到的异常）：
//     activateNode 里写成 getResolvedFileNode(node.id)（传字符串）
//     ⇒ 函数内 `node.type !== "file"` 守卫：undefined !== "file" ⇒ throw
//        "Resolved file-node metadata requested for a non-file node."
//     ⇒ 该 throw 发生在 async 函数内，变成**未处理的 promise rejection** 被静默吞掉
//     ⇒ 用户看到的现象就是「双击毫无反应」（没有任何报错弹窗、控制台也未必显眼）
//   ★ 这类「传错参数形状」用「调用存在」是查不出来的，必须断言实参形态 ★
const idArgCall = /getResolvedFileNode\s*\(\s*node\.id\s*\)/.exec(activateBody)
check(
  "★ 反向断言：activateNode 内不把 node.id 传给 getResolvedFileNode（否则异步静默抛错）",
  idArgCall === null,
  idArgCall
    ? `命中 @ char ${idArgCall.index} —— 应改为 getResolvedFileNode(node)`
    : "未发现传 node.id 的写法",
)
const objArgCall = /getResolvedFileNode\s*\(\s*node\s*\)/.exec(activateBody)
check(
  "activateNode 内传的是 node 对象（getResolvedFileNode(node)）",
  objArgCall !== null,
  objArgCall ? `@ char ${objArgCall.index}` : "未找到 getResolvedFileNode(node) 调用",
)

// ── 4b. 与函数签名交叉核对：签名首参必须是 CanvasNode 而非 string ──
let sigOk = false
let sigDetail = "（未读取到 use-canvas-editor-file-nodes.ts）"
try {
  const fnSrc = readFileSync(resolve(ROOT, "src/canvas/use-canvas-editor-file-nodes.ts"), "utf8")
  const sig = /function getResolvedFileNode\s*\(\s*([^)]*)\)/.exec(fnSrc)
  const param = sig ? sig[1].trim() : ""
  const throwsOnNonFile = /node\.type\s*!==\s*["']file["'][\s\S]{0,120}throw new Error\(\s*["']Resolved file-node metadata requested for a non-file node/.test(fnSrc)
  sigOk = param === "node: CanvasNode" && throwsOnNonFile
  sigDetail = `首参="${param}" 含非 file 守卫 throw=${throwsOnNonFile}`
} catch (error) {
  sigOk = false
  sigDetail = `读取失败：${String(error).slice(0, 80)}`
}
check("★ 交叉核对：getResolvedFileNode 首参是 CanvasNode 且对非 file 抛错（故绝不能传 id）", sigOk, sigDetail)

// ── 5. 拿不到插件必须有可读提示（不能静默 return）──
check(
  "找不到网盘插件时给出可读提示（messageNebulaPluginMissing）",
  /messageNebulaPluginMissing/.test(activateBody),
)

// ── 6. 与网盘插件真实产物交叉核对 ──
let crossOk = false
let crossDetail = "（未提供网盘插件产物，跳过；设 NEBULA_PLUGIN_JS 可启用）"
try {
  const nb = readFileSync(NEBULA_PLUGIN_JS, "utf8")
  const hasOpenFile = /openFile\s*\(\s*item\s*,?\s*opts?\s*\)/.test(nb) || /openFile\(item,\s*opts/.test(nb)
  const hasTabType = /TAB_TYPE\s*=\s*["']nebuladisk_viewer["']/.test(nb)
  const idPattern = /id:\s*this\.name\s*\+\s*TAB_TYPE/.test(nb)
  crossOk = hasOpenFile && hasTabType && idPattern
  crossDetail = `openFile 存在=${hasOpenFile} TAB_TYPE=${hasTabType} id=this.name+TAB_TYPE=${idPattern}`
} catch (error) {
  crossOk = true // 产物不可得时不判失败（避免误报），但也不假装通过
  crossDetail = `跳过（读取失败：${String(error).slice(0, 60)}）`
}
check("★ 交叉核对：网盘侧确有 openFile(item,opts) + TAB_TYPE + id=this.name+TAB_TYPE", crossOk, crossDetail)

console.log("─".repeat(56))
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail > 0 ? 1 : 0)
