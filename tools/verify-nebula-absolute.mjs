/**
 * 校验 NebulaClient.absolute() 的「容器内主机名改写」。
 *
 * ★ 为什么这个测试不能省 ★
 *   实测 /api/preview 返回的 url 里嵌的是 `http://nebula:8088/api/raw/...`。
 *   这是 docker 服务名，浏览器解析不了 ⇒ 预览永远转圈。
 *   但**错误表现是"转圈"而不是"报错"**，很难归因。
 *   所以必须有一条断言把它钉住。
 *
 * 用法： node tools/verify-nebula-absolute.mjs
 */

// 直接内联一份被测逻辑（与 nebula-client.ts 的 absolute() 保持同构）。
// 之所以不 import TS：本探针跑在裸 node 上，不带 TS 转译。
function makeAbsolute(baseUrl, log = () => {}) {
  return (pathOrUrl) => {
    const v = String(pathOrUrl || '')
    if (!v) return ''

    const abs = /^https?:\/\//i.test(v)
      ? v
      : `${baseUrl}${v.startsWith('/') ? '' : '/'}${v}`

    if (!/^https?:\/\//i.test(abs)) return abs

    let target
    let base
    try {
      target = new URL(abs)
      base = new URL(baseUrl)
    } catch {
      return abs
    }

    if (target.host === base.host) return abs

    const bareHost = target.hostname
    const looksInternal = Boolean(bareHost)
      && bareHost.indexOf('.') < 0
      && bareHost !== 'localhost'
      && bareHost !== '127.0.0.1'

    if (!looksInternal) return abs

    target.protocol = base.protocol
    target.hostname = base.hostname
    target.port = base.port
    log(`${target.host}`)
    return target.toString()
  }
}

const CASES = []

function check(name, actual, expected) {
  const pass = actual === expected
  CASES.push({ actual, expected, name, pass })
}

// ── 用例 1：真实实测值（容器内主机名必须被改写）──────────────
{
  const absolute = makeAbsolute('http://<netdisk-host>:8089')
  const real = '/preview/onlinePreview?url=aHR0cDovL25lYnVsYTo4MDg4L2FwaS9yYXcveC5wZGY%3D%3D'
  check(
    '相对预览地址 → 拼上宿主基点',
    absolute(real),
    'http://<netdisk-host>:8089/preview/onlinePreview?url=aHR0cDovL25lYnVsYTo4MDg4L2FwaS9yYXcveC5wZGY%3D%3D',
  )
}

// ── 用例 2：绝对地址但主机是容器名（核心场景）────────────────
{
  const absolute = makeAbsolute('http://<netdisk-host>:8089')
  check(
    'nebula:8088（容器名）→ 改写为宿主可达',
    absolute('http://nebula:8088/api/raw/file.pdf?mount=x&exp=1&sig=abc'),
    'http://<netdisk-host>:8089/api/raw/file.pdf?mount=x&exp=1&sig=abc',
  )
}

// ── 用例 3：签名参数必须原样保留（改了就 403）───────────────
{
  const absolute = makeAbsolute('http://<netdisk-host>:8089')
  const out = absolute('http://nebula:8088/api/raw/a.pdf?mount=m&path=%2Fa.pdf&exp=1790558781&sig=406da86ca1b74a1029a27b0f98998bc207e0e4768202d0a35ae3c01f1a8b019f')
  check(
    '签名参数 sig/exp/path 原样保留',
    out,
    'http://<netdisk-host>:8089/api/raw/a.pdf?mount=m&path=%2Fa.pdf&exp=1790558781&sig=406da86ca1b74a1029a27b0f98998bc207e0e4768202d0a35ae3c01f1a8b019f',
  )
}

// ── 用例 4：同源地址不动 ──────────────────────────────────
{
  const absolute = makeAbsolute('http://<netdisk-host>:8089')
  check(
    '同源绝对地址保持原样',
    absolute('http://<netdisk-host>:8089/api/raw/x.pdf'),
    'http://<netdisk-host>:8089/api/raw/x.pdf',
  )
}

// ── 用例 5：外网域名不误改（含点 ⇒ 不是容器名）─────────────
{
  const absolute = makeAbsolute('http://<netdisk-host>:8089')
  check(
    '外网域名不误改',
    absolute('https://cdn.example.com/a.png'),
    'https://cdn.example.com/a.png',
  )
}

// ── 用例 6：localhost / 127.0.0.1 不误改 ────────────────────
{
  const absolute = makeAbsolute('http://<netdisk-host>:8089')
  check(
    'localhost 不误改',
    absolute('http://localhost:8088/x'),
    'http://localhost:8088/x',
  )
  check(
    '127.0.0.1 不误改',
    absolute('http://127.0.0.1:8088/x'),
    'http://127.0.0.1:8088/x',
  )
}

// ── 用例 7：空值 ─────────────────────────────────────────
{
  const absolute = makeAbsolute('http://<netdisk-host>:8089')
  check('空串返回空串', absolute(''), '')
  check('null 返回空串', absolute(null), '')
}

// ── 输出 ────────────────────────────────────────────────
let failed = 0
for (const c of CASES) {
  if (c.pass) {
    console.log(`  [OK]   ${c.name}`)
  } else {
    failed += 1
    console.log(`  [FAIL] ${c.name}`)
    console.log(`         期望: ${c.expected}`)
    console.log(`         实际: ${c.actual}`)
  }
}
console.log(`\n${CASES.length - failed}/${CASES.length} 通过`)
process.exit(failed ? 1 : 0)
