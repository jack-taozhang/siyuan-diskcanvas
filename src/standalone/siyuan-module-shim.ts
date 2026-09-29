/**
 * `siyuan` 模块的**独立页面替代实现**。
 * ============================================================================
 *
 * ★ 这个文件只在「独立网页」构建里生效 ★
 *   通过 `vite.standalone.config.ts` 的 `resolve.alias` 把 `siyuan` 指向这里。
 *   思源插件构建（`vite.config.ts`）**完全不碰**它 —— 那边继续用真的 `siyuan`。
 *
 * 为什么需要它：
 *   画布组件（CanvasWorkspace 及其整条依赖链）里有 15 处
 *   `import { … } from "siyuan"`。独立页面里没有宿主，这个模块根本不存在，
 *   打包会留下 `require("siyuan")` 或直接解析失败。
 *
 * 于是把「思源宿主」当成一层**可替换的适配层**：独立页给一份"能跑的替代品"，
 * 画布代码一行都不用改 —— 这正是「与思源里同一套渲染逻辑」能成立的前提。
 *
 * ---------------------------------------------------------------------------
 * 设计原则：**能真做的就真做，做不了的才降级**（不要一律 no-op）
 * ---------------------------------------------------------------------------
 *   · `fetchSyncPost`  → **真做**。它打的是内核同源 API（`/api/...`），
 *                        独立页与内核同源，凭据（Cookie）自动带上 ⇒ 完全可用。
 *                        笔记/块的元数据查询因此和思源里行为一致。
 *   · `Dialog` / `confirm` / `showMessage` → **真做**。它们只是 DOM + base.css
 *                        （独立页会把思源的 base.css 与主题 CSS 一起加载），
 *                        所以只要**类名结构照抄思源**，外观就一致。
 *   · `openTab`        → **真做**（换算成等价动作）。见下面注释。
 *   · `getAllEditor` / `getFrontend` → 返回合理常量（列表为空 / desktop）。
 *
 * ★ 绝不"假装成功" ★
 *   凡是做不到的（例如在独立页里注册浮动层），一律安静降级为 no-op，
 *   而不是抛异常把整个页面带崩 —— 画布的首要职责是能打开、能编辑。
 */

/* ──────────────────────────────────────────────────────────────
 * 消息提示（toast）
 * ────────────────────────────────────────────────────────────── */

interface SnackbarOptions {
  content: string
  timeout?: number
  type?: "info" | "error"
}

/**
 * 极简 toast。
 *
 * 用**思源的主题变量**着色（`--b3-theme-surface` / `--b3-theme-on-surface` /
 * `--b3-theme-error` 等），所以深浅主题下与思源里的观感一致。
 * 不依赖思源的 `#commonMenu` 容器（独立页没有），自己挂在 body 上。
 */
function showSnackbar(options: SnackbarOptions): void {
  if (typeof document === "undefined") {
    return
  }

  const isError = options.type === "error"
  const el = document.createElement("div")
  el.className = `dc-standalone-snackbar${isError ? " dc-standalone-snackbar--error" : ""}`
  el.setAttribute("role", isError ? "alert" : "status")
  el.textContent = options.content
  document.body.appendChild(el)

  requestAnimationFrame(() => el.classList.add("dc-standalone-snackbar--visible"))

  const timeout = typeof options.timeout === "number" && options.timeout > 0 ? options.timeout : 3000
  window.setTimeout(() => {
    el.classList.remove("dc-standalone-snackbar--visible")
    window.setTimeout(() => el.remove(), 250)
  }, timeout)
}

/**
 * 与思源 `showMessage(message, timeout?, type?)` 同签名。
 *
 * 三参位置刻意保持一致：调用点写的是 `showMessage(msg, 4000, "error")`，
 * 若这里改成对象参数，**15 个调用点全都要改** —— 那就不是"同一套代码"了。
 */
export function showMessage(message: string, timeout = 3000, type: "info" | "error" = "info"): void {
  showSnackbar({ content: message, timeout, type })
}

/* ──────────────────────────────────────────────────────────────
 * 对话框（Dialog / confirm）
 * ────────────────────────────────────────────────────────────── */

interface DialogOptions {
  content?: string
  destroyCallback?: () => void
  height?: string
  title?: string
  width?: string
}

/** 关闭按钮：内联 SVG。思源那边用 `#iconClose` 精灵图，独立页没有精灵图。 */
const CLOSE_ICON_SVG = '<svg viewBox="0 0 32 32" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 9L23 23M23 9L9 23" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'

