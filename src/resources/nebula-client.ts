/**
 * NebulaDisk 网盘客户端。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 所有端点均经实测确认（2026-09-28，curl 直连 <netdisk-host>:8089）★
 * ══════════════════════════════════════════════════════════════════════
 *
 *   POST /api/login   Form(username,password) → {ok,username,display,isAdmin,token,expiresIn}
 *   GET  /api/me      Bearer token             → {username,isAdmin,title,mounts[],onlyoffice,cad,disk}
 *   GET  /api/list?mount=&path=                → {path,entries[{name,isDir,size,mtime,ext,route,mime,readonly,path}]}
 *   GET  /api/stat?mount=&path=                → 文件属性
 *   GET  /api/preview?mount=&path=             → {ok,url:"/preview/onlinePreview?…",raw}
 *   GET  /api/cad/preview?mount=&path=         → {ok,url:"/cad/?open=…"}
 *
 * 实测记录：
 *   · login      200，返回 token（JWT，expiresIn=43200 即 12 小时）
 *   · /api/me    200，mounts = 售前项目/研发立项/项目设计，onlyoffice=true, cad=true
 *   · /api/list  200，entries 字段名是 isDir / mtime / ext / route / mime
 *   · /api/mounts 404 —— **不存在**，挂载点只能从 /api/me 取
 *
 * ★ 为什么不用 Cookie 会话 ★
 *   浏览器跨源请求受 SameSite=lax 限制，Cookie 不会带上。
 *   而 login 返回的 token 是显式凭据，放在 Authorization 头里，
 *   不受 Cookie 策略影响，两种部署形态（本机/容器）都成立。
 *
 * ★ 直连与代理 ★
 *   本插件跑在思源渲染进程内：
 *     · 桌面端（Electron）—— 可直连网盘地址
 *     · 浏览器端（容器思源）—— 受 CORS 限制，需经 siyuan-nebuladisk 的本地代理 127.0.0.1:6810
 *   因此 baseUrl 由调用方注入，本模块不自作主张。
 */

/** 文件条目（与 /api/list 的 entries 同构） */
export interface NebulaEntry {
  name: string
  isDir: boolean
  size: number
  mtime: number
  ext: string
  route: string
  mime: string
  readonly: boolean
  path: string
}

/** 挂载点 */
export interface NebulaMount {
  label: string
  writable: boolean
}

/** 后端能力与容量 */
export interface NebulaMe {
  username: string
  isAdmin: boolean
  title: string
  mounts: NebulaMount[]
  onlyoffice: boolean
  cad: boolean
  disk: {
    total: number
    used: number
    free: number
  }
}

export interface NebulaClientOptions {
  /** 网盘基地址，如 http://<netdisk-host>:8089 */
  baseUrl: string
  /** 登录用户名 */
  username: string
  /** 登录密码 */
  password: string
  /** 可选：日志函数 */
  log?: (msg: string) => void
}

/**
 * 渲染通道（由文件类型决定，与 siyuan-nebuladisk 的 pickViewer 保持一致）。
 *
 * ★ 为什么必须分流，不能一律用直链 ★
 *   浏览器原生只渲染 PDF/图片/视频/音频/文本。
 *   Office、CAD、压缩包**即使服务端发 inline 也会下载** —— 浏览器没有对应渲染器。
 */
export type NebulaViewerKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'office'
  | 'cad'
  | 'text'
  | 'archive'
  | 'download'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']
const VIDEO_EXT = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v']
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']
const OFFICE_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'csv', 'rtf']
const CAD_EXT = ['dwg', 'dxf', 'step', 'stp', 'iges', 'igs', 'stl', 'obj', '3mf', 'sldprt', 'sldasm']
const TEXT_EXT = [
  'txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log',
  'js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
  'go', 'rs', 'rb', 'php', 'sh', 'bat', 'ps1', 'sql', 'css', 'scss', 'less', 'html', 'htm',
]
const ARCHIVE_EXT = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso']

