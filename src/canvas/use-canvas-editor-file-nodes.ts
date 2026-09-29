import type { Ref } from "vue"
import type { CanvasEditorState } from "@/canvas/editor-state"
import type { ResolvedCanvasFileTarget } from "@/canvas/file-target-resolution"
import type { CanvasFileTargetPreview } from "@/canvas/file-target-preview"
import type { CanvasNode } from "@/canvas/types"
import type { CanvasI18nTranslator } from "@/canvas/use-canvas-editor-shared"

import { escapeHtml } from "@/canvas/markdown-sanitize"

import {
  findSiyuanAssetByPath,
  findSiyuanBlockById,
  findSiyuanDocumentByBlockId,
  findSiyuanDocumentByPath,
  findSiyuanImageAssetByBlockId,
  getSiyuanBlockDOM,
  getSiyuanHeadingBlockDOM,
} from "@/canvas/siyuan-kernel-file-node-lookups"
import {
  createCanvasFileTargetPreview,
  loadCanvasTargetPreview,
} from "@/canvas/file-target-preview"
import { getNebulaClient } from "@/canvas/nebula-client-provider"
import { formatSize, pickViewer } from "@/resources/nebula-client"
import {
  resolveCanvasFileTarget,
  type ResolvedCanvasBlockTarget,
  type ResolvedCanvasDocumentTarget,
} from "@/canvas/file-target-resolution"

interface CanvasEditorFileNodeOptions {
  fileNodeMeta: Ref<Record<string, ResolvedCanvasFileTarget & {
    detail: string
    excerptHtml?: string
    imageSrc?: string
    thumbnail?: CanvasFileTargetPreview["thumbnail"]
  }>>
  state: CanvasEditorState
  t: CanvasI18nTranslator
}

