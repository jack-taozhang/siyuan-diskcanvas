/**
 * 交互能力策略的规格测试 —— 把「能力矩阵」变成**可执行文档**。
 *
 * 这些断言的唯一目的：任何人改 `resolveCanvasInteractionPolicy` 时，
 * 如果动了行为，必须**显式**改这里的期望值（而不是悄悄改变预览语义）。
 */
import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  describeReadonlySources,
  resolveCanvasInteractionPolicy,
} from '@/canvas/canvas-interaction-policy'

/** 构造信号（默认全 false）。 */
function signals(input: Partial<{ conflict: boolean, mobile: boolean, embed: boolean }> = {}) {
  return {
    conflict: input.conflict ?? false,
    mobile: input.mobile ?? false,
    embed: input.embed ?? false,
  }
}

describe('resolveCanvasInteractionPolicy', () => {
  describe('编辑态（无任何只读来源）', () => {
    const policy = resolveCanvasInteractionPolicy(signals())

    it('readonly 为 false，且没有只读来源', () => {
      expect(policy.readonly).toBe(false)
      expect(policy.readonlySources).toEqual([])
      expect(policy.embedPreview).toBe(false)
    })

    it('全部能力开放', () => {
      expect(policy.capabilities).toEqual({
        editDocument: true,
        persist: true,
        select: true,
        marquee: true,
        createByDoubleClick: true,
        renderNodeHandles: true,
        openNodeTab: true,
        zoom: true,
        pan: true,
      })
    })
  })

  describe('嵌入预览（本插件的核心场景）', () => {
    const policy = resolveCanvasInteractionPolicy(signals({ embed: true }))

    it('readonly 为 true，来源仅 embed，embedPreview 为 true', () => {
      expect(policy.readonly).toBe(true)
      expect(policy.readonlySources).toEqual(['embed'])
      expect(policy.embedPreview).toBe(true)
    })

    it('★ 保留：缩放与平移（用户核心要求「只显示 + 放大缩小 + 右键平移」）★', () => {
      expect(policy.capabilities.zoom).toBe(true)
      expect(policy.capabilities.pan).toBe(true)
    })

    it('★ 禁止：改文档 / 选中 / 框选 / 双击新建 / 把手 / 开页签 / 落盘 ★', () => {
      expect(policy.capabilities.editDocument).toBe(false)
      expect(policy.capabilities.select).toBe(false)
      expect(policy.capabilities.marquee).toBe(false)
      expect(policy.capabilities.createByDoubleClick).toBe(false)
      expect(policy.capabilities.renderNodeHandles).toBe(false)
      expect(policy.capabilities.openNodeTab).toBe(false)
      expect(policy.capabilities.persist).toBe(false)
    })
  })

  describe('文档冲突', () => {
    const policy = resolveCanvasInteractionPolicy(signals({ conflict: true }))

    it('readonly 为 true，来源仅 conflict', () => {
      expect(policy.readonly).toBe(true)
      expect(policy.readonlySources).toEqual(['conflict'])
    })

    it('★ 仍可落盘与开页签（否则用户无法解决冲突）★', () => {
      expect(policy.capabilities.persist).toBe(true)
      expect(policy.capabilities.openNodeTab).toBe(true)
    })

    it('禁改文档 / 禁选中 / 禁框选 / 禁把手', () => {
      expect(policy.capabilities.editDocument).toBe(false)
      expect(policy.capabilities.select).toBe(false)
      expect(policy.capabilities.marquee).toBe(false)
      expect(policy.capabilities.renderNodeHandles).toBe(false)
      expect(policy.capabilities.createByDoubleClick).toBe(false)
    })

    it('缩放与平移仍保留', () => {
      expect(policy.capabilities.zoom).toBe(true)
      expect(policy.capabilities.pan).toBe(true)
    })
  })

  describe('移动端', () => {
    const policy = resolveCanvasInteractionPolicy(signals({ mobile: true }))

    it('readonly 为 true，来源仅 mobile', () => {
      expect(policy.readonly).toBe(true)
      expect(policy.readonlySources).toEqual(['mobile'])
    })

    it('★ 仍可落盘（移动端必须能保存）与开页签', () => {
      expect(policy.capabilities.persist).toBe(true)
      expect(policy.capabilities.openNodeTab).toBe(true)
    })

    it('禁改文档 / 禁选中', () => {
      expect(policy.capabilities.editDocument).toBe(false)
      expect(policy.capabilities.select).toBe(false)
    })
  })

  describe('多来源叠加', () => {
    it('来源按 conflict → mobile → embed 顺序列出，readonly 仍为 true', () => {
      const policy = resolveCanvasInteractionPolicy(signals({ conflict: true, mobile: true, embed: true }))
      expect(policy.readonly).toBe(true)
      expect(policy.readonlySources).toEqual(['conflict', 'mobile', 'embed'])
      expect(policy.embedPreview).toBe(true)
      // embed 在场 ⇒ 落盘被禁
      expect(policy.capabilities.persist).toBe(false)
    })
  })

  describe('describeReadonlySources', () => {
    it('空数组 → none', () => {
      expect(describeReadonlySources([])).toBe('none')
    })

    it('单来源', () => {
      expect(describeReadonlySources(['embed'])).toBe('embed')
    })

    it('多来源用 + 连接', () => {
      expect(describeReadonlySources(['conflict', 'embed'])).toBe('conflict+embed')
    })
  })
})
