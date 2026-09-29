/* @vitest-environment jsdom */

/**
 * `getNebulaClient()` 对**契约对象更换**的响应。
 *
 * 背景（真机踩过）：
 *   网盘插件每次重载都会给 `window.__nebuladiskPlugin` **赋一个新对象**。
 *   适配器原本写成 `externalClient ??= new NebulaExternalClient(contract)`，
 *   于是它**永远抱着第一次那个对象** —— 网盘插件升级后画布仍在调旧代码。
 *   实测表现：网盘侧修好了 `webUrl`（原来漏 await，会返回字符串
 *   `"[object Promise]"`），独立页里的画布却依旧拿到占位串。
 *
 * 这里把"契约换对象必须重建适配器"钉死成单测。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getNebulaClient, refreshNebulaClient } from "@/canvas/nebula-client-provider"

/** 造一个最小可用契约（getNebulaExternalContract 会校验这三个方法在场） */
function createContract(marker: string) {
  return {
    id: "nebuladisk.external",
    list: vi.fn(async () => ({ data: [], ok: true })),
    listMounts: vi.fn(async () => ({ data: [], ok: true })),
    previewUrl: vi.fn(async () => ({ data: `preview:${marker}`, ok: true })),
    stat: vi.fn(async () => ({ data: null, ok: true })),
    version: 1,
    webUrl: vi.fn(async () => ({ data: `web:${marker}`, ok: true })),
  }
}

function installPlugin(contract: unknown) {
  ;(window as unknown as Record<string, unknown>).__nebuladiskPlugin = { external: contract }
}

describe("getNebulaClient 与网盘契约的身份绑定", () => {
  beforeEach(() => {
    refreshNebulaClient()
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__nebuladiskPlugin
    refreshNebulaClient()
  })

  it("有契约时返回契约适配器，并视为「已配置」", () => {
    installPlugin(createContract("a"))
    const client = getNebulaClient()
    expect(client).not.toBeNull()
    expect(client?.isConfigured()).toBe(true)
    expect(client?.webUrl).toBeTypeOf("function")
  })

  it("★ 契约换成新对象后必须重建适配器（否则插件升级后仍在调旧代码）★", async () => {
    installPlugin(createContract("v1"))
    const first = getNebulaClient()
    expect(await first!.webUrl!("m", "/a.pdf")).toBe("web:v1")

    // 模拟"网盘插件重载"：换一个全新的契约对象
    installPlugin(createContract("v2"))
    const second = getNebulaClient()

    expect(second).not.toBe(first)
    expect(await second!.webUrl!("m", "/a.pdf")).toBe("web:v2")
    // 旧适配器仍绑着旧契约 —— 这正是没有重建时会发生的"调旧代码"
    expect(await first!.webUrl!("m", "/a.pdf")).toBe("web:v1")
  })

  it("契约对象**没换**时不重建（不能每次调用都 new，否则内部状态全丢）", () => {
    const contract = createContract("same")
    installPlugin(contract)
    expect(getNebulaClient()).toBe(getNebulaClient())
  })

  it("契约消失后返回 null（让上层给出「未检测到网盘插件」提示）", () => {
    installPlugin(createContract("a"))
    expect(getNebulaClient()).not.toBeNull()

    delete (window as unknown as Record<string, unknown>).__nebuladiskPlugin
    expect(getNebulaClient()).toBeNull()
  })

  it("契约缺必需方法时视为没有契约（不把半个对象当能力用）", () => {
    installPlugin({ listMounts: async () => ({ ok: true }), version: 1 })
    expect(getNebulaClient()).toBeNull()
  })
})
