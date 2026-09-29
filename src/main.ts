import type { Plugin } from "siyuan"
import type { App as VueApp } from "vue"
import { createApp } from "vue"

import App from "@/App.vue"

let pluginInstance: Plugin | null = null
const appMap = new WeakMap<HTMLElement, VueApp>()
const themeCleanupMap = new WeakMap<HTMLElement, () => void>()

type CanvasThemeMode = "dark" | "light"

export interface CanvasTabBootstrap {
  path?: string
  raw?: string
  title?: string
  /**
   * 嵌入模式（笔记正文里的自定义块）。
   *
   * ★ 与页签模式的区别只有两点 ★
   *   1. 强制只读：禁止编辑内容（增删节点/连线、拖拽、改文字），
   *      但**保留缩放与平移** —— 用户要求「可以放大缩小，移动画布，就是不能编辑具体内容」。
   *      具体哪些能力开、哪些关，由 `canvas-interaction-policy.ts` 的**能力矩阵**统一决定
   *      （嵌入预览：`zoom` / `pan` 恒为 true；`editDocument` / `select` / `marquee` /
   *       `createByDoubleClick` / `renderNodeHandles` / `openNodeTab` / `persist` 均为 false）。
   *      ★ 注意：平移统一走**右键**，左键在只读态没有语义（曾让左键当平移，已废弃）。
   *   2. **绝不落盘**：见 use-canvas-editor 里 save/silentSave 的 `capabilities.persist` 守卫。
   *      同一条 .canvas 可能同时被页签实例打开，嵌入实例若也写盘就会互相覆盖。
   */
  embed?: boolean
}

export function bindPlugin(plugin: Plugin): void {
  pluginInstance = plugin
}

function requirePlugin(): Plugin {
  if (!pluginInstance) {
    throw new Error("Plugin instance has not been bound.")
  }

  return pluginInstance
}

function normalizeThemeMode(value: unknown): CanvasThemeMode | null {
  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase()
    if (normalizedValue.includes("dark")) {
      return "dark"
    }

    if (normalizedValue.includes("light")) {
      return "light"
    }
  }

  if (typeof value === "number") {
    if (value === 1) {
      return "dark"
    }

    if (value === 0) {
      return "light"
    }
  }

  return null
}

function detectHostThemeMode(element: HTMLElement): CanvasThemeMode {
  const explicitThemeMode = normalizeThemeMode(element.parentElement?.closest<HTMLElement>("[data-theme-mode]")?.dataset.themeMode)
    ?? normalizeThemeMode(document.documentElement.dataset.themeMode)
    ?? normalizeThemeMode(document.body?.dataset.themeMode)
    ?? normalizeThemeMode((window as any).siyuan?.config?.appearance?.mode)

  if (explicitThemeMode) {
    return explicitThemeMode
  }

  const currentThemeMode = normalizeThemeMode(element.dataset.themeMode)
  if (currentThemeMode) {
    return currentThemeMode
  }

  if (document.documentElement.classList.contains("dark") || document.body?.classList.contains("dark")) {
    return "dark"
  }

  return "light"
}

function applyThemeMode(element: HTMLElement, mode: CanvasThemeMode): void {
  element.dataset.themeMode = mode

  const rootElement = element.firstElementChild
  if (rootElement instanceof HTMLElement) {
    rootElement.dataset.themeMode = mode
  }
}

function bindThemeSync(element: HTMLElement, plugin: Plugin): void {
  const syncThemeMode = () => {
    applyThemeMode(element, detectHostThemeMode(element))
  }

  let animationFrameId = 0
  const scheduleThemeSync = () => {
    if (typeof cancelAnimationFrame === "function" && animationFrameId) {
      cancelAnimationFrame(animationFrameId)
    }

    if (typeof requestAnimationFrame === "function") {
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = 0
        syncThemeMode()
      })
      return
    }

    syncThemeMode()
  }

  let hostThemeObserver: MutationObserver | null = null

  syncThemeMode()
  if (typeof MutationObserver !== "undefined") {
    hostThemeObserver = new MutationObserver(() => {
      scheduleThemeSync()
    })

    hostThemeObserver.observe(document.documentElement, {
      attributeFilter: ["class", "data-theme-mode"],
      attributes: true,
    })

    if (document.body) {
      hostThemeObserver.observe(document.body, {
        attributeFilter: ["class", "data-theme-mode"],
        attributes: true,
      })
    }
  }

  plugin.eventBus.on("switch-protyle-mode", scheduleThemeSync)
  themeCleanupMap.set(element, () => {
    hostThemeObserver?.disconnect()
    if (typeof cancelAnimationFrame === "function" && animationFrameId) {
      cancelAnimationFrame(animationFrameId)
    }
    plugin.eventBus.off("switch-protyle-mode", scheduleThemeSync)
  })
}

export function mountCanvasApp(
  element: HTMLElement,
  bootstrap: CanvasTabBootstrap,
  setTitle: (title: string) => void,
): void {
  const plugin = requirePlugin()
  const app = createApp(App, {
    bootstrap,
    plugin,
    setTitle,
  })
  app.mount(element)
  bindThemeSync(element, plugin)
  appMap.set(element, app)
}

export function unmountCanvasApp(element: HTMLElement): void {
  themeCleanupMap.get(element)?.()
  themeCleanupMap.delete(element)

  const app = appMap.get(element)
  if (!app) {
    return
  }

  app.unmount()
  appMap.delete(element)
  element.innerHTML = ""
}

/**
 * ★ 侧边栏面板（CanvasDock）已被移除 ★
 *
 *   上游的侧栏是「工作区文档树」，属于上游业务，本插件不沿用。
 *   本插件的资料入口是画布内的选择器（网盘文件 / 思源笔记），
 *   而不是一个独立的文档树侧栏。
 *
 *   若将来要加侧栏（例如网盘文件浏览器），
 *   在此处新增 mount 函数并在 index.ts 的 addDock 里接上即可。
 */
