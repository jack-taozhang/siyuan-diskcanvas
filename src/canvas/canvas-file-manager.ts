/**
 * 画布文件管理：枚举、重命名、复制、删除 —— 以及 ★重命名时"链接不丢"★。
 * ============================================================================
 *
 * 用户需求（原话）：
 *   「在编辑工具栏「独立打开」按钮右边，增加一个所有画布文件的管理窗口，
 *     其中重命名要求之前的链接不丢失。」
 *
 * ---------------------------------------------------------------------------
 * 「之前链接」指什么（盘点过，共四类）
 * ---------------------------------------------------------------------------
 *   ① **笔记正文里的画布嵌入块**：围栏块体是 JSON，`path` 字段存的就是画布路径
 *      （`;;; <插件名>/canvas` + `{"path":"…"}`）。改名后不改它 ⇒ 嵌入块指向不存在的文件。
 *   ② **别的画布文件**：嵌套画布节点（file 节点指向 `.canvas`）与链接节点，同样存的是路径。
 *   ③ 插件自己的**最近文件列表**（弱链接，但不清就是死链）。
 *   ④ 当前打开的页签（`state.filePath`）—— 这条由宿主流程自己更新。
 *
 *   本模块负责 ①②③。做法是**同一个纯函数**处理两类文本
 *   （笔记块的 markdown / .canvas 的 JSON），保证不会出现"一处换了一处没换"。
 *
 * ---------------------------------------------------------------------------
 * 为什么先改名、再补链接
 * ---------------------------------------------------------------------------
 *   文件是本体的主体，链接是附属。先落文件再补引用：即使补链接中途失败，
 *   用户拿到的仍是"文件已改名 + 少数引用待修"，而不是"文件没了"。
 */

/* ──────────────────────────────────────────────────────────────
 * 纯函数部分
 * ────────────────────────────────────────────────────────────── */

/**
 * 把文本里的**画布路径**从旧路径替换成新路径。
 *
 * ★ 为什么用"整段路径"匹配而不是正则替换文件名 ★
 *   路径里含 `/`、中文、可能的 `.` —— 拼正则极易漏转义。而这里我们只做**字面量**替换，
 *   用 `split(old).join(new)` 一次到位，语义最直白（也踩过一次：正则里 `\` 被 shell 吃掉）。
 *
 * ★ 为什么要保证"后面不是路径字符" ★
 *   防的是**前缀误伤**：`a.canvas` 改名为 `b.canvas` 时，
 *   `a.canvas.bak` 里的 `a.canvas` 不该被替换。所以命中后要求
 *   下一个字符不是 `/`、`-`、`_`、字母、数字、点。
 *
 * @returns 替换后的文本；没有命中时**原样返回**（调用方据此判断"要改吗"）
 */
export function replaceCanvasPathInText(text: string, oldPath: string, newPath: string): string {
  if (!text || !oldPath || !newPath || oldPath === newPath) {
    return text
  }

  let result = ""
  let cursor = 0
  let hit = false

  while (cursor <= text.length) {
    const at = text.indexOf(oldPath, cursor)
    if (at < 0) {
      break
    }

    const after = text[at + oldPath.length] ?? ""
    // 前缀误伤保护：后面紧跟路径延续字符时，不算命中
    const isPrefixOfLongerPath = /[\w./\\-]/.test(after)
    if (isPrefixOfLongerPath) {
      result += text.slice(cursor, at + oldPath.length)
      cursor = at + oldPath.length
      continue
    }

    result += text.slice(cursor, at) + newPath
    cursor = at + oldPath.length
    hit = true
  }

  return hit ? result + text.slice(cursor) : text
}

/** 文本里是否引用了该画布路径（与上面的替换规则严格一致） */
export function referencesCanvasPath(text: string, path: string): boolean {
  return replaceCanvasPathInText(text, path, "\u0000sentinel\u0000") !== text
}

/**
 * ★ 目录改名的引用更新：把 `旧目录/` 前缀换成 `新目录/` ★
 *
 * 为什么不能直接用 `replaceCanvasPathInText`：
 *   那个函数带"前缀误伤保护"——命中后面若紧跟 `/`（路径延续字符）就**不算命中**。
 *   目录前缀后面必然紧跟 `/`（`<目录>/a.canvas`），所以那两个函数语义正相反、不能混用。
 *
 * 判据：命中 `oldDir/` 即替换（后面是什么都无所谓，因为它已经包含了分隔符）。
 */
