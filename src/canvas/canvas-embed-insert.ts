import {
  appendBlock,
  insertBlock,
  setBlockAttrs,
  upload,
  updateBlock,
} from "@/api"
import {
  buildCanvasEmbedBlockMarkdown,
  canvasTitleFromPath,
} from "@/canvas/canvas-embed-block"
import { generateCanvasEmbedSvg } from "@/canvas/canvas-embed-preview"
import { parseCanvasDocument } from "@/canvas/format"

export const CANVAS_EMBED_CLASS = "canvas-embed-preview"
export const CANVAS_EMBED_BOUND_ATTR = "data-canvas-embed-bound"
export const CANVAS_PATH_ATTR = "custom-canvas-path"
export const CANVAS_EMBED_REFRESH_EVENT = "diskcanvas-embed-refresh"

export interface CanvasEmbedRefreshEventDetail {
  path: string
}

function escapeMarkdownImageAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/]/g, "\\]")
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/]/g, "\\]")
}

function sanitizePreviewAssetName(value: string): string {
  return (value || "canvas-preview")
    .replace(/[\\/:*?"'<>|]/g, "_")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    || "canvas-preview"
}

async function uploadCanvasEmbedPreview(svg: string, title: string): Promise<string | null> {
  const fileName = `${sanitizePreviewAssetName(title)}.svg`
  const file = new File([svg], fileName, { type: "image/svg+xml" })
  const result = await upload("/assets/", [file])
  return result?.succMap?.[fileName] || null
}

function escapeMarkdownImageTitle(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export function buildCanvasEmbedMarkdown(_canvasPath: string, imagePath: string, title: string): string {
  const safeTitle = escapeMarkdownImageTitle(title)
  return `![${escapeMarkdownImageAlt(title)}](${imagePath} "${safeTitle}")`
}

export function buildCanvasLinkMarkdown(canvasPath: string, title?: string): string {
  const fileName = title || canvasPath.replace(/^.*\//, "") || "canvas.canvas"
  return `[${escapeMarkdownLinkText(fileName)}](${canvasPath})`
}

export interface InsertCanvasEmbedOptions {
  canvasPath: string
  canvasRaw: string
  parentBlockId: string
  previousBlockId?: string
  /**
   * 插到该块**之前**（内核语义 `nextID`）。
   *
   * ★ 斜杠插入用这个，而不是 previousBlockId ★
   *   用户要的是「插入块到该行」。实测内核语义：
   *     · `{parentID, previousID}` ⇒ 插到 previousID **之后**
   *     · `{parentID, nextID}`     ⇒ 插到 nextID **之前**
   *   斜杠菜单里 nextID=光标块 ⇒ 块落在光标那一行；
   *   随后 cleanupSlashText 把用户敲的 `/过滤词` 块删掉，
   *   最终结果就是「嵌入块正好占据原来那一行」。
   */
  nextBlockId?: string
  title?: string
  /**
   * 插件名 —— 写入自定义块 `data-info` 的前半段（`<插件名>/canvas`）。
   *
   * ★ 为什么由调用方传入而不是在这里 import 插件实例 ★
   *   本模块处于 `canvas-embed-observer ← canvas-embed-insert` 这条链上，
   *   而 `@/main`（插件实例的持有者）经 App.vue 会绕回本模块，
   *   直接 import 会形成循环依赖。显式传参最稳，也便于单测。
   */
  pluginName?: string
}

export interface InsertCanvasLinkOptions {
  canvasPath: string
  parentBlockId: string
  previousBlockId?: string
  /**
   * 插到该块**之前**（内核语义 `nextID`）。
   *
   * 与 `InsertCanvasEmbedOptions.nextBlockId` 同一套语义，理由见那里的长注释：
   * 斜杠菜单要的是「插到光标那一行」，而内核实测是
   * `previousID` ⇒ 插到其后、`nextID` ⇒ 插到其前。
   * 链接插入与嵌入插入共用同一份目标定位结果，必须一起迁移，
   * 否则同一份 location 在两条链路上落到不同位置。
   */
  nextBlockId?: string
  title?: string
}

/**
 * 把画布作为**自定义块**插入笔记（样式与网盘文件嵌入对齐）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 与旧实现的差别（旧实现见下方 legacy 说明）★
 * ══════════════════════════════════════════════════════════════════════
 *   旧：生成 SVG 缩略图 → 上传到 `assets/` → 插 `![标题](/assets/x.svg)` 图片
 *   新：插 `;;; <插件名>/canvas \n {"path":…} \n ;;;` 自定义块
 *
 *   为什么改（用户原话：「画布插入到笔记中的块样式参照网盘文件插入样式，
 *   风格和相同尺寸，只读预览」）：
 *     · 图片块没有头部/工具条/边框容器，与网盘嵌入块风格不一致；
 *     · 图片尺寸由图片自身决定，做不到与网盘嵌入相同的 `clamp(300px,58vh,620px)`；
 *     · 每次都要传一个资源文件，笔记里会攒下孤儿 SVG。
 *
 *   新实现连 `canvasRaw` 都不再使用（预览由渲染器按路径现读现画），
 *   但仍然保留它：① 校验画布可解析、失败就不插脏块；② 兼容旧调用方签名。
 *
 * ★ 仍需 `parseCanvasDocument` 预检的理由 ★
 *   插入的是一段**引用**，块本身不含画布内容。若画布文件损坏，
 *   笔记里只会留一个永远画不出内容的空壳。插前校验可以fail-fast，
 *   返回 null 让上层提示「插入失败」，而不是留个坏块。
 */
export async function insertCanvasEmbed(options: InsertCanvasEmbedOptions): Promise<string | null> {
  const {
    canvasPath,
    canvasRaw,
    parentBlockId,
    previousBlockId,
    nextBlockId,
    title,
    pluginName,
  } = options

  const result = parseCanvasDocument(canvasRaw)
  if (!result.document || result.errors.length > 0) {
    return null
  }

  const embedTitle = title || canvasTitleFromPath(canvasPath)
  const markdown = buildCanvasEmbedBlockMarkdown(
    pluginName || "siyuan-diskcanvas",
    { path: canvasPath, title: embedTitle },
  )

  // 优先 nextID（插到光标块之前）；没有才退回 previousID（插到其后）
  let ops = nextBlockId
    ? await insertBlock("markdown", markdown, nextBlockId, undefined, parentBlockId)
    : previousBlockId
      ? await insertBlock("markdown", markdown, undefined, previousBlockId, parentBlockId)
      : null
  if (!ops || ops.length === 0) {
    ops = await appendBlock("markdown", markdown, parentBlockId)
  }
  if (!ops || ops.length === 0) {
    return null
  }

  const blockId = ops[0].doOperations?.[0]?.id as string | undefined
  if (blockId) {
    await setBlockAttrs(blockId, { [CANVAS_PATH_ATTR]: canvasPath })
  }

  return blockId ?? null
}

export async function insertCanvasLink(options: InsertCanvasLinkOptions): Promise<string | null> {
  const {
    canvasPath,
    parentBlockId,
    previousBlockId,
    nextBlockId,
    title,
  } = options

  const markdown = buildCanvasLinkMarkdown(canvasPath, title)

  // 与 insertCanvasEmbed 一致：优先 nextID（插到光标块之前），再退回 previousID
  let ops = nextBlockId
    ? await insertBlock("markdown", markdown, nextBlockId, undefined, parentBlockId)
    : previousBlockId
      ? await insertBlock("markdown", markdown, undefined, previousBlockId, parentBlockId)
      : null
  if (!ops || ops.length === 0) {
    ops = await appendBlock("markdown", markdown, parentBlockId)
  }
  if (!ops || ops.length === 0) {
    return null
  }

  const blockId = ops[0].doOperations?.[0]?.id as string | undefined
  if (blockId) {
    await setBlockAttrs(blockId, { [CANVAS_PATH_ATTR]: canvasPath })
  }

  return blockId ?? null
}

export async function refreshCanvasEmbedBlock(
  blockId: string,
  canvasPath: string,
  canvasRaw: string,
  title?: string,
): Promise<boolean> {
  const result = parseCanvasDocument(canvasRaw)
  if (!result.document || result.errors.length > 0) {
    return false
  }

  const svg = generateCanvasEmbedSvg(result.document)
  if (!svg) {
    return false
  }

  const embedTitle = title || canvasPath.replace(/^.*\//, "").replace(/\.canvas$/i, "")
  const imagePath = await uploadCanvasEmbedPreview(svg, embedTitle)
  if (!imagePath) {
    return false
  }

  await updateBlock("markdown", buildCanvasEmbedMarkdown(canvasPath, imagePath, embedTitle), blockId)
  await setBlockAttrs(blockId, { [CANVAS_PATH_ATTR]: canvasPath })

  return true
}
