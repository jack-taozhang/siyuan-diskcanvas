import type { Plugin } from "siyuan"
import { getAllEditor } from "siyuan"
import {
  getBlockAttrs,
  getFileText,
  sql,
} from "@/api"
import {
  CANVAS_EMBED_BOUND_ATTR,
  CANVAS_EMBED_CLASS,
  CANVAS_EMBED_REFRESH_EVENT,
  type CanvasEmbedRefreshEventDetail,
  refreshCanvasEmbedBlock,
} from "@/canvas/canvas-embed-insert"

export { CANVAS_EMBED_REFRESH_EVENT, type CanvasEmbedRefreshEventDetail }
import { generateCanvasEmbedDataUrl } from "@/canvas/canvas-embed-preview"
import { parseCanvasDocument } from "@/canvas/format"
import { openCanvasEditorTab } from "@/canvas/plugin-tabs"
import { handleCanvasLinkClick, isCanvasLinkClick } from "@/canvas/canvas-link-observer"

let observer: MutationObserver | null = null
let refreshListener: ((event: Event) => void) | null = null
let delegatedClickListener: ((event: MouseEvent) => void) | null = null
const iframeClickListeners = new WeakMap<Document, (event: MouseEvent) => void>()
const iframeLoadListeners = new WeakMap<HTMLIFrameElement, () => void>()
const CANVAS_EMBED_IFRAME_OVERLAY_ATTR = "data-canvas-embed-iframe-overlay"

/**
 * 新版「真实画布」嵌入块的外层类名。
 *
 * 与 `CANVAS_EMBED_CLASS`（`canvas-embed-preview`，静态快照时代）刻意区分：
 *   · `.dc-embed-host` —— SiYuan 渲染自定义块时加在块元素上（见 canvas-embed-block.ts）
 *   · `.dc-embed`      —— 块内部的容器
 * 这两个类名只要出现，就说明**画布本体已经挂上来了**，
 * 点击应当由块自己消化，全局委托不得再代为打开页签。
 */
const INTERACTIVE_EMBED_SELECTOR = ".dc-embed-host, .dc-embed"

/**
 * 判断这次点击是否落在「新版可交互嵌入块」内部。
 *
 * 用 `composedPath()` 而不是 `closest()`：事件可能穿过 shadow DOM，
 * closest 在跨 shadow 边界时会断掉，composedPath 才是完整链路。
 * 同时保留 `target.closest` 兜底（测试环境里 composedPath 可能为空数组）。
 */
function isInsideEmbedCanvasHost(event: Event): boolean {
  const path = typeof event.composedPath === "function" ? event.composedPath() : []
  for (const node of path) {
    if (node instanceof Element && node.matches(INTERACTIVE_EMBED_SELECTOR)) {
      return true
    }
  }

  const target = event.target
  if (target instanceof Element && target.closest(INTERACTIVE_EMBED_SELECTOR)) {
    return true
  }

  return false
}

let debugEnabled = false

export function setCanvasEmbedDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled
}

function debugCanvasEmbed(message: string, data?: Record<string, unknown>) {
  if (!debugEnabled) return
  console.debug(`[diskcanvas] ${message}`, data || {})
}

function bindCanvasEmbedClick(element: HTMLElement, plugin: Plugin, pluginName: string) {
  if (element.getAttribute(CANVAS_EMBED_BOUND_ATTR) === "true") return

  const canvasPath = normalizeCanvasPath(element.dataset.canvasPath || "")
  if (!canvasPath) return

  element.setAttribute(CANVAS_EMBED_BOUND_ATTR, "true")
  element.style.cursor = "pointer"

  const openHandler = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    void openCanvasEditorTab(plugin, pluginName, { path: canvasPath }, "Untitled.canvas")
  }
  element.addEventListener("click", openHandler)
  element.addEventListener("touchend", openHandler)
}

function scanAndBind(root: Element, plugin: Plugin, pluginName: string) {
  const elements = root.querySelectorAll<HTMLElement>(`.${CANVAS_EMBED_CLASS}`)
  for (const el of elements) {
    bindCanvasEmbedClick(el, plugin, pluginName)
  }
}

function findCanvasEmbedBlockId(element: HTMLElement): string {
  return element.closest<HTMLElement>("[data-node-id]")?.getAttribute("data-node-id") || ""
}

function isElement(value: unknown): value is Element {
  return value instanceof Element
}

