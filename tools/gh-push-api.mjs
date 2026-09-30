#!/usr/bin/env node
/**
 * 用 **Git Data API 整树推送** 把本地 HEAD 推到远端分支。
 *
 * ★ 为什么需要它 ★
 *   本机 `git push` 会**挂死**（exit 124 超时 / 静默 128），但根因**不是**网络、
 *   也**不是**权限：GCM（git-credential-manager）里有有效凭据 ——
 *     printf 'protocol=https\nhost=github.com\n\n' | git-credential-manager.exe get
 *   能拿到 `gho_…`；用它打 `GET /repos/...` 也返回 `permissions.push = true`。
 *   是 GCM 在**非桌面 shell** 里自己卡住。⇒ 绕开 git 的凭据链路，直接走 REST。
 *
 * ★ 与之配套的坑（都实测过）★
 *   1. `github.com` **时通时断**（同一 session 内翻过两次），`api.github.com` 一直稳。
 *      本脚本只依赖 `api.github.com`。
 *   2. 远端那个提交可能是**上一次用 API 建的**，本地**从未 fetch 到** ⇒
 *      不能 `git diff <remote_head> HEAD`（exit 128）。
 *      改法：在本地提交链里找一个 **tree == base_tree** 的提交当 diff 基点。
 *   3. `github.com` 不通时 `git fetch` 拿不到对象 ⇒ 本地引用改用
 *      `git update-ref refs/remotes/origin/main <本地同 tree 的提交>` 对齐。
 *
 * 用法：
 *   node tools/gh-push-api.mjs [--dry-run] [--branch main]
 *
 * 退出码：0 成功（含"已是最新"）；1 失败。
 */
import { execFileSync, spawnSync } from "node:child_process"

const API = "https://api.github.com"

const argv = process.argv.slice(2)
const DRY = argv.includes("--dry-run")
const branchIdx = argv.indexOf("--branch")
const BRANCH = branchIdx >= 0 ? argv[branchIdx + 1] : "main"

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}

function gitBuffer(...args) {
  return execFileSync("git", args, { encoding: "buffer" })
}

/**
 * 取 GitHub 凭据。
 *
 * ★ 用 `git credential fill` 而不是直接调 git-credential-manager ★
 *   前者遵从**用户自己配置的** credential.helper（GCM / store / 其它都可），
 *   脚本因此不绑定任何本机绝对路径，换个环境也能用。
 *
 * ⚠️ 必须带 timeout：凭据不存在时助手会**尝试交互**，在非桌面 shell 里会挂死。
 *    本场景已确认凭据是存在的（GCM 里有 `gho_…`），所以不会走到交互分支。
 */
function readToken() {
  const res = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    timeout: 15000,
  })
  if (res.error) {
    throw new Error(`取凭据失败：${res.error.message}（凭据助手可能不可用或需交互）`)
  }
  const line = (res.stdout || "").split("\n").find((l) => l.startsWith("password="))
  if (!line) {
    throw new Error("凭据里没有 password（先确认 github.com 已登录过一次）")
  }
  return line.slice("password=".length).trim()
}

function parseSlug() {
  const url = git("remote", "get-url", "origin")
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!m) {
    throw new Error(`无法从 remote 解析 owner/repo：${url}`)
  }
  return `${m[1]}/${m[2]}`
}

const TOKEN = readToken()
const SLUG = parseSlug()

async function req(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "diskcanvas-gh-push",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { _raw: text.slice(0, 400) }
  }
  return { status: res.status, json }
}

function fail(msg, detail) {
  console.error(`\n✗ ${msg}`)
  if (detail) {
    console.error(JSON.stringify(detail, null, 2).slice(0, 1200))
  }
  process.exit(1)
}

