/**
 * 独立网页编辑器（`standalone.html`）的构建配置。
 * ============================================================================
 *
 * 为什么是**第二个配置**而不是往 `vite.config.ts` 里塞第二个入口：
 *
 *   插件本体走的是 **library 模式**（`build.lib.entry` = `src/index.ts`，
 *   输出 CJS，`siyuan` 标记为 external 留给宿主）。而独立页必须是一个
 *   **普通应用构建**（HTML 入口、浏览器可直接跑的 ESM、样式自动抽取并联进 HTML）。
 *   这两种模式的 `rollupOptions.input` / 产物形态互不兼容 ——
 *   lib 模式一旦加了 HTML input，HTML 不会被处理，`index.js` 的 CJS 外壳也会被搅乱。
 *
 *   所以拆成两次构建、产出到**同一个目录**：
 *     ① `npm run build:plugin`      → dist/index.js + index.css + plugin.json + icon.png …
 *     ② `npm run build:standalone`  → dist/standalone.html + standalone.js + standalone.css
 *
 *   ★ 顺序不能反 ★：① 的 `emptyOutDir` 为 true，会清空 dist；
 *    ② 显式设 `emptyOutDir: false`（见下），只往里加文件。
 *
 * ---------------------------------------------------------------------------
 * 两个关键约定
 * ---------------------------------------------------------------------------
 *
 *  ★ `base: "./"` —— 产物用**相对路径**引用资源
 *    独立页部署在 `/plugins/<插件名>/standalone.html`，
 *    相对路径即 `/plugins/<插件名>/standalone.js`，
 *    与思源"插件目录整体挂载"的模型天然对齐，不需要知道插件名。
 *
 *  ★ `siyuan` 别名到本地 shim —— 这是"能跑起来"的关键
 *    画布组件链里有 15 处 `import … from "siyuan"`。
 *    独立页没有宿主，这个模块不存在，不处理会直接构建失败。
 *    别名指向 `src/standalone/siyuan-module-shim.ts`：
 *    能真做的真做（同源内核 API / 对话框 / 跳转），做不到的安静降级。
 *    **插件本体的构建完全不受影响**，`siyuan` 在那里依旧是 external 的真模块。
 */

import { resolve } from "node:path"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

/** 插件版本（与 plugin.json 同源，用于缓存击穿） */
const pluginVersion = String((require("./plugin.json") as { version?: string }).version || "0")

/**
 * ★ 缓存击穿：给 HTML 里的 `standalone.js` / `standalone.css` 补上 `?v=<版本>` ★
 *
 * 为什么必须做（实测踩过）：
 *   内核给 `/plugins/**` 的静态响应**没有 `Cache-Control`、也没有 `ETag`**，
 *   只有 `Last-Modified`（curl 实测）。浏览器于是按「启发式缓存」处理，
 *   新鲜期约为「文件年龄的 10%」—— 一个部署了几个月的老文件，
 *   新鲜期可以长达数天。后果：插件升级后，独立页仍加载**旧 bundle**，
 *   而且**不报任何错**，只是少功能 / 样式不对（真机上就这样白跑了一轮验证）。
 *
 * 处置：
 *   · 页面 URL 由工具栏按钮生成，本身带 `?v=<版本>` ⇒ HTML 按 URL 缓存，
 *     新版本 = 新 URL ⇒ HTML 必然重新拉取。
 *   · 但 HTML 里引用的 js/css 是**写死的文件名**，URL 不变 ⇒ 还是要走缓存。
 *     所以在这里把版本作为查询参数写进去，让这两个 URL 也随版本变化。
 *
 * 为什么把 `?v=` 加**查询串**而不是改文件名（`standalone.0.2.6.js`）：
 *   改文件名的话，"被缓存的旧 HTML"会指向一个**已不存在的文件** ⇒ 直接 404 白屏；
 *   加查询串时，旧 HTML 指向的 `standalone.js` 依然存在，最坏只是内容旧一点。
 *   宁可稍微旧，也不要打不开。
 */
const cacheBustPlugin = {
  name: "dc-standalone-cache-bust",
  transformIndexHtml: {
    order: "post" as const,
    handler(html: string) {
      return html
        .replace(/(<script\b[^>]*\bsrc=")(\.\/standalone\.js)(")/, `$1$2?v=${pluginVersion}$3`)
        .replace(/(<link\b[^>]*\bhref=")(\.\/standalone\.css)(")/, `$1$2?v=${pluginVersion}$3`)
    },
  },
}

export default defineConfig({
  // 相对资源路径：部署在 /plugins/<插件名>/ 下也能正确解析
  base: "./",

  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      // ★ 必须放在最后：精确匹配 `siyuan`，不误伤 `siyuan/xxx` 这类子路径
      { find: /^siyuan$/, replacement: resolve(__dirname, "src/standalone/siyuan-module-shim.ts") },
    ],
  },

  // ★ 缓存击穿插件必须排在 vue() **之后**：它要在 Vite 注入完 script/link 之后再看 HTML
  plugins: [vue(), cacheBustPlugin],

  define: {
    "process.env.DEV_MODE": `"false"`,
    "process.env.NODE_ENV": JSON.stringify("production"),
  },

  build: {
    outDir: resolve(__dirname, "dist"),
    // ★ 绝不能清空：dist 里已有插件本体（①的产物）
    emptyOutDir: false,

    sourcemap: false,
    minify: "esbuild",

    rollupOptions: {
      input: {
        standalone: resolve(__dirname, "standalone.html"),
      },
      output: {
        // 固定文件名，便于排查（不参与缓存击穿的风险：整页刷新由思源版本号控制）
        entryFileNames: "standalone.js",
        chunkFileNames: "standalone-[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.some((name) => name.endsWith(".css")) || assetInfo.name?.endsWith(".css")) {
            return "standalone.css"
          }
          return "assets/[name]-[hash][extname]"
        },
      },
    },
  },
})
