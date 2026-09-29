/**
 * 画布文件管理：路径替换 / 枚举 / 重命名补引用。
 *
 * 重点在 `replaceCanvasPathInText` —— 它是"改名后链接不丢"的唯一判定与替换入口，
 * 一旦它多替换（前缀误伤）或少替换（漏掉引用），用户就会丢链接，
 * 而**不会报任何错**。所以这里的用例刻意围绕边界来写。
 */

import { describe, expect, it, vi } from "vitest"

import {
  buildCanvasFilePath,
  collectCanvasPathsFromTree,
  duplicateCanvasFolder,
  isValidCanvasBaseName,
  listCanvasFiles,
  listCanvasTree,
  referencesCanvasPath,
  relinkCanvasReferences,
  renameCanvasFolderWithRelink,
  replaceCanvasPathInText,
  replaceCanvasPathPrefixInText,
  rewriteCanvasPrefixInside,
} from "@/canvas/canvas-file-manager"
import { resolveCanvasScanRoots } from "@/canvas/canvas-file-actions"

const OLD = "/data/storage/petal/siyuan-diskcanvas/长城.canvas"
const NEW = "/data/storage/petal/siyuan-diskcanvas/长江.canvas"

describe("replaceCanvasPathInText", () => {
  it("替换嵌入块 JSON 里的 path（真实载荷形态）", () => {
    const markdown = `;;; siyuan-diskcanvas/canvas\n{"path":"${OLD}","mode":"preview"}\n;;;`
    const next = replaceCanvasPathInText(markdown, OLD, NEW)
    expect(next).toContain(NEW)
    expect(next).not.toContain(OLD)
    // 其余部分一字不动
    expect(next).toContain('"mode":"preview"')
  })

  it("替换画布 JSON 里嵌套画布 / 链接节点的路径", () => {
    const json = JSON.stringify({
      edges: [],
      nodes: [
        { file: OLD, id: "n1", type: "file", x: 0, y: 0 },
        { file: "https://example.com/a.canvas", id: "n2", type: "link", x: 0, y: 0 },
      ],
    })
    const next = replaceCanvasPathInText(json, OLD, NEW)
    expect(next).toContain(NEW)
    expect(next).not.toContain(OLD)
    // 别的链接不受影响
    expect(next).toContain("https://example.com/a.canvas")
  })

  it("同一段文本里出现多次时全部替换", () => {
    const text = `${OLD} 和 ${OLD}`
    expect(replaceCanvasPathInText(text, OLD, NEW)).toBe(`${NEW} 和 ${NEW}`)
  })

  it("★ 前缀误伤保护：`a.canvas` 改名不应动到 `a.canvas.bak` ★", () => {
    const shorter = "/data/x/a.canvas"
    const text = "see /data/x/a.canvas.bak and /data/x/a.canvas here"
    const next = replaceCanvasPathInText(text, shorter, "/data/x/b.canvas")
    expect(next).toContain("/data/x/a.canvas.bak")
    expect(next).toContain("/data/x/b.canvas here")
  })

  it("路径后紧跟路径延续字符（`-` `_` 字母数字）时不算命中", () => {
    expect(replaceCanvasPathInText("/d/x.canvas-old", "/d/x.canvas", "/d/y.canvas")).toBe("/d/x.canvas-old")
    expect(replaceCanvasPathInText("/d/x.canvas_2", "/d/x.canvas", "/d/y.canvas")).toBe("/d/x.canvas_2")
    // 但紧跟引号 / 空白 / 逗号时**要**替换（JSON、markdown 里都是这种）
    expect(replaceCanvasPathInText('"/d/x.canvas"', "/d/x.canvas", "/d/y.canvas")).toBe('"/d/y.canvas"')
  })

  it("没命中就原样返回（调用方靠这个判断要不要写盘）", () => {
    const text = "no reference here"
    expect(replaceCanvasPathInText(text, OLD, NEW)).toBe(text)
  })

  it("参数缺失时不炸也不改（改名失败路径上会被调用到）", () => {
    expect(replaceCanvasPathInText("abc", "", NEW)).toBe("abc")
    expect(replaceCanvasPathInText("abc", OLD, "")).toBe("abc")
    expect(replaceCanvasPathInText("", OLD, NEW)).toBe("")
    expect(replaceCanvasPathInText("abc", OLD, OLD)).toBe("abc")
  })

  it("referencesCanvasPath 与替换规则严格一致", () => {
    expect(referencesCanvasPath(`{"path":"${OLD}"}`, OLD)).toBe(true)
    expect(referencesCanvasPath(`${OLD}.bak`, OLD)).toBe(false)
    expect(referencesCanvasPath("nothing", OLD)).toBe(false)
  })
})

