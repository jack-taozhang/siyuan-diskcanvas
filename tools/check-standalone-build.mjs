/**
 * 构建产物闸门：独立页（standalone）是否**真的**被打出来了。
 * ============================================================================
 *
 * 为什么需要它
 * ---------------------------------------------------------------------------
 * 独立页与插件本体是**两次构建、一个输出目录**（见 `vite.standalone.config.ts`）。
 * 这种结构有两个"安静出错"的姿势，肉眼看不出来：
 *
 *   ① 有人重排了 `npm run build` 的顺序（或单独跑了 `vite build`），
 *      插件构建的 `emptyOutDir: true` 会把 standalone.* 一起清掉
 *      ⇒ 产物里根本没有独立页，但插件本身完全正常。
 *
 *   ② `siyuan` 的 alias 失效（例如被 `@` 之外的规则抢先匹配）。
 *      此时构建**仍然成功**，但产物里会留下 `require("siyuan")`，
 *      浏览器打开独立页时直接白屏 —— 而"构建成功"会让人误以为没事。
 *
 * 所以这里只做**产物层面**的断言（不看源码意图）：
 *   · standalone.html / standalone.js / standalone.css 三件套齐全
 *   · html 里确实引到了 js 与 css（相对路径）
 *   · standalone.js 是浏览器可直接执行的 ESM，**不含 require("siyuan")**
 *   · standalone.js 里确实带着画布外壳的特征串 ⇒ 证明打包的是同一套组件，
 *     而不是某个"简化版渲染器"
 *   · index.js 仍是 CJS 且保留 `require("siyuan")`（宿主注入，不能被顺手改掉）
 *
 * 用法：node tools/check-standalone-build.mjs [--dir dist]
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"

const args = process.argv.slice(2)
const dirIndex = args.indexOf("--dir")
const distDir = resolve(process.cwd(), dirIndex >= 0 ? (args[dirIndex + 1] || "dist") : "dist")

const failures = []
const notes = []

function fail(message) {
  failures.push(message)
}

function readIfExists(relativePath) {
  const absolute = resolve(distDir, relativePath)
  if (!existsSync(absolute)) {
    fail(`缺少文件：${relativePath}`)
    return null
  }
  return readFileSync(absolute, "utf8")
}

/* ── ① 三件套齐全 ─────────────────────────────────────────────── */
const html = readIfExists("standalone.html")
const js = readIfExists("standalone.js")
const css = readIfExists("standalone.css")

/* ── ② HTML 必须引到 js 与 css（相对路径 + 版本参数） ─────────── */
if (html) {
  const jsMatch = /<script[^>]+src="\.\/standalone\.js(\?v=([^"&]*))?"/.exec(html)
  const cssMatch = /<link[^>]+href="\.\/standalone\.css(\?v=([^"&]*))?"/.exec(html)

  if (!jsMatch) {
    fail('standalone.html 没有引用 "./standalone.js"（相对路径错了会导致页面 404）')
  }
  if (!cssMatch) {
    fail('standalone.html 没有引用 "./standalone.css"（画布样式会全部丢失）')
  }

  /**
   * ★ 版本参数是**必须**的，不是可选项 ★
   *   内核静态响应没有 Cache-Control/ETag，只靠 Last-Modified，
   *   浏览器启发式缓存会让"插件升级了但独立页仍跑旧 bundle"静默发生。
   *   少了 `?v=` 就等于把这个坑重新挖开 —— 所以在这里硬性拦下。
   */
  const pluginJsonPath = resolve(process.cwd(), "plugin.json")
  const expectedVersion = existsSync(pluginJsonPath)
    ? JSON.parse(readFileSync(pluginJsonPath, "utf8")).version
    : null

  if (jsMatch && cssMatch) {
    const jsVersion = jsMatch[2] || ""
    const cssVersion = cssMatch[2] || ""
    if (!jsVersion || !cssVersion) {
      fail(`standalone.html 的资源缺少 ?v= 版本参数（js="${jsVersion}" css="${cssVersion}"）—— 会静默加载旧 bundle`)
    } else if (jsVersion !== cssVersion) {
      fail(`js 与 css 的版本参数不一致（js=${jsVersion} css=${cssVersion}）`)
    } else if (expectedVersion && jsVersion !== expectedVersion) {
      fail(`资源版本参数 ${jsVersion} 与 plugin.json 的 ${expectedVersion} 不一致`)
    } else {
      notes.push(`standalone.html 引用 ./standalone.js?v=${jsVersion} 与 ./standalone.css?v=${cssVersion}`)
    }
  }
}

