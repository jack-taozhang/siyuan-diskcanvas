// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { looseJsonParse, renderEchartsBlocksDirectly, renderMermaidBlocksDirectly, triggerNativeProtyleRender, unescapeHtmlEntities } from '@/canvas/protyle-native-render'

describe('protyle-native-render', () => {
  const envGlobal = (typeof globalThis !== 'undefined' ? globalThis : global) as any

  beforeEach(() => {
    if (!envGlobal.window) {
      envGlobal.window = envGlobal
    }
    delete envGlobal.window.Protyle
    delete envGlobal.window.siyuan
    delete envGlobal.window.mermaid
    delete envGlobal.window.echarts
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should correctly unescape HTML entities in data-content', () => {
    const raw = 'graph TD&#10;    A[开始] --&gt; B{判断条件}&#10;    B --&gt;|是| C[操作A]&amp;'
    const expected = 'graph TD\n    A[开始] --> B{判断条件}\n    B -->|是| C[操作A]&'
    expect(unescapeHtmlEntities(raw)).toBe(expected)
  })

  it('should safely do nothing when container is null or undefined', () => {
    expect(() => triggerNativeProtyleRender(null)).not.toThrow()
    expect(() => triggerNativeProtyleRender(undefined)).not.toThrow()
  })

  it('should trigger Protyle.mermaidRender when mermaid block is present', () => {
    const mermaidRender = vi.fn()
    envGlobal.window.Protyle = {
      mermaidRender,
    }

    const container = document.createElement('div')
    container.innerHTML = '<div data-type="NodeCodeBlock" class="render-node" data-subtype="mermaid" data-content="graph TD\n  A --> B"><div spin="1"></div></div>'

    triggerNativeProtyleRender(container)

    expect(mermaidRender).toHaveBeenCalledTimes(1)
    expect(mermaidRender).toHaveBeenCalledWith(container, 'stage/protyle')
  })

  it('should directly render SVG when window.mermaid is present and unescape content', async () => {
    const renderFn = vi.fn().mockResolvedValue({ svg: '<svg class="mermaid-svg"><text>Rendered Flowchart</text></svg>' })
    envGlobal.window.mermaid = {
      render: renderFn,
    }

    const container = document.createElement('div')
    container.innerHTML = '<div data-type="NodeCodeBlock" class="render-node" data-subtype="mermaid" data-content="graph TD&#10;  A[Start] --&gt; B[End]"><div spin="1"></div></div>'

    await renderMermaidBlocksDirectly(container)

    expect(renderFn).toHaveBeenCalledTimes(1)
    expect(renderFn.mock.calls[0]![1]).toBe('graph TD\n  A[Start] --> B[End]')
    expect(container.innerHTML).toContain('mermaid-svg')
    expect(container.querySelector('[data-subtype="mermaid"]')?.getAttribute('data-mermaid-rendered')).toBe('true')
  })

  it('should trigger Protyle.mathRender, flowchartRender and chartRender when respective nodes exist', () => {
    const mathRender = vi.fn()
    const flowchartRender = vi.fn()
    const chartRender = vi.fn()
    envGlobal.window.Protyle = {
      mathRender,
      flowchartRender,
      chartRender,
    }

    const container = document.createElement('div')
    container.innerHTML = `
      <div data-subtype="math"></div>
      <div data-subtype="flowchart"></div>
      <div data-subtype="echarts"></div>
    `

    triggerNativeProtyleRender(container)

    expect(mathRender).toHaveBeenCalledWith(container, 'stage/protyle')
    expect(flowchartRender).toHaveBeenCalledWith(container, 'stage/protyle')
    expect(chartRender).toHaveBeenCalledWith(container, 'stage/protyle')
  })

  it('should correctly parse loose json content', () => {
    const looseJson = '{ title: { text: "Loose Chart" }, }'
    const result = looseJsonParse(looseJson)
    expect(result.title.text).toBe('Loose Chart')
  })

  it('should directly render echarts instance when window.echarts is present', async () => {
    const setOptionFn = vi.fn()
    const initFn = vi.fn().mockReturnValue({ setOption: setOptionFn })
    envGlobal.window.echarts = {
      init: initFn,
      getInstanceById: vi.fn().mockReturnValue(null),
    }

    const container = document.createElement('div')
    container.innerHTML = '<div data-type="NodeCodeBlock" class="render-node" data-subtype="echarts" data-content="{title:{text:&quot;Chart&quot;}}"><div spin="1"></div><div contenteditable="false"></div></div>'

    await renderEchartsBlocksDirectly(container)

    expect(initFn).toHaveBeenCalledTimes(1)
    expect(setOptionFn).toHaveBeenCalledWith({ title: { text: 'Chart' } }, true)
    const node = container.querySelector('[data-subtype="echarts"]')
    expect(node?.getAttribute('data-render')).toBe('true')
    expect(node?.getAttribute('data-echarts-rendered')).toBe('true')
  })

  it('should cleanly re-init chart and remove stale instance attribute when no canvas exists', async () => {
    const setOptionFn = vi.fn()
    const initFn = vi.fn().mockReturnValue({ setOption: setOptionFn })

    envGlobal.window.echarts = {
      init: initFn,
      getInstanceById: vi.fn(),
    }

    const container = document.createElement('div')
    container.innerHTML = '<div data-type="NodeCodeBlock" class="render-node" data-subtype="echarts" data-content="{title:{text:&quot;Chart&quot;}}"><div spin="1"></div><div _echarts_instance_="stale_123" contenteditable="false"></div></div>'

    await renderEchartsBlocksDirectly(container)

    expect(initFn).toHaveBeenCalledTimes(1)
    expect(setOptionFn).toHaveBeenCalledWith({ title: { text: 'Chart' } }, true)
    const target = container.querySelector('div[contenteditable="false"]')
    expect(target?.hasAttribute('_echarts_instance_')).toBe(false)
  })
})
