/* @vitest-environment jsdom */

/**
 * `CanvasLocalFsPickerDialog` —— 「插入本机文件」选择器。
 *
 * 这组用例盯的是**画布侧独有的那几条规则**（本机存储插件本身的列目录能力
 * 已有它自己的测试，不在这里重复）：
 *   ① 拿不到契约时不弹错误，而是给一条可读的出路（否则用户点按钮"毫无反应"）
 *   ② 「常用文件夹」非空 ⇒ 只列它们；为空 ⇒ 问对方要本机全部存储空间
 *   ③ 只在文件上允许插入（目录点进去，不插）
 *   ④ 搜索按**后缀优先**匹配（用户习惯输 `pdf` 而不是 `*.pdf`）
 */

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import CanvasLocalFsPickerDialog from '@/components/canvas/CanvasLocalFsPickerDialog.vue'

const t = (key: string, params?: Record<string, unknown>) =>
  (params ? `${key}:${JSON.stringify(params)}` : key)

/** 造一个只实现选择器用到的两个方法的契约替身 */
function createClient(overrides: Record<string, unknown> = {}) {
  const entries = [
    { isDir: true, name: 'sub', path: '/vol1/sub' },
    { isDir: false, name: 'a.pdf', path: '/vol1/a.pdf', size: 2048 },
    { isDir: false, name: 'b.png', path: '/vol1/b.png', size: 1024 },
  ]

  return {
    // 只给根目录内容，避免递归收集把子目录里的东西也混进来（用例要确定性）
    list: vi.fn(async (path: string) => (path === '/vol1' ? entries : [])),
    roots: vi.fn(async () => [
      { label: 'vol1', path: '/vol1' },
      { label: 'vol2', path: '/vol2' },
    ]),
    ...overrides,
  }
}

