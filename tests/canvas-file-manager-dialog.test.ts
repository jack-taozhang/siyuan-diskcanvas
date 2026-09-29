/* @vitest-environment jsdom */

/**
 * 画布文件管理窗口 —— 第 33 轮四项 UI 改动的回归测试。
 *
 * 覆盖的是**容易被后续重构悄悄改回去**的四条：
 *   1. 默认目录是"根"，窗口打开就落在默认画布目录（不再列出 petal 下所有插件目录）
 *   2. 动作按钮全部是图标（不再有一列中文按钮）
 *   3. 选中条目后点新建 ⇒ 创建路径 = 选中条目所在路径
 *      （选文件夹 → 它里面；选文件 → 它旁边；不选 → 默认目录）
 *   4. 模态框 z-index 高于工具条（否则顶部被工具栏挡住）
 *
 * ★ 为什么大量用"读源码断言"而不是只看渲染结果 ★
 *   这类改动最容易的失败模式是"模板改了、样式没跟上"或"样式改了、模板没跟上"。
 *   渲染断言只覆盖前者；样式契约必须直接读文件。两种都要有，缺一边就有盲区。
 *
 * ★★ 关于 `readDir` 的返回约定（踩过一次）★★
 *   内核 `readDir(dir)` 返回的 `entry.name` 是**裸文件名**（不含目录前缀），
 *   比如读 `/root/项目A` 会得到 `{ name: "A.canvas" }`。
 *   `listCanvasTree` 自己拼 `${dirPath}/${entry.name}`。
 *   ⇒ 测试 mock 若返回**完整路径**，会拼出
 *     `/root/项目A//root/项目A/A.canvas` 这种双层路径，
 *     于是 `data-testid` 里是长路径、`find()` 又找不到，白折腾半天。
 *     这是测试脚手架的坑，不是产品缺陷 —— 记在这里免得下次再踩。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const readDirMock = vi.fn()
const readTextMock = vi.fn()
const putFileMock = vi.fn()
const removeFileMock = vi.fn()

vi.mock('@/api', () => ({
  getFileText: (...args: unknown[]) => readTextMock(...args),
  putFile: (...args: unknown[]) => putFileMock(...args),
  readDir: (...args: unknown[]) => readDirMock(...args),
  removeFile: (...args: unknown[]) => removeFileMock(...args),
  sql: () => [],
  updateBlock: vi.fn(),
}))

const openTextInputDialogMock = vi.fn()
vi.mock('@/canvas/text-input-dialog', () => ({
  openTextInputDialog: (...args: unknown[]) => openTextInputDialogMock(...args),
}))

const openConfirmDialogMock = vi.fn()
vi.mock('@/canvas/confirm-dialog', () => ({
  openConfirmDialog: (...args: unknown[]) => openConfirmDialogMock(...args),
}))

import CanvasFileManagerDialog from '@/components/canvas/CanvasFileManagerDialog.vue'

const DEFAULT_DIR = '/data/storage/petal/siyuan-diskcanvas'

/**
 * 极简 t：只把**创建用的**那个 key 翻成真实文案（其余回显 key，断言时看得见用的哪个 key）。
 * `untitledCanvas` 必须翻 —— 它参与拼文件名。
 */
const T_MAP: Record<string, string> = {
  untitledCanvas: '未命名.canvas',
}

function makeT() {
  return (key: string, params?: Record<string, unknown>) => {
    if (params && 'count' in params) {
      return `${key}:${params.count}`
    }
    return T_MAP[key] ?? key
  }
}

/** 内核约定：`entry.name` 是**裸文件名**（不是完整路径） */
function dirEntry(name: string, isDir: boolean) {
  return {
    isDir,
    mtime: 1_700_000_000,
    name,
    updated: 1_700_000_000,
  }
}

/**
 * 一棵固定形状的树（mock 用裸名，见文件头注释）：
 *
 *   <默认目录>/                      ← 合成根，展开
 *     ├─ 长城.canvas                 ← 文件
 *     └─ 研发设计/                   ← 文件夹
 *          ├─ 未命名43.canvas
 *          └─ 旧稿/                  ← 空文件夹
 */
const TREE: Record<string, Array<{ isDir: boolean, name: string }>> = {
  [DEFAULT_DIR]: [
    { isDir: false, name: '长城.canvas' },
    { isDir: true, name: '研发设计' },
  ],
  [`${DEFAULT_DIR}/研发设计`]: [
    { isDir: false, name: '未命名43.canvas' },
    { isDir: true, name: '旧稿' },
  ],
  [`${DEFAULT_DIR}/研发设计/旧稿`]: [],
}