describe("buildCanvasFilePath / isValidCanvasBaseName", () => {
  it("拼路径：去掉多余斜杠、强制 .canvas 后缀", () => {
    expect(buildCanvasFilePath("/data/x/", "长城")).toBe("/data/x/长城.canvas")
    expect(buildCanvasFilePath("/data/x", "长城.canvas")).toBe("/data/x/长城.canvas")
    expect(buildCanvasFilePath("/data/x", "  长城  ")).toBe("/data/x/长城.canvas")
  })

  it("拒绝空名与含路径分隔符 / 非法字符的名字", () => {
    expect(isValidCanvasBaseName("")).toBe(false)
    expect(isValidCanvasBaseName("   ")).toBe(false)
    expect(isValidCanvasBaseName("a/b")).toBe(false)
    expect(isValidCanvasBaseName("a\\b")).toBe(false)
    expect(isValidCanvasBaseName("a:b")).toBe(false)
    expect(isValidCanvasBaseName("a?b")).toBe(false)
    expect(isValidCanvasBaseName("长城 2")).toBe(true)
  })
})

describe("listCanvasFiles", () => {
  const tree: Record<string, Array<{ isDir: boolean, name: string, updated?: number }>> = {
    "/data/storage/petal": [
      { isDir: true, name: "siyuan-diskcanvas" },
      { isDir: true, name: "other" },
    ],
    "/data/storage/petal/siyuan-diskcanvas": [
      { isDir: false, name: "长城.canvas", updated: 111 },
      { isDir: false, name: "笔记.sy" },
      { isDir: true, name: "子目录" },
    ],
    "/data/storage/petal/siyuan-diskcanvas/子目录": [
      { isDir: false, name: "嵌套.canvas", updated: 222 },
    ],
    "/data/storage/petal/other": [
      { isDir: false, name: "别处.canvas" },
    ],
  }
  const readDir = async (path: string) => tree[path] ?? []

  it("递归收集 .canvas，忽略其它扩展名", async () => {
    const files = await listCanvasFiles(["/data/storage/petal"], readDir)
    expect(files.map((f) => f.name).sort()).toEqual(["别处.canvas", "嵌套.canvas", "长城.canvas"])
  })

  it("带上 updated（用于界面排序/展示）", async () => {
    const files = await listCanvasFiles(["/data/storage/petal"], readDir)
    expect(files.find((f) => f.name === "长城.canvas")?.updated).toBe(111)
  })

  it("目录读不到时不抛（权限/已删除都只是少几个结果）", async () => {
    const files = await listCanvasFiles(["/data/storage/petal", "/nonexistent"], readDir)
    expect(files.length).toBe(3)
  })

  it("同一个目录被两个根覆盖时不会重复（visitedDirs 去重）", async () => {
    const files = await listCanvasFiles(["/data/storage/petal", "/data/storage/petal/siyuan-diskcanvas"], readDir)
    expect(files.filter((f) => f.name === "长城.canvas")).toHaveLength(1)
  })
})

