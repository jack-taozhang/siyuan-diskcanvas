/**
 * 画布嵌入块「样式对齐网盘文件嵌入」— 契约检查（第九层验证）
 *
 * ★ 为什么需要它 ★
 *   用户诉求：「画布插入到笔记中的块样式参照网盘文件插入样式，风格和相同尺寸，只读预览。」
 *   这是一条**跨插件的一致性约束**：参照物在 siyuan-nebuladisk 的 index.css 里。
 *   两边是独立仓库、各自演进 —— 网盘侧调了尺寸，画布侧不会自动跟随，
 *   而"长得不一样"这种问题不会让任何测试变红。
 *   ⇒ 必须有一个检查器**直接读网盘侧的真实 CSS**，与之逐字比对。
 *
 * ★ 判据来源（不是抄常量，是读文件）★
 *   默认读本地开发副本 `D:/Docker/Siyuan/data/plugins/siyuan-nebuladisk/index.css`，
 *   可用环境变量 NEBULA_CSS 指向别处（例如从 NAS 上取的最新产物）。
 *   文件不可得时**跳过并显式说明**，不假装通过。
 *
 * ★ 另一类历史包袱：`;;;` 围栏的三条硬约束 ★
 *   1. 必须是 `;;;` 而不是反引号（反引号生成普通代码块，渲染器不会被调用）
 *   2. 围栏必须顶格（前面多一个字符就退化成普通段落）
 *   3. data-info 必须是 `<插件名>/<块类型>`，且 `<块类型>` 与注册键一致
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const NEBULA_CSS = process.env.NEBULA_CSS || "D:/Docker/Siyuan/data/plugins/siyuan-nebuladisk/index.css"

function readOrFail(rel) {
  try {
    return readFileSync(resolve(ROOT, rel), "utf8")
  } catch (error) {
    return `__READ_FAIL__:${String(error).slice(0, 90)}`
  }
}

let pass = 0
let fail = 0
let skip = 0
function check(label, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  ✔ ${label}${detail ? `\n      ${detail}` : ""}`) }
  else { fail += 1; console.log(`  ✘ ${label}${detail ? `\n      ${detail}` : ""}`) }
}
function skipped(label, detail) {
  skip += 1
  console.log(`  ⊘ ${label}\n      ${detail}`)
}

console.log("\n画布嵌入块 — 样式对齐契约检查")
console.log("─".repeat(62))

const scss = readOrFail("src/index.scss")
const block = readOrFail("src/canvas/canvas-embed-block.ts")
const insert = readOrFail("src/canvas/canvas-embed-insert.ts")
const index = readOrFail("src/index.ts")
const observer = readOrFail("src/canvas/canvas-embed-observer.ts")

/**
 * 从 CSS/SCSS 文本里取某个选择器下某条属性的声明值。
 *
 * ★ 为什么不能直接 indexOf(selector) ★
 *   两边的文件里都有**注释**提到这些选择器名（本检查器的说明、以及
 *   我写在 scss 里的"参照物对照表"注释都会出现 `.nb-embed-frame-box` 等字样）。
 *   indexOf 会命中注释里那一次，取到错误的 `{...}` 区间 ⇒ 一律返回 null。
 *   （2026-09-28 实测：首版就是这么错的，6 条对比全部 null。）
 *
 *   正确做法：① 先剥掉 `/* *\/` 注释；② 用规则扫描器把 `选择器{...}` 全部切出来；
 *   ③ 在选择器**列表**里做精确匹配（支持 `.a,\n.b { ... }` 这种写法）。
 */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}

function declaredValue(rawCss, selector, prop) {
  const css = stripCssComments(rawCss)
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = ruleRe.exec(css)) !== null) {
    const selectors = m[1].split(",").map(s => s.trim())
    if (!selectors.includes(selector)) {
      continue
    }
    const body = m[2]
    const decl = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i").exec(body)
    if (decl) {
      return decl[1].trim()
    }
  }
  return null
}

// ── 1. 与网盘侧逐字比对（核心）──
console.log("\n[1] 与网盘文件嵌入的尺寸逐字比对")
let nebulaCss = null
try {
  nebulaCss = readFileSync(NEBULA_CSS, "utf8")
} catch {
  nebulaCss = null
}

