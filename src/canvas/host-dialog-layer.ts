/**
 * 让宿主（思源）的 Dialog 浮在本插件的画布模态框之上。
 *
 * ★ 为什么需要这个 ★
 *
 * 用户反馈：「插入画布窗口 把 删除、复制、重命名 的窗口挡住了」。
 *
 * 根因（真机实测，不是推测）：
 *   - 思源把 `.b3-dialog` 的 `z-index` **写死在样式表里 = 14**（外层
 *     `.b3-dialog--open` 是 `auto`），而且插件侧**没有任何 API 可以调高它**
 *     —— `Dialog` 的构造参数里没有层级选项（见 `siyuan.d.ts`），
 *     `confirm()` 更是只给你一个已经建好的元素。
 *   - 本插件的「画布文件管理」模态框 backdrop 是 `z-index: 40`，且
 *     `.canvas-shell` 及其全部祖先都是 `position: relative; z-index: auto`
 *     ⇒ **不建立层叠上下文** ⇒ 那个 40 直接参与 body 级比较，
 *     稳稳压过 Dialog 的 14。
 *   - 于是重命名 / 复制 / 新建 / 删除确认的弹窗被文件管理窗口**整个盖住**：
 *     实测 `document.elementFromPoint(弹窗中心)` 命中的是
 *     `SPAN.canvas-manager__name`（文件管理窗口的行标题），而不是弹窗里的输入框。
 *
 * 修法：**只给这一次的 Dialog 元素设内联 z-index**。不动宿主全局样式表，
 * 也不动本插件其它浮层。
 *
 * ★ 为什么不反过来把 `.canvas-dialog-backdrop` 的 40 降下去 ★
 *   那个 40 是为了盖过 `.canvas-toolbar`（z-index: 10）才提上去的
 *   （见 CanvasFileManagerDialog.vue 里的注释与用户当时反馈"模态框顶部被工具条
 *   挡住了一部分"）。降回去会让那个老毛病复发。
 *   两个诉求都要满足 ⇒ 只能把 Dialog 提起来。
 *
 * ★ 取 900 的理由 ★
 *   本插件浮层最高是 999（PNG 导出等），其次 100 / 99。
 *   900 高于文件管理窗口的 40 与同类确认框，仍低于 999 那批
 *   "本就该浮在最上面"的东西。
 */
const DIALOG_Z_INDEX_ON_TOP = "900"

/**
 * 把某个宿主 Dialog 元素的层级提到本插件模态框之上。
 *
 * 注意入参是**元素**而不是 `Dialog` 实例 —— 因为 `confirm()` 回调里给我们的是
 * 实例，而某些场景只能拿到 `element`。这样两边都能用。
 *
 * 传入的可能是内层 `.b3-dialog`（带 z-index: 14 的那个，`Dialog.element`
 * 实测就指向它），也可能是别的节点；这里统一**向上/向内各找一次**，
 * 把所有相关节点都设上，免得踩到宿主结构调整。
 */
export function raiseDialogAboveCanvasModals(element: HTMLElement | null | undefined): void {
  const nodes = new Set<HTMLElement>()
  if (element) {
    nodes.add(element)
    // 若传进来的已经是内层 `.b3-dialog`，顺带把它的外层容器也提上去 ——
    // 只提内层、外层仍是较低层级时会被同层叠上下文里的其它容器压住。
    const owner = element.closest(".b3-dialog--open") ?? element.parentElement
    if (owner instanceof HTMLElement && owner !== element) {
      nodes.add(owner)
    }
    // 若传进来的是容器，则把里面的 `.b3-dialog`（真正带 z-index 的那个）也提上去；
    // 若传进来的是弹窗**内部**的元素（输入框等），则向上找 `.b3-dialog`。
    const innerSelf = element.closest<HTMLElement>(".b3-dialog")
    if (innerSelf && innerSelf !== element) {
      nodes.add(innerSelf)
      // 它自己的外层容器也别忘了
      const grandOwner = innerSelf.parentElement
      if (grandOwner instanceof HTMLElement) {
        nodes.add(grandOwner)
      }
    }
    const inner = element.querySelector<HTMLElement>(".b3-dialog")
    if (inner) {
      nodes.add(inner)
    }
  } else {
    // ★ 没有指定目标时才兜底：取**最后一个** `.b3-dialog`
    //   （`querySelector` 会给到最早的那个 ⇒ 提错对象）。
    //   ★ 这里刻意不查 `.b3-dialog--open`：实测 `--open` 是**后加**到父元素上的，
    //     弹窗刚插入的那一刻还没有这个类（详见 confirm-dialog.ts 的说明）。
    const all = document.querySelectorAll<HTMLElement>(".b3-dialog")
    const latest = all.length ? all[all.length - 1] : null
    if (latest) {
      nodes.add(latest)
      const owner = latest.parentElement
      if (owner instanceof HTMLElement) {
        nodes.add(owner)
      }
    }
  }

  for (const node of nodes) {
    node.style.zIndex = DIALOG_Z_INDEX_ON_TOP
  }
}