/** 取扩展名（小写，不含点） */
export function extOf(name: string): string {
  const idx = String(name || '').lastIndexOf('.')
  if (idx < 0) return ''
  return String(name).slice(idx + 1).toLowerCase()
}

/**
 * 按文件名判断渲染通道。
 * 纯函数，无副作用 —— 便于单测。
 */
export function pickViewer(name: string): NebulaViewerKind {
  const ext = extOf(name)
  if (!ext) return 'download'
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (ext === 'pdf') return 'pdf'
  if (OFFICE_EXT.includes(ext)) return 'office'
  if (CAD_EXT.includes(ext)) return 'cad'
  if (TEXT_EXT.includes(ext)) return 'text'
  if (ARCHIVE_EXT.includes(ext)) return 'archive'
  return 'download'
}

/** 人类可读的文件大小 */
export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/**
 * 网盘客户端。
 *
 * 设计要点：
 *   · token 由本类保管，自动附加到请求头 —— 调用方不需要关心鉴权细节
 *   · 401 时**自动重新登录一次**（token 12 小时过期，长会话必然遇到）
 *   · 所有方法失败时抛错，由上层决定是否降级（不在这里静默吞掉）
 */
export class NebulaClient {
  private readonly baseUrl: string
  private readonly username: string
  private readonly password: string
  private readonly log: (msg: string) => void
  private token = ''
  private loginPromise: Promise<string> | null = null

