import type {
  Custom,
  Plugin,
} from "siyuan"
import type { CanvasTabBootstrap } from "@/main"

import {
  Dialog,
  getFrontend,
  openTab,
} from "siyuan"
import { getCanvasFileName } from "@/canvas/use-canvas-editor-shared"
import {
  CANVAS_TAB_ICON_BODY,
  CANVAS_TAB_ICON_ID,
} from "@/icons"
import {
  mountCanvasApp,
  unmountCanvasApp,
} from "@/main"

export const CANVAS_EDITOR_TAB_TYPE = "-canvas-editor"
export { CANVAS_TAB_ICON_ID }

/**
 * @deprecated 历史导出，新代码请改用 `@/icons` 中的 `CANVAS_TAB_ICON_BODY`。
 * 保留是为了兼容下游可能直接 import 此符号的代码。
 */
export const CANVAS_TAB_ICON_SVG = CANVAS_TAB_ICON_BODY

function isMobileFrontend(): boolean {
  const frontend = getFrontend()
  return frontend === "mobile" || frontend === "browser-mobile"
}

function openCanvasEditorMobileDialog(
  bootstrap: CanvasTabBootstrap,
  title: string,
): void {
  let host: HTMLElement | null = null
  const dialog = new Dialog({
    title,
    width: "100vw",
    height: "100vh",
    content: `<div class="diskcanvas__mobile-viewer"><div class="diskcanvas__tab"></div></div>`,
    destroyCallback: () => {
      if (host) {
        unmountCanvasApp(host)
      }
    },
  })
  host = dialog.element.querySelector<HTMLElement>(".diskcanvas__tab")
  if (!host) {
    dialog.destroy()
    return
  }

  mountCanvasApp(host, bootstrap, (nextTitle) => {
    dialog.element.setAttribute("aria-label", nextTitle)
  })
}

/**
 * ★ openTab 的 custom 页签：只传 `app` + `custom` ★
 *
 * 实测依据（思源 3.8.5 桌面版 `main.<hash>.js` 的 openFile）：
 *
 *   else if (W.custom) {
 *     ...
 *     callback(Z) {
 *       if (W.custom.id) {
 *         const Ae = xo(W.app, Z, {
 *           instance: "Custom",
 *           customModelType: W.custom.id,     // ← custom.id 必须等于注册键
 *           customModelData: W.custom.data,
 *         })
 *         Ae && Z.addModel(Ae)
 *       }
 *       ...
 *     }
 *   }
 *
 * `keepCursor` / `openNewTab` 是给「文档 / 资产」分支用的顶层参数
 * （见 `keepCursor:W.keepCursor, removeCurrentTab:W.removeCurrentTab, openNewTab:W.openNewTab`
 * 那组透传，只喂给 Editor 模型）。custom 分支不读它们，
 * 本机工作正常的第三方插件 `siyuan-nebuladisk` 也只传 `{app, custom}`。
 * 这里保持同形，减少不必要的差异面。
 */