function mountDialog(overrides: Record<string, unknown> = {}) {
  return mount(CanvasFileManagerDialog, {
    props: {
      activePath: `${DEFAULT_DIR}/长城.canvas`,
      defaultDirectory: DEFAULT_DIR,
      notify: vi.fn(),
      t: makeT(),
      ...overrides,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  readTextMock.mockResolvedValue('{"edges":[],"nodes":[]}')
  putFileMock.mockResolvedValue(undefined)
  removeFileMock.mockResolvedValue(undefined)
  readDirMock.mockImplementation(async (path: string) => TREE[path] ?? [])
  openTextInputDialogMock.mockResolvedValue(null)
  openConfirmDialogMock.mockResolvedValue(false)
})

/* ══════════════════════════════════════════════════════════════
 * 1. 默认目录 = 根
 * ══════════════════════════════════════════════════════════════ */

describe('默认目录是扫描根', () => {
  it('只枚举默认目录，不再枚举 petal 下所有插件目录', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(readDirMock.mock.calls[0][0]).toBe(DEFAULT_DIR)
    // ★ 关键：**没有**去读 `/data/storage/petal`
    expect(readDirMock.mock.calls.map((call) => call[0])).not.toContain('/data/storage/petal')

    // 标题行把默认目录显示出来，用户一眼知道自己在哪棵树下
    expect(wrapper.find('[data-testid="canvas-manager-root"]').text()).toBe(DEFAULT_DIR)
  })
})

/* ══════════════════════════════════════════════════════════════
 * 2. 动作按钮全部图标化
 * ══════════════════════════════════════════════════════════════ */

describe('动作按钮改为图标', () => {
  it('每行动作用的是图标按钮类，不再渲染中文按钮文案', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const iconButtons = wrapper.findAll('.canvas-manager__actions .canvas-manager__icon-button')
    /**
     * 可见行共 4 条：
     *   根（合成文件夹，5 个动作）+ 研发设计（文件夹，5 个）
     *   + 长城.canvas（文件，5 个）+ 未命名43.canvas（文件，5 个）
     * 根与研发设计默认展开（首次加载展开根 + 一级子目录）。
     *
     * ★ 这里**不写死数量**，而是断言"每条可见行恰好 5 个动作" ★
     *   写死 20 的话，将来默认展开策略一变（比如也展开二级），
     *   这条用例就会因为一个**无关的**变化而失败。
     */
    const rows = wrapper.findAll('.canvas-manager__row')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.findAll('.canvas-manager__icon-button').length).toBe(5)
    }
    expect(iconButtons.length).toBe(rows.length * 5)

    /**
     * ★ 反向断言：不应再有 `b3-button` ★
     *   思源官方按钮类如果还留着，就会渲染成带文字的大按钮 ——
     *   这正是用户要求改掉的那个形态。用类名卡死，比数文字更可靠。
     */
    expect(wrapper.find('.canvas-manager__actions .b3-button').exists()).toBe(false)

    // 每个图标按钮都得有 tooltip / aria-label 兜底（纯图标没有可读文字）
    for (const button of iconButtons) {
      expect(button.attributes('data-tooltip')).toBeTruthy()
      expect(button.attributes('aria-label')).toBeTruthy()
    }
  })

  it('工具栏的新建/刷新也是图标按钮', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    for (const testid of [
      'canvas-manager-refresh',
      'canvas-manager-new-folder',
      'canvas-manager-new',
    ]) {
      const button = wrapper.find(`[data-testid="${testid}"]`)
      expect(button.exists()).toBe(true)
      expect(button.classes()).toContain('canvas-manager__icon-button')
    }
  })
})

/* ══════════════════════════════════════════════════════════════
 * 3. 选中条目 → 新建落在选中所在路径
 * ══════════════════════════════════════════════════════════════ */

