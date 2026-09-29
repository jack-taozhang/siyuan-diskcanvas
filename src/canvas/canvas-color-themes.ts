export type CanvasColorThemeId = "classic" | "cool-rainbow" | "earth" | "neon"

/**
 * 调色板键。
 *
 * ★ 第 11 轮从 6 色扩到 12 色（用户 #16：「颜色弹出框目前的颜色比较少，增加多一些的默认颜色」）★
 *   旧值 "1".."6" 保持**原样不动** —— 老画布里存的 `color: "3"` 必须继续指向同一个颜色，
 *   否则已存在的画布会集体变色。新增颜色一律追加在 7..12。
 */
export type CanvasPaletteKey =
  | "1" | "2" | "3" | "4" | "5" | "6"
  | "7" | "8" | "9" | "10" | "11" | "12"

export interface CanvasColorTheme {
  id: CanvasColorThemeId
  nameKey: string
  colors: Record<CanvasPaletteKey, string>
}

export const DEFAULT_COLOR_THEME: CanvasColorThemeId = "classic"

export const CANVAS_COLOR_THEMES: CanvasColorTheme[] = [
  {
    id: "classic",
    nameKey: "colorThemeClassic",
    colors: {
      "1": "#ef4444",
      "2": "#f97316",
      "3": "#f4b400",
      "4": "#22c55e",
      "5": "#4dd0e1",
      "6": "#8b5cf6",
      "7": "#eab308",
      "8": "#84cc16",
      "9": "#14b8a6",
      "10": "#3b82f6",
      "11": "#6366f1",
      "12": "#ec4899",
    },
  },
  {
    id: "cool-rainbow",
    nameKey: "colorThemeCoolRainbow",
    colors: {
      "1": "#10b981",
      "2": "#0ea5e9",
      "3": "#2563eb",
      "4": "#7c3aed",
      "5": "#4f46e5",
      "6": "#059669",
      "7": "#06b6d4",
      "8": "#14b8a6",
      "9": "#8b5cf6",
      "10": "#a855f7",
      "11": "#d946ef",
      "12": "#ec4899",
    },
  },
  {
    id: "earth",
    nameKey: "colorThemeEarth",
    colors: {
      "1": "#c77a3a",
      "2": "#4a6b53",
      "3": "#8c6239",
      "4": "#5b7a9c",
      "5": "#a88d5e",
      "6": "#7c587f",
      "7": "#b45309",
      "8": "#78716c",
      "9": "#65a30d",
      "10": "#0d9488",
      "11": "#0369a1",
      "12": "#9f1239",
    },
  },
  {
    id: "neon",
    nameKey: "colorThemeNeon",
    colors: {
      "1": "#00f0ff",
      "2": "#bd00ff",
      "3": "#ff2a85",
      "4": "#ff9900",
      "5": "#ccff00",
      "6": "#00ff66",
      "7": "#ff0055",
      "8": "#ff00ff",
      "9": "#00c8ff",
      "10": "#7cff00",
      "11": "#ffcc00",
      "12": "#00ffcc",
    },
  },
]

export function getColorThemeById(id: CanvasColorThemeId): CanvasColorTheme {
  return CANVAS_COLOR_THEMES.find(t => t.id === id)
    ?? CANVAS_COLOR_THEMES.find(t => t.id === DEFAULT_COLOR_THEME)!
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "")
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function buildColorStyles(
  theme: CanvasColorTheme,
): Record<string, { background: string, border: string, swatch: string }> {
  const result: Record<string, { background: string, border: string, swatch: string }> = {}
  for (const [key, hex] of Object.entries(theme.colors)) {
    result[key] = {
      background: hexToRgba(hex, 0.18),
      border: hex,
      swatch: hex,
    }
  }
  return result
}
