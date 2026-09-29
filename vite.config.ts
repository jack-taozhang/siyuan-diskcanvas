/* eslint-disable node/prefer-global/process */
import { resolve } from "node:path"
import vue from "@vitejs/plugin-vue"
import fg from "fast-glob"
import minimist from "minimist"
import livereload from "rollup-plugin-livereload"
import {
  defineConfig,
  loadEnv,
} from "vite"
import { configDefaults } from "vitest/config"
import { viteStaticCopy } from "vite-plugin-static-copy"

const pluginInfo = require("./plugin.json")

export default defineConfig(({
  mode,
}) => {

  console.log('mode=>', mode)
  const env = loadEnv(mode, process.cwd())
  const {
    VITE_SIYUAN_WORKSPACE_PATH,
  } = env
  console.log('env=>', env)


  const siyuanWorkspacePath = VITE_SIYUAN_WORKSPACE_PATH
  let devDistDir = './dev'
  if (!siyuanWorkspacePath) {
    console.log("\nSiyuan workspace path is not set.")
  } else {
    console.log(`\nSiyuan workspace path is set:\n${siyuanWorkspacePath}`)
    devDistDir = `${siyuanWorkspacePath}/data/plugins/${pluginInfo.name}`
  }
  console.log(`\nPlugin will build to:\n${devDistDir}`)

  const args = minimist(process.argv.slice(2))
  const isWatch = args.watch || args.w || false
  const distDir = isWatch ? devDistDir : "./dist"

  console.log()
  console.log("isWatch=>", isWatch)
  console.log("distDir=>", distDir)

  return {
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        ...(mode === "test" ? { siyuan: resolve(__dirname, "tests/__mocks__/siyuan.ts") } : {}),
      },
    },

    test: {
      exclude: [
        ...configDefaults.exclude,
        "**/.worktrees/**",
        "**/dist/**",
        "**/dev/**",
      ],
    },

    plugins: [
      vue(),
      viteStaticCopy({
        targets: [
          {
            src: "./README*.md",
            dest: "./",
          },
          {
            src: "./icon.png",
            dest: "./",
          },
          {
            src: "./preview.png",
            dest: "./",
          },
          {
            src: "./plugin.json",
            dest: "./",
          },
          {
            src: "./src/i18n/*.json",
            dest: "./i18n/",
          },
        ],
      }),
    ],

    // https://github.com/vitejs/vite/issues/1930
    // https://vitejs.dev/guide/env-and-mode.html#env-files
    // https://github.com/vitejs/vite/discussions/3058#discussioncomment-2115319
    // 在这里自定义变量
    define: {
      "process.env.DEV_MODE": `"${isWatch}"`,
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
    },

    build: {
      // 输出路径
      outDir: distDir,
      emptyOutDir: !isWatch,

      // 构建后是否生成 source map 文件
      sourcemap: false,

      // 设置为 false 可以禁用最小化混淆
      // 或是用来指定是应用哪种混淆器
      // boolean | 'terser' | 'esbuild'
      // 不压缩，用于调试
      minify: !isWatch,

      lib: {
        // Could also be a dictionary or array of multiple entry points
        entry: resolve(__dirname, "src/index.ts"),
        // the proper extensions will be added
        fileName: "index",
        formats: ["cjs"],
      },
      rollupOptions: {
        plugins: [
          ...(isWatch
            ? [
                livereload(devDistDir),
                {
                  // 监听静态资源文件
                  name: "watch-external",
                  async buildStart() {
                    const files = await fg([
                      "src/i18n/*.json",
                      "./README*.md",
                      "./plugin.json",
                    ])
                    for (const file of files) {
                      this.addWatchFile(file)
                    }
                  },
                },
              ]
            : [
                /*
                 * ★ zip 打包已移除（2026-09-28）★
                 *
                 *   两个原因：
                 *   ① 本机有「批量删除守卫」（sitecustomize.py 注入）：
                 *      一次 turn 内删除 >50 个文件就 SystemExit(1)。
                 *      zipPack 每次构建会在 dist/ 与 package.zip 上做大量删除，
                 *      实测报 [SAFE_DELETE_BULK_CONFIRM_REQUIRED] count=50 ⇒ 整个构建失败。
                 *   ② 思源插件根本不需要 zip 才能安装：
                 *      把构建产物直接放进 <工作区>/data/plugins/<插件名>/ 即可，
                 *      重启思源后就能在「已下载」里启用。
                 *
                 *   要出发布包时，用 tools/pack.mjs 手动生成（见该脚本注释）。
                 */
              ]),
        ],

        // 使用函数以精确控制外部依赖：
        // siyuan/process 为思源运行时注入，须 external
        // 其余 npm 包（vue / marked 等）须打包进产物（Vite library mode 默认 external 全部 dependencies）
        external: (id) => {
          if (id === "siyuan" || id === "process") return true
          if (id.startsWith("siyuan/") || id.startsWith("process/")) return true
          // node builtins
          if (id.startsWith("node:")) return true
          return false
        },

        output: {
          entryFileNames: "[name].js",
          assetFileNames: (assetInfo) => {
            if (assetInfo.name === "style.css") {
              return "index.css"
            }
            return assetInfo.name
          },
        },
      },
    },
  }
})
