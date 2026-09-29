// 真加载验证：模拟思源插件运行时环境，require 构建产物，看是否真的能跑起来。
// 这是「构建通过 != 运行正确」教训的直接产物。
const Module = require("module")
const path = require("path")
const origRequire = Module.prototype.require
const seen = []
Module.prototype.require = function (id) {
  if (id !== "siyuan") seen.push(id)
  return origRequire.apply(this, arguments)
}

// 1) 提供 siyuan 模块桩
const siyuanStub = new Proxy({}, {
  get(t, k) {
    if (k === "__esModule") return true
    if (k === "default") return siyuanStub
    return function () { return undefined }
  },
})
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === "siyuan") return "siyuan"
  return origResolve.call(this, request, ...rest)
}
require.cache.siyuan = { id: "siyuan", filename: "siyuan", loaded: true, exports: siyuanStub }
require.cache["siyuan"] = { id: "siyuan", filename: "siyuan", loaded: true, exports: siyuanStub }

// 2) 浏览器全局桩
global.window = global
global.document = {
  createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, classList: { add(){}, remove(){}, contains: () => false } }),
  addEventListener(){}, removeEventListener(){},
  querySelector: () => null, querySelectorAll: () => [],
  body: { appendChild(){}, classList: { add(){}, remove(){} } },
  head: { appendChild(){} },
  documentElement: { style: {} },
}
global.navigator = { userAgent: "node", platform: "node", clipboard: {} }
global.localStorage = { getItem: () => null, setItem(){}, removeItem(){} }
global.fetch = () => Promise.reject(new Error("no network"))
global.MutationObserver = class { observe(){} disconnect(){} }
global.ResizeObserver = class { observe(){} disconnect(){} unobserve(){} }
global.IntersectionObserver = class { observe(){} disconnect(){} unobserve(){} }
global.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){} })
global.requestAnimationFrame = cb => setTimeout(cb, 0)
global.cancelAnimationFrame = id => clearTimeout(id)
global.getComputedStyle = () => ({ getPropertyValue: () => "" })

console.log("--- 加载 dist/index.js ---")
let mod
try {
  mod = require(path.resolve("dist/index.js"))
  console.log("✓ require 成功")
} catch (e) {
  console.error("✗ require 失败:", e.message)
  console.error(e.stack.split("\n").slice(0, 12).join("\n"))
  process.exit(1)
}

console.log("导出键:", Object.keys(mod).join(", ") || "(默认导出)")

const Plugin = mod.default ?? mod
if (typeof Plugin !== "function") {
  console.error("✗ 默认导出不是构造函数，实际类型:", typeof Plugin)
  process.exit(1)
}
console.log("✓ 默认导出是构造函数:", Plugin.name || "(匿名)")

// 3) 尝试实例化（触发顶层副作用 / 类字段初始化）
try {
  const p = new Plugin({ name: "siyuan-diskcanvas-next" })
  console.log("✓ 实例化成功")
  for (const m of ["onload", "onunload", "openSetting", "openCanvasTab", "getCanvasSettings", "getCanvasUiState", "getRecentCanvasFiles", "updateCanvasSettings", "updateCanvasUiState", "registerToApiSwitch", "getOrCreateWorkspaceTree"]) {
    console.log("  " + (typeof p[m] === "function" ? "✓" : "✗") + " " + m + " : " + typeof p[m])
  }
} catch (e) {
  console.error("✗ 实例化失败:", e.message)
  console.error(e.stack.split("\n").slice(0, 15).join("\n"))
  process.exit(1)
}

console.log("\n外部 require 列表:", [...new Set(seen)].join(", ") || "(无)")
console.log("\n=== 真加载验证通过 ===")
