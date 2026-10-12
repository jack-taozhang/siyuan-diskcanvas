export interface ResolvedCanvasImageTarget {
  blockId?: string
  kind: "image"
  openPath: string
  path: string
  title: string
}

/**
 * 思源资源（assets 表里的条目），**且不是图片**。
 *
 * ★ 为什么需要这个类型（第 14 轮修 #10）★
 *   用户：「思源资源的 PDF 文件 显示目前是 image，显示是不正确的」。
 *   根因：`resolveImageByPath` 只要在 assets 表里查到条目就**无条件**返回
 *   `kind: 'image'`，**不看扩展名** ⇒ `assets/xxx.pdf` 被当成图片渲染。
 *
 *   而 `file-target-preview.ts` 里其实**一直有**一条 `case 'asset'` 分支
 *   （写着 badge 'Image Asset'），但**全项目从来没有人产生 `kind: 'asset'`**
 *   —— 它是个死分支，所以之前的修改毫无效果。
 *   这里把它正式接上：非图片的思源资源走 `asset`。
 *
 * `blockId` 用于双击时**跳转**到文档里的那个块（用户要求「这个还需要跳转」）。
 */
export interface ResolvedCanvasAssetTarget {
  blockId?: string
  kind: "asset"
  openPath: string
  path: string
  title: string
}

export interface ResolvedCanvasBlockTarget {
  hpath: string
  id: string
  kind: "block"
  path: string
  rootId: string
  type?: string
  title: string
}

export interface ResolvedCanvasDocumentTarget {
  hpath: string
  id: string
  kind: "document"
  path: string
  title: string
}

export interface ResolvedCanvasNestedTarget {
  kind: "canvas"
  path: string
  title: string
}

/**
 * 「本机存储」文件节点（跑着思源那台机器上的文件，如 NAS 的 /vol1）。
 *
 * `path` 采用带协议前缀的形式：`localfs://<绝对路径去前导斜杠>`，
 * 例如 `/vol1/1000/照片/a.png` → `localfs://vol1/1000/照片/a.png`。
 *
 * ★ 为什么必须带协议前缀（不能直接存 `/vol1/...`）★
 *   画布节点的 `file` 字段是一个裸字符串，解析时无法只靠形状区分
 *   "思源工作区里的路径"与"本机存储上的路径"。
 *   实测后果：`/vol1/1000/a.png` 会命中 `IMAGE_PATH_PATTERN`，
 *   被当成**思源图片资源**去 assets 表查询并渲染，显示必然错。
 *   协议前缀让"这是本机存储文件"这件事在解析第一步就能确定。
 *
 * ★ 为什么仍然是一个普通字符串 ★
 *   `file` 字段要存进标准 JSON Canvas（可被 Obsidian 等其它工具打开），
 *   只能是字符串。带前缀的 URI 形态两边都满足。
 */
export interface ResolvedCanvasLocalFsTarget {
  /** 去掉协议前缀后的**绝对路径**，如 /vol1/1000/照片/a.png */
  fsPath: string
  kind: "localfs"
  /** 原样存储的 localfs:// 地址 */
  path: string
  title: string
}

export interface ResolvedCanvasFileFallbackTarget {
  kind: "file"
  path: string
  title: string
}

export type ResolvedCanvasFileTarget =
  | ResolvedCanvasBlockTarget
  | ResolvedCanvasDocumentTarget
  | ResolvedCanvasNestedTarget
  | ResolvedCanvasLocalFsTarget
  | ResolvedCanvasImageTarget
  | ResolvedCanvasAssetTarget
  | ResolvedCanvasFileFallbackTarget

export interface CanvasFileTargetLookups {
  resolveBlockById: (blockId: string) => Promise<ResolvedCanvasBlockTarget | null>
  resolveCanvasByPath: (path: string) => Promise<ResolvedCanvasNestedTarget | null>
  resolveDocumentByBlockId: (blockId: string) => Promise<ResolvedCanvasDocumentTarget | null>
  resolveDocumentByPath: (path: string) => Promise<ResolvedCanvasDocumentTarget | null>
  resolveImageByBlockId: (blockId: string) => Promise<ResolvedCanvasImageTarget | null>
  resolveImageByPath: (path: string) => Promise<ResolvedCanvasImageTarget | ResolvedCanvasAssetTarget | null>
}

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/i
const EMBEDDED_BLOCK_ID_PATTERN = /\{:[^}]*\bid="(\d{14}-[a-z0-9]{7})"[^}]*\}/i
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/
const IMAGE_PATH_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?#])/i

/** 本机存储协议前缀。形如 localfs://vol1/1000/照片/a.png */
export const LOCALFS_SCHEME = "localfs://"

/**
 * 把**绝对路径**组装成 localfs:// 地址。
 * 例：`/vol1/1000/照片/a.png` → `localfs://vol1/1000/照片/a.png`
 *
 * 前导斜杠统一去掉：协议头里已经隐含了"从根开始"，
 * 留着会得到 `localfs:///vol1/…` 这种三斜杠形态 —— 合法但难读，
 * 而且与解析端的归一化规则容易产生第二套写法。
 */