if (!nebulaCss) {
  skipped("读取网盘插件 CSS", `不可得：${NEBULA_CSS}（可用 NEBULA_CSS 环境变量指定）`)
} else {
  const pairs = [
    [".dc-embed-frame-box", ".nb-embed-frame-box", "height"],
    [".dc-embed-frame-box", ".nb-embed-frame-box", "min-height"],
    [".dc-embed", ".nb-embed", "border"],
    [".dc-embed", ".nb-embed", "font-size"],
    [".dc-embed-head", ".nb-embed-head", "min-height"],
    [".dc-embed-head", ".nb-embed-head", "flex-wrap"],
  ]
  for (const [dcSel, nbSel, prop] of pairs) {
    const dc = declaredValue(scss, dcSel, prop)
    const nb = declaredValue(nebulaCss, nbSel, prop)
    check(
      `${prop} 对齐：${dcSel} == ${nbSel}`,
      dc !== null && nb !== null && dc === nb,
      `dc="${dc}"  nb="${nb}"`,
    )
  }
}

// ── 2. 块 markdown 的三条硬约束 ──
console.log("\n[2] 自定义块 markdown 约束")
check(
  "用 `;;;` 围栏构建（不是反引号）",
  /`;;;\$\{canvasEmbedLang\(pluginName\)\}/.test(block),
  "反引号只会生成普通代码块，渲染器不会被调用",
)
check(
  "围栏顶格 + 运行时自检（startsWith(\";;;\") 否则抛错）",
  /md\.startsWith\(";;;"\)/.test(block) && /throw new Error/.test(block),
  "围栏前多一个字符就退化成普通段落",
)
check(
  "data-info 形态为 `<插件名>/<块类型>`",
  /return `\$\{pluginName \|\| "[^"]+"\}\/\$\{CANVAS_EMBED_BLOCK_TYPE\}`/.test(block),
)
check(
  "块类型常量与注册键同源（同一常量，不各写一份字面量）",
  /export const CANVAS_EMBED_BLOCK_TYPE = "canvas"/.test(block)
  && /customBlockRenders\[CANVAS_EMBED_BLOCK_TYPE\] = renderer/.test(block),
)

