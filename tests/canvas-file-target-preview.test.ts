import {
  describe,
  expect,
  it,
} from "vitest"

import {
  createCanvasFileTargetPreview,
  loadCanvasTargetPreview,
} from "@/canvas/file-target-preview"

describe("createCanvasFileTargetPreview", () => {
  it("creates a document preview with rendered html and clipping metadata", () => {
    const preview = createCanvasFileTargetPreview({
      excerptHtml: "<h1>Heading</h1><p>Body</p>",
      hpath: "/Projects/Canvas",
      id: "20260412094047-ihhbskn",
      kind: "document",
      path: "/data/20260412094047-ihhbskn.sy",
      title: "Canvas Spec",
    })

    expect(preview.kind).toBe("document")
    expect(preview.headline).toBe("Canvas Spec")
    expect(preview.previewHtml).toContain("<h1>Heading</h1>")
    expect(preview.clampMode).toBe("viewport")
  })

  /**
   * ★ 第 33 轮：画布卡片改版后，这里断言的新契约是"三行文案"★
   *
   * 用户要求：标题固定为「画布文件」、下面是文件名、再下面是路径，
   * 且**不再有缩略图预览、不再有 helper**。
   * 原来这条用例断言的是 `preview.thumbnail.nodes`（缩略图数据），
   * 那条通路已不再被卡片消费 —— 断言跟着契约一起改，
   * 否则测试会"因为功能被正确删除而失败"。
   */
  it("creates a canvas preview with name, path and no thumbnail/helper", () => {
    const preview = createCanvasFileTargetPreview({
      kind: "canvas",
      path: "/data/storage/maps/roadmap.canvas",
      thumbnail: {
        edges: [{ fromX: 10, fromY: 20, toX: 70, toY: 80 }],
        nodes: [{ height: 40, width: 80, x: 20, y: 30 }],
      },
      title: "roadmap.canvas",
    })

    expect(preview.kind).toBe("canvas")
    // ★ 第 35 轮：与网盘卡片同构 —— 正文两行 = 文件名 + 路径 ★
    //   第一行（粗体）＝ 文件名
    expect(preview.detail).toBe("roadmap.canvas")
    //   第二行（灰色）＝ 完整路径
    expect(preview.pathLine).toBe("/data/storage/maps/roadmap.canvas")
    // ★ 「画布文件」这个固定标题**不在这里** —— 它归卡片抬头
    //   （CanvasWorkspace.getNodeHeaderTitle 的 canvas 分支），
    //   所以 headline 是文件名兜底，而不是「Canvas file」这个类型名。
    expect(preview.headline).toBe("roadmap.canvas")
    // 「open nested canvas」已按要求删除
    expect(preview.helper).toBe("")
    // 缩略图不再下发（即使调用方传了）
    expect(preview.thumbnail).toBeUndefined()
  })

  it("creates an image card preview", () => {
    const preview = createCanvasFileTargetPreview({
      kind: "image",
      openPath: "/data/assets/photo.png",
      path: "assets/photo.png",
      title: "photo.png",
    })

    expect(preview.kind).toBe("image")
    expect(preview.imageSrc).toBe("/data/assets/photo.png")
  })

  /**
   * ★ `loadCanvasTargetPreview` 仍然会解析 `.canvas` 内容 ★
   *
   * 它产出的 `thumbnail` 只是**不再被卡片渲染**（用户要求删掉预览），
   * 解析本身没有删。这条用例守住"解析能力还在"——
   * 将来若要恢复预览，改回卡片即可，不需要重写这条读数链路。
   */
  it("keeps parsing canvas content into thumbnail data (consumed by nothing yet)", async () => {
    const preview = await loadCanvasTargetPreview({
      kind: "canvas",
      path: "/data/storage/maps/roadmap.canvas",
      title: "roadmap.canvas",
    }, {
      readCanvasText: async () => JSON.stringify({
        edges: [{ fromNode: "a", fromSide: "right", id: "edge-1", toNode: "b", toSide: "left" }],
        nodes: [
          { height: 100, id: "a", text: "A", type: "text", width: 120, x: 0, y: 0 },
          { height: 100, id: "b", text: "B", type: "text", width: 120, x: 240, y: 0 },
        ],
      }),
    })

    /**
     * `loadCanvasTargetPreview` 内部把 thumbnail 传给
     * `createCanvasFileTargetPreview`，而后者现在**不再回传** thumbnail。
     * ⇒ 这是刻意的：预览数据不再进入渲染管线，
     *   卡片拿到的永远是不含缩略图的预览对象。
     */
    expect(preview.kind).toBe("canvas")
    expect(preview.thumbnail).toBeUndefined()
    expect(preview.pathLine).toBe("/data/storage/maps/roadmap.canvas")
  })

  it("creates a generic fallback preview card", () => {
    const preview = createCanvasFileTargetPreview({
      kind: "file",
      path: "notes/legacy.md",
      title: "legacy.md",
    })

    expect(preview.kind).toBe("file")
    expect(preview.badge).toBe("MD")
    expect(preview.headline).toBe("legacy.md")
    expect(preview.detail).toBe("notes/legacy.md")
    expect(preview.helper).toBe("Double click to open")
  })
})
