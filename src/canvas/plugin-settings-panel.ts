import type { Setting } from "siyuan"
import type { CanvasPluginSettings } from "@/canvas/plugin-data"
import type { CanvasI18nTranslator } from "@/canvas/use-canvas-editor-shared"

import { localFsUnavailableKind, localFsUnavailableMessage } from "@/canvas/localfs-client"
import { getLocalFsClient } from "@/canvas/localfs-client-provider"
import { CANVAS_COLOR_THEMES } from "@/canvas/canvas-color-themes"
import {
  CANVAS_GRID_SIZE_MAX,
  CANVAS_GRID_SIZE_MIN,
  CANVAS_GRID_SIZE_PRESETS,
  CANVAS_GRID_STYLES,
  clampCanvasGridSize,
  type CanvasGridStyle,
} from "@/canvas/grid"

/**
 * 插件设置面板（盘绘）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 与上游设置面板的区别 ★
 *   上游面板混装了 AI 搜索、演示模式、PNG 导出等业务配置。
 *   本插件**只保留画布本身 + 本机存储接入**所需的设置项，分三组：
 *     ① 本机存储（常用文件夹 —— 决定「本机文件」选择器能看到哪些目录）
 *     ② 画布基础（目录、最近文件、外部变更检测）
 *     ③ 显示（配色、缩略图、节点标题、对齐辅助线）
 *
 * ★ 为什么没有「服务地址」这一项 ★
 *   地址探测是「本机存储」插件的职责（它要跟着飞牛环境在同源通道与
 *   直连端口之间切换）。画布再存一份 = 用户要配两遍、且必然有对不上的那天。
 *   画布只关心"常去哪几个文件夹"，其余一律交给对方。
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
    .dcn-favorites {
      display: grid;
      gap: 8px;
      width: 260px;
      max-width: 100%;
    }
    .dcn-favorites__list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .dcn-favorites__empty {
      font-size: 12px;
      color: var(--b3-theme-on-surface);
      opacity: 0.7;
    }
    .dcn-favorites__chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
      border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.12));
      border-radius: 999px;
      padding: 2px 4px 2px 10px;
      font-size: 12px;
      background-color: var(--b3-theme-surface, transparent);
    }
    .dcn-favorites__chip > span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 180px;
    }
    .dcn-favorites__remove {
      flex: 0 0 auto;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--b3-theme-on-surface);
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
      padding: 2px 5px;
    }
    .dcn-favorites__remove:hover {
      background: var(--b3-theme-surface-lighter, rgba(120, 120, 128, 0.16));
    }
    .dcn-favorites__actions {
      display: flex;
      gap: 6px;
    }
    .dcn-favorites__actions input {
      flex: 1 1 auto;
      min-width: 0;
    }
    .dcn-favorites__error {
      display: flex;
      flex: 1 1 auto;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--b3-theme-error, #d23f31);
    }
    .dcn-favorites__reload {
      flex: 0 0 auto;
      font-size: 12px;
      line-height: 1.4;
      padding: 2px 8px;
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

/**
 * 「本机存储」用不了时，给一句**能照着做**的话。
 *
 * ★ 为什么不是一句"未检测到"了事 ★
 *   契约缺失有两种原因，用户的下一步动作**方向相反**：
 *     · 真没装 / 没启用  ⇒ 去插件市场装、去启用
 *     · 装了，但页面里跑的还是**旧版 JS**（那份没有对外契约）⇒ 刷新思源页面
 *   而内核会缓存插件 JS，**升版本号是唯一有效的破缓存手段** ——
 *   所以"刚更新过插件"的人最容易撞上第二种。只回"未检测到插件"
 *   会让这类用户去反复安装卸载，永远修不好。
 *
 * ★ 为什么按钮是手动的 ★
 *   自动刷新会打断用户正在编辑的画布。刷新确实能把新 JS 载进来，
 *   但这个决定应该由用户按下按钮来做。
 */
function showLocalFsUnavailable(status: HTMLElement, t: CanvasI18nTranslator): void {
  status.textContent = localFsUnavailableMessage(t, {
    absent: "settingsLocalFsPluginMissing",
    outdated: "settingsLocalFsPluginOutdated",
  })

  if (localFsUnavailableKind() !== "outdated") {
    return
  }

  const reload = document.createElement("button")
  reload.type = "button"
  reload.className = "b3-button b3-button--outline dcn-favorites__reload"
  reload.dataset.testid = "localfs-settings-reload"
  reload.textContent = t("settingsLocalFsReloadPage")
  reload.addEventListener("click", () => window.location.reload())
  status.appendChild(reload)
}

