/**
 * 独立网页编辑器入口（`standalone.html` 的唯一脚本）。
 * ============================================================================
 *
 * 用途（用户要求）
 * ---------------------------------------------------------------------------
 *   「实现单独网页打开 / 编辑画布文件。按钮放在工具栏帮助按钮后面。
 *     纯打开这个画布文件进行编辑。
 *     渲染效果和在思源里是一样的，与思源里的渲染用同一套渲染逻辑。」
 *
 * ★★ 怎么保证"同一套渲染逻辑" ★★
 *
 *   本文件**不重新实现任何画布渲染**，只做两件事：
 *     ① 把一个"宿主"准备到与思源里等价的状态（样式 / 主题 / 设置 / 能力桥）
 *     ② 调用思源页签用的**同一个入口**：`bindPlugin(stub)` + `mountCanvasApp(...)`
 *
 *   `mountCanvasApp` → `App.vue` → `CanvasWorkspace.vue`
 *   —— 与页签、嵌入预览**完全同一个组件、同一份源码**。
 *   卡片、连线、调色板、缩放手势、右键平移、键盘快捷键天然一致；
 *   不存在"两套实现慢慢走偏"的问题。
 *
 * ---------------------------------------------------------------------------
 * 四个必须补齐的"宿主能力"，以及各自的补齐方式
 * ---------------------------------------------------------------------------
 *
 *  1. **样式 + 主题**（否则渲染出来颜色全丢）
 *     画布样式重度依赖思源主题变量（`--b3-theme-surface` / `--b3-border-color`
 *     / `--b3-theme-on-surface` …，全项目 180 处引用）。
 *     做法：读思源自己的首页 HTML，把它声明的样式表（base.css + theme.css）
 *     **原样搬过来**，并把 `<html data-theme-mode>` 设为当前主题。
 *     详见 `standalone-context.ts` 的 `extractStylesheetHrefs`。
 *
 *  2. **`siyuan` 模块**（源码里 15 处 `import … from "siyuan"`）
 *     由构建期 alias 换成 `siyuan-module-shim.ts`：能真做的真做
 *     （`fetchSyncPost` 打内核同源 API、`Dialog` 照抄思源类名结构、
 *      `openTab` 换算成 `/?id=<块ID>`），做不到的才安静降级。
 *
 *  3. **插件设置 / UI 状态**
 *     与思源读的是**同一份 petal 文件**（`diskcanvas-plugin-data`），
 *     所以配色主题、卡片抬头开关、检查器分栏等与思源里完全一致；
 *     在独立页里改动也会写回同一份文件（带"内容没变就不写"的去重，
 *     与 `index.ts` 的 `persistCanvasData` 同款，避免触发宿主重载抖动）。
 *
 *  4. **另一个插件的能力（网盘）** —— 通过 `window.opener` 桥接
 *     网盘插件的对外契约 `window.__nebuladiskPlugin` **只存在于思源页面里**。
 *     本页是由思源页面里的按钮 `window.open` 打开的，**同源**，因此
 *     `window.opener.__nebuladiskPlugin` 可直接取用：
 *       · `.external` → 挂到本页 window 上，画布走**契约路径**（含 URL 构造，
 *         满足约束 C-4：URL 一律由网盘侧构造，本侧只转发）
 *       · 插件实例本身 → 塞进桩的 `app.plugins`，双击网盘文件时
 *         `getNebulaPlugin().openFile()` 照常可用
 *     取不到时（例如用户把 URL 复制到一个全新页签）自动降级：
 *     网盘相关操作给出提示，其余功能一切正常。
 */

import PluginInfoString from "@/../plugin.json"
import type { Plugin } from "siyuan"
import { putFile } from "@/api"
import {
  createDefaultCanvasPluginData,
  normalizeCanvasPluginData,
  updateCanvasPluginUiState,
  type CanvasPluginData,
  type CanvasPluginUiState,
} from "@/canvas/plugin-data"
import {
  bindPlugin,
  mountCanvasApp,
  type CanvasTabBootstrap,
} from "@/main"
import {
  extractStylesheetHrefs,
  resolveI18nCatalog,
  resolveThemeModeLabel,
  resolveThemeStylesheetHref,
} from "@/standalone/standalone-context"
import { fetchSyncPost } from "@/standalone/siyuan-module-shim"
import { readStandalonePath } from "@/standalone/standalone-url"

import "@/standalone/standalone.scss"

