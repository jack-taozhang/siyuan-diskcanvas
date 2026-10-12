/**
 * 本机文件「跨插件链路」契约检查（第七层验证）
 *
 * ★ 为什么需要这个检查 ★
 *   用户诉求：「网盘文件 改成 直接读取本地存储插件的逻辑」+「支持拖拽本地存储
 *   文件到画布」。这两条都是**跨插件**链路，典型失效形态是**静默失效**：
 *     · activateNode 没写 `kind === "localfs"` 分支 → 双击无反应
 *     · 写了但调了一个对方不存在的方法名（对方改了契约）→ 双击抛错/无反应
 *     · 拖拽 MIME 与对方写入的不一致 → 拖到画布上什么都不发生
 *     · 画布接住了但没 `stopPropagation()` → 同一次拖放既建画布节点、又插正文嵌入块
 *   断链检查、构建、加载检查**都发现不了**，因为代码本身是"合法"的。
 *
 * ★ 检查什么 ★
 *   把「画布侧发起调用的形状」与「本机存储插件真实暴露的东西」**交叉核对**：
 *     A. 双击打开
 *        1. activateNode 必须处理 `resolved.kind === "localfs"`
 *        2. 必须通过契约客户端的 `openFile(...)`（对方公开能力），
 *           而不是自己拼 `custom.id` 去 openTab、更不是反射找插件实例
 *        3. 载荷必须含 path / name，且**不得**再带网盘时代的 mount
 *        4. 独立网页里必须走 `previewUrl`（本页没有思源页签体系）
 *        5. 拿不到契约时必须走可读提示分支，不能静默 return
 *     B. 拖拽
 *        6. MIME 必须与对方 `siyuan-localfs/src/embed.js` 的 `DND_MIME` 逐字一致
 *        7. 载荷校验必须是 `kind === "file"` + 非目录 + path 非空
 *        8. 认领拖拽时必须 `stopPropagation()`（对方挂在 document 上）
 *     C. 既有回归
 *        9. document / block 两种思源 kind 仍在
 *       10. getResolvedFileNode 传的是 node 对象而不是 node.id
 *
 * ★ 判据来源（不是猜的）★
 *   · 消费侧：本仓库 `src/canvas/use-canvas-editor.ts`
 *   · 提供侧：`siyuan-localfs/src/external.js`（契约）与 `src/embed.js`（DND）
 *     以及其**构建产物**（默认读部署目录，可用 LOCALFS_PLUGIN_JS 覆盖）
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const EDITOR = resolve(ROOT, "src/canvas/use-canvas-editor.ts")

const LOCALFS_ROOT = process.env.LOCALFS_SRC || "D:/Docker/siyuan-localfs"
const LOCALFS_PLUGIN_JS =
  process.env.LOCALFS_PLUGIN_JS || "D:/Software/SiYuan/data/plugins/siyuan-localfs/index.js"

const src = readFileSync(EDITOR, "utf8")

let pass = 0
let fail = 0
const skipped = []
function check(label, cond, detail = "") {
  if (cond) {
    pass += 1
    console.log(`  ✔ ${label}${detail ? `\n      ${detail}` : ""}`)
  } else {
    fail += 1
    console.log(`  ✘ ${label}${detail ? `\n      ${detail}` : ""}`)
  }
}
function skip(label, detail) {
  skipped.push(label)
  console.log(`  ~ ${label}（跳过）\n      ${detail}`)
}

console.log("\n本机文件跨插件链路 — 契约检查")
console.log("─".repeat(60))

/* ── 取片段前必须先剥注释 ────────────────────────────────────────────────
 * 原来直接用固定长度窗口。2026-09-28 在 activateNode 开头加了一段守卫
 * （含说明注释，约 900 字符），就把真正的调用挤出了窗口 ⇒ 断言集体假失败。
 * 剥掉注释后，窗口只被**代码**占用，不再受注释长度影响。
 * 这里进一步按"下一个顶层函数"切出整段，避免窗口长度这个魔数再次失效。
 */
const srcNoComments = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1")

const activateIdx = srcNoComments.indexOf("async function activateNode")
let activateBody = ""
if (activateIdx >= 0) {
  const nextFn = srcNoComments.indexOf("\n  function ", activateIdx + 10)
  activateBody = nextFn > activateIdx
    ? srcNoComments.slice(activateIdx, nextFn)
    : srcNoComments.slice(activateIdx, activateIdx + 9000)
}

/* ══ A. 双击打开 ══════════════════════════════════════════════════════════ */

