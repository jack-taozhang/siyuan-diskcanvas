/* @vitest-environment jsdom */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { SiyuanCanvasTextGateway } from '@/canvas/siyuan-text-gateway'

describe('SiyuanCanvasTextGateway', () => {
  const originalRequire = (window as any).require
  const originalFetch = window.fetch

  beforeEach(() => {
    delete (window as any).require
    window.fetch = vi.fn()
  })

  afterEach(() => {
    (window as any).require = originalRequire
    window.fetch = originalFetch
  })

  it('reads external local canvas file via Node fs module', async () => {
    const mockReadFile = vi.fn(async () => '{"nodes":[],"edges":[]}')
    ;(window as any).require = vi.fn((mod: string) => {
      if (mod === 'fs') {
        return { promises: { readFile: mockReadFile } }
      }
      return null
    })

    const gateway = new SiyuanCanvasTextGateway()
    const content = await gateway.readText('D:\\MyCodingProjects\\test.canvas')

    expect(content).toBe('{"nodes":[],"edges":[]}')
    expect(mockReadFile).toHaveBeenCalledWith('D:\\MyCodingProjects\\test.canvas', 'utf-8')
    expect(window.fetch).not.toHaveBeenCalled()
  })

  it('writes external local canvas file via Node fs module', async () => {
    const mockWriteFile = vi.fn(async () => {})
    ;(window as any).require = vi.fn((mod: string) => {
      if (mod === 'fs') {
        return { promises: { writeFile: mockWriteFile } }
      }
      return null
    })

    const gateway = new SiyuanCanvasTextGateway()
    await gateway.writeText('D:\\MyCodingProjects\\test.canvas', '{"nodes":[]}')

    expect(mockWriteFile).toHaveBeenCalledWith('D:\\MyCodingProjects\\test.canvas', '{"nodes":[]}', 'utf-8')
    expect(window.fetch).not.toHaveBeenCalled()
  })

  it('falls back to /api/file/getFile for workspace canvas paths', async () => {
    ;(window.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"nodes":[]}',
    })

    const gateway = new SiyuanCanvasTextGateway()
    const content = await gateway.readText('/data/storage/petal/siyuan-canvas/demo.canvas')

    expect(content).toBe('{"nodes":[]}')
    expect(window.fetch).toHaveBeenCalledWith('/api/file/getFile', expect.objectContaining({
      body: JSON.stringify({ path: '/data/storage/petal/siyuan-canvas/demo.canvas' }),
    }))
  })
})
