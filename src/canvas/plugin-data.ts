import type { CanvasColorThemeId } from "@/canvas/canvas-color-themes"
import { DEFAULT_COLOR_THEME } from "@/canvas/canvas-color-themes"
import type { CanvasGridSettings } from "@/canvas/grid"
import {
  DEFAULT_CANVAS_GRID_SETTINGS,
  normalizeCanvasGridSettings,
} from "@/canvas/grid"

export type CanvasRecentFileSource = "local" | "workspace"

export const CANVAS_DEFAULT_DIRECTORY = "/data/storage/petal/siyuan-diskcanvas"

/**
 * 网盘连接配置。
 *
 * ★ 为什么把账号密码放进插件设置 ★
 *   画布要"插入网盘文件"，必须先能连上网盘。
 *   连接信息是**用户级**的，不属于画布数据本身 ——
 *   所以存在插件设置里（思源本地存储），而不是每个 .canvas 文件里。
 *   这样：一个画布文件拿去别处打开，不会把你网盘密码带出去。
 *
 * ★ 密码明文存储的风险，如实说明 ★
 *   思源插件设置存在工作区本地（data/storage/petal/<plugin>/），
 *   不加密。这与 siyuan-nebuladisk 的做法一致。
 *   若要更安全，可改为只填用户名、每次启动手动登录。
 */
export interface NebulaSettings {
  /** 网盘地址；留空则按当前页面主机名 + 8089 自动推断 */
  baseUrl: string
  username: string
  password: string
  /** 启动时自动登录 */
  autoLogin: boolean
  /** 浏览器端思源需经本地代理（跨源）时的代理地址 */
  proxyUrl: string
}

export interface CanvasPluginSettings {
  colorTheme: CanvasColorThemeId
  defaultCanvasDirectory: string
  detectExternalChanges: boolean
  enableDebugLog: boolean
  recentFilesLimit: number
  noteCreationDirectory: string
  showDragAlignmentGuides: boolean
  showCanvasThumbnails: boolean
  showNodeHeader: boolean
  autoCreateTextCardOnDrag: boolean
  /**
   * 网格线（样式 / 间距 / 吸附）。
   *
   * 为什么是一个子对象而不是三个扁平字段：这三项**永远一起用**
   * （画网格 + 吸网格是同一件事的两面），
   * 而且它们有一份共用的归一化逻辑 `normalizeCanvasGridSettings`，
   * 收在一个对象里就不会出现"样式合法但间距是 NaN"这种半脏状态。
   */
  grid: CanvasGridSettings
  nebula: NebulaSettings
}

export interface CanvasInspectorSectionsState {
  createEdge: boolean
  document: boolean
  edge: boolean
  node: boolean
  nodeEdges: boolean
  recent: boolean
  selection: boolean
}

export interface CanvasPluginUiState {
  inspectorSections: CanvasInspectorSectionsState
}

export interface CanvasRecentFile {
  openedAt: string
  path: string
  sourceType: CanvasRecentFileSource
  title: string
}

export interface CanvasPluginData {
  recentFiles: CanvasRecentFile[]
  settings: CanvasPluginSettings
  ui: CanvasPluginUiState
  version: 1
}

/**
 * NAS（网盘与思源同机部署）的默认地址 —— **全项目唯一一处硬编码**。
 *
 * ★ 只在「够不着页面主机」时才用到它 ★
 *   常规路径是 `guessNebulaBaseUrl()` 跟随**当前页面主机**推导，
 *   本常量仅兜底两种情形：
 *     · 本机装思源（页面在 127.0.0.1:6806），网盘在 NAS 上
 *     · 推导过程抛异常（catch 分支）
 *
 * ★ 地址变更记录（改这里就够了）★
 *   2026-09-28：`<netdisk-host>` → `<netdisk-host>`
 *   原因：NAS 的 LAN 地址（`enp2s0` `<netdisk-host>/22`）在当前网段下不可达；
 *         改经 ZeroTier 虚拟网卡（`ztuzes2xaf` `<netdisk-host>/24`）访问。
 *   实测（2026-09-28）：
 *     · `http://<netdisk-host>:8089/`          → HTTP 200
 *     · `http://<netdisk-host>:8089/api/login` → 200 + JWT
 *     · `http://<netdisk-host>:8089/`           → 不可达（连接超时）
 */
const DEFAULT_NEBULA_BASE_URL = "http://<netdisk-host>:8089"

/**
 * 推断一个合理的网盘地址。
 *
 * ★ 为什么不写死 IP ★
 *   同一个插件会被两种环境加载：
 *     · 桌面端（本机装思源）—— 页面在 127.0.0.1:6806，网盘常在另一台机器
 *     · 服务端（NAS 上 Docker 跑思源，浏览器访问）—— 页面在 <NAS 地址>:6806
 *   写死任何 IP 都会让另一种环境连不上。
 *
 *   默认策略：跟随**当前页面所在主机** + 端口 8089。
 *   实测（2026-09-28）：`http://<netdisk-host>:8089/api/login` 返回 200 + JWT，
 *   即「网盘与思源同机部署」这一前提在 NAS 场景成立。
 *   用户仍可在设置里改成别的地址。
 */
