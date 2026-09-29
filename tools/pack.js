#!/usr/bin/env node
/* 打包 siyuan-diskcanvas 为思源可导入的 zip。
 *
 * 用法:
 *   node tools/pack.js                # 输出到仓库 dist-package/
 *   node tools/pack.js <输出目录>      # 指定输出目录
 *   node tools/pack.js --rebuild      # 先重新构建 dist/ 再打包（发版时用）
 *
 * ★ 关键约定（思源插件包规范）★
 *   zip 内**顶层必须是一个目录**，目录名 == plugin.json 的 name，
 *   即 zip 里第一条路径是 `siyuan-diskcanvas/`。
 *   直接压平（顶层就是 plugin.json）思源认不出 —— 本仓库历史上那个
 *   手工做的 `package.zip` 就是压平的，且停在 0.2.4 / 旧插件名。
 *
 * ★ 只收运行必需的文件 ★
 *   不收：src/ test/ tests/ tools/ node_modules/ *.bak 以及
 *         AGENTS.md / CLAUDE.md / DEVELOPMENT.md（开发文档，装完没人看，白占体积）。
 *   收：index.js + index.css + standalone.*（★ 本插件特有，见下）
 *       + plugin.json + icon.png + i18n/*.json + README*.md
 *
 * ★★★ 本插件比一般思源插件多三件套：standalone.html/.js/.css ★★★
 *   独立网页编辑（第 31 轮）是**第二次构建**的产物，与插件本体同在一个 dist/。
 *   漏掉它们 ⇒ 工具栏「独立打开」按钮点开 **404**。
 *   而 `npm run build` 的 `build:plugin` 会 `emptyOutDir` 清空 dist，
 *   ⇒ 必须确认 dist/ 里三件套**都在且比源码新**（check:standalone 会查）。
 *
 * ★ index.js 必须取【构建产物】★
 *   思源加载的是单文件产物（本插件约 540KB，代码里无相对 require）。
 *   取到分模块源码入口 ⇒ 交付一个思源根本加载不起来的包，
 *   而且错误**只出现在浏览器 console**，siyuan.log 里什么都看不到。
 *   判据是**看文件头 + 体积 + 剥注释后有无相对引用**，不是看 MD5。
 *
 * ★ 自检里判「有没有相对 require」必须先剥注释 ★
 *   产物里的 `require("./` 可能全在**注释**里（解释"为什么不能写相对引用"）。
 *   不剥注释会把文档文字当代码，误判成"不是打包产物"。
 *
 * ★ 自检：i18n 词表必须是本插件的（防跨项目污染）★
 *   本机同时开发 siyuan-nebuladisk（网盘插件），两个项目共用构建流程，
 *   历史上发生过 `i18n/` 被**整份覆盖**。因代码每处都有中文兜底，
 *   中文环境完全看不出问题，只在英文界面悄悄退化成兜底值。
 *   ⇒ 既查"不该有的键"（网盘插件特有词条），也查"必须有的键"。
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

const MANIFEST_SRC = join(ROOT, "plugin.json")
const manifest = JSON.parse(readFileSync(MANIFEST_SRC, "utf8"))
const NAME = manifest.name
const VER = manifest.version

/** --rebuild / --no-build 之外的第一个非选项参数 = 输出目录 */
const OUTPUT_ARG = process.argv.slice(2).find((a) => !a.startsWith("--"))
const OUT_DIR = OUTPUT_ARG || join(ROOT, "dist-package")

const BUILT = join(ROOT, "dist")
const ZIP = join(OUT_DIR, `${NAME}-v${VER}.zip`)

/* ── --rebuild：先跑构建，保证包里是当前源码的产物 ─────────────── */
if (process.argv.includes("--rebuild")) {
  console.log("→ 先重新构建（npm run build）…\n")
  /*
   * ★ 用 npm run build（= build:plugin → build:standalone），不要用
   *   `npx vite build` —— 那只会做 build:plugin、清空 dist，
   *   把 build:standalone 的产物（standalone.*）一起清掉。
   *   而且独立页配置里 outDir 是**硬编码 dist**，命令行 --outDir 无效。
   */
  execFileSync("npm", ["run", "build"], { stdio: "inherit", cwd: ROOT, shell: true })
  console.log("")
}

/* ── 产物目录校验 ──────────────────────────────────────────── */
if (!existsSync(join(BUILT, "index.js"))) {
  console.error("✗ 找不到构建产物 dist/index.js。请先运行：npm run build")
  process.exit(1)
}
const builtJsSize = statSync(join(BUILT, "index.js")).size
if (builtJsSize < 200_000) {
  console.error(`✗ dist/index.js 只有 ${builtJsSize} 字节（应 >200KB）—— 可能取到了源码入口`)
  process.exit(1)
}

