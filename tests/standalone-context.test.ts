/**
 * 独立网页编辑器：纯函数层单测。
 *
 * 覆盖三件事 —— 它们都"只有一次做对的机会"，做错了页面看起来还能开：
 *   ① URL 往返：工具栏生成的 URL，standalone 页必须解析回**同一个路径**
 *      （错了会静默打开另一个文件，最坏情况是保存时覆盖别人）
 *   ② 样式表扒取：画布 180 处主题变量全靠它，扒漏了颜色全丢
 *   ③ 主题/语言归一：错了就是"深色用户看到浅色画布"、"英文用户看到中文"
 */

import { describe, expect, it } from "vitest"

import {
  extractStylesheetHrefs,
  resolveI18nCatalog,
  resolveThemeModeLabel,
  resolveThemeStylesheetHref,
} from "@/standalone/standalone-context"
import {
  buildStandalonePageUrl,
  readStandalonePath,
  STANDALONE_PAGE_FILENAME,
} from "@/standalone/standalone-url"

describe("standalone-url", () => {
  it("生成的 URL 指向插件目录下的 standalone.html", () => {
    const url = buildStandalonePageUrl("siyuan-diskcanvas", "/data/我的画布.canvas")
    expect(url.startsWith(`/plugins/siyuan-diskcanvas/${STANDALONE_PAGE_FILENAME}?path=`)).toBe(true)
  })

  it("路径往返无损（含中文、空格、加号、井号、与号）", () => {
    const paths = [
      "/data/我的画布.canvas",
      "/data/a b/两 个空格.canvas",
      "/data/1+1.canvas",
      "/data/问号?不是参数.canvas",
      "/data/and&or.canvas",
      "/data/井号#1.canvas",
      "/data/百分%号.canvas",
      "/data/子目录/深层/画布.canvas",
    ]

    for (const path of paths) {
      const url = buildStandalonePageUrl("p", path)
      const search = url.slice(url.indexOf("?"))
      expect(readStandalonePath(search), `往返失败：${path}`).toBe(path)
    }
  })

  it("★ 加号不会被变成空格 ★", () => {
    // URLSearchParams 会把 `+` 解析成空格；用 encodeURIComponent 生成才没有这个歧义
    const url = buildStandalonePageUrl("p", "/data/a+b.canvas")
    expect(url).not.toContain("path=/data/a+b.canvas")
    expect(readStandalonePath(url.slice(url.indexOf("?")))).toBe("/data/a+b.canvas")
  })

  it("版本参数 v 会带上，且不影响 path 的解析（缓存击穿）", () => {
    const url = buildStandalonePageUrl("p", "/data/x.canvas", "0.2.5")
    expect(url).toBe("/plugins/p/standalone.html?path=%2Fdata%2Fx.canvas&v=0.2.5")
    expect(readStandalonePath(url.slice(url.indexOf("?")))).toBe("/data/x.canvas")
  })

  it("不给版本时不产生空参数（而不是拼出 &v=）", () => {
    expect(buildStandalonePageUrl("p", "/data/x.canvas")).toBe("/plugins/p/standalone.html?path=%2Fdata%2Fx.canvas")
    expect(buildStandalonePageUrl("p", "/data/x.canvas", "")).toBe("/plugins/p/standalone.html?path=%2Fdata%2Fx.canvas")
  })

  it("缺参数 / 空参数一律返回空串（交给调用方提示，而不是去读空路径）", () => {
    expect(readStandalonePath("")).toBe("")
    expect(readStandalonePath("?")).toBe("")
    expect(readStandalonePath("?other=1")).toBe("")
    expect(readStandalonePath("?path=")).toBe("")
    expect(readStandalonePath("?path=%20%20")).toBe("")
  })
})

describe("extractStylesheetHrefs", () => {
  it("按出现顺序取出 stylesheet，并忽略其它 link", () => {
    const html = `
      <head>
        <link rel="manifest" href="/manifest.webmanifest">
        <link rel="apple-touch-icon" href="/icon.png">
        <link rel="stylesheet" href="/stage/build/desktop/base.048ce7f1fc7e03669f34.css">
        <link rel="stylesheet" href="/appearance/themes/midnight/theme.css?v=3.8.5">
        <link rel="stylesheet" href="/stage/protyle/js/highlight.js/styles/base16/dracula.min.css?v=11.12.0">
        <script src="/a.js"></script>
      </head>
    `

    expect(extractStylesheetHrefs(html)).toEqual([
      "/stage/build/desktop/base.048ce7f1fc7e03669f34.css",
      "/appearance/themes/midnight/theme.css?v=3.8.5",
      "/stage/protyle/js/highlight.js/styles/base16/dracula.min.css?v=11.12.0",
    ])
  })

  it("容忍属性顺序颠倒、单引号、无引号与多余空白", () => {
    const html = `<link href='/a.css' rel='stylesheet'><link  rel = stylesheet  href = /b.css >`
    expect(extractStylesheetHrefs(html)).toEqual(["/a.css", "/b.css"])
  })

  it("rel 含多值时只认包含 stylesheet 的那种写法里的首个 token", () => {
    // 思源实际写法是单个 `stylesheet`；这里只保证不会把 `preload` 之类误当样式表
    const html = `<link rel="preload" href="/x.css"><link rel="stylesheet" href="/y.css">`
    expect(extractStylesheetHrefs(html)).toEqual(["/y.css"])
  })

  it("去重（同一 URL 只注入一次，避免重复请求）", () => {
    const html = `<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/a.css">`
    expect(extractStylesheetHrefs(html)).toEqual(["/a.css"])
  })

  it("没有样式表时返回空数组（调用方据此走兜底路径）", () => {
    expect(extractStylesheetHrefs("<html><body>no styles</body></html>")).toEqual([])
    expect(extractStylesheetHrefs("")).toEqual([])
  })

  it("★ 真实思源首页形态：三条 link 一条不落 ★", () => {
    // 取自 NAS 真机 `GET /` 的实测结果（2026-09-29，思源 v3.8.5，暗色 midnight）
    const real = `<!DOCTYPE html><html lang="zh_CN" data-theme-mode="dark"><head><meta charset="utf-8"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon.png"><link rel="stylesheet" href="/stage/build/desktop/base.048ce7f1fc7e03669f34.css"><link rel="stylesheet" href="/appearance/themes/midnight/theme.css?v=3.8.5"><link rel="stylesheet" href="/stage/protyle/js/highlight.js/styles/base16/dracula.min.css?v=11.12.0"></head><body><div id="layouts"></div></body></html>`
    const hrefs = extractStylesheetHrefs(real)
    expect(hrefs).toHaveLength(3)
    expect(hrefs[0]).toContain("/stage/build/desktop/base.")
    expect(hrefs[1]).toContain("/appearance/themes/midnight/theme.css")
  })
})