export function replaceCanvasPathPrefixInText(text: string, oldDir: string, newDir: string): string {
  const from = `${String(oldDir || "").replace(/\/+$/, "")}/`
  const to = `${String(newDir || "").replace(/\/+$/, "")}/`
  if (!text || !oldDir || !newDir || from === to || !text.includes(from)) {
    return text
  }
  return text.split(from).join(to)
}

/* ──────────────────────────────────────────────────────────────
 * 目录树
 * ────────────────────────────────────────────────────────────── */

export interface CanvasTreeNode {
  name: string
  path: string
  isDir: boolean
  updated: number
  /** 该节点下（含自身）的 `.canvas` 数量 —— 界面上给文件夹标注用 */
  canvasCount: number
  children: CanvasTreeNode[]
}

/**
 * 递归列出画布目录树（文件夹 + `.canvas`）。
 *
 * ★ 为什么保留**空文件夹** ★
 *   这是"管理窗口"：用户刚新建的文件夹必须立刻看得见（否则会以为没建成功），
 *   所以不能像"文件选择器"那样只保留含画布的分支。
 *   代价是扫描时多遍历几个目录 —— 根目录是 petal 与默认目录，量很小。
 *
 * @param options.depthLimit 防御性上限（避免异常深的目录把界面拖垮）。
 *   语义 = **最多列举几层目录**，根目录记为第 1 层（`1` ⇒ 只列根目录下的直接子项）。
 */
export async function listCanvasTree(
  roots: string[],
  readDir: CanvasFileManagerDeps["readDir"],
  options: { depthLimit?: number, maxNodes?: number } = {},
): Promise<CanvasTreeNode[]> {
  const depthLimit = options.depthLimit ?? 8
  const maxNodes = options.maxNodes ?? 4000
  let nodeCount = 0

  async function walk(dirPath: string, depth: number): Promise<CanvasTreeNode[]> {
    if (depth > depthLimit || nodeCount >= maxNodes) {
      return []
    }

    let entries: Array<{ isDir: boolean, name: string, updated?: number }> | null = null
    try {
      entries = await readDir(dirPath)
    } catch {
      return []
    }
    if (!Array.isArray(entries)) {
      return []
    }

    const nodes: CanvasTreeNode[] = []
    for (const entry of entries) {
      if (nodeCount >= maxNodes) {
        break
      }
      const fullPath = `${dirPath}/${entry.name}`
      if (entry.isDir) {
        const children = await walk(fullPath, depth + 1)
        nodeCount += 1
        nodes.push({
          canvasCount: children.reduce((sum, child) => sum + child.canvasCount, 0),
          children,
          isDir: true,
          name: entry.name,
          path: fullPath,
          updated: typeof entry.updated === "number" ? entry.updated : 0,
        })
        continue
      }
      if (!entry.name.toLowerCase().endsWith(".canvas")) {
        continue
      }
      nodeCount += 1
      nodes.push({
        canvasCount: 1,
        children: [],
        isDir: false,
        name: entry.name,
        path: fullPath,
        updated: typeof entry.updated === "number" ? entry.updated : 0,
      })
    }

    // 目录在前、文件在后；各自按名称排序（中文按拼音）
    return nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) {
        return a.isDir ? -1 : 1
      }
      return a.name.localeCompare(b.name, "zh-Hans-CN")
    })
  }

  const roots2: CanvasTreeNode[] = []
  for (const root of roots) {
    const children = await walk(root, 1)
    if (children.length > 0) {
      roots2.push({
        canvasCount: children.reduce((sum, child) => sum + child.canvasCount, 0),
        children,
        isDir: true,
        name: root.split("/").filter(Boolean).pop() || root,
        path: root,
        updated: 0,
      })
    }
  }
  return roots2
}

/* ──────────────────────────────────────────────────────────────
 * 目录操作（含"文件夹改名后里面的画布链接也不丢"）
 * ────────────────────────────────────────────────────────────── */

/** 递归复制一个目录（保留内部结构；已知是文本文件，按文本搬运） */
export async function copyCanvasDirectory(
  deps: CanvasFileManagerDeps,
  fromDir: string,
  toDir: string,
): Promise<number> {
  let copied = 0

  async function walk(sourceDir: string, targetDir: string): Promise<void> {
    let entries: Array<{ isDir: boolean, name: string }> | null = null
    try {
      entries = await deps.readDir(sourceDir)
    } catch {
      return
    }
    if (!Array.isArray(entries)) {
      return
    }

    await deps.createDir(targetDir)
    for (const entry of entries) {
      const sourcePath = `${sourceDir}/${entry.name}`
      const targetPath = `${targetDir}/${entry.name}`
      if (entry.isDir) {
        await walk(sourcePath, targetPath)
        continue
      }
      const text = await deps.readText(sourcePath)
      if (text === null) {
        continue
      }
      await deps.writeText(targetPath, text)
      copied += 1
    }
  }

  await walk(fromDir, toDir)
  return copied
}