export async function openCanvasEditorTab(
  plugin: Plugin & { app: unknown },
  pluginName: string,
  bootstrap: CanvasTabBootstrap,
  untitledTitle: string,
): Promise<void> {
  const title = bootstrap.title || (bootstrap.path ? getCanvasFileName(bootstrap.path) : "") || untitledTitle
  if (isMobileFrontend()) {
    openCanvasEditorMobileDialog(bootstrap, title)
    return
  }

  const customModelType = `${pluginName}${CANVAS_EDITOR_TAB_TYPE}`
  try {
    await openTab({
      app: plugin.app,
      custom: {
        id: customModelType,
        icon: CANVAS_TAB_ICON_ID,
        title,
        data: bootstrap,
      },
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `[siyuan-diskcanvas-next] openTab failed (customModelType=${customModelType}):`,
      error,
    )
    throw error
  }
}

/**
 * ★ 页签 init 必须自证失败，不能静默空白 ★
 *
 * 实测依据（思源 3.8.5 桌面版 `main.<hash>.js`）：
 *
 *   // plugin 类
 *   addTab(Ve) {
 *     const Oe = this.name + Ve.type
 *     this.models[Oe] = De => new h.S({
 *       app: this.app, tab: De.tab, type: Oe, data: De.data,
 *       init: Ve.init, beforeDestroy, destroy, resize, update,
 *     })
 *   }
 *
 *   // Custom 模型类（module 8120）
 *   class $ extends K {
 *     constructor(c) {
 *       super({app: c.app})
 *       this.element = c.tab.panelElement
 *       this.tab = c.tab
 *       this.data = c.data
 *       this.type = c.type
 *       this.init = c.init
 *       ...
 *       this.init(this)          // ← 同步调用，**无 try/catch**
 *     }
 *   }
 *
 *   // openFile 的 custom 分支
 *   callback(Z) {
 *     const Ae = xo(app, Z, {instance:"Custom", customModelType: W.custom.id, ...})
 *     Ae && Z.addModel(Ae)       // ← 同样**无 try/catch**
 *   }
 *
 * 结论：`init()` 里抛出任何异常，都会一路上抛、被 SiYuan 吞掉，
 * 结果是**页签照常打开、但 panel 内什么都没有** ——
 * 也就是「编辑画布没有出现菜单和画布」这个症状。
 * 因此这里必须自带兜底与可见反馈。
 */
export function registerCanvasEditorTab(plugin: Plugin, tabType = CANVAS_EDITOR_TAB_TYPE): void {
  plugin.addTab({
    type: tabType,
    init(this: Custom) {
      const host = this.element as HTMLElement
      try {
        host.innerHTML = ""
        host.classList.add("diskcanvas__tab")
        /* ★ display 必须显式声明为 flex ★
         *   思源给自定义页签面板的类（fn__flex-1 等）是**异步套上**的；
         *   在它们生效之前的窗口里，host 是默认 display:block / height:auto。
         *   此时子元素 `.canvas-shell { height:100% }` 的百分比高度失去参照，
         *   会退化为「按内容撑开」——实测被撑到 4414px，
         *   画布随即按这个假高度算 fit-view 比例 → 首帧空白、比例乱跳。
         *   显式 flex + minHeight:0 后，无论外部样式何时命中，host 都有确定高度，
         *   子元素 100% 始终解析为面板真实高度。 */
        Object.assign(host.style, {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          minWidth: "0",
          height: "100%",
          minHeight: "0",
          overflow: "hidden",
          position: "relative",
          boxSizing: "border-box",
        })
        mountCanvasApp(host, this.data ?? {}, (title) => {
          if (this.tab) {
            this.tab.updateTitle(title)
          }
        })
      } catch (error) {
        // 把被宿主吞掉的异常显式暴露出来：既写 console，也渲染到面板上。
        // eslint-disable-next-line no-console
        console.error("[siyuan-diskcanvas-next] canvas tab init failed:", error)
        renderCanvasTabFailure(host, error)
      }
    },
    destroy(this: Custom) {
      try {
        unmountCanvasApp(this.element as HTMLElement)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[siyuan-diskcanvas-next] canvas tab destroy failed:", error)
      }
    },
  })
}

/**
 * 页签初始化失败时的可见兜底：纯 DOM，不依赖 Vue 是否挂载成功。
 * 目的是让「空白页签」这种无信息状态变成一条能直接定位的错误信息。
 */
function renderCanvasTabFailure(host: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const stack = error instanceof Error && error.stack ? error.stack : ""
  host.innerHTML = ""
  const box = document.createElement("div")
  box.className = "diskcanvas__tab-error"
  Object.assign(box.style, {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "24px",
    height: "100%",
    boxSizing: "border-box",
    overflow: "auto",
    fontFamily: "var(--b3-font-family-code, monospace)",
    fontSize: "13px",
    lineHeight: "1.6",
    color: "var(--b3-theme-on-background, #333)",
  })
  const title = document.createElement("div")
  title.textContent = "Canvas tab failed to initialize"
  Object.assign(title.style, { fontWeight: "600", fontSize: "15px" })
  const detail = document.createElement("pre")
  detail.textContent = stack || message
  Object.assign(detail.style, {
    margin: "0",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    color: "var(--b3-theme-error, #d23f31)",
  })
  box.append(title, detail)
  host.append(box)
}