/**
 * 「常用文件夹」项。
 *
 * ★ 为什么不是一个输入框 ★
 *   本机存储上的路径形如 `/vol1/1000/文档/客户资料/2026`，
 *   让人手敲绝对路径既容易错、也没法确认"到底指到哪"。所以主入口是
 *   「添加文件夹」按钮 —— 它调用**本机存储插件自己的目录选择器**
 *   （支持跨层多选、从 `/` 起、卷根可上溯），选中的路径一次性带回。
 *   手填输入框保留为兜底（对方插件没装 / 想直接粘贴一个已知路径）。
 *
 * ★ 为什么用 get/set 回调而不是直接改 draft ★
 *   与面板里其它项一致：真实的持久化由 `saveDraft()` 统一负责，
 *   这里只描述"值变了"，不关心怎么存。
 */
function favoritesItem(
  setting: Setting,
  opts: {
    get: () => string[]
    onChange: (next: string[]) => void
    t: CanvasI18nTranslator
    title: string
    description?: string
  },
): void {
  setting.addItem({
    createActionElement: () => {
      const box = document.createElement("div")
      box.className = "dcn-favorites"

      const list = document.createElement("div")
      list.className = "dcn-favorites__list"

      const status = document.createElement("div")
      status.className = "dcn-favorites__error"

      const render = () => {
        const favorites = opts.get()
        list.innerHTML = ""
        if (!favorites.length) {
          const empty = document.createElement("div")
          empty.className = "dcn-favorites__empty"
          empty.textContent = opts.t("settingsLocalFsFavoritesEmpty")
          list.appendChild(empty)
          return
        }

        for (const path of favorites) {
          const chip = document.createElement("span")
          chip.className = "dcn-favorites__chip"
          chip.title = path

          const label = document.createElement("span")
          label.textContent = path
          chip.appendChild(label)

          const remove = document.createElement("button")
          remove.type = "button"
          remove.className = "dcn-favorites__remove"
          remove.textContent = "×"
          remove.title = opts.t("settingsLocalFsRemoveFolder")
          remove.addEventListener("click", () => {
            opts.onChange(opts.get().filter((item) => item !== path))
            render()
          })
          chip.appendChild(remove)

          list.appendChild(chip)
        }
      }
      render()

      const actions = document.createElement("div")
      actions.className = "dcn-favorites__actions"

      const pick = document.createElement("button")
      pick.type = "button"
      pick.className = "b3-button b3-button--outline"
      pick.textContent = opts.t("settingsLocalFsAddFolder")
      pick.addEventListener("click", () => {
        status.textContent = ""
        const client = getLocalFsClient()
        if (!client) {
          showLocalFsUnavailable(status, opts.t)
          return
        }
        // 选择器是异步的（要逐层列目录）；失败时**就地显示**而不是弹窗 ——
        // 设置面板本身可能就开着，再叠一个提示只会互相遮挡。
        Promise.resolve(client.pickDirectories()).then((picked) => {
          if (!picked.length) {
            return
          }
          const merged = [...opts.get()]
          for (const row of picked) {
            if (!merged.includes(row.path)) {
              merged.push(row.path)
            }
          }
          opts.onChange(merged)
          render()
        }).catch((error) => {
          status.textContent = opts.t("settingsLocalFsPickFailed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      })
      actions.appendChild(pick)

      const input = document.createElement("input")
      input.className = "b3-text-field"
      input.placeholder = opts.t("settingsLocalFsPathPlaceholder")
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return
        }
        event.preventDefault()
        const value = input.value.trim().replace(/\\/g, "/")
        if (!value) {
          return
        }
        if (!opts.get().includes(value)) {
          opts.onChange([...opts.get(), value])
        }
        input.value = ""
        status.textContent = ""
        render()
      })
      actions.appendChild(input)

      box.appendChild(list)
      box.appendChild(actions)
      box.appendChild(status)
      return box
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
  // 深拷贝子对象，避免直接改到原引用（数组尤其危险：push 会改到设置本体）
  draft.localFs = { favorites: [...getSettings().localFs.favorites] }

  injectSettingsPanelStyles()

  const setting = createSetting({ width: "620px" })

  const saveDraft = async () => {
    await saveSettings({ ...draft })
    onSettingsChanged?.()
  }
  // ─────────────────────────────────────────────
  // ① 本机存储（「本机文件」选择器能看到哪些目录）
  // ─────────────────────────────────────────────
  favoritesItem(setting, {
    description: t("settingsLocalFsFavoritesDescription"),
    get: () => draft.localFs.favorites,
    onChange: async (next) => {
      draft.localFs = { favorites: next }
      await saveDraft()
    },
    t,
    title: t("settingsLocalFsFavoritesTitle"),
  })

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
