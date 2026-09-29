/**
 * 画布文件管理的**实际动作**：把 `canvas-file-manager.ts` 的纯逻辑接到内核 API 上。
 * ============================================================================
 *
 * 与纯逻辑分开的理由：那边可以单测（不碰网络），这边只有"接线"，
 * 出问题时看一眼就知道是接口用错了还是逻辑错了。
 */

import { getFileText, putFile, readDir, removeFile, sql, updateBlock } from "@/api"
import type {
  CanvasFileEntryInfo,
  CanvasFileManagerDeps,
  CanvasRelinkResult,
} from "@/canvas/canvas-file-manager"
import {
  buildCanvasFilePath,
  isValidCanvasBaseName,
  listCanvasFiles,
  relinkCanvasPathPrefix,
  relinkCanvasReferences,
} from "@/canvas/canvas-file-manager"

/**
 * 枚举画布的根目录。
 *
 * ★ 第 33 轮改动：默认目录**优先**，不再无条件带上 `petal` 根 ★
 *
 * 用户要求：「文件管理 默认目录为 默认画布目录」。
 *
 * 原实现恒把 `/data/storage/petal` 当第一个根，于是窗口打开后满屏都是
 * **别的插件的存储目录**（网盘、其它插件的 petal…），用户的画布被埋在中间，
 * 每次都得手动找。现在：
 *   1. 有默认目录 ⇒ **只列默认目录**（它本身就是"我的画布"这一棵子树，
 *      且默认目录实测就在 petal 下，再挂 petal 根只会往里塞噪声）。
 *   2. 没有默认目录（理论上不该发生，首次安装尚未落盘时会）⇒ 退回 petal 根，
 *      至少不是空白窗口。
 *
 * ★ 这个方法还有第二个消费方 ★
 *   `CanvasWorkspace.onManagerReload` 用它给"最近文件死链清理"**划定范围**，
 *   避免拿枚举结果去判断扫描范围之外的文件是否存在。
 *   范围收窄后这个语义更准（只清理默认目录内的死链），不会误伤。
 */
export function resolveCanvasScanRoots(defaultDirectory?: string): string[] {
  const normalized = String(defaultDirectory || "").trim().replace(/\/+$/, "")
  if (normalized) {
    return [normalized]
  }
  return ["/data/storage/petal"]
}

/** 用 SQL 找"正文里提到了这个路径"的块（嵌入块、链接、纯文本引用都算） */
async function findBlocksReferencing(needle: string): Promise<Array<{ id: string, markdown: string }>> {
  /**
   * ★ SQL 里只做粗筛，精确判定回到 JS ★
   *   路径里的 `%` / `_` 在 LIKE 里是通配符，转义规则又不统一；
   *   与其在 SQL 里拼转义，不如让它多返回几条，再用 `replaceCanvasPathInText`
   *   的正则（含"前缀误伤保护"）做最终裁决 —— 与替换逻辑**同一个函数**，不会两套规则。
   */
  const escaped = String(needle).replaceAll("'", "''")
  const rows = await sql(`select id, markdown from blocks where markdown like '%${escaped}%'`)
  if (!Array.isArray(rows)) {
    return []
  }
  /**
   * ★ 这里只做**纯子串**过滤，不做"替换后是否变化"的判定 ★
   *   因为两类重命名用的替换规则不同：文件改名走"整路径 + 前缀误伤保护"，
   *   目录改名走"前缀替换"。若在这里写死一种规则，另一种就会被漏掉。
   *   判定交给各自的 `replace`（无变化时它们会原样返回，不会误写盘）。
   */
  return rows
    .map((row) => ({
      id: String((row as { id?: unknown }).id || ""),
      markdown: String((row as { markdown?: unknown }).markdown || ""),
    }))
    .filter((row) => row.id && row.markdown.includes(needle))
}

/** 把依赖接到内核 API 上 */
export function createCanvasFileDeps(showMessage: CanvasFileManagerDeps["showMessage"]): CanvasFileManagerDeps {
  return {
    findBlocksReferencing,
    createDir: async (path) => putFile(path, true, new Blob([])),
    readDir: async (path) => readDir(path) as Promise<Array<{ isDir: boolean, name: string, updated?: number }> | null>,
    readText: getFileText,
    removeFile,
    showMessage,
    updateBlockMarkdown: async (blockId, markdown) => updateBlock("markdown", markdown, blockId),
    writeText: async (path, text) => putFile(path, false, new Blob([text], { type: "application/json" })),
  }
}

/** 列出工作区里的所有画布文件 */
export async function listAllCanvasFiles(
  deps: CanvasFileManagerDeps,
  defaultDirectory?: string,
): Promise<CanvasFileEntryInfo[]> {
  return listCanvasFiles(resolveCanvasScanRoots(defaultDirectory), deps.readDir)
}

