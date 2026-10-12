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
 * 「本机存储」相关设置。
 *
 * ★ 为什么**只有**「常用文件夹」一项、没有服务地址 ★
 *   地址探测完全由「本机存储」插件负责（同源 `/localfs` → 跨源 `:8021`，
 *   还跟着飞牛环境变）。画布这边再存一份只会出现"两边不一致"，
 *   而且用户要改两次。画布真正关心的只有一件事：**我常去哪几个文件夹**。
 *
 * ★ 为什么与「本机存储」插件自己的 favorites **分开存** ★
 *   那一份是它**侧边栏**的显示范围。画布是一块独立的工作台，
 *   在这里圈定的范围不该反过来把侧边栏的显示改掉（反之亦然）。
 */
export interface LocalFsSettings {
  /**
   * 常用文件夹（**绝对路径**数组，如 `/vol1/1000/文档`）。
   *   · 为空/未设置 ⇒ 选择器列出本机**全部**存储空间（默认行为）
   *   · 有值       ⇒ 只列出这几个文件夹
   *   存**路径**而不是"带标签的对象"：标签能随时从路径算出来，
   *   存两份就有不一致的那一天（改过名、换过挂载点）。
   */
  favorites: string[]
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
  localFs: LocalFsSettings
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

export function createDefaultLocalFsSettings(): LocalFsSettings {
  return {
    favorites: [],
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
    localFs: createDefaultLocalFsSettings(),
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

export function normalizeLocalFsSettings(value: unknown): LocalFsSettings {
  const defaults = createDefaultLocalFsSettings()
  if (!value || typeof value !== "object") {
    return defaults
  }

  const candidate = value as Partial<LocalFsSettings>
  if (!Array.isArray(candidate.favorites)) {
    return { favorites: defaults.favorites }
  }

  // 去重 + 只留非空字符串 + 统一成正斜杠：设置文件是可手改的明文 JSON，
  // 一份脏数据不该让整个选择器崩掉（它只是个字符串数组的消费方）。
  const seen = new Set<string>()
  const favorites: string[] = []
  for (const item of candidate.favorites) {
    if (typeof item !== "string") {
      continue
    }
    const path = item.trim().replace(/\\/g, "/")
    if (!path || seen.has(path)) {
      continue
    }
    seen.add(path)
    favorites.push(path)
  }

  return { favorites }
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
    localFs: normalizeLocalFsSettings(candidate.settings?.localFs),
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
