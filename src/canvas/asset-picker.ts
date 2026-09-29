import type { SiyuanSearchAssetResult } from "@/canvas/siyuan-file-node-lookups"

/**
 * 「思源资源」选择器条目 —— 内核资源 → 展示所需的最小字段集。
 *
 * ★ 为什么放在独立的 .ts 而不是组件里 ★
 *   Vue 的 `<script setup>` **不允许 `export` 语句**（编译期报
 *   "<script setup> cannot contain ES module exports"）。
 *   而父组件需要这个类型来约束注入的搜索函数 ⇒ 必须抽到模块里。
 */
export interface CanvasAssetPickerOption {
  /** 落库用路径，形如 `assets/x.png`（assets 表 path 字段原样） */
  path: string
  /** 展示名 */
  name: string
  /** 类型徽标，如 PNG / PDF */
  badge: string
  /** 右侧补充信息；为空则不渲染 */
  detail: string
}

/** 从文件名取类型徽标；取不到（无扩展名 / 超长）时回落 FILE */
export function getAssetBadge(path: string): string {
  const clean = (path || "").split(/[?#]/)[0]
  const fileName = clean.split(/[/\\]/).pop() || ""
  const dot = fileName.lastIndexOf(".")
  if (dot <= 0 || dot >= fileName.length - 1) {
    return "FILE"
  }

  const ext = fileName.slice(dot + 1).trim()
  return ext && ext.length <= 8 ? ext.toUpperCase() : "FILE"
}

/**
 * 把内核检索结果映射成选择器条目。
 *
 * `detail` 只在**存储名与展示名不同**时填写 —— 思源里资源被重命名后
 * `name`（磁盘上的存储名，带 hash 后缀）与展示名可能不一致，
 * 这时把存储名露出来有助于用户区分同名项；一致时留空避免视觉噪音。
 */
export function toAssetPickerOption(asset: SiyuanSearchAssetResult): CanvasAssetPickerOption {
  const displayName = asset.name || asset.title || asset.path
  const storedName = asset.path.split("/").pop() || ""
  const detail = storedName && storedName !== displayName ? storedName : ""

  return {
    badge: getAssetBadge(asset.path),
    detail,
    name: displayName,
    path: asset.path,
  }
}