export function createCanvasEditorFileNodeHelpers(options: CanvasEditorFileNodeOptions) {
  const {
    fileNodeMeta,
    state,
    t,
  } = options

  let fileNodeResolveVersion = 0

  const resolveLookups = {
    resolveBlockById: async (blockId: string) => {
      const block = await findSiyuanBlockById(blockId)
      return block
        ? {
            ...block,
            kind: 'block' as const,
          }
        : null
    },
    resolveCanvasByPath: async (path: string) => (
      path.trim().endsWith('.canvas')
        ? {
            kind: 'canvas' as const,
            path,
            title: path.replace(/\\/g, '/').split('/').at(-1) || path,
          }
        : null
    ),
    resolveDocumentByBlockId: async (blockId: string) => {
      const document = await findSiyuanDocumentByBlockId(blockId)
      return document
        ? {
            ...document,
            kind: 'document' as const,
          }
        : null
    },
    resolveDocumentByPath: async (path: string) => {
      const document = await findSiyuanDocumentByPath(path)
      return document
        ? {
            ...document,
            kind: 'document' as const,
          }
        : null
    },
    resolveImageByBlockId: async (blockId: string) => {
      const image = await findSiyuanImageAssetByBlockId(blockId)
      return image
        ? {
            blockId: image.blockId || blockId,
            kind: 'image' as const,
            openPath: image.openPath,
            path: image.path,
            title: image.title || image.name,
          }
        : null
    },
    resolveImageByPath: async (path: string) => {
      const image = await findSiyuanAssetByPath(path)
      if (!image) {
        return null
      }

      /**
       * ★ 只有**真的是图片**才当 image（第 14 轮修 #10）★
       *
       * 原来这里不看扩展名，只要 assets 表里有记录就返回 `kind: 'image'`，
       * 于是 `assets/xxx.pdf` 被当成图片渲染（用户报「PDF 显示成 image」）。
       * 非图片改为返回 `kind: 'asset'` —— 卡片显示扩展名徽标，
       * 双击时按 blockId 跳到文档里那个块。
       */
      if (!IMAGE_FILE_PATTERN.test(image.path || path)) {
        return {
          blockId: image.blockId,
          kind: 'asset' as const,
          openPath: image.openPath,
          path: image.path,
          title: image.title || image.name,
        }
      }

      return {
        blockId: image.blockId,
        kind: 'image' as const,
        openPath: image.openPath,
        path: image.path,
        title: image.title || image.name,
      }
    },
  }

  /** 图片扩展名：判断「思源资源」到底是不是图片（#10） */
const IMAGE_FILE_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i

function extractImageSourceFromPreviewHtml(previewHtml: string): string | undefined {
    return previewHtml.match(/<img\b[^>]*\bsrc="([^"]+)"/i)?.[1]
  }

  function createFallbackFileTarget(path: string): ResolvedCanvasFileTarget & { detail: string } {
    const trimmed = path.trim()
    if (/^\d{14}-[a-z0-9]{7}$/i.test(trimmed)) {
      return {
        detail: trimmed,
        hpath: trimmed,
        id: trimmed,
        kind: 'document',
        path: trimmed,
        title: trimmed,
      }
    }
    const segments = trimmed.replace(/\\/g, '/').split('/')
    return {
      detail: trimmed,
      kind: trimmed.endsWith('.canvas') ? 'canvas' : 'file',
      path: trimmed,
      title: segments[segments.length - 1] || trimmed,
    }
  }

  async function readWorkspaceCanvasText(path: string): Promise<string> {
    const response = await fetch("/api/file/getFile", {
      body: JSON.stringify({ path }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })

    if (!response.ok) {
      throw new Error(`Unable to read canvas file: ${path}`)
    }

    return response.text()
  }

  function getResolvedFileNode(node: CanvasNode): ResolvedCanvasFileTarget & {
    detail: string
    excerptHtml?: string
    imageSrc?: string
    thumbnail?: CanvasFileTargetPreview["thumbnail"]
  } {
    if (node.type !== "file") {
      throw new Error("Resolved file-node metadata requested for a non-file node.")
    }

    return fileNodeMeta.value[node.id] || createFallbackFileTarget(node.file)
  }

  function preprocessSiyuanBlockDOM(domStr: string): string {
    if (!domStr) {
      return ""
    }

    if (typeof document === "undefined") {
      return domStr
        .replace(/contenteditable="true"/gi, "")
        .replace(/<div[^>]*class="[^"]*protyle-attr[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, "")
    }

    const temp = document.createElement("div")
    temp.innerHTML = domStr

    const editableElements = temp.querySelectorAll("[contenteditable]")
    editableElements.forEach((el) => {
      el.removeAttribute("contenteditable")
    })

    const attrs = temp.querySelectorAll(".protyle-attr")
    attrs.forEach((el) => {
      el.remove()
    })

    return temp.innerHTML
  }

  /**
   * ★ 从笔记 DOM 里只抽出「大纲」（标题块），丢弃正文（第 11 轮 #14）★
   *
   * 用户要求：「画布中的笔记 不要显示全部内容，显示标题和大纲即可」。
   *
   * 为什么不是"截断前 N 行"：截断出来的仍是**正文**，读起来是断章取义；
   * 大纲能一眼看清这篇笔记讲了哪几节，卡片上也更短、更像"目录"。
   *
   * 返回空串表示"这篇笔记没有标题" —— 此时卡片只显示头部标题，不再堆正文。
   */
  function extractOutlineHtml(domStr: string): string {
    if (!domStr) {
      return ""
    }

    if (typeof document === "undefined") {
      // 非 DOM 环境（测试/SSR）不做结构改写，退化为原样，避免误伤。
      return domStr
    }

    const temp = document.createElement("div")
    temp.innerHTML = domStr

    const headings = Array.from(temp.querySelectorAll<HTMLElement>(
      '[data-type="NodeHeading"], h1, h2, h3, h4, h5, h6',
    ))
    if (headings.length === 0) {
      return ""
    }

    /**
     * ★ 只取纯文本，再用**我们自己的标签**重建（第 16 轮修「大纲把 <div> 显示成文字」）★
     *
     * 之前是 `cloneNode` 直接拷思源的标题块 DOM，结果真机上出现了
     * `<div spellcheck="false">三、…</div>` **被当作文本显示**（用户截图）。
     * 原因是思源标题块的 DOM 里可能带已转义的嵌套标记 / 内层 div / protyle-attr，
     * 直接克隆再 `innerHTML` 出去，很容易把标记本身变成可见文本。
     *
     * 现在改为：拿 `textContent`（天然不含标记）→ **转义** → 包进 `<hN>`。
     * 好处：
     *   · 思源 DOM 再奇怪也不会泄漏成文本；
     *   · 样式由我们自己的 `.file-card__document-preview hN` 规则控制（见 SCSS）；
     *   · 天然免疫 XSS（标题里写了 `<script>` 也只会显示成文字）。
     */
    return headings
      .map((heading) => {
        const text = (heading.textContent || "").replace(/\s+/g, " ").trim()
        if (!text) {
          return ""
        }

        const level = resolveHeadingLevel(heading)
        return `<h${level}>${escapeHtml(text)}</h${level}>`
      })
      .filter(Boolean)
      .join("")
  }

  /** 取标题层级：思源用 `data-subtype="h2"` 或 class `h2`，标准标签则看 `H1..H6`。 */
  function resolveHeadingLevel(heading: HTMLElement): number {
    const fromSubtype = heading.getAttribute("data-subtype")?.match(/^h([1-6])$/i)?.[1]
    if (fromSubtype) {
      return Number(fromSubtype)
    }

    const fromClass = (heading.className || "").match(/(?:^|\s)h([1-6])(?:\s|$)/)?.[1]
    if (fromClass) {
      return Number(fromClass)
    }

    const fromTag = heading.tagName.match(/^H([1-6])$/i)?.[1]
    return fromTag ? Number(fromTag) : 1
  }

  async function withDocumentPreview(target: ResolvedCanvasDocumentTarget) {
    const dom = await getSiyuanBlockDOM(target.id)
    return {
      ...target,
      detail: target.hpath || target.path,
      excerptHtml: extractOutlineHtml(preprocessSiyuanBlockDOM(dom)),
    }
  }

  async function withBlockPreview(target: ResolvedCanvasBlockTarget) {
    const isHeadingBlock = target.type === "h"
    const dom = isHeadingBlock
      ? await getSiyuanHeadingBlockDOM(target.id)
      : await getSiyuanBlockDOM(target.id)
    const excerptHtml = preprocessSiyuanBlockDOM(dom)
    return {
      ...target,
      detail: target.hpath || target.path,
      excerptHtml,
      imageSrc: extractImageSourceFromPreviewHtml(excerptHtml),
    }
  }

  /**
   * 网盘文件预览。
   *
   * 拿不到 client（未配置 / 未登录）时不报错，退回纯文件名卡片 ——
   * 画布本身必须始终可用，网盘连接是增强而非前置。
   */
  async function withNebulaPreview(
    target: Extract<ResolvedCanvasFileTarget, { kind: 'nebula' }>,
    node: Extract<CanvasNode, { type: 'file' }>,
  ) {
    const base = {
      ...target,
      detail: `${target.mount}${target.nebulaPath}`,
      originalFile: node.file,
    }

    try {
      const client = getNebulaClient()
      if (!client || !client.isConfigured()) {
        return base as typeof base & { thumbnail?: CanvasFileTargetPreview['thumbnail'] }
      }

      await client.login()
      const stat = await client.stat(target.mount, target.nebulaPath)
      const detail = `${target.mount}${target.nebulaPath}${stat && typeof stat.size === 'number'
        ? `  ·  ${formatSize(stat.size)}`
        : ''}`

      // 只对图片取缩略图。其它类型（PDF / Office / CAD / 视频）交给专属预览器，
      // 不在卡片里内联渲染——避免（例如）把 200MB 图纸塞进画布。
      if (pickViewer(target.nebulaPath) === 'image') {
        const previewUrl = await client.previewUrl(target.mount, target.nebulaPath)
        if (previewUrl) {
          return {
            ...base,
            detail,
            imageSrc: previewUrl,
            thumbnail: { src: previewUrl },
          }
        }
      }

      return { ...base, detail }
    } catch (error) {
      console.warn('[diskcanvas] 网盘文件预览失败:', target.path, error)
      return base as typeof base & { thumbnail?: CanvasFileTargetPreview['thumbnail'] }
    }
  }

  async function resolveFileNodeMetadata(node: Extract<CanvasNode, { type: 'file' }>) {
    let resolved = await resolveCanvasFileTarget(node.file, resolveLookups)

    // 若属于思源块 ID 但命中了尚未建立索引的兜底（title 等于 id），支持最多重试 3 次，平滑异步索引队列延迟
    if (/^\d{14}-[a-z0-9]{7}$/i.test(node.file.trim()) && resolved.kind === 'document' && resolved.title === resolved.id) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 120))
        const retried = await resolveCanvasFileTarget(node.file, resolveLookups)
        if (retried.title !== retried.id) {
          resolved = retried
          break
        }
      }
    }

    let enriched: ResolvedCanvasFileTarget & {
      detail: string
      excerptHtml?: string
      imageSrc?: string
      thumbnail?: CanvasFileTargetPreview['thumbnail']
      originalFile?: string
    } = {
      ...resolved,
      detail: resolved.path,
      originalFile: node.file,
    }

    if (resolved.kind === 'block') {
      enriched = await withBlockPreview(resolved)
    }

    if (resolved.kind === 'document') {
      enriched = await withDocumentPreview(resolved)
    }

    if (resolved.kind === 'canvas') {
      const canvasPreview = await loadCanvasTargetPreview(resolved, {
        readCanvasText: readWorkspaceCanvasText,
      })
      enriched = {
        ...resolved,
        detail: resolved.path,
        thumbnail: canvasPreview.thumbnail,
        originalFile: node.file,
      }
    }

    // 网盘文件：用 NebulaClient 拉缩略图/详情。
    // 关键点：预览地址必须经过 client.absolute() —— 容器内 /api/preview 返回的 url
    // 内嵌的是 docker 服务名（http://nebula:8088/...），浏览器不可达，必须改写成宿主地址。
    if (resolved.kind === 'nebula') {
      enriched = await withNebulaPreview(resolved, node)
    }

    return enriched
  }

  async function refreshFileNodeMetadata(nodeIds?: string[]) {
    const version = ++fileNodeResolveVersion
    const fileNodes = state.document.nodes.filter((node): node is Extract<CanvasNode, { type: 'file' }> => (
      node.type === 'file' && (!nodeIds || nodeIds.includes(node.id))
    ))
    const nextEntries = await Promise.all(fileNodes.map(async (node) => {
      // 如果没有指定 nodeIds（属于全局刷新），且当前缓存中有此节点的元数据且原 file 路径/ID 未改变，直接复用缓存
      const cached = fileNodeMeta.value[node.id]
      if (!nodeIds && cached && cached.originalFile === node.file) {
        return [node.id, cached] as const
      }
      return [node.id, await resolveFileNodeMetadata(node)] as const
    }))

    if (version !== fileNodeResolveVersion) {
      return
    }

    if (!nodeIds) {
      fileNodeMeta.value = Object.fromEntries(nextEntries)
      return
    }

    fileNodeMeta.value = {
      ...fileNodeMeta.value,
      ...Object.fromEntries(nextEntries),
    }
  }

  function getNodeTitle(node: CanvasNode): string {
    switch (node.type) {
      case "file":
        return getResolvedFileNode(node).title
      case "group":
        return node.label || t("nodeDefaultGroupLabel")
      case "link":
        return t("nodeKindExternalLink")
      case "text":
        return node.text.split("\n")[0] || t("nodeKindText")
      default:
        return node.id
    }
  }

  function getFileNodeDescription(node: CanvasNode): string {
    return node.type === "file" ? getResolvedFileNode(node).detail : ""
  }

  function getFileNodeKind(node: CanvasNode): string {
    return node.type === "file" ? getResolvedFileNode(node).kind : ""
  }

  function getFileNodePreview(node: CanvasNode) {
    if (node.type !== "file") {
      throw new Error("File node preview requested for a non-file node.")
    }

    return createCanvasFileTargetPreview(getResolvedFileNode(node))
  }

  return {
    getFileNodeDescription,
    getFileNodeKind,
    getFileNodePreview,
    getNodeTitle,
    getResolvedFileNode,
    refreshFileNodeMetadata,
  }
}
