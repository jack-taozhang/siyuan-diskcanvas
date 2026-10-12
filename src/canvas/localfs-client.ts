/**
 * 「本机存储」（siyuan-localfs）对外契约的**消费层**。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 背景
 * ---------------------------------------------------------------------------
 * 画布原来的「网盘文件」入口，读的是网盘插件（NebulaDisk）的契约。
 * 现在改为读**本机存储插件**的契约 —— 也就是「跑着思源的那台机器」
 * （NAS）上的存储空间，与侧边栏那个「本机存储」面板是**同一份数据**。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 契约形状（对方仓库 `siyuan-localfs/src/external.js`）
 * ---------------------------------------------------------------------------
 *     window.__localfsPlugin = { name: "siyuan-localfs", external: { … } }
 *
 *   方法全部返回**信封** `{ ok, data, error, reason }` —— 不抛异常穿过边界。
 *     health()          → {app,version,roots[]}
 *     roots()           → [{path,label}]        本机全部存储空间
 *     list(path)        → {path, items:[{name,path,isDir,size,ext}]}
 *     probe(path)       → {isDir,readable,size,name,path}
 *     fileUrl(path)     → "<原生可渲染直链>"
 *     previewUrl(path)  → "<浏览器可打开的预览地址>"
 *     openFile(item)    → boolean               在思源页签里打开
 *     pickDirectories() → [{path,name}]         目录选择器（取消 = []）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 两条必须遵守的约束（与网盘那条契约同款，别"绕过去"）
 * ---------------------------------------------------------------------------
 *   · **不认识消费方**：契约里没有"画布"这个概念。本文件是消费侧，
 *     所以画布的语义只能出现在这里。
 *   · **地址一律由对方构造**：`fileUrl` / `previewUrl` 给的就是能直接塞进
 *     `<img src>` / `window.open` 的成品地址。本层**只转发，绝不自己拼**
 *     —— /localfs 同源通道、8021 直连端口、CAD/Office 借用的宿主应用端口
 *     这些都是对方的内部知识，抄一份过来必然漂移。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么没有"兜底客户端"（对比网盘那条链路）
 * ---------------------------------------------------------------------------
 *   网盘那侧曾经有一套画布自己的 `NebulaClient`（直连后端 /api/*），
 *   是为了兼容"网盘插件太老、没有契约"的存量用户。
 *   本机存储这条路**从第一天起就有契约**（契约与本功能同批交付），
 *   所以不留兜底：拿不到契约就明确报错，让用户看到"未检测到本机存储插件"，
 *   比给他一个连不上的半成品更清楚。
 * ========================================================================== */

/** 取小写扩展名（不含点）；没有扩展名返回空串 */
export function extOfPath(path: string): string {
  const clean = String(path || "").split(/[?#]/)[0]
  const name = clean.split(/[/\\]/).pop() || ""
  const dot = name.lastIndexOf(".")
  if (dot <= 0 || dot === name.length - 1) {
    return ""
  }
  return name.slice(dot + 1).toLowerCase()
}

/**
 * 是不是**可以直接用 `<img>` 渲染**的图片。
 *
 * ★ 为什么画布要自己判一下 ★
 *   决定"要不要在卡片里放缩略图"是**呈现层**的决定：图纸 / PDF / 视频
 *   放进卡片会拖死画布（一张几百 MB 的图纸），所以只有图片才取缩略图。
 *   而"用什么通道打开它"仍然完全交给对方（`previewUrl` 内部按类型分派），
 *   两件事不冲突、也不构成"复制对方的规则"。
 */
const IMAGE_EXTENSIONS = new Set([
  "avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp",
])

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extOfPath(path))
}

/** 人类可读的文件大小（卡片上那一行 `· 1.2 MB`） */
export function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes < 0 || !Number.isFinite(bytes)) {
    return "0 B"
  }
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export interface LocalFsEntry {
  ext?: string
  isDir: boolean
  name: string
  path: string
  size?: number
}