/**
 * ★ 修正**副本内部**指向原目录的自引用 ★
 *
 * 场景：把 `项目A/` 整个复制成 `项目A 副本/`。
 *   `项目A/子.canvas` 里若有嵌套画布节点指向 `/…/项目A/子.canvas`，
 *   复制出来的 `项目A 副本/子.canvas` **仍指向原目录** —— 打开副本看到的
 *   是原目录的内容，改副本等于改原件（典型的"复制了个寂寞"）。
 *
 * ★ 为什么不能复用 `relinkCanvasPathPrefix` ★
 *   那是**全局**替换（连笔记引用一起改）。复制场景下绝对不能动原目录的引用，
 *   只能在**副本范围内的文件里**做替换 —— 语义完全不同，所以单列一个函数。
 */
export async function rewriteCanvasPrefixInside(
  deps: CanvasFileManagerDeps,
  dir: string,
  fromPrefix: string,
  toPrefix: string,
): Promise<number> {
  const files = await listCanvasFiles([dir], deps.readDir)
  let rewritten = 0
  for (const file of files) {
    try {
      const text = await deps.readText(file.path)
      if (!text) {
        continue
      }
      const next = replaceCanvasPathPrefixInText(text, fromPrefix, toPrefix)
      if (next === text) {
        continue
      }
      await deps.writeText(file.path, next)
      rewritten += 1
    } catch {
      // 逐项 best-effort：某一个文件写不动，不影响其它副本
    }
  }
  return rewritten
}

export interface CanvasFolderRenameOutcome {
  ok: boolean
  error?: string
  newDir?: string
  copiedFiles?: number
  relink?: CanvasRelinkResult
}

/**
 * ★ 复制文件夹（副本内部的画布自引用一并改到副本目录）★
 *
 * 与 `renameCanvasFolderWithRelink` 的关键差别：
 *   改名可以"全局补引用"（旧目录已经不存在了，改哪儿都对）；
 *   **复制不能** —— 原目录还在、还被别人引用着，只能改**副本范围内**的文件。
 *   所以这里用 `rewriteCanvasPrefixInside`（范围限定）而不是 `relinkCanvasPathPrefix`（全局）。
 */
export async function duplicateCanvasFolder(
  deps: CanvasFileManagerDeps,
  options: {
    fromDir: string
    newBaseName: string
    existingPaths: Set<string>
  },
): Promise<CanvasFolderRenameOutcome> {
  const { fromDir, newBaseName } = options
  if (!isValidCanvasBaseName(newBaseName)) {
    return { error: "invalid-name", ok: false }
  }

  const parent = fromDir.substring(0, fromDir.lastIndexOf("/"))
  const targetDir = `${parent}/${String(newBaseName).trim()}`
  if (targetDir === fromDir) {
    return { error: "same-name", ok: false }
  }
  if (options.existingPaths.has(targetDir)) {
    return { error: "exists", ok: false }
  }

  let copiedFiles = 0
  try {
    copiedFiles = await copyCanvasDirectory(deps, fromDir, targetDir)
    await rewriteCanvasPrefixInside(deps, targetDir, fromDir, targetDir)
  } catch (error) {
    try {
      await deps.removeFile(targetDir)
    } catch { /* 回滚清理 best-effort */ }
    return { error: `write-failed: ${String(error)}`, ok: false }
  }

  return { copiedFiles, newDir: targetDir, ok: true }
}

/**
 * ★ 重命名文件夹，并把**里面的所有画布引用**一起改掉 ★
 *
 * 与单个文件改名的区别：这里影响的是**一整段路径前缀**，
 * 所以引用更新走 `relinkCanvasPathPrefix`（`旧目录/` → `新目录/`），
 * 一次把"指向前缀下任何文件"的引用全部改到（包括笔记里的嵌入块与其它画布里的嵌套引用）。
 *
 * 顺序同样是"**先把目录搬好，再补引用**"：搬目录失败就整体回滚（删掉半成品），
 * 补引用失败则如实上报但不回滚。
 */