/**
 * 思源 `Dialog` 的等价实现。
 *
 * ★ 类名与层级**照抄思源**，一个字母都不能改 ★
 *   `b3-dialog b3-dialog--open` → `b3-dialog__container` → `b3-dialog__header`
 *   （含 `b3-dialog__header-title` / `b3-dialog__close`）→ `b3-dialog__body`。
 *   独立页加载了思源的 base.css 与主题 CSS，只要结构一致，
 *   遮罩层、圆角、阴影、间距**全部由思源自己的样式负责**，
 *   所以这里的对话框和思源里长得一模一样。自己造一套反而会走偏。
 *
 * 对外承诺的 API 面（按实际调用点统计，别少也别多）：
 *   `element` / `destroy()` / `bindInput(input, callback)`
 */
export class Dialog {
  public element: HTMLElement
  public readonly dialog: { element: HTMLElement }
  private readonly destroyCallback?: () => void
  private destroyed = false
  private readonly onKeyDown: (event: KeyboardEvent) => void
  private readonly onMaskClick: (event: MouseEvent) => void

  constructor(options: DialogOptions = {}) {
    const width = options.width || "520px"
    const height = options.height ? `height:${options.height};` : ""

    this.element = document.createElement("div")
    this.element.className = "b3-dialog b3-dialog--open"
    this.element.setAttribute("role", "dialog")
    this.element.setAttribute("aria-modal", "true")
    this.element.innerHTML = `
      <div class="b3-dialog__container" style="width:${width};${height}">
        <div class="b3-dialog__header">
          <div class="b3-dialog__header-title">${options.title || ""}</div>
          <button class="b3-dialog__close" data-dc-dialog-close type="button" aria-label="close">${CLOSE_ICON_SVG}</button>
        </div>
        <div class="b3-dialog__body">${options.content || ""}</div>
      </div>
    `
    this.destroyCallback = options.destroyCallback
    this.dialog = { element: this.element }

    document.body.appendChild(this.element)

    /* 点遮罩关闭：只在「点到的就是遮罩本身」时触发，
       否则点对话框内部任何位置都会把它关掉。 */
    this.onMaskClick = (event: MouseEvent) => {
      if (event.target === this.element) {
        this.destroy()
      }
    }
    /* ESC 关闭：与思源行为一致 */
    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        this.destroy()
      }
    }
    this.element.addEventListener("click", this.onMaskClick)
    this.element.querySelector("[data-dc-dialog-close]")?.addEventListener("click", () => this.destroy())
    document.addEventListener("keydown", this.onKeyDown)
  }

  /**
   * 回车确认。
   *
   * 注：本函数在**输入框元素**上监听（调用方传进来的就是它），
   * 因此只覆盖"焦点在输入框里按回车"这一条 —— 这本就是唯一需要的场景。
   * 直接监听元素而不是 document，避免与页面上其它输入框互相干扰。
   */
  public bindInput(input: HTMLInputElement, callback: () => void): void {
    input.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault()
        callback()
      }
    })
  }

  /** 幂等：`destroy()` 多次调用只生效一次（调用点里既有显式 close 又有 destroyCallback 兜底）。 */
  public destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true

    document.removeEventListener("keydown", this.onKeyDown)
    this.element.remove()
    this.destroyCallback?.()
  }
}

/**
 * 与思源 `confirm(title, text, confirmCallback, cancelCallback)` 同签名。
 *
 * 回调收到的是 dialog 实例本身（调用方写法是 `(dialog) => dialog.destroy()`），
 * 所以这里必须把 `this` 传出去，不能只传布尔。
 */
export function confirm(
  title: string,
  text: string,
  confirmCallback?: (dialog: Dialog) => void,
  cancelCallback?: (dialog: Dialog) => void,
): Dialog {
  let settled = false
  const dialog: Dialog = new Dialog({
    title,
    width: "520px",
    // `fn__space` / `b3-button--outline` 等类都来自思源 base.css
    content: `
      <div class="b3-dialog__content" style="padding:4px 0 16px;">
        <div class="b3-label__text" style="font-size:14px;line-height:1.6;">${text}</div>
      </div>
      <div class="fn__flex" style="gap:8px;justify-content:flex-end;padding-bottom:4px;">
        <button class="b3-button b3-button--outline" data-dc-confirm-cancel type="button">取消</button>
        <button class="b3-button b3-button--error" data-dc-confirm-ok type="button">确认</button>
      </div>
    `,
    destroyCallback: () => {
      if (settled) {
        return
      }
      settled = true
      cancelCallback?.(dialog)
    },
  })

  dialog.element.querySelector("[data-dc-confirm-ok]")?.addEventListener("click", () => {
    if (settled) {
      return
    }
    settled = true
    confirmCallback?.(dialog)
  })
  dialog.element.querySelector("[data-dc-confirm-cancel]")?.addEventListener("click", () => {
    dialog.destroy()
  })

  return dialog
}