// ── 1) 本地状态 ─────────────────────────────────────────────
const localHead = git("rev-parse", "HEAD")
const localTree = git("rev-parse", "HEAD^{tree}")
const subject = git("log", "-1", "--pretty=%s")
console.log(`仓库     : ${SLUG}`)
console.log(`本地 HEAD: ${localHead.slice(0, 8)}  tree ${localTree.slice(0, 8)}`)
console.log(`提交信息 : ${subject}`)

// ── 2) 远端 ref ────────────────────────────────────────────
const refRes = await req("GET", `/repos/${SLUG}/git/ref/heads/${BRANCH}`)
if (refRes.status !== 200) {
  fail(`取远端 ref 失败（${refRes.status}）`, refRes.json)
}
const remoteHead = refRes.json.object.sha
console.log(`远端 HEAD: ${remoteHead.slice(0, 8)}`)

if (remoteHead === localHead) {
  console.log("\n✓ 远端已是最新，无需推送")
  process.exit(0)
}

const commitRes = await req("GET", `/repos/${SLUG}/git/commits/${remoteHead}`)
if (commitRes.status !== 200) {
  fail(`取远端 commit 失败（${commitRes.status}）`, commitRes.json)
}
const baseTree = commitRes.json.tree.sha
console.log(`base_tree: ${baseTree.slice(0, 8)}`)

// ── 3) 找本地 diff 基点（tree == base_tree）─────────────────
const localCommits = git("log", "--format=%H", "-200").split("\n").filter(Boolean)
let baseCommit = null
for (const c of localCommits) {
  if (git("rev-parse", `${c}^{tree}`) === baseTree) {
    baseCommit = c
    break
  }
}
if (!baseCommit) {
  fail(
    "本地找不到 tree == base_tree 的提交。\n" +
      "  ⇒ 通常是本地历史上被压平过。先 `git fetch origin` 拿到远端对象再试。",
  )
}
console.log(`diff 基点: ${baseCommit.slice(0, 8)}（本地）`)

// ── 4) 列出改动 ────────────────────────────────────────────
const diff = git("diff", "--name-status", baseCommit, localHead)
const changes = []
for (const line of diff.split("\n")) {
  if (!line.trim()) continue
  const parts = line.split("\t")
  const status = parts[0][0]
  // 改名会给 R100\t旧\t新 —— 按「删旧 + 增新」处理
  if (status === "R" || status === "C") {
    changes.push({ status: "D", path: parts[1] })
    changes.push({ status: "A", path: parts[2] })
  } else {
    changes.push({ status, path: parts[1] })
  }
}
if (!changes.length) {
  console.log("\n✓ 无文件差异（内容已一致），仅移动引用")
}
console.log(`改动 ${changes.length} 项:`)
for (const c of changes) console.log(`   ${c.status}  ${c.path}`)

if (DRY) {
  console.log("\n--dry-run：到此为止，未写远端")
  process.exit(0)
}

// ── 5) 逐文件建 blob ───────────────────────────────────────
const treeItems = []
const skipped = []
for (const c of changes) {
  if (c.status === "D") {
    treeItems.push({ path: c.path, mode: "100644", type: "blob", sha: null })
    continue
  }
  const ls = git("ls-tree", localHead, c.path)
  if (!ls) {
    skipped.push([c.path, "ls-tree 为空"])
    continue
  }
  const [meta] = ls.split("\t")
  const [mode, type, sha] = meta.split(/\s+/)
  if (type === "commit") {
    skipped.push([c.path, "子模块"])
    continue
  }
  const raw = gitBuffer("cat-file", "blob", sha)
  const blobRes = await req("POST", `/repos/${SLUG}/git/blobs`, {
    content: raw.toString("base64"),
    encoding: "base64",
  })
  if (blobRes.status !== 201 && blobRes.status !== 200) {
    fail(`建 blob 失败：${c.path}（${blobRes.status}）`, blobRes.json)
  }
  treeItems.push({ path: c.path, mode, type: "blob", sha: blobRes.json.sha })
  console.log(`   blob ${c.path} → ${blobRes.json.sha.slice(0, 8)} (${raw.length}B)`)
}
if (skipped.length) {
  console.log(`   跳过 ${skipped.length} 项:`, skipped)
}

