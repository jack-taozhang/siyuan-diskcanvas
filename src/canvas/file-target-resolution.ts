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
 * 网盘文件节点。
 *
 * `path` 采用带协议前缀的形式：`nebula://<mount>/<path>`，
 * 这样它既能存进标准 JSON Canvas 的 `file` 字段（纯字符串，Obsidian 也能识别为外链），
 * 又能在解析时与思源文档路径 / 本地路径明确区分开、不会误判。
 */
export interface ResolvedCanvasNebulaTarget {
  /** 挂载点名，对应 NebulaDisk 的 mount */
  mount: string
  /** 挂载点内的相对路径，例如 /design/wireframe.png */
  nebulaPath: string
  kind: "nebula"
  /** 原样存储的 nebula:// 地址 */
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
  | ResolvedCanvasNebulaTarget
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

/** 网盘文件协议前缀。形如 nebula://media/design/wireframe.png */
export const NEBULA_SCHEME = "nebula://"

/** 把 mount + 路径组装成 nebula:// 地址 */
export function buildNebulaUri(mount: string, nebulaPath: string): string {
  const cleanMount = mount.trim().replace(/^\/+|\/+$/g, "")
  const cleanPath = nebulaPath.trim().replace(/^\/+/, "")
  return `${NEBULA_SCHEME}${cleanMount}/${cleanPath}`
}

/**
 * 解析 nebula:// 地址。
 * 容错：mount 与路径之间允许缺斜杠、允许多重斜杠、允许 mount 为空。
 */
export function parseNebulaUri(uri: string): { mount: string, nebulaPath: string } | null {
  const trimmed = uri.trim()
  if (!trimmed.toLowerCase().startsWith(NEBULA_SCHEME)) {
    return null
  }

  const rest = trimmed.slice(NEBULA_SCHEME.length)
  const slash = rest.indexOf("/")
  if (slash < 0) {
    // 只有 mount，没有路径 —— 视为非法（没有文件名无法建卡片）
    return null
  }

  const mount = rest.slice(0, slash).trim()
  const nebulaPath = "/" + rest.slice(slash + 1).replace(/^\/+/, "")
  if (!mount || nebulaPath === "/") {
    return null
  }

  return { mount, nebulaPath }
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

  // 网盘文件：nebula://<mount>/<path>。必须最先判断 ——
  // 否则会被后面的路径分支当成普通文件 fallback 掉。
  const nebula = parseNebulaUri(trimmed)
  if (nebula) {
    return {
      kind: "nebula",
      mount: nebula.mount,
      nebulaPath: nebula.nebulaPath,
      path: trimmed,
      title: getFallbackTitle(nebula.nebulaPath),
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