async function mountDialog(props: Record<string, unknown>) {
  const wrapper = mount(CanvasLocalFsPickerDialog, {
    props: { favorites: [], t, ...props },
  })
  // ① 载入根 → ② 载入目录 → ③ 后台递归收集，共三轮微任务
  await flushPromises()
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('CanvasLocalFsPickerDialog', () => {
  it('① 没有契约时不列目录，给出可读出路并可直接跳到设置', async () => {
    const wrapper = await mountDialog({ client: null })

    expect(wrapper.find('[data-testid="localfs-picker-not-configured"]').exists()).toBe(true)
    // 不能停在"什么都没有"的状态：必须有一条明确的下一步
    await wrapper.find('[data-testid="localfs-picker-not-configured"] button').trigger('click')
    expect(wrapper.emitted('open-settings')).toHaveLength(1)
  })

  /**
   * ★ 真机踩到的坑：插件早已启用，用户却一直看到"未检测到插件" ★
   *   原因是内核缓存插件 JS（升版本号才破得掉）—— 刚更新过插件时，
   *   用户手里的页面还在跑旧那份，契约自然取不到。
   *   这两种情况的下一步**方向相反**，提示语必须分开。
   */
  it('① 插件已加载（页面是旧版 JS）⇒ 提示"刷新页面"，不是"去安装"', async () => {
    const w = window as unknown as Record<string, unknown>
    w.siyuan = { ws: { app: { plugins: [{ name: 'siyuan-localfs' }] } } }
    try {
      const wrapper = await mountDialog({ client: null })
      expect(wrapper.find('[data-testid="localfs-picker-unavailable"]').text())
        .toBe('localFsPickerPluginOutdated')
    } finally {
      delete w.siyuan
    }
  })

  it('① 页面上没有该插件实例 ⇒ 提示"先安装并启用"', async () => {
    const w = window as unknown as Record<string, unknown>
    w.siyuan = { ws: { app: { plugins: [{ name: 'custom-block' }] } } }
    try {
      const wrapper = await mountDialog({ client: null })
      expect(wrapper.find('[data-testid="localfs-picker-unavailable"]').text())
        .toBe('localFsPickerNotConfigured')
    } finally {
      delete w.siyuan
    }
  })

  it('② 设了常用文件夹 ⇒ 只列它们，不去问本机全部存储空间', async () => {
    const client = createClient()
    const wrapper = await mountDialog({
      client,
      favorites: ['/vol1/1000/图纸', '/vol1/1000/客户'],
    })

    expect(client.roots).not.toHaveBeenCalled()
    expect(client.list).toHaveBeenCalledWith('/vol1/1000/图纸')
    // 两个收藏 ⇒ 出现存储空间下拉；单个时不显示（省一行视觉噪音）
    const select = wrapper.find('[data-testid="localfs-picker-root-select"]')
    expect(select.exists()).toBe(true)
    expect(select.findAll('option')).toHaveLength(2)
  })

  it('② 没设常用文件夹 ⇒ 列本机全部存储空间，默认进第一个', async () => {
    const client = createClient()
    await mountDialog({ client, favorites: [] })

    expect(client.roots).toHaveBeenCalledTimes(1)
    expect(client.list).toHaveBeenCalledWith('/vol1')
  })

  it('③ 目录点进去（不插），文件点一下才可插入', async () => {
    const client = createClient()
    const wrapper = await mountDialog({ client, favorites: ['/vol1'] })

    const insert = wrapper.find('[data-testid="localfs-picker-insert"]')
    expect(insert.attributes('disabled')).toBeDefined()

    // 目录：进入而不是选中
    await wrapper.find('[data-testid="localfs-picker-entry-dir"]').trigger('click')
    await flushPromises()
    expect(client.list).toHaveBeenCalledWith('/vol1/sub')
    expect(insert.attributes('disabled')).toBeDefined()

    // 面包屑能回到根（不靠浏览器的后退键）
    await wrapper.find('[data-testid="localfs-picker-root"]').trigger('click')
    await flushPromises()

    // 文件：选中 ⇒ 可插入，载荷是 {name, path}
    await wrapper.find('[data-testid="localfs-picker-entry-file"]').trigger('click')
    expect(insert.attributes('disabled')).toBeUndefined()

    await insert.trigger('click')
    expect(wrapper.emitted('insert')?.[0]?.[0]).toEqual({
      name: 'a.pdf',
      path: '/vol1/a.pdf',
    })
  })

  it('④ 搜索：输后缀名即按后缀匹配（只要 pdf，不要 png）', async () => {
    const wrapper = await mountDialog({ client: createClient(), favorites: ['/vol1'] })

    // 未搜索：目录 + 两个文件
    expect(wrapper.findAll('[data-testid="localfs-picker-entry-file"]')).toHaveLength(2)

    await wrapper.find('[data-testid="localfs-picker-search"]').setValue('pdf')
    await flushPromises()

    const files = wrapper.findAll('[data-testid="localfs-picker-entry-file"]')
    expect(files).toHaveLength(1)
    expect(files[0].text()).toContain('a.pdf')
    // 目录名不含 pdf ⇒ 一并被过滤（搜索时的意图就是找文件）
    expect(wrapper.findAll('[data-testid="localfs-picker-entry-dir"]')).toHaveLength(0)
  })

  /**
   * ★★ 真机致命缺陷的回归测试 ★★
   *
   * 旧实现在**每次进目录**时就把整棵子树递归扫一遍，而且结果
   * 要等全树扫完才一次性写入；列表**只**由那份递归结果供给。
   * 挂载点小的时候看不出来，换成"整台机器的存储空间"之后，
   * 一卷几千项 ⇒ 扫完前列表恒为空 ⇒ 界面显示"此目录为空"，
   * 用户看到的就是"读不出来本地文件夹"。
   *
   * 这里用"永不 settle 的子目录请求"模拟扫不完的大卷：
   * 当前目录的内容必须**立刻可见**，且**不该**在打开时就全树扫。
   */
  it('★ 打开时不等子目录递归扫完，当前目录内容立刻可见 ★', async () => {
    const client = {
      list: vi.fn((path: string) => (path === '/vol1'
        ? Promise.resolve([
          { isDir: true, name: 'sub', path: '/vol1/sub' },
          { isDir: false, name: 'a.pdf', path: '/vol1/a.pdf', size: 2048 },
        ])
        : new Promise(() => { /* 永不 settle：模拟扫不完 */ }))),
      roots: vi.fn(async () => [{ label: 'vol1', path: '/vol1' }]),
    }

    const wrapper = await mountDialog({ client, favorites: [] })

    expect(wrapper.findAll('[data-testid="localfs-picker-entry-file"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="localfs-picker-entry-dir"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="localfs-picker-empty"]').exists()).toBe(false)
    expect(client.list).toHaveBeenCalledTimes(1)
  })

  it('★ 不搜索就不扫子树（避免打开一卷就打出成百上千次列目录）', async () => {
    const client = createClient()
    const wrapper = await mountDialog({ client, favorites: ['/vol1'] })
    expect(client.list).toHaveBeenCalledTimes(1)

    // 进一个子目录：仍然只列该目录本身
    await wrapper.find('[data-testid="localfs-picker-entry-dir"]').trigger('click')
    await flushPromises()
    expect(client.list).toHaveBeenCalledTimes(2)
  })

  it('★ 真正搜索时才扫子树，且结果不必等全树扫完 ★', async () => {
    const client = createClient()
    const wrapper = await mountDialog({ client, favorites: ['/vol1'] })
    const before = client.list.mock.calls.length

    await wrapper.find('[data-testid="localfs-picker-search"]').setValue('pdf')
    await flushPromises()

    expect(client.list.mock.calls.length).toBeGreaterThan(before)
    expect(wrapper.findAll('[data-testid="localfs-picker-entry-file"]')).toHaveLength(1)
  })

  it('★ 搜索期间还没出结果时显示"加载中"，不谎报"没有匹配" ★', async () => {
    const client = {
      list: vi.fn((path: string) => (path === '/vol1'
        ? Promise.resolve([{ isDir: true, name: 'sub', path: '/vol1/sub' }])
        : new Promise(() => { /* 永不 settle */ }))),
      roots: vi.fn(async () => [{ label: 'vol1', path: '/vol1' }]),
    }
    const wrapper = await mountDialog({ client, favorites: [] })

    await wrapper.find('[data-testid="localfs-picker-search"]').setValue('pdf')
    await flushPromises()

    expect(wrapper.find('[data-testid="localfs-picker-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="localfs-picker-empty"]').exists()).toBe(false)
  })

  it('④ 搜不到时给"没有匹配"而不是"此目录为空"', async () => {
    const wrapper = await mountDialog({ client: createClient(), favorites: ['/vol1'] })

    await wrapper.find('[data-testid="localfs-picker-search"]').setValue('zzz-none')
    await flushPromises()

    expect(wrapper.find('[data-testid="localfs-picker-empty"]').text()).toBe('localFsPickerNoResult')
  })

  it('载入失败时把原因显示在弹层里，而不是抛出去', async () => {
    const client = createClient({
      list: vi.fn(async () => {
        throw new Error('本机存储 列目录 失败：文件或目录不存在')
      }),
    })
    const wrapper = await mountDialog({ client, favorites: ['/vol1'] })

    const error = wrapper.find('[data-testid="localfs-picker-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('localFsPickerLoadFailed')
  })
})