export function guessNebulaBaseUrl(): string {
  try {
    const host = (typeof location !== "undefined" && location.hostname) || ""
    if (!host || host === "localhost" || host === "127.0.0.1") {
      // 本机思源：网盘通常在 NAS 上，回落到实测可达的 NAS 地址
      return DEFAULT_NEBULA_BASE_URL
    }
    return `http://${host}:8089`
  } catch {
    return DEFAULT_NEBULA_BASE_URL
  }
}

export function createDefaultNebulaSettings(): NebulaSettings {
  return {
    autoLogin: true,
    baseUrl: guessNebulaBaseUrl(),
    password: "",
    proxyUrl: "",
    username: "tao_zhang",
  }
}

export function createDefaultCanvasPluginSettings(): CanvasPluginSettings {
  return {
    autoCreateTextCardOnDrag: false,
    colorTheme: DEFAULT_COLOR_THEME,
    defaultCanvasDirectory: CANVAS_DEFAULT_DIRECTORY,
    detectExternalChanges: true,
    enableDebugLog: false,
    grid: { ...DEFAULT_CANVAS_GRID_SETTINGS },
    nebula: createDefaultNebulaSettings(),
    noteCreationDirectory: "",
    recentFilesLimit: 8,
    showCanvasThumbnails: false,
    showDragAlignmentGuides: false,
    showNodeHeader: true,
  }
}

export function createDefaultCanvasPluginUiState(): CanvasPluginUiState {
  return {
    inspectorSections: {
      createEdge: true,
      document: true,
      edge: true,
      node: true,
      nodeEdges: true,
      recent: true,
      selection: true,
    },
  }
}

export function createDefaultCanvasPluginData(): CanvasPluginData {
  return {
    recentFiles: [],
    settings: createDefaultCanvasPluginSettings(),
    ui: createDefaultCanvasPluginUiState(),
    version: 1,
  }
}

function getCanvasPathTitle(path: string): string {
  const normalized = path.split(/[\\/]/)
  return normalized[normalized.length - 1] || path
}

function normalizeRecentSourceType(path: string, value: unknown): CanvasRecentFileSource {
  if (value === "local" || value === "workspace") {
    return value
  }

  return path.startsWith("/data/") ? "workspace" : "local"
}

export function normalizeNebulaSettings(value: unknown): NebulaSettings {
  const defaults = createDefaultNebulaSettings()
  if (!value || typeof value !== "object") {
    return defaults
  }
  const candidate = value as Partial<NebulaSettings>
  return {
    autoLogin: typeof candidate.autoLogin === "boolean" ? candidate.autoLogin : defaults.autoLogin,
    baseUrl: typeof candidate.baseUrl === "string" && candidate.baseUrl.trim()
      ? candidate.baseUrl.trim()
      : defaults.baseUrl,
    password: typeof candidate.password === "string" ? candidate.password : defaults.password,
    proxyUrl: typeof candidate.proxyUrl === "string" ? candidate.proxyUrl.trim() : defaults.proxyUrl,
    username: typeof candidate.username === "string" && candidate.username.trim()
      ? candidate.username.trim()
      : defaults.username,
  }
}

