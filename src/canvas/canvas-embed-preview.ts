import type { CanvasDocument, CanvasNode } from "@/canvas/types"

const PREVIEW_WIDTH = 400
const PREVIEW_HEIGHT = 260
const NODE_PADDING = 60
const PADDING = 8

const NODE_COLORS: Record<string, string> = {
  file: "#5b8def",
  group: "transparent",
  link: "#e8a65d",
  text: "#6cc6a0",
}

function computeBounds(nodes: CanvasNode[]) {
  if (nodes.length === 0) {
    return { left: 0, top: 0, width: 1, height: 1 }
  }

  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + n.width))
  const maxY = Math.max(...nodes.map((n) => n.y + n.height))

  return {
    left: minX - NODE_PADDING,
    top: minY - NODE_PADDING,
    width: maxX - minX + NODE_PADDING * 2,
    height: maxY - minY + NODE_PADDING * 2,
  }
}

export function generateCanvasEmbedSvg(doc: CanvasDocument): string {
  const { nodes, edges } = doc
  if (nodes.length === 0) {
    return ""
  }

  const bounds = computeBounds(nodes)
  const scaleX = (PREVIEW_WIDTH - PADDING * 2) / bounds.width
  const scaleY = (PREVIEW_HEIGHT - PADDING * 2) / bounds.height
  const scale = Math.min(scaleX, scaleY)
  const offsetX = (PREVIEW_WIDTH - bounds.width * scale) / 2
  const offsetY = (PREVIEW_HEIGHT - bounds.height * scale) / 2

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  const edgePaths = edges
    .map((edge) => {
      const from = nodeMap.get(edge.fromNode)
      const to = nodeMap.get(edge.toNode)
      if (!from || !to) return ""

      const fx = (from.x + from.width / 2 - bounds.left) * scale + offsetX
      const fy = (from.y + from.height / 2 - bounds.top) * scale + offsetY
      const tx = (to.x + to.width / 2 - bounds.left) * scale + offsetX
      const ty = (to.y + to.height / 2 - bounds.top) * scale + offsetY

      return `<line x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}" stroke="#94a3b8" stroke-width="1" stroke-opacity="0.5"/>`
    })
    .filter(Boolean)
    .join("")

  const nodeRects = nodes
    .map((node) => {
      const x = (node.x - bounds.left) * scale + offsetX
      const y = (node.y - bounds.top) * scale + offsetY
      const w = Math.max(3, node.width * scale)
      const h = Math.max(3, node.height * scale)
      const fill = node.type === "group" ? "transparent" : (NODE_COLORS[node.type] ?? "#6cc6a0")
      const stroke = node.type === "group" ? "#94a3b8" : "none"
      const strokeAttr = node.type === "group" ? ' stroke-width="1"' : ""

      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}"${strokeAttr} stroke="${stroke}"/>`
    })
    .join("")

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}"><rect width="100%" height="100%" fill="#f8fafc" rx="4"/>${edgePaths}${nodeRects}</svg>`
}

export function generateCanvasEmbedDataUrl(doc: CanvasDocument): string {
  const svg = generateCanvasEmbedSvg(doc)
  if (!svg) return ""
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

/**
 * 生成**自适应填充**的只读预览 SVG —— 供笔记内嵌块使用。
 *
 * ★ 与 generateCanvasEmbedSvg 的三点差别 ★
 *   1. **不固定 400×260**：改为 `viewBox` = 内容包围盒，最终显示尺寸交给 CSS。
 *      旧版把画布硬压进固定画布尺寸，内嵌块放大后只会越来越糊。
 *   2. **不手工换算缩放**：viewBox 直接用画布坐标，
 *      由 SVG 自己完成缩放，省掉一整套 scale/offset 计算（少一处出错的地方）。
 *   3. `preserveAspectRatio="xMidYMid meet"`：容器与内容比例不一致时**留白**而非拉伸变形。
 *
 * 图形保持**纯 ASCII**（矩形 + 直线 + 十六进制色值，不含文字），
 * 这样转 data URL 时不会遇到编码问题；标题由内嵌块头部承担。
 */
export function generateCanvasFitSvg(doc: CanvasDocument): string {
  const { nodes, edges } = doc
  if (nodes.length === 0) {
    return ""
  }

  const bounds = computeBounds(nodes)
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  const edgePaths = edges
    .map((edge) => {
      const from = nodeMap.get(edge.fromNode)
      const to = nodeMap.get(edge.toNode)
      if (!from || !to) return ""

      return `<line x1="${from.x + from.width / 2}" y1="${from.y + from.height / 2}" x2="${to.x + to.width / 2}" y2="${to.y + to.height / 2}" stroke="#94a3b8" stroke-width="${Math.max(1, bounds.width / 400)}" stroke-opacity="0.55"/>`
    })
    .filter(Boolean)
    .join("")

  const nodeRects = nodes
    .map((node) => {
      const fill = node.type === "group" ? "none" : (NODE_COLORS[node.type] ?? "#6cc6a0")
      const stroke = node.type === "group" ? "#94a3b8" : "none"

      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${Math.max(2, bounds.width / 200)}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`
    })
    .join("")

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}" preserveAspectRatio="xMidYMid meet">${edgePaths}${nodeRects}</svg>`
}

/**
 * SVG → data URL。
 *
 * ★ 为什么用 `encodeURIComponent` 而不是 `btoa` ★
 *   `btoa` 只接受 Latin-1；SVG 里一旦出现中文（节点标题、文件名）就会抛
 *   `InvalidCharacterError`。`encodeURIComponent` 走 UTF-8 百分号编码，
 *   任何字符都安全，代价仅是体积略大。
 */
export function toSvgDataUrl(svg: string): string {
  if (!svg) {
    return ""
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