// ── 6) 建 tree ─────────────────────────────────────────────
const treeRes = await req("POST", `/repos/${SLUG}/git/trees`, {
  base_tree: baseTree,
  tree: treeItems,
})
if (treeRes.status !== 201 && treeRes.status !== 200) {
  fail(`建 tree 失败（${treeRes.status}）`, treeRes.json)
}
const newTree = treeRes.json.sha
console.log(`\nnew_tree : ${newTree.slice(0, 8)}`)
console.log(`本地 tree: ${localTree.slice(0, 8)}`)
if (newTree !== localTree) {
  fail("★ 建出的 tree 与本地不一致 —— 说明有未覆盖的差异，已中止（远端未改）")
}
console.log("✓ tree 与本地完全一致")

// ── 7) 建 commit ───────────────────────────────────────────
const msg = git("log", "-1", "--pretty=%B").trim()
const commitCreate = await req("POST", `/repos/${SLUG}/git/commits`, {
  message: msg,
  tree: newTree,
  parents: [remoteHead],
})
if (commitCreate.status !== 201 && commitCreate.status !== 200) {
  fail(`建 commit 失败（${commitCreate.status}）`, commitCreate.json)
}
const newCommit = commitCreate.json.sha
console.log(`new_commit: ${newCommit.slice(0, 8)}`)

// ── 8) 移动 ref ────────────────────────────────────────────
const patch = await req("PATCH", `/repos/${SLUG}/git/refs/heads/${BRANCH}`, {
  sha: newCommit,
  force: false,
})
if (patch.status !== 200) {
  fail(`移动 ref 失败（${patch.status}）`, patch.json)
}
console.log(`ref → ${patch.json.object.sha.slice(0, 8)}`)

// ── 9) 回读校验 ────────────────────────────────────────────
const verify = await req("GET", `/repos/${SLUG}/git/ref/heads/${BRANCH}`)
const finalSha = verify.json?.object?.sha
if (finalSha !== newCommit) {
  fail(`回读不一致：远端 ${finalSha?.slice(0, 8)} ≠ 刚推的 ${newCommit.slice(0, 8)}`)
}
console.log(`✓ 回读确认远端 ${BRANCH} = ${finalSha.slice(0, 8)}`)

// ── 10) 对齐本地引用 ───────────────────────────────────────
// 远端对象本地多半没有 ⇒ 直接 update-ref 会报 "nonexistent object"。
// 能不能 fetch 到取决于 `github.com` 是否恰好可达（它时通时断）。
let aligned = false
try {
  execFileSync("git", ["fetch", "origin", BRANCH], { stdio: "pipe", timeout: 20000 })
  // ★ 比 FETCH_HEAD 而不是 origin/<branch>：`git fetch <remote> <ref>` 是否
  //   顺带更新 refs/remotes/origin/<ref> 取决于 refspec 配置，FETCH_HEAD 一定是最新的。
  const stat = execFileSync("git", ["diff", "--stat", "HEAD", "FETCH_HEAD"], {
    encoding: "utf8",
  }).trim()
  if (stat) {
    console.log(`⚠️ fetch 成功，但 HEAD 与 FETCH_HEAD 仍有差异（请复核）:\n${stat}`)
  } else {
    execFileSync("git", ["update-ref", `refs/remotes/origin/${BRANCH}`, "FETCH_HEAD"])
    console.log(`✓ git fetch 成功，origin/${BRANCH} 已对齐且内容一致`)
    aligned = true
  }
} catch {
  // github.com 不可达，属预期
}
if (!aligned) {
  execFileSync("git", ["update-ref", `refs/remotes/origin/${BRANCH}`, localHead])
  console.log(
    `✓ github.com 不可达，已把 origin/${BRANCH} 指到本地同 tree 的提交（status 显示同步）`,
  )
}

console.log("\nPUSH_OK")
