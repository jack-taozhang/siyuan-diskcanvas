/**
 * 网盘契约适配层：`webUrl`（独立网页双击网盘卡片时用的地址）。
 *
 * 这一组断言的核心是**约束 C-4**：
 *   「URL 一律由网盘侧构造，消费方只转发」。
 *   所以测试不去验证"拼出来的 URL 长什么样"（本侧根本不该拼），
 *   而是验证"参数原样传下去、结果原样传上来、失败如实抛出来"。
 */

import { describe, expect, it, vi } from "vitest"

import { NebulaExternalClient } from "@/canvas/nebula-external-bridge"

/** 构造一个最小的契约替身（只实现本组用例需要的部分） */
function createContract(overrides: Record<string, unknown> = {}) {
  return {
    id: "nebuladisk.external",
    list: vi.fn(async () => ({ data: [], ok: true })),
    listMounts: vi.fn(async () => ({ data: [], ok: true })),
    stat: vi.fn(async () => ({ data: null, ok: true })),
    version: 1,
    ...overrides,
  }
}

describe("NebulaExternalClient.webUrl", () => {
  it("★ 只做转发：mount / path / name 原样传给网盘侧，返回值原样传回 ★", async () => {
    const webUrl = vi.fn(async () => ({ data: "http://host:8089/preview/onlinePreview?x=1", ok: true }))
    const client = new NebulaExternalClient(createContract({ webUrl }) as never)

    const url = await client.webUrl("Docker操作", "/照片/a.png", "a.png")

    expect(webUrl).toHaveBeenCalledTimes(1)
    // 参数必须**原样**传下去 —— 任何"整理"都可能让网盘侧定位不到文件
    expect(webUrl).toHaveBeenCalledWith("Docker操作", "/照片/a.png", "a.png")
    // 结果必须**原样**传回来 —— 本侧不得改写地址（可能含签名参数）
    expect(url).toBe("http://host:8089/preview/onlinePreview?x=1")
  })

  it("不传文件名时也要转发（网盘侧会用 path 末段兜底）", async () => {
    const webUrl = vi.fn(async () => ({ data: "http://h/u", ok: true }))
    const client = new NebulaExternalClient(createContract({ webUrl }) as never)

    await client.webUrl("m", "/a/b.txt")
    expect(webUrl).toHaveBeenCalledWith("m", "/a/b.txt", undefined)
  })

  it("契约没有 webUrl 时**明确抛错**，不静默返回空串（调用方靠它给出升级提示）", async () => {
    const client = new NebulaExternalClient(createContract() as never)
    await expect(client.webUrl("m", "/a.txt")).rejects.toThrow(/网盘未提供「网页打开地址」能力/)
  })

  it("契约返回失败信封时把 reason 翻成人话（区分「不存在」与「连不上」）", async () => {
    const missing = new NebulaExternalClient(
      createContract({ webUrl: async () => ({ error: "404", ok: false, reason: "missing" }) }) as never,
    )
    await expect(missing.webUrl("m", "/nope.txt")).rejects.toThrow(/文件或目录不存在/)

    const unreachable = new NebulaExternalClient(
      createContract({ webUrl: async () => ({ error: "conn refused", ok: false, reason: "unreachable" }) }) as never,
    )
    await expect(unreachable.webUrl("m", "/a.txt")).rejects.toThrow(/网盘暂时连不上/)
  })

  it("契约返回空地址时抛错（打开一个空 URL 会静默停在本页，比报错更难查）", async () => {
    const client = new NebulaExternalClient(
      createContract({ webUrl: async () => ({ data: "", ok: true }) }) as never,
    )
    await expect(client.webUrl("m", "/a.txt")).rejects.toThrow(/网盘未返回网页打开地址/)
  })
})

describe("NebulaExternalClient 的既有能力不受影响", () => {
  it("previewUrl / cadUrl 依旧只转发", async () => {
    const previewUrl = vi.fn(async () => ({ data: "/preview/onlinePreview?f=1", ok: true }))
    const cadUrl = vi.fn(async () => ({ data: "/cad/?open=1", ok: true }))
    const client = new NebulaExternalClient(createContract({ cadUrl, previewUrl }) as never)

    expect(await client.previewUrl("m", "/a.pdf")).toBe("/preview/onlinePreview?f=1")
    expect(await client.cadUrl("m", "/a.dwg")).toBe("/cad/?open=1")
  })

  it("契约存在即视为已配置（登录由网盘插件负责）", () => {
    const client = new NebulaExternalClient(createContract() as never)
    expect(client.isConfigured()).toBe(true)
  })
})
