/**
 * 从 `useCanvasEditor(...)` 返回的对象里取值时的**统一解包**。
 * ============================================================================
 *
 * ★★ 为什么需要它（这类坑在本项目踩过两次）★★
 *
 *   `useCanvasEditor` 返回的是一个**普通对象**，里面装着许多 ref / computed：
 *
 *     return { board, capabilities, colorThemeId, gridSettings, viewport, … }
 *
 *   于是同一个 `editor.xxx` 表达式：
 *     · 在 **`<script setup>` 模板**里 —— 绑定会被 `proxyRefs` 解包 ⇒ 拿到**值**
 *     · 在 **`<script setup>` 脚本**里 —— 拿到的是 **ref 对象本身**
 *
 *   两个后果都很难查，因为它们**都不报错**：
 *     · `editor.gridSettings.style` 全是 undefined ⇒ "设置改了没反应"
 *       （实测：改了网格样式/间距，画布上永远是最初的 32px 方格）
 *     · `editor.board.left` 是 undefined ⇒ 依赖它的坐标偏移静默变成 0
 *       （实测：网格线与卡片位置错开近 2000px，用户报"吸附位置与网格不一致"）
 *
 *   ⇒ 脚本里取值一律走这里；模板里不用（模板已经被解包）。
 *   判据是"有没有 `value` 字段"：本项目的这些对象（board / settings / capabilities …）
 *   都不含 `value` 键，所以不会误判。
 */
export function readCanvasExposedValue<T>(value: T | { value: T } | undefined | null): T | undefined {
  if (value === null || value === undefined) {
    return undefined
  }

  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return (value as { value: T }).value
  }

  return value as T
}

/**
 * 取一个数值字段（自动解包 + 容错）。
 *
 * @param fallback 取不到 / 不是有限数时的回落值
 */
export function readCanvasExposedNumber(value: unknown, key: string, fallback = 0): number {
  const target = readCanvasExposedValue(value as { value?: unknown }) as Record<string, unknown> | undefined
  const raw = target ? target[key] : undefined
  const numeric = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(numeric) ? numeric : fallback
}
