/**
 * 画布网格线：样式解析、背景绘制参数、网格吸附。
 * ============================================================================
 *
 * 本模块**全是纯函数**，不碰 DOM、不碰响应式 —— 因为这里的每一件事
 * 都"算错了也不报错"，只会让网格画歪 / 吸附错位，靠肉眼很难判断对错：
 *
 *   · 网格是**世界坐标**的：缩放平移时必须跟着动，否则拖动卡片时网格不动，
 *     视觉上就成了"卡片在纹理上滑"，失去"对齐参考"的意义。
 *   · 网格线宽度恒为 1px（**屏幕像素**），但间距是世界单位 × 缩放。
 *     两者混在一个 `background-size` 里最容易写错。
 *   · 间距在小缩放下会被压到 1~2px，整屏变成灰噪声（摩尔纹）——
 *     必须**自动隐藏**，而不是让用户自己关。
 *
 * 世界 → 屏幕的映射（与 `.stage__world` 的 transform 一致）：
 *     screen = world * scale + viewport.{x,y}
 * 所以：
 *     间距 = size * scale            （background-size）
 *     偏移 = viewport.{x,y}          （background-position）
 */

/** 网格样式（"none" 即不画网格；其余是四种线型） */
export type CanvasGridStyle = "none" | "dots" | "grid" | "hlines" | "vlines"

/** 供界面遍历的样式清单（顺序即菜单顺序） */
export const CANVAS_GRID_STYLES: readonly CanvasGridStyle[] = ["none", "dots", "grid", "hlines", "vlines"]

/** 间距可选值（**世界坐标**像素）。给几档预设而不是让用户填数字。 */
export const CANVAS_GRID_SIZE_PRESETS: readonly number[] = [16, 24, 32, 48]

/** 间距允许范围：太小 = 噪声，太大 = 失去参考意义 */
export const CANVAS_GRID_SIZE_MIN = 8
export const CANVAS_GRID_SIZE_MAX = 64

/**
 * 屏幕上间距小于这个值就**不画**。
 *
 * 1px 线 + 2px 间距 = 整屏 50% 灰；那是噪声不是网格。
 * 4px 是"还能看出是格子"的下限。
 */
export const CANVAS_GRID_MIN_VISIBLE_STEP = 4

/**
 * 网格线颜色。
 *
 * 走 CSS 变量而不是写死色值：它由 `canvas-workspace.scss` 定义成
 * `color-mix(in srgb, var(--b3-theme-on-surface) 8%, transparent)`，
 * 于是**深浅主题自动适配**（这条链是画布既有约定，别在 JS 里另造一份）。
 */
export const CANVAS_GRID_LINE_COLOR = "var(--canvas-grid)"

export interface CanvasGridSettings {
  /** 拖动卡片时是否吸附到网格交点 */
  snap: boolean
  /** 网格间距（世界坐标像素） */
  size: number
  style: CanvasGridStyle
}

export interface CanvasGridViewport {
  scale: number
  x: number
  y: number
}

/**
 * 画板的度量（`canvas/board.ts` 的返回值里本模块需要的两个字段）。
 *
 * ★★ 为什么网格必须知道画板原点 ★★
 *
 *   **节点不是按世界坐标定位的，而是按"板坐标"**：
 *     `transform: translate(toBoardX(board, node.x), …)`
 *     而 `toBoardX(board, x) = x - board.left`，`board.left = -board.width / 2`（默认 -2800）。
 *
 *   于是屏幕位置的真实映射是：
 *     screen = stageOrigin + viewport.{x,y} + (world - board.{left,top}) * scale
 *
 *   而 CSS 背景的偏移是相对 `.stage` 的 padding box —— 与 `.stage__world`（left/top = 0）
 *   同一个原点。所以网格的 `background-position` 必须是：
 *     viewport.{x,y} - board.{left,top} * scale
 *
 *   只写 `viewport` 就会**漏掉 -board.left * scale 这一大项**
 *   （默认画板下 = 2800 × scale，缩放 0.69 时差了 ~1930px）——
 *   现象正是用户报的「吸附的位置和网格显示的位置不一致」。
 */
export interface CanvasGridBoard {
  left: number
  top: number
}

export interface CanvasGridBackground {
  /** 是否绘制网格（style 为 none、或缩得太密时都是 false） */
  visible: boolean
  backgroundImage: string
  backgroundPosition: string
  backgroundSize: string
}

export const DEFAULT_CANVAS_GRID_SETTINGS: CanvasGridSettings = {
  snap: false,
  // 32 与改造前的固定值一致 ⇒ 升级后观感不变
  size: 32,
  style: "grid",
}

function isGridStyle(value: unknown): value is CanvasGridStyle {
  return typeof value === "string" && (CANVAS_GRID_STYLES as readonly string[]).includes(value)
}

/** 把任意输入夹到合法范围（非整数四舍五入；NaN/Infinity 回落默认值） */
export function clampCanvasGridSize(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return DEFAULT_CANVAS_GRID_SETTINGS.size
  }
  const rounded = Math.round(numeric)
  return Math.min(CANVAS_GRID_SIZE_MAX, Math.max(CANVAS_GRID_SIZE_MIN, rounded))
}