describe("relinkCanvasReferences", () => {
  function createDeps(overrides: Partial<Record<string, unknown>> = {}) {
    const messages: string[] = []
    return {
      createDir: vi.fn(async () => undefined),
      findBlocksReferencing: vi.fn(async (needle: string) => [
        { id: "block-1", markdown: `;;; siyuan-diskcanvas/canvas\n{"path":"${OLD}"}\n;;;` },
        { id: "block-2", markdown: "无关的块" },
      ]),
      readDir: vi.fn(async (path: string) => {
        if (path === "/data/storage/petal") {
          return [{ isDir: true, name: "siyuan-diskcanvas" }]
        }
        if (path === "/data/storage/petal/siyuan-diskcanvas") {
          return [
            { isDir: false, name: "长城.canvas" },
            { isDir: false, name: "引用者.canvas" },
          ]
        }
        return []
      }),
      readText: vi.fn(async (path: string) => {
        if (path.endsWith("引用者.canvas")) {
          return JSON.stringify({ nodes: [{ file: OLD, id: "n1", type: "file" }] })
        }
        if (path.endsWith("长城.canvas")) {
          return JSON.stringify({ nodes: [] })
        }
        return null
      }),
      removeFile: vi.fn(async () => undefined),
      showMessage: (message: string) => messages.push(message),
      updateBlockMarkdown: vi.fn(async () => undefined),
      writeText: vi.fn(async () => undefined),
      ...overrides,
    }
  }

  it("★ 笔记块 + 其它画布里的引用都会更新 ★", async () => {
    const deps = createDeps()
    const result = await relinkCanvasReferences(deps as never, {
      canvasRoots: ["/data/storage/petal"],
      newPath: NEW,
      oldPath: OLD,
    })

    expect(result.updatedBlocks).toBe(1)
    expect(deps.updateBlockMarkdown).toHaveBeenCalledWith("block-1", expect.stringContaining(NEW))
    // 无关的块不该被写回
    expect(deps.updateBlockMarkdown).toHaveBeenCalledTimes(1)

    expect(result.updatedCanvases).toBe(1)
    expect(deps.writeText).toHaveBeenCalledWith("/data/storage/petal/siyuan-diskcanvas/引用者.canvas", expect.stringContaining(NEW))
    expect(result.failures).toEqual([])
  })

  it("单个块写入失败 → 记进 failures，其余照常继续", async () => {
    const deps = createDeps({
      updateBlockMarkdown: vi.fn(async () => {
        throw new Error("boom")
      }),
    })
    const result = await relinkCanvasReferences(deps as never, {
      canvasRoots: ["/data/storage/petal"],
      newPath: NEW,
      oldPath: OLD,
    })
    expect(result.updatedBlocks).toBe(0)
    expect(result.failures).toHaveLength(1)
    // 画布那一侧不受影响
    expect(result.updatedCanvases).toBe(1)
  })

  it("SQL 查询失败不抛，只记录（改名已成功，不能因此判失败）", async () => {
    const deps = createDeps({
      findBlocksReferencing: vi.fn(async () => {
        throw new Error("sql down")
      }),
    })
    const result = await relinkCanvasReferences(deps as never, {
      canvasRoots: ["/data/storage/petal"],
      newPath: NEW,
      oldPath: OLD,
    })
    expect(result.failures.length).toBeGreaterThan(0)
    expect(result.updatedCanvases).toBe(1)
  })
})

describe("replaceCanvasPathPrefixInText（目录改名）", () => {
  const OLD_DIR = "/data/storage/petal/siyuan-diskcanvas/项目A"
  const NEW_DIR = "/data/storage/petal/siyuan-diskcanvas/项目B"

  it("把前缀下的所有画布引用一起改掉（含子目录）", () => {
    const text = `{"a":"${OLD_DIR}/a.canvas","b":"${OLD_DIR}/子/深.canvas"}`
    const next = replaceCanvasPathPrefixInText(text, OLD_DIR, NEW_DIR)
    expect(next).toContain(`${NEW_DIR}/a.canvas`)
    expect(next).toContain(`${NEW_DIR}/子/深.canvas`)
    expect(next).not.toContain(OLD_DIR)
  })

  it("★ 与整路径替换语义相反：后者会因前缀保护而拒绝目录前缀 ★", () => {
    // 目录前缀后面紧跟 `/`（路径延续字符），整路径替换刻意不命中；前缀替换必须命中
    expect(replaceCanvasPathInText(`${OLD_DIR}/a.canvas`, OLD_DIR, NEW_DIR)).toBe(`${OLD_DIR}/a.canvas`)
    expect(replaceCanvasPathPrefixInText(`${OLD_DIR}/a.canvas`, OLD_DIR, NEW_DIR)).toBe(`${NEW_DIR}/a.canvas`)
  })

  it("末尾多余的斜杠不影响匹配", () => {
    expect(replaceCanvasPathPrefixInText(`${OLD_DIR}/x.canvas`, `${OLD_DIR}/`, NEW_DIR)).toBe(`${NEW_DIR}/x.canvas`)
  })

  it("没命中时原样返回；参数缺失不炸", () => {
    expect(replaceCanvasPathPrefixInText("nothing", OLD_DIR, NEW_DIR)).toBe("nothing")
    expect(replaceCanvasPathPrefixInText(`${OLD_DIR}/a`, "", NEW_DIR)).toBe(`${OLD_DIR}/a`)
    expect(replaceCanvasPathPrefixInText(`${OLD_DIR}/a`, OLD_DIR, "")).toBe(`${OLD_DIR}/a`)
  })
})

