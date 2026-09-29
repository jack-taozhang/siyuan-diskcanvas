#!/usr/bin/env node
/**
 * 浏览器端到端验证驱动器。
 *
 * 依 skill「headless-browser-verify-windows」的三条硬要求：
 *   ① HTTP 服务由本脚本自己持有（不依赖跨调用的后台进程）
 *   ② Chrome 必须带 --no-proxy-server 与 --proxy-bypass-list=<-loopback>
 *      （本机系统代理会代理 127.0.0.1，导致 ERR_CONNECTION_REFUSED）
 *   ③ 抓不到结果时必须取证（readyState / title / scripts / 事件日志），
 *      而不是只说「失败了」
 */
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")
const { spawn } = require("node:child_process")
const WebSocket = require("ws")

const ROOT = path.resolve(__dirname, "_verify-dist")
const PROFILE = path.resolve(__dirname, "_verify-chrome-profile")
const PORT = 8791

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0])
    const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "")
    const file = path.join(ROOT, rel)
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)))
}

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  throw new Error("找不到 Chrome / Edge")
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getTarget() {
  // Chrome 需要一点时间把调试端口拉起来
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9222/json/list")
      const list = await res.json()
      const page = list.find((t) => t.type === "page")
      if (page) return page
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  throw new Error("Chrome 调试端口 9222 未就绪")
}

async function main() {
  fs.rmSync(PROFILE, { force: true, recursive: true })

  const server = await startStaticServer()
  console.log(`[静态服务] http://127.0.0.1:${PORT}/`)

  const chrome = spawn(findChrome(), [
    "--headless=new",
    "--remote-debugging-port=9222",
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    // ★ 本机系统代理会代理回环地址，两条都必须加
    "--no-proxy-server",
    "--proxy-bypass-list=<-loopback>",
    "about:blank",
  ], { stdio: "ignore" })

  let ws
  const events = []
  const cleanup = () => {
    try { ws && ws.close() } catch {}
    try { chrome.kill() } catch {}
    try { server.close() } catch {}
  }

  try {
    const target = await getTarget()
    ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
    await new Promise((resolve, reject) => {
      ws.once("open", resolve)
      ws.once("error", reject)
    })

    let msgId = 0
    const pending = new Map()
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      } else if (msg.method) {
        // 只留取证需要的
        if (msg.method === "Runtime.exceptionThrown") {
          events.push("EXCEPTION: " + JSON.stringify(msg.params.exceptionDetails?.exception?.description
            || msg.params.exceptionDetails?.text).slice(0, 300))
        } else if (msg.method === "Log.entryAdded") {
          const e = msg.params.entry
          if (e.level === "error" || e.level === "warning") {
            events.push(`LOG[${e.level}]: ${String(e.text).slice(0, 300)}`)
          }
        } else if (msg.method === "Runtime.consoleAPICalled") {
          if (["error", "warning"].includes(msg.params.type)) {
            events.push(`CONSOLE[${msg.params.type}]: ` + (msg.params.args || []).map(a => a.value ?? a.description ?? "").join(" ").slice(0, 300))
          }
        }
      }
    })

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++msgId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

    // ★ 监听器必须在 navigate 之前就位，否则早期异常抓不到
    await send("Page.enable")
    await send("Runtime.enable")
    await send("Log.enable")
    await send("Network.enable")

    await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` })

    let result = null
    for (let i = 0; i < 60; i++) {
      await sleep(300)
      const r = await send("Runtime.evaluate", {
        expression: "JSON.stringify(window.__verify || null)",
        returnByValue: true,
      })
      const val = r?.result?.value
      if (val && val !== "null") { result = JSON.parse(val); break }
    }

    if (!result) {
      // ★ 取证：区分「脚手架坏了」和「代码坏了」
      const probe = await send("Runtime.evaluate", {
        expression: `JSON.stringify({
          title: document.title,
          readyState: document.readyState,
          scripts: [...document.scripts].map(s => s.src || '(inline)'),
          hasReport: !!document.getElementById('report'),
          reportText: (document.getElementById('report')||{}).textContent || '',
          url: location.href,
        })`,
        returnByValue: true,
      })
      console.error("\n✘ 未拿到 __verify 结果 —— 取证信息：")
      console.error(probe?.result?.value)
      console.error("\n事件日志：")
      for (const e of events) console.error("  " + e)
      cleanup()
      process.exit(1)
    }

    console.log("\n" + result.report.join("\n"))
    console.log(`\n合计: ${result.pass} 通过 / ${result.fail} 失败`)
    if (events.length) {
      console.log("\n浏览器告警/异常：")
      for (const e of events) console.log("  " + e)
    }

    cleanup()
    process.exit(result.fail > 0 ? 1 : 0)
  } catch (error) {
    console.error("✘ 验证驱动异常:", error.message)
    for (const e of events) console.error("  " + e)
    cleanup()
    process.exit(1)
  }
}

main()