check(
  'activateNode 存在且处理 kind === "localfs"',
  /resolved\.kind\s*===\s*["']localfs["']/.test(activateBody),
  activateIdx >= 0
    ? `activateNode @ char ${activateIdx}（片段 ${activateBody.length} 字符）`
    : "未找到 activateNode",
)

// 必须走「契约客户端」这条唯一入口 —— 与侧边栏双击文件完全同一条链路
check(
  "通过契约客户端调用 openFile(...)（复用本机存储侧打开的完整逻辑）",
  /client\.openFile\s*\(/.test(activateBody),
  "应写成 getLocalFsClient() 拿到 client，再 client.openFile({ name, path })",
)
check(
  "localfs 分支内确实通过 getLocalFsClient() 取契约",
  /getLocalFsClient\s*\(/.test(activateBody),
)
check(
  "★ 反向断言：localfs 分支内**不**自己拼 custom.id 去 openTab",
  !/custom\s*:\s*\{[^}]*id\s*:/.test(activateBody),
  "自己拼 id ⇒ 对方改常量即静默失效；应交给对方 openFile()",
)
check(
  "★ 反向断言：不再按插件名反射找实例（app.plugins / openFile 插件实例方法）",
  !/app\s*\.\s*plugins/.test(activateBody),
  "本机存储把 openFile 收进了契约，反射查找是网盘时代的残留",
)

// 载荷形状：本机存储侧 openFile(item) 读的是 path / name（**没有** mount 概念）
const callMatch = /client\.openFile\s*\(\s*\{/.exec(activateBody)
const payload = callMatch ? activateBody.slice(callMatch.index, callMatch.index + 300) : ""
check(
  "定位到 client.openFile({...}) 调用点（而非守卫行）",
  callMatch !== null,
  callMatch ? `@ char ${callMatch.index}` : "activateBody 里没有 openFile({...}) 调用形态",
)
for (const key of ["path", "name"]) {
  check(`openFile 载荷含 ${key}`, new RegExp(`\\b${key}\\s*:`).test(payload))
}
check(
  "★ 反向断言：openFile 载荷**不含**网盘时代的 mount",
  !/\bmount\s*:/.test(payload),
  "本机存储的路径是绝对路径，没有挂载点概念",
)

// 独立网页：没有思源页签体系，必须改走 previewUrl
check(
  "独立网页里走 openLocalFsInBrowser（即契约的 previewUrl）",
  /openLocalFsInBrowser\s*\(/.test(activateBody) && /isStandaloneMode/.test(activateBody),
)
check(
  "开放地址一律由对方构造（本侧只 window.open，不自己拼 URL）",
  /openLocalFsInBrowser/.test(srcNoComments) && /previewUrl\s*\(/.test(srcNoComments),
  "openLocalFsInBrowser 内部必须调 client.previewUrl(...)",
)

// 拿不到契约 → 可读提示，不静默 return
check(
  "找不到「本机存储」插件时给出可读提示（messageLocalFsPluginMissing）",
  /messageLocalFsPluginMissing/.test(activateBody),
)
check(
  "打开失败时给出可读提示（messageLocalFsOpenFailed，带 error 参数）",
  /messageLocalFsOpenFailed/.test(activateBody),
)

/* ══ B. 拖拽 ═════════════════════════════════════════════════════════════ */

const MIME = "application/x-localfs-embed"
check(
  `LOCALFS_DND_MIME 常量与本机存储侧约定一致（${MIME}）`,
  new RegExp(`LOCALFS_DND_MIME\\s*=\\s*["']${MIME.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}["']`).test(src),
)

// 与对方源码交叉核对 MIME（能读到就严格比对；读不到则跳过而不是假装通过）
let mimeOk = false
let mimeDetail = ""
try {
  const embed = readFileSync(resolve(LOCALFS_ROOT, "src/embed.js"), "utf8")
  const m = /DND_MIME\s*=\s*["']([^"']+)["']/.exec(embed)
  mimeOk = Boolean(m) && m[1] === MIME
  mimeDetail = `本机存储侧 DND_MIME=${m ? m[1] : "(未找到)"}`
} catch (error) {
  mimeOk = false
  mimeDetail = `读取失败：${String(error).slice(0, 70)}`
}
if (mimeDetail.startsWith("读取失败")) {
  skip("★ 交叉核对：与 siyuan-localfs/src/embed.js 的 DND_MIME 逐字一致", mimeDetail)
} else {
  check("★ 交叉核对：与 siyuan-localfs/src/embed.js 的 DND_MIME 逐字一致", mimeOk, mimeDetail)
}

check(
  '拖拽载荷校验含 kind === "file" 与目录排除',
  /parsed\.kind\s*===\s*["']file["']/.test(src) && /parsed\.isDir/.test(src),
)
check(
  "拖拽载荷校验 path 必须是非空字符串",
  /typeof\s+parsed\.path\s*===\s*["']string["']/.test(src) && /parsed\.path\s*\)/.test(src),
)
check(
  "★ 认领拖拽时 stopPropagation()（本机存储挂在 document 上，否则会重复插正文块）",
  /function\s+localFsDrop[\s\S]{0,600}?stopPropagation\s*\(/.test(srcNoComments),
)
check(
  "★ 不认的拖拽不 preventDefault（放过去，避免弄坏别人的链路）",
  /function\s+localFsDragOver[\s\S]{0,500}?includes\s*\(\s*LOCALFS_DND_MIME\s*\)/.test(srcNoComments),
)

/* ══ C. 既有回归 ═════════════════════════════════════════════════════════ */

check(
  '★ activateNode 处理 kind === "document"（笔记按路径存储时的实际 kind）',
  /resolved\.kind\s*===\s*["']document["']/.test(activateBody),
  "只处理 block 会导致「按路径存的笔记节点」双击无反应",
)
check(
  'activateNode 处理 kind === "block"（裸块 ID 存储）',
  /resolved\.kind\s*===\s*["']block["']/.test(activateBody),
)
let docKindOk = false
let docKindDetail = "（未读取到 file-target-resolution.ts）"
try {
  const ftr = readFileSync(resolve(ROOT, "src/canvas/file-target-resolution.ts"), "utf8")
  const hasDocKind = /kind:\s*["']document["']/.test(ftr)
  const hasByPath = /resolveDocumentByPath/.test(ftr)
  docKindOk = hasDocKind && hasByPath
  docKindDetail = `含 kind:"document"=${hasDocKind} 含 resolveDocumentByPath=${hasByPath}`
} catch (error) {
  docKindDetail = `读取失败：${String(error).slice(0, 80)}`
}
check("★ 交叉核对：解析层会产出 kind=\"document\"（按路径解析文档）", docKindOk, docKindDetail)

const idArgCall = /getResolvedFileNode\s*\(\s*node\.id\s*\)/.exec(activateBody)
check(
  "★ 反向断言：activateNode 内不把 node.id 传给 getResolvedFileNode（否则异步静默抛错）",
  idArgCall === null,
  idArgCall ? `命中 @ char ${idArgCall.index} —— 应改为 getResolvedFileNode(node)` : "未发现传 node.id 的写法",
)
check(
  "activateNode 内传的是 node 对象（getResolvedFileNode(node)）",
  /getResolvedFileNode\s*\(\s*node\s*\)/.test(activateBody),
)

// 与函数签名交叉核对：首参必须是 CanvasNode
let sigOk = false
let sigDetail = "（未读取到 use-canvas-editor-file-nodes.ts）"
try {
  const fnSrc = readFileSync(resolve(ROOT, "src/canvas/use-canvas-editor-file-nodes.ts"), "utf8")
  const sig = /function getResolvedFileNode\s*\(\s*([^)]*)\)/.exec(fnSrc)
  const param = sig ? sig[1].trim() : ""
  const throwsOnNonFile =
    /node\.type\s*!==\s*["']file["'][\s\S]{0,160}throw new Error\(\s*["']Resolved file-node metadata requested for a non-file node/.test(fnSrc)
  sigOk = /^node:\s*CanvasNode$/.test(param) && throwsOnNonFile
  sigDetail = `首参="${param}" 含非 file 守卫 throw=${throwsOnNonFile}`
} catch (error) {
  sigDetail = `读取失败：${String(error).slice(0, 80)}`
}
check("★ 交叉核对：getResolvedFileNode 首参是 CanvasNode 且对非 file 抛错（故绝不能传 id）", sigOk, sigDetail)

/* ══ D. 与本机存储插件产物交叉核对 ═══════════════════════════════════════ */

try {
  const built = readFileSync(LOCALFS_PLUGIN_JS, "utf8")
  check(
    "★ 交叉核对：本机存储产物暴露 window.__localfsPlugin（契约已构建进去）",
    /__localfsPlugin/.test(built) && /installExternal/.test(built),
    LOCALFS_PLUGIN_JS,
  )
  check(
    "★ 交叉核对：契约里有 openFile / previewUrl / roots / list 四个画布要用的能力",
    /openFile/.test(built) && /previewUrl/.test(built) && /roots/.test(built) && /list/.test(built),
  )
} catch (error) {
  skip(
    "★ 交叉核对：本机存储产物暴露 __localfsPlugin 与 openFile/previewUrl/roots/list",
    `读取失败：${String(error).slice(0, 90)}（可用 LOCALFS_PLUGIN_JS 指定产物）`,
  )
}

console.log("─".repeat(60))
console.log(`通过 ${pass} 项，失败 ${fail} 项${skipped.length ? `，跳过 ${skipped.length} 项` : ""}`)
process.exit(fail > 0 ? 1 : 0)
