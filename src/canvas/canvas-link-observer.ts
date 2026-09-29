import type { Plugin } from "siyuan"
import { showMessage } from "siyuan"
import { getFileText } from "@/api"
import { openCanvasEditorTab } from "@/canvas/plugin-tabs"

export interface CanvasLinkResolutionResult {
  isCanvasLink: boolean
  isExternal: boolean
  path: string
}

/**
 * 解析并标准化 .canvas 超链接目标路径
 */
export function resolveCanvasLinkTarget(href: string): CanvasLinkResolutionResult {
  if (!href || typeof href !== "string") {
    return { isCanvasLink: false, isExternal: false, path: "" }
  }

  let raw = href.trim()
  if (!raw) {
    return { isCanvasLink: false, isExternal: false, path: "" }
  }

  // 剥离 URL 中的 query 参数与 # hash 锚点
  let cleanUrl = raw.split("#")[0].split("?")[0]

  try {
    cleanUrl = decodeURIComponent(cleanUrl)
  } catch {
    // 若 decodeURIComponent 异常则保留原串
  }

  cleanUrl = cleanUrl.replace(/\\/g, "/")

  if (!/\.canvas$/i.test(cleanUrl)) {
    return { isCanvasLink: false, isExternal: false, path: "" }
  }

  const isFileUrl = /^file:\/\//i.test(cleanUrl)
  if (isFileUrl) {
    cleanUrl = cleanUrl.replace(/^file:\/\/\/?/i, "")
  }

  // 匹配思源工作区 data 目录路径（包含 /data/ 或 data/）
  const dataMatch = cleanUrl.match(/(?:^|\/)(data\/.+)$/i)
  if (dataMatch) {
    return {
      isCanvasLink: true,
      isExternal: false,
      path: `/${dataMatch[1].replace(/^\/+/, "")}`,
    }
  }

  // 匹配 assets/ 相对路径
  const assetsMatch = cleanUrl.match(/(?:^|\/)(assets\/.+)$/i)
  if (assetsMatch) {
    return {
      isCanvasLink: true,
      isExternal: false,
      path: `/data/${assetsMatch[1].replace(/^\/+/, "")}`,
    }
  }

  // 匹配 storage/ 相对路径
  const storageMatch = cleanUrl.match(/(?:^|\/)(storage\/.+)$/i)
  if (storageMatch) {
    return {
      isCanvasLink: true,
      isExternal: false,
      path: `/data/${storageMatch[1].replace(/^\/+/, "")}`,
    }
  }

  // 若为 file:// 协议或绝对路径但未落在工作区 data/ 目录下，标记为工作区外路径
  if (isFileUrl || /^[a-z]:\//i.test(cleanUrl) || cleanUrl.startsWith("/")) {
    return {
      isCanvasLink: true,
      isExternal: true,
      path: cleanUrl,
    }
  }

  // 相对路径兜底
  const normalizedPath = cleanUrl.startsWith("/") ? cleanUrl : `/${cleanUrl}`
  return {
    isCanvasLink: true,
    isExternal: false,
    path: normalizedPath.startsWith("/data/") ? normalizedPath : `/data${normalizedPath}`,
  }
}

function isElement(value: unknown): value is Element {
  return value instanceof Element
}

export function getEventElements(event: Event): Element[] {
  const path = typeof event.composedPath === "function" ? event.composedPath() : []
  const elements = path.filter(isElement)
  const target = event.target instanceof Element ? event.target : null
  if (target && !elements.includes(target)) {
    elements.unshift(target)
  }
  return elements
}

/**
 * 从点击触发的 DOM 元素链中提取超链接 href / data-href
 * 如果包含 iframe 元素或在 iframe 内部则直接忽略（遵循仅拦截标准 Protyle 编辑器要求的约定）
 */
export function findCanvasLinkHrefFromElements(elements: Element[]): string {
  const hasIframeInPath = elements.some((element) => {
    if (element.tagName === "IFRAME" || element.closest?.("iframe")) {
      return true
    }
    if (typeof document !== "undefined" && element.ownerDocument && element.ownerDocument !== document) {
      return true
    }
    return false
  })

  if (hasIframeInPath) {
    return ""
  }

  for (const element of elements) {
    if (element instanceof HTMLElement) {
      const dataHref = element.getAttribute("data-href")
      if (dataHref) return dataHref

      if (element.tagName === "A") {
        const href = element.getAttribute("href")
        if (href) return href
      }
    }
  }
  return ""
}

/**
 * 同步快速判断当前点击事件是否作用于一个 .canvas 超链接
 */
export function isCanvasLinkClick(event: Event): boolean {
  const elements = getEventElements(event)
  const href = findCanvasLinkHrefFromElements(elements)
  if (!href) return false
  const resolved = resolveCanvasLinkTarget(href)
  return resolved.isCanvasLink
}

/**
 * 拦截并处理文档内 .canvas 超链接点击事件
 */
export async function handleCanvasLinkClick(
  event: Event,
  plugin: Plugin & { t?: (key: string) => string },
  pluginName: string,
): Promise<boolean> {
  const elements = getEventElements(event)
  const href = findCanvasLinkHrefFromElements(elements)
  if (!href) return false

  const resolved = resolveCanvasLinkTarget(href)
  if (!resolved.isCanvasLink) return false

  // 拦截默认跳转与事件冒泡
  event.preventDefault()
  event.stopPropagation()

  const translate = (key: string) => (typeof plugin.t === "function" ? plugin.t(key) : key)

  if (resolved.isExternal) {
    showMessage(translate("cannotOpenExternalCanvasFile"), 4000, "error")
    return true
  }

  const raw = await getFileText(resolved.path)
  if (raw === null) {
    showMessage(translate("canvasFileNotFound"), 4000, "error")
    return true
  }

  void openCanvasEditorTab(plugin, pluginName, { path: resolved.path }, "Untitled.canvas")
  return true
}