describe("listCanvasTree（文件夹 + 子文件）", () => {
  const tree: Record<string, Array<{ isDir: boolean, name: string, updated?: number }>> = {
    "/root": [
      { isDir: true, name: "项目A" },
      { isDir: false, name: "根画布.canvas" },
      { isDir: false, name: "笔记.sy" },
      { isDir: true, name: "空文件夹" },
    ],
    "/root/项目A": [
      { isDir: true, name: "子目录" },
      { isDir: false, name: "A.canvas" },
    ],
    "/root/项目A/子目录": [
      { isDir: false, name: "深.canvas" },
    ],
    "/root/空文件夹": [],
  }
  const readDir = async (p: string) => tree[p] ?? []

  it("目录在前、文件在后；只收 .canvas", async () => {
    const nodes = await listCanvasTree(["/root"], readDir)
    expect(nodes[0].children.map((n) => n.name)).toEqual(["空文件夹", "项目A", "根画布.canvas"])
  })

  it("★ 保留空文件夹（用户刚建的文件夹必须立刻可见）★", async () => {
    const nodes = await listCanvasTree(["/root"], readDir)
    expect(nodes[0].children.some((n) => n.isDir && n.name === "空文件夹")).toBe(true)
  })

  it("canvasCount 递归统计（文件夹标注用）", async () => {
    const nodes = await listCanvasTree(["/root"], readDir)
    expect(nodes[0].children.find((n) => n.name === "项目A")?.canvasCount).toBe(2)
    expect(nodes[0].canvasCount).toBe(3)
  })

  it("collectCanvasPathsFromTree 拿到全部画布路径", async () => {
    const nodes = await listCanvasTree(["/root"], readDir)
    expect(collectCanvasPathsFromTree(nodes).sort()).toEqual([
      "/root/项目A/A.canvas",
      "/root/项目A/子目录/深.canvas",
      "/root/根画布.canvas",
    ].sort())
  })

  it("深度上限生效（防御异常深的目录）", async () => {
    const nodes = await listCanvasTree(["/root"], readDir, { depthLimit: 1 })
    expect(nodes[0].children.find((n) => n.name === "项目A")?.children).toEqual([])
  })
})

