import {
  getLocalFsExternalContract,
  LocalFsContractClient,
} from "@/canvas/localfs-client"

/**
 * 全局唯一的「本机存储」客户端。
 *
 * ★ 为什么用单例 ★
 *   适配器本身无状态，但"契约换人了要重建"这件事需要一个稳定的锚点：
 *   插件每次重载都会把 `window.__localfsPlugin` 换成新对象，
 *   如果每个调用点各自 new 一个，就没地方记录"上一次用的是哪个契约对象"，
 *   于是升级后画布会继续调旧代码（网盘链路实测踩过这个坑）。
 *
 * ★ 为什么不接受 settings 参数 ★
 *   网盘那条链路要传 `settings.nebula`（画布自己还有一份连接配置要兜底）；
 *   本机存储的地址探测**完全在对方那边**，画布没有任何可配的地址。
 *   少一个参数，就少一处"两边配置不一致"的可能。
 */
let client: LocalFsContractClient | null = null

/**
 * 取「本机存储」客户端。
 *
 * @returns 契约不存在（插件未装/未启用/版本过旧）时返回 **null**。
 *          调用方必须容忍这一点：画布不能因为本机存储不可用就不能用，
 *          拿到 null 就给出"去装/去升级本机存储插件"的可读提示。
 */
export function getLocalFsClient(): LocalFsContractClient | null {
  const contract = getLocalFsExternalContract()
  if (!contract) {
    client = null
    return null
  }

  // 契约对象换了人 ⇒ 重建适配器（否则会一直调用旧插件代码）
  if (!client || client.contract !== contract) {
    client = new LocalFsContractClient(contract)
  }

  return client
}

/** 设置变更 / 需要重新读取契约时清掉缓存，下次取用时重建。 */
export function refreshLocalFsClient(): void {
  client = null
}