/** 存储空间（`/vol1` / `/vol00` …），label 是显示名 */
export interface LocalFsRoot {
  label: string
  path: string
}

export interface LocalFsProbeResult {
  isDir?: boolean
  name?: string
  path?: string
  readable?: boolean
  size?: number
}

interface LocalFsEnvelope<T> {
  data?: T
  error?: string
  ok?: boolean
  reason?: string
}

/** `window.__localfsPlugin.external` 的最小可用面（只声明本层用到的） */
export interface LocalFsExternalContract {
  fileUrl?: (path: string) => Promise<LocalFsEnvelope<string>>
  id?: string
  list?: (path: string) => Promise<LocalFsEnvelope<{ items?: LocalFsEntry[], path?: string }>>
  openFile?: (item: Record<string, unknown>) => Promise<LocalFsEnvelope<boolean>>
  pickDirectories?: () => Promise<LocalFsEnvelope<Array<{ name?: string, path: string }>>>
  previewUrl?: (path: string) => Promise<LocalFsEnvelope<string>>
  probe?: (path: string) => Promise<LocalFsEnvelope<LocalFsProbeResult>>
  roots?: () => Promise<LocalFsEnvelope<LocalFsRoot[]>>
  version?: number
}

/**
 * reason → 人话。
 *
 * ★ 为什么要分类而不是直接把 error 抛出去 ★
 *   同一句"读取失败"，对用户的行动指引完全不同：
 *     · missing     ⇒ 文件可能被移走了，刷新一下
 *     · unreachable ⇒ 服务连不上，去看看 NAS / 设置里的地址
 *   对方在信封里给了语义分类，这里必须用上 —— 否则那一段分类就是死代码。
 */
function describeReason(reason: string | undefined): string {
  if (reason === "missing") {
    return "文件或目录不存在"
  }
  if (reason === "denied") {
    return "没有访问权限"
  }
  if (reason === "unreachable") {
    return "本机存储服务暂时连不上"
  }
  return "未知错误"
}

function describeFailure(envelope: LocalFsEnvelope<unknown>): string {
  const reason = describeReason(envelope && envelope.reason)
  const error = typeof (envelope && envelope.error) === "string" ? (envelope.error as string).trim() : ""

  // 纯三位状态码属于与 reason 重复的技术信号，不再赘述
  if (!error || /^\d{3}$/.test(error)) {
    return reason
  }

  return `${reason}（${error}）`
}

function unwrap<T>(envelope: LocalFsEnvelope<T>, label: string): T {
  if (envelope && envelope.ok) {
    return envelope.data as T
  }

  throw new Error(`本机存储 ${label} 失败：${describeFailure(envelope)}`)
}

/** 某方法确实存在才敢调用（老版本可能缺，缺了要给可读错误而不是 TypeError） */
function requireMethod<K extends keyof LocalFsExternalContract>(
  contract: LocalFsExternalContract,
  key: K,
  ability: string,
): NonNullable<LocalFsExternalContract[K]> {
  const fn = contract[key]
  if (typeof fn !== "function") {
    throw new Error(`本机存储插件未提供「${ability}」能力，请升级「本机存储」插件`)
  }
  return fn as NonNullable<LocalFsExternalContract[K]>
}

/**
 * 取「本机存储」插件暴露的对外契约；不存在或核心方法缺失时返回 null。
 *
 * ★ 为什么必须校验方法存在 ★
 *   只判 `external` 是个对象是不够的 —— 一个只有 `id` 的空壳同样是对象。
 *   把半个对象当能力用，失败发生在**用户点下去那一刻**，而且报的是
 *   "xxx is not a function" 这种跟界面完全对不上的话。
 *
 * 要求的核心方法：`list` 与 `roots`（有这两个，选择器就能工作）。
 */
export function getLocalFsExternalContract(): LocalFsExternalContract | null {
  if (typeof window === "undefined") {
    return null
  }

  const plugin = (window as unknown as {
    __localfsPlugin?: { external?: LocalFsExternalContract }
  }).__localfsPlugin
  const external = plugin?.external

  if (!external
    || typeof external.list !== "function"
    || typeof external.roots !== "function") {
    return null
  }

  return external
}

