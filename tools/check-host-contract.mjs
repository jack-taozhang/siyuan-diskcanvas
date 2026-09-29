#!/usr/bin/env node
/**
 * 思源宿主契约检查器 —— 抓「API 存在但用法违反宿主契约」的静默失效。
 *
 * ★ 为什么要单独做这个（踩坑记录 2026-09-28）★
 *
 *   插件的顶栏按钮一直看不见，但**任何静态检查、构建、加载验证都不会报错**：
 *     - addTopBar 传了内联 `<svg>` 字符串，思源校验只要求 `icon` 以 "icon" 或 "<svg" 开头，
 *       所以**通过的**，控制台也不报错；
 *     - 但内联分支把字符串原样 `innerHTML` 塞进顶栏，不套用思源 `.toolbar__item svg` 的
 *       尺寸/着色规则 → 图标不可见。
 *     - 构建绿 / 加载绿 / 断链 0 处，全部无法发现这个问题。只有人看界面才发现。
 *
 *   所以契约类问题必须**单独静态断言**，把宿主的验证条件固化成检查项。
 *
 * 用法：
 *   node tools/check-host-contract.mjs
 */
import fs from "node:fs"
import path from "node:path"

const problems = []
const passes = []

function fail(rule, detail, file, line) {
  problems.push({ detail, file, line, rule })
}

function pass(rule, detail) {
  passes.push({ detail, rule })
}