export function buildLocalFsUri(fsPath: string): string {
  const clean = String(fsPath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "")
  return `${LOCALFS_SCHEME}${clean}`
}

/**
 * 解析 localfs:// 地址。
 * 容错：前缀**大小写不敏感**、允许多重前导斜杠。
 */
export function parseLocalFsUri(uri: string): { fsPath: string } | null {
  const trimmed = uri.trim()
  if (!trimmed.toLowerCase().startsWith(LOCALFS_SCHEME)) {
    return null
  }

  const rest = trimmed.slice(LOCALFS_SCHEME.length).replace(/^\/+/, "")
  if (!rest) {
    // 只有协议头、没有路径 —— 无法建卡片
    return null
  }

  return { fsPath: "/" + rest }
}

function getFallbackTitle(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/")
  return segments[segments.length - 1] || path
}

function toDirectImageOpenPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed || trimmed.startsWith("/")) {
    return trimmed
  }

  if (trimmed.startsWith("assets/")) {
    return `/data/${trimmed}`
  }

  if (trimmed.startsWith("data/")) {
    return `/${trimmed}`
  }

  return trimmed
}

function extractEmbeddedBlockId(input: string): string | null {
  return input.match(EMBEDDED_BLOCK_ID_PATTERN)?.[1] || null
}

function extractEmbeddedImagePath(input: string): string | null {
  return input.match(MARKDOWN_IMAGE_PATTERN)?.[1]?.trim() || null
}

function isWorkspaceCanvasAssetPath(path: string): boolean {
  return /(?:^|[/\\])[^/\\]+\.assets[/\\]/i.test(path)
}

export async function resolveCanvasFileTarget(
  input: string,
  lookups: CanvasFileTargetLookups,
): Promise<ResolvedCanvasFileTarget> {
  const trimmed = input.trim()
  if (!trimmed) {
    return {
      kind: "file",
      path: "",
      title: "",
    }
  }

  // 本机存储文件：localfs://<绝对路径>。必须最先判断 ——
  // 否则 `/vol1/…/a.png` 会被后面的 IMAGE_PATH_PATTERN 当成思源图片资源。
  const localFs = parseLocalFsUri(trimmed)
  if (localFs) {
    return {
      fsPath: localFs.fsPath,
      kind: "localfs",
      path: trimmed,
      title: getFallbackTitle(localFs.fsPath),
    }
  }

  const blockId = BLOCK_ID_PATTERN.test(trimmed) ? trimmed : extractEmbeddedBlockId(trimmed)
  if (blockId) {
    const embeddedImagePath = extractEmbeddedImagePath(trimmed)
    if (embeddedImagePath) {
      const image = await lookups.resolveImageByBlockId(blockId)
      if (image) {
        return image
      }
    }

    const block = await lookups.resolveBlockById(blockId)
    if (block) {
      if (block.type === 'I') {
        const image = await lookups.resolveImageByBlockId(blockId)
        if (image) {
          return image
        }
      }
      return block
    }

    const image = await lookups.resolveImageByBlockId(blockId)
    if (image) {
      return image
    }

    const document = await lookups.resolveDocumentByBlockId(blockId)
    if (document) {
      return document
    }

    // 若通过各查找函数暂未在数据库中查到（如刚创建文档，思源 SQLite 索引还在异步处理中），
    // 由于确定是思源块/文档 ID，绝不能作为外部本地文件处理，兜底作为文档返回
    return {
      hpath: blockId,
      id: blockId,
      kind: "document",
      path: blockId,
      title: blockId,
    }
  }

  const lookupPath = extractEmbeddedImagePath(trimmed) || trimmed

  // 拖拽/粘贴到当前 canvas 的图片位于同级 .assets 目录，不存在块 ID，可直接展示并避免无意义查询。
  if (IMAGE_PATH_PATTERN.test(lookupPath) && isWorkspaceCanvasAssetPath(lookupPath)) {
    return {
      kind: "image",
      openPath: toDirectImageOpenPath(lookupPath),
      path: lookupPath,
      title: getFallbackTitle(lookupPath),
    }
  }

  const canvas = await lookups.resolveCanvasByPath(lookupPath)
  if (canvas) {
    return canvas
  }

  const document = await lookups.resolveDocumentByPath(lookupPath)
  if (document) {
    return document
  }

  const image = await lookups.resolveImageByPath(lookupPath)
  if (image) {
    return image
  }

  if (IMAGE_PATH_PATTERN.test(lookupPath)) {
    return {
      kind: "image",
      openPath: toDirectImageOpenPath(lookupPath),
      path: lookupPath,
      title: getFallbackTitle(lookupPath),
    }
  }

  return {
    kind: "file",
    path: trimmed,
    title: getFallbackTitle(trimmed),
  }
}