/* ──────────────────────────────────────────────────────────────
 * 内核 API
 * ────────────────────────────────────────────────────────────── */

interface KernelEnvelope<T = unknown> {
  code: number
  data: T
  msg: string
}

/**
 * ★ 真实现，不是桩 ★
 *
 * 与思源的 `fetchSyncPost` 打的是同一个内核接口、同一个 origin
 * （独立页由内核从 `/plugins/<插件名>/` 直接提供），
 * 因此会话 Cookie 自动带上，行为与插件里完全一致。
 *
 * 失败时**不抛**，返回 `{code:-1, msg}` —— 与思源同名函数的契约保持一致
 * （调用点都是先看 `code`）。
 */
export async function fetchSyncPost<T = unknown>(url: string, data?: unknown): Promise<KernelEnvelope<T>> {
  try {
    const response = await fetch(url, {
      body: JSON.stringify(data ?? {}),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    if (!response.ok) {
      return { code: -1, data: null as unknown as T, msg: `HTTP ${response.status}` }
    }
    return (await response.json()) as KernelEnvelope<T>
  } catch (error) {
    return { code: -1, data: null as unknown as T, msg: String(error) }
  }
}

/** 独立页没有编辑器实例集合 —— 依赖它的探测逻辑本就做了空值容错。 */
export function getAllEditor(): unknown[] {
  return []
}

/** 独立页视为桌面端：手势力争与桌面浏览器一致（不用移动端那套）。 */
export function getFrontend(): string {
  return "desktop"
}

interface OpenTabOptions {
  app?: unknown
  doc?: { action?: string[], id?: string }
}

/**
 * ★ 打开方块的等价换算：`/?id=<块ID>` ★
 *
 * 思源的 `openTab()` 需要一个真实的宿主 `app`（工作区布局树），独立页没有。
 * 但思源前端**支持用 URL 直接定位块** —— 实测：
 *   `GET /?id=20260415075733-qun78gc`
 *   → 自动打开含该块的文档（`document.title` 变成该文档标题，
 *     `.protyle-title[data-node-id]` 就是该块 ID）。
 *
 * 于是把它换算成一次 `window.open`：**新页签打开思源里的对应文档**。
 * 选新页签而不是复用当前页，是为了不打乱用户正在编辑的画布 ——
 * 画布留在原页，思源文档在另一个页签，与在思源里"打开页签"的体验最接近。
 *
 * 无 id 时安静返回：调用点（`openDocumentAtBlock`）只关心"有没有跳成"，
 * 不该因为这里抛异常而把双击手势带崩。
 */
export async function openTab(options?: OpenTabOptions): Promise<void> {
  const blockId = options?.doc?.id
  if (!blockId || typeof window === "undefined") {
    return
  }
  window.open(`/?id=${encodeURIComponent(blockId)}`, "_blank")
}

/* ──────────────────────────────────────────────────────────────
 * 以下仅为「模块面完整」而存在，独立页用不到
 * ────────────────────────────────────────────────────────────── */

/**
 * 占位基类 / 占位设置面板。
 *
 * 独立页只渲染画布，构造真正的插件类与设置面板都不会发生；
 * 但打包时 `src/index.ts` **不在**独立页的依赖图里（它不在 `standalone.ts` 的
 * import 链上），所以这两个导出其实用不到。保留是为了：万一将来有人把
 * 某个子模块的 import 链牵过来，符号能解析、不至于整个构建失败。
 */
export class Plugin {
  public name = ""
  public i18n: Record<string, string> = {}
}

export class Setting {
  constructor(public options?: Record<string, unknown>) {}
}

export function fetchPost(): Promise<unknown> {
  return Promise.resolve(null)
}

export function getFrontendType(): string {
  return "desktop"
}

export function getActiveTab(): undefined {
  return undefined
}

export function adaptHotkey(): void {
  /* no-op */
}

export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
