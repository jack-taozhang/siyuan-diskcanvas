/**
 * 嵌入块「交互式只读画布」+「斜杠插入到该行并清残留」— 契约检查（第十层验证）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 用户两条要求
 * ══════════════════════════════════════════════════════════════════════
 *   ① 「插入块中渲染的效果和编辑状态下是一样的，可以放大缩小，移动画布，
 *      就是不能编辑具体内容。」
 *   ② 「/功能 插入块到该行，且自动清除 /及后面的字符。可以参照网盘插件写法。」
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么这两条都极易「看起来做了、其实没做」
 * ══════════════════════════════════════════════════════════════════════
 *   ① 把静态快照换成真实画布时，**最容易被忘掉的是 embed 模式要强制只读**；
 *      忘了就会变成「笔记里能直接改画布」——而且视觉上一切正常，测不出来。
 *      更隐蔽的是**落盘**：同一条 .canvas 被页签实例打开时，
 *      嵌入实例若也保存，两者会互相覆盖。
 *
 *   ② 清理斜杠残留的正则有一个**被回溯绕过**的经典坑（见下面 D3 反向断言）：
 *      写宽松了会把用户的 `/usr/local/bin` 这类路径当残留删掉。
 *      这个 bug 不会报错、不会抛异常，只是**悄悄吃掉用户正文**。
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
function read(rel) {
  try {
    return readFileSync(resolve(ROOT, rel), "utf8")
  } catch (error) {
    return `__READ_FAIL__:${String(error).slice(0, 90)}`
  }
}

/**
 * 剥掉注释后再做「标识符是否还在」这类断言。
 *
 * ★ 必须剥，否则会命中自己写的说明注释 ★
 *   2026-09-28 实测：断言「previousBlockId 已不存在」失败，
 *   而实际代码里早就没有了 —— 命中的是我在接口上写的**变更说明**注释：
 *     `★ 2026-09-28：从 previousBlockId 改为 nextBlockId ★`
 *   （同类坑：CSS 检查器里 indexOf(selector) 命中注释，见 check-embed-style-parity）
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** 取某个函数（从 `function name(` 到下一个顶层 `  }` 之前）的正文，用于局部断言 */
function functionBody(source, header) {
  const start = source.indexOf(header)
  if (start < 0) {
    return ""
  }
  const rest = source.slice(start)
  const end = rest.indexOf("\n  }\n")
  return end > 0 ? rest.slice(0, end) : rest.slice(0, 900)
}