describe("resolveThemeModeLabel", () => {
  it("内核的 0 / 1 是浅色 / 深色", () => {
    expect(resolveThemeModeLabel(0)).toBe("light")
    expect(resolveThemeModeLabel(1)).toBe("dark")
  })

  it("字符串与布尔也认（不同接口里三种形态都出现过）", () => {
    expect(resolveThemeModeLabel("1")).toBe("dark")
    expect(resolveThemeModeLabel("0")).toBe("light")
    expect(resolveThemeModeLabel(true)).toBe("dark")
    expect(resolveThemeModeLabel("dark")).toBe("dark")
    expect(resolveThemeModeLabel("DARK ")).toBe("dark")
  })

  it("认不出来时回落 light（与 detectHostThemeMode 的默认一致）", () => {
    expect(resolveThemeModeLabel(undefined)).toBe("light")
    expect(resolveThemeModeLabel(null)).toBe("light")
    expect(resolveThemeModeLabel("")).toBe("light")
    expect(resolveThemeModeLabel({})).toBe("light")
  })
})

describe("resolveThemeStylesheetHref", () => {
  it("★ 暗色取 themeDark、浅色取 themeLight（真机实测的那一组）★", () => {
    const appearance = {
      mode: 1,
      themeDark: "midnight",
      themeLight: "daylight",
      themeVer: "3.8.5",
    }
    expect(resolveThemeStylesheetHref(appearance)).toBe("/appearance/themes/midnight/theme.css?v=3.8.5")
    expect(resolveThemeStylesheetHref({ ...appearance, mode: 0 })).toBe("/appearance/themes/daylight/theme.css?v=3.8.5")
  })

  it("运行时那条 link 就是这个地址（逐字对齐，含版本参数）", () => {
    // 实测运行时 DOM：/appearance/themes/midnight/theme.css?v=3.8.5
    expect(resolveThemeStylesheetHref({ mode: 1, themeDark: "midnight", themeVer: "3.8.5" }))
      .toBe("/appearance/themes/midnight/theme.css?v=3.8.5")
  })

  it("没有 themeVer 时不带版本参数（而不是拼出 ?v=）", () => {
    expect(resolveThemeStylesheetHref({ mode: 1, themeDark: "midnight" }))
      .toBe("/appearance/themes/midnight/theme.css")
    expect(resolveThemeStylesheetHref({ mode: 1, themeDark: "midnight", themeVer: "  " }))
      .toBe("/appearance/themes/midnight/theme.css")
  })

  it("第三方主题名照常支持", () => {
    expect(resolveThemeStylesheetHref({ mode: 0, themeLight: "my-theme" }))
      .toBe("/appearance/themes/my-theme/theme.css")
  })

  it("缺主题名时返回 null（调用方跳过，而不是拼出一个必然 404 的地址）", () => {
    expect(resolveThemeStylesheetHref(null)).toBeNull()
    expect(resolveThemeStylesheetHref(undefined)).toBeNull()
    expect(resolveThemeStylesheetHref({})).toBeNull()
    expect(resolveThemeStylesheetHref({ mode: 1 })).toBeNull()
    expect(resolveThemeStylesheetHref({ mode: 1, themeDark: "   " })).toBeNull()
  })
})

describe("resolveI18nCatalog", () => {
  it("英文（含下划线写法）走 en_US", () => {
    expect(resolveI18nCatalog("en_US").toolbarOpen).toBe("Open")
    expect(resolveI18nCatalog("en-US").toolbarOpen).toBe("Open")
    expect(resolveI18nCatalog("en").toolbarOpen).toBe("Open")
  })

  it("中文（含下划线写法）走 zh_CN", () => {
    expect(resolveI18nCatalog("zh_CN").toolbarOpen).toBe("打开")
    expect(resolveI18nCatalog("zh-CN").toolbarOpen).toBe("打开")
  })

  it("认不出来的语言回落 zh_CN（与 createCanvasI18n 的 FALLBACK_LOCALE 一致）", () => {
    expect(resolveI18nCatalog(undefined).toolbarOpen).toBe("打开")
    expect(resolveI18nCatalog("").toolbarOpen).toBe("打开")
    expect(resolveI18nCatalog("ja_JP").toolbarOpen).toBe("打开")
  })

  it("新增的独立页文案两份目录都在", () => {
    expect(resolveI18nCatalog("zh_CN").toolbarOpenStandalone).toBe("在独立网页中打开")
    expect(resolveI18nCatalog("en_US").toolbarOpenStandalone).toBe("Open in standalone page")
  })
})
