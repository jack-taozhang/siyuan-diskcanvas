/**
 * 实测 NebulaClient 与真实网盘 API 的连通性。
 *
 * 用法：
 *   node tools/probe-nebula-client.mjs
 *
 * ★ 为什么要有这个探针 ★
 *   画布要接网盘，前提是"客户端实现与真实后端对得上"。
 *   单测用 mock 只能证明逻辑自洽，证明不了字段名对不对。
 *   这个探针打真实端点，把实际返回值打出来。
 *
 *   （历史上踩过：/api/mounts 根本不存在，返回 404。
 *     如果只靠"文档说应该有"，就会写出一个永远拿不到挂载点的实现。）
 */

const BASE = process.env.NB_BASE || 'http://<netdisk-host>:8089'
const USER = process.env.NB_USER || 'tao_zhang'
const PASS = process.env.NB_PASS || ''

async function main() {
  if (!PASS) {
    console.error('请用 NB_PASS=<密码> 传入密码')
    process.exit(2)
  }

  let token = ''
  const login = async () => {
    const form = new URLSearchParams()
    form.append('username', USER)
    form.append('password', PASS)
    const res = await fetch(`${BASE}/api/login`, { body: form, method: 'POST' })
    const data = await res.json()
    console.log(`[login] status=${res.status} ok=${data.ok} display=${data.display}`)
    token = data.token
    return token
  }

  const get = async (path, params) => {
    const url = new URL(`${BASE}${path}`)
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    let body = null
    try { body = await res.json() } catch { body = null }
    return { status: res.status, body }
  }

  await login()

  console.log('\n[me]')
  const me = await get('/api/me')
  console.log(`  status=${me.status}`)
  console.log(`  mounts=${JSON.stringify((me.body && me.body.mounts) || [])}`)
  console.log(`  onlyoffice=${me.body?.onlyoffice} cad=${me.body?.cad}`)

  const mounts = (me.body && me.body.mounts) || []
  if (!mounts.length) {
    console.log('  没有挂载点，后续测试跳过')
    return
  }

  const mount = mounts[0].label
  console.log(`\n[list] mount=${mount} path=/`)
  const list = await get('/api/list', { mount, path: '/' })
  console.log(`  status=${list.status}`)
  const entries = (list.body && (list.body.entries || list.body)) || []
  console.log(`  条目数=${Array.isArray(entries) ? entries.length : 'N/A'}`)
  if (Array.isArray(entries) && entries.length) {
    const e = entries[0]
    console.log(`  首条字段：${Object.keys(e).join(',')}`)
    console.log(`  首条内容：name=${e.name} isDir=${e.isDir} ext=${e.ext} route=${e.route}`)
  }

  // 找一个真实文件来测 preview
  const file = Array.isArray(entries) ? entries.find(x => x && !x.isDir) : null
  if (file) {
    console.log(`\n[preview] path=${file.path}`)
    const pv = await get('/api/preview', { mount, path: file.path })
    console.log(`  status=${pv.status} url=${(pv.body && pv.body.url) || '(none)'}`)
  } else {
    console.log('\n[preview] 根目录无文件，跳过')
  }

  console.log('\n[不存在端点对照] /api/mounts')
  const nope = await get('/api/mounts')
  console.log(`  status=${nope.status}（预期 404）`)
}

main().catch((err) => {
  console.error('探针失败：', err)
  process.exit(1)
})
