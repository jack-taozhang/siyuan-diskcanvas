/**
 * 画布网格线：背景换算与网格吸附。
 *
 * 这一组断言的重点是**换算关系**，因为算错了完全不报错：
 *   · 间距少乘一次 scale ⇒ 缩放后网格不动（"卡片在固定纹理上滑"）
 *   · 偏移用错符号 ⇒ 网格与内容反向走
 *   · 吸附把 delta 取整而不是把**落点**取整 ⇒ 起点不在格上时永远吸不上去
 */

import { describe, expect, it } from "vitest"

import {
  CANVAS_GRID_MIN_VISIBLE_STEP,
  CANVAS_GRID_SIZE_MAX,
  CANVAS_GRID_SIZE_MIN,
  CANVAS_GRID_STYLES,
  clampCanvasGridSize,
  DEFAULT_CANVAS_GRID_SETTINGS,
  normalizeCanvasGridSettings,
  resolveCanvasGridBackground,
  resolveCanvasGridBackgroundImage,
  snapCanvasDragDelta,
  snapCanvasValueToGrid,
} from "@/canvas/grid"

describe("normalizeCanvasGridSettings", () => {
  it("空值回落默认（与改造前的固定 32px 方格一致，升级后观感不变）", () => {
    expect(normalizeCanvasGridSettings(undefined)).toEqual(DEFAULT_CANVAS_GRID_SETTINGS)
    expect(normalizeCanvasGridSettings(null)).toEqual(DEFAULT_CANVAS_GRID_SETTINGS)
    expect(DEFAULT_CANVAS_GRID_SETTINGS).toEqual({ snap: false, size: 32, style: "grid" })
  })

  it("非法样式回落默认，不把脏值画成一团（不认识的 style 一律当默认方格）", () => {
    expect(normalizeCanvasGridSettings({ style: "wave" }).style).toBe("grid")
    expect(normalizeCanvasGridSettings({ style: 42 }).style).toBe("grid")
  })

  it("五种样式都被接受（与界面遍历的是同一份清单）", () => {
    for (const style of CANVAS_GRID_STYLES) {
      expect(normalizeCanvasGridSettings({ style }).style).toBe(style)
    }
    expect(CANVAS_GRID_STYLES).toHaveLength(5)
  })

  it("snap 只认 boolean（字符串 \"true\" 不算开，避免手改配置文件时出现真假难辨的状态）", () => {
    expect(normalizeCanvasGridSettings({ snap: true }).snap).toBe(true)
    expect(normalizeCanvasGridSettings({ snap: "true" }).snap).toBe(false)
  })
})

describe("clampCanvasGridSize", () => {
  it("夹到 [MIN, MAX] 区间", () => {
    expect(clampCanvasGridSize(1)).toBe(CANVAS_GRID_SIZE_MIN)
    expect(clampCanvasGridSize(9999)).toBe(CANVAS_GRID_SIZE_MAX)
    expect(clampCanvasGridSize(24)).toBe(24)
  })

  it("小数四舍五入、NaN / Infinity 回落默认（否则 background-size 会变成 NaNpx 直接不画）", () => {
    expect(clampCanvasGridSize(23.6)).toBe(24)
    expect(clampCanvasGridSize(Number.NaN)).toBe(DEFAULT_CANVAS_GRID_SETTINGS.size)
    expect(clampCanvasGridSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CANVAS_GRID_SETTINGS.size)
    expect(clampCanvasGridSize("20")).toBe(20)
  })
})

