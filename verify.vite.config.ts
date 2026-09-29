import { resolve } from "node:path"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

// 自检页构建配置：加载**真实源码模块**（alias @ → src），不是复制品。
// base 必须相对路径 —— 否则 http 服务下资源 404。
export default defineConfig({
  root: resolve(__dirname, "_verify"),
  base: "./",
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      siyuan: resolve(__dirname, "_verify/siyuan-stub.ts"),
    },
  },
  build: {
    outDir: resolve(__dirname, "_verify-dist"),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: "verify.js",
        assetFileNames: "verify.[ext]",
      },
    },
  },
})
