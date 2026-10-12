/* @vitest-environment jsdom */

/**
 * `getLocalFsClient()` 对**契约对象更换**的响应。
 *
 * 背景（网盘那条链路真机踩过，本机存储同样适用）：
 *   插件每次重载都会给 `window.__localfsPlugin` **赋一个新对象**
 *   （`external` 也是新建的）。适配器若写成
 *   `client ??= new LocalFsContractClient(contract)`，就会**永远抱着
 *   第一次那个对象** —— 插件升级后画布仍在调旧代码。
 *   实测表现：对方修好了地址构造，独立页里的画布却依旧拿到旧结果。
 *
 * 这里把"契约换对象必须重建适配器"钉死成单测。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getLocalFsClient, refreshLocalFsClient } from "@/canvas/localfs-client-provider"
import {
  isLocalFsPluginLoaded,
  localFsUnavailableKind,
  localFsUnavailableMessage,
} from "@/canvas/localfs-client"

/** 造一个最小可用契约（getLocalFsExternalContract 会校验 list / roots 在场） */
function createContract(marker: string) {
  return {
    id: "localfs.external",
    list: vi.fn(async () => ({ data: { items: [], path: `/${marker}` }, ok: true })),
    previewUrl: vi.fn(async () => ({ data: `preview:${marker}`, ok: true })),
    roots: vi.fn(async () => ({ data: [], ok: true })),
    version: 1,
  }
}

function installPlugin(contract: unknown) {
  ;(window as unknown as Record<string, unknown>).__localfsPlugin = {
    external: contract,
    name: "siyuan-localfs",
  }
}

describe("getLocalFsClient 与「本机存储」契约的身份绑定", () => {
  beforeEach(() => {
    refreshLocalFsClient()
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__localfsPlugin
    refreshLocalFsClient()
  })

  it("有契约时返回契约适配器，并视为「已配置」", () => {
    installPlugin(createContract("a"))
    const client = getLocalFsClient()
    expect(client).not.toBeNull()
    expect(client?.isConfigured()).toBe(true)
    expect(client?.previewUrl).toBeTypeOf("function")
  })

  it("★ 契约换成新对象后必须重建适配器（否则插件升级后仍在调旧代码）★", async () => {
    installPlugin(createContract("v1"))
    const first = getLocalFsClient()
    expect(await first!.previewUrl("/a.pdf")).toBe("preview:v1")

    // 模拟"本机存储插件重载"：换一个全新的契约对象
    installPlugin(createContract("v2"))
    const second = getLocalFsClient()

    expect(second).not.toBe(first)
    expect(await second!.previewUrl("/a.pdf")).toBe("preview:v2")
    // 旧适配器仍绑着旧契约 —— 这正是没有重建时会发生的"调旧代码"
    expect(await first!.previewUrl("/a.pdf")).toBe("preview:v1")
  })

  it("契约对象**没换**时不重建（不能每次调用都 new，否则适配器被反复替换）", () => {
    const contract = createContract("same")
    installPlugin(contract)
    expect(getLocalFsClient()).toBe(getLocalFsClient())
  })

  it("契约消失后返回 null（让上层给出「未检测到本机存储插件」提示）", () => {
    installPlugin(createContract("a"))
    expect(getLocalFsClient()).not.toBeNull()

    delete (window as unknown as Record<string, unknown>).__localfsPlugin
    expect(getLocalFsClient()).toBeNull()
  })

  it("契约缺必需方法时视为没有契约（不把半个对象当能力用）", () => {
    installPlugin({ id: "localfs.external", version: 1 })
    expect(getLocalFsClient()).toBeNull()
  })

  it("window 上挂的不是契约对象（如插件没装）时也返回 null", () => {
    ;(window as unknown as Record<string, unknown>).__localfsPlugin = { name: "siyuan-localfs" }
    expect(getLocalFsClient()).toBeNull()
  })
})

/**
 * ★ 「没装」与「装了但页面没刷新」必须分开 ★
 *
 * 真机踩到的坑：插件明明已启用，用户却一直看到"未检测到插件"。
 * 原因是内核**缓存插件 JS**（升版本号才破得掉），我们刚部署了新契约，
 * 而用户手里的页面还在跑旧那份 —— 契约自然取不到。
 * 这两种情况的处置动作**方向相反**：去插件市场装 vs 刷新页面。
 * 只说"未检测到"会让后者反复安装卸载，永远修不好。
 *
 * 判据：思源内部结构 `siyuan.ws.app.plugins` 里有没有这个插件实例。
 * 只读、不调它的任何方法，能力仍然只从契约来。
 */
describe("契约缺失的原因判别（absent / outdated）", () => {
  const w = window as unknown as Record<string, unknown>
  const fakeT = (key: string) => `T:${key}`
  const KEYS = { absent: "K_ABSENT", outdated: "K_OUTDATED" }

  afterEach(() => {
    delete w.__localfsPlugin
    delete w.siyuan
    refreshLocalFsClient()
  })

  it("插件实例已在页面上 ⇒ outdated（页面跑的是旧版 JS，提示去刷新）", () => {
    w.siyuan = { ws: { app: { plugins: [{ name: "custom-block" }, { name: "siyuan-localfs" }] } } }
    expect(isLocalFsPluginLoaded()).toBe(true)
    expect(localFsUnavailableKind()).toBe("outdated")
    expect(localFsUnavailableMessage(fakeT, KEYS)).toBe("T:K_OUTDATED")
  })

  it("插件实例不在 ⇒ absent（真没装/没启用，提示去装）", () => {
    w.siyuan = { ws: { app: { plugins: [{ name: "custom-block" }] } } }
    expect(isLocalFsPluginLoaded()).toBe(false)
    expect(localFsUnavailableKind()).toBe("absent")
    expect(localFsUnavailableMessage(fakeT, KEYS)).toBe("T:K_ABSENT")
  })

  it("★ 读不到思源内部结构时退化成 absent，绝不抛异常 ★", () => {
    // 独立网页里 `window.siyuan` 是桩；老内核/结构变动时字段也可能不在
    for (const stub of [undefined, {}, { ws: {} }, { ws: { app: {} } }, { ws: { app: { plugins: null } } }]) {
      w.siyuan = stub
      expect(isLocalFsPluginLoaded()).toBe(false)
      expect(localFsUnavailableKind()).toBe("absent")
    }
    delete w.siyuan
    expect(isLocalFsPluginLoaded()).toBe(false)
  })

  it("判别只看「插件实例在不在」，与契约在不在无关（两者独立）", () => {
    installPlugin(createContract("a"))
    // 契约可用 ⇒ 调用点压根不会问这个问题
    expect(getLocalFsClient()).not.toBeNull()
    // 而判别函数自身仍如实回答"没看到插件实例"
    expect(isLocalFsPluginLoaded()).toBe(false)
  })

  it("插件实例存在**且**契约也在 ⇒ 一切正常（不会误报 outdated）", () => {
    w.siyuan = { ws: { app: { plugins: [{ name: "siyuan-localfs" }] } } }
    installPlugin(createContract("ok"))
    expect(getLocalFsClient()).not.toBeNull()
  })
})
