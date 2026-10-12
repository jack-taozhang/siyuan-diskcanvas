/**
 * 「没有来源的标识符」闸门：不仅要能报错，还要**不误报**。
 *
 * 用夹具目录验证（`--dir tests/fixtures/template-identifiers`），
 * 不去改动真实源码 —— 早先我是在真源码上"还原缺陷 → 跑闸门 → 再还原"，
 * 那种做法一次忘了还原就会把 bug 留在仓库里。
 *
 * 断言四件事：
 *   ① 闸门**确实跑起来了**（先证伪"什么都没跑"这种假绿）
 *   ② 报出 bad-template.vue 的 notDeclared（模板侧）
 *   ③ 报出 bad-script.vue 的 missingHelper（脚本侧）
 *   ④ **不**报 good.vue（否则就是误报 —— 一个会误报的闸门等于没有闸门）
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★★ 为什么用异步 `spawn`，不用 `execFileSync` ★★
 * ---------------------------------------------------------------------------
 *   本机（WorkBuddy 运行时）的**同步族子进程一律不可用**：
 *   `spawnSync` / `execSync` / `execFileSync` 全都抛 `EBUSY`（errno -4082），
 *   而且 `error.stdout` / `error.stderr` 都是 `undefined`。
 *   本仓库另外三个工具（`gh-push-api.mjs` / `gh-release.mjs` /
 *   `lib/github-cred.mjs`）都记录过这条并绕开了，只有这里漏了。
 *
 *   漏掉的实际后果**比"红一条测试"严重** —— 它同时制造了假红和假绿：
 *     · 「以非 0 退出」：`execFileSync` 自己炸了 ⇒ 用例"通过"，
 *        但它验的是"子进程起不来"，**不是**闸门能拦住问题（假绿）
 *     · 「输出含 notDeclared / missingHelper」：catch 分支只拿到空串 ⇒ 假红
 *     · 「不含 good.vue」：空串天然不含任何东西 ⇒ 假绿
 *   ⇒ 整个文件其实一条都没真的测到闸门。
 *
 *   ★ 判据也要跟着改 ★
 *     闸门发现问题时**就该**非 0 退出 —— 那是它的正常行为，不是异常。
 *     所以用 `spawn` 拿退出码数值判断，比"有没有抛异常"语义准确。
 * ==========================================================================
 */

import { spawn } from "node:child_process"
import { resolve } from "node:path"

import { beforeAll, describe, expect, it } from "vitest"

const ROOT = resolve(__dirname, "..")

interface GateResult {
  /** 退出码；进程压根没起来时为 null */
  code: number | null
  /** stdout + stderr（闸门把问题清单写 stderr） */
  output: string
}

function runGate(): Promise<GateResult> {
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      ["tools/check-template-identifiers.mjs", "--dir", "tests/fixtures/template-identifiers"],
      { cwd: ROOT },
    )

    let output = ""
    child.stdout.on("data", (chunk) => { output += String(chunk) })
    child.stderr.on("data", (chunk) => { output += String(chunk) })
    child.on("close", (code) => done({ code, output }))
    child.on("error", (error) => done({ code: null, output: `${output}${error.message}` }))
  })
}

describe("check-template-identifiers 闸门", () => {
  let result: GateResult

  beforeAll(async () => {
    result = await runGate()
  })

  it("★ 闸门确实跑起来了并扫到了夹具（没有这一条，下面几条都可能假绿）★", () => {
    expect(result.code).not.toBeNull()
    expect(result.output.length).toBeGreaterThan(0)
    // 不写死夹具数量：从输出里断言"扫到了 ≥1 个 .vue"这个**关系**
    // （写死 "3 个" 的话，往夹具里加一个文件就必红）
    expect(result.output).toMatch(/扫描\s*[1-9]\d*\s*个\s*\.vue/)
  })

  it("发现夹具里的问题时以非 0 退出（挂在 verify 里能拦住）", () => {
    expect(result.code).not.toBe(0)
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