describe("resolveCanvasGridBackgroundImage", () => {
  it("none 出 none，其余四种各出对应配方", () => {
    expect(resolveCanvasGridBackgroundImage("none")).toBe("none")
    expect(resolveCanvasGridBackgroundImage("grid")).toContain("linear-gradient")
    expect(resolveCanvasGridBackgroundImage("grid").split("linear-gradient")).toHaveLength(3) // 两条
    expect(resolveCanvasGridBackgroundImage("hlines").split("linear-gradient")).toHaveLength(2) // 一条
    expect(resolveCanvasGridBackgroundImage("vlines")).toContain("90deg")
    expect(resolveCanvasGridBackgroundImage("dots")).toContain("radial-gradient")
  })

  it("颜色走主题变量（深浅主题自动适配，不在 JS 里写死色值）", () => {
    expect(resolveCanvasGridBackgroundImage("grid")).toContain("var(--canvas-grid)")
  })
})

describe("resolveCanvasGridBackground", () => {
  const viewport = { scale: 1, x: 0, y: 0 }

  it("★ 间距 = 世界间距 × 缩放（网格必须跟着缩放一起变）★", () => {
    const at1 = resolveCanvasGridBackground({ size: 32, style: "grid" }, { scale: 1, x: 0, y: 0 })
    const at2 = resolveCanvasGridBackground({ size: 32, style: "grid" }, { scale: 2, x: 0, y: 0 })
    const atHalf = resolveCanvasGridBackground({ size: 32, style: "grid" }, { scale: 0.5, x: 0, y: 0 })

    expect(at1.backgroundSize).toBe("32px 32px")
    expect(at2.backgroundSize).toBe("64px 64px")
    expect(atHalf.backgroundSize).toBe("16px 16px")
  })

  it("★ 偏移 = 视口位移（网格与内容同向移动）★", () => {
    const moved = resolveCanvasGridBackground({ size: 32, style: "grid" }, { scale: 1, x: -120, y: 45 })
    expect(moved.backgroundPosition).toBe("-120px 45px")
    expect(moved.visible).toBe(true)
  })

  it("style = none ⇒ 不画（且不再给尺寸，避免留下会误导人的残留值）", () => {
    const hidden = resolveCanvasGridBackground({ style: "none", size: 32 }, viewport)
    expect(hidden.visible).toBe(false)
    expect(hidden.backgroundImage).toBe("none")
  })

  it("★ 缩得太密自动隐藏（1px 线 + 2px 间距会糊成一片灰，那是噪声不是网格）★", () => {
    // 32 × 0.1 = 3.2 < 4 ⇒ 隐藏
    const tooDense = resolveCanvasGridBackground({ size: 32, style: "grid" }, { scale: 0.1, x: 0, y: 0 })
    expect(tooDense.visible).toBe(false)

    // 刚好到下限：32 × 0.125 = 4 ⇒ 显示
    const atLimit = resolveCanvasGridBackground({ size: 32, style: "grid" }, { scale: 0.125, x: 0, y: 0 })
    expect(atLimit.visible).toBe(true)
    expect(atLimit.backgroundSize).toBe(`${CANVAS_GRID_MIN_VISIBLE_STEP}px ${CANVAS_GRID_MIN_VISIBLE_STEP}px`)
  })

  it("视口字段缺失/非法时也能算出结果（不抛、不产生 NaNpx）", () => {
    const broken = resolveCanvasGridBackground({ size: 32, style: "grid" }, { scale: Number.NaN, x: Number.NaN, y: undefined as unknown as number })
    expect(broken.backgroundSize).not.toContain("NaN")
    expect(broken.backgroundPosition).not.toContain("NaN")
  })

  it("★★ 画板原点偏移：网格必须跟着节点的定位方式一起偏（用户报的错位就是漏了它）★★", () => {
    /**
     * 节点是按"板坐标"定位的：`translate(world - board.left)`，默认 board.left = -2800。
     * 所以世界网格线在屏幕上的位置 = viewport + (world - board.left) × scale，
     * 网格的 background-position 必须是 `viewport.x - board.left × scale`。
     * 只写 viewport 时，缩放 0.69 下会错开 ~1930px —— 实测就是这个现象。
     */
    const viewport = { scale: 0.5, x: 100, y: 40 }
    const board = { left: -2800, top: -2100 }

    const withBoard = resolveCanvasGridBackground({ size: 32, style: "grid" }, viewport, board)
    // 100 - (-2800) * 0.5 = 1500
    expect(withBoard.backgroundPosition).toBe("1500px 1090px")

    // 不传 board 时保持旧行为（只有单测会这么用；生产路径必须传）
    const withoutBoard = resolveCanvasGridBackground({ size: 32, style: "grid" }, viewport)
    expect(withoutBoard.backgroundPosition).toBe("100px 40px")

    // 间距同样要乘缩放（与 board 偏移互不影响）
    expect(withBoard.backgroundSize).toBe("16px 16px")
  })

  it("画板原点为非法值时按 0 处理（不产生 NaNpx）", () => {
    const broken = resolveCanvasGridBackground(
      { size: 32, style: "grid" },
      { scale: 1, x: 0, y: 0 },
      { left: Number.NaN, top: undefined as unknown as number },
    )
    expect(broken.backgroundPosition).toBe("0px 0px")
  })

  it("吸附开关与背景绘制互不影响（可以「看不见网格但吸得住」）", () => {
    const background = resolveCanvasGridBackground({ size: 32, snap: true, style: "none" }, viewport)
    expect(background.visible).toBe(false)
    expect(normalizeCanvasGridSettings({ size: 32, snap: true, style: "none" }).snap).toBe(true)
  })
})