/**
 * 「本机存储」插件的**目录名**（思源以插件目录名做唯一标识，即它的 `plugin.json.name`）。
 *
 * ★ 只用于"契约缺失时给出可执行的下一步"，绝不用于取能力 ★
 *   能力只有契约一条来源。这里出现插件名不等于"绕过契约去反射调它"。
 */
export const LOCALFS_PLUGIN_NAME = "siyuan-localfs"

/**
 * 页面上**是否已经加载**了「本机存储」插件的实例。
 *
 * ★ 为什么必须区分"没装"和"装了但是旧版" ★
 *   契约缺失有两种原因，用户的处置动作**完全相反方向**：
 *     · 插件没装 / 没启用  → 去插件市场装、去启用
 *     · 插件装了，但页面跑的还是**旧版 JS**（那份没有对外契约）
 *                          → 刷新思源页面
 *   内核会缓存插件 JS，**升版本号是唯一有效的破缓存手段** ——
 *   所以"我们刚更新了插件"之后，用户手里的页面很可能还在跑旧代码。
 *   只回一句"未检测到插件"会把这类人引到完全错误的方向（真机实测就踩到了：
 *   插件早已启用，只是页面没刷新）。
 *
 * ★ 为什么读 `app.plugins` 不越界 ★
 *   这里只是**看一眼当前加载了哪些插件**（思源自己的内部结构），
 *   拿到实例后**什么都不调**。列目录 / 打开文件仍然只走契约。
 *   拿不到这个结构时（独立网页、内核结构变动）返回 false，
 *   自动退化成原提示，不会因为这个判断本身报错。
 */
export function isLocalFsPluginLoaded(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  const siyuan = (window as unknown as {
    siyuan?: { ws?: { app?: { plugins?: Array<{ name?: string }> } } }
  }).siyuan
  const plugins = siyuan?.ws?.app?.plugins
  if (!Array.isArray(plugins)) {
    return false
  }
  return plugins.some((plugin) => Boolean(plugin) && plugin.name === LOCALFS_PLUGIN_NAME)
}

/** 契约缺失的原因：`absent` 真没装；`outdated` 装了但页面是旧 JS */
export type LocalFsUnavailableKind = "absent" | "outdated"

export function localFsUnavailableKind(): LocalFsUnavailableKind {
  return isLocalFsPluginLoaded() ? "outdated" : "absent"
}

/**
 * 契约缺失时的提示语。
 *
 * 调用点的措辞各不相同（面板里一行小字 / 右下角消息 / 对话框正文），
 * 所以由调用点给出**两个 key**，这里只负责挑一个 ——
 * 判别逻辑集中在本地，不必在每个调用点重抄一遍。
 *
 * ★ 为什么是泛型 `K` ★
 *   画布的翻译器是**窄键**类型（`CanvasI18nTranslator` 收 `CanvasI18nKey`），
 *   而选择器组件收的是宽松的 `(key: string) => string`。
 *   写成 `(key: string) => string` 会让前者报"参数类型不兼容"（函数参数逆变）；
 *   用 `K extends string` 让两边都能推出来，且两个 key 仍受各自的键表约束
 *   —— 打错键名照样编译不过。
 */
export function localFsUnavailableMessage<K extends string>(
  t: (key: K) => string,
  keys: { absent: K, outdated: K },
): string {
  return t(localFsUnavailableKind() === "outdated" ? keys.outdated : keys.absent)
}

/**
 * 与"能用的客户端"同形的适配器。
 *
 * 调用点（选择器、卡片预览、双击打开）都按这些方法签名写，
 * 于是"契约在不在"这件事只在 provider 一处判断，调用点一行都不用改。
 */
