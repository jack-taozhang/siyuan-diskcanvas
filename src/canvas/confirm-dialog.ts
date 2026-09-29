import { confirm } from "siyuan"
import { raiseDialogAboveCanvasModals } from "@/canvas/host-dialog-layer"

/**
 * 确认弹窗。
 *
 * ★ 为什么要提层级 ★
 *   思源的 `confirm()` 建出的 `.b3-dialog` z-index 写死为 14，而本插件的
 *   「画布文件管理」模态框 backdrop 是 40 ⇒ 确认框会被**整个盖住**
 *   （用户反馈："插入画布窗口把删除、复制、重命名的窗口挡住了"）。
 *   详见 `host-dialog-layer.ts` 的说明。
 *
 * ★★ 时机：既不能靠微任务 / rAF，也不能靠监听 `.b3-dialog--open` ★★
 *
 *   `confirm()` 只有 4 个参数（title / text / onConfirm / onCancel），
 *   **没有"弹出后"回调**，只能自己找时机。两个坑都实测过：
 *
 *   坑 1 —— 弹窗不是同步挂载的。
 *     实测各时点 `.b3-dialog--open` 数量：
 *       before=3  sync=3  microtask=3  raf=3  timeout0=3  timeout120=4
 *     ⇒ 紧跟在 `confirm()` 后面的微任务与 rAF **都早于挂载**，
 *       那时查不到弹窗，提升操作等于没做。
 *
 *   坑 2 —— `--open` 是**后加的**，而且加在**父元素**上。
 *     实测 MutationObserver 记录：
 *       t=17ms   插入的节点是 `.b3-dialog`，parent=null，**class 里还没有 --open**
 *       t=2019ms 它的 parent 才变成 `.b3-dialog--open`
 *     ⇒ 在 childList 回调里查 `.b3-dialog--open` 依然查不到；
 *       而 "父元素加 --open" 属于 **attributes 变化**，监听 childList 收不到。
 *
 *   ⇒ 结论：**别依赖 `--open`、也别猜延迟**。直接盯**新插入的 `.b3-dialog` 节点**
 *     本身（它插入时就带着这个 class），一出现就提升。
 *     这样宿主把 `--open` 的时机、延迟怎么改都不影响。
 */
function raiseWhenDialogAppears(): void {
  if (typeof MutationObserver !== "function") {
    // 没有 MutationObserver 的极端情况：退回"稍后再试一次"
    window.setTimeout(() => {
      raiseDialogAboveCanvasModals(document.querySelector<HTMLElement>(".b3-dialog"))
    }, 200)
    return
  }

  let done = false
  const finish = (target: HTMLElement) => {
    if (done) {
      return
    }
    done = true
    observer.disconnect()
    window.clearTimeout(fallbackTimer)
    raiseDialogAboveCanvasModals(target)
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of Array.from(mutation.addedNodes)) {
        if (!(added instanceof HTMLElement)) {
          continue
        }
        // 新增的节点本身可能就是 `.b3-dialog`，也可能包着它
        const dialog = added.classList.contains("b3-dialog")
          ? added
          : added.querySelector<HTMLElement>(".b3-dialog")
        if (dialog) {
          finish(dialog)
          return
        }
      }
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  // 兜底：万一弹窗早就存在（比如宿主改成同步挂载），或始终观察不到
  const fallbackTimer = window.setTimeout(() => {
    if (done) {
      return
    }
    const existing = document.querySelectorAll<HTMLElement>(".b3-dialog")
    const latest = existing.length ? existing[existing.length - 1] : null
    if (latest) {
      finish(latest)
    } else {
      done = true
      observer.disconnect()
    }
  }, 500)
}

export function openConfirmDialog(title: string, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirm(
      title,
      text,
      (dialog) => {
        dialog.destroy()
        resolve(true)
      },
      (dialog) => {
        dialog.destroy()
        resolve(false)
      },
    )

    raiseWhenDialogAppears()
  })
}