export function normalizeCanvasPath(path: string): string {
  if (!path) return ""
  return path.replace(/^\/\/data\//, "/data/")
}

async function getCanvasPathFromBlockAttrs(blockId: string): Promise<string> {
  if (!blockId) return ""

  try {
    const attrs = await getBlockAttrs(blockId)
    const canvasPath = normalizeCanvasPath(attrs?.["custom-canvas-path"] || "")
    if (!canvasPath) {
      debugCanvasEmbed("open canvas embed: missing custom canvas path", {
        attrs,
        blockId,
      })
    }
    return canvasPath
  } catch {
    debugCanvasEmbed("open canvas embed: failed to read block attrs", { blockId })
    return ""
  }
}

function findClickedImageBlockId(target: EventTarget | null): string {
  const element = target && "closest" in target ? target as Element : null
  const image = element?.closest("img")
  if (!image) return ""
  return image.closest<HTMLElement>("[data-node-id]")?.getAttribute("data-node-id") || ""
}

function getEventElements(event: Event): Element[] {
  const path = typeof event.composedPath === "function" ? event.composedPath() : []
  const elements = path.filter(isElement)
  const target = event.target instanceof Element ? event.target : null
  if (target && !elements.includes(target)) {
    elements.unshift(target)
  }
  return elements
}

function findCanvasEmbedPathFromElements(elements: Element[]): string {
  for (const element of elements) {
    if (element instanceof HTMLElement) {
      const directPath = normalizeCanvasPath(element.dataset.canvasPath || "")
      if (directPath) return directPath
    }

    const embed = element.closest?.<HTMLElement>(`.${CANVAS_EMBED_CLASS}[data-canvas-path]`)
    const embedPath = normalizeCanvasPath(embed?.dataset.canvasPath || "")
    if (embedPath) return embedPath
  }
  return ""
}

function findBlockIdFromElements(elements: Element[]): string {
  for (const element of elements) {
    const blockId = element.closest?.<HTMLElement>("[data-node-id]")?.getAttribute("data-node-id") || ""
    if (blockId) return blockId
  }
  return ""
}

function summarizeElements(elements: Element[]): string[] {
  return elements.slice(0, 8).map((element) => {
    const id = element.id ? `#${element.id}` : ""
    const classes = element.className && typeof element.className === "string"
      ? `.${element.className.split(/\s+/).filter(Boolean).slice(0, 3).join(".")}`
      : ""
    const nodeId = element instanceof HTMLElement && element.dataset.nodeId ? `[data-node-id=${element.dataset.nodeId}]` : ""
    const canvasPath = element instanceof HTMLElement && element.dataset.canvasPath ? "[data-canvas-path]" : ""
    return `${element.tagName.toLowerCase()}${id}${classes}${nodeId}${canvasPath}`
  })
}

function findCanvasEmbedPathInDocument(doc: Document): string {
  const embed = doc.querySelector<HTMLElement>(`.${CANVAS_EMBED_CLASS}[data-canvas-path]`)
  return normalizeCanvasPath(embed?.dataset.canvasPath || "")
}

async function openCanvasFromBlockId(event: Event, blockId: string, plugin: Plugin, pluginName: string) {
  if (!blockId) {
    debugCanvasEmbed("open canvas embed: missing block id")
    return
  }

  const canvasPath = await getCanvasPathFromBlockAttrs(blockId)
  if (!canvasPath) return

  debugCanvasEmbed("open canvas embed", {
    blockId,
    path: canvasPath,
  })
  event.preventDefault()
  event.stopPropagation()
  void openCanvasEditorTab(plugin, pluginName, { path: canvasPath }, "Untitled.canvas")
}

async function openCanvasFromBlockIdOrPath(
  event: Event,
  blockId: string,
  fallbackCanvasPath: string,
  plugin: Plugin,
  pluginName: string,
) {
  const canvasPathFromBlock = blockId ? await getCanvasPathFromBlockAttrs(blockId) : ""
  const canvasPath = canvasPathFromBlock || normalizeCanvasPath(fallbackCanvasPath)
  if (!canvasPath) {
    debugCanvasEmbed("open canvas embed: missing canvas path", {
      blockId,
      hasFallbackPath: Boolean(fallbackCanvasPath),
    })
    return
  }

  event.preventDefault()
  event.stopPropagation()
  debugCanvasEmbed("open canvas embed", {
    blockId,
    path: canvasPath,
    source: canvasPathFromBlock ? "block-attrs" : "fallback-path",
  })
  void openCanvasEditorTab(plugin, pluginName, { path: canvasPath }, "Untitled.canvas")
}

function openCanvasFromPath(event: Event, canvasPath: string, plugin: Plugin, pluginName: string) {
  const normalizedPath = normalizeCanvasPath(canvasPath)
  if (!normalizedPath) return

  event.preventDefault()
  event.stopPropagation()
  debugCanvasEmbed("open canvas embed from path", { path: normalizedPath })
  void openCanvasEditorTab(plugin, pluginName, { path: normalizedPath }, "Untitled.canvas")
}

async function openCanvasFromClickedImage(event: Event, plugin: Plugin, pluginName: string) {
  const elements = getEventElements(event)
  const canvasPath = findCanvasEmbedPathFromElements(elements)
  const isEmbedCandidate = elements.some(
    (el) =>
      el.classList?.contains(CANVAS_EMBED_CLASS) ||
      el.hasAttribute?.("data-canvas-path") ||
      el.textContent?.includes("canvas-embed"),
  )

  if (!canvasPath && !isEmbedCandidate) {
    return
  }

  const blockId = findBlockIdFromElements(elements)
  if (blockId || canvasPath) {
    debugCanvasEmbed("document canvas embed click candidate", {
      blockId,
      hasCanvasPath: Boolean(canvasPath),
      path: summarizeElements(elements),
    })
  }

  if (blockId) {
    await openCanvasFromBlockIdOrPath(event, blockId, canvasPath, plugin, pluginName)
    return
  }

  if (canvasPath) {
    openCanvasFromPath(event, canvasPath, plugin, pluginName)
  }
}

async function ensureIframeClickOverlay(
  iframe: HTMLIFrameElement,
  blockId: string,
  plugin: Plugin,
  pluginName: string,
  fallbackCanvasPath = "",
) {
  const block = iframe.closest<HTMLElement>("[data-node-id]")
  const host = iframe.parentElement || block
  if (!host || host.querySelector(`[${CANVAS_EMBED_IFRAME_OVERLAY_ATTR}="true"]`)) {
    return
  }

  const canvasPath = normalizeCanvasPath(fallbackCanvasPath) || await getCanvasPathFromBlockAttrs(blockId)
  if (!canvasPath) return

  if (!host.style.position) {
    host.style.position = "relative"
  }

  const overlay = document.createElement("div")
  overlay.setAttribute(CANVAS_EMBED_IFRAME_OVERLAY_ATTR, "true")
  overlay.title = "Open Canvas"
  overlay.style.position = "absolute"
  overlay.style.inset = "0"
  overlay.style.zIndex = "2"
  overlay.style.cursor = "pointer"
  const overlayHandler = (event: Event) => {
    debugCanvasEmbed("iframe canvas embed overlay clicked", {
      blockId,
      path: canvasPath,
    })
    openCanvasFromPath(event, canvasPath, plugin, pluginName)
  }
  overlay.addEventListener("click", overlayHandler, true)
  overlay.addEventListener("touchend", overlayHandler, true)
  host.appendChild(overlay)
  debugCanvasEmbed("created iframe canvas embed overlay", {
    blockId,
    path: canvasPath,
  })
}

function bindHtmlBlockIframeClicks(root: Element | Document, plugin: Plugin, pluginName: string) {
  const iframes = root.querySelectorAll<HTMLIFrameElement>("iframe")
  for (const iframe of iframes) {
    const blockId = iframe.closest<HTMLElement>("[data-node-id]")?.getAttribute("data-node-id") || ""
    void ensureIframeClickOverlay(iframe, blockId, plugin, pluginName)

    const bindCurrentDocument = () => {
      const iframeDocument = iframe.contentDocument
      if (!iframeDocument || iframeClickListeners.has(iframeDocument)) {
        return
      }

      const documentCanvasPath = findCanvasEmbedPathInDocument(iframeDocument)
      if (documentCanvasPath) {
        void ensureIframeClickOverlay(iframe, blockId, plugin, pluginName, documentCanvasPath)
      }

      const listener = (event: Event) => {
        const elements = getEventElements(event)
        const target = elements[0]
        const canvasPath = findCanvasEmbedPathFromElements(elements) || documentCanvasPath
        debugCanvasEmbed("iframe document clicked", {
          blockId,
          hasCanvasPath: Boolean(canvasPath),
          tagName: target?.tagName || "",
        })
        if (!canvasPath && !blockId) return

        if (blockId) {
          void openCanvasFromBlockIdOrPath(event, blockId, canvasPath, plugin, pluginName)
          return
        }

        if (canvasPath) {
          openCanvasFromPath(event, canvasPath, plugin, pluginName)
          return
        }

        debugCanvasEmbed("iframe document clicked without path", { blockId })
      }
      iframeClickListeners.set(iframeDocument, listener as (e: MouseEvent) => void)
      iframeDocument.addEventListener("click", listener, true)
      iframeDocument.addEventListener("touchend", listener, true)
      debugCanvasEmbed("bound iframe canvas embed clicks", { blockId })
    }

    bindCurrentDocument()

    if (!iframeLoadListeners.has(iframe)) {
      const loadListener = () => {
        void ensureIframeClickOverlay(iframe, blockId, plugin, pluginName)
        bindCurrentDocument()
        window.setTimeout(bindCurrentDocument, 0)
      }
      iframeLoadListeners.set(iframe, loadListener)
      iframe.addEventListener("load", loadListener)
    }

    window.setTimeout(bindCurrentDocument, 0)
    window.setTimeout(bindCurrentDocument, 300)
    window.setTimeout(() => {
      void ensureIframeClickOverlay(iframe, blockId, plugin, pluginName)
    }, 300)
  }
}

interface CanvasEmbedBlockRef {
  blockId: string
  rootId: string
}

interface VisibleCanvasEmbedRef {
  blockId: string
  element: HTMLElement
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

async function findCanvasEmbedBlockRefsByPath(path: string): Promise<CanvasEmbedBlockRef[]> {
  let rows: Array<{ block_id?: string, root_id?: string }> | null = null
  try {
    rows = await sql(
      `SELECT block_id, root_id FROM attributes WHERE name = 'custom-canvas-path' AND value = '${escapeSqlString(path)}' LIMIT 100`,
    ) as Array<{ block_id?: string, root_id?: string }> | null
  } catch {
    rows = null
  }

  return (rows || [])
    .map((row) => ({
      blockId: row.block_id || "",
      rootId: row.root_id || "",
    }))
    .filter((row) => Boolean(row.blockId))
}

function collectVisibleCanvasEmbedsByPath(path: string): VisibleCanvasEmbedRef[] {
  const normalizedPath = normalizeCanvasPath(path)
  const topLevelEmbeds = [...document.querySelectorAll<HTMLElement>(`.${CANVAS_EMBED_CLASS}`)]
    .filter((element) => normalizeCanvasPath(element.dataset.canvasPath || "") === normalizedPath)
    .map((element) => ({
      blockId: findCanvasEmbedBlockId(element),
      element,
    }))

  const iframeEmbeds = [...document.querySelectorAll<HTMLIFrameElement>("iframe")]
    .flatMap((iframe) => {
      const iframeDocument = iframe.contentDocument
      if (!iframeDocument) return []

      const blockId = iframe.closest<HTMLElement>("[data-node-id]")?.getAttribute("data-node-id") || ""
      return [...iframeDocument.querySelectorAll<HTMLElement>(`.${CANVAS_EMBED_CLASS}`)]
        .filter((element) => normalizeCanvasPath(element.dataset.canvasPath || "") === normalizedPath)
        .map((element) => ({
          blockId,
          element,
        }))
    })

  return [...topLevelEmbeds, ...iframeEmbeds]
}

/**
 * 该块是否为「新版可交互嵌入块」。
 *
 * ★ 为什么刷新流程必须跳过它们 ★
 *   旧刷新流程（refreshCanvasEmbedBlock）会
 *   `updateBlock("markdown", <图片 markdown>)` —— 把块**整体重写成**一张静态 SVG 图片。
 *   新版块是 `;;;` 自定义块，与画布本体双向绑定、有自己的「刷新」按钮，
 *   被旧流程重写一次就会**退化成图片块**（画布交互全丢）。
 *
 *   两个流程的定位方式不同：
 *     · 旧流程按 `custom-canvas-path` 属性用 SQL 找块（新旧块都带这个属性，会误命中）
 *     · 新版真实画布的块元素带 `.dc-embed-host`
 *   ⇒ 用 `.dc-embed-host` 作为"新版"的判据，把这类块从旧刷新里排除。
 */
function isInteractiveCanvasEmbedBlock(element: Element): boolean {
  return Boolean(
    element.closest(".dc-embed-host")
    || element.querySelector(".dc-embed-host")
    || element.classList.contains("dc-embed-host"),
  )
}

function getCanvasEmbedTitle(element: HTMLElement): string {
  return element.querySelector<HTMLElement>(".canvas-embed-title")?.textContent?.trim() || ""
}

function reloadOpenEditors(rootIds: Set<string>) {
  if (rootIds.size === 0) return

  for (const editor of getAllEditor?.() || []) {
    const rootId = editor?.protyle?.block?.rootID || editor?.protyle?.block?.id || ""
    if (!rootIds.has(rootId)) continue

    editor.reload?.()
  }
}

async function refreshCanvasEmbedsForPath(path: string) {
  const normalizedPath = normalizeCanvasPath(path)
  if (!normalizedPath) return

  const visibleEmbeds = collectVisibleCanvasEmbedsByPath(normalizedPath)
  const domBlockIds = visibleEmbeds
    .map((ref) => ref.blockId)
    .filter(Boolean)
  const attributeBlockRefs = await findCanvasEmbedBlockRefsByPath(normalizedPath)
  const attributeBlockIds = attributeBlockRefs.map((ref) => ref.blockId)
  const blockIds = new Set([...domBlockIds, ...attributeBlockIds])
  const visibleEmbedByBlockId = new Map(
    visibleEmbeds
      .filter((ref) => ref.blockId)
      .map((ref) => [ref.blockId, ref.element]),
  )

  /**
   * ★ 排除「新版可交互嵌入块」★
   *
   * 这些块由真实画布渲染、带自己的「刷新」按钮；
   * 旧刷新流程会把块重写成静态 SVG 图片（`updateBlock("markdown", …)`），
   * 一旦命中就**把画布交互整块抹掉**。
   *
   * DOM 里看得见的块，用 `.dc-embed-host` 直接判定；
   * 屏幕上当前不可见的块（attributeBlockIds 里那些），
   * 无法从 DOM 判断，退一步用文档里的块元素探测一次。
   */
  const domBlockIdsToSkip = new Set<string>()
  for (const [blockId, element] of visibleEmbedByBlockId) {
    if (isInteractiveCanvasEmbedBlock(element)) {
      domBlockIdsToSkip.add(blockId)
    }
  }
  for (const blockId of attributeBlockIds) {
    if (domBlockIdsToSkip.has(blockId)) {
      continue
    }
    const blockElement = document.querySelector<HTMLElement>(`[data-node-id="${blockId}"]`)
    if (blockElement && isInteractiveCanvasEmbedBlock(blockElement)) {
      domBlockIdsToSkip.add(blockId)
    }
  }
  for (const blockId of domBlockIdsToSkip) {
    blockIds.delete(blockId)
    visibleEmbedByBlockId.delete(blockId)
  }

  debugCanvasEmbed("refresh canvas embeds", {
    attributeBlockIds,
    blockIds: [...blockIds],
    domBlockIds,
    path: normalizedPath,
    skippedInteractiveBlockIds: [...domBlockIdsToSkip],
  })

  if (blockIds.size === 0) return

  const raw = await getFileText(normalizedPath)
  if (!raw) {
    debugCanvasEmbed("refresh canvas embeds: unable to read canvas", { path: normalizedPath })
    return
  }

  const result = parseCanvasDocument(raw)
  if (!result.document || result.errors.length > 0) {
    debugCanvasEmbed("refresh canvas embeds: invalid canvas", {
      errors: result.errors,
      path: normalizedPath,
    })
    return
  }

  const dataUrl = generateCanvasEmbedDataUrl(result.document)
  if (!dataUrl) {
    debugCanvasEmbed("refresh canvas embeds: empty preview", { path: normalizedPath })
    return
  }

  for (const blockId of blockIds) {
    const visibleEmbed = visibleEmbedByBlockId.get(blockId)
    await refreshCanvasEmbedBlock(
      blockId,
      normalizedPath,
      raw,
      visibleEmbed ? getCanvasEmbedTitle(visibleEmbed) : undefined,
    )
  }

  const rootIdsToReload = new Set(
    attributeBlockRefs
      .filter((ref) => ref.rootId && !domBlockIds.includes(ref.blockId) && !domBlockIdsToSkip.has(ref.blockId))
      .map((ref) => ref.rootId),
  )
  reloadOpenEditors(rootIdsToReload)

  for (const {
    blockId,
    element,
  } of visibleEmbeds) {
    // 新版可交互块（真实画布）不走静态图替换，跳过
    if (domBlockIdsToSkip.has(blockId)) {
      continue
    }

    const image = element.querySelector<HTMLImageElement>("img")
    if (!image) {
      continue
    }

    image.src = dataUrl
    debugCanvasEmbed("refresh visible canvas embed image", {
      blockId,
      path: normalizedPath,
    })
  }
}

export function startCanvasEmbedObserver(plugin: Plugin, pluginName: string, options?: { debugLogEnabled?: boolean }): void {
  if (observer) return

  debugEnabled = options?.debugLogEnabled ?? false

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          if (node.classList.contains(CANVAS_EMBED_CLASS)) {
            bindCanvasEmbedClick(node, plugin, pluginName)
          }
          scanAndBind(node, plugin, pluginName)
          bindHtmlBlockIframeClicks(node, plugin, pluginName)
        }
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  refreshListener = (event: Event) => {
    const detail = (event as CustomEvent<CanvasEmbedRefreshEventDetail>).detail
    void refreshCanvasEmbedsForPath(detail?.path || "")
  }
  window.addEventListener(CANVAS_EMBED_REFRESH_EVENT, refreshListener)
  delegatedClickListener = (event: Event) => {
    /**
     * ★★ 「点一下就打开页签」的元凶就在这一段，务必先看这里 ★★
     *
     * 用户反馈（两轮）：
     *   · 「刷新 按钮 也会打开编辑页签」
     *   · 「目前在画布区域，会打开跳转到页签 … 感觉是放开左键的时候」
     *
     * 排查结论：不是画布的交互代码，是**下面这个 document 捕获阶段监听器**。
     *
     * 它的来历：早期嵌入块预览是**一张静态 SVG 图片**，需要「点图 → 打开画布页签」，
     * 所以这里挂了一个全局委托：
     *   任意 click → 沿 composedPath 找最近的 [data-node-id] → 读它的
     *   `custom-canvas-path` 属性 → 有值就 openCanvasEditorTab()。
     *
     * 为什么现在会误伤：
     *   1. 新版嵌入块是**真实可交互画布**（.dc-embed-host），
     *      而插入时仍然写了 `custom-canvas-path`（insertCanvasEmbed → setBlockAttrs），
     *      于是**块内任意一次点击**（拖画布、点节点、点刷新按钮）都会被它命中。
     *   2. 它是**捕获阶段**（第 3 个参数 true）挂在 document 上的：
     *      事件传播是 document(捕获) → … → 按钮(冒泡)，
     *      **先于**按钮自己的处理器执行 ⇒ 刷新按钮里写的
     *      `event.stopPropagation()` **拦不住它**（stopPropagation 只能阻止继续传播，
     *      不能撤销已经在更外层执行过的监听器）。
     *      这就是"刷新按钮也会打开页签"的确切成因。
     *
     * 处置：**嵌入块自己的地盘一律不接管**。
     *   新版块（.dc-embed-host / .dc-embed）内部的所有点击 —— 无论是真实画布、
     *   刷新按钮还是「在页签中打开」按钮 —— 都由块自己的 DOM 处理，
     *   全局委托直接返回，绝不代为打开页签。
     *   这与用户的要求完全一致：「画布区域任何操作都不能打开跳转到页签」，
     *   要打开就走块头部那个**显式**按钮。
     *
     * 静态降级快照（.canvas-embed-preview，由 mountReadonlyCanvas 的 fallback 产出）
     * 仍然保留旧的"点图打开"行为 —— 那种情况画布没跑起来，点击是唯一出路。
     */
    if (isInsideEmbedCanvasHost(event)) {
      return
    }

    if (isCanvasLinkClick(event)) {
      void handleCanvasLinkClick(event, plugin, pluginName)
      return
    }
    void openCanvasFromClickedImage(event, plugin, pluginName)
  }
  document.addEventListener("click", delegatedClickListener, true)
  document.addEventListener("touchend", delegatedClickListener, true)

  scanAndBind(document.body, plugin, pluginName)
  bindHtmlBlockIframeClicks(document, plugin, pluginName)
}

export function stopCanvasEmbedObserver() {
  observer?.disconnect()
  observer = null
  if (refreshListener) {
    window.removeEventListener(CANVAS_EMBED_REFRESH_EVENT, refreshListener)
    refreshListener = null
  }
  if (delegatedClickListener) {
    document.removeEventListener("click", delegatedClickListener, true)
    document.removeEventListener("touchend", delegatedClickListener, true)
    delegatedClickListener = null
  }
  document.querySelectorAll(`[${CANVAS_EMBED_IFRAME_OVERLAY_ATTR}="true"]`).forEach((element) => {
    element.remove()
  })
}
