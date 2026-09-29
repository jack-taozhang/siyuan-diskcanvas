import type { NebulaEntry, NebulaMount } from "@/resources/nebula-client"
import { NebulaClient } from "@/resources/nebula-client"
import {
  normalizeNebulaSettings,
  type NebulaSettings,
} from "@/canvas/plugin-data"
import {
  getNebulaExternalContract,
  NebulaExternalClient,
} from "@/canvas/nebula-external-bridge"

/**
 * 画布用到的客户端**结构面**。
 *
 * 两种实现都满足它：
 *   · `NebulaClient`            —— 画布自己的（兜底路径）
 *   · `NebulaExternalClient`    —— 网盘对外契约的适配器（首选路径，见 #13）
 * 用结构类型而不是具体类，调用点就**一行都不用改**。
 */
export interface NebulaClientLike {
  cadUrl(mount: string, path: string): Promise<string>
  isConfigured(): boolean
  list(mount: string, path: string): Promise<NebulaEntry[]>
  listMounts(): Promise<NebulaMount[]>
  previewUrl(mount: string, path: string): Promise<string>
  stat(mount: string, path: string): Promise<NebulaEntry>
}

/**
 * 全局唯一的 NebulaClient 实例。
 *
 * 为什么用单例而不是每次 new：
 *   NebulaClient 内部缓存 JWT（`token`），并靠 `loginPromise` 去重并发登录。
 *   如果每个画布卡片各 new 一个，会退化成「N 个卡片 → N 次登录」，
 *   既慢又可能触发后端限流。
 *
 * 设置变更时通过 `refreshNebulaClient()` 重建（旧实例的 token 作废）。
 */
let client: NebulaClient | null = null
/** 契约适配器同样是单例（契约本身在网盘插件里带状态） */
let externalClient: NebulaExternalClient | null = null
let signature = ""

function computeSignature(settings: NebulaSettings): string {
  return JSON.stringify([
    settings.baseUrl,
    settings.username,
    settings.password,
    settings.proxyUrl,
  ])
}

/**
 * 取得（必要时重建）客户端。
 *
 * @param settings 当前插件设置；不传则沿用已缓存的配置。
 * @returns 未配置 baseUrl / username 时返回 null —— 调用方须容忍这种情况，
 *          画布不能因为网盘没配好就不能用。
 */
/**
 * ★ 取得（必要时重建）客户端 —— 第 13 轮 #13 起**优先走网盘对外契约** ★
 *
 * 优先级：
 *   1. `window.__nebuladiskPlugin.external` 存在 ⇒ 返回 **契约适配器**。
 *      网盘插件已负责登录，画布**不需要自己的 baseUrl/账号密码**，
 *      这正是「移除画布侧网盘设置」能成立的前提。
 *   2. 契约不存在（网盘插件未装/版本旧）⇒ 退回画布自己的 `NebulaClient`，
 *      按传入的设置构造。**保留这条兜底**是为了不把老用户一刀切死。
 *
 * @param settings 画布自己的网盘设置；仅在第 2 条（兜底路径）下使用。
 * @returns 两者都没有时返回 null —— 调用方须容忍，画布不能因为网盘不可用就不能用。
 */
export function getNebulaClient(settings?: NebulaSettings): NebulaClientLike | null {
  // ① 首选：网盘插件契约
  const contract = getNebulaExternalContract()
  if (contract) {
    externalClient ??= new NebulaExternalClient(contract)
    return externalClient
  }

  // ② 兜底：画布自己的客户端（原有逻辑保持不变）
  if (settings) {
    const normalized = normalizeNebulaSettings(settings)
    const next = computeSignature(normalized)
    if (next !== signature || !client) {
      signature = next
      client = normalized.baseUrl && normalized.username
        ? new NebulaClient({
            baseUrl: normalized.baseUrl,
            password: normalized.password,
            username: normalized.username,
          })
        : null
    }
  }

  if (!client || !client.isConfigured()) {
    return null
  }

  return client
}

/** 设置变更（或网盘插件重载）后清空缓存，下次取用时重建。 */
export function refreshNebulaClient(): void {
  client = null
  externalClient = null
  signature = ""
}

/** 仅供测试 / 诊断：读取当前缓存签名 */
export function getNebulaClientSignature(): string {
  return signature
}
