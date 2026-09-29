/**
 * 独立网页编辑器的 URL 约定 —— 工具栏按钮与 standalone 入口**共用这一份**。
 * ============================================================================
 *
 * 为什么单独抽一个模块：
 *   生成 URL（工具栏）与解析 URL（standalone 页）必须严格互逆。
 *   一旦一边改了参数名或编码方式，另一边不会报错，只会**静默打开错误的文件**
 *   （或干脆读不到）。放在同一处 + 单测覆盖往返，是最省的防护。
 *
 * ★ 为什么是 `/plugins/<插件名>/standalone.html` 这样的**绝对路径** ★
 *   思源内核把每个插件的目录挂在服务根下的 `/plugins/<插件名>/`
 *   （`index.js` / `icon.png` / `README.md` 都从这里取，实测 200）。
 *   思源自己的资源也都是绝对路径（`/stage/...`、`/appearance/...`），
 *   即它本来就不支持挂在反向代理的子路径下，所以这里跟随同一约定。
 *
 * ★ 编码用 `encodeURIComponent`，不用 `URLSearchParams` ★
 *   `URLSearchParams.toString()` 会把空格写成 `+`，而 `URLSearchParams` 解析时
 *   又把 `+` 还原成空格 —— 看似自洽，但只要路径里**真的有 `+`**（文件名合法字符），
 *   往返就会把它变成空格，指向另一个文件。`encodeURIComponent` 无此歧义。
 */

/** standalone 页在插件目录里的文件名（构建产物同名）。 */
export const STANDALONE_PAGE_FILENAME = "standalone.html"

/** 查询参数名：要打开的画布文件的工作区路径。 */
export const STANDALONE_PATH_PARAM = "path"

/** 查询参数名：构建版本（缓存击穿用）。 */
export const STANDALONE_VERSION_PARAM = "v"

/**
 * 构造独立编辑页的 URL。
 *
 * @param pluginName 插件名（= 内核里的目录名，也是 `plugin.name`）
 * @param filePath   画布文件的工作区路径，如 `/data/我的画布.canvas`
 * @param version    插件版本，用于给页面 URL 加 `?v=` 缓存击穿参数（可省）
 *
 * ★ 为什么要有 `v` ★
 *   内核给 `/plugins/**` 的静态响应**没有 `Cache-Control`，也没有 `ETag`**，
 *   只有 `Last-Modified`（实测）。浏览器会按启发式规则缓存，
 *   环境里可能滞留旧页面 —— 表现是"插件升级了但独立页还是老样子"。
 *   思源自己也用同一招（`theme.css?v=3.8.5`、`/?r=<hash>`），保持一致。
 *
 *   注意这里只能击穿**页面本身**：页面里引用的 `standalone.js` / `standalone.css`
 *   的 URL 是构建期写死在 HTML 里的，加不上参数。那两者靠 `Last-Modified`
 *   重验证兜底（文件名不变 ⇒ 不会出现"HTML 指向已删除文件"的 404 风险）。
 */
export function buildStandalonePageUrl(pluginName: string, filePath: string, version?: string): string {
  const params = [
    `${STANDALONE_PATH_PARAM}=${encodeURIComponent(filePath)}`,
  ]
  if (version) {
    params.push(`${STANDALONE_VERSION_PARAM}=${encodeURIComponent(version)}`)
  }
  return `/plugins/${pluginName}/${STANDALONE_PAGE_FILENAME}?${params.join("&")}`
}

/**
 * 从 location.search 里取要打开的画布路径。
 *
 * 容错：缺参数 / 只有空白 ⇒ 返回空串（调用方据此显示"缺少参数"提示，
 * 而不是去读一个空路径 —— 那会命中内核的"路径不合法"分支，报出难以理解的错）。
 */
export function readStandalonePath(search: string): string {
  const raw = new URLSearchParams(search).get(STANDALONE_PATH_PARAM)
  return (raw || "").trim()
}