/**
 * 探测一个工作区文件是否还存在。
 *
 * @returns `true` 存在 / `false` **确证**不存在 / `null` 未知（网络或内核异常）
 *
 * ★★ 内核"文件不存在"的返回是 **HTTP 202 + body `{"code":404}`**，不是 404 ★★
 *   实测（SiYuan 3.8.5，NAS，浏览器内带 cookie 请求 `/api/file/getFile`）：
 *     · 存在   → `200` + 文件内容
 *     · 不存在 → `202` + `{"code":404,"msg":"open …: no such file or directory"}`
 *     · 是目录 → `202` + `{"code":409,"msg":"path is a directory"}`
 *   所以**只看 HTTP 状态码会把"不存在"误判成"未知"**（202 不是 200 也不是 404），
 *   必须再读 body 里的 `code`。
 *
 * ★ 为什么只信 `code === 404` ★
 *   其余情况（500、超时、非 JSON）一律返回"未知"，让调用方保守处理 ——
 *   一次网络抖动不能把用户的"最近文件"清空。
 */
export async function probeWorkspaceFileExists(path: string): Promise<boolean | null> {
  try {
    const response = await fetch("/api/file/getFile", {
      body: JSON.stringify({ path }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    if (response.status === 200) {
      return true
    }
    const body = await response.text()
    try {
      const parsed = JSON.parse(body) as { code?: unknown }
      if (parsed && parsed.code === 404) {
        return false
      }
    } catch {
      // body 不是 JSON ⇒ 未知
    }
    return null
  } catch {
    return null
  }
}

/** 挑出"确证已不存在"的路径（未知的一律保留） */
export async function findMissingWorkspacePaths(paths: string[]): Promise<string[]> {
  const missing: string[] = []
  for (const path of paths) {
    if (!path) {
      continue
    }
    if (await probeWorkspaceFileExists(path) === false) {
      missing.push(path)
    }
  }
  return missing
}

/** 找一个不重名的画布路径（`xxx.canvas` → `xxx 2.canvas` → …） */
export async function findAvailableCanvasPath(
  deps: CanvasFileManagerDeps,
  dirPath: string,
  baseName: string,
  exists: (path: string) => boolean,
): Promise<string> {
  const first = buildCanvasFilePath(dirPath, baseName)
  if (!exists(first)) {
    return first
  }
  for (let index = 2; index <= 200; index += 1) {
    const candidate = buildCanvasFilePath(dirPath, `${baseName} ${index}`)
    if (!exists(candidate)) {
      return candidate
    }
  }
  // 退化：用时间戳兜底（几乎不可能走到）
  return buildCanvasFilePath(dirPath, `${baseName} ${Date.now()}`)
}

export interface CanvasRenameOutcome {
  ok: boolean
  error?: string
  newPath?: string
  relink?: CanvasRelinkResult
}

/**
 * ★ 重命名画布文件，并把引用一起改掉（"链接不丢"）★
 *
 * 顺序：**先落文件、再补引用**。
 *   补引用失败不会被当成"重命名失败" —— 文件已经改名成功，
 *   把失败项如实报给用户（"文件已改名，N 处引用待修"）比回滚更有用。
 */
export async function renameCanvasFileWithRelink(
  deps: CanvasFileManagerDeps,
  options: {
    oldPath: string
    newBaseName: string
    defaultDirectory?: string
    existingPaths: Set<string>
    /** 被引用的画布根目录（用于扫描"别的画布"里的引用） */
    scanRoots: string[]
  },
): Promise<CanvasRenameOutcome> {
  const { oldPath, newBaseName } = options
  if (!isValidCanvasBaseName(newBaseName)) {
    return { error: "invalid-name", ok: false }
  }

  const dir = oldPath.substring(0, oldPath.lastIndexOf("/"))
  const newPath = buildCanvasFilePath(dir, newBaseName)
  if (newPath === oldPath) {
    return { error: "same-name", ok: false }
  }
  if (options.existingPaths.has(newPath)) {
    return { error: "exists", ok: false }
  }

  /* ① 复制到新路径 → 删旧路径（先写后删，中途失败不会丢文件） */
  let content: string | null = null
  try {
    content = await deps.readText(oldPath)
  } catch (error) {
    return { error: `read-failed: ${String(error)}`, ok: false }
  }
  if (content === null) {
    return { error: "read-failed", ok: false }
  }

  try {
    await deps.writeText(newPath, content)
  } catch (error) {
    return { error: `write-failed: ${String(error)}`, ok: false }
  }

  try {
    await deps.removeFile(oldPath)
  } catch (error) {
    // 回滚：新文件删掉，保持"要么原名要么没改名"
    try {
      await deps.removeFile(newPath)
    } catch { /* 清理失败只能记录 */ }
    return { error: `remove-failed: ${String(error)}`, ok: false }
  }

  /* ② 补引用（失败不回滚，逐项上报） */
  const relink = await relinkCanvasReferences(deps, {
    canvasRoots: options.scanRoots,
    newPath,
    oldPath,
  })

  return { newPath, ok: true, relink }
}
