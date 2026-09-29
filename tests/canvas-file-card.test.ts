/* @vitest-environment jsdom */

import {
  readFileSync,
} from 'node:fs'
import {
  resolve,
} from 'node:path'
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { mount } from '@vue/test-utils'

import CanvasFileCard from '@/components/canvas/CanvasFileCard.vue'

function createFileNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    file: '/data/spec.sy',
    height: 180,
    type: 'file',
    width: 320,
    x: 0,
    y: 0,
    ...overrides,
  }
}

describe('CanvasFileCard', () => {
  it('renders a document preview card with tooltip and emits preview image fallback events', async () => {
    const node = createFileNode()
    const wrapper = mount(CanvasFileCard, {
      props: {
        documentPreviewHtml: '<p><img src="/data/assets/road.png" alt="road"></p>',
        imageSrc: undefined,
        node,
        preview: {
          badge: 'Document',
          detail: '/Projects/Canvas/Spec',
          headline: 'Spec',
          helper: 'Opens in SiYuan',
          kind: 'document',
        },
        showDetail: false,
        showHeadline: true,
        tooltip: '/Projects/Canvas/Spec',
      },
    })

    expect(wrapper.attributes('title')).toBe('/Projects/Canvas/Spec')
    expect(wrapper.text()).toContain('Spec')
    expect(wrapper.find('.file-card__document-preview').html()).toContain('/data/assets/road.png')

    await wrapper.find('.file-card__document-preview img').trigger('error')

    expect(wrapper.emitted('preview-image-error')).toEqual([[node, expect.any(Object)]])
  })

  /**
   * ★ 第 33 轮：画布卡片改版 ★
   *
   * 用户要求「顶部标题改为 画布文件，下面是文件名称，然后是路径。
   *          后面就没有了。删除现在的预览。和 open nested canvas.」
   *
   * 所以这条用例从"渲染缩略图"改为守三条新契约：
   *   1. **不再有** `.file-card__canvas-preview`（SVG 缩略图）
   *   2. **不再有** helper 行
   *   3. 正文两行：**文件名**（粗体）+ **路径**（灰色）
   *
   * ★ 第 35 轮再改：由"三行"收敛为"两行" ★
   *   用户反馈「网盘文库 和 画布 文件 块的 风格不一样。需要调整 画布文件块。」
   *   原来正文第一行是固定标题「画布文件」，而网盘卡片的抬头才是类型名、
   *   正文第一行是文件名 ⇒ 两张卡片结构不一致。
   *   现在统一：**抬头** = 类型名「画布文件」（由 CanvasWorkspace 出，不在本组件），
   *   正文 = 文件名 + 路径两行，与网盘卡片同构。
   *   ⇒ 本用例改为传 `showHeadline: false`（父组件对画布卡片的实际取值），
   *     并断言正文不再出现「画布文件」这个固定标题。
   */
  it('renders the canvas card body as two lines (file name + path) without preview or helper', async () => {
    const node = createFileNode({
      file: 'assets/road.png',
      id: 'file-image-1',
    })
    const wrapper = mount(CanvasFileCard, {
      props: {
        canvasHeadline: '画布文件',
        // 传了也不该被渲染 —— 组件已不再消费它
        canvasThumbnailViewBox: '0 0 100 64',
        documentPreviewHtml: '',
        imageSrc: '/data/assets/road.png',
        node,
        preview: {
          badge: 'Canvas',
          detail: 'road.canvas',
          headline: 'road.canvas',
          helper: '',
          kind: 'canvas',
          pathLine: '/data/storage/siyuan-canvas/road.canvas',
          thumbnail: {
            edges: [{
              fromX: 10,
              fromY: 10,
              toX: 90,
              toY: 54,
            }],
            nodes: [{
              height: 32,
              width: 48,
              x: 0,
              y: 0,
            }],
          },
        },
        showDetail: true,
        // ★ 父组件对画布卡片实际传的就是 false（标题已移到卡片抬头）
        showHeadline: false,
        tooltip: '/data/storage/siyuan-canvas/road.canvas',
      },
    })

    // 1. 预览已删除
    expect(wrapper.find('.file-card__canvas-preview').exists()).toBe(false)
    expect(wrapper.find('.file-card__thumbnail').exists()).toBe(false)
    // 2. helper 不再渲染
    expect(wrapper.find('.file-card__helper').exists()).toBe(false)
    // 3. 正文两行：文件名（粗体行）+ 路径
    //    ★ 「画布文件」这个固定标题**不在本组件里**（它归卡片抬头）
    expect(wrapper.find('.file-card__canvas-name').text()).toBe('road.canvas')
    expect(wrapper.find('.file-card__path-line').text()).toBe('/data/storage/siyuan-canvas/road.canvas')
    expect(wrapper.text()).not.toContain('画布文件')

    // 图片兜底事件不受影响（这条通路与画布改版无关）
    expect(wrapper.find('.file-card__image').attributes('src')).toBe('/data/assets/road.png')
    await wrapper.find('.file-card__image').trigger('error')
    expect(wrapper.emitted('image-error')).toEqual([[node]])
  })

  it('lets file previews grow with the resized card instead of clamping to a fixed preview height', () => {
    const stylesheet = readFileSync(resolve(__dirname, '../src/components/canvas/CanvasFileCard.vue'), 'utf-8')
    const workspaceStylesheet = readFileSync(resolve(__dirname, '../src/components/canvas/canvas-workspace.scss'), 'utf-8')

    expect(stylesheet).toContain('.file-card:has(.file-card__image)')
    expect(stylesheet).toContain('.file-card:has(.file-card__document-preview)')
    expect(stylesheet).toContain('grid-template-rows: auto minmax(0, 1fr);')
    expect(stylesheet).toContain('grid-template-rows: auto auto minmax(0, 1fr);')
    expect(stylesheet).toContain('margin-top: 2px;')
    expect(stylesheet).not.toContain('max-height: 132px;')
    expect(stylesheet).not.toContain('max-height: min(46vh, 320px);')
    expect(workspaceStylesheet).toContain('.file-card:has(.file-card__image)')
    expect(workspaceStylesheet).toContain('.file-card:has(.file-card__document-preview)')
    expect(workspaceStylesheet).toContain('grid-template-rows: auto auto minmax(0, 1fr);')
    expect(workspaceStylesheet).toContain('margin-top: 2px;')
    expect(workspaceStylesheet).toContain('.canvas-node--file .canvas-node__body > [data-canvas-field="note"]')
    expect(workspaceStylesheet).not.toContain('max-height: 132px;')
    expect(workspaceStylesheet).not.toContain('max-height: min(46vh, 320px);')
  })

  /**
   * ★ 缩略图相关的死样式必须一并清掉（第 33 轮）★
   *
   * 模板里的 SVG 预览删了、`.file-card:has(.file-card__canvas-preview)`
   * 这条网格规则也必须删 —— 它给卡片套 `height: 100%`，
   * 而画布卡片现在只有三行文本，被撑满后会留下一大片空白
   * （这正是"删了预览但不删样式"最容易漏的那个副作用）。
   *
   * 用**读源码断言**而不是 mount 后看计算样式：scoped 样式在 jsdom 里
   * 不会真正参与布局，`getComputedStyle` 拿不到这些规则。
   */
  it('drops the dead canvas-thumbnail rules so the three-line card is not stretched', () => {
    const stylesheet = readFileSync(resolve(__dirname, '../src/components/canvas/CanvasFileCard.vue'), 'utf-8')

    /**
     * ★ 必须**先剥注释再断言** ★
     *   组件里留了说明"这一段已删除"的注释，注释里自然会提到被删的类名。
     *   直接对全文断言 `.not.toContain('.file-card__canvas-preview')`
     *   会被自己的注释判为失败 —— 假失败，且看起来像真问题。
     */
    const css = stylesheet
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

    expect(css).not.toContain('.file-card__canvas-preview')
    expect(css).not.toContain('.file-card__thumbnail')
    expect(css).not.toContain(':has(.file-card__canvas-preview)')
    // 路径行的间距：两行信息（文件名 / 路径）之间只要 2px，不能沿用标题的 8px
    expect(css).toContain('.file-card__path-line')
  })
})