describe("renameCanvasFolderWithRelink", () => {
  const OLD_DIR = "/root/项目A"

  function createDeps(overrides: Record<string, unknown> = {}) {
    const store = new Map<string, string>([
      [`${OLD_DIR}/A.canvas`, `{"nodes":[{"file":"${OLD_DIR}/A.canvas"}]}`],
      [`${OLD_DIR}/子目录/深.canvas`, "{}"],
    ])
    return {
      createDir: vi.fn(async () => undefined),
      findBlocksReferencing: vi.fn(async () => [
        { id: "block-1", markdown: `;;; siyuan-diskcanvas/canvas\n{"path":"${OLD_DIR}/A.canvas"}\n;;;` },
      ]),
      readDir: vi.fn(async (p: string) => {
        if (p === OLD_DIR) {
          return [{ isDir: true, name: "子目录" }, { isDir: false, name: "A.canvas" }]
        }
        if (p === `${OLD_DIR}/子目录`) {
          return [{ isDir: false, name: "深.canvas" }]
        }
        if (p === "/root") {
          return [{ isDir: true, name: "项目B" }, { isDir: true, name: "项目A" }]
        }
        if (p === "/root/项目B") {
          return [{ isDir: true, name: "子目录" }, { isDir: false, name: "A.canvas" }]
        }
        if (p === "/root/项目B/子目录") {
          return [{ isDir: false, name: "深.canvas" }]
        }
        return []
      }),
      readText: vi.fn(async (p: string) => store.get(p) ?? null),
      removeFile: vi.fn(async (p: string) => {
        for (const key of [...store.keys()]) {
          if (key.startsWith(`${p}/`)) store.delete(key)
        }
      }),
      showMessage: vi.fn(),
      updateBlockMarkdown: vi.fn(async () => undefined),
      writeText: vi.fn(async (p: string, text: string) => {
        store.set(p, text)
      }),
      ...overrides,
    }
  }

  it("★ 目录改名：内部画布被搬走，笔记引用按前缀更新 ★", async () => {
    const deps = createDeps()
    const outcome = await renameCanvasFolderWithRelink(deps as never, {
      existingPaths: new Set(),
      newBaseName: "项目B",
      oldDir: OLD_DIR,
      scanRoots: ["/root"],
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.newDir).toBe("/root/项目B")
    expect(outcome.copiedFiles).toBe(2)
    expect(deps.updateBlockMarkdown).toHaveBeenCalledWith("block-1", expect.stringContaining("/root/项目B/A.canvas"))
    expect(outcome.relink?.updatedBlocks).toBe(1)
  })

  it("名字非法 / 重名 / 未变：直接拒绝且不留副作用", async () => {
    const deps = createDeps()
    const invalid = await renameCanvasFolderWithRelink(deps as never, {
      existingPaths: new Set(), newBaseName: "a/b", oldDir: OLD_DIR, scanRoots: [],
    })
    const exists = await renameCanvasFolderWithRelink(deps as never, {
      existingPaths: new Set(["/root/项目B"]), newBaseName: "项目B", oldDir: OLD_DIR, scanRoots: [],
    })
    const same = await renameCanvasFolderWithRelink(deps as never, {
      existingPaths: new Set(), newBaseName: "项目A", oldDir: OLD_DIR, scanRoots: [],
    })
    expect([invalid.error, exists.error, same.error]).toEqual(["invalid-name", "exists", "same-name"])
    expect(deps.removeFile).not.toHaveBeenCalled()
  })

  it("复制阶段失败 ⇒ 回滚新目录，不动旧目录", async () => {
    const deps = createDeps({
      writeText: vi.fn(async () => {
        throw new Error("disk full")
      }),
    })
    const outcome = await renameCanvasFolderWithRelink(deps as never, {
      existingPaths: new Set(), newBaseName: "项目B", oldDir: OLD_DIR, scanRoots: [],
    })
    expect(outcome.ok).toBe(false)
    expect(String(outcome.error)).toContain("write-failed")
    expect(deps.removeFile).toHaveBeenCalledWith("/root/项目B")
    expect(deps.removeFile).not.toHaveBeenCalledWith(OLD_DIR)
  })
})

describe("rewriteCanvasPrefixInside / duplicateCanvasFolder", () => {
  const SRC = "/root/项目A"
  const DST = "/root/项目A 副本"

  /**
   * ★ 复制文件夹最容易出的错：副本里"指向自己"的引用还指着原目录 ★
   *   这里造的就是真实形态 —— 子画布里有个嵌套画布节点写着原目录的路径。
   */
  function createDeps(overrides: Record<string, unknown> = {}) {
    const store = new Map<string, string>([
      [`${SRC}/子.canvas`, `{"nodes":[{"type":"file","file":"${SRC}/子.canvas"}]}`],
      [`${SRC}/干净.canvas`, "{}"],
    ])
    return {
      createDir: vi.fn(async () => undefined),
      findBlocksReferencing: vi.fn(async () => []),
      readDir: vi.fn(async (p: string) => {
        if (p === SRC) {
          return [{ isDir: false, name: "子.canvas" }, { isDir: false, name: "干净.canvas" }]
        }
        if (p === DST) {
          return [{ isDir: false, name: "子.canvas" }, { isDir: false, name: "干净.canvas" }]
        }
        return []
      }),
      readText: vi.fn(async (p: string) => store.get(p) ?? null),
      removeFile: vi.fn(async (p: string) => {
        for (const key of [...store.keys()]) {
          if (key.startsWith(`${p}/`)) store.delete(key)
        }
      }),
      showMessage: vi.fn(),
      updateBlockMarkdown: vi.fn(async () => undefined),
      writeText: vi.fn(async (p: string, text: string) => {
        store.set(p, text)
      }),
      ...overrides,
    }
  }

  it("★ 副本内部的自引用被改到副本目录，原目录文件一个字都不动 ★", async () => {
    const deps = createDeps()
    const outcome = await duplicateCanvasFolder(deps as never, {
      existingPaths: new Set(),
      fromDir: SRC,
      newBaseName: "项目A 副本",
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.newDir).toBe(DST)
    expect(outcome.copiedFiles).toBe(2)

    // ★ 断言"最终落盘内容"而不是"某一次写入"：复制时先写过原文，之后才被修正
    const finalChild = await deps.readText(`${DST}/子.canvas`)
    expect(finalChild).toContain(`${DST}/子.canvas`)
    expect(finalChild).not.toContain(`${SRC}/子.canvas`)
    // 副本里的干净文件不该被无谓重写
    expect(await deps.readText(`${DST}/干净.canvas`)).toBe("{}")

    // 原目录没被删、也没被改（copy 只有读，没有写回原路径）
    expect(deps.removeFile).not.toHaveBeenCalled()
    expect(deps.writeText.mock.calls.some((call) => String(call[0]).startsWith(`${SRC}/`))).toBe(false)
    // 复制不是全局 relink：不碰笔记
    expect(deps.updateBlockMarkdown).not.toHaveBeenCalled()
  })

  it("rewriteCanvasPrefixInside 直接调用也能改（返回改了几个文件）", async () => {
    const deps = createDeps({
      readDir: vi.fn(async (p: string) => (p === DST
        ? [{ isDir: false, name: "子.canvas" }, { isDir: false, name: "干净.canvas" }]
        : [])),
    })
    await deps.writeText(`${DST}/子.canvas`, `{"file":"${SRC}/子.canvas"}`)
    await deps.writeText(`${DST}/干净.canvas`, "{}")

    const rewritten = await rewriteCanvasPrefixInside(deps as never, DST, SRC, DST)
    expect(rewritten).toBe(1)
    expect(await deps.readText(`${DST}/子.canvas`)).toBe(`{"file":"${DST}/子.canvas"}`)
  })

  it("名字非法 / 重名 / 与原目录同名：直接拒绝且不留副作用", async () => {
    const deps = createDeps()
    const invalid = await duplicateCanvasFolder(deps as never, {
      existingPaths: new Set(), fromDir: SRC, newBaseName: "a/b",
    })
    const exists = await duplicateCanvasFolder(deps as never, {
      existingPaths: new Set([DST]), fromDir: SRC, newBaseName: "项目A 副本",
    })
    const same = await duplicateCanvasFolder(deps as never, {
      existingPaths: new Set(), fromDir: SRC, newBaseName: "项目A",
    })
    expect([invalid.error, exists.error, same.error]).toEqual(["invalid-name", "exists", "same-name"])
    expect(deps.writeText).not.toHaveBeenCalled()
    expect(deps.removeFile).not.toHaveBeenCalled()
  })

  it("复制中途失败 ⇒ 回滚副本目录，原目录不动", async () => {
    const deps = createDeps({
      writeText: vi.fn(async () => {
        throw new Error("disk full")
      }),
    })
    const outcome = await duplicateCanvasFolder(deps as never, {
      existingPaths: new Set(), fromDir: SRC, newBaseName: "项目A 副本",
    })
    expect(outcome.ok).toBe(false)
    expect(String(outcome.error)).toContain("write-failed")
    expect(deps.removeFile).toHaveBeenCalledWith(DST)
    expect(deps.removeFile).not.toHaveBeenCalledWith(SRC)
  })
})

/**
 * ★ 第 33 轮改制：默认目录**优先且独占** ★
 *
 * 用户要求：「文件管理 默认目录为 默认画布目录」。
 * 原实现恒把 `/data/storage/petal` 当第一个根 ⇒ 窗口一开满屏都是别的插件的
 * 存储目录，用户的画布被埋在中间。现在有默认目录就**只扫它**
 * （它本身就在 petal 下，再挂 petal 根只会塞噪声），
 * 只有拿不到默认目录时才退回 petal 根，避免出现空白窗口。
 */
describe("resolveCanvasScanRoots", () => {
  it("拿不到默认目录时退回 petal 根（避免空白窗口）", () => {
    expect(resolveCanvasScanRoots()).toEqual(["/data/storage/petal"])
    expect(resolveCanvasScanRoots("")).toEqual(["/data/storage/petal"])
    expect(resolveCanvasScanRoots("   ")).toEqual(["/data/storage/petal"])
  })

  it("有默认目录时**只扫它**，不再挂 petal 根", () => {
    expect(resolveCanvasScanRoots("/data/storage/petal/siyuan-diskcanvas"))
      .toEqual(["/data/storage/petal/siyuan-diskcanvas"])
  })

  it("去掉末尾斜杠（否则每次枚举都要多遍历一层空名目录）", () => {
    expect(resolveCanvasScanRoots("/data/我的画布/")).toEqual(["/data/我的画布"])
  })
})