const PLUGIN_NAME = (PluginInfoString as { name: string }).name
/** 与 `index.ts` 的 `STORAGE_KEY` 必须一致 —— 读的就是同一份 petal 数据。 */
const STORAGE_KEY = "diskcanvas-plugin-data"
const SETTINGS_PATH = `/data/storage/petal/${PLUGIN_NAME}/${STORAGE_KEY}`
/** 画布宿主元素的 id（见 `standalone.html`）。 */
const MOUNT_ID = "app"

/* ══════════════════════════════════════════════════════════════════════════
 * 第 0 步：首屏骨架（纯 DOM，先于任何 await 执行）
 * ══════════════════════════════════════════════════════════════════════════ */

const mountEl = document.getElementById(MOUNT_ID)

/**
 * 关键布局样式，**追加到 `<head>` 末尾**。
 *
 * 为什么不写在 `standalone.scss` 里：那份 CSS 在 head 中的位置早于运行时注入的
 * 思源样式表，`html` / `body` 这类**同权重**规则会被 base.css 覆盖。
 * 而这三条规则一旦失效，表现是"画布高度塌成 0"——很难定位，所以必须钉死。
 */
function injectCriticalLayout(): void {
  const style = document.createElement("style")
  style.id = "dc-standalone-layout"
  style.textContent = `
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
    /* 画布外壳是 height:100%，宿主必须给出确定高度 */
    #${MOUNT_ID} { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
    /* 画布组件自身 root 就是 .canvas-shell（grid，height:100%） */
    #${MOUNT_ID} > .canvas-shell { flex: 1 1 auto; min-height: 0; }
  `
  document.head.appendChild(style)
}

