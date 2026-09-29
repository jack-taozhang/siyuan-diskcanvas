import type { Setting } from "siyuan"
import type { CanvasPluginSettings } from "@/canvas/plugin-data"
import type { CanvasI18nTranslator } from "@/canvas/use-canvas-editor-shared"

import { CANVAS_COLOR_THEMES } from "@/canvas/canvas-color-themes"
import {
  CANVAS_GRID_SIZE_MAX,
  CANVAS_GRID_SIZE_MIN,
  CANVAS_GRID_SIZE_PRESETS,
  CANVAS_GRID_STYLES,
  clampCanvasGridSize,
  type CanvasGridStyle,
} from "@/canvas/grid"
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

const STYLE_ID = "siyuan-diskcanvas-settings-styles"

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

/** 网格样式 → i18n 键（`Record<具体键名>` 保证新增样式必然补文案） */
const GRID_STYLE_I18N_KEYS: Record<CanvasGridStyle, "gridStyleDots" | "gridStyleGrid" | "gridStyleHlines" | "gridStyleNone" | "gridStyleVlines"> = {
  dots: "gridStyleDots",
  grid: "gridStyleGrid",
  hlines: "gridStyleHlines",
  none: "gridStyleNone",
  vlines: "gridStyleVlines",
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

/**
 * 下拉选择项。
 *
 * 与 `textItem` / `switchItem` 同一风格（都是 `setting.addItem` + 自造元素），
 * 因为思源 `Setting` 的三个便捷方法（addText/addSwitch/addSelect）在**同一份面板里
 * 混用**时排布不一致 —— 现成的 `addSelect` 不带 `data-setting-key`，
 * 插件自己的 CSS 就管不到它的宽度，四行选项会宽窄不一。
 *
 * @param options.value 选项值
 * @param options.options 选项列表（**必须包含当前值**，否则下拉会显示成第一项，
 *        用户一打开设置就"被改掉"了）
 * @param options.label 选项显示文案
 */
function selectItem(
  setting: Setting,
  opts: {
    title: string
    description?: string
    value: string
    options: Array<{ label: string, value: string }>
    onChange: (v: string) => void
  },
): void {
  setting.addItem({
    createActionElement: () => {
      const select = document.createElement("select")
      select.className = "b3-select fn__flex-center"
      select.setAttribute("data-setting-key", opts.title)
      select.style.width = "200px"
      for (const option of opts.options) {
        const el = document.createElement("option")
        el.value = option.value
        el.textContent = option.label
        el.selected = option.value === opts.value
        select.appendChild(el)
      }
      select.addEventListener("change", () => opts.onChange(select.value))
      return select
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
      draft.defaultCanvasDirectory = v.trim() || "/data/storage/petal/siyuan-diskcanvas"
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

  /* ── 网格线 ──
   *
   * 工具栏那个弹层与这里是**两条入口、同一份设置**：
   * 弹层给"顺手改一下"，面板给"找得到、看得全"。
   * 两边的合法值都来自 `canvas/grid.ts`（样式清单 / 间距预设 / 夹取范围），
   * 不各写一份 —— 否则面板里能选出工具栏画不出来的值。
   */
  selectItem(setting, {
    description: t("settingsGridStyleDescription") || "画布背景网格的类型（不显示 / 点阵 / 方格 / 横线 / 纵线）",
    onChange: async (v) => {
      draft.grid = { ...draft.grid, style: v as CanvasGridStyle }
      await saveDraft()
    },
    options: CANVAS_GRID_STYLES.map(style => ({
      label: t(GRID_STYLE_I18N_KEYS[style]),
      value: style,
    })),
    title: t("settingsGridStyleTitle") || "网格样式",
    value: draft.grid.style,
  })

  /**
   * 间距用"预设 + 当前值"合成选项表。
   *
   * ★ 为什么必须把当前值也并进去 ★
   *   设置文件是可手改的（petal 是明文 JSON），旧版本也可能留下非预设值
   *   （例如 20）。若选项里没有 20，浏览器会把 select 落到第一项
   *   （16）——用户只要打开设置面板看一眼，值就被**悄悄改掉**了。
   */
  const gridSizeOptions = Array.from(new Set([
    ...CANVAS_GRID_SIZE_PRESETS,
    clampCanvasGridSize(draft.grid.size),
  ])).sort((a, b) => a - b)
  selectItem(setting, {
    // 范围由常量拼进来：改 `grid.ts` 里的上下限，文案自动跟着变
    description: `${t("settingsGridSizeDescription")}（${CANVAS_GRID_SIZE_MIN}–${CANVAS_GRID_SIZE_MAX}px）`,
    onChange: async (v) => {
      draft.grid = { ...draft.grid, size: clampCanvasGridSize(Number(v)) }
      await saveDraft()
    },
    options: gridSizeOptions.map(size => ({ label: `${size}px`, value: String(size) })),
    title: t("settingsGridSizeTitle") || "网格间距",
    value: String(draft.grid.size),
  })
  switchItem(setting, {
    description: t("settingsGridSnapDescription") || "拖动卡片或新建卡片时，落点自动对齐到网格线",
    onChange: async (v) => {
      draft.grid = { ...draft.grid, snap: v }
      await saveDraft()
    },
    title: t("settingsGridSnapTitle") || "吸附到网格",
    value: draft.grid.snap,
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
