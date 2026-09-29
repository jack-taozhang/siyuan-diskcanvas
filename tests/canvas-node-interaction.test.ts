import {
  describe,
  expect,
  it,
} from "vitest"

import {
  findNearestCanvasAnchor,
  getCanvasNodeAnchor,
  resizeCanvasNodeFromCorner,
  resizeCanvasNodeFromSide,
} from "@/canvas/node-interaction"

describe("canvas node interaction helpers", () => {
  it("computes edge anchors from the midpoint of each side", () => {
    const node = {
      id: "n1",
      type: "text" as const,
      text: "one",
      x: 100,
      y: 200,
      width: 320,
      height: 180,
    }

    expect(getCanvasNodeAnchor(node, "top")).toEqual({ x: 260, y: 200 })
    expect(getCanvasNodeAnchor(node, "right")).toEqual({ x: 420, y: 290 })
    expect(getCanvasNodeAnchor(node, "bottom")).toEqual({ x: 260, y: 380 })
    expect(getCanvasNodeAnchor(node, "left")).toEqual({ x: 100, y: 290 })
  })

  it("resizes a node from any edge while preserving the opposite edge", () => {
    const node = {
      id: "n1",
      type: "text" as const,
      text: "one",
      x: 100,
      y: 200,
      width: 320,
      height: 180,
    }

    expect(resizeCanvasNodeFromSide(node, "left", 40, 0)).toMatchObject({
      x: 140,
      y: 200,
      width: 280,
      height: 180,
    })
    expect(resizeCanvasNodeFromSide(node, "right", 40, 0)).toMatchObject({
      x: 100,
      y: 200,
      width: 360,
      height: 180,
    })
    expect(resizeCanvasNodeFromSide(node, "top", 0, 30)).toMatchObject({
      x: 100,
      y: 230,
      width: 320,
      height: 150,
    })
    expect(resizeCanvasNodeFromSide(node, "bottom", 0, 30)).toMatchObject({
      x: 100,
      y: 200,
      width: 320,
      height: 210,
    })
  })

  it("resizes a node from the bottom-right corner by changing width and height together", () => {
    const node = {
      id: "n1",
      type: "text" as const,
      text: "one",
      x: 100,
      y: 200,
      width: 320,
      height: 180,
    }

    expect(resizeCanvasNodeFromCorner(node, 40, 30)).toMatchObject({
      x: 100,
      y: 200,
      width: 360,
      height: 210,
    })
  })

  it("snaps a dragged connection to the nearest eligible side midpoint", () => {
    const nodes = [
      {
        id: "source",
        type: "text" as const,
        text: "source",
        x: 100,
        y: 100,
        width: 180,
        height: 100,
      },
      {
        id: "target",
        type: "text" as const,
        text: "target",
        x: 420,
        y: 120,
        width: 180,
        height: 100,
      },
    ]

    expect(findNearestCanvasAnchor(nodes, { x: 428, y: 170 }, {
      excludeNodeId: "source",
      maxDistance: 24,
    })).toMatchObject({
      nodeId: "target",
      side: "left",
      x: 420,
      y: 170,
    })

    expect(findNearestCanvasAnchor(nodes, { x: 360, y: 170 }, {
      excludeNodeId: "source",
      maxDistance: 24,
    })).toBeNull()
  })

  /**
   * 网格吸附：**只吸正在拖的那条边**。
   *
   * 这几条断言的关键是"吸边坐标"而不是"吸宽高"：
   * 卡片 x=50 本来就不在网格上（间距 32）——若吸宽度，右边永远落不到网格线上。
   */
  describe("网格吸附（grid snap）", () => {
    const node = {
        height: 200,
        id: "n1",
        text: "one",
        type: "text" as const,
        width: 300,
        x: 50,
        y: 50,
      }

    it("未开吸附时结果与改造前完全一致（对照）", () => {
      const plain = resizeCanvasNodeFromSide(node, "right", 37, 0)
      const withGridOff = resizeCanvasNodeFromSide(node, "right", 37, 0, { size: 32, snap: false, style: "grid" })
      expect(withGridOff).toEqual(plain)
      expect(withGridOff.width).toBe(337)
    })

    it("拖右边框：右边吸到网格线，左边不动", () => {
      // 目标右边 = 50 + 300 + 37 = 387 ⇒ 最近的 32 的倍数是 384
      const geometry = resizeCanvasNodeFromSide(node, "right", 37, 0, { size: 32, snap: true, style: "grid" })
      expect(geometry.x).toBe(50)
      expect(geometry.x + geometry.width).toBe(384)
      expect(geometry.width).toBe(334)
    })

    it("拖左边框：左边吸到网格线，右边不动", () => {
      // 目标左边 = 50 - 12 = 38 ⇒ 吸到 32；右边固定 = 350
      const geometry = resizeCanvasNodeFromSide(node, "left", -12, 0, { size: 32, snap: true, style: "grid" })
      expect(geometry.x).toBe(32)
      expect(geometry.x + geometry.width).toBe(350)
    })

    it("拖下边框：下边吸到网格线，上边不动", () => {
      // 目标下边 = 50 + 200 + 20 = 270 ⇒ 吸到 256
      const geometry = resizeCanvasNodeFromSide(node, "bottom", 0, 20, { size: 32, snap: true, style: "grid" })
      expect(geometry.y).toBe(50)
      expect(geometry.y + geometry.height).toBe(256)
    })

    it("拖上边框：上边吸到网格线，下边不动", () => {
      // 目标上边 = 50 - 5 = 45 ⇒ 吸到 32；下边固定 = 250
      const geometry = resizeCanvasNodeFromSide(node, "top", 0, -5, { size: 32, snap: true, style: "grid" })
      expect(geometry.y).toBe(32)
      expect(geometry.y + geometry.height).toBe(250)
    })

    it("角缩放：右下两条边各吸各的，左上角不动", () => {
      const geometry = resizeCanvasNodeFromCorner(node, 37, 20, { size: 32, snap: true, style: "grid" })
      expect(geometry.x).toBe(50)
      expect(geometry.y).toBe(50)
      expect(geometry.x + geometry.width).toBe(384)
      expect(geometry.y + geometry.height).toBe(256)
    })

    it("★ 吸附不能把卡片压到最小尺寸以下 ★", () => {
      // 往左猛拖：目标左边远超右边 ⇒ 吸附后会小于最小宽度 180 ⇒ 必须兜住
      const geometry = resizeCanvasNodeFromSide(node, "left", 400, 0, { size: 32, snap: true, style: "grid" })
      expect(geometry.width).toBeGreaterThanOrEqual(180)
      // 兜底时固定边仍然不动
      expect(geometry.x + geometry.width).toBe(350)
    })

    it("吸附间距变化时结果随之变化", () => {
      const fine = resizeCanvasNodeFromSide(node, "right", 37, 0, { size: 16, snap: true, style: "grid" })
      // 目标右边 387 ⇒ 最近 16 的倍数是 384（48 的倍数则是 384 也一样，这里用 8 更直观）
      const coarse = resizeCanvasNodeFromSide(node, "right", 37, 0, { size: 64, snap: true, style: "grid" })
      expect(fine.x + fine.width).toBe(384)
      expect(coarse.x + coarse.width).toBe(384)
      expect(resizeCanvasNodeFromSide(node, "right", 20, 0, { size: 64, snap: true, style: "grid" }).width)
        .not.toBe(resizeCanvasNodeFromSide(node, "right", 20, 0, { size: 16, snap: true, style: "grid" }).width)
    })
  })

  /**
   * 网格吸附：**只吸正在拖的那条边**。
   *
   * 这几条断言的关键是"吸边坐标"而不是"吸宽高"：
   * 卡片 x=50 本来就不在网格上（间距 32）——若吸宽度，右边永远落不到网格线上。
   */
  describe("网格吸附（grid snap）", () => {
    const node = {
        height: 200,
        id: "n1",
        text: "one",
        type: "text" as const,
        width: 300,
        x: 50,
        y: 50,
      }

    it("未开吸附时结果与改造前完全一致（对照）", () => {
      const plain = resizeCanvasNodeFromSide(node, "right", 37, 0)
      const withGridOff = resizeCanvasNodeFromSide(node, "right", 37, 0, { size: 32, snap: false, style: "grid" })
      expect(withGridOff).toEqual(plain)
      expect(withGridOff.width).toBe(337)
    })

    it("拖右边框：右边吸到网格线，左边不动", () => {
      // 目标右边 = 50 + 300 + 37 = 387 ⇒ 最近的 32 的倍数是 384
      const geometry = resizeCanvasNodeFromSide(node, "right", 37, 0, { size: 32, snap: true, style: "grid" })
      expect(geometry.x).toBe(50)
      expect(geometry.x + geometry.width).toBe(384)
      expect(geometry.width).toBe(334)
    })

    it("拖左边框：左边吸到网格线，右边不动", () => {
      // 目标左边 = 50 - 12 = 38 ⇒ 吸到 32；右边固定 = 350
      const geometry = resizeCanvasNodeFromSide(node, "left", -12, 0, { size: 32, snap: true, style: "grid" })
      expect(geometry.x).toBe(32)
      expect(geometry.x + geometry.width).toBe(350)
    })

    it("拖下边框：下边吸到网格线，上边不动", () => {
      // 目标下边 = 50 + 200 + 20 = 270 ⇒ 吸到 256
      const geometry = resizeCanvasNodeFromSide(node, "bottom", 0, 20, { size: 32, snap: true, style: "grid" })
      expect(geometry.y).toBe(50)
      expect(geometry.y + geometry.height).toBe(256)
    })

    it("拖上边框：上边吸到网格线，下边不动", () => {
      // 目标上边 = 50 - 5 = 45 ⇒ 吸到 32；下边固定 = 250
      const geometry = resizeCanvasNodeFromSide(node, "top", 0, -5, { size: 32, snap: true, style: "grid" })
      expect(geometry.y).toBe(32)
      expect(geometry.y + geometry.height).toBe(250)
    })

    it("角缩放：右下两条边各吸各的，左上角不动", () => {
      const geometry = resizeCanvasNodeFromCorner(node, 37, 20, { size: 32, snap: true, style: "grid" })
      expect(geometry.x).toBe(50)
      expect(geometry.y).toBe(50)
      expect(geometry.x + geometry.width).toBe(384)
      expect(geometry.y + geometry.height).toBe(256)
    })

    it("★ 吸附不能把卡片压到最小尺寸以下 ★", () => {
      // 往左猛拖：目标左边远超右边 ⇒ 吸附后会小于最小宽度 180 ⇒ 必须兜住
      const geometry = resizeCanvasNodeFromSide(node, "left", 400, 0, { size: 32, snap: true, style: "grid" })
      expect(geometry.width).toBeGreaterThanOrEqual(180)
      // 兜底时固定边仍然不动
      expect(geometry.x + geometry.width).toBe(350)
    })

    it("吸附间距变化时结果随之变化", () => {
      const fine = resizeCanvasNodeFromSide(node, "right", 37, 0, { size: 16, snap: true, style: "grid" })
      // 目标右边 387 ⇒ 最近 16 的倍数是 384（48 的倍数则是 384 也一样，这里用 8 更直观）
      const coarse = resizeCanvasNodeFromSide(node, "right", 37, 0, { size: 64, snap: true, style: "grid" })
      expect(fine.x + fine.width).toBe(384)
      expect(coarse.x + coarse.width).toBe(384)
      expect(resizeCanvasNodeFromSide(node, "right", 20, 0, { size: 64, snap: true, style: "grid" }).width)
        .not.toBe(resizeCanvasNodeFromSide(node, "right", 20, 0, { size: 16, snap: true, style: "grid" }).width)
    })
  })
})