export async function renameCanvasFolderWithRelink(
  deps: CanvasFileManagerDeps,
  options: {
    oldDir: string
    newBaseName: string
    existingPaths: Set<string>
    scanRoots: string[]
  },
): Promise<CanvasFolderRenameOutcome> {
  const { oldDir, newBaseName } = options
  if (!isValidCanvasBaseName(newBaseName)) {
    return { error: "invalid-name", ok: false }
  }

  const parent = oldDir.substring(0, oldDir.lastIndexOf("/"))
  const currentName = oldDir.substring(oldDir.lastIndexOf("/") + 1)
  const newDir = `${parent}/${String(newBaseName).trim()}`
  if (newDir === oldDir) {
    return { error: "same-name", ok: false }
  }
  if (options.existingPaths.has(newDir)) {
    return { error: "exists", ok: false }
  }
  void currentName

  let copiedFiles = 0
  try {
    copiedFiles = await copyCanvasDirectory(deps, oldDir, newDir)
  } catch (error) {
    try {
      await deps.removeFile(newDir)
    } catch { /* 回滚清理 best-effort */ }
    return { error: `write-failed: ${String(error)}`, ok: false }
  }

  try {
    await deps.removeFile(oldDir)
  } catch (error) {
    try {
      await deps.removeFile(newDir)
    } catch { /* 回滚清理 best-effort */ }
    return { error: `remove-failed: ${String(error)}`, ok: false }
  }

  const relink = await relinkCanvasPathPrefix(deps, {
    canvasRoots: options.scanRoots,
    newDir,
    oldDir,
  })

  return { copiedFiles, newDir, ok: true, relink }
}

/** 从目录树里收集所有 `.canvas` 路径 */
export function collectCanvasPathsFromTree(nodes: CanvasTreeNode[]): string[] {
  const paths: string[] = []
  const walk = (list: CanvasTreeNode[]) => {
    for (const node of list) {
      if (node.isDir) {
        walk(node.children)
      } else {
        paths.push(node.path)
      }
    }
  }
  walk(nodes)
  return paths
}


/** 由目录 + 新文件名拼出完整路径（去掉重复斜杠、强制 `.canvas` 后缀） */
export function buildCanvasFilePath(dirPath: string, baseName: string): string {
  const dir = String(dirPath || "").replace(/\/+$/, "")
  const base = String(baseName || "").trim().replace(/\.canvas$/i, "").trim()
  return `${dir}/${base}.canvas`
}

/** 校验新文件名（画布文件管理器用；非法输入直接拒绝而不是静默改名） */
export function isValidCanvasBaseName(baseName: string): boolean {
  const base = String(baseName || "").trim()
  if (!base) {
    return false
  }
  // 不允许路径分隔符与思源文件名非法字符
  return !/[/\\:*?"<>|]/.test(base)
}

/* ──────────────────────────────────────────────────────────────
 * IO 部分（依赖注入，便于单测）
 * ────────────────────────────────────────────────────────────── */

export interface CanvasFileEntryInfo {
  /** 文件名（含 .canvas） */
  name: string
  /** 完整工作区路径 */
  path: string
  /** 字节数（取不到时 0） */
  size: number
  /** 最后修改时间（秒；取不到时 0） */
  updated: number
}

export interface CanvasFileManagerDeps {
  readDir: (path: string) => Promise<Array<{ isDir: boolean, name: string, updated?: number }> | null>
  readText: (path: string) => Promise<string | null>
  writeText: (path: string, text: string) => Promise<unknown>
  /** 建目录（思源里就是 `putFile(path, isDir=true, 空 Blob)`） */
  createDir: (path: string) => Promise<unknown>
  removeFile: (path: string) => Promise<unknown>
  /** 笔记里含某段文本的块（SQL 查询，返回 `{id, markdown}`） */
  findBlocksReferencing: (needle: string) => Promise<Array<{ id: string, markdown: string }>>
  /** 用 markdown 覆盖一个块 */
  updateBlockMarkdown: (blockId: string, markdown: string) => Promise<unknown>
  showMessage: (message: string, timeout?: number, type?: "info" | "error") => void
}

/** 递归枚举若干根目录下的所有 `.canvas` 文件（去重、限量，避免把工作区扫穿） */
export async function listCanvasFiles(
  roots: string[],
  readDir: CanvasFileManagerDeps["readDir"],
  options: { maxFiles?: number } = {},
): Promise<CanvasFileEntryInfo[]> {
  const maxFiles = options.maxFiles ?? 2000
  const found: CanvasFileEntryInfo[] = []
  const seen = new Set<string>()
  const visitedDirs = new Set<string>()

  async function walk(dirPath: string): Promise<void> {
    if (found.length >= maxFiles || visitedDirs.has(dirPath)) {
      return
    }
    visitedDirs.add(dirPath)

    let entries: Array<{ isDir: boolean, name: string, updated?: number }> | null = null
    try {
      entries = await readDir(dirPath)
    } catch {
      return
    }
    if (!Array.isArray(entries)) {
      return
    }

    for (const entry of entries) {
      if (found.length >= maxFiles) {
        return
      }
      const fullPath = `${dirPath}/${entry.name}`
      if (entry.isDir) {
        await walk(fullPath)
        continue
      }
      if (!entry.name.toLowerCase().endsWith(".canvas") || seen.has(fullPath)) {
        continue
      }
      seen.add(fullPath)
      found.push({
        name: entry.name,
        path: fullPath,
        size: 0,
        updated: typeof entry.updated === "number" ? entry.updated : 0,
      })
    }
  }

  for (const root of roots) {
    await walk(root)
  }

  return found.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))
}