// ── 3. 注册时机 ──
console.log("\n[3] 渲染器注册")
check(
  "在 onload 内注册（不能按需注册，否则历史嵌入块先被渲染成裸 JSON）",
  /registerCanvasEmbedBlock\(this, \(key, params\) => this\.t\(key, params\)\)/.test(index),
)
check(
  "onload 里注册发生在 startCanvasEmbedObserver 之后",
  index.indexOf("startCanvasEmbedObserver") < index.indexOf("registerCanvasEmbedBlock(this"),
)
check(
  "渲染表同时按块类型与插件名注册（兼容历史写法）",
  /customBlockRenders\[CANVAS_EMBED_BLOCK_TYPE\] = renderer/.test(block)
  && /customBlockRenders\[plugin\.name\] = renderer/.test(block),
)
check(
  "渲染器对非法内容给出可读提示而非抛出",
  /parseCanvasEmbed\(content\)[\s\S]{0,400}?canvasEmbedInvalid/.test(block),
)
check(
  "渲染器内部 try/catch 包裹 DOM 构建（渲染期异常会被宿主吞掉）",
  /try \{[\s\S]{0,200}?createCanvasEmbedElement\(spec, options\)[\s\S]{0,300}?catch \(error\)/.test(block),
)

// ── 4. DOM 结构与只读 ──
console.log("\n[4] DOM 结构与只读预览")
// ★ 断言改用「className 赋值里含该 class」而非精确等于 `"cls"` ★
//   2026-09-28：画布宿主改成 `"dc-embed-frame dc-embed-canvas-host"` 后，
//   原先按精确字符串匹配的写法立刻失败 —— 这是检查器正确报警。
//   改成"包含"匹配，既能容纳多 class，又仍能在 class 真被删掉时失败。
for (const cls of [
  "dc-embed",
  "dc-embed-head",
  "dc-embed-title",
  "dc-embed-tools",
  "dc-embed-frame-box",
  "dc-embed-frame",
  // 真实画布宿主（用户要求「渲染和编辑状态一样、可缩放平移」）
  "dc-embed-canvas-host",
  "dc-embed-image",
]) {
  check(
    `渲染器产出 .${cls}`,
    new RegExp(`className = "[^"]*\\b${cls}\\b`).test(block) || new RegExp(`"${cls}"`).test(block),
  )
}
check(
  "只读：预览用 <img> 而非可编辑控件",
  /document\.createElement\("img"\)/.test(block)
  && !/contentEditable\s*=\s*"true"/.test(block),
)
check(
  "无 contenteditable / input 注入",
  !/createElement\("(input|textarea)"\)/.test(block),
)

// ── 5. 插入链路 ──
console.log("\n[5] 插入链路")
check(
  "insertCanvasEmbed 使用新块构建器（不再走图片上传）",
  /buildCanvasEmbedBlockMarkdown\(/.test(insert),
)
check(
  "insertCanvasEmbed 不再调用 uploadCanvasEmbedPreview（避免孤儿 SVG 资源）",
  !/async function insertCanvasEmbed[\s\S]{0,1200}?uploadCanvasEmbedPreview/.test(insert),
  "uploadCanvasEmbedPreview 仍保留，仅供遗留块刷新使用",
)
check(
  "插件名由 index.ts 显式传入（避免循环依赖，不 import 插件实例）",
  /insertCanvasEmbed: \(embedOptions\) => insertCanvasEmbed\(\{[\s\S]{0,120}?pluginName: this\.name/.test(index),
)
check(
  "插前仍校验画布可解析（失败就不插脏块）",
  /parseCanvasDocument\(canvasRaw\)[\s\S]{0,200}?return null/.test(insert),
)

// ── 6. 遗留兼容（旧笔记里的图片嵌入不能被弄坏）──
console.log("\n[6] 遗留兼容")
check(
  "保留 refreshCanvasEmbedBlock（旧 markdown 图片块靠它刷新）",
  /export async function refreshCanvasEmbedBlock/.test(insert),
)
check(
  "保留 CANVAS_EMBED_CLASS / CANVAS_EMBED_BOUND_ATTR / CANVAS_EMBED_REFRESH_EVENT 导出",
  /export const CANVAS_EMBED_CLASS/.test(insert)
  && /export const CANVAS_EMBED_BOUND_ATTR/.test(insert)
  && /export const CANVAS_EMBED_REFRESH_EVENT/.test(insert),
)
check(
  "observer 仍只作用于遗留类名（不会误改新块）",
  /CANVAS_EMBED_CLASS/.test(observer),
  "旧刷新流程仍按遗留类名 canvas-embed-preview 定位",
)

/**
 * ★ 反向断言：observer 必须**主动排除**新版可交互块 ★
 *
 * 这条以前的写法是 `!/dc-embed/.test(observer)` —— 措辞是"不提及"。
 * 但那只是"眼不见为净"，并不能阻止误伤：
 *   · 新版块插入时也写了 `custom-canvas-path`，
 *     旧刷新流程按这个属性用 SQL 就把新块一起捞出来了，
 *     然后 `updateBlock("markdown", …)` 把它重写成静态 SVG 图片；
 *   · 旧点击委托（document 捕获阶段）同样会命中新块内部的任意点击，
 *     正是「刷新按钮也会打开页签」「画布区域任何操作都跳页签」的成因。
 * ⇒ 现在 observer 里**必须存在对 `.dc-embed` 的显式排除**，
 *   所以断言反过来：要求出现，而不是要求不出现。
 */
check(
  "★ 反向断言：observer 显式排除新版可交互块（.dc-embed）",
  /dc-embed/.test(observer),
  "旧刷新/旧点击委托都必须跳过新版真实画布块",
)
check(
  "★ observer 排除逻辑同时覆盖「点击委托」与「刷新流程」",
  /isInsideEmbedCanvasHost/.test(observer) && /domBlockIdsToSkip/.test(observer),
  "点击委托用 isInsideEmbedCanvasHost 早退；刷新流程用 domBlockIdsToSkip 剔除",
)
check(
  "★ 反向断言：点击委托的排除发生在打开页签之前",
  (() => {
    // ★ 不能直接用 indexOf 找 `openCanvasFromClickedImage(event`
    //   函数**定义**处（async function openCanvasFromClickedImage(event: Event…)）
    //   位置更靠前，会误判成"打开在前"。必须限定在委托监听器的函数体内比较。
    const listenerStart = observer.indexOf("delegatedClickListener = (event: Event) => {")
    if (listenerStart === -1) return false
    const listenerBody = observer.slice(listenerStart, listenerStart + 2600)
    const guard = listenerBody.indexOf("isInsideEmbedCanvasHost(event)")
    const open = listenerBody.indexOf("openCanvasFromClickedImage(event")
    return guard !== -1 && open !== -1 && guard < open
  })(),
  "早退必须在调用打开逻辑之前，否则拦不住",
)

console.log("─".repeat(62))
console.log(`通过 ${pass} 项，失败 ${fail} 项${skip ? `，跳过 ${skip} 项` : ""}`)
process.exit(fail > 0 ? 1 : 0)
