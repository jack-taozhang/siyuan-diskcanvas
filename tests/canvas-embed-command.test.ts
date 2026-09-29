/* @vitest-environment jsdom */

import type { IProtyle } from "siyuan"
import {
  describe,
  expect,
  it,
  vi,
} from "vitest"

import {
  normalizeCanvasEmbedPath,
  resolveCanvasEmbedTargetDocumentId,
  resolveCanvasEmbedTargetLocation,
  runCanvasEmbedCommand,
} from "@/canvas/canvas-embed-command"

function protyle(rootID?: string, id?: string): IProtyle {
  return {
    block: { rootID, id },
    element: document.createElement("div"),
  } as unknown as IProtyle
}

const mockMessages = {
  insertCanvasEmbedFailed: "embed failed",
  insertCanvasEmbedNoDocument: "no document",
  insertCanvasEmbedSuccess: "embed success",
  insertCanvasLinkFailed: "link failed",
  insertCanvasLinkSuccess: "link success",
  messageUnableOpenCanvasFile: "unable",
}

describe("canvas embed command", () => {
  it("normalizes quoted paths and converts workspace absolute paths", async () => {
    await expect(normalizeCanvasEmbedPath(" \"D:\\Siyuan\\data\\assets\\a.canvas\" ", async () => "D:/Siyuan"))
      .resolves.toBe("/data/assets/a.canvas")
  })

  it("keeps non-workspace absolute paths unchanged after quote trimming", async () => {
    await expect(normalizeCanvasEmbedPath("'D:\\Other\\a.canvas'", async () => "D:/Siyuan"))
      .resolves.toBe("D:\\Other\\a.canvas")
  })

  it("safely handles null, undefined, or empty path inputs", async () => {
    await expect(normalizeCanvasEmbedPath(null)).resolves.toBe("")
    await expect(normalizeCanvasEmbedPath(undefined)).resolves.toBe("")
    await expect(normalizeCanvasEmbedPath("")).resolves.toBe("")
  })

  it("resolves target document id from command protyle before fallbacks", () => {
    const lastActive = protyle("last-root")
    const editor = protyle("editor-root")
    document.body.innerHTML = `<div class="protyle-wysiwyg" data-node-id="dom-root"></div>`

    expect(resolveCanvasEmbedTargetDocumentId({
      commandProtyle: protyle("command-root"),
      getAllEditor: () => [{ protyle: editor }],
      lastActiveProtyle: lastActive,
    })).toBe("command-root")
  })

  it("uses last active, editor list, and DOM roots as ordered fallbacks", () => {
    document.body.innerHTML = `<div class="protyle-wysiwyg" data-node-id="dom-root"></div>`

    expect(resolveCanvasEmbedTargetDocumentId({
      commandProtyle: null,
      getAllEditor: () => [{ protyle: protyle("editor-root") }],
      lastActiveProtyle: protyle("last-root"),
    })).toBe("last-root")

    expect(resolveCanvasEmbedTargetDocumentId({
      commandProtyle: null,
      getAllEditor: () => [{ protyle: protyle("editor-root") }],
      lastActiveProtyle: null,
    })).toBe("editor-root")

    expect(resolveCanvasEmbedTargetDocumentId({
      commandProtyle: null,
      getAllEditor: () => [],
      lastActiveProtyle: null,
    })).toBe("dom-root")
  })

  it("resolves target location with nextBlockId from selection/protyle", () => {
    document.body.innerHTML = `
      <div class="protyle-wysiwyg" data-node-id="doc-1" data-type="NodeDocument">
        <div data-node-id="block-1" data-type="NodeParagraph">Hello</div>
      </div>
    `
    const pEl = document.querySelector("[data-node-id='block-1']")!
    const range = document.createRange()
    range.selectNodeContents(pEl)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    const location = resolveCanvasEmbedTargetLocation({
      commandProtyle: null,
      getAllEditor: () => [],
      lastActiveProtyle: null,
    })

    expect(location.docId).toBe("doc-1")
    expect(location.nextBlockId).toBe("block-1")
  })

  it("resolves nextBlockId from protyle block id when not root", () => {
    document.body.innerHTML = `<div class="protyle-wysiwyg" data-node-id="doc-root" data-type="NodeDocument"></div>`
    window.getSelection()?.removeAllRanges()

    const location = resolveCanvasEmbedTargetLocation({
      commandProtyle: protyle("doc-root", "cursor-block-99"),
      getAllEditor: () => [],
      lastActiveProtyle: null,
    })

    expect(location.docId).toBe("doc-root")
    expect(location.nextBlockId).toBe("cursor-block-99")
  })

  it("shows the no-document warning when there is no target document", async () => {
    const showMessage = vi.fn()
    document.body.innerHTML = ""
    window.getSelection()?.removeAllRanges()

    await runCanvasEmbedCommand({
      canvasPath: "/data/a.canvas",
      commandProtyle: null,
      debugLog: vi.fn(),
      getAllEditor: () => [],
      getFileText: vi.fn(async () => "{}"),
      getWorkspaceDir: vi.fn(),
      insertCanvasEmbed: vi.fn(),
      lastActiveProtyle: null,
      messages: mockMessages,
      showMessage,
    })

    expect(showMessage).toHaveBeenCalledWith("no document", 4000, "warning")
  })

  it("executes insertCanvasEmbed in preview mode with cursor location", async () => {
    const showMessage = vi.fn()
    const insertCanvasEmbed = vi.fn(async () => "new-embed-block")
    document.body.innerHTML = `<div class="protyle-wysiwyg" data-node-id="doc-123"></div>`

    const blockId = await runCanvasEmbedCommand({
      canvasPath: "/data/storage/test.canvas",
      mode: "preview",
      commandProtyle: protyle("doc-123", "block-456"),
      debugLog: vi.fn(),
      getAllEditor: () => [],
      getFileText: vi.fn(async () => '{"nodes":[]}'),
      getWorkspaceDir: vi.fn(),
      insertCanvasEmbed,
      lastActiveProtyle: null,
      messages: mockMessages,
      showMessage,
    })

    expect(blockId).toBe("new-embed-block")
    expect(insertCanvasEmbed).toHaveBeenCalledWith({
      canvasPath: "/data/storage/test.canvas",
      canvasRaw: '{"nodes":[]}',
      parentBlockId: "doc-123",
      nextBlockId: "block-456",
    })
    expect(showMessage).toHaveBeenCalledWith("embed success", 3000)
  })

  it("executes insertCanvasLink in link mode with cursor location", async () => {
    const showMessage = vi.fn()
    const insertCanvasLink = vi.fn(async () => "new-link-block")
    document.body.innerHTML = `<div class="protyle-wysiwyg" data-node-id="doc-123"></div>`

    const blockId = await runCanvasEmbedCommand({
      canvasPath: "/data/storage/petal/siyuan-canvas/demo.canvas",
      mode: "link",
      commandProtyle: protyle("doc-123", "block-789"),
      debugLog: vi.fn(),
      getAllEditor: () => [],
      getFileText: vi.fn(async () => ""),
      getWorkspaceDir: vi.fn(),
      insertCanvasEmbed: vi.fn(),
      insertCanvasLink,
      lastActiveProtyle: null,
      messages: mockMessages,
      showMessage,
    })

    expect(blockId).toBe("new-link-block")
    expect(insertCanvasLink).toHaveBeenCalledWith({
      canvasPath: "/data/storage/petal/siyuan-canvas/demo.canvas",
      parentBlockId: "doc-123",
      nextBlockId: "block-789",
    })
    expect(showMessage).toHaveBeenCalledWith("link success", 3000)
  })

  it("shows link failure message when insertCanvasLink fails", async () => {
    const showMessage = vi.fn()
    const insertCanvasLink = vi.fn(async () => null)
    document.body.innerHTML = `<div class="protyle-wysiwyg" data-node-id="doc-123"></div>`

    const blockId = await runCanvasEmbedCommand({
      canvasPath: "/data/storage/petal/siyuan-canvas/demo.canvas",
      mode: "link",
      commandProtyle: protyle("doc-123"),
      debugLog: vi.fn(),
      getAllEditor: () => [],
      getFileText: vi.fn(async () => ""),
      getWorkspaceDir: vi.fn(),
      insertCanvasEmbed: vi.fn(),
      insertCanvasLink,
      lastActiveProtyle: null,
      messages: mockMessages,
      showMessage,
    })

    expect(blockId).toBeUndefined()
    expect(showMessage).toHaveBeenCalledWith("link failed", 4000, "error")
  })

  it("prioritizes targetNodeElement and targetBlockId when resolving target location", () => {
    document.body.innerHTML = `
      <div class="protyle-wysiwyg" data-node-id="doc-target" data-type="NodeDocument">
        <div data-node-id="block-slash-node" data-type="NodeParagraph">Slash trigger</div>
      </div>
    `
    const nodeEl = document.querySelector("[data-node-id='block-slash-node']") as HTMLElement

    const locationFromElement = resolveCanvasEmbedTargetLocation({
      commandProtyle: null,
      targetNodeElement: nodeEl,
    })
    expect(locationFromElement.docId).toBe("doc-target")
    expect(locationFromElement.nextBlockId).toBe("block-slash-node")

    const locationFromBlockId = resolveCanvasEmbedTargetLocation({
      commandProtyle: protyle("doc-target"),
      targetBlockId: "explicit-block-id",
    })
    expect(locationFromBlockId.docId).toBe("doc-target")
    expect(locationFromBlockId.nextBlockId).toBe("explicit-block-id")
  })
})
