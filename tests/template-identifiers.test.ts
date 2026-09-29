/**
 * 「没有来源的标识符」闸门：不仅要能报错，还要**不误报**。
 *
 * 用夹具目录验证（`--dir tests/fixtures/template-identifiers`），
 * 不去改动真实源码 —— 早先我是在真源码上"还原缺陷 → 跑闸门 → 再还原"，
 * 那种做法一次忘了还原就会把 bug 留在仓库里。
 *
 * 断言三件事：
 *   ① 报出 bad-template.vue 的 notDeclared（模板侧）
 *   ② 报出 bad-script.vue 的 missingHelper（脚本侧）
 *   ③ **不**报 good.vue（否则就是误报 —— 一个会误报的闸门等于没有闸门）
 */

import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = resolve(__dirname, "..")

function runGate() {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["tools/check-template-identifiers.mjs", "--dir", "tests/fixtures/template-identifiers"],
      { cwd: ROOT, encoding: "utf8" },
    )
    return { ok: true, output: stdout }
  } catch (error) {
    const stdout = String((error as { stdout?: string }).stdout || "")
    const stderr = String((error as { stderr?: string }).stderr || "")
    return { ok: false, output: `${stdout}${stderr}` }
  }
}

describe("check-template-identifiers 闸门", () => {
  const result = runGate()

  it("发现夹具里的问题时以非 0 退出（挂在 verify 里能拦住）", () => {
    expect(result.ok).toBe(false)
  })

  it("报出模板侧「没有来源的标识符」", () => {
    expect(result.output).toContain("notDeclared")
    expect(result.output).toContain("bad-template.vue")
  })

  it("报出脚本侧「漏 import」", () => {
    expect(result.output).toContain("missingHelper")
    expect(result.output).toContain("bad-script.vue")
  })

  it("★ 不误报合法写法（props 类型式声明 / v-for 局部变量 / 无括号箭头参数 / 正则标志位）★", () => {
    expect(result.output).not.toContain("good.vue")
  })
})