export function normalizeCanvasPluginData(value: unknown): CanvasPluginData {
  const VALID_COLOR_THEMES: CanvasColorThemeId[] = ["classic", "cool-rainbow", "earth", "neon"]
  const defaults = createDefaultCanvasPluginData()
  if (!value || typeof value !== "object") {
    return defaults
  }

  const candidate = value as Partial<CanvasPluginData> & {
    settings?: Partial<CanvasPluginSettings>
    recentFiles?: Partial<CanvasRecentFile>[]
    ui?: {
      inspectorSections?: Partial<Record<keyof CanvasInspectorSectionsState, unknown>>
    }
  }

  const recentFiles = Array.isArray(candidate.recentFiles)
    ? candidate.recentFiles
        .filter((item): item is Partial<CanvasRecentFile> => Boolean(item && typeof item === "object"))
        .filter((item) => typeof item.path === "string" && item.path.length > 0)
        .map((item) => ({
          openedAt: typeof item.openedAt === "string" && item.openedAt
            ? item.openedAt
            : new Date(0).toISOString(),
          path: item.path!,
          sourceType: normalizeRecentSourceType(item.path!, item.sourceType),
          title: typeof item.title === "string" && item.title ? item.title : getCanvasPathTitle(item.path!),
        }))
    : defaults.recentFiles

  const settings: CanvasPluginSettings = {
    autoCreateTextCardOnDrag: typeof candidate.settings?.autoCreateTextCardOnDrag === "boolean"
      ? candidate.settings.autoCreateTextCardOnDrag
      : defaults.settings.autoCreateTextCardOnDrag,
    colorTheme: (VALID_COLOR_THEMES as string[]).includes(candidate.settings?.colorTheme as string)
      ? candidate.settings!.colorTheme as CanvasColorThemeId
      : defaults.settings.colorTheme,
    defaultCanvasDirectory: typeof candidate.settings?.defaultCanvasDirectory === "string"
      && candidate.settings.defaultCanvasDirectory.trim()
      ? candidate.settings.defaultCanvasDirectory.trim()
      : defaults.settings.defaultCanvasDirectory,
    detectExternalChanges: typeof candidate.settings?.detectExternalChanges === "boolean"
      ? candidate.settings.detectExternalChanges
      : defaults.settings.detectExternalChanges,
    enableDebugLog: typeof candidate.settings?.enableDebugLog === "boolean"
      ? candidate.settings.enableDebugLog
      : defaults.settings.enableDebugLog,
    nebula: normalizeNebulaSettings(candidate.settings?.nebula),
    noteCreationDirectory: typeof candidate.settings?.noteCreationDirectory === "string"
      ? candidate.settings.noteCreationDirectory.trim()
      : defaults.settings.noteCreationDirectory,
    recentFilesLimit: Number.isInteger(candidate.settings?.recentFilesLimit)
      && Number(candidate.settings?.recentFilesLimit) > 0
      ? Number(candidate.settings?.recentFilesLimit)
      : defaults.settings.recentFilesLimit,
    showCanvasThumbnails: typeof candidate.settings?.showCanvasThumbnails === "boolean"
      ? candidate.settings.showCanvasThumbnails
      : defaults.settings.showCanvasThumbnails,
    showDragAlignmentGuides: typeof candidate.settings?.showDragAlignmentGuides === "boolean"
      ? candidate.settings.showDragAlignmentGuides
      : defaults.settings.showDragAlignmentGuides,
    showNodeHeader: typeof candidate.settings?.showNodeHeader === "boolean"
      ? candidate.settings.showNodeHeader
      : defaults.settings.showNodeHeader,
    // 网格：整体交给 grid.ts 的归一化器（它负责合法样式、间距夹取与小数处理）
    grid: normalizeCanvasGridSettings(candidate.settings?.grid),
  }

  const inspectorDefaults = defaults.ui.inspectorSections
  const candidateSections = candidate.ui?.inspectorSections
  const inspectorSections: CanvasInspectorSectionsState = {
    createEdge: typeof candidateSections?.createEdge === "boolean" ? candidateSections.createEdge : inspectorDefaults.createEdge,
    document: typeof candidateSections?.document === "boolean" ? candidateSections.document : inspectorDefaults.document,
    edge: typeof candidateSections?.edge === "boolean" ? candidateSections.edge : inspectorDefaults.edge,
    node: typeof candidateSections?.node === "boolean" ? candidateSections.node : inspectorDefaults.node,
    nodeEdges: typeof candidateSections?.nodeEdges === "boolean" ? candidateSections.nodeEdges : inspectorDefaults.nodeEdges,
    recent: typeof candidateSections?.recent === "boolean" ? candidateSections.recent : inspectorDefaults.recent,
    selection: typeof candidateSections?.selection === "boolean" ? candidateSections.selection : inspectorDefaults.selection,
  }

  return {
    recentFiles: recentFiles.slice(0, settings.recentFilesLimit),
    settings,
    ui: {
      inspectorSections,
    },
    version: 1,
  }
}

export function rememberRecentCanvasFile(
  data: CanvasPluginData,
  entry: CanvasRecentFile,
): CanvasPluginData {
  const normalized = normalizeCanvasPluginData(data)
  const recentFiles = [
    entry,
    ...normalized.recentFiles.filter((item) => item.path !== entry.path),
  ].slice(0, normalized.settings.recentFilesLimit)

  return {
    ...normalized,
    recentFiles,
  }
}

export function removeRecentCanvasFile(
  data: CanvasPluginData,
  path: string,
): CanvasPluginData {
  const normalized = normalizeCanvasPluginData(data)
  return {
    ...normalized,
    recentFiles: normalized.recentFiles.filter((item) => item.path !== path),
  }
}

export function updateCanvasPluginUiState(
  data: CanvasPluginData,
  ui: Partial<CanvasPluginUiState>,
): CanvasPluginData {
  const normalized = normalizeCanvasPluginData(data)

  return normalizeCanvasPluginData({
    ...normalized,
    ui: {
      ...normalized.ui,
      ...ui,
      inspectorSections: {
        ...normalized.ui.inspectorSections,
        ...ui.inspectorSections,
      },
    },
  })
}
