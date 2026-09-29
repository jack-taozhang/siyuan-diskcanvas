import type { IProtyle } from "siyuan"

import { cleanupSlashText } from "@/canvas/slash-cleanup"

export interface CanvasEmbedCommandMessages {
  insertCanvasEmbedFailed: string
  insertCanvasEmbedNoDocument: string
  insertCanvasEmbedSuccess: string
  insertCanvasLinkFailed: string
  insertCanvasLinkSuccess: string
  messageUnableOpenCanvasFile: string
}

export interface CanvasEmbedTargetOptions {
  commandProtyle?: IProtyle | null
  getAllEditor?: () => Array<{ protyle?: IProtyle | null }>
  lastActiveProtyle?: IProtyle | null
  targetBlockId?: string | null
  targetNodeElement?: HTMLElement | null
}

export interface CanvasEmbedTargetLocation {
  docId: string
  /**
   * 插到该块**之前**（内核 `nextID` 语义）。
   *
   * ★ 2026-09-28：从 previousBlockId 改为 nextBlockId ★
   *   用户要求「/功能 插入块到该行」。内核实测语义：
   *     `{parentID, previousID}` ⇒ 插到 previousID **之后**
   *     `{parentID, nextID}`     ⇒ 插到 nextID **之前**
   *   取 nextID = 光标块 ⇒ 块落在光标那一行；随后 cleanupSlashText
   *   把用户敲的 `/过滤词` 块删掉，嵌入块正好占住原来那一行。
   *   （旧实现传 previousID ⇒ 落到光标块下面，正是本次要修的行为。）
   *
   * 下面的发现逻辑是「找光标所在的块」，与语义无关，故未改动。
   */
  nextBlockId?: string
}

export interface RunCanvasEmbedCommandOptions extends CanvasEmbedTargetOptions {
  canvasPath?: string | null
  mode?: "preview" | "link"
  debugLog: (message: string, payload: Record<string, unknown>) => void
  getFileText: (path: string) => Promise<string>
  getWorkspaceDir: () => Promise<string | undefined>
  /**
   * 斜杠菜单入口标志。
   *
   * ★ 只有斜杠入口才需要清理 `/过滤词` ★
   *   侧边栏 / 预览页 / 拖拽插入都没有这个残留，清理反而会误删用户正文。
   */
  fromSlash?: boolean
  /**
   * 斜杠菜单交给插件的「光标所在块元素」（`callback(protyle, nodeElement)` 的第 2 参）。
   * 清理残留需要它来定位块 id 与文本。
   */
  anchorEl?: HTMLElement | null
  insertCanvasEmbed: (options: {
    canvasPath: string
    canvasRaw: string
    parentBlockId: string
    nextBlockId?: string
  }) => Promise<string | undefined | null>
  insertCanvasLink?: (options: {
    canvasPath: string
    parentBlockId: string
    nextBlockId?: string
  }) => Promise<string | undefined | null>
  messages: CanvasEmbedCommandMessages
  showMessage: (message: string, timeout?: number, type?: string) => void
}

