/* @vitest-environment jsdom */

/**
 * 宿主 Dialog 层级提升 —— 回归测试。
 *
 * 背景（用户反馈）：
 *   「插入画布窗口 把 删除、复制、重命名 的窗口挡住了」
 *
 * 真机实测的根因：
 *   思源 `.b3-dialog` 的 z-index 写死 = 14；本插件文件管理窗口 backdrop = 40，
 *   且 `.canvas-shell` 及其祖先都不建立层叠上下文 ⇒ 40 压过 14 ⇒ 弹窗被盖住。
 *
 * 这里锁住三件事：
 *   1. 传入按钮内的元素也能正确找到 `.b3-dialog--open` 并提到 900
 *   2. 同时给外层（`--open`）与内层（`.b3-dialog`）都设上（宿主结构调整也不怕）
 *   3. 空入参 / DOM 里没有弹窗时**不能抛异常**（这是最容易被忽略的健壮性）
 */

import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"

import { raiseDialogAboveCanvasModals } from "@/canvas/host-dialog-layer"

/** 复刻思源的弹窗结构：外层 `.b3-dialog--open`（auto）→ 内层 `.b3-dialog`（14） */
function mountHostDialog(): { open: HTMLElement
  inner: HTMLElement
  input: HTMLInputElement } {
  const open = document.createElement("div")
  open.className = "b3-dialog--open"

  const inner = document.createElement("div")
  inner.className = "b3-dialog"
  inner.style.zIndex = "14"

  const content = document.createElement("div")
  const input = document.createElement("input")
  input.setAttribute("data-canvas-dialog-input", "")
  content.appendChild(input)
  inner.appendChild(content)
  open.appendChild(inner)
  document.body.appendChild(open)

  return { open, inner, input }
}

describe("host dialog layer — 宿主弹窗浮在画布模态框之上", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("从内层元素出发，能同时提到外层与内层的 z-index", () => {
    const { open, inner, input } = mountHostDialog()

    raiseDialogAboveCanvasModals(input)

    expect(open.style.zIndex).toBe("900")
    expect(inner.style.zIndex).toBe("900")
  })

  it("直接传内层 .b3-dialog 也生效（Dialog.element 的实际指向）", () => {
    const { inner } = mountHostDialog()

    raiseDialogAboveCanvasModals(inner)

    expect(inner.style.zIndex).toBe("900")
    // 外层也应被顺带提上去（同一层叠上下文里外层若不提，内层抬高无意义）
    const open = document.querySelector(".b3-dialog--open") as HTMLElement
    expect(open.style.zIndex).toBe("900")
  })

  it("传 null / undefined 不抛异常", () => {
    expect(() => raiseDialogAboveCanvasModals(null)).not.toThrow()
    expect(() => raiseDialogAboveCanvasModals(undefined)).not.toThrow()
  })

  it("DOM 里没有弹窗时不抛异常（confirm 的兜底微任务会撞上这种情况）", () => {
    document.body.innerHTML = ""
    expect(() => raiseDialogAboveCanvasModals(document.body)).not.toThrow()
  })

  it("提到 900 —— 高于文件管理窗口的 40，低于本该最顶层的 999", () => {
    const { inner } = mountHostDialog()

    raiseDialogAboveCanvasModals(inner)

    const z = Number(inner.style.zIndex)
    expect(z).toBeGreaterThan(40)
    expect(z).toBeLessThan(999)
  })

  it("只影响目标弹窗，不误伤页面上其它浮层", () => {
    const other = document.createElement("div")
    other.className = "canvas-toolbar"
    other.style.zIndex = "10"
    document.body.appendChild(other)

    const { inner } = mountHostDialog()
    raiseDialogAboveCanvasModals(inner)

    expect(other.style.zIndex).toBe("10")
  })

  it("无入参时提升**最后一个**弹窗（同时开多个时不能提错对象）", () => {
    const first = mountHostDialog()
    const second = mountHostDialog()

    raiseDialogAboveCanvasModals(null)

    // 最新的那个被提升
    expect(second.inner.style.zIndex).toBe("900")
    // 早先的那个不动
    expect(first.inner.style.zIndex).toBe("14")
  })

  it("★ `--open` 还没加上时也能生效（实测 confirm 弹窗插入时就没有这个类）", () => {
    // 复刻实测到的中间态：t=17ms 时节点已插入，但父元素还没有 --open
    const container = document.createElement("div")   // 注意：没有 b3-dialog--open
    const inner = document.createElement("div")
    inner.className = "b3-dialog"
    inner.style.zIndex = "14"
    const input = document.createElement("input")
    input.setAttribute("data-canvas-dialog-input", "")
    inner.appendChild(input)
    container.appendChild(inner)
    document.body.appendChild(container)

    raiseDialogAboveCanvasModals(inner)

    expect(inner.style.zIndex).toBe("900")
    // 外层容器也应被提上去（它是实际的层叠上下文参与者）
    expect(container.style.zIndex).toBe("900")
  })

  it("传入容器时，内部的 .b3-dialog 也一并提升", () => {
    const { open, inner } = mountHostDialog()

    raiseDialogAboveCanvasModals(open)

    expect(inner.style.zIndex).toBe("900")
  })
})
