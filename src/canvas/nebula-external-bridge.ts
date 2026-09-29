/**
 * 网盘对外契约适配层 —— 第 13 轮 #13
 * ============================================================================
 *
 * 背景（用户要求）
 * ---------------------------------------------------------------------------
 * 「移除画布插件针对网盘的设置，依托网盘插件链接OK，能访问那就可以。」
 *
 * 改造前：画布**自己**维护一份网盘连接配置（baseUrl / username / password /
 * proxyUrl），并存在自己的插件设置里。用户要在**两个地方**各配一遍网盘，
 * 而且画布侧一旦没配好，`getNebulaClient()` 直接返回 null ⇒ 网盘选择器与
 * 网盘文件节点**全部不可用**。
 *
 * 现在：网盘插件已经提供了**为消费方设计的对外契约**
 * （`window.__nebuladiskPlugin.external`，见另一个仓库的 `src/external.js`），
 * 画布改为**消费该契约** —— 网盘插件登录好了，画布就能用，画布不再需要自己的配置。
 *
 * ---------------------------------------------------------------------------
 * 契约的两条硬约束（必须尊重，不要"绕过去"）
 * ---------------------------------------------------------------------------
 *   · **C-5：网盘不认识画布** —— 契约只描述"我能做什么"，
 *     本适配层是**消费方**，所以"画布"的语义只能出现在这一侧，不能反馈给网盘。
 *   · **C-4：URL 一律由网盘侧构造**（`previewUrl` / `cadUrl` / `signedRawUrl` …），
 *     **消费方禁止自己拼后端地址**（内部可能是容器名，需要改写为浏览器可达地址）。
 *     ⇒ 本层**只做转发**，绝不自己拼 URL。
 *
 * ---------------------------------------------------------------------------
 * 错误语义
 * ---------------------------------------------------------------------------
 *   契约**不抛异常穿过边界**，失败返回 `{ ok:false, error, reason }`，
 *   其中 `reason` 区分 `missing`(404) / `denied`(403) / `unreachable`(0)。
 *   而画布既有代码（`NebulaClient` 的调用点）是**按抛异常写的**。
 *   为了不改动那批调用点，这里在 `unwrap()` 里**把失败还原成异常**，
 *   并把 `reason` 映射成人话，保留"连不上"与"文件不存在"的区别。
 */

import type {
  NebulaEntry,
  NebulaMount,
} from "@/resources/nebula-client"

/** 契约返回信封 */
interface NebulaExternalEnvelope<T> {
  data?: T
  error?: string
  ok?: boolean
  reason?: string
}

/** `window.__nebuladiskPlugin.external` 的最小可用面（只声明本层用到的） */
interface NebulaExternalContract {
  cadUrl?: (mount: string, path: string) => Promise<NebulaExternalEnvelope<string>>
  id?: string
  list?: (mount: string, path: string) => Promise<NebulaExternalEnvelope<NebulaEntry[] | { entries?: NebulaEntry[] }>>
  listMounts?: () => Promise<NebulaExternalEnvelope<NebulaMount[]>>
  previewUrl?: (mount: string, path: string) => Promise<NebulaExternalEnvelope<string>>
  stat?: (mount: string, path: string) => Promise<NebulaExternalEnvelope<NebulaEntry>>
  /** 浏览器可直接打开的地址（网盘侧按类型路由，见下） */
  webUrl?: (mount: string, path: string, name?: string) => Promise<NebulaExternalEnvelope<string>>
  version?: number
}

/** reason → 人话（保留"连不上"与"不存在"的区别，别让上层误报"文件已删除"） */
function describeReason(reason: string | undefined): string {
  if (reason === "missing") {
    return "文件或目录不存在"
  }
  if (reason === "denied") {
    return "没有访问权限"
  }
  if (reason === "unreachable") {
    return "网盘暂时连不上"
  }
  return "未知错误"
}

/**
 * 把失败信封拼成一句用户能懂的话。
 *
 * ★ 为什么不是"有 error 就用 error"（原来的写法）★
 *   网盘侧的 `guard()` **总是**同时给出 `error`（原始异常信息）与 `reason`
 *   （语义分类 missing / denied / unreachable）。原实现写成
 *   `envelope.error || describeReason(envelope.reason)`，
 *   于是 `reason` 这一整段映射**永远不会被用到** —— 是死代码，
 *   用户看到的是 `网盘 取预览地址 失败：404` 这种"技术信号"，
 *   而设计意图（保留「连不上」与「不存在」的区别）完全落空。
 *
 * 处置：**以语义 reason 为主**，原始 error 作为补充信息附在括号里；
 *   error 只是三位状态码时（最常见情况）视为与 reason 重复，不再赘述。
 */
function describeFailure(envelope: NebulaExternalEnvelope<unknown>): string {
  const reason = describeReason(envelope && envelope.reason)
  const error = typeof (envelope && envelope.error) === "string" ? (envelope.error as string).trim() : ""

  if (!error || /^\d{3}$/.test(error)) {
    return reason
  }

  return `${reason}（${error}）`
}

function unwrap<T>(envelope: NebulaExternalEnvelope<T>, label: string): T {
  if (envelope && envelope.ok) {
    return envelope.data as T
  }

  throw new Error(`网盘 ${label} 失败：${describeFailure(envelope)}`)
}

