/**
 * 「本机存储」契约消费层：地址转发（独立网页里双击本机文件卡片时用的地址）。
 *
 * 这组断言的核心是**契约硬约束**：
 *   「地址一律由本机存储侧构造，消费方只转发」。
 *   所以测试不去验证"拼出来的 URL 长什么样"（本侧根本不该拼），
 *   而是验证"参数原样传下去、结果原样传上来、失败如实抛出来"。
 */

import { describe, expect, it, vi } from "vitest"

import { LocalFsContractClient } from "@/canvas/localfs-client"

/** 构造一个最小的契约替身（只实现本组用例需要的部分） */
function createContract(overrides: Record<string, unknown> = {}) {
  return {
    id: "localfs.external",
    list: vi.fn(async () => ({ data: { items: [], path: "/" }, ok: true })),
    roots: vi.fn(async () => ({ data: [], ok: true })),
    version: 1,
    ...overrides,
  }
}

describe("LocalFsContractClient.previewUrl / fileUrl", () => {
  it("★ 只做转发：path 原样传下去，地址原样传回来（可能含签名参数，不得改写）★", async () => {
    const previewUrl = vi.fn(async () => ({
      data: "http://host/localfs/docs/preview?path=%2Fvol1%2Fa.pdf&sig=abc",
      ok: true,
    }))
    const client = new LocalFsContractClient(createContract({ previewUrl }) as never)

    const url = await client.previewUrl("/vol1/a.pdf")

    expect(previewUrl).toHaveBeenCalledTimes(1)
    // 任何"整理"都可能让对方定位不到文件
    expect(previewUrl).toHaveBeenCalledWith("/vol1/a.pdf")
    // 结果原样传回 —— 本侧不得改写地址
    expect(url).toBe("http://host/localfs/docs/preview?path=%2Fvol1%2Fa.pdf&sig=abc")
  })

  it("fileUrl 同样只转发", async () => {
    const fileUrl = vi.fn(async () => ({ data: "/localfs/api/file?path=%2Fvol1%2Fa.png", ok: true }))
    const client = new LocalFsContractClient(createContract({ fileUrl }) as never)

    expect(await client.fileUrl("/vol1/a.png")).toBe("/localfs/api/file?path=%2Fvol1%2Fa.png")
  })

  it("契约没有该能力时**明确抛错**，不静默返回空串（调用方靠它给出升级提示）", async () => {
    const client = new LocalFsContractClient(createContract() as never)
    await expect(client.previewUrl("/a.txt")).rejects.toThrow(/未提供「取预览地址」能力/)
    await expect(client.fileUrl("/a.txt")).rejects.toThrow(/未提供「取文件地址」能力/)
  })

  it("失败信封把 reason 翻成人话（区分「不存在」与「连不上」）", async () => {
    const missing = new LocalFsContractClient(
      createContract({ previewUrl: async () => ({ error: "404", ok: false, reason: "missing" }) }) as never,
    )
    await expect(missing.previewUrl("/nope.txt")).rejects.toThrow(/文件或目录不存在/)

    const unreachable = new LocalFsContractClient(
      createContract({ previewUrl: async () => ({ error: "conn refused", ok: false, reason: "unreachable" }) }) as never,
    )
    await expect(unreachable.previewUrl("/a.txt")).rejects.toThrow(/本机存储服务暂时连不上/)
  })

  it("契约返回空地址时抛错（打开一个空 URL 会静默停在本页，比报错更难查）", async () => {
    const client = new LocalFsContractClient(
      createContract({ previewUrl: async () => ({ data: "", ok: true }) }) as never,
    )
    await expect(client.previewUrl("/a.txt")).rejects.toThrow(/未返回预览地址/)
  })
})

describe("LocalFsContractClient 的其它能力", () => {
  it("openFile 只转发载荷，返回布尔", async () => {
    const openFile = vi.fn(async () => ({ data: true, ok: true }))
    const client = new LocalFsContractClient(createContract({ openFile }) as never)

    expect(await client.openFile({ name: "a.pdf", path: "/vol1/a.pdf" })).toBe(true)
    // 载荷形状（name/path 两个键）必须原样透给本机存储侧
    expect(openFile).toHaveBeenCalledWith({ name: "a.pdf", path: "/vol1/a.pdf" })
  })

  it("roots 过滤掉 non-string path（不把脏行当存储空间）", async () => {
    const client = new LocalFsContractClient(
      createContract({
        roots: async () => ({
          data: [{ label: "v1", path: "/vol1" }, { path: "" }, {}],
          ok: true,
        }),
      }) as never,
    )

    expect(await client.roots()).toEqual([{ label: "v1", path: "/vol1" }])
  })

  it("list 裁剪成画布需要的字段，缺 label 时用 path 兜底", async () => {
    const client = new LocalFsContractClient(
      createContract({
        list: async () => ({
          data: {
            items: [
              { isDir: false, name: "a.png", path: "/vol1/a.png", size: 10 },
              { isDir: true, name: "sub", path: "/vol1/sub" },
            ],
            path: "/vol1",
          },
          ok: true,
        }),
      }) as never,
    )

    const items = await client.list("/vol1")
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ isDir: false, name: "a.png", path: "/vol1/a.png", size: 10 })
    expect(items[1].isDir).toBe(true)
  })

  it("probe 失败时返回 null 而不是抛（只用来补文件大小，不能拖垮整张卡片）", async () => {
    const client = new LocalFsContractClient(
      createContract({ probe: async () => ({ error: "404", ok: false, reason: "missing" }) }) as never,
    )
    expect(await client.probe("/nope.png")).toBeNull()

    const noProbe = new LocalFsContractClient(createContract() as never)
    expect(await noProbe.probe("/a.png")).toBeNull()
  })

  it("契约存在即视为已配置（地址探测完全由本机存储插件负责）", () => {
    const client = new LocalFsContractClient(createContract() as never)
    expect(client.isConfigured()).toBe(true)
  })
})
