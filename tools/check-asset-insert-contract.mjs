/**
 * 「思源资源」插入链路 — 契约检查（第八层验证）
 *
 * ★ 为什么需要它 ★
 *   这条链路横跨 6 个文件，且每一环出错都是**静默失效**：
 *     · 工具栏没按钮          → 用户看不到入口
 *     · 按钮没绑对处理函数    → 点了没反应
 *     · 编辑器没导出方法      → `editor.insertSiyuanAssetNode` 为 undefined，点了报错
 *     · 选择器没挂载          → 弹不出对话框
 *     · 落库路径形态不对      → 节点建了但解析不到资源（预览空白）
 *     · 搜索 SQL 写了不存在的列 → 查询报错，列表永远空
 *   断链检查、构建、加载检查**都发现不了**这些（代码本身语法合法）。
 *
 * ★ 本检查器把「实测得到的环境事实」固化成断言 ★
 *   这些事实是 2026-09-28 在真库/真机上验出来的，有了断言就不会被后人改回去：
 *
 *   1. `assets` 表**没有 `updated` 列**
 *      （实际列：id / block_id / root_id / box / docpath / path / name / title / hash）
 *      ⇒ 任何 `ORDER BY updated` 都会让资源列表查询直接失败。
 *      （本检查器作者在写 SQL 时就差点照抄图片版踩进去，实测才发现。）
 *
 *   2. `assets.path` 存的是 **`assets/<文件名>`（无前导斜杠）**
 *      ⇒ 落库必须用这个形态，解析层 `WHERE path = ?` 才能命中。
 *
 *   3. 资源**必须不过滤扩展名**：实测最近 60 条里
 *      png 46 / xlsm 8 / pdf 3 / svg 1 / jpg 1 / py 1
 *      ⇒ 只放开图片会把 xlsm/pdf/py 这类整个挡掉。
 *
 *   4. `<script setup>` **不允许 `export`**：选择器条目的类型必须放在独立 .ts 里，
 *      否则编译期报 "<script setup> cannot contain ES module exports"。
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function read(rel) {
  try {
    return readFileSync(resolve(ROOT, rel), "utf8")
  } catch (error) {
    return `__READ_FAIL__:${String(error).slice(0, 80)}`
  }
}

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

console.log("\n「思源资源」插入链路 — 契约检查")
console.log("─".repeat(60))

const workspace = read("src/components/canvas/CanvasWorkspace.vue")
const dialog = read("src/components/canvas/CanvasAssetPickerDialog.vue")
const filePicker = read("src/canvas/use-canvas-editor-file-picker.ts")
const editor = read("src/canvas/use-canvas-editor.ts")
const lookups = read("src/canvas/siyuan-file-node-lookups.ts")
const kernelLookups = read("src/canvas/siyuan-kernel-file-node-lookups.ts")
const assetPicker = read("src/canvas/asset-picker.ts")
const zh = read("src/i18n/zh_CN.json")
const en = read("src/i18n/en_US.json")

// ── 1. 工具栏入口 ──
check(
  "工具栏有「思源资源」按钮（data-testid=bottom-toolbar-asset）",
  /data-testid="bottom-toolbar-asset"/.test(workspace),
)
check(
  "按钮绑定到 openAssetPicker",
  /bottom-toolbar-asset[\s\S]{0,400}?openAssetPicker/.test(workspace),
)
check(
  "按钮用独立图标 name=\"asset\"（不与 note/nebula 复用）",
  /data-testid="bottom-toolbar-asset"[\s\S]{0,400}?name="asset"/.test(workspace),
)

// ── 2. 选择器挂载 ──
check(
  "CanvasAssetPickerDialog 已挂载且以 visible 为闸门",
  /<CanvasAssetPickerDialog[\s\S]{0,200}?v-if="assetPickerVisible"/.test(workspace),
)
check(
  "搜索函数以 prop 注入（:search=）",
  /<CanvasAssetPickerDialog[\s\S]{0,300}?:search="searchAssetOptions"/.test(workspace),
)
check(
  "选择器内部确实调用注入的 search",
  /props\.search\s*\(/.test(dialog),
)

// ── 3. 编辑器方法必须「解构 + 导出」两处齐全 ──
//   ★ 只做一处 = editor.insertSiyuanAssetNode 为 undefined，点了没反应 ★
check(
  "use-canvas-editor.ts 从 file-picker 解构出 insertSiyuanAssetNode",
  /insertSiyuanAssetNode,?\s*\n\s*openFilePickerDialog/.test(editor),
)
check(
  "use-canvas-editor.ts 把 insertSiyuanAssetNode 放进 return 对象",
  /^\s{6}insertSiyuanAssetNode,\s*$/m.test(editor),
)
check(
  "file-picker 模块定义并导出 insertSiyuanAssetNode",
  /async function insertSiyuanAssetNode/.test(filePicker) && /returns|return \{[\s\S]{0,300}?insertSiyuanAssetNode/.test(filePicker),
)
check(
  "CanvasWorkspace 调用 editor.insertSiyuanAssetNode",
  /editor\.insertSiyuanAssetNode\s*\(/.test(workspace),
)

// ── 4. 落库路径形态（assets 表原始形态）──
check(
  "有 normalizeSiyuanAssetPath 归一化函数",
  /export function normalizeSiyuanAssetPath/.test(filePicker),
)
check(
  "归一化会剥掉前导斜杠与 data/ 前缀",
  // 只锚定 `replace(/^.../` 这段调用头，不依赖引号风格（源码用单引号）
  /\.replace\(\/\^\\\/\+/.test(filePicker) && /\.replace\(\/\^data\\\//.test(filePicker),
)
check(
  "插入时写入的是归一化后的路径（node.file = normalized）",
  /node\.file = normalized/.test(filePicker),
)

// ── 5. ★ 搜索 SQL 不得使用不存在的 updated 列（真库实测：assets 无此列）★ ──
const searchAssetBody = (() => {
  const i = lookups.indexOf("export async function searchSiyuanAssets")
  return i >= 0 ? lookups.slice(i, i + 1600) : ""
})()
check(
  "找到 searchSiyuanAssets 实现",
  searchAssetBody.length > 0,
)
check(
  "★ 反向断言：searchSiyuanAssets 不使用 ORDER BY updated（assets 表无此列，会直接报错）",
  searchAssetBody.length > 0 && !/ORDER BY\s+updated/i.test(searchAssetBody),
  "实测 assets 表列：id/block_id/root_id/box/docpath/path/name/title/hash",
)
check(
  "★ 反向断言：searchSiyuanAssets 不按图片扩展名过滤（否则 xlsm/pdf/py 资源全被挡掉）",
  searchAssetBody.length > 0 && !/path LIKE '%\.(png|jpg|jpeg)'/i.test(searchAssetBody),
  "实测最近 60 条：png 46 / xlsm 8 / pdf 3 / svg 1 / jpg 1 / py 1",
)
check(
  "★ 空关键字也返回列表（浏览态可用），而非直接 return []",
  searchAssetBody.length > 0 && !/if \(!trimmed\)\s*\{\s*return \[\]/.test(searchAssetBody),
)

// ── 6. 跨层接线：内核封装 → 组件 ──
check(
  "siyuan-kernel-file-node-lookups 导出 findSiyuanAssetsByQuery",
  /export async function findSiyuanAssetsByQuery/.test(kernelLookups),
)
check(
  "CanvasWorkspace 引入 findSiyuanAssetsByQuery 并用于搜索",
  /import \{ findSiyuanAssetsByQuery \}/.test(workspace)
  && /findSiyuanAssetsByQuery\(query\)/.test(workspace),
)

// ── 7. ★ script setup 不得含 export（编译期硬错误）★ ──
const setupBody = (() => {
  const i = dialog.indexOf("<script setup")
  return i >= 0 ? dialog.slice(i) : ""
})()
check(
  "★ 反向断言：选择器 <script setup> 内不含 export 语句（会编译失败）",
  setupBody.length > 0 && !/^\s*export\s+(interface|const|type|function|default)\b/m.test(setupBody),
  "类型须放在独立 .ts（src/canvas/asset-picker.ts）",
)
check(
  "选择器从独立模块导入 CanvasAssetPickerOption",
  /import type \{ CanvasAssetPickerOption \} from '@\/canvas\/asset-picker'/.test(dialog),
)

// ── 8. 类型模块确实提供映射 ──
check(
  "asset-picker.ts 导出 toAssetPickerOption 与 getAssetBadge",
  /export function toAssetPickerOption/.test(assetPicker) && /export function getAssetBadge/.test(assetPicker),
)

// ── 9. i18n 双语齐全 ──
const requiredKeys = [
  "bottomToolbarAsset",
  "assetPickerTitle",
  "assetPickerSearchLabel",
  "assetPickerSearchPlaceholder",
  "assetPickerEmpty",
  "assetPickerNoResult",
  "assetPickerLoading",
  "assetPickerInsert",
  "assetPickerCancel",
  "assetPickerLoadFailed",
  "messageAssetInserted",
]
const missingZh = requiredKeys.filter(k => !zh.includes(`"${k}"`))
const missingEn = requiredKeys.filter(k => !en.includes(`"${k}"`))
check("i18n zh_CN 含全部新键", missingZh.length === 0, missingZh.join(", ") || `${requiredKeys.length} 个键齐全`)
check("i18n en_US 含全部新键", missingEn.length === 0, missingEn.join(", ") || `${requiredKeys.length} 个键齐全`)

console.log("─".repeat(60))
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail > 0 ? 1 : 0)
