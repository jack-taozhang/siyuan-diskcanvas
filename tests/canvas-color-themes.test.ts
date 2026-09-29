import { describe, expect, it } from "vitest"
import {
  buildColorStyles,
  CANVAS_COLOR_THEMES,
  DEFAULT_COLOR_THEME,
  getColorThemeById,
  type CanvasColorThemeId,
} from "@/canvas/canvas-color-themes"

describe("canvas color themes", () => {
  it("defines 4 themes each with 6 color slots", () => {
    expect(CANVAS_COLOR_THEMES).toHaveLength(4)
    for (const theme of CANVAS_COLOR_THEMES) {
      expect(theme.colors).toHaveProperty("1")
      expect(theme.colors).toHaveProperty("2")
      expect(theme.colors).toHaveProperty("3")
      expect(theme.colors).toHaveProperty("4")
      expect(theme.colors).toHaveProperty("5")
      expect(theme.colors).toHaveProperty("6")
    }
  })

  it("classic theme matches the original default colors", () => {
    const classic = getColorThemeById("classic")
    expect(classic.colors["1"]).toBe("#ef4444")
    expect(classic.colors["2"]).toBe("#f97316")
    expect(classic.colors["3"]).toBe("#f4b400")
    expect(classic.colors["4"]).toBe("#22c55e")
    expect(classic.colors["5"]).toBe("#4dd0e1")
    expect(classic.colors["6"]).toBe("#8b5cf6")
  })

  it("getColorThemeById falls back to default for unknown ids", () => {
    const theme = getColorThemeById("nonexistent" as CanvasColorThemeId)
    expect(theme.id).toBe(DEFAULT_COLOR_THEME)
  })

  it("buildColorStyles produces background/border/swatch for all 6 slots", () => {
    const theme = getColorThemeById("classic")
    const styles = buildColorStyles(theme)
    expect(styles["1"]).toEqual({
      background: "rgba(239, 68, 68, 0.18)",
      border: "#ef4444",
      swatch: "#ef4444",
    })
    expect(styles["5"]).toEqual({
      background: "rgba(77, 208, 225, 0.18)",
      border: "#4dd0e1",
      swatch: "#4dd0e1",
    })
  })

  it("buildColorStyles derives 18% opacity background from hex", () => {
    const theme = getColorThemeById("cool-rainbow")
    const styles = buildColorStyles(theme)
    // cool-rainbow slot 1 is #10b981 → rgba(16, 185, 129, 0.18)
    expect(styles["1"].background).toBe("rgba(16, 185, 129, 0.18)")
    expect(styles["1"].border).toBe("#10b981")
    expect(styles["1"].swatch).toBe("#10b981")
  })

  it("每个主题的 12 个颜色互不相同（同一主题内不得有重复色值）", () => {
    // 第 11 轮把色板从 6 色扩到 12 色（用户 #16）。
    // 断言方式保持"按 colors 的实际条目数"来算，避免以后再扩色时又要改数字。
    for (const theme of CANVAS_COLOR_THEMES) {
      const borders = Object.values(theme.colors)
      const unique = new Set(borders)
      expect(unique.size).toBe(borders.length)
      expect(borders.length).toBe(12)
    }
  })

  it("default theme is classic", () => {
    expect(DEFAULT_COLOR_THEME).toBe("classic")
  })
})
