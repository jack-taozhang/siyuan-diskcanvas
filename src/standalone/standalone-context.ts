/**
 * 独立网页编辑器用到的**纯函数**（可单测，不碰 DOM / 网络）。
 * ============================================================================
 *
 * 单独抽出来的理由：这两件事都**只有一次做对的机会**，做错了页面看起来"能开"，
 * 但和思源里的观感不一致，靠肉眼很难判断到底是哪一半错了。
 * 放在这里用单测钉住，比在浏览器里反复试省事得多。
 */

import enUS from "@/i18n/en_US.json"
import zhCN from "@/i18n/zh_CN.json"

/**
 * 属性取值：双引号 / 单引号 / 无引号三种写法都要认。
 *
 * 为什么连"无引号"也认（浏览器本来就接受）：
 *   这个解析器面对的是**别人生成的 HTML**（思源内核的输出，可能被反向代理、
 *   被中间层重写过），少认一种写法就是"样式静默少加载一条" ——
 *   而少一条恰好是主题变量那条时，现象是"画布颜色全丢"，
 *   排查成本远高于这里多写一个分支。
 */
const ATTR_VALUE = `(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`

function readAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*${ATTR_VALUE}`, "i")
  const matched = pattern.exec(tag)
  if (!matched) {
    return null
  }
  return matched[1] ?? matched[2] ?? matched[3] ?? null
}

/**
 * ★ 为什么要从思源的 HTML 里**扒样式表**，而不是硬编码几个 URL ★
 *
 * 画布样式重度依赖思源主题变量（`--b3-theme-surface` / `--b3-border-color` / …，
 * 全项目 180 处引用）。独立页面拿不到这些变量 ⇒ 卡片背景、边框、文字色**全部失效**，
 * 渲染就不再"和思源里面一样"。
 *
 * 而这些变量由**两张样式表**提供，且 URL 随版本/主题变化：
 *   · `/stage/build/desktop/base.<内容哈希>.css`   ← 基座变量 + 组件样式（b3-button/b3-dialog…）
 *   · `/appearance/themes/<主题名>/theme.css?v=…`  ← 当前主题（daylight / midnight / 第三方）
 *
 * 文件名里的哈希没法猜、主题名用户可换 ⇒ 唯一稳的做法是**读思源自己吐出来的
 * 首页 HTML**（`GET /`），把其中的 `<link rel="stylesheet">` 原样搬过来。
 * 这样版本升级、换主题、换第三方主题都自动跟随，零维护。
 *
 * @returns 样式表 URL 列表，顺序与 HTML 中一致（顺序有意义：主题要盖在基座之上）
 */
export function extractStylesheetHrefs(html: string): string[] {
  const hrefs: string[] = []
  const seen = new Set<string>()

  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (readAttribute(tag, "rel")?.trim().toLowerCase() !== "stylesheet") {
      continue
    }

    const href = readAttribute(tag, "href")?.trim()
    if (!href || seen.has(href)) {
      continue
    }

    seen.add(href)
    hrefs.push(href)
  }

  return hrefs
}

/**
 * 思源 `conf.appearance` 里与"取哪套样式"相关的字段（只声明用到的）。
 */
export interface KernelAppearance {
  mode?: unknown
  themeDark?: unknown
  themeLight?: unknown
  themeVer?: unknown
}

/**
 * ★ 为什么主题样式表必须**单独**算，而 HTML 里扒不到 ★
 *
 * 实测（NAS 真机，思源 v3.8.5）：`GET /` 返回的初始 HTML 里**只有 base.css**，
 * `theme.css` 那条 `<link>` 是**前端运行时才插进去的**：
 *
 *   initial HTML : <link href="/stage/build/desktop/base.048ce7f1….css" rel="stylesheet">
 *   运行时 DOM   : base.css + /appearance/themes/midnight/theme.css?v=3.8.5 + highlight.css
 *
 * 而 `--b3-theme-*` 这一整族变量（画布 180 处引用）**恰好全在 theme.css 里**
 * —— 只搬 base.css 会得到"结构对、颜色全丢"的页面，
 * 比彻底打不开更容易被误判为"渲染没问题"。
 *
 * 所以主题这条单独按内核配置拼：
 *   mode=1 → `conf.appearance.themeDark`（如 midnight）
 *   mode=0 → `conf.appearance.themeLight`（如 daylight）
 * 拼出来的地址与运行时那条逐一对应，含 `?v=<themeVer>` 版本参数。
 *
 * @returns 主题样式表 URL；配置里没有主题名时返回 null（调用方跳过）。
 */
export function resolveThemeStylesheetHref(appearance: KernelAppearance | null | undefined): string | null {
  const mode = resolveThemeModeLabel(appearance?.mode)
  const rawName = mode === "dark" ? appearance?.themeDark : appearance?.themeLight
  const name = typeof rawName === "string" ? rawName.trim() : ""
  if (!name) {
    return null
  }

  const rawVersion = typeof appearance?.themeVer === "string" ? appearance.themeVer.trim() : ""
  const version = rawVersion ? `?v=${encodeURIComponent(rawVersion)}` : ""
  return `/appearance/themes/${encodeURIComponent(name)}/theme.css${version}`
}

/**
 * 内核返回的语言标记 → 本插件 i18n 目录的键。
 *
 * 思源用 BCP-47 风格（`zh_CN` / `zh-CN` / `en_US` / `en-US` 都出现过），
 * 插件目录里只有 `zh_CN.json` 与 `en_US.json` 两份，
 * 所以这里做**归一化 + 兜底**：认不出来的语言一律回落 zh_CN
 * （与 `createCanvasI18n` 的 FALLBACK_LOCALE 保持一致，避免两处兜底不一致）。
 */
export function resolveI18nCatalog(lang: unknown): Record<string, string> {
  const normalized = String(lang ?? "").replace("_", "-").toLowerCase()
  if (normalized.startsWith("en")) {
    return enUS
  }
  return zhCN
}

/**
 * 思源 `conf.appearance.mode` → `data-theme-mode` 属性值。
 *
 * 思源用 `0 = 浅色 / 1 = 深色`（本机实测 `mode: 1` + `themeDark: "midnight"`，
 * 页面 `<html data-theme-mode="dark">`）。画布的 `detectHostThemeMode()` 读的
 * 就是这个属性，所以必须给出**完全相同的字面量**（"light" / "dark"），
 * 否则会落到默认的 light，深色用户打开独立页会看到浅色画布。
 *
 * 注意入参可能是数字 1、字符串 "1"、布尔 true —— 三者在内核不同接口里都见过。
 */
export function resolveThemeModeLabel(mode: unknown): "dark" | "light" {
  if (mode === 1 || mode === "1" || mode === true) {
    return "dark"
  }
  if (typeof mode === "string" && mode.trim().toLowerCase().includes("dark")) {
    return "dark"
  }
  return "light"
}
