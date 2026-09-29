import type { CanvasGridSettings } from "@/canvas/grid"
import {
  clampCanvasGridSize,
} from "@/canvas/grid"
import type {
  CanvasNode,
  CanvasSide,
} from "@/canvas/types"

export interface CanvasAnchorTarget {
  nodeId: string
  side: CanvasSide
  x: number
  y: number
}

export const CONNECTION_SNAP_DISTANCE = 24
const MIN_NODE_WIDTH = 180
const MIN_NODE_HEIGHT = 100
const MIN_GROUP_HEIGHT = 120

export function getCanvasNodeAnchor(node: CanvasNode, side: CanvasSide): { x: number, y: number } {
  switch (side) {
    case "top":
      return {
        x: node.x + node.width / 2,
        y: node.y,
      }
    case "right":
      return {
        x: node.x + node.width,
        y: node.y + node.height / 2,
      }
    case "bottom":
      return {
        x: node.x + node.width / 2,
        y: node.y + node.height,
      }
    case "left":
      return {
        x: node.x,
        y: node.y + node.height / 2,
      }
    default:
      return {
        x: node.x,
        y: node.y,
      }
  }
}

/**
 * 把一次缩放的结果吸附到网格（**只吸正在拖的那条边**）。
 *
 * ★ 为什么吸"边的坐标"而不是"宽高" ★
 *   用户拖右边框时，期望的是「这条边落到网格线上」。
 *   若改成吸宽度，当**对侧边**本来就不在网格上时（比如卡片 x=50、间距 32），
 *   右边永远落不到网格线上（宽度是 32 的倍数，但起点偏了半格）。
 *   这与拖拽吸附里踩过的坑是同一个道理 —— 那里也必须吸"落点"而不是"位移"。
 *
 * ★ 下限优先级 ★
 *   吸附不能把卡片压到最小尺寸以下（否则会拉成一条线）。顺序是：
 *   先吸边 → 再夹下限；夹下限时把**动的边**顶出去，固定边不动。
 *
 * @param node     缩放前的节点（用来取"固定的那两条边"）
 * @param geometry 未吸附的几何（来自下面两个 resize 函数）
 * @param sides    这次哪些边在动（角缩放 = right + bottom）
 */
export function snapCanvasResizeToGrid(
  node: CanvasNode,
  geometry: { height: number, width: number, x: number, y: number },
  sides: { bottom?: boolean, left?: boolean, right?: boolean, top?: boolean },
  grid: CanvasGridSettings | undefined,
  minHeight: number,
  minWidth: number,
): { height: number, width: number, x: number, y: number } {
  if (!grid?.snap) {
    return geometry
  }

  const step = clampCanvasGridSize(grid.size)
  const snapToGrid = (value: number) => Math.round(value / step) * step

  // 固定边：不动的那些边，吸附后要用它们反推宽高
  const fixedRight = node.x + node.width
  const fixedBottom = node.y + node.height

  let { height, width, x, y } = geometry

  if (sides.left && !sides.right) {
    x = snapToGrid(x)
    width = fixedRight - x
  } else if (sides.right && !sides.left) {
    width = snapToGrid(x + width) - x
  }

  if (sides.top && !sides.bottom) {
    y = snapToGrid(y)
    height = fixedBottom - y
  } else if (sides.bottom && !sides.top) {
    height = snapToGrid(y + height) - y
  }

  if (width < minWidth) {
    width = minWidth
    if (sides.left && !sides.right) {
      x = fixedRight - width
    }
  }
  if (height < minHeight) {
    height = minHeight
    if (sides.top && !sides.bottom) {
      y = fixedBottom - height
    }
  }

  return {
    height: Math.round(height),
    width: Math.round(width),
    x: Math.round(x),
    y: Math.round(y),
  }
}

export function resizeCanvasNodeFromSide(
  node: CanvasNode,
  side: CanvasSide,
  deltaX: number,
  deltaY: number,
  grid?: CanvasGridSettings,
): { height: number, width: number, x: number, y: number } {
  const minHeight = node.type === "group" ? MIN_GROUP_HEIGHT : MIN_NODE_HEIGHT
  const minWidth = MIN_NODE_WIDTH

  const geometry = ((): { height: number, width: number, x: number, y: number } => {
    switch (side) {
      case "left": {
        const width = Math.max(MIN_NODE_WIDTH, Math.round(node.width - deltaX))
        return {
          height: node.height,
          width,
          x: node.x + node.width - width,
          y: node.y,
        }
      }
      case "right":
        return {
          height: node.height,
          width: Math.max(MIN_NODE_WIDTH, Math.round(node.width + deltaX)),
          x: node.x,
          y: node.y,
        }
      case "top": {
        const height = Math.max(minHeight, Math.round(node.height - deltaY))
        return {
          height,
          width: node.width,
          x: node.x,
          y: node.y + node.height - height,
        }
      }
      case "bottom":
        return {
          height: Math.max(minHeight, Math.round(node.height + deltaY)),
          width: node.width,
          x: node.x,
          y: node.y,
        }
      default:
        return {
          height: node.height,
          width: node.width,
          x: node.x,
          y: node.y,
        }
    }
  })()

  // 未开吸附时 snapCanvasResizeToGrid 原样返回 —— 行为与改造前完全一致
  return snapCanvasResizeToGrid(
    node,
    geometry,
    {
      bottom: side === "bottom",
      left: side === "left",
      right: side === "right",
      top: side === "top",
    },
    grid,
    minHeight,
    minWidth,
  )
}

export function resizeCanvasNodeFromCorner(
  node: CanvasNode,
  deltaX: number,
  deltaY: number,
  grid?: CanvasGridSettings,
): { height: number, width: number, x: number, y: number } {
  const minHeight = node.type === "group" ? MIN_GROUP_HEIGHT : MIN_NODE_HEIGHT

  // 角缩放只动右下两条边（左上角固定）
  return snapCanvasResizeToGrid(
    node,
    {
      height: Math.max(minHeight, Math.round(node.height + deltaY)),
      width: Math.max(MIN_NODE_WIDTH, Math.round(node.width + deltaX)),
      x: node.x,
      y: node.y,
    },
    { bottom: true, right: true },
    grid,
    minHeight,
    MIN_NODE_WIDTH,
  )
}

export function findNearestCanvasAnchor(
  nodes: CanvasNode[],
  point: { x: number, y: number },
  options: {
    excludeNodeId?: string
    maxDistance?: number
  } = {},
): CanvasAnchorTarget | null {
  const maxDistance = options.maxDistance ?? CONNECTION_SNAP_DISTANCE
  let nearest: CanvasAnchorTarget | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const node of nodes) {
    if (node.id === options.excludeNodeId) {
      continue
    }

    for (const side of ["top", "right", "bottom", "left"] as CanvasSide[]) {
      const anchor = getCanvasNodeAnchor(node, side)
      const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y)
      if (distance > maxDistance || distance >= nearestDistance) {
        continue
      }

      nearest = {
        nodeId: node.id,
        side,
        x: anchor.x,
        y: anchor.y,
      }
      nearestDistance = distance
    }
  }

  return nearest
}