function renderLoading(): void {
  if (!mountEl) {
    return
  }
  mountEl.innerHTML = '<div class="dc-standalone__loading"><div class="dc-standalone__spinner"></div><div>正在打开画布…</div></div>'
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function renderFatal(message: string, detail = "", hint = ""): void {
  if (!mountEl) {
    return
  }
  mountEl.innerHTML = `
    <div class="dc-standalone__error">
      <div>${escapeHtml(message)}</div>
      ${detail ? `<div><code>${escapeHtml(detail)}</code></div>` : ""}
      ${hint ? `<div class="dc-standalone__hint">${escapeHtml(hint)}</div>` : ""}
    </div>
  `
}

/* ══════════════════════════════════════════════════════════════════════════
 * 第 1 步：样式与主题
 * ══════════════════════════════════════════════════════════════════════════ */

interface KernelConfShape {
  appearance?: {
    lang?: string
    mode?: number | string
    themeDark?: string
    themeLight?: string
    themeVer?: string
  }
}

/** 用内核 API 读一个工作区文件的**文本**（失败返回 null，不抛）。 */
async function readKernelFileText(path: string): Promise<string | null> {
  try {
    const response = await fetch("/api/file/getFile", {
      body: JSON.stringify({ path }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

async function readKernelConf(): Promise<KernelConfShape> {
  const response = await fetchSyncPost<{ conf?: KernelConfShape }>("/api/system/getConf", {})
  return response?.data?.conf ?? {}
}

/**
 * 从思源首页 HTML 里取**基座**样式表（`base.<哈希>.css` 等）。
 *
 * 注意这里拿不到 `theme.css` —— 那条 link 是思源前端运行时插进去的，
 * 初始 HTML 里没有。主题样式由 `resolveThemeStylesheetHref` 按内核配置单独补，
 * 两者**顺序不能反**：基座在前，主题在后（主题要覆盖基座）。
 */
async function fetchBaseStylesheets(): Promise<string[]> {
  try {
    const response = await fetch("/", { headers: { Accept: "text/html" } })
    if (!response.ok) {
      return []
    }
    return extractStylesheetHrefs(await response.text())
  } catch {
    return []
  }
}

/** 代码片段配置项（`/data/snippets/conf.json` 元素） */
interface KernelSnippet {
  content?: string
  enabled?: boolean
  id?: string
  name?: string
  type?: string
}

/**
 * ★ 取用户**已启用**的 CSS 代码片段 —— 这一步不能省 ★
 *
 * 实测：本机思源里有一个叫「字体」的 CSS 片段：
 *
 *     :root:root { --b3-font-family: "LXGW WenKai GB Screen"; … }
 *
 * 它把全局字体整个换掉了。独立页若不加载片段：
 *   · 正文用思源默认字体族 ⇒ **字体与思源里明显不同**
 *   · 更隐蔽的是 `--b3-font-family-code`（代码字体）也跟着变
 * 而且这是**用户自定义**，无法靠"抄思源源码里的默认值"补上，
 * 只能从同一份配置文件里读。
 *
 * 数据源与思源完全一致：`<工作区>/data/snippets/conf.json`
 * —— 一个数组，元素形如 `{id, name, type, enabled, disabledInPublish, content}`。
 * 只取 `type === "css"` 且 `enabled === true` 且 content 非空的。
 *
 * JS 片段**不加载**：它们面向思源 UI（dock、页签、protyle），
 * 在独立页里既无宿主也无意义，跑了只会报错。
 */
async function readEnabledCssSnippets(): Promise<KernelSnippet[]> {
  const raw = await readKernelFileText("/data/snippets/conf.json")
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (item: KernelSnippet) =>
        item
        && item.type === "css"
        && item.enabled === true
        && typeof item.content === "string"
        && item.content.trim().length > 0,
    )
  } catch {
    return []
  }
}

/**
 * 注入外链样式表并等待加载完成。
 *
 * ★ 插入位置：**本页自己的 `<link>` 之前** ★
 *   Vite 已把 `standalone.css` 放进 head。思源的样式表要排在它**前面**
 *   （思源里插件样式也是最后注入、压过 base/theme 的），
 *   所以用 `insertBefore(link, ownLink)` 而不是 `appendChild` ——
 *   既拿到正确顺序，又不用挪动自己那条已经加载好的 link（避免重新请求闪一下）。
 */
async function injectStylesheets(hrefs: string[]): Promise<number> {
  if (hrefs.length === 0) {
    return 0
  }

  const ownLink = document.querySelector<HTMLLinkElement>('head link[rel="stylesheet"][href*="standalone"]')
  const pending: Promise<void>[] = []

  for (const href of hrefs) {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = href
    pending.push(new Promise<void>((resolve) => {
      link.addEventListener("load", () => resolve(), { once: true })
      link.addEventListener("error", () => resolve(), { once: true })
      // 兜底：5s 内没结论也继续（本地文件，正常都是几十毫秒）
      window.setTimeout(resolve, 5000)
    }))
    if (ownLink) {
      document.head.insertBefore(link, ownLink)
    } else {
      document.head.appendChild(link)
    }
  }

  await Promise.all(pending)
  return hrefs.length
}

/**
 * 注入内联样式（代码片段）。
 *
 * ★ 追加到 head **末尾** ★
 *   思源里片段的注入时机就是最后的（`snippetCSS*` 排在所有样式之后），
 *   片段里大量使用 `!important` 与 `:root:root` 这类高权重写法，
 *   位置放错会改变覆盖结果。
 */
function injectStyleText(id: string, css: string): void {
  const style = document.createElement("style")
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 第 2 步：插件设置（与思源同一份 petal 数据）
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 读 petal 数据。
 *
 * 用 `/api/file/getFile` 的**原始文本**读取，而不是 `fetchSyncPost`：
 * `getFile` 成功时直接回**文件本体**（不是 `{code,data}` 信封），
 * 走信封会解析失败。这也是插件里 `getFileText` 的做法。
 */
async function readPluginData(): Promise<CanvasPluginData> {
  const raw = await readKernelFileText(SETTINGS_PATH)
  if (!raw) {
    return createDefaultCanvasPluginData()
  }

  try {
    return normalizeCanvasPluginData(JSON.parse(raw))
  } catch {
    return createDefaultCanvasPluginData()
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 第 3 步：网盘能力桥（`window.opener`）
 * ══════════════════════════════════════════════════════════════════════════ */

interface NebulaPluginLike {
  external?: unknown
  name?: string
  openFile?: (item: Record<string, unknown>, opts?: Record<string, unknown>) => unknown
}

interface OpenerBridge {
  /** 打开本页的那个思源窗口（拿不到时为 null） */
  opener: Window | null
  /** 诊断用：原始原因，便于真机排查（写进 `window.__dcStandalone`） */
  reason: string
  /**
   * ★ 每次调用都去 opener **重新取**当前的网盘插件实例 ★
   *
   * 为什么不在这里把对象存下来：网盘插件**每次重载都会换一个新对象**
   * （`window.__nebuladiskPlugin` 被重新赋值）。一旦缓存住旧对象，
   * 插件升级/重载之后本页就一直在调**旧代码** —— 实测踩过：
   * 网盘侧修好了 `webUrl`（原来漏 await 会返回字符串 "[object Promise]"），
   * 而独立页仍然拿到占位串，因为它在加载时就把旧契约钉住了。
   *
   * 取用成本是一次属性读取（同源直接访问），可以忽略；
   * 换来的是"插件重载后本页自动跟上"。
   */
  getPlugin: () => NebulaPluginLike | null
}

/**
 * 从打开本页的思源窗口取网盘插件实例。
 *
 * ★ 为什么这条路是**正确**的而不是"绕开契约" ★
 *   网盘对外契约的约束 C-4 要求「URL 一律由网盘侧构造，消费方只转发」。
 *   通过 `opener` 拿到的就是**网盘插件自己的契约对象**，
 *   画布依旧只做转发 —— 契约本身一行没改，C-4 得到满足。
 *
 * ★ 为什么可以跨窗口用 ★
 *   本页与思源页面**同源**（都由同一个内核在同一个 host:port 上提供），
 *   同源窗口之间可直接访问对方属性，不需要 postMessage 往返。
 *   契约里的方法不操作 DOM，跨 realm 调用没有副作用；
 *   `openFile()` 反而**正需要**在思源窗口里执行（它要开思源的页签）。
 */
function readOpenerBridge(): OpenerBridge {
  let opener: Window | null = null
  try {
    opener = window.opener
  } catch {
    return { getPlugin: () => null, opener: null, reason: "opener-inaccessible" }
  }

  if (!opener || opener.closed) {
    return { getPlugin: () => null, opener: null, reason: "no-opener" }
  }

  const getPlugin = (): NebulaPluginLike | null => {
    try {
      const candidate = (opener as unknown as Record<string, NebulaPluginLike | undefined>).__nebuladiskPlugin
      if (!candidate || typeof candidate !== "object") {
        return null
      }
      return candidate
    } catch {
      // 跨源 opener：浏览器会在读属性时抛 SecurityError
      return null
    }
  }

  return {
    getPlugin,
    opener,
    reason: getPlugin() ? "ok" : "nebula-plugin-absent",
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 第 4 步：plugin 桩
 * ══════════════════════════════════════════════════════════════════════════ */

interface StandalonePluginStub {
  [key: string]: unknown
}

function createEventBus() {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  return {
    on(name: string, handler: (event: unknown) => void) {
      const set = listeners.get(name) ?? new Set()
      set.add(handler)
      listeners.set(name, set)
    },
    off(name: string, handler: (event: unknown) => void) {
      listeners.get(name)?.delete(handler)
    },
    emit(name: string, event: unknown) {
      for (const handler of listeners.get(name) ?? []) {
        try {
          handler(event)
        } catch {
          /* 单个订阅者异常不影响其它订阅者 */
        }
      }
    },
  }
}

/**
 * 构造供画布使用的插件桩。
 *
 * 设计原则与 `siyuan-module-shim.ts` 一致：**能真做的真做**。
 *   · 读类（设置 / UI 状态）→ 真值，保证观感与思源一致
 *   · 写类（改设置）→ 真写回同一份 petal，带内容去重
 *   · 与宿主强绑定的动作（开页签 / 开设置面板 / 浮窗 / 最近文件）→ no-op
 */
function createStandalonePlugin(
  data: CanvasPluginData,
  bridge: OpenerBridge,
  i18n: Record<string, string>,
): StandalonePluginStub {
  const eventBus = createEventBus()
  const store: CanvasPluginData = data

  /**
   * ★ 内容去重（照抄 `index.ts` 的 `persistCanvasData`）★
   *
   * 任何一次 petal 写入都会让思源向**所有前端**广播 `reloadPlugin`，
   * 进而重载插件本体（SiYuan issue #19187）。若"没变化也写"，
   * 会退化成每秒一轮的重载抖动。所以只在序列化结果真的变化时才落盘。
   */
  let lastPersistedSnapshot: string | null = JSON.stringify(store)

  async function persistStore(): Promise<void> {
    let snapshot: string
    try {
      snapshot = JSON.stringify(store)
    } catch {
      snapshot = ""
    }

    if (snapshot && snapshot === lastPersistedSnapshot) {
      return
    }

    await putFile(SETTINGS_PATH, false, new Blob([snapshot], { type: "application/json" }))
    lastPersistedSnapshot = snapshot
  }

  return {
    name: PLUGIN_NAME,
    i18n,
    /**
     * 独立页按桌面端处理：手势与键盘快捷键走桌面那套，
     * 与"用浏览器打开思源桌面端"的体验一致。
     */
    isMobile: false,
    /**
     * `app` 只需要 `plugins` 一项 —— 画布用它找网盘插件实例
     * （见 `use-canvas-editor.ts` 的 `getNebulaPlugin`）。
     * 用 **getter** 而不是数组字面量：数组会钉住当时的那个插件实例，
     * 网盘插件重载后就找不到新的了（同一个陈旧引用问题）。
     */
    app: {
      get plugins() {
        const current = bridge.getPlugin()
        return current ? [current] : []
      },
    },
    eventBus,
    customBlockRenders: {},

    getCanvasSettings: () => ({ ...store.settings }),
    updateCanvasSettings: async (patch: Record<string, unknown>) => {
      // 与 `index.ts` 的 `updateCanvasSettings` 同款处理：合并后**归一化**再落盘，
      // 避免外部传入的脏值（未知主题名 / 错误类型）写进 petal。
      const next = normalizeCanvasPluginData({
        ...store,
        settings: { ...store.settings, ...(patch || {}) },
      })
      store.settings = next.settings
      eventBus.emit("diskcanvas-settings-changed", {})
      window.dispatchEvent(new CustomEvent("diskcanvas-settings-changed"))
      await persistStore()
    },
    getCanvasUiState: () => ({ inspectorSections: { ...store.ui.inspectorSections } }),
    updateCanvasUiState: async (patch: Record<string, unknown>) => {
      store.ui = updateCanvasPluginUiState(store, patch as Partial<CanvasPluginUiState>).ui
      await persistStore()
    },

    /**
     * 最近文件：独立页**不参与**。
     *
     * 理由不只是"没意义" —— `rememberRecentCanvas` 一被调用就会写盘，
     * 而写盘会触发宿主重载广播；打开页面即写盘曾经正是
     * 「编辑器每 5 秒闪一次」那条自激链的起点。所以这里保持 no-op。
     */
    getRecentCanvasFiles: () => [],
    rememberRecentCanvas: async () => undefined,
    removeRecentCanvasFile: async () => undefined,

    /** 与宿主强绑定的动作：安静降级为 no-op（画布只关心"调用不炸"）。 */
    openCanvasTab: async () => undefined,
    openCanvasSettings: () => undefined,
    addFloatLayer: () => undefined,
    addTab: () => undefined,
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 主流程
 * ══════════════════════════════════════════════════════════════════════════ */

async function main(): Promise<void> {
  if (!mountEl) {
    return
  }

  injectCriticalLayout()
  renderLoading()

  const path = readStandalonePath(location.search)
  if (!path) {
    renderFatal(
      "缺少 ?path= 参数，无法确定要打开哪个画布文件。",
      "",
      "本页由画布工具栏的「在独立网页中打开」按钮生成，正常不会出现这个提示。",
    )
    return
  }

  /**
   * 三个来源并发取，谁都不依赖谁：
   *   · 内核配置（主题明暗 + 界面语言 + 主题名）
   *   · 思源**基座**样式表（从首页 HTML 里扒）
   *   · 插件 petal 数据
   *
   * 主题样式表、代码片段要等第一批回来才能取，所以在后面串行补两小步
   * （都是本地请求，代价可忽略）。
   */
  const [conf, baseStylesheets, pluginData, snippets] = await Promise.all([
    readKernelConf(),
    fetchBaseStylesheets(),
    readPluginData(),
    readEnabledCssSnippets(),
  ])

  const themeMode = resolveThemeModeLabel(conf?.appearance?.mode)
  const i18n = resolveI18nCatalog(conf?.appearance?.lang)

  /**
   * ★ 基座在前、主题在后，顺序不能反 ★
   *   theme.css 是**覆盖层**（它重定义同名变量），排到基座前面就会被基座压回去，
   *   现象同样是"颜色不对"。
   */
  const themeHref = resolveThemeStylesheetHref(conf?.appearance)
  const stylesheets = await injectStylesheets([
    ...baseStylesheets,
    ...(themeHref ? [themeHref] : []),
  ])

  /* 代码片段放最后（思源里也是最后注入），覆盖顺序与宿主一致 */
  for (const snippet of snippets) {
    injectStyleText(`dc-standalone-snippet-${snippet.id || Math.random().toString(36).slice(2)}`, snippet.content as string)
  }

  /**
   * ★ 主题标记必须在挂载**之前**写好 ★
   *   画布用 `detectHostThemeMode()` 读 `document.documentElement.dataset.themeMode`
   *   来选深浅配色，`mountCanvasApp` 里会同步一次。写晚了会先按浅色画一帧。
   *   同时给 `<html lang>` 与 `color-scheme`，让原生控件（滚动条 / 输入框）也跟上。
   */
  document.documentElement.setAttribute("data-theme-mode", themeMode)
  document.documentElement.setAttribute("lang", conf?.appearance?.lang ? String(conf.appearance.lang).replace("_", "-") : "zh-CN")
  document.documentElement.style.colorScheme = themeMode
  document.body?.setAttribute("data-theme-mode", themeMode)

  // 读画布文件原始文本（同源内核 API）
  const raw = await readCanvasText(path)
  if (raw === null) {
    renderFatal("读取画布文件失败。", path, "请确认该文件仍存在，并且当前已登录思源（本页与思源共用同一会话）。")
    return
  }

  const bridge = readOpenerBridge()

  /**
   * ★ 把网盘契约挂到**本页** window 上 —— 用 **getter**，不拷对象 ★
   *
   *   画布的 `getNebulaExternalContract()` 只认 `window.__nebuladiskPlugin`，
   *   挂上之后它走的就是**和思源里完全相同的那条契约路径**，无需任何特判。
   *
   *   但必须是"实时转发"而不是"把对象存下来"：
   *   网盘插件每次重载都会替换 `opener.__nebuladiskPlugin`，
   *   存下来就会一直用旧对象（实测踩过：网盘侧修好 webUrl 后本页仍拿旧结果）。
   *
   *   只在真有 opener 时定义 —— 没有 opener 时不要伪造一个空对象，
   *   让 `getNebulaExternalContract()` 走它自己的"没有契约"分支（返回 null），
   *   上层据此给出"网盘插件未检测到"的提示。
   */
  if (bridge.opener) {
    Object.defineProperty(window, "__nebuladiskPlugin", {
      configurable: true,
      get: () => bridge.getPlugin() ?? undefined,
    })
  }

  const plugin = createStandalonePlugin(pluginData, bridge, i18n)
  bindPlugin(plugin as unknown as Plugin)

  /**
   * ★★ 让画布的「继承上下文」与思源里一致 ★★
   *
   * 思源的应用根节点是 `<body><div class="fn__flex-1 fn__flex">…`，
   * 而 base.css 里有一条：
   *
   *     body > .fn__flex-1 { font-size: 14px }
   *
   * 实测（NAS 真机）：思源里 `body` 是 16px，但画布拿到的继承字号是 **14px**，
   * 来源就是这条规则。独立页若不带这两个类，画布会继承 body 的 16px ——
   * **所有没有写死字号的文字都会偏大一档**（卡片正文、检查器条目…）。
   *
   * 处置：**再扮演一次思源的根节点**（补上这两个类），而不是把 `14px` 抄过来。
   *   抄数字会随思源改版漂移；借类名则自动跟随。
   *   本页布局由 `#app` 的 ID 规则（权重更高）接管，不受 `.fn__flex*` 影响。
   */
  mountEl.classList.add("fn__flex-1", "fn__flex")

  const bootstrap: CanvasTabBootstrap = {
    path,
    raw,
    /**
     * ★ 标记本实例是"独立页" ★
     *   唯一用途：隐藏工具栏上那个「在独立网页中打开」按钮
     *   （已经在本页了，再点只会又开一个）。
     *   **不参与任何能力/只读判定** —— 能力矩阵仍由
     *   `canvas-interaction-policy.ts` 单一决定，这里不新增只读来源。
     */
    standalone: true,
    title: path.split("/").pop() || path,
  }

  mountCanvasApp(mountEl, bootstrap, (title: string) => {
    document.title = title ? `${title} · DiskCanvas` : "DiskCanvas"
  })

  /**
   * 诊断出口（只读，不改变行为）。
   * 真机验证脚本靠它确认"样式注入了几条 / 主题对不对 / 网盘桥通没通"——
   * 没有它就只能靠肉眼看，那种结论不可靠。
   */
  ;(window as unknown as Record<string, unknown>).__dcStandalone = {
    nebulaBridged: Boolean(bridge.getPlugin()),
    nebulaBridgeReason: bridge.reason,
    path,
    pluginName: PLUGIN_NAME,
    snippetCount: snippets.length,
    stylesheetCount: stylesheets,
    themeHref,
    themeMode,
  }
}

/** 读画布文件文本；失败返回 null（不抛，交给调用方显示友好错误）。 */
async function readCanvasText(path: string): Promise<string | null> {
  try {
    const response = await fetch("/api/file/getFile", {
      body: JSON.stringify({ path }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

void main()