/* ── 组装清单（磁盘路径, zip 内相对名）───────────────────────── */
const ITEMS = [
  [join(BUILT, "index.js"), "index.js"], // ★ 产物
  [join(BUILT, "index.css"), "index.css"], // ★ 产物
  [join(BUILT, "standalone.html"), "standalone.html"], // ★ 独立页三件套
  [join(BUILT, "standalone.js"), "standalone.js"],
  [join(BUILT, "standalone.css"), "standalone.css"],
  [MANIFEST_SRC, "plugin.json"],
  [join(ROOT, "icon.png"), "icon.png"],
  [join(ROOT, "README.md"), "README.md"],
  [join(ROOT, "README_zh_CN.md"), "README_zh_CN.md"],
  [join(BUILT, "i18n", "zh_CN.json"), "i18n/zh_CN.json"],
  [join(BUILT, "i18n", "en_US.json"), "i18n/en_US.json"],
]

/* ── 极简 ZIP 写入（store/deflate，无外部依赖）────────────────── */
function crc32(buf) {
  let c
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = (crc ^ buf[i]) & 0xff
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function buildZip(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8")
    const raw = e.data
    const comp = zlib.deflateRawSync(raw, { level: 9 })
    const useDeflate = comp.length < raw.length
    const data = useDeflate ? comp : raw
    const method = useDeflate ? 8 : 0
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 flag（中文文件名必需）
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x21, 12) // date (1980-01-01)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBuf, data)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4) // version made by
    cen.writeUInt16LE(20, 6) // version needed
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(method, 10)
    cen.writeUInt16LE(0, 12)
    cen.writeUInt16LE(0x21, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(data.length, 20)
    cen.writeUInt32LE(raw.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30)
    cen.writeUInt16LE(0, 32)
    cen.writeUInt16LE(0, 34)
    cen.writeUInt16LE(0, 36)
    cen.writeUInt32LE(0, 38)
    cen.writeUInt32LE(offset, 42)
    central.push(cen, nameBuf)

    offset += local.length + nameBuf.length + data.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuf, eocd])
}

/* ── 取文件 ────────────────────────────────────────────────── */
const entries = []
const missing = []
for (const [src, rel] of ITEMS) {
  if (!existsSync(src)) {
    missing.push(rel)
    continue
  }
  entries.push({ name: `${NAME}/${rel}`, data: readFileSync(src), src, rel })
}

if (missing.length) {
  console.error("✗ 缺少必需文件：", missing.join(", "))
  console.error("  提示：standalone.* 缺失 ⇒ 忘了跑 build:standalone（请用 npm run build）")
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(ZIP, buildZip(entries))

console.log(`产物目录: ${BUILT}`)
console.log(`   index.js  ${builtJsSize} 字节`)
console.log(`\n输出: ${ZIP}`)
console.log(`大小: ${statSync(ZIP).size} 字节`)
for (const e of entries) {
  console.log(`   ${String(e.data.length).padStart(8)}  ${e.name}`)
}

/* ── 读回 zip（最小读法：扫 local header）───────────────────── */
function readZip(buf) {
  const out = new Map()
  let i = 0
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8)
    const compSize = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26)
    const extraLen = buf.readUInt16LE(i + 28)
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8")
    const dataStart = i + 30 + nameLen + extraLen
    const data = buf.subarray(dataStart, dataStart + compSize)
    out.set(name, method === 8 ? zlib.inflateRawSync(data) : data)
    i = dataStart + compSize
  }
  return out
}

const zf = readZip(readFileSync(ZIP))

/* ── 自检 ──────────────────────────────────────────────────── */
let failed = 0
function check(title, fn) {
  console.log(`\n=== ${title} ===`)
  try {
    fn()
  } catch (e) {
    console.log("   ❌ " + e.message)
    failed += 1
  }
}

check("自检 1：顶层目录必须恰好是 plugin.json 的 name", () => {
  const tops = new Set([...zf.keys()].map((n) => n.split("/")[0]))
  if (tops.size !== 1 || !tops.has(NAME)) {
    throw new Error(`顶层集合应为 {${NAME}}，实际 {${[...tops].join(",")}}`)
  }
  console.log(`   ✅ 顶层唯一且等于 name = ${NAME}`)
})

check("自检 2：zip 内 plugin.json 与源逐字节一致", () => {
  const inzip = zf.get(`${NAME}/plugin.json`)
  const src = readFileSync(MANIFEST_SRC)
  if (!inzip || !inzip.equals(src)) throw new Error("不一致")
  console.log(`   ✅ 一致（${src.length} 字节），version=${VER}`)
})