export interface CanvasRelinkResult {
  /** 更新过的笔记块数量 */
  updatedBlocks: number
  /** 更新过的画布文件数量（含被改名的那个之外的其它画布） */
  updatedCanvases: number
  /** 失败项（人类可读） */
  failures: string[]
}

/**
 * ★ 目录改名的引用更新：`旧目录/` → `新目录/`（文件夹里所有画布一次性处理）★
 *
 * 与 `relinkCanvasReferences` 的区别只在替换规则（前缀 vs 整路径），
 * 扫描/写回流程完全一致 —— 所以两者共用下面的 `relinkWith`。
 */
export async function relinkCanvasPathPrefix(
  deps: CanvasFileManagerDeps,
  options: { oldDir: string, newDir: string, canvasRoots: string[] },
): Promise<CanvasRelinkResult> {
  return relinkWith(deps, {
    canvasRoots: options.canvasRoots,
    needle: options.oldDir,
    replace: (text) => replaceCanvasPathPrefixInText(text, options.oldDir, options.newDir),
  })
}

/**
 * 两类重命名的公共流程：**找引用 → 逐项替换 → 逐项写回**。
 *
 * ★ 为什么不把"替换规则"也塞进依赖里 ★
 *   规则是纯函数（可单测），IO 才是依赖。分开后，单测只需要换掉 IO，
 *   不必去假装一个"替换器"。
 */
async function relinkWith(
  deps: CanvasFileManagerDeps,
  options: {
    canvasRoots: string[]
    needle: string
    replace: (text: string) => string
  },
): Promise<CanvasRelinkResult> {
  const result: CanvasRelinkResult = { updatedBlocks: 0, updatedCanvases: 0, failures: [] }

  /* ① 笔记里的引用 */
  let blocks: Array<{ id: string, markdown: string }> = []
  try {
    blocks = await deps.findBlocksReferencing(options.needle)
  } catch (error) {
    result.failures.push(`查找笔记引用失败：${String(error)}`)
  }

  for (const block of blocks) {
    const next = options.replace(block.markdown)
    if (next === block.markdown) {
      continue
    }
    try {
      await deps.updateBlockMarkdown(block.id, next)
      result.updatedBlocks += 1
    } catch (error) {
      result.failures.push(`块 ${block.id} 更新失败：${String(error)}`)
    }
  }

  /* ② 画布文件里的引用 */
  let canvases: CanvasFileEntryInfo[] = []
  try {
    canvases = await listCanvasFiles(options.canvasRoots, deps.readDir)
  } catch (error) {
    result.failures.push(`枚举画布文件失败：${String(error)}`)
  }

  for (const canvas of canvases) {
    try {
      const text = await deps.readText(canvas.path)
      if (!text) {
        continue
      }
      const next = options.replace(text)
      if (next === text) {
        continue
      }
      await deps.writeText(canvas.path, next)
      result.updatedCanvases += 1
    } catch (error) {
      result.failures.push(`画布 ${canvas.path} 更新失败：${String(error)}`)
    }
  }

  return result
}

/**
 * 把一个画布的被引用路径从 `oldPath` 改成 `newPath`（"链接不丢"的核心）。
 */
export async function relinkCanvasReferences(
  deps: CanvasFileManagerDeps,
  options: {
    oldPath: string
    newPath: string
    /** 参与扫描的画布目录（重命名之后调用） */
    canvasRoots: string[]
  },
): Promise<CanvasRelinkResult> {
  return relinkWith(deps, {
    canvasRoots: options.canvasRoots,
    needle: options.oldPath,
    replace: (text) => replaceCanvasPathInText(text, options.oldPath, options.newPath),
  })
}