export class LocalFsContractClient {
  /**
   * 契约对象**公开只读**，供 provider 做「对象身份是否变化」的判断。
   *
   * 插件重载会换一个新对象；适配器必须识别出来并重建，
   * 否则升级后画布仍在调**旧代码**（网盘那条链路实测踩过）。
   */
  constructor(public readonly contract: LocalFsExternalContract) {}

  /** 契约存在即视为"已配置" —— 地址探测与连通性都由对方负责 */
  isConfigured(): boolean {
    return true
  }

  async roots(): Promise<LocalFsRoot[]> {
    const rows = unwrap(await requireMethod(this.contract, "roots", "列举存储空间")(), "列存储空间")
    if (!Array.isArray(rows)) {
      return []
    }
    return rows
      .filter((row) => row && typeof row.path === "string" && row.path)
      .map((row) => ({
        label: typeof row.label === "string" && row.label ? row.label : row.path,
        path: row.path,
      }))
  }

  async list(path: string): Promise<LocalFsEntry[]> {
    const data = unwrap(
      await requireMethod(this.contract, "list", "列目录")(path || "/"),
      "列目录",
    )
    const items = data && Array.isArray(data.items) ? data.items : []
    return items
      .filter((item): item is LocalFsEntry => Boolean(item && typeof item.path === "string"))
      .map((item) => ({
        ext: typeof item.ext === "string" ? item.ext : undefined,
        isDir: Boolean(item.isDir),
        name: typeof item.name === "string" && item.name ? item.name : item.path,
        path: item.path,
        size: typeof item.size === "number" ? item.size : undefined,
      }))
  }

  /**
   * 单文件元数据。**拿不到时返回 null 而不是抛** ——
   * 它只用来在卡片上补一个文件大小，属于"锦上添花"，
   * 不能因为一次查询失败就把整张卡片变成错误态。
   */
  async probe(path: string): Promise<LocalFsProbeResult | null> {
    if (typeof this.contract.probe !== "function") {
      return null
    }
    try {
      return unwrap(await this.contract.probe(path), "取元数据") || null
    } catch {
      return null
    }
  }

  /**
   * 原生可渲染直链（图片 / 音视频 / 文本可直接塞进 `<img>`/`<video>`/`<a>`）。
   * ★ 地址由对方构造，本层不改写 ★
   */
  async fileUrl(path: string): Promise<string> {
    const url = unwrap(await requireMethod(this.contract, "fileUrl", "取文件地址")(path), "取文件地址")
    if (!url) {
      throw new Error("本机存储未返回文件地址")
    }
    return url
  }

  /**
   * 浏览器可直接打开的预览地址（CAD / Office / 原生类型三档由对方分派）。
   * 独立网页里双击卡片时用这个 —— 那边没有思源的页签体系。
   */
  async previewUrl(path: string): Promise<string> {
    const url = unwrap(
      await requireMethod(this.contract, "previewUrl", "取预览地址")(path),
      "取预览地址",
    )
    if (!url) {
      throw new Error("本机存储未返回预览地址")
    }
    return url
  }

  /** 在思源页签里打开（与侧边栏双击文件走同一条链路） */
  async openFile(item: { kind?: string, name?: string, path: string, size?: number }): Promise<boolean> {
    const fn = requireMethod(this.contract, "openFile", "打开文件")
    return Boolean(unwrap(await fn({ ...item }), "打开文件"))
  }

  /** 目录选择器（多选，取消返回空数组）。设置面板「常用文件夹」用 */
  async pickDirectories(): Promise<Array<{ name: string, path: string }>> {
    const rows = unwrap(
      await requireMethod(this.contract, "pickDirectories", "目录选择器")(),
      "打开目录选择器",
    )
    if (!Array.isArray(rows)) {
      return []
    }
    return rows
      .filter((row): row is { name?: string, path: string } => Boolean(row && typeof row.path === "string" && row.path))
      .map((row) => ({
        name: typeof row.name === "string" && row.name ? row.name : (row.path.split("/").filter(Boolean).pop() || row.path),
        path: row.path,
      }))
  }
}