/* ── ③ standalone.js 必须是浏览器可执行的 ESM，且不依赖 siyuan ── */
if (js) {
  if (/require\(\s*["']siyuan["']\s*\)/.test(js)) {
    fail('standalone.js 里仍有 require("siyuan") —— siyuan 的 alias 没生效，独立页会白屏')
  }
  // CJS 外壳：有 module.exports / Object.defineProperty(exports 说明走的是 lib 模式
  if (/Object\.defineProperty\(\s*exports/.test(js) || /module\.exports\s*=/.test(js)) {
    fail("standalone.js 看起来是 CJS 产物（不应出现 exports/module.exports）")
  }
  if (!/^\s*import\s|^\s*export\s|import\(/m.test(js) && !/from"\.\//.test(js)) {
    notes.push("standalone.js 未检出 import 语句（单块产物可能已被内联，仅供参考）")
  }

  /**
   * ★ 特征串证明"用的是同一套画布组件" ★
   *   `.canvas-shell` 是 CanvasWorkspace 的根类名，出现在产物里说明
   *   打包的确实是那个组件（而不是另写的简化渲染器）。
   *   同时抽查两个业务特征：卡片类名与只读能力矩阵的字段名。
   */
  for (const marker of ["canvas-shell", "canvas-toolbar", "editDocument"]) {
    if (!js.includes(marker)) {
      fail(`standalone.js 里找不到画布特征串 "${marker}" —— 打包的可能不是同一套渲染组件`)
    }
  }

  const sizeKb = Math.round(Buffer.byteLength(js) / 1024)
  notes.push(`standalone.js 大小 ${sizeKb} KB（含 Vue + 画布组件全量）`)
}

/* ── ④ 插件本体仍须是 CJS + external siyuan（不能被改坏） ─────── */
const pluginJs = readIfExists("index.js")
if (pluginJs && !/require\(\s*["']siyuan["']\s*\)/.test(pluginJs)) {
  fail('index.js 里没有 require("siyuan") —— 插件本体的 external 配置被破坏了')
}

/* ── ⑤ ★ 产物必须是**当前源码**构建出来的（陈旧的产物不能被放行）★ ─
 *
 * 为什么补这一条（实测漏洞，2026-09-29）
 * ---------------------------------------------------------------------------
 * 上面的 ①②③④ 全是**产物内部**的自洽性检查：三件套齐、互相引用、
 * 版本串彼此一致、特征串存在。它们有一个共同的盲区 ——
 *
 *   只要版本串**彼此一致**，一组**陈旧**的产物就能骗过全部检查。
 *
 * 实测过的真实事故：`npx vite build --config vite.standalone.config.ts
 * --outDir .verify/out-r35` 想输出到别处，但那个配置里 `outDir` 是**硬编码**
 * 的 `dist` ⇒ 产物写进了 `dist/`，而 `.verify/out-r35/` 里留着**上一次**的
 * `standalone.html`（`?v=0.2.10`）。当时闸门对那个目录报了 OK ——
 * 因为它内部自洽（js/css/html 的版本串互相都是 0.2.10）。
 * 若拿这种目录去部署，用户拿到的是**上一版的独立页**，而且谁都看不出来。
 *
 * 判据（两条，互补）
 * ---------------------------------------------------------------------------
 *   ⓐ 时间新鲜度：产物的 mtime 必须 **不早于** `src/` 下最新的源文件。
 *      源码改过却没重新构建 ⇒ 一眼拦下。这条能覆盖"改了别的文件但忘了重构建"。
 *
 *   ⓑ 内容指纹：把 `src/` 里**实际存在**的特征串（从源码里现场提取，
 *      不是硬编码清单 —— 硬编码会随重构漂移，最后变成"检查器自己失配"）
 *      拿去产物里核对。这条覆盖"源码改了、产物也重新生成了，
 *      但生成的是**另一套**源码"的诡异情况（例如构建缓存/别名串了）。
 *
 * ★ 为什么指纹要"从源码现场提取"而不是写死 ★
 *   本项目已经栽过一次：`check:embed-slash` 因为写死了旧的变量名
 *   （`readonly` / `isEmbedMode`），能力矩阵重构后它就一直在报假失败，
 *   被误当成"已知失败"而失去防线作用。**检查器的判据必须跟着源码走。**
 */

/** 取 src/ 下最新的源文件 mtime（用递归 glob，不依赖外部工具） */
function newestSourceMtime(root) {
  const srcDir = resolve(root, "src")
  if (!existsSync(srcDir)) {
    return null
  }
  let newest = 0
  let newestFile = ""
  const stack = [srcDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (/\.(ts|vue|js|mjs|json|css)$/.test(entry.name)) {
        const mtime = statSync(full).mtimeMs
        if (mtime > newest) {
          newest = mtime
          newestFile = full
        }
      }
    }
  }
  return newest > 0 ? { mtime: newest, file: newestFile } : null
}

const sourceInfo = newestSourceMtime(process.cwd())

/** 把 src/ 下所有源码拼成一段文本（用于判断某个标记是否**真的存在于源码**） */
function readAllSources(srcDir) {
  if (!existsSync(srcDir)) {
    return ""
  }
  let text = ""
  const stack = [srcDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (/\.(ts|vue|js|mjs|json)$/.test(entry.name)) {
        text += readFileSync(full, "utf8")
      }
    }
  }
  return text
}

/**
 * ★ 只有**真构建产物**才做新鲜度断言 ★
 *   闸门支持 `--dir` 指向任意目录（便于单测/排障），那种场景下"产物比源码旧"
 *   往往是故意的（就是为了复现旧产物的问题）。所以：
 *     · 目标是默认的 dist/ ⇒ 严格断言
 *     · 目标是别处     ⇒ 只提示，不 fail
 *   （避免把闸门变成"只能在一种调用方式下用"的脆东西。）
 */
const isDefaultDist = distDir === resolve(process.cwd(), "dist")

if (sourceInfo && isDefaultDist) {
  for (const name of ["standalone.html", "standalone.js", "standalone.css", "index.js", "index.css"]) {
    const full = resolve(distDir, name)
    if (!existsSync(full)) {
      continue
    }
    const artifactMtime = statSync(full).mtimeMs
    if (artifactMtime < sourceInfo.mtime) {
      const rel = sourceInfo.file.replace(process.cwd(), "").replace(/^[\\/]/, "")
      fail(
        `${name} 比源码旧 —— 源码 "${rel}" 更新于构建之后，产物是**陈旧的**`
        + `（产物 ${new Date(artifactMtime).toISOString()} < 源码 ${new Date(sourceInfo.mtime).toISOString()}）`
        + `；请重新跑 npm run build`,
      )
    }
  }
  notes.push(`新鲜度检查：产物均不早于最新源码（${new Date(sourceInfo.mtime).toISOString()}）`)
} else if (sourceInfo && !isDefaultDist) {
  notes.push("--dir 指向非默认目录 ⇒ 跳过时间新鲜度断言（仅做内部自洽性检查）")
}

/**
 * ★ 内容指纹：源码里真实存在的标记，产物里必须有 ★
 *   从源码现场提取，避免"检查器写死标记、重构后自己失配"。
 *
 * ★★ 标记必须**压缩稳定**（重要，踩过）★★
 *   第一版我选了函数名（`openCanvasInStandaloneTab` / `buildStandalonePageUrl`），
 *   结果**假失败**：esbuild 压缩会把它们改成短名，产物里 0 次出现。
 *   ⇒ 只有**字符串字面量**与**保留下来的常量名**才可用（前者最稳）。
 *   同理，i18n 键（如 `standaloneOpenBlocked`）也稳定 —— 它本身就是字符串。
 */
if (js) {
  /** 这些标记必须**同时**出现在 src/ 某处与 standalone.js 里 */
  const REQUIRED_MARKERS = [
    "standalone.html",         // 独立页文件名常量（字符串字面量，压缩后保留）
    "standaloneOpenBlocked",   // 独立页被弹窗拦截时的提示键（i18n 字符串，稳定）
  ]
  const srcDir = resolve(process.cwd(), "src")
  const srcText = existsSync(srcDir) ? readAllSources(srcDir) : ""
  for (const marker of REQUIRED_MARKERS) {
    if (srcText.includes(marker) && !js.includes(marker)) {
      fail(
        `standalone.js 里缺少源码中存在的能力标记 "${marker}"`
        + ` —— 产物不是由当前源码构建的（陈旧产物 / 构建串了目录）`,
      )
    }
  }
}

/* ── 输出 ─────────────────────────────────────────────────────── */
for (const note of notes) {
  console.log(`  · ${note}`)
}

if (failures.length > 0) {
  console.error(`\n[check-standalone-build] ${failures.length} 项失败：`)
  for (const item of failures) {
    console.error(`  ✗ ${item}`)
  }
  process.exit(1)
}

console.log("[check-standalone-build] OK")