/**
 * 归一化网格设置。
 *
 * **单一事实来源**：设置面板、工具栏弹层、读盘（`plugin-data`）、
 * 手势层都用它，避免"各处各自兜底"导致同一份数据在不同路径下算出不同结果。
 */
export function normalizeCanvasGridSettings(value: unknown): CanvasGridSettings {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<CanvasGridSettings>
  return {
    snap: typeof candidate.snap === "boolean" ? candidate.snap : DEFAULT_CANVAS_GRID_SETTINGS.snap,
    size: candidate.size === undefined ? DEFAULT_CANVAS_GRID_SETTINGS.size : clampCanvasGridSize(candidate.size),
    style: isGridStyle(candidate.style) ? candidate.style : DEFAULT_CANVAS_GRID_SETTINGS.style,
  }
}

/**
 * 由样式给出 `background-image` 配方。
 *
 * 四种线型共用 **同一个 `background-size`**（`<step> <step>`），
 * 所以横线只画一条 gradient（竖向重复）、竖线同理、方格两条、点阵一条 radial。
 * 这样切换样式时只需换配方，不用换尺寸逻辑。
 */
export function resolveCanvasGridBackgroundImage(style: CanvasGridStyle): string {
  const line = `${CANVAS_GRID_LINE_COLOR} 1px, transparent 1px`
  switch (style) {
    case "dots":
      return `radial-gradient(circle, ${CANVAS_GRID_LINE_COLOR} 1.2px, transparent 1.2px)`
    case "grid":
      return `linear-gradient(${line}), linear-gradient(90deg, ${line})`
    case "hlines":
      return `linear-gradient(${line})`
    case "vlines":
      return `linear-gradient(90deg, ${line})`
    case "none":
    default:
      return "none"
  }
}

/**
 * 算出 `.stage` 该用的背景样式。
 *
 * @param settings 网格设置（会先归一化，脏数据不会画出歪网格）
 * @param viewport 当前视口（`viewport.{x,y}` 是世界原点在屏幕上的位置）
 * @param board    画板度量（**必传**：节点按板坐标定位，网格必须跟着一起偏 ——
 *                 见 {@link CanvasGridBoard} 的推导。不传时按原点 0,0 处理，
 *                 只有单测会这么用）
 */
export function resolveCanvasGridBackground(
  settings: unknown,
  viewport: CanvasGridViewport,
  board?: CanvasGridBoard,
): CanvasGridBackground {
  const normalized = normalizeCanvasGridSettings(settings)
  const scale = Number.isFinite(viewport?.scale) ? viewport.scale : 1
  const step = normalized.size * scale

  const hidden: CanvasGridBackground = {
    backgroundImage: "none",
    backgroundPosition: "0px 0px",
    backgroundSize: "auto",
    visible: false,
  }

  if (normalized.style === "none" || step < CANVAS_GRID_MIN_VISIBLE_STEP) {
    return hidden
  }

  const x = Number.isFinite(viewport?.x) ? viewport.x : 0
  const y = Number.isFinite(viewport?.y) ? viewport.y : 0
  const boardLeft = Number.isFinite(board?.left) ? (board as CanvasGridBoard).left : 0
  const boardTop = Number.isFinite(board?.top) ? (board as CanvasGridBoard).top : 0

  return {
    backgroundImage: resolveCanvasGridBackgroundImage(normalized.style),
    // 板坐标偏移：world 网格线在屏幕上的位置 = viewport + (world - board.left) × scale
    backgroundPosition: `${x - boardLeft * scale}px ${y - boardTop * scale}px`,
    backgroundSize: `${step}px ${step}px`,
    visible: true,
  }
}

/* ──────────────────────────────────────────────────────────────
 * 吸附
 * ────────────────────────────────────────────────────────────── */

/** 把单个坐标吸到最近的网格线（世界坐标） */
export function snapCanvasValueToGrid(value: number, size: number): number {
  const step = clampCanvasGridSize(size)
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.round(value / step) * step
}

/**
 * 把一次拖动**整体**吸附到网格。
 *
 * ★ 为什么以"锚点节点"的落点为准，而不是把位移量取整 ★
 *   多选拖动时，被拖的是一组节点。若把 `deltaX` 取整，只有"起点本来就在网格上"
 *   的节点才会落在网格上 —— 起点不在网格时永远吸不上去（用户会觉得"吸附坏了"）。
 *   正确做法：算**锚点节点**的目标位置并吸附，再把同一个修正量加到整组上 ⇒
 *   锚点精确落在网格线上，且**组内相对位置完全不变**。
 *
 * @param anchorX/anchorY 锚点节点在**拖动开始时**的位置
 */
export function snapCanvasDragDelta(options: {
  anchorX: number
  anchorY: number
  deltaX: number
  deltaY: number
  size: number
}): { deltaX: number, deltaY: number } {
  const step = clampCanvasGridSize(options.size)
  const targetX = options.anchorX + options.deltaX
  const targetY = options.anchorY + options.deltaY

  return {
    deltaX: options.deltaX + (snapCanvasValueToGrid(targetX, step) - targetX),
    deltaY: options.deltaY + (snapCanvasValueToGrid(targetY, step) - targetY),
  }
}
