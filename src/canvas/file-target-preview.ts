import type { ResolvedCanvasFileTarget } from "@/canvas/file-target-resolution"

import { parseCanvasDocument } from "@/canvas/format"

export interface CanvasThumbnailNode {
  height: number
  width: number
  x: number
  y: number
}

export interface CanvasThumbnailEdge {
  fromX: number
  fromY: number
  toX: number
  toY: number
}

export interface CanvasFileTargetPreview {
  badge: string
  clampMode?: "viewport"
  detail: string
  headline: string
  helper: string
  imageSrc?: string
  kind: "block" | "canvas" | "document" | "file" | "image"
  previewHtml?: string
  /**
   * ★ 路径行（第 33 轮为"画布文件卡片"新增）★
   *
   * 画布卡片要显示**两行**：文件名 + 完整路径。
   * 原来只有 `headline`（标题）与 `detail` 两个槽位，而这张卡片的
   * `detail` 要给文件名用 —— 于是路径单独占一个字段，由卡片按顺序渲染。
   *
   * 只对 `kind: "canvas"` 有意义；其他类型不设，卡片也不会渲染这一行。
   */
  pathLine?: string
  thumbnail?: {
    edges: CanvasThumbnailEdge[]
    nodes: CanvasThumbnailNode[]
  }
}

type PreviewInput = ResolvedCanvasFileTarget & {
  excerptHtml?: string
  imageSrc?: string
  thumbnail?: {
    edges: CanvasThumbnailEdge[]
    nodes: CanvasThumbnailNode[]
  }
}

function toImageSource(target: PreviewInput): string | undefined {
  if ("openPath" in target && typeof target.openPath === "string") {
    return target.openPath
  }

  if ("asset" in target && target.asset?.openPath) {
    return target.asset.openPath
  }

  if ("imageSrc" in target && typeof target.imageSrc === "string") {
    return target.imageSrc
  }

  return undefined
}

/** 图片扩展名（用于判断「思源资源」到底是不是图片）。 */
const IMAGE_FILE_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i

/**
 * 把网盘目标的「挂载点 + 路径」拼成用于显示的完整路径。
 *
 * 例：`mount = "Docker操作"`、`nebulaPath = "/照片/a.png"` → `"Docker操作/照片/a.png"`。
 * 容错：挂载点可能有前后斜杠；路径可能没前导斜杠。
 */
function buildNebulaDisplayPath(target: PreviewInput): string {
  const mount = ('mount' in target && typeof target.mount === 'string')
    ? target.mount.trim().replace(/^\/+|\/+$/g, '')
    : ''
  const nebulaPath = ('nebulaPath' in target && typeof target.nebulaPath === 'string')
    ? target.nebulaPath.trim()
    : ''

  if (!mount) {
    return nebulaPath
  }
  if (!nebulaPath || nebulaPath === '/') {
    return mount
  }

  return `${mount}/${nebulaPath.replace(/^\/+/, '')}`
}

