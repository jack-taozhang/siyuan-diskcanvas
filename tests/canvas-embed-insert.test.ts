/* @vitest-environment jsdom */

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

const appendBlockMock = vi.fn()
const insertBlockMock = vi.fn()
const setBlockAttrsMock = vi.fn()
const uploadMock = vi.fn()

vi.mock("@/api", () => ({
  appendBlock: (...args: unknown[]) => appendBlockMock(...args),
  insertBlock: (...args: unknown[]) => insertBlockMock(...args),
  setBlockAttrs: (...args: unknown[]) => setBlockAttrsMock(...args),
  upload: (...args: unknown[]) => uploadMock(...args),
  updateBlock: vi.fn(),
}))

import {
  buildCanvasEmbedMarkdown,
  buildCanvasLinkMarkdown,
  insertCanvasEmbed,
  insertCanvasLink,
} from "@/canvas/canvas-embed-insert"

describe("canvas-embed-insert", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("buildCanvasLinkMarkdown", () => {
    it("creates markdown link from path and file name", () => {
      const md = buildCanvasLinkMarkdown("/data/storage/petal/siyuan-canvas/demo.canvas")
      expect(md).toBe("[demo.canvas](/data/storage/petal/siyuan-canvas/demo.canvas)")
    })

    it("uses provided title over path file name", () => {
      const md = buildCanvasLinkMarkdown("/data/storage/petal/siyuan-canvas/demo.canvas", "Custom Title.canvas")
      expect(md).toBe("[Custom Title.canvas](/data/storage/petal/siyuan-canvas/demo.canvas)")
    })

    it("escapes special markdown characters in title", () => {
      const md = buildCanvasLinkMarkdown("/data/demo.canvas", "Test [Bracket].canvas")
      expect(md).toBe("[Test \\[Bracket\\].canvas](/data/demo.canvas)")
    })
  })

  describe("insertCanvasLink", () => {
    it("inserts block before nextBlockId if provided", async () => {
      insertBlockMock.mockResolvedValueOnce([
        {
          doOperations: [{ id: "new-link-block-1" }],
        },
      ])

      const blockId = await insertCanvasLink({
        canvasPath: "/data/storage/petal/siyuan-canvas/my-canvas.canvas",
        parentBlockId: "doc-123",
        nextBlockId: "cursor-block-456",
      })

      expect(blockId).toBe("new-link-block-1")
      /**
       * ★ 位置语义（2026-09-28 变更）★
       *
       * 用户要求「插入块到该行」。内核实测语义：
       *   `{parentID, previousID}` ⇒ 插到 previousID **之后**
       *   `{parentID, nextID}`     ⇒ 插到 nextID **之前**
       * 所以插到光标所在块（nextBlockId）**之前**，才叫"该行"。
       * insertBlock 的实参顺序是 (dataType, data, nextID, previousID, parentID)，
       * ⇒ 第 3 位传 nextBlockId、第 4 位留 undefined。
       */
      expect(insertBlockMock).toHaveBeenCalledWith(
        "markdown",
        "[my-canvas.canvas](/data/storage/petal/siyuan-canvas/my-canvas.canvas)",
        "cursor-block-456",
        undefined,
        "doc-123",
      )
      expect(setBlockAttrsMock).toHaveBeenCalledWith("new-link-block-1", {
        "custom-canvas-path": "/data/storage/petal/siyuan-canvas/my-canvas.canvas",
      })
    })

    it("falls back to appendBlock when previousBlockId is not provided", async () => {
      appendBlockMock.mockResolvedValueOnce([
        {
          doOperations: [{ id: "new-link-block-2" }],
        },
      ])

      const blockId = await insertCanvasLink({
        canvasPath: "/data/storage/petal/siyuan-canvas/my-canvas.canvas",
        parentBlockId: "doc-123",
      })

      expect(blockId).toBe("new-link-block-2")
      expect(insertBlockMock).not.toHaveBeenCalled()
      expect(appendBlockMock).toHaveBeenCalledWith(
        "markdown",
        "[my-canvas.canvas](/data/storage/petal/siyuan-canvas/my-canvas.canvas)",
        "doc-123",
      )
    })
  })

  describe("insertCanvasEmbed", () => {
    it("inserts a custom block before nextBlockId if provided", async () => {
      insertBlockMock.mockResolvedValueOnce([
        {
          doOperations: [{ id: "new-embed-block-1" }],
        },
      ])

      const raw = JSON.stringify({
        nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 100, height: 100, text: "hi" }],
        edges: [],
      })

      const blockId = await insertCanvasEmbed({
        canvasPath: "/data/storage/petal/siyuan-canvas/test.canvas",
        canvasRaw: raw,
        parentBlockId: "doc-123",
        nextBlockId: "cursor-block-789",
      })

      expect(blockId).toBe("new-embed-block-1")
      /**
       * ★ 内容与位置（2026-09-28 变更）★
       *
       * 1. 内容：不再是 `![test](assets/…)` 图片，而是 `;;;` 自定义块。
       *    图片方案做不到"渲染效果和编辑状态一样"（不能缩放/平移），
       *    且每次刷新都要再传一张 SVG。自定义块由 customBlockRenders 渲染真实画布。
       *    围栏**必须顶格**，否则退化成普通段落（见 buildCanvasEmbedBlockMarkdown 的断言）。
       * 2. 位置：插到 nextBlockId **之前**（第 3 位实参），见上一个用例的详细说明。
       */
      expect(insertBlockMock).toHaveBeenCalledWith(
        "markdown",
        expect.stringMatching(/^;;;siyuan-diskcanvas\/canvas\n/),
        "cursor-block-789",
        undefined,
        "doc-123",
      )
      expect(insertBlockMock.mock.calls[0][1]).toContain("/data/storage/petal/siyuan-canvas/test.canvas")
      expect(setBlockAttrsMock).toHaveBeenCalledWith("new-embed-block-1", {
        "custom-canvas-path": "/data/storage/petal/siyuan-canvas/test.canvas",
      })
    })
  })
})
