import type { Setting } from "siyuan"
import type { CanvasPluginSettings } from "@/canvas/plugin-data"
import type { CanvasI18nTranslator } from "@/canvas/use-canvas-editor-shared"

import { CANVAS_COLOR_THEMES } from "@/canvas/canvas-color-themes"
import { guessNebulaBaseUrl } from "@/canvas/plugin-data"

/**
 * 插件设置面板（DiskCanvas 盘绘）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 与上游设置面板的区别 ★
 *   上游面板混装了 AI 搜索、演示模式、PNG 导出等业务配置。
 *   本插件**只保留画布本身 + 网盘接入**所需的设置项，分三组：
 *     ① 网盘连接（本插件新增，核心）
 *     ② 画布基础（目录、最近文件、外部变更检测）
 *     ③ 显示（配色、缩略图、节点标题、对齐辅助线）
 * ══════════════════════════════════════════════════════════════════════
 */

export interface CanvasPluginSettingsPanelOptions {
  createSetting: (options: { width: string }) => Setting
  getSettings: () => CanvasPluginSettings
  onSettingsChanged?: () => void
  pluginName: string
  saveSettings: (settings: CanvasPluginSettings) => Promise<void>
  t: CanvasI18nTranslator
}

const STYLE_ID = "siyuan-diskcanvas-next-settings-styles"

function injectSettingsPanelStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return
  }
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
    .dcn-settings-group {
      margin: 6px 0 18px 0;
      border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
      border-radius: 8px;
      background-color: rgba(120, 120, 128, 0.06);
      padding: 4px 12px;
    }
    .dcn-settings-group__title {
      font-weight: 600;
      font-size: 13px;
      padding: 10px 0 4px 0;
      color: var(--b3-theme-on-background);
      display: block;
    }
    .dcn-settings-note {
      font-size: 12px;
      line-height: 1.7;
      color: var(--b3-theme-on-surface);
      opacity: 0.8;
      padding: 6px 0 10px 0;
    }
    .dcn-settings-status {
      font-size: 12px;
      padding: 8px 10px;
      border-radius: 6px;
      margin: 6px 0 12px 0;
      line-height: 1.6;
    }
    .dcn-settings-status--ok {
      background: rgba(34, 197, 94, 0.12);
      color: #16a34a;
    }
    .dcn-settings-status--warn {
      background: rgba(245, 158, 11, 0.14);
      color: #b45309;
    }
  `
  document.head.appendChild(style)
}

/** 简单文本输入项 */
function textItem(
  setting: Setting,
  opts: {
    title: string
    description?: string
    value: string
    type?: string
    placeholder?: string
    onChange: (v: string) => void
  },
): void {
  setting.addItem({
    createActionElement: () => {
      const input = document.createElement("input")
      input.className = "b3-text-field fn__flex-center"
      input.type = opts.type || "text"
      input.style.width = "240px"
      input.value = opts.value
      if (opts.placeholder) {
        input.placeholder = opts.placeholder
      }
      input.addEventListener("change", () => opts.onChange(input.value))
      return input
    },
    description: opts.description,
    title: opts.title,
  })
}

/** 开关项 */
function switchItem(
  setting: Setting,
  opts: {
    title: string
    description?: string
    value: boolean
    onChange: (v: boolean) => void
  },
): void {
  setting.addItem({
    createActionElement: () => {
      const input = document.createElement("input")
      input.className = "b3-switch fn__flex-center"
      input.type = "checkbox"
      input.checked = opts.value
      input.addEventListener("change", () => opts.onChange(input.checked))
      return input
    },
    description: opts.description,
    title: opts.title,
  })
}

export function openCanvasPluginSettingsPanel(options: CanvasPluginSettingsPanelOptions): Setting {
  const {
    createSetting,
    getSettings,
    onSettingsChanged,
    pluginName,
    saveSettings,
    t,
  } = options

  const draft = getSettings()
  // 深拷贝网盘子对象，避免直接改到原引用
  draft.nebula = { ...getSettings().nebula }

  injectSettingsPanelStyles()

  const setting = createSetting({ width: "620px" })

  const saveDraft = async () => {
    await saveSettings({ ...draft })
    onSettingsChanged?.()
  }
  // ─────────────────────────────────────────────
  // ② 画布基础
  // ─────────────────────────────────────────────
  textItem(setting, {
    description: t("settingsDefaultCanvasDirectoryDescription") || "新建画布文件的存放目录",
    onChange: async (v) => {
      draft.defaultCanvasDirectory = v.trim() || "/data/storage/petal/siyuan-diskcanvas-next"
      await saveDraft()
    },
    title: t("settingsDefaultCanvasDirectoryTitle") || "默认画布目录",
    value: draft.defaultCanvasDirectory,
  })

  textItem(setting, {
    description: t("settingsNoteCreationDirectoryDescription") || "从画布新建笔记时的存放目录；留空表示默认位置",
    onChange: async (v) => {
      draft.noteCreationDirectory = v.trim()
      await saveDraft()
    },
    title: t("settingsNoteCreationDirectoryTitle") || "笔记新建目录",
    value: draft.noteCreationDirectory,
  })

  setting.addItem({
    createActionElement: () => {
      const input = document.createElement("input")
      input.className = "b3-text-field fn__flex-center"
      input.type = "number"
      input.min = "1"
      input.max = "20"
      input.style.width = "120px"
      input.value = String(draft.recentFilesLimit)
      input.addEventListener("change", async () => {
        const n = Number.parseInt(input.value, 10)
        draft.recentFilesLimit = Number.isNaN(n) ? 8 : Math.min(20, Math.max(1, n))
        input.value = String(draft.recentFilesLimit)
        await saveDraft()
      })
      return input
    },
    description: t("settingsRecentCanvasFileLimitDescription") || "最近打开列表保留的条目数",
    title: t("settingsRecentCanvasFileLimitTitle") || "最近文件数",
  })

  switchItem(setting, {
    description: t("settingsDetectExternalFileChangesDescription") || "画布文件被外部修改时提示冲突",
    onChange: async (v) => {
      draft.detectExternalChanges = v
      await saveDraft()
    },
    title: t("settingsDetectExternalFileChangesTitle") || "检测外部变更",
    value: draft.detectExternalChanges,
  })

  switchItem(setting, {
    description: t("settingsEnableDebugLogDescription") || "输出调试日志到浏览器控制台",
    onChange: async (v) => {
      draft.enableDebugLog = v
      await saveDraft()
    },
    title: t("settingsEnableDebugLogTitle") || "调试日志",
    value: draft.enableDebugLog,
  })

  // ─────────────────────────────────────────────
  // ③ 显示
  // ─────────────────────────────────────────────
  setting.addItem({
    createActionElement: () => {
      const select = document.createElement("select")
      select.className = "b3-select fn__flex-center"
      for (const theme of CANVAS_COLOR_THEMES) {
        const option = document.createElement("option")
        option.value = theme.id
        option.textContent = t(theme.nameKey)
        if (theme.id === draft.colorTheme) {
          option.selected = true
        }
        select.appendChild(option)
      }
      select.addEventListener("change", async () => {
        draft.colorTheme = select.value as CanvasPluginSettings["colorTheme"]
        await saveDraft()
      })
      return select
    },
    description: t("settingsColorThemeDescription") || "画布卡片的配色方案",
    title: t("settingsColorThemeTitle") || "配色主题",
  })

  switchItem(setting, {
    description: t("settingsShowCanvasThumbnailsDescription") || "显示右下角缩略导航",
    onChange: async (v) => {
      draft.showCanvasThumbnails = v
      await saveDraft()
    },
    title: t("settingsShowCanvasThumbnailsTitle") || "缩略导航",
    value: draft.showCanvasThumbnails,
  })

  switchItem(setting, {
    description: t("settingsShowNodeHeaderDescription") || "显示卡片顶部标题栏",
    onChange: async (v) => {
      draft.showNodeHeader = v
      await saveDraft()
    },
    title: t("settingsShowNodeHeaderTitle") || "卡片标题栏",
    value: draft.showNodeHeader,
  })

  switchItem(setting, {
    description: t("settingsShowDragAlignmentGuidesDescription") || "拖动卡片时显示对齐辅助线",
    onChange: async (v) => {
      draft.showDragAlignmentGuides = v
      await saveDraft()
    },
    title: t("settingsShowDragAlignmentGuidesTitle") || "对齐辅助线",
    value: draft.showDragAlignmentGuides,
  })

  switchItem(setting, {
    description: t("settingsAutoCreateTextCardOnDragDescription") || "拖拽空白处自动创建文本卡片",
    onChange: async (v) => {
      draft.autoCreateTextCardOnDrag = v
      await saveDraft()
    },
    title: t("settingsAutoCreateTextCardOnDragTitle") || "拖拽创建文本卡片",
    value: draft.autoCreateTextCardOnDrag,
  })

  setting.open(pluginName)
  return setting
}