describe("snapCanvasValueToGrid", () => {
  it("吸到最近的网格线", () => {
    expect(snapCanvasValueToGrid(0, 32)).toBe(0)
    expect(snapCanvasValueToGrid(15, 32)).toBe(0)
    expect(snapCanvasValueToGrid(17, 32)).toBe(32)
    expect(snapCanvasValueToGrid(-17, 32)).toBe(-32)
    expect(snapCanvasValueToGrid(96, 32)).toBe(96)
  })

  it("间距越界时按夹取后的值吸（与绘制用的是同一个间距，不会出现\"吸到看不见的格子上\"）", () => {
    // 间距 1 → 夹到 8；100/8 = 12.5 → Math.round 向上取整 → 13×8 = 104
    expect(snapCanvasValueToGrid(100, 1)).toBe(104)
  })
})

describe("snapCanvasDragDelta", () => {
  it("★ 以锚点**落点**为准取整：起点就在格上时，位移取整即落回格上 ★", () => {
    const result = snapCanvasDragDelta({ anchorX: 64, anchorY: 32, deltaX: 10, deltaY: -6, size: 32 })
    expect(result).toEqual({ deltaX: 0, deltaY: 0 })
  })

  it("★ 起点不在格上时也能吸上去（把位移取整做不到这一点）★", () => {
    // 锚点初始 x = 50（不在格上），位移 +5 ⇒ 落点 55 ⇒ 应吸到 64
    const result = snapCanvasDragDelta({ anchorX: 50, anchorY: 0, deltaX: 5, deltaY: 0, size: 32 })
    expect(50 + result.deltaX).toBe(64)

    // 对照组：单纯把位移取整会得到 0 ⇒ 落点仍是 50，永远吸不上
    expect(Math.round(5 / 32) * 32).toBe(0)
  })

  it("多选拖动：同一个修正量加到整组上，组内相对位置不变", () => {
    const result = snapCanvasDragDelta({ anchorX: 50, anchorY: 0, deltaX: 5, deltaY: 7, size: 32 })
    // 另一个节点用同一个 delta 移动 ⇒ 两者之差与拖动前一致
    const otherBefore = 150
    const otherAfter = otherBefore + result.deltaX
    expect(otherAfter - (50 + result.deltaX)).toBe(otherBefore - 50)
  })

  it("负方向同样正确", () => {
    const result = snapCanvasDragDelta({ anchorX: 32, anchorY: 32, deltaX: -20, deltaY: -20, size: 32 })
    expect(32 + result.deltaX).toBe(0)
    expect(32 + result.deltaY).toBe(0)
  })
})