describe('选中条目后新建的落脚路径', () => {
  /** 新建画布 = `putFile(path, false, <空画布 Blob>)` ⇒ 第一个参数是路径 */
  function lastCreatedPath(): string {
    expect(putFileMock).toHaveBeenCalled()
    return String(putFileMock.mock.calls[putFileMock.mock.calls.length - 1][0])
  }

  it('没选中任何条目 ⇒ 建在默认目录', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('[data-testid="canvas-manager-new"]').trigger('click')
    await flushPromises()

    expect(lastCreatedPath()).toBe(`${DEFAULT_DIR}/未命名.canvas`)
  })

  it('选中文件夹 ⇒ 建到该文件夹**里面**', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('[data-testid="canvas-manager-folder-研发设计"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="canvas-manager-new"]').trigger('click')
    await flushPromises()

    expect(lastCreatedPath()).toBe(`${DEFAULT_DIR}/研发设计/未命名.canvas`)
  })

  it('选中文件 ⇒ 建到该文件**旁边**（同一目录）', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('[data-testid="canvas-manager-row-长城.canvas"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="canvas-manager-new"]').trigger('click')
    await flushPromises()

    expect(lastCreatedPath()).toBe(`${DEFAULT_DIR}/未命名.canvas`)
  })

  it('选中子目录里的文件 ⇒ 建在子目录（不是默认目录）', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    // 未命名43.canvas 在 研发设计/ 下
    await wrapper.find('[data-testid="canvas-manager-row-未命名43.canvas"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="canvas-manager-new"]').trigger('click')
    await flushPromises()

    expect(lastCreatedPath()).toBe(`${DEFAULT_DIR}/研发设计/未命名.canvas`)
  })

  it('再点同一行取消选中 ⇒ 回到默认目录', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const folderRow = wrapper.find('[data-testid="canvas-manager-folder-研发设计"]')
    await folderRow.trigger('click')
    await flushPromises()
    expect(folderRow.classes()).toContain('canvas-manager__row--selected')

    await folderRow.trigger('click')
    await flushPromises()
    expect(folderRow.classes()).not.toContain('canvas-manager__row--selected')

    await wrapper.find('[data-testid="canvas-manager-new"]').trigger('click')
    await flushPromises()
    expect(lastCreatedPath()).toBe(`${DEFAULT_DIR}/未命名.canvas`)
  })

  it('新建文件夹也走同一条落脚规则', async () => {
    openTextInputDialogMock.mockResolvedValue('新目录')

    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('[data-testid="canvas-manager-folder-研发设计"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="canvas-manager-new-folder"]').trigger('click')
    await flushPromises()

    // 建目录 = `putFile(path, true, 空 Blob)`
    expect(lastCreatedPath()).toBe(`${DEFAULT_DIR}/研发设计/新目录`)
    expect(putFileMock.mock.calls[putFileMock.mock.calls.length - 1][1]).toBe(true)
  })

  it('选中项在刷新后消失（被删/改名）⇒ 静默退回默认目录，不报错、不崩', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('[data-testid="canvas-manager-folder-研发设计"]').trigger('click')
    await flushPromises()

    // 让它从树上消失（模拟"选中的目录被别处删掉了"）
    readDirMock.mockImplementation(async (path: string) => (
      path === DEFAULT_DIR ? [{ isDir: false, name: '长城.canvas', mtime: 1, updated: 1 }] : []
    ))
    await wrapper.find('[data-testid="canvas-manager-refresh"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="canvas-manager-new"]').trigger('click')
    await flushPromises()

    expect(lastCreatedPath()).toBe(`${DEFAULT_DIR}/未命名.canvas`)
  })
})

/* ══════════════════════════════════════════════════════════════
 * 4. 顶部不再被工具条遮挡
 * ══════════════════════════════════════════════════════════════ */

describe('模态框层级高于工具条', () => {
  const CANVAS_DIR = resolve(__dirname, '../src/components/canvas')

  /**
   * 从"某个类名规则的**属性块**"里取出 z-index。
   *
   * ★ 为什么不能简单地全文 grep 第一个 z-index ★
   *   规则体里通常带注释，注释里也会提到数字（我就是这么写出过一个
   *   "expected 10 to be greater than 10" 的假失败：正则贪婪地吃到了
   *   注释里的 `z-index: 10`）。这里限定"从类名到其后的第一个 `}`"，
   *   并且**先剥掉注释**再取数字。
   */
  function zIndexOf(source: string, selector: string): number {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const block = source.match(new RegExp(`${escaped} \\{[\\s\\S]*?\\n\\}`))
    if (!block) {
      throw new Error(`找不到规则 ${selector}`)
    }
    const withoutComments = block[0]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    const match = withoutComments.match(/z-index:\s*(\d+)/)
    if (!match) {
      throw new Error(`${selector} 规则里没有 z-index —— 层级关系失去依据`)
    }
    return Number(match[1])
  }

  it('每一个模态框的 backdrop 都盖得住工具条', () => {
    const workspace = readFileSync(resolve(CANVAS_DIR, 'canvas-workspace.scss'), 'utf-8')
    /**
     * 断言写成"比工具栏大"，而不是写死一个数字 ——
     * 将来调工具栏层级时这条用例依然成立，不必跟着改。
     */
    const toolbar = zIndexOf(workspace, '.canvas-toolbar')

    const dialogs = [
      'CanvasFileManagerDialog.vue',
      'CanvasAssetPickerDialog.vue',
      'CanvasCreateEdgeDialog.vue',
      'CanvasNebulaPickerDialog.vue',
    ]
    for (const dialog of dialogs) {
      const source = readFileSync(resolve(CANVAS_DIR, dialog), 'utf-8')
      expect(
        zIndexOf(source, '.canvas-dialog-backdrop'),
        `${dialog} 的 backdrop 层级必须 > .canvas-toolbar 的 ${toolbar}`,
      ).toBeGreaterThan(toolbar)
    }

    // 文件选择器那个模态框直接在 workspace 里
    expect(zIndexOf(workspace, '.canvas-dialog-backdrop')).toBeGreaterThan(toolbar)
  })
})