export async function normalizeCanvasEmbedPath(
  path?: string | null,
  getWorkspaceDir?: () => Promise<string | undefined>,
): Promise<string> {
  if (!path || typeof path !== "string") {
    return ""
  }
  let canvasPath = path.trim().replace(/^["']|["']$/g, '')
  if (!canvasPath) {
    return ""
  }

  if (!/^[a-zA-Z]:[/\\]/.test(canvasPath)) {
    return canvasPath
  }

  try {
    const workspaceDir = await getWorkspaceDir?.()
    if (!workspaceDir) {
      return canvasPath
    }

    const normalizedWorkspace = workspaceDir.replace(/\\/g, '/').replace(/\/+$/, '')
    const normalizedPath = canvasPath.replace(/\\/g, '/')
    if (normalizedPath.toLowerCase().startsWith(normalizedWorkspace.toLowerCase())) {
      canvasPath = normalizedPath.slice(normalizedWorkspace.length)
      if (!canvasPath.startsWith('/')) {
        canvasPath = `/${canvasPath}`
      }
    }
  } catch {
    return canvasPath
  }

  return canvasPath
}

export function getProtyleRootId(protyle?: IProtyle | null): string {
  return protyle?.block?.rootID
    || protyle?.block?.id
    || protyle?.element?.querySelector<HTMLElement>(".protyle-wysiwyg[data-node-id]")?.getAttribute("data-node-id")
    || ""
}

export function resolveCanvasEmbedTargetDocumentId(options: CanvasEmbedTargetOptions): string {
  const fromCommand = getProtyleRootId(options.commandProtyle)
  if (fromCommand) {
    return fromCommand
  }

  if (options.targetNodeElement) {
    const wysiwygDoc = options.targetNodeElement.closest<HTMLElement>(".protyle-wysiwyg[data-node-id]")
    const rootId = wysiwygDoc?.getAttribute("data-node-id")
    if (rootId) {
      return rootId
    }
  }

  const fromLastActive = getProtyleRootId(options.lastActiveProtyle)
  if (fromLastActive) {
    return fromLastActive
  }

  const fromEditorList = options.getAllEditor?.()
    ?.map(editor => getProtyleRootId(editor.protyle))
    .find(Boolean)
  if (fromEditorList) {
    return fromEditorList
  }

  const wysiwyg = document.querySelector<HTMLElement>(".protyle-wysiwyg[data-node-id]")
  const fromWysiwyg = wysiwyg?.getAttribute("data-node-id")
  if (fromWysiwyg) {
    return fromWysiwyg
  }

  const docRoot = document.querySelector<HTMLElement>(".protyle-wysiwyg [data-node-id][data-type='NodeDocument']")
  return docRoot?.getAttribute("data-node-id") || ""
}

export function resolveCanvasEmbedTargetLocation(options: CanvasEmbedTargetOptions): CanvasEmbedTargetLocation {
  let nextBlockId: string | undefined = options.targetBlockId || undefined

  if (!nextBlockId && options.targetNodeElement) {
    const blockId = options.targetNodeElement.getAttribute("data-node-id")
    if (blockId && options.targetNodeElement.getAttribute("data-type") !== "NodeDocument") {
      nextBlockId = blockId
    }
  }

  if (!nextBlockId && typeof window !== "undefined" && typeof document !== "undefined") {
    const selection = window.getSelection?.()
    if (selection && selection.rangeCount > 0) {
      const anchorNode = selection.anchorNode
      const element = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement
      const block = element?.closest<HTMLElement>(".protyle-wysiwyg [data-node-id]")
      if (block && block.getAttribute("data-type") !== "NodeDocument") {
        nextBlockId = block.getAttribute("data-node-id") || undefined
      }
    }

    if (!nextBlockId) {
      const activeBlock = document.activeElement?.closest<HTMLElement>(".protyle-wysiwyg [data-node-id]")
      if (activeBlock && activeBlock.getAttribute("data-type") !== "NodeDocument") {
        nextBlockId = activeBlock.getAttribute("data-node-id") || undefined
      }
    }

    if (!nextBlockId) {
      const selectedBlock = document.querySelector<HTMLElement>(".protyle-wysiwyg .protyle-wysiwyg--select[data-node-id]")
      if (selectedBlock && selectedBlock.getAttribute("data-type") !== "NodeDocument") {
        nextBlockId = selectedBlock.getAttribute("data-node-id") || undefined
      }
    }
  }

  if (!nextBlockId) {
    const cmdBlockId = options.commandProtyle?.block?.id
    const cmdRootId = options.commandProtyle?.block?.rootID
    if (cmdBlockId && cmdBlockId !== cmdRootId) {
      nextBlockId = cmdBlockId
    } else {
      const lastBlockId = options.lastActiveProtyle?.block?.id
      const lastRootId = options.lastActiveProtyle?.block?.rootID
      if (lastBlockId && lastBlockId !== lastRootId) {
        nextBlockId = lastBlockId
      }
    }
  }

  const docId = resolveCanvasEmbedTargetDocumentId(options)
  return { docId, nextBlockId }
}

/**
 * 插入成功之后清理斜杠菜单残留（用户敲的 `/过滤词`）。
 *
 * ★ 两个「只在这里做」的理由 ★
 *   1. **只在斜杠入口做**：侧边栏 / 预览页 / 拖拽插入都没有 `/过滤词` 残留，
 *      对它们执行清理会误删用户正文。
 *   2. **只在插入成功之后做**：万一插入失败，用户至少还能看着 `/xxx` 重试；
 *      若先清残留再插块，一旦失败就是"残留没了、块也没插上"，
 *      用户对着一片空白无从下手。
 */
async function cleanupSlashResidue(
  options: Pick<RunCanvasEmbedCommandOptions, "anchorEl" | "debugLog" | "fromSlash">,
): Promise<void> {
  if (!options.fromSlash || !options.anchorEl) {
    return
  }

  try {
    const cleaned = await cleanupSlashText(options.anchorEl)
    options.debugLog("slash residue cleanup", { cleaned })
  } catch (error) {
    // 清理失败不应让「插入其实成功了」这件事变成失败
    options.debugLog("slash residue cleanup failed", { error })
  }
}

export async function runCanvasEmbedCommand(options: RunCanvasEmbedCommandOptions): Promise<string | undefined> {
  const canvasPath = await normalizeCanvasEmbedPath(options.canvasPath, options.getWorkspaceDir)
  if (!canvasPath) {
    return undefined
  }

  const mode = options.mode ?? "preview"

  try {
    const { docId, nextBlockId } = resolveCanvasEmbedTargetLocation(options)
    if (!docId) {
      options.debugLog("no target document found", {
        activeElement: document.activeElement?.className,
        canvasPath,
        editorCount: options.getAllEditor?.()?.length ?? 0,
        hasCommandProtyle: Boolean(options.commandProtyle),
        hasLastActiveProtyle: Boolean(options.lastActiveProtyle),
        protyleCount: document.querySelectorAll(".protyle").length,
        wysiwygCount: document.querySelectorAll(".protyle-wysiwyg").length,
      })
      options.showMessage(options.messages.insertCanvasEmbedNoDocument, 4000, "warning")
      return undefined
    }

    if (mode === "link") {
      if (options.insertCanvasLink) {
        const blockId = await options.insertCanvasLink({
          canvasPath,
          parentBlockId: docId,
          nextBlockId,
        })
        if (blockId) {
          await cleanupSlashResidue(options)
          options.showMessage(options.messages.insertCanvasLinkSuccess, 3000)
          return blockId
        }
      }
      options.showMessage(options.messages.insertCanvasLinkFailed, 4000, "error")
      return undefined
    }

    const rawStr = await options.getFileText(canvasPath)
    if (!rawStr) {
      options.debugLog("unable to read canvas file", { canvasPath })
      options.showMessage(options.messages.messageUnableOpenCanvasFile, 4000, "error")
      return undefined
    }

    const blockId = await options.insertCanvasEmbed({
      canvasPath,
      canvasRaw: rawStr,
      parentBlockId: docId,
      nextBlockId,
    })
    if (blockId) {
      await cleanupSlashResidue(options)
      options.showMessage(options.messages.insertCanvasEmbedSuccess, 3000)
      return blockId
    }

    options.showMessage(options.messages.insertCanvasEmbedFailed, 4000, "error")
  } catch (error) {
    options.debugLog("insert failed", { canvasPath, error, mode })
    if (mode === "link") {
      options.showMessage(options.messages.insertCanvasLinkFailed, 4000, "error")
    } else {
      options.showMessage(options.messages.insertCanvasEmbedFailed, 4000, "error")
    }
  }

  return undefined
}