/** 取网盘插件暴露的对外契约；不存在或版本/方法不全时返回 null。 */
export function getNebulaExternalContract(): NebulaExternalContract | null {
  if (typeof window === "undefined") {
    return null
  }

  const plugin = (window as unknown as {
    __nebuladiskPlugin?: { external?: NebulaExternalContract }
  }).__nebuladiskPlugin
  const external = plugin?.external

  if (!external
    || typeof external.listMounts !== "function"
    || typeof external.list !== "function"
    || typeof external.stat !== "function") {
    return null
  }

  return external
}

/**
 * 与 `NebulaClient` **同形**的适配器。
 *
 * 之所以要求同形：画布的选择器与文件节点是按 `NebulaClient` 的方法签名写的，
 * 同形就能**一行不改**地切过去（也便于保留原客户端作为兜底）。
 */
export class NebulaExternalClient {
  /**
   * 契约对象**公开只读**，供 `getNebulaClient` 做「对象身份是否变化」的判断。
   *
   * 为什么需要它：网盘插件每次重载都会换一个新对象（`window.__nebuladiskPlugin`），
   * 适配器必须能识别出"契约换人了"并重建，否则会一直调用**旧代码**
   * （实测：网盘侧修好 `webUrl` 后，画布仍拿到旧的 `[object Promise]`）。
   */
  constructor(public readonly contract: NebulaExternalContract) {}

  /**
   * 契约存在即视为"已配置" —— 登录由网盘插件负责，画布无需再持有凭据。
   * 这也是"移除画布侧网盘设置"能成立的关键。
   */
  isConfigured(): boolean {
    return true
  }

  /**
   * 登录：**什么都不用做**。
   *
   * 契约存在就说明网盘插件已经登录好了（这正是「画布不再自己配网盘账号密码」的前提）。
   * 保留这个方法是为了满足消费方"先 login 再 stat"的既有调用顺序，
   * 而不是暗示这里需要一次真实登录 —— 真实登录属于网盘侧的职责（C-5）。
   */
  async login(): Promise<void> {
    /* no-op：契约可用即已登录 */
  }

  async listMounts(): Promise<NebulaMount[]> {
    return unwrap(await this.contract.listMounts!(), "列挂载点") || []
  }

  async list(mount: string, path: string): Promise<NebulaEntry[]> {
    const data = unwrap(await this.contract.list!(mount, path || "/"), "列目录")
    // 契约可能返回数组或 {entries:[...]}，与 NebulaClient 一样统一成数组
    if (Array.isArray(data)) {
      return data as NebulaEntry[]
    }
    if (data && Array.isArray((data as { entries?: NebulaEntry[] }).entries)) {
      return (data as { entries: NebulaEntry[] }).entries
    }
    return []
  }

  async stat(mount: string, path: string): Promise<NebulaEntry> {
    return unwrap(await this.contract.stat!(mount, path), "取元数据")
  }

  /** ★ C-4：URL 由网盘侧构造，本层只转发 ★ */
  async previewUrl(mount: string, path: string): Promise<string> {
    if (typeof this.contract.previewUrl !== "function") {
      throw new Error("网盘未提供预览地址能力")
    }
    const url = unwrap(await this.contract.previewUrl(mount, path), "取预览地址")
    if (!url) {
      throw new Error("网盘未返回预览地址")
    }
    return url
  }

  async cadUrl(mount: string, path: string): Promise<string> {
    if (typeof this.contract.cadUrl !== "function") {
      throw new Error("网盘未提供 CAD 预览地址能力")
    }
    const url = unwrap(await this.contract.cadUrl(mount, path), "取 CAD 预览地址")
    if (!url) {
      throw new Error("网盘未返回 CAD 预览地址")
    }
    return url
  }

  /**
   * ★ 「浏览器可直接打开的地址」—— 独立网页双击网盘卡片时用这个 ★
   *
   * 为什么**不**在这里按扩展名自己分流（`pickViewer` + preview/cad 二选一）：
   *   网盘侧已经有一个专门的调度器（`browserViewUrl`），它按类型给出三档结果：
   *     · CAD            → cad-viewer 深链
   *     · 原生类型       → `/api/raw` 签名直链（pdf/图片/视频/音频/文本，零转换最快）
   *     · Office/压缩包/其它 → kkFileView 在线预览页
   *   并且它自己处理了「容器内主机名 → 浏览器可达地址」的改写（C-4 的核心）。
   *   我们这边再写一份分流 = 两套规则必然漂移，而且**必然漏掉地址改写**。
   *
   * 契约里没有这个方法时抛错（调用方降级提示），**不猜** ——
   * 老版本网盘插件的 `previewUrl` 对 office 会给出错误通道，猜出来的结果比明确报错更糟。
   */
  async webUrl(mount: string, path: string, name?: string): Promise<string> {
    if (typeof this.contract.webUrl !== "function") {
      throw new Error("网盘未提供「网页打开地址」能力")
    }
    const url = unwrap(await this.contract.webUrl(mount, path, name), "取网页打开地址")
    if (!url) {
      throw new Error("网盘未返回网页打开地址")
    }
    return url
  }
}