check("自检 3：index.js 必须是单文件产物（不是源码入口）", () => {
  const zjs = zf.get(`${NAME}/index.js`)
  if (!zjs) throw new Error("zip 内没有 index.js")
  console.log(`   zip 内 index.js = ${zjs.length} 字节`)
  if (zjs.length < 200_000) {
    throw new Error("太小！分模块源码入口远小于此 —— 取错对象了")
  }
  // ★ 必须剥注释再判（产物注释里可能有 require("./ 是说明文字）
  const txt = zjs.toString("utf8")
  const stripped = txt.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const codeReq = (stripped.match(/require\(\s*["']\.\//g) || []).length
  const codeFrom = (stripped.match(/\bfrom\s+["']\.\//g) || []).length
  if (codeReq || codeFrom) {
    throw new Error(`代码里仍有相对模块引用 require=${codeReq} from=${codeFrom}`)
  }
  const srcJs = readFileSync(join(BUILT, "index.js"))
  if (!zjs.equals(srcJs)) throw new Error("与产物目录的 index.js 逐字节不一致")
  console.log("   ✅ 单文件产物（>200KB、代码无相对引用、与 dist 逐字节一致）")
})

check("自检 4：必需文件齐备（含独立页三件套，且不含开发文档）", () => {
  const need = [
    "index.js",
    "index.css",
    "standalone.html", // ★ 漏了 ⇒ 独立页 404
    "standalone.js",
    "standalone.css",
    "plugin.json",
    "icon.png",
    "i18n/zh_CN.json",
    "i18n/en_US.json",
    "README.md",
    "README_zh_CN.md",
  ]
  const got = [...zf.keys()].map((n) => n.replace(`${NAME}/`, ""))
  const lack = need.filter((n) => !got.includes(n))
  if (lack.length) throw new Error("缺 " + lack.join(", "))
  const devDocs = got.filter((n) => /^(AGENTS|CLAUDE|DEVELOPMENT)|^REPORT-/.test(n))
  if (devDocs.length) throw new Error("不该打进包里的开发文档：" + devDocs.join(", "))
  console.log(`   ✅ 齐备 ${need.length} 项（含独立页三件套），且无开发文档`)
})

check("自检 5：i18n 词表必须是本插件的（防跨项目污染）", () => {
  /** 本插件确实在引用的 key（中文兜底掩盖不了英文界面退化） */
  const USED = [
    "canvasFileCardTitle",
    "toolbarFileManager",
    "nodeKindNebulaFile",
    "standaloneOpenBlocked",
    "toolbarNew",
  ]
  /** 网盘插件（兄弟项目）特有的 key —— 出现即说明 i18n 被覆盖 */
  const NEBULA = ["dockTitle", "openInBrowser", "refreshAll", "settingsVerify"]
  const names = [...zf.keys()].filter((n) => /^i18n\/.*\.json$/.test(n.replace(`${NAME}/`, "")))
  if (!names.length) throw new Error("包内没有 i18n/*.json")
  for (const n of names) {
    const obj = JSON.parse(zf.get(n).toString("utf8"))
    const keys = Object.keys(obj)
    const nebulaHit = NEBULA.filter((k) => keys.includes(k))
    if (nebulaHit.length) {
      throw new Error(`${n} 出现网盘插件词条 ${nebulaHit.join(", ")} ⇒ 被覆盖了`)
    }
    const hit = USED.filter((k) => keys.includes(k))
    if (!hit.length) {
      throw new Error(
        `${n} 里没有任何本插件引用的 key（共 ${keys.length} 条）⇒ 整份词表都不是本插件的`,
      )
    }
    console.log(
      `   ✅ ${n.replace(`${NAME}/`, "")}：${keys.length} 条，命中 ${hit.length}/${USED.length} 个在用 key`,
    )
  }
})

check("自检 6：清单里引用的文件都在包内", () => {
  const got = new Set([...zf.keys()].map((n) => n.replace(`${NAME}/`, "")))
  const refs = [...Object.values(manifest.readme || {})]
  if (manifest.icon) refs.push(manifest.icon)
  const lack = refs.filter((r) => !got.has(r))
  if (lack.length) throw new Error("清单引用了但包内没有：" + lack.join(", "))
  console.log(`   ✅ ${refs.join(", ")} 全部在包内`)
})

check("自检 7：独立页引用的资源都在包内（防独立页 404）", () => {
  const html = zf.get(`${NAME}/standalone.html`)
  if (!html) throw new Error("包内没有 standalone.html")
  const text = html.toString("utf8")
  const refs = [...text.matchAll(/(?:src|href)="\.\/([^"?]+)/g)].map((m) => m[1])
  const got = new Set([...zf.keys()].map((n) => n.replace(`${NAME}/`, "")))
  const lack = refs.filter((r) => !got.has(r))
  if (lack.length) throw new Error("standalone.html 引用了但包内没有：" + lack.join(", "))
  console.log(`   ✅ standalone.html 引用的 ${refs.join(", ") || "(无)"} 都在包内`)
})

if (failed) {
  console.log(`\n❌ 自检失败 ${failed} 项`)
  process.exit(1)
}
console.log("\n全部自检通过 ✅")
