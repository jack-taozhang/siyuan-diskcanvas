/**
 * 版本号一致性闸门。
 *
 * 为什么需要：
 *   本仓库有**两个**版本号来源 —— `plugin.json`（思源插件清单，**权威**）
 *   与 `package.json`（npm 包元数据）。它们没有任何机制会自动同步，
 *   发版时很容易只改一处。2026-09-29 就出现过：plugin.json 已是 0.2.4，
 *   而 package.json 还停在 0.1.0。
 *
 * 约定：**以 `plugin.json` 为准**（思源集市读的是它）。
 * 本脚本在两者不一致时**报错退出**，把它接进 `npm run verify` 的第一步即可拦住漂移。
 */
import {
  readFileSync,
} from "node:fs"

const plugin = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"))
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

const pluginVersion = plugin.version
const pkgVersion = pkg.version

if (!pluginVersion || !pkgVersion) {
  console.error("[check-version-sync] 有一侧缺少 version 字段")
  process.exit(1)
}

if (pluginVersion !== pkgVersion) {
  console.error(
    `[check-version-sync] 版本号不一致：`
    + `plugin.json = ${pluginVersion}，package.json = ${pkgVersion}\n`
    + `  以 plugin.json 为准，请把 package.json 也改成 ${pluginVersion}。`,
  )
  process.exit(1)
}

console.log(`[check-version-sync] ok: ${pluginVersion}`)