let pass = 0
let fail = 0
function check(label, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  ✔ ${label}${detail ? `\n      ${detail}` : ""}`) }
  else { fail += 1; console.log(`  ✘ ${label}${detail ? `\n      ${detail}` : ""}`) }
}

console.log("\n嵌入块：交互式只读画布 + 斜杠插入清理 — 契约检查")
console.log("─".repeat(64))

const main = read("src/main.ts")
const editor = read("src/canvas/use-canvas-editor.ts")
const block = read("src/canvas/canvas-embed-block.ts")
const command = read("src/canvas/canvas-embed-command.ts")
const insert = read("src/canvas/canvas-embed-insert.ts")
const cleanup = read("src/canvas/slash-cleanup.ts")
const index = read("src/index.ts")
const scss = read("src/index.scss")

/* ═══════════════ A. 交互式只读画布 ═══════════════ */
console.log("\n[A] 嵌入块渲染真实画布 · 只读但可缩放平移")

check(
  "bootstrap 类型新增 embed 标志",
  /embed\?:\s*boolean/.test(main),
)
check(
  "use-canvas-editor 从 bootstrap 推导 isEmbedMode",
  /const isEmbedMode = Boolean\(bootstrap\.embed\)/.test(editor),
)
check(
  "readonly 计算属性包含 isEmbedMode（否则嵌入块可编辑）",
  /const readonly = computed\(\(\) =>[^)]*isEmbedMode/.test(editor),
)
check(
  "★ readonly 不再只由 conflict/mobile 推导（反向：确保 embed 参与）",
  !/const readonly = computed\(\(\) => Boolean\(state\.conflict \|\| plugin\.isMobile \|\| false\)\)/.test(editor),
)

// ── ★ 编辑入口的唯一收口：commitDocument ★ ──
//   实测：顶部工具栏（.canvas-toolbar）里**一处 readonly 判断都没有**，
//   而嵌入块里工具栏是可见的 ⇒ 不在这里拦，用户就能点「+」「撤销」改动画布。
//   39 处 commitDocument 调用覆盖工具栏/快捷键/拖拽/连线/拖放/右键菜单，
//   在此一点加守卫即可，不必逐个 action 加（逐个加必漏）。
check(
  "★ commitDocument 有只读守卫（覆盖全部 39 个编辑入口）",
  /function commitDocument\([\s\S]{0,1200}?if \(readonly\.value\)\s*\{\s*return/.test(editor),
  "工具栏按钮、快捷键、手势最终都汇到这里",
)
check(
  "★ 反向断言：加载路径不经过 commitDocument（故守卫不会挡住加载）",
  !/use-canvas-editor-lifecycle[\s\S]{0,200}?commitDocument/.test(editor),
)
check(
  "顶部工具栏在**编辑态**仍然存在（第二轮需求只要求预览态隐藏它）",
  /data-testid="top-toolbar"/.test(read("src/components/canvas/CanvasWorkspace.vue")),
)

/* ═══════════════ A2. 预览态的三项行为调整（2026-09-28 第二轮需求）═══════════════ */
console.log("\n[A2] 预览态行为：纯画布观感 / 刷新按钮 / 不跳页签 / 右键平移")

const gestures = read("src/canvas/use-canvas-editor-gestures.ts")
const workspace = read("src/components/canvas/CanvasWorkspace.vue")

// ── 平移统一为右键 ──
check(
  "★ 平移只认右键（编辑态与预览态一致）",
  /function startPan\(event: PointerEvent\)\s*\{[\s\S]{0,1800}?if \(event\.button === 2\)\s*\{/.test(gestures),
)
check(
  "★ 反向断言：已移除「只读下左键也平移」的分支（否则两套手势、且松开时易误触卡片）",
  !/event\.button === 2 \|\| \(readonly\.value && event\.button === 0\)/.test(gestures),
)

// ── 画布区域不得打开/跳转页签 ──
check(
  "★ activateNode 在嵌入模式下早退（画布区域唯一的打开入口被收口）",
  /async function activateNode\(node: CanvasNode\)\s*\{[\s\S]{0,900}?if \(isEmbedMode\)\s*\{\s*return false/.test(editor),
)
check(
  "★ 反向断言：activateNode 全项目只有一个调用点（故收口一点即可覆盖）",
  (read("src/components/canvas/use-canvas-workspace-behavior.ts").match(/activateNode/g) || []).length <= 3,
  "use-canvas-workspace-behavior 里只有「类型声明 + doubleClick 调用」两处",
)
check(
  "★ 反向断言：卡片组件内没有自己的 @click/@dblclick 打开入口",
  !/@(click|dblclick)=/.test(read("src/components/canvas/CanvasFileCard.vue")),
)
check(
  "只读下舞台双击不再新建节点（避免选中幽灵 id）",
  /function handleStageDoubleClick\(event: MouseEvent\)\s*\{[\s\S]{0,700}?if \(editor\.readonly\)\s*\{\s*return/.test(workspace),
)

// ── 纯画布观感：隐藏顶部工具栏 ──
check(
  "★ 预览态隐藏画布顶部工具栏",
  /\.dc-embed-canvas-host\s+\.canvas-toolbar\s*\{[^}]*display:\s*none/.test(scss),
)
check(
  "★ 同时把外壳行模板改成单行 —— 否则舞台替补进 auto 行会高度塌陷",
  /\.dc-embed-canvas-host\s*>\s*\.canvas-shell\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/.test(scss),
  "外壳原为 grid-template-rows: auto minmax(0, 1fr)",
)

// ── 刷新按钮 ──
check(
  "★ 嵌入块头部有「刷新」按钮，且排在「在页签中打开」**之前**（用户指定顺序）",
  /refreshBtn[\s\S]{0,900}?tools\.appendChild\(refreshBtn\)[\s\S]{0,400}?tools\.appendChild\(openBtn\)/.test(block),
)
check(
  "刷新 = 卸载旧实例 + 重新挂载（复用首次渲染那条已验证的载入路径）",
  /unmountEmbedCanvas\(host\)[\s\S]{0,200}?mountReadonlyCanvas\(host, spec, title, options\)/.test(block),
)
check(
  "刷新时从当前 DOM 重新取宿主（避免闭包持有被换掉的旧节点）",
  /const host = wrap\.querySelector<HTMLElement>\("\.dc-embed-canvas-host"\)/.test(block),
)
check(
  "刷新期间禁用按钮给出即时反馈，且样式存在",
  /refreshBtn\.disabled = true/.test(block) && /\.dc-embed-btn:disabled/.test(scss),
)
check(
  "i18n 双语含 canvasEmbedRefresh",
  /"canvasEmbedRefresh"/.test(read("src/i18n/zh_CN.json")) && /"canvasEmbedRefresh"/.test(read("src/i18n/en_US.json")),
)

// ── 落盘守卫：这是数据安全项 ──
const saveBody = functionBody(editor, "async function save()")
const silentSaveBody = functionBody(editor, "async function silentSave()")
check(
  "★ save() 在嵌入模式下直接 return（同一条 .canvas 被页签实例打开时不许双写）",
  /isEmbedMode/.test(saveBody),
  saveBody ? saveBody.slice(0, 60).replace(/\s+/g, " ") + " …" : "(未取到函数体)",
)
check(
  "★ silentSave() 同样有嵌入守卫",
  /isEmbedMode/.test(silentSaveBody),
)

// ── 挂载机制 ──
check(
  "嵌入块模块有挂载器注入接口 setCanvasEmbedMounter",
  /export function setCanvasEmbedMounter/.test(block),
)
check(
  "★ 反向断言：嵌入块模块**不**直接 import @/main（会形成循环依赖）",
  !/from ["']@\/main["']/.test(block),
  "依赖链：main → App.vue → CanvasWorkspace → use-canvas-editor → canvas-embed-insert → canvas-embed-block",
)
check(
  "挂载时传入 embed: true",
  /embedMounter\(host,\s*\{\s*embed:\s*true/.test(block),
)
check(
  "index.ts 注入 mountCanvasApp / unmountCanvasApp",
  /setCanvasEmbedMounter\(mountCanvasApp,\s*unmountCanvasApp\)/.test(index),
)
check(
  "index.ts 从 @/main 显式导入这两者",
  /mountCanvasApp,/.test(index) && /unmountCanvasApp,/.test(index),
)
check(
  "挂载器缺失/失败时降级为静态快照（不留空白、不抛错）",
  /renderStaticFallback/.test(block),
)

// ── 生命周期：防泄漏 ──
check(
  "重渲染前先卸载上一次的画布实例（否则每次刷新多一个幽灵实例）",
  /unmountEmbedCanvas\(previousHost\)/.test(block),
)
check(
  "有脱离检测（元素被宿主移除后自动卸载）",
  /new MutationObserver/.test(block) && /isConnected/.test(block),
)
check(
  "★ 观察器只在存在已挂载宿主时才挂（无嵌入块的文档不产生开销）",
  /if \(mountedEmbedHosts\.size === 0\)[\s\S]{0,120}?disconnect\(\)/.test(block),
)

// ── 尺寸：真实画布必须撑满 ──
check(
  "有 .dc-embed-canvas-host 样式",
  /\.dc-embed-canvas-host\s*\{/.test(scss),
)
check(
  "★ 画布宿主取消静态图的内边距（否则白白缩掉 20px）",
  /\.dc-embed-canvas-host\s*\{[^}]*padding:\s*0/.test(scss),
)
check(
  "画布外壳显式撑满宿主",
  /\.dc-embed-canvas-host\s*>\s*\.canvas-shell\s*\{[^}]*height:\s*100%/.test(scss),
)

/* ═══════════════ B. 插入位置 = 光标所在行 ═══════════════ */
console.log("\n[B] 斜杠插入位置（nextID = 光标块 ⇒ 插到它之前）")

check(
  "InsertCanvasEmbedOptions 有 nextBlockId",
  /nextBlockId\?:\s*string/.test(insert),
)
check(
  "★ 用 nextID 形参位传 nextBlockId（而非 previousID 位）",
  /insertBlock\(\s*"markdown",\s*markdown,\s*nextBlockId,/.test(insert),
  "内核语义：nextID ⇒ 插到该块之前；previousID ⇒ 插到该块之后",
)
check(
  "★ 反向断言：previousBlockId 绝不出现在 nextID 实参位",
  !/insertBlock\(\s*"markdown",\s*markdown,\s*previousBlockId/.test(insert),
  "previousBlockId 仍可作为**兜底**保留，但不能抢占 nextID 位置",
)
check(
  "定位结果字段已改名为 nextBlockId（剥注释后断言，避免命中变更说明）",
  /nextBlockId\?:\s*string/.test(stripComments(command))
  && !/previousBlockId/.test(stripComments(command)),
)
check(
  "★ 反向断言：文档级 block（id === rootID）不当锚点（否则块会跑到文末）",
  /cmdBlockId !== cmdRootId/.test(command) && /lastBlockId !== lastRootId/.test(command),
)

/* ═══════════════ C. 清理斜杠残留 ═══════════════ */
console.log("\n[C] 自动清除 / 及其后字符")

check(
  "存在 slash-cleanup 模块并导出 cleanupSlashText",
  /export async function cleanupSlashText/.test(cleanup),
)
check(
  "★ 从内层 contenteditable 取文本（外层含零宽空格会让 /^[/、]/ 永远失配）",
  /querySelector\('\[contenteditable="true"\]'\)/.test(cleanup),
)
check(
  "整块只有 /xxx ⇒ 删块（而非留一个空段）",
  /deleteBlock/.test(cleanup) && /deleteWholeBlock/.test(cleanup),
)
check(
  "前文/过滤词 ⇒ 只删斜杠及之后，保留前文",
  /TRAILING_SLASH_COMMAND/.test(cleanup) && /updateBlock/.test(cleanup),
)
check(
  "★ 走过内核 API 写回（只改 DOM 存不住，刷新后残留会回来）",
  /fetchSyncPost/.test(cleanup) && /\/api\/block\/updateBlock/.test(cleanup),
)
check(
  "★ 反向断言：不用 @/api 的解包包装 —— 它把「成功(null)」与「失败(null)」混为一谈",
  !/from ["']@\/api["']/.test(cleanup),
  "api.ts request(): code===0 ? data : null；而 deleteBlock 成功时 data 本就是 null",
)
check(
  "★ 路径形状保护：斜杠多于一个时判定为正文，跳过（保住 /usr/local/bin）",
  /slashCount > 1/.test(cleanup),
)

// ★★ 最关键的一条：正则组 1 必须禁止出现斜杠，否则会被回溯绕过 ★★
const trailingRe = (cleanup.match(/const TRAILING_SLASH_COMMAND = (\/[^\n]+)/) || [])[1] || ""
check(
  "★ 反向断言：保留前文的正则**组 1 不允许含斜杠**（防回溯吃掉用户正文）",
  trailingRe.includes("[^/、]*?") && !trailingRe.includes("[\\s\\S]*?"),
  trailingRe || "(未取到正则)",
)
check(
  "  ↳ 说明：`([\\s\\S]*?)` 会被回溯绕过 ⇒ 输入 `路径 /usr/local/bin` 时\n        引擎改试 m[1]=`路径 /usr` m[2]=`local`，第二斜杠被吃进组1，\n        守卫失效 ⇒ 把用户的路径整段删掉。",
  true,
)

/* ═══════════════ D. 清理的触发时机 ═══════════════ */
console.log("\n[D] 触发时机（只在斜杠入口、只在插入成功之后）")

check(
  "runCanvasEmbedCommand 接受 fromSlash / anchorEl",
  /fromSlash\?:\s*boolean/.test(command) && /anchorEl\?:\s*HTMLElement/.test(command),
)
check(
  "★ 反向断言：非斜杠入口不清理（否则会误删用户正文）",
  /if \(!options\.fromSlash \|\| !options\.anchorEl\)\s*\{\s*return/.test(command),
)
check(
  "★ 清理发生在插入成功之后（失败时保留 /xxx 供用户重试）",
  /if \(blockId\)\s*\{\s*await cleanupSlashResidue\(options\)/.test(command),
)
check(
  "清理失败不把「插入成功」变成失败（try/catch 吞掉并记日志）",
  /slash residue cleanup failed/.test(command),
)
check(
  "index.ts 斜杠回调传 fromSlash: true",
  /insertCanvasEmbedFromCommand\(protyle, nodeElement, \{ fromSlash: true \}\)/.test(index),
)
check(
  "index.ts 把 nodeElement 作为 anchorEl 下传",
  /anchorEl: nodeElement \?\? null/.test(index),
)

console.log("─".repeat(64))
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail > 0 ? 1 : 0)
