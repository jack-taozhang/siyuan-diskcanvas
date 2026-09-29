/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import {
  findCanvasLinkHrefFromElements,
  isCanvasLinkClick,
  resolveCanvasLinkTarget,
} from '@/canvas/canvas-link-observer'

describe('resolveCanvasLinkTarget', () => {
  it('resolves relative asset paths to /data/assets/...', () => {
    const result = resolveCanvasLinkTarget('assets/测试1-20260811222339-5ddw3pk.canvas')
    expect(result).toEqual({
      isCanvasLink: true,
      isExternal: false,
      path: '/data/assets/测试1-20260811222339-5ddw3pk.canvas',
    })
  })

  it('resolves leading slash asset paths to /data/assets/...', () => {
    const result = resolveCanvasLinkTarget('/assets/demo.canvas')
    expect(result).toEqual({
      isCanvasLink: true,
      isExternal: false,
      path: '/data/assets/demo.canvas',
    })
  })

  it('resolves file:// URLs pointing inside SiYuan data storage', () => {
    const result = resolveCanvasLinkTarget(
      'file://D:\\SiYuan_data\\data\\storage\\petal\\siyuan-canvas\\测试1.canvas',
    )
    expect(result).toEqual({
      isCanvasLink: true,
      isExternal: false,
      path: '/data/storage/petal/siyuan-canvas/测试1.canvas',
    })
  })

  it('resolves file:/// URLs with encoded URI components pointing to assets', () => {
    const result = resolveCanvasLinkTarget(
      'file:///D:/SiYuan_data/data/assets/%E6%B5%8B%E8%AF%951-2026.canvas?v=123#heading',
    )
    expect(result).toEqual({
      isCanvasLink: true,
      isExternal: false,
      path: '/data/assets/测试1-2026.canvas',
    })
  })

  it('resolves storage/ relative paths to /data/storage/...', () => {
    const result = resolveCanvasLinkTarget('storage/petal/siyuan-canvas/my-canvas.canvas')
    expect(result).toEqual({
      isCanvasLink: true,
      isExternal: false,
      path: '/data/storage/petal/siyuan-canvas/my-canvas.canvas',
    })
  })

  it('marks file:// URLs outside the workspace as external', () => {
    const result = resolveCanvasLinkTarget('file://C:\\Users\\Administrator\\Desktop\\external.canvas')
    expect(result).toEqual({
      isCanvasLink: true,
      isExternal: true,
      path: 'C:/Users/Administrator/Desktop/external.canvas',
    })
  })

  it('ignores non-canvas links', () => {
    expect(resolveCanvasLinkTarget('assets/image.png')).toEqual({
      isCanvasLink: false,
      isExternal: false,
      path: '',
    })
    expect(resolveCanvasLinkTarget('https://siyuan-note.org')).toEqual({
      isCanvasLink: false,
      isExternal: false,
      path: '',
    })
  })
})

describe('findCanvasLinkHrefFromElements & isCanvasLinkClick', () => {
  it('extracts data-href from span[data-type="a"]', () => {
    const span = document.createElement('span')
    span.setAttribute('data-type', 'a')
    span.setAttribute('data-href', 'assets/test.canvas')

    const href = findCanvasLinkHrefFromElements([span])
    expect(href).toBe('assets/test.canvas')
  })

  it('extracts href from <a> tag', () => {
    const anchor = document.createElement('a')
    anchor.setAttribute('href', 'file://D:/SiYuan_data/data/storage/test.canvas')

    const href = findCanvasLinkHrefFromElements([anchor])
    expect(href).toBe('file://D:/SiYuan_data/data/storage/test.canvas')
  })

  it('returns empty string if element is inside an iframe', () => {
    const iframe = document.createElement('iframe')
    const span = document.createElement('span')
    span.setAttribute('data-href', 'assets/test.canvas')

    const href = findCanvasLinkHrefFromElements([span, iframe])
    expect(href).toBe('')
  })

  it('correctly identifies a click event on a canvas link element', () => {
    const span = document.createElement('span')
    span.setAttribute('data-type', 'a')
    span.setAttribute('data-href', 'assets/test.canvas')
    document.body.appendChild(span)

    const event = new MouseEvent('click', { bubbles: true })
    span.dispatchEvent(event)

    expect(isCanvasLinkClick(event)).toBe(true)

    document.body.removeChild(span)
  })
})
