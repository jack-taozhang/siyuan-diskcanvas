/**
 * 图标体系单一入口。
 *
 * 项目中三处需要图标 SVG：
 *  1. `<CanvasIcon name="..." />` Vue 组件 — 走 {@link getCanvasIconMarkup} 字典查表
 *  2. 思源顶栏 `addTopBar({ icon: '<svg>...</svg>' })` — 直接接收完整 SVG 字符串 → {@link TOPBAR_ICON_SVG}
 *  3. 思源 sprite `addIcons('<symbol id="X" viewBox="...">...</symbol>')` — 接收 `<symbol>` 体（不含 svg 包裹）→ {@link CANVAS_TAB_ICON_BODY}
 *
 * 这里集中收口，未来若迁移到 `vite-svg-loader`，调用方只需改 import 路径而非搜索散落各处的 SVG 字面量。
 */

export {
  CanvasIcon,
  getCanvasIconMarkup,
} from '@/components/canvas/canvas-icon'
export type { CanvasIconName } from '@/components/canvas/canvas-icon'

import { getCanvasIconMarkup } from '@/components/canvas/canvas-icon'

/**
 * ★ 画布图标（2026-09-29 换新）★
 *
 * 用户：「思源界面里面的图标也更新一下，包括 / 插入的图标也要更新一下」。
 *
 * 这三个入口**共用同一份图形**，所以在这里定义一次、两处派生，
 * 避免将来只改了其中一处导致顶栏与页签图标不一致：
 *   · 思源顶栏 / 页签（sprite `iconCanvasTab`）
 *   · `/` 斜杠插入菜单里的条目图标（引用同一个 sprite id）
 *   · `icon.png`（集市/设置里显示）—— 与这里同形，但由构建时栅格化产出
 *
 * 设计：圆角画布框 + 淡网格 + 三个色点（琥珀 / 主题色 / 青）。
 * 描边与其中一个点用 `currentColor`，因此**跟随主题明暗自动适配**，
 * 两个品牌色点（琥珀、青）保留以提高辨识度。
 */
const CANVAS_ICON_VIEWBOX = '0 0 48 48'
const CANVAS_ICON_BODY = [
  '<rect x="6" y="6" width="36" height="36" rx="7" fill="none" stroke="currentColor" stroke-width="3"/>',
  '<g stroke="currentColor" stroke-width="1.1" opacity="0.28">',
  '<path d="M18 6V42 M30 6V42 M6 18H42 M6 30H42"/>',
  '</g>',
  '<circle cx="18" cy="18" r="4.6" fill="#f5a524"/>',
  '<circle cx="30" cy="18" r="4.6" fill="currentColor"/>',
  '<circle cx="30" cy="30" r="4.6" fill="#14b8a6"/>',
].join('')

/** 思源顶栏图标，完整 `<svg>` 字符串 */
export const TOPBAR_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CANVAS_ICON_VIEWBOX}" width="1em" height="1em">${CANVAS_ICON_BODY}</svg>`

/** 思源 Tab 图标 sprite ID（addIcons 注册后用 `iconCanvasTab` 引用） */
export const CANVAS_TAB_ICON_ID = 'iconCanvasTab'

/**
 * 思源 Tab / 斜杠菜单图标 sprite 体：
 * 仅 `<symbol id="iconCanvasTab" viewBox="0 0 48 48">…</symbol>` 的内部内容。
 * 与顶栏共用同一图形，通过 `currentColor` 继承高亮态颜色。
 */
export const CANVAS_TAB_ICON_BODY = CANVAS_ICON_BODY