// ───────────────────────── 规则 1：addTopBar 的 icon 必须是精灵图 ID ─────────────────────────
// 思源契约（实测自 3.8.5 desktop main.<hash>.js）：
//   校验：!icon.startsWith("icon") && !icon.startsWith("<svg")  ⇒ console.error + return
//   渲染：icon.startsWith("icon") ? `<svg><use xlink:href="#${icon}"/></svg>` : icon
// 只有第一支会被套用顶栏样式，第二支原样塞入 → 看不见。
{
  const RULE = "host.addTopBar-icon-must-be-sprite-id"
  const targets = ["src/index.ts"]

  for (const rel of targets) {
    const abs = path.resolve(rel)
    if (!fs.existsSync(abs)) continue
    const text = fs.readFileSync(abs, "utf8")
    const lines = text.split("\n")

    lines.forEach((lineText, i) => {
      const m = lineText.match(/icon\s*:\s*([A-Za-z_$][\w$.]*)\s*,/)
      if (!m) return
      // 只关心 addTopBar 的 icon 字段（同文件里 addIcons 不写 icon:）
      const ident = m[1]
      // 允许：直接的字面量 "iconXxx" / 'iconXxx'
      if (/^["']icon/.test(ident)) return
      // 允许：变量名以 ICON_ID 结尾（约定：精灵图 ID 常量）
      if (/ICON_ID$/.test(ident)) {
        pass(RULE, `${ident} 是精灵图 ID 常量（${rel}:${i + 1}）`)
        return
      }
      fail(
        RULE,
        `addTopBar 的 icon 传的是 ${ident}（疑似内联 <svg> 或非 ID 常量）。` +
        `思源对 "<svg" 开头的 icon 会走原样 innerHTML 分支，不套用顶栏样式 → 按钮不可见。` +
        `应传 addIcons 注册的精灵图 ID（以 "icon" 开头的字符串）。`,
        rel,
        i + 1,
      )
    })
  }
}

// ───────────────────────── 规则 2：addTopBar 用到的精灵图必须已 addIcons ─────────────────────────
{
  const RULE = "host.topbar-sprite-must-be-registered"
  const abs = path.resolve("src/index.ts")
  if (fs.existsSync(abs)) {
    const text = fs.readFileSync(abs, "utf8")
    // 收集 addIcons 注册的 symbol id（形如 ${CANVAS_TAB_ICON_ID} 或字面量）
    const registered = new Set()
    for (const m of text.matchAll(/addIcons\(\s*`<symbol\s+id="\$\{(\w+)\}"/g)) {
      registered.add(m[1])
    }
    for (const m of text.matchAll(/addIcons\(\s*`<symbol\s+id="([^"$]+)"/g)) {
      registered.add(m[1])
    }

    // 收集 addTopBar 实际引用的 icon 标识符
    for (const m of text.matchAll(/addTopBar\(\{[\s\S]*?icon\s*:\s*([A-Za-z_$][\w$.]*)\s*,/g)) {
      const ident = m[1]
      if (!/ICON_ID$|^["']icon/.test(ident)) continue
      if (ident.startsWith("\"") || ident.startsWith("'")) continue

      const hasRegister = [...registered].some(name => name === ident)
        || /addIcons\(/.test(text) && registered.size > 0
      if (hasRegister) {
        pass(RULE, `${ident} 已被 addIcons 注册（注册项: ${[...registered].join(", ")}）`)
      } else {
        fail(
          RULE,
          `addTopBar 引用 ${ident}，但文件内没有对应的 addIcons 注册 —— ` +
          `<use xlink:href="#..."> 会指向不存在的 symbol，图标空白。`,
          "src/index.ts",
          0,
        )
      }
    }
  }
}

// ───────────────────────── 规则 3：custom 页签的注册键 === openTab 的 custom.id ─────────────────────────
// 思源契约（实测自 3.8.5 desktop main.<hash>.js）：
//   注册：addTab(Ve){ const Oe = this.name + Ve.type; this.models[Oe] = ... }
//          → 注册键 = pluginName + tabType
//   打开：openTab({custom:{id}})；openFile 内
//          xo(app, tab, {instance:"Custom", customModelType: custom.id, ...})
//          → 查表键 = custom.id
//   两者必须**逐字符相等**，否则 xo 返回 undefined，
//   页签照常打开但 **model 未挂载 ⇒ 面板空白**。不报错、不警告。
{
  const RULE = "host.tab-key-must-equal-openTab-custom-id"

  const tabsAbs = path.resolve("src/canvas/plugin-tabs.ts")
  const idxAbs = path.resolve("src/index.ts")

  if (fs.existsSync(tabsAbs) && fs.existsSync(idxAbs)) {
    const tabsText = fs.readFileSync(tabsAbs, "utf8")
    const idxText = fs.readFileSync(idxAbs, "utf8")

    // openTab 里 custom.id 的构造式（可能是字面量模板串，也可能是变量）
    const idExpr = tabsText.match(/custom\s*:\s*\{[\s\S]*?id\s*:\s*([^,\n]+),/)
    // 注册时传入的 tabType
    const regCall = idxText.match(/registerCanvasEditorTab\(\s*this\s*,\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\)/)
    // 打开时传入的 pluginName
    const openCall = idxText.match(/openCanvasEditorTab\(\s*this\s*,\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*,/)

    if (!idExpr) {
      fail(RULE, "未在 plugin-tabs.ts 找到 openTab 的 custom.id 构造式，无法校验注册键一致性。", "src/canvas/plugin-tabs.ts", 0)
    } else if (!regCall || !openCall) {
      fail(RULE, "未在 index.ts 找到 registerCanvasEditorTab / openCanvasEditorTab 的调用，无法校验注册键一致性。", "src/index.ts", 0)
    } else {
      // 情形 A：id 直接写成模板串 `${paramA}${paramB}`（含形参名）
      // 情形 B：id 是局部变量（如 customModelType），该变量在同一函数内被赋值为上述拼接式
      const idRaw = idExpr[1].trim().replace(/\s+/g, "")
      let concatExpr = null

      if (idRaw.includes("${") && idRaw.includes("}")) {
        concatExpr = idRaw
      } else if (/^[A-Za-z_$][\w$]*$/.test(idRaw)) {
        // 去函数体里找 `const <idRaw> = \`${X}${Y}\``
        const assign = tabsText.match(
          new RegExp("(?:const|let|var)\\s+" + idRaw + "\\s*=\\s*(`[^`]*`)"),
        )
        if (assign) {
          concatExpr = assign[1].replace(/\s+/g, "")
        }
      }

      // 语义等价判断：把 concatExpr 里的占位符与
      // `${调用点实参}${tabType}` 的结构对齐。
      // 允许函数形参名与调用点实参名不同 —— 只要「第一段来自 openCanvasEditorTab
      // 的第 2 个实参」，且「第二段来自 register 的第 2 个实参」。
      // 因此这里抽取 concatExpr 的两段，并核对第二段严格等于 regCall[1]。
      const parts = concatExpr ? [...concatExpr.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1]) : []
      const expectedTail = regCall[1]

      if (parts.length === 2 && parts[1] === expectedTail) {
        // 校验第一段确实是 openCanvasEditorTab 的 pluginName 形参
        const sig = tabsText.match(/export\s+async\s+function\s+openCanvasEditorTab\s*\(([\s\S]*?)\)\s*:\s*Promise/)
        const params = sig ? sig[1].split(",").map(p => p.trim().replace(/:.*$/, "")) : []
        const paramName = params[1] // 第 2 个形参 = pluginName
        if (paramName === parts[0]) {
          pass(
            RULE,
            `注册键 === custom.id === \`${concatExpr}\`；` +
            `实参 ${openCall[1]} → 形参 ${paramName}，尾段 ${expectedTail} 与注册 tabType 一致`,
          )
        } else {
          fail(
            RULE,
            `custom.id 第一段用的是 \`${parts[0]}\`，但 openCanvasEditorTab 的第 2 个形参是 \`${paramName}\`（插件名）。` +
            `请确认 custom.id 真的拼的是插件名。`,
            "src/canvas/plugin-tabs.ts",
            0,
          )
        }
      } else {
        fail(
          RULE,
          `custom.id 的实际构造为 \`${concatExpr ?? idExpr[1].trim()}\`，` +
          `期望形如 \`\${<pluginName>}\${${expectedTail}}\`。` +
          `两者必须逐字符相等，否则 xo() 查不到 model → 页签空白且不报错。`,
          "src/canvas/plugin-tabs.ts",
          0,
        )
      }
    }
  }
}

// ───────────────────────── 规则 4：addTab 的 init 必须自带 try/catch ─────────────────────────
// 思源契约（实测自 3.8.5 desktop main.<hash>.js，module 8120）：
//   class $ extends K {
//     constructor(c) { ...; this.init = c.init; ...; this.init(this) }   // ← 同步、无 try/catch
//   }
//   // openFile 的 custom 分支同样无 try/catch：  Ae && Z.addModel(Ae)
// 因此 init() 抛错 → 一路被宿主吞掉 → 页签打开但面板空白（无任何报错）。
// 契约要求：init 内必须有 try/catch，否则失败态不可诊断。
{
  const RULE = "host.addTab-init-must-catch"
  const abs = path.resolve("src/canvas/plugin-tabs.ts")
  if (fs.existsSync(abs)) {
    const text = fs.readFileSync(abs, "utf8")
    // 截取 registerCanvasEditorTab 函数体
    const start = text.indexOf("export function registerCanvasEditorTab")
    const body = start >= 0 ? text.slice(start, start + 3000) : ""
    if (!body) {
      fail(RULE, "未找到 registerCanvasEditorTab，无法校验 init 的异常兜底。", "src/canvas/plugin-tabs.ts", 0)
    } else {
      // 只截取 init(this: Custom) { ... } 这一段（到 destroy( 之前），
      // 避免把 destroy 里的 try/catch 算作 init 的。
      const initStart = body.indexOf("init(this: Custom)")
      const destroyStart = body.indexOf("destroy(this: Custom)")
      const initBody = initStart >= 0
        ? body.slice(initStart, destroyStart > initStart ? destroyStart : body.length)
        : ""

      // 必须同时出现：init 体内的 try { ... } 以及配对的 catch (
      const hasTry = /\btry\s*\{/.test(initBody)
      const hasCatch = /\bcatch\s*\(/.test(initBody)
      // 且 try 必须包住 mountCanvasApp（真正会抛的那一步）
      const tryWrapsMount = /try\s*\{[\s\S]*?mountCanvasApp\([\s\S]*?\}\s*catch\s*\(/.test(initBody)

      if (hasTry && hasCatch && tryWrapsMount) {
        pass(RULE, "init 内含 try/catch，且包裹了 mountCanvasApp（失败可诊断）")
      } else {
        fail(
          RULE,
          "registerCanvasEditorTab 的 init 未把 mountCanvasApp 包在 try/catch 内" +
          `（try=${hasTry}, catch=${hasCatch}, 包裹 mount=${tryWrapsMount}）。` +
          "宿主的 Custom 模型构造函数与 addModel 都是同步调用且不捕获异常，" +
          "init 抛错会导致页签空白且无任何报错（症状：编辑画布没有出现菜单和画布）。",
          "src/canvas/plugin-tabs.ts",
          0,
        )
      }
    }
  }
}

// ───────────────────────── 输出 ─────────────────────────
console.log("思源宿主契约检查")
console.log("─".repeat(56))
for (const p of passes) {
  console.log(`  ✔ ${p.rule}`)
  console.log(`      ${p.detail}`)
}
for (const p of problems) {
  console.log(`  ✘ ${p.rule}`)
  console.log(`      ${p.detail}`)
  console.log(`      → ${p.file}:${p.line}`)
}
console.log("─".repeat(56))
console.log(`通过 ${passes.length} 项，失败 ${problems.length} 项`)

if (problems.length > 0) {
  process.exit(1)
}