  constructor(options: NebulaClientOptions) {
    this.baseUrl = String(options.baseUrl || '').replace(/\/+$/, '')
    this.username = options.username
    this.password = options.password
    this.log = options.log || (() => {})
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  /**
   * 是否具备可用的连接配置。
   *
   * ★ 为什么 password 也要非空 ★
   *   实测（2026-09-28）：NebulaDisk 后端 `POST /api/login` 走 FastAPI 的
   *   `Form(...)` 声明，**空串会被当作缺失字段**，直接返回：
   *     HTTP 422 {"type":"missing","loc":["body","password"],"msg":"Field required"}
   *   若这里只校验 baseUrl+username，客户端就会被创建并发出「空密码」请求，
   *   用户看到的是裸 422，而不是「请先填密码」。
   *   故把 password 纳入配置完整性判据，让调用方走「未配置」分支给出可读提示。
   */
  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.username && this.password)
  }

  /**
   * 拼接后端绝对地址（用于 <img>/<video>/iframe 的 src）。
   *
   * ★ 必须处理「容器内主机名」★
   *   实测（2026-09-28）：/api/preview 返回的 url 里嵌的是
   *     http://nebula:8088/api/raw/...
   *   `nebula` 是 docker compose 里的**服务名**，只在容器网络内可解析。
   *   浏览器打开这个地址必然 DNS 失败 —— 表现为「预览一直转圈」。
   *
   *   判据（移植自 siyuan-nebuladisk，经实战验证）：
   *     凡是与当前基点**不同源**、且主机名**不含点**的短名
   *     （docker 服务名/容器名没有域名后缀）⇒ 判定为容器内地址，改写主机。
   *   不写死 "nebula"，这样 compose 换服务名也兜得住。
   *
   *   只换「协议+主机+端口」，**路径与查询串（含签名 sig/exp）原样保留** ——
   *   签名是对路径+参数算的，动一处就失效。
   */
  absolute(pathOrUrl: string): string {
    const v = String(pathOrUrl || '')
    if (!v) return ''

    const abs = /^https?:\/\//i.test(v)
      ? v
      : `${this.baseUrl}${v.startsWith('/') ? '' : '/'}${v}`

    if (!/^https?:\/\//i.test(abs)) return abs

    let target: URL
    let base: URL
    try {
      target = new URL(abs)
      base = new URL(this.baseUrl)
    } catch {
      return abs
    }

    // 同源 ⇒ 已经是对的
    if (target.host === base.host) return abs

    const bareHost = target.hostname
    const looksInternal = Boolean(bareHost)
      && bareHost.indexOf('.') < 0
      && bareHost !== 'localhost'
      && bareHost !== '127.0.0.1'

    if (!looksInternal) return abs

    const fromHost = target.host
    target.protocol = base.protocol
    target.hostname = base.hostname
    target.port = base.port
    this.log(`直链主机改写：${fromHost} → ${base.host}（容器内名改为浏览器可达）`)
    return target.toString()
  }

  /** 登录并缓存 token。并发调用会复用同一个 Promise，避免重复登录。 */
  async login(): Promise<string> {
    if (this.token) return this.token
    if (this.loginPromise) return this.loginPromise

    this.loginPromise = (async () => {
      // 空密码会被后端当作「字段缺失」并回 422（FastAPI Form 语义），
      // 这里提前拦截，给出可操作的提示，而不是让用户看到裸 HTTP 422。
      if (!this.username || !this.password) {
        throw new Error('网盘未配置完整（缺少用户名或密码），请在插件设置中填写')
      }
      const form = new URLSearchParams()
      form.append('username', this.username)
      form.append('password', this.password)
      const res = await fetch(`${this.baseUrl}/api/login`, {
        body: form,
        method: 'POST',
      })
      if (!res.ok) {
        throw new Error(`登录失败：HTTP ${res.status}`)
      }
      const data = await res.json()
      if (!data || !data.ok || !data.token) {
        throw new Error(`登录失败：${(data && data.detail) || '未返回 token'}`)
      }
      this.token = String(data.token)
      this.log(`登录成功：${data.display || this.username}`)
      return this.token
    })().finally(() => {
      this.loginPromise = null
    })

    return this.loginPromise
  }

  /** 带鉴权的 GET，401 时自动重登重试一次 */
  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    await this.login()
    const url = new URL(`${this.baseUrl}${path}`)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v)
      }
    }

    const doFetch = async () => fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
      method: 'GET',
    })

    let res = await doFetch()
    if (res.status === 401 || res.status === 403) {
      this.log('token 失效，重新登录')
      this.token = ''
      await this.login()
      res = await doFetch()
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`请求失败 ${path}：HTTP ${res.status} ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }

  /** 当前用户信息与挂载点 */
  me(): Promise<NebulaMe> {
    return this.get<NebulaMe>('/api/me')
  }

  /** 列出挂载点 */
  async listMounts(): Promise<NebulaMount[]> {
    const me = await this.me()
    return (me && me.mounts) || []
  }

  /**
   * 列目录。
   * 后端可能返回数组或 {entries:[...]}，这里统一成数组。
   */
  async list(mount: string, path: string): Promise<NebulaEntry[]> {
    const r = await this.get<any>('/api/list', { mount, path: path || '/' })
    if (Array.isArray(r)) return r as NebulaEntry[]
    if (r && Array.isArray(r.entries)) return r.entries as NebulaEntry[]
    if (r && Array.isArray(r.items)) return r.items as NebulaEntry[]
    return []
  }

  /** 单文件元数据 */
  stat(mount: string, path: string): Promise<NebulaEntry> {
    return this.get<NebulaEntry>('/api/stat', { mount, path })
  }

  /**
   * 取预览页地址（kkFileView 通道）。
   * @returns 后端给出的相对地址，如 /preview/onlinePreview?…
   */
  async previewUrl(mount: string, path: string): Promise<string> {
    const r = await this.get<{ ok?: boolean, url?: string }>('/api/preview', { mount, path })
    if (!r || !r.url) {
      throw new Error('网盘未返回预览地址')
    }
    return this.absolute(r.url)
  }

  /** 取 CAD 预览地址 */
  async cadUrl(mount: string, path: string): Promise<string> {
    const r = await this.get<{ ok?: boolean, url?: string }>('/api/cad/preview', { mount, path })
    if (!r || !r.url) {
      throw new Error('网盘未返回 CAD 预览地址')
    }
    return this.absolute(r.url)
  }
}