function getFileBadge(target: PreviewInput): string {
  const pathStr = ('path' in target && typeof target.path === 'string') ? target.path : ''
  if (!pathStr)
    return 'FILE'

  const cleanPath = pathStr.split(/[?#]/)[0]
  const segments = cleanPath.split(/[/\\]/)
  const fileName = segments[segments.length - 1] || ''

  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex > 0 && dotIndex < fileName.length - 1) {
    const ext = fileName.substring(dotIndex + 1).trim()
    if (ext && ext.length <= 8) {
      return ext.toUpperCase()
    }
  }

  return 'FILE'
}

/**
 * 取路径末段（文件名）。
 *
 * ★ 与 `getFileBadge` 同一套切分规则 ★
 *   路径里可能有查询串/锚点（`x.canvas?v=1`），也可能有反斜杠；
 *   两处若各写一套，徽标与文件名就可能对不上。抽出来共用。
 */
function getFileName(path: unknown): string {
  const raw = typeof path === 'string' ? path : ''
  if (!raw) {
    return ''
  }
  const cleanPath = raw.split(/[?#]/)[0]
  const segments = cleanPath.split(/[/\\]/)
  return segments[segments.length - 1] || raw
}

export function createCanvasFileTargetPreview(target: PreviewInput): CanvasFileTargetPreview {
  switch (target.kind) {
    case 'block':
      return {
        badge: 'Block',
        clampMode: 'viewport',
        detail: 'hpath' in target ? target.hpath || target.path : target.path,
        headline: target.title,
        helper: 'Opens block in SiYuan',
        imageSrc: toImageSource(target),
        kind: 'block',
        previewHtml: target.excerptHtml || '',
      }
    case 'document':
      return {
        badge: 'Document',
        clampMode: 'viewport',
        detail: 'hpath' in target ? target.hpath || target.path : target.path,
        headline: target.title,
        helper: 'Opens in SiYuan',
        kind: 'document',
        previewHtml: target.excerptHtml || '',
      }
    case 'canvas':
      /**
       * ★ 画布卡片与网盘卡片同构（第 33 轮初版 → 第 35 轮修正）★
       *
       * 第 33 轮的分配是「headline = 画布文件 / detail = 文件名 / pathLine = 路径」，
       * 导致正文渲染成**三行**（类型名 + 文件名 + 路径），而抬头又显示文件名 ——
       * 与网盘卡片（抬头 = 类型名，正文 = 文件名 + 路径，两行）风格明显不一致。
       * 用户第 35 轮反馈：「网盘文库 和 画布 文件 块的 风格不一样。需要调整 画布文件块。」
       *
       * 现在与网盘卡片**完全同构**：
       *   header    = 「画布文件」（类型名，由 CanvasWorkspace.getNodeHeaderTitle 出，带 i18n）
       *   detail    = 文件名（正文第一行，粗体 —— 与网盘卡片的文件名同一处样式）
       *   pathLine  = 完整路径（正文第二行，灰色小字）
       *   helper    = ''（不显示）
       *
       * ⇒ headline 不再承担"画布文件"这个固定标题：那是**抬头**的职责。
       *   这里给文件名，作为「抬头解析未完成」时的兜底，语义也对得上。
       */
      return {
        badge: 'Canvas',
        detail: getFileName(target.path),
        headline: getFileName(target.path) || 'Canvas file',
        helper: '',
        kind: 'canvas',
        pathLine: target.path,
      }
    case 'image':
      return {
        badge: 'Image',
        detail: target.path,
        headline: target.title,
        helper: 'Image file',
        imageSrc: toImageSource(target),
        kind: 'image',
      }
    case 'asset': {
      /**
       * ★ 思源资源不能一律当作图片（第 11 轮修 #10）★
       *
       * 原本这里硬编码 `badge: 'Image Asset'` + `kind: 'image'`，
       * 于是 `assets/xxx.pdf` 这类**非图片**资源也被标成 Image、并试图按图片渲染
       * —— 用户现象：「思源资源的 PDF 文件显示目前是 image，显示是不正确的」。
       *
       * 现在按扩展名判定：是图片才走 image 分支，否则按普通文件处理（badge = 扩展名）。
       */
      const assetPath = ('path' in target && typeof target.path === 'string') ? target.path : ''
      const isImageAsset = IMAGE_FILE_PATTERN.test(assetPath)
      if (isImageAsset) {
        return {
          badge: 'Image',
          detail: 'description' in target ? target.description : target.path,
          headline: target.title,
          helper: 'Image asset',
          imageSrc: toImageSource(target),
          kind: 'image',
        }
      }

      return {
        badge: getFileBadge(target),
        detail: 'description' in target ? target.description : target.path,
        headline: target.title,
        helper: '',
        kind: 'file',
      }
    }
    case 'nebula':
      /**
       * ★ 网盘文件节点不显示 helper 文案 ★
       *
       * 这里曾经落到 default 分支，于是卡片上多了一行英文
       * `Double click to open`（用户反馈：「去掉画布上面网盘文件上的双击打开 英文提示」）。
       *
       * 两处都要清干净：
       *   1. helper 给空串 —— 卡片组件用 `v-if="showHelper"` 控制，
       *      但有的调用方不传 showHelper；空串 + `.filter(Boolean)` 双保险，
       *      避免渲染出一个只占位的空行。
       *   2. `shouldShowFileCardHelper` 里把 nebula 也列入「无 helper」的 kind
       *      （见 CanvasWorkspace.vue），这是真正决定显不显示的那一处。
       *
       * badge 保留扩展名（如下载型 zip / pdf 一眼可辨），detail 给网盘路径。
       */
      return {
        badge: getFileBadge(target),
        /**
         * ★ 显示路径要带**挂载点**（第 11 轮 #12）★
         *
         * 用户要求：「画布中的网盘文件 显示的路径中需要增加 挂载点位置显示」。
         * 只给 `nebulaPath`（如 `/照片/a.png`）时，看不出它在哪个挂载点下 ——
         * 不同挂载点下完全可能重名。
         *
         * 拼成 `<挂载点><路径>`（去掉挂载点两端多余斜杠，再补一个 `/`），
         * 得到形如 `Docker操作/照片/a.png` 的完整定位。
         */
        detail: 'nebulaPath' in target ? buildNebulaDisplayPath(target) : target.path,
        headline: target.title,
        helper: '',
        kind: 'file',
      }
    default:
      return {
        badge: getFileBadge(target),
        detail: 'description' in target ? target.description : target.path,
        headline: target.title,
        helper: 'Double click to open',
        kind: 'file',
      }
  }
}

export async function loadCanvasTargetPreview(
  target: Extract<ResolvedCanvasFileTarget, { kind: "canvas" }>,
  sources: {
    readCanvasText: (path: string) => Promise<string>
  },
): Promise<CanvasFileTargetPreview> {
  try {
    const raw = await sources.readCanvasText(target.path)
    const parsed = parseCanvasDocument(raw)
    if (!parsed.document) {
      return createCanvasFileTargetPreview(target)
    }

    const nodeById = new Map(parsed.document.nodes.map((node) => [node.id, node]))
    return createCanvasFileTargetPreview({
      ...target,
      thumbnail: {
        edges: parsed.document.edges.flatMap((edge) => {
          const fromNode = nodeById.get(edge.fromNode)
          const toNode = nodeById.get(edge.toNode)
          if (!fromNode || !toNode) {
            return []
          }

          return [{
            fromX: fromNode.x + fromNode.width / 2,
            fromY: fromNode.y + fromNode.height / 2,
            toX: toNode.x + toNode.width / 2,
            toY: toNode.y + toNode.height / 2,
          }]
        }),
        nodes: parsed.document.nodes.map((node) => ({
          height: node.height,
          width: node.width,
          x: node.x,
          y: node.y,
        })),
      },
    })
  } catch {
    return createCanvasFileTargetPreview(target)
  }
}
