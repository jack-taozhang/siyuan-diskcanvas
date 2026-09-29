/**
 * 「画布」自定义块 —— 让画布能作为**块**插入笔记，样式与网盘文件嵌入一致。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 为什么要改成自定义块（原来是 markdown 图片）★
 * ══════════════════════════════════════════════════════════════════════
 *   旧实现：把画布缩略图渲染成 SVG → 上传到 `assets/` → 在笔记里插入
 *   `![标题](/assets/xxx.svg "标题")`。
 *
 *   问题（用户诉求「块样式参照网盘文件插入样式」）：
 *     · 它就是一个**图片**，没有容器、没有头部、没有工具条，
 *       与网盘文件嵌入（`;;;siyuan-nebuladisk/nebuladisk` 自定义块）风格完全不同；
 *     · 预览尺寸由图片自身决定，无法与网盘嵌入的 `clamp(300px,58vh,620px)` 对齐；
 *     · 每次刷新都要**再上传一个资源文件**，笔记里越攒越多孤儿 SVG。
 *
 *   现在：插入 `;;; <插件名>/canvas \n {json} \n ;;;` 自定义块，
 *   由思源的 `customBlockRenders` 机制渲染。
 *   块内**直接**读取 `.canvas` 文件并画出只读预览 ⇒ 不再上传任何资源。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 三条实测约束（照抄网盘插件的踩坑记录，同一内核因此同样适用）★
 * ══════════════════════════════════════════════════════════════════════
 *   1. **必须用 `;;;` 围栏，不能用反引号** ```` ``` ````
 *      反引号在思源里生成的是普通代码块（type=c），自定义块渲染器不会被调用，
 *      笔记里显示成一坨裸 JSON。
 *
 *   2. **围栏必须顶格**
 *      实测（v3.8.4）前面多任何一个字符都会退化成普通段落（type=p）。
 *      下面 buildCanvasEmbedBlockMarkdown 里做了断言，任何改动把它弄歪都会立刻暴露。
 *
 *   3. **插入必须走内核 API**（`/api/block/insertBlock`，dataType=markdown），
 *      不能走前端 `protyle.insert` —— 后者会把 `;;;` 存成普通段落。
 *      落位在 insertCanvasEmbed 中已由既有代码保证（它本来就调内核 API）。
 */

import { parseCanvasDocument } from "@/canvas/format"
import {
  generateCanvasFitSvg,
  toSvgDataUrl,
} from "@/canvas/canvas-embed-preview"
import { CANVAS_TAB_ICON_ID } from "@/icons"

/** 自定义块类型键（data-info 斜杠**后面**那一段） */
export const CANVAS_EMBED_BLOCK_TYPE = "canvas"

/**
 * 嵌入块用到的文案键。
 *
 * ★ 为什么要显式列出而不是直接收 `string` ★
 *   插件的 `t` 是 `(key: CanvasI18nKey, ...) => string`（键名联合类型由 zh_CN.json 派生）。
 *   若本模块把 `t` 声明成收 `string`，`index.ts` 里传 `(k) => this.t(k, ...)`
 *   就会因为「string 不能赋给 CanvasI18nKey」而类型报错。
 *   窄联合既能通过类型检查，又能在改名时被编译器抓住。
 */
export type CanvasEmbedI18nKey =
  | "canvasEmbedOpenInTab"
  | "canvasEmbedRefresh"
  | "canvasEmbedLoading"
  | "canvasEmbedReadFailed"
  | "canvasEmbedInvalid"

type CanvasEmbedTranslate = (
  key: CanvasEmbedI18nKey,
  params?: Record<string, number | string>,
) => string

/** 生成 data-info 串：`<插件名>/<块类型>` */
/**
 * 历史插件名（**只增不减**）。
 *
 * 用处：笔记里的嵌入块存的是围栏 info 原文 `;;;<插件名>/canvas`，
 * 插件改名后必须继续认旧名字，否则用户已有笔记里的画布会**当场变成一段 JSON 文本**。
 * 每次改名把被替换掉的那个名字追加到这里。
 */
export const CANVAS_EMBED_LEGACY_PLUGIN_NAMES: readonly string[] = [
  // 2026-09-29 前的名字（改名 siyuan-diskcanvas-next → siyuan-diskcanvas）
  "siyuan-diskcanvas-next",
]

export function canvasEmbedLang(pluginName: string): string {
  return `${pluginName || "siyuan-diskcanvas"}/${CANVAS_EMBED_BLOCK_TYPE}`
}

export interface CanvasEmbedSpec {
  /** 画布在工作区里的路径（相对工作区根，含 `/data/` 前缀与否都能被既有代码归一） */
  path: string
  /** 展示用标题；缺省时由路径推导 */
  title?: string
}

export function stringifyCanvasEmbed(spec: CanvasEmbedSpec): string {
  const payload: Record<string, unknown> = { path: spec.path }
  if (spec.title) {
    payload.title = spec.title
  }
  return JSON.stringify(payload)
}

/** 解析块内容（容错：非 JSON / 缺 path 都返回 null，由渲染器给出可读提示） */
export function parseCanvasEmbed(content: string): CanvasEmbedSpec | null {
  const trimmed = (content || "").trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const path = typeof parsed.path === "string" ? parsed.path.trim() : ""
    if (!path) {
      return null
    }
    return {
      path,
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined,
    }
  } catch {
    return null
  }
}

/**
 * 生成要写进笔记正文的自定义块 markdown（三引号分号围栏）。
 * 围栏必须顶格 —— 见文件头「约束 2」。
 */
export function buildCanvasEmbedBlockMarkdown(pluginName: string, spec: CanvasEmbedSpec): string {
  const md = `;;;${canvasEmbedLang(pluginName)}\n${stringifyCanvasEmbed(spec)}\n;;;\n`

  if (!md.startsWith(";;;")) {
    throw new Error(`画布嵌入块 markdown 非法（围栏未顶格）：${JSON.stringify(md.slice(0, 40))}`)
  }

  return md
}

/** 从嵌入块 markdown 里抠出 JSON 正文（重建 / 迁移时用） */
export function extractCanvasEmbedJson(md: string): string {
  const lines = String(md || "").split(/\r?\n/)
  const body: string[] = []
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === ";;;") {
      break
    }
    body.push(lines[i])
  }
  return body.join("\n").trim()
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

/**
 * 画布挂载器 —— 由 index.ts 在 onload 里注入（`mountCanvasApp` / `unmountCanvasApp`）。
 *
 * ★ 为什么用「注入」而不是直接 import `@/main` ★
 *   本模块处于这条依赖链上：
 *     canvas-embed-insert → canvas-embed-block
 *     index.ts → canvas-embed-insert
 *   而 `@/main` 会经 App.vue → CanvasWorkspace → use-canvas-editor → …
 *   绕回 canvas-embed-insert ⇒ **循环依赖**。
 *   注入让本模块对「谁来挂载」一无所知，只在运行时拿到两个函数。
 *   （与 siyuan-nebuladisk 用 `bindPluginApi(plugin, api)` 解循环是同一手法。）
 */
type CanvasEmbedMount = (
  element: HTMLElement,
  bootstrap: { path: string, title?: string, embed: boolean },
  setTitle: (title: string) => void,
) => void

type CanvasEmbedUnmount = (element: HTMLElement) => void

let embedMounter: CanvasEmbedMount | null = null
let embedUnmounter: CanvasEmbedUnmount | null = null

/** 已挂载的宿主元素 —— 用于在被宿主移除时及时卸载，避免 Vue 实例泄漏 */
const mountedEmbedHosts = new Set<HTMLElement>()

/**
 * 移除哨兵。
 *
 * ★ 为什么需要它 ★
 *   SiYuan 在文档关闭 / 重新渲染时会**直接移除块 DOM**，
 *   而 Vue 在「根元素被移除」时**不会**自动 unmount ⇒
 *   app 实例、watcher、主题同步监听都会留在内存里；
 *   画布还会继续订阅全局事件。文档开关几次就会累积一批幽灵实例。
 *
 * ★ 为什么用 MutationObserver 而不是思源事件 ★
 *   本机没有可靠的文档销毁事件名可依赖（types 里没列，靠猜容易写错），
 *   而「元素脱离文档」是**客观可判定**的，不依赖任何宿主实现细节。
 *
 * ★ 开销控制 ★
 *   只在**确实存在已挂载宿主**时挂上观察器；扫完发现一个都不剩就立刻断开。
 *   没有嵌入块的文档 ⇒ 观察器根本不存在。
 */
let embedSweepObserver: MutationObserver | null = null

function sweepDetachedEmbedHosts(): void {
  if (mountedEmbedHosts.size === 0) {
    embedSweepObserver?.disconnect()
    embedSweepObserver = null
    return
  }

  for (const host of Array.from(mountedEmbedHosts)) {
    if (host.isConnected) {
      continue
    }

    mountedEmbedHosts.delete(host)
    try {
      embedUnmounter?.(host)
    } catch {
      /* 卸载失败不应影响其它宿主 */
    }
  }

  if (mountedEmbedHosts.size === 0) {
    embedSweepObserver?.disconnect()
    embedSweepObserver = null
  }
}

function trackEmbedHost(host: HTMLElement): void {
  mountedEmbedHosts.add(host)

  if (embedSweepObserver || typeof MutationObserver === "undefined") {
    return
  }

  embedSweepObserver = new MutationObserver(() => {
    sweepDetachedEmbedHosts()
  })
  embedSweepObserver.observe(document.body, { childList: true, subtree: true })
}

/** 卸载某个宿主的画布实例（幂等）；同时从追踪表移除 */
export function unmountEmbedCanvas(host: HTMLElement): void {
  mountedEmbedHosts.delete(host)
  try {
    embedUnmounter?.(host)
  } catch {
    /* 忽略 */
  }
}

/**
 * 注入挂载/卸载实现。由 `index.ts` 的 onload 调用一次。
 * 传 null 可显式关闭（测试用）。
 */
export function setCanvasEmbedMounter(
  mount: CanvasEmbedMount | null,
  unmount: CanvasEmbedUnmount | null,
): void {
  embedMounter = mount
  embedUnmounter = unmount
}

interface CanvasEmbedRendererOptions {
  /** 在页签中打开该画布 */
  openInTab: (path: string) => void
  /** 读取工作区文本文件 */
  readWorkspaceText: (path: string) => Promise<string>
  /** 取文案（缺省时由路径推导） */
  t: CanvasEmbedTranslate
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** 从路径推导标题：去掉目录与 `.canvas` 后缀 */
export function canvasTitleFromPath(path: string): string {
  const fileName = (path || "").replace(/\\/g, "/").split("/").pop() || ""
  return fileName.replace(/\.canvas$/i, "") || fileName || "Canvas"
}

/**
 * 把 `/data/...` 形态的工作区路径转成思源 `/api/file/getFile` 可接受的路径。
 *
 * 画布路径在不同入口下有两种写法（`/data/storage/...` 与 `/storage/...`），
 * 实测内核的 `getFile` 接受带 `/data/` 前缀的形态；不带时补上。
 */
export function toKernelFilePath(path: string): string {
  const normalized = (path || "").trim().replace(/\\/g, "/")
  if (!normalized) {
    return ""
  }
  return normalized.startsWith("/data/") ? normalized : `/data/${normalized.replace(/^\//, "")}`
}

async function readWorkspaceText(path: string): Promise<string> {
  const kernelPath = toKernelFilePath(path)
  if (!kernelPath) {
    return ""
  }

  // 与既有 readWorkspaceCanvasText 同一通道：POST /api/file/getFile + 纯文本读取。
  const response = await fetch("/api/file/getFile", {
    body: JSON.stringify({ path: kernelPath }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.text()
}

/**
 * 构建整个嵌入块的 DOM。
 *
 * 结构刻意与网盘文件嵌入（`.nb-embed` / `.nb-embed-head` / `.nb-embed-frame-box`）
 * **一一对应**，只是类名前缀换成 `dc-`：
 *
 *   .dc-embed                  ← 边框圆角容器（对应 .nb-embed）
 *   .dc-embed-head             ← 26px 单行头部（对应 .nb-embed-head）
 *     .dc-embed-title          ←   标题（图标 + 名称 + 路径）
 *     .dc-embed-tools          ←   工具按钮
 *   .dc-embed-frame-box        ← 固定高度预览区（对应 .nb-embed-frame-box）
 *     .dc-embed-canvas-host    ←   **真实画布**（只读，可缩放平移）
 *
 * ★ 预览区为什么从「SVG 快照」换成「真实画布」★
 *   用户要求：「渲染的效果和编辑状态下是一样的，可以放大缩小，移动画布，
 *             就是不能编辑具体内容。」
 *   静态快照做不到缩放/平移，也永远和真实渲染有差异 ⇒ 直接挂载画布本体，
 *   并让它在 `embed` 模式下跑（见 use-canvas-editor 的 isEmbedMode）。
 */
export function createCanvasEmbedElement(
  spec: CanvasEmbedSpec,
  options: CanvasEmbedRendererOptions,
): HTMLElement {
  const title = spec.title || canvasTitleFromPath(spec.path)

  const wrap = document.createElement("div")
  wrap.className = "dc-embed"

  // ── 头部 ──
  const head = document.createElement("div")
  head.className = "dc-embed-head"

  const titleBox = document.createElement("div")
  titleBox.className = "dc-embed-title"
  // 图标：复用插件自己注册的精灵图（addIcons 已注入 #iconCanvasTab）
  titleBox.innerHTML = `<svg><use xlink:href="#${CANVAS_TAB_ICON_ID}"></use></svg>`
    + `<span class="dc-embed-name">${escapeHtml(title)}</span>`
    + `<span class="dc-embed-path" title="${escapeHtml(spec.path)}">${escapeHtml(spec.path)}</span>`

  const tools = document.createElement("div")
  tools.className = "dc-embed-tools"

  /**
   * 刷新按钮（放在「在页签中打开」**前面**，用户指定顺序）。
   *
   * ★ 为什么预览态特别需要它 ★
   *   嵌入实例是**只读且不落盘**的（见 use-canvas-editor 的 isEmbedMode 守卫），
   *   所以画布文件在别处被改动后，这个嵌入块不会自己更新。
   *   刷新 = 卸载旧实例 + 按当前文件重新挂载，
   *   这是唯一能让预览追上磁盘内容的动作。
   *
   * ★ 为什么用「卸载 + 重挂」而不是让编辑器重新读文件 ★
   *   画布编辑器没有对外暴露"重新加载当前文件"的入口；
   *   而重挂走的就是首次渲染那条路径（已被验证过），
   *   不会引入第二条需要单独维护的载入逻辑。
   */
  const refreshBtn = document.createElement("button")
  refreshBtn.type = "button"
  refreshBtn.className = "dc-embed-btn"
  refreshBtn.textContent = options.t("canvasEmbedRefresh")
  refreshBtn.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    // 宿主可能已被换掉（重渲染），从当前 DOM 里重新取，避免闭包持有陈旧节点
    const host = wrap.querySelector<HTMLElement>(".dc-embed-canvas-host")
    if (!host) {
      return
    }
    unmountEmbedCanvas(host)
    host.replaceChildren()
    // 刷新动画交给按钮自身，避免整块闪烁
    refreshBtn.disabled = true
    setTimeout(() => {
      refreshBtn.disabled = false
    }, 600)
    mountReadonlyCanvas(host, spec, title, options)
  })
  tools.appendChild(refreshBtn)

  const openBtn = document.createElement("button")
  openBtn.type = "button"
  openBtn.className = "dc-embed-btn dc-embed-btn--primary"
  openBtn.textContent = options.t("canvasEmbedOpenInTab")
  openBtn.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    options.openInTab(spec.path)
  })
  tools.appendChild(openBtn)

  head.appendChild(titleBox)
  head.appendChild(tools)

  // ── 预览区：真实画布宿主 ──
  const frameBox = document.createElement("div")
  frameBox.className = "dc-embed-frame-box"

  const canvasHost = document.createElement("div")
  canvasHost.className = "dc-embed-frame dc-embed-canvas-host"
  /* ★ 关键布局约束走内联样式 ★
   *   与 CanvasWorkspace.vue 根元素同理：外部样式表命中存在时序窗口，
   *   而画布挂载后会**立刻**按宿主尺寸计算 stage 与初始缩放。
   *   若此窗口内显示为默认（display:block / 无高度约束），
   *   宿主会被内容撑到数千像素，画布的 fit-view 比例随之算错 → 首帧空白／跳动。
   *   显式内联后，元素从插入文档的第一帧起就有确定的 100% 高、overflow:hidden。 */
  Object.assign(canvasHost.style, {
    display: "block",
    width: "100%",
    height: "100%",
    minHeight: "0",
    padding: "0",
    overflow: "hidden",
    boxSizing: "border-box",
  })
  frameBox.appendChild(canvasHost)

  wrap.appendChild(head)
  wrap.appendChild(frameBox)

  mountReadonlyCanvas(canvasHost, spec, title, options)

  return wrap
}

/**
 * 把真实画布挂进宿主元素（只读、可缩放平移）。
 *
 * 挂载器缺失或挂载抛错时**降级为静态 SVG 快照** ——
 * 降级产物仍是有内容可看的图，而不是一块空白或一条报错，
 * 用户至少知道这里嵌了一张画布、可以点「在页签中打开」。
 */
function mountReadonlyCanvas(
  host: HTMLElement,
  spec: CanvasEmbedSpec,
  title: string,
  options: CanvasEmbedRendererOptions,
): void {
  if (embedMounter) {
    try {
      embedMounter(host, { embed: true, path: spec.path, title }, () => {
        /* 嵌入块不改外部标题 */
      })
      trackEmbedHost(host)
      return
    } catch (error) {
      // 走到这里说明画布初始化真的失败了，降级并保留原因
      renderStaticFallback(host, spec, title, options, String(error))
      return
    }
  }

  renderStaticFallback(host, spec, title, options, "embedMounter 未注入")
}

/** 降级渲染：把画布画成一张静态 SVG 快照（同步占位，异步填充） */
function renderStaticFallback(
  host: HTMLElement,
  spec: CanvasEmbedSpec,
  title: string,
  options: CanvasEmbedRendererOptions,
  reason: string,
): void {
  const hint = document.createElement("p")
  hint.className = "dc-embed-hint"
  hint.textContent = options.t("canvasEmbedLoading")
  hint.title = reason
  host.replaceChildren(hint)

  void (async () => {
    try {
      const raw = await options.readWorkspaceText(spec.path)
      if (!raw) {
        throw new Error("empty")
      }

      const parsed = parseCanvasDocument(raw)
      if (!parsed.document || parsed.errors.length > 0) {
        throw new Error("parse")
      }

      const svg = generateCanvasFitSvg(parsed.document)
      if (!svg) {
        throw new Error("empty-canvas")
      }

      const img = document.createElement("img")
      img.className = "dc-embed-image"
      img.alt = title
      img.src = toSvgDataUrl(svg)
      host.replaceChildren(img)
    } catch {
      hint.textContent = options.t("canvasEmbedReadFailed")
      hint.classList.add("dc-embed-hint--error")
    }
  })()
}

interface CustomBlockRendererArgs {
  element: HTMLElement
  content: string
}

interface CustomBlockRenderer {
  render: (args: CustomBlockRendererArgs) => void
}

/** 插件实例上自定义块渲染表的结构（siyuan 的 Plugin 类型未声明该字段） */
export interface CanvasEmbedBlockHost {
  name: string
  customBlockRenders?: Record<string, CustomBlockRenderer>
  openCanvasTab?: (bootstrap?: { path?: string, title?: string }) => Promise<void> | void
}

/**
 * 注册「画布」自定义块渲染器。
 *
 * ★ 主键用块类型（斜杠**后面**那段）★
 *   思源查渲染器时用的是 `data-info` 斜杠后的 blockType。
 *   同时按插件名注册一份，兼容历史/异常写法。
 */
export function registerCanvasEmbedBlock(
  plugin: CanvasEmbedBlockHost,
  t: CanvasEmbedTranslate,
): void {
  const options: CanvasEmbedRendererOptions = {
    openInTab: (path) => {
      void plugin.openCanvasTab?.({ path })
    },
    readWorkspaceText,
    t,
  }

  const renderer: CustomBlockRenderer = {
    render: ({ element, content }) => {
      /* ══════════════════════════════════════════════════════════════════
       * ★★★ 绝对不要 `element.innerHTML = ""` ★★★
       *      —— 这是第 4 轮抓到的「嵌入块自己反复重绘 / 闪烁」的根因。
       *
       * 思源把 `element` 传进来时，它**不是**普通的空 div，而是思源自己
       * 维护的 `.custom-block__content` 骨架：
       *
       *   <div class="custom-block" data-type="NodeCustomBlock" ...>
       *     <div class="custom-block__content">
       *       <pre>…原始 JSON…</pre>        ← ★ 思源认这个 <pre> ★
       *     </div>
       *     <div class="protyle-attr">…</div>
       *   </div>
       *
       * `<pre>` 是思源「渲染器还没接管」时的占位内容。渲染器一旦把它删掉、
       * 又没有按思源预期放回等价结构，思源的 protyle 观察器就认为
       * **这个块的结构坏了** ⇒ 立刻重新渲染这个块 ⇒ 又调我们的 render
       * ⇒ 我们再删一次 `<pre>` …
       *
       * 实测（NAS 真机，CDP 记录 MutationObserver）：所有 mutation 都挤在
       * 同一 tick（dt=77ms）无限重复，形如
       *   custom-block__content: add <PRE>
       *   custom-block__content: remove <PRE>     ← 我们干的
       * 外部表现就是画布每隔几秒闪一下 / 消失又出现（wysiwyg 计数 2↔1）。
       *
       * ⇒ 正确做法（照抄 siyuan-nebuladisk 的既有契约）：
       *     只清掉**我们自己**上次塞进去的东西，<pre> 原样留着，
       *     并用 CSS 把它视觉上藏起来（见 canvas-workspace.scss 的
       *     `.custom-block__content > pre` 规则）。
       * ══════════════════════════════════════════════════════════════════ */

      // ① 先卸载上一次挂在本元素里的画布实例。
      //    只摘掉 Vue 的根节点**不会**销毁 app：watcher / 主题同步监听 /
      //    画布内部的全局订阅都会留在内存里。思源在文档重渲染、块刷新时会
      //    带着同一个 element 再调一次 render，不先卸载就会每刷一次多一个幽灵实例。
      const previousHost = element.querySelector<HTMLElement>(".dc-embed-canvas-host")
      if (previousHost) {
        unmountEmbedCanvas(previousHost)
      }

      // ② 只移除「我们自己」的产物，严禁碰思源的 <pre> 等骨架节点。
      element.querySelectorAll(":scope > .dc-embed, :scope > .dc-embed-error").forEach((node) => node.remove())

      element.classList.add("dc-embed-host")

      const spec = parseCanvasEmbed(content)
      if (!spec) {
        const bad = document.createElement("div")
        bad.className = "dc-embed-error"
        bad.textContent = t("canvasEmbedInvalid")
        element.appendChild(bad)
        return
      }

      try {
        element.appendChild(createCanvasEmbedElement(spec, options))
      } catch (error) {
        const bad = document.createElement("div")
        bad.className = "dc-embed-error"
        bad.textContent = `${t("canvasEmbedReadFailed")} (${String(error).slice(0, 80)})`
        element.appendChild(bad)
      }
    },
  }

  /**
   * ★★ 旧插件名的兼容（2026-09-29：`siyuan-diskcanvas-next` → `siyuan-diskcanvas`）★★
   *
   *   笔记正文里的嵌入块存的是**围栏 info 原文**：`;;;<插件名>/canvas`。
   *   改名后如果只注册新名字，用户**已有笔记里的画布嵌入会立刻停止渲染**
   *   （退回思源的占位 <pre>，也就是"画布变成一段 JSON 文本"）。
   *   那不是"旧数据"—— 是用户正在用的内容，必须继续认。
   *
   *   ⇒ 新名与旧名**都注册**；`lastRegisteredLangs` 也带上旧名，
   *     这样"补渲染"（思源先渲染、我们后注册的那种块）同样能救回旧名字的块。
   *     旧名只增不减：将来再改名时把当前名继续往里加即可。
   */
  /**
   * ★ 注册键要**对称**：当前名与历史名都注册 `<名>/canvas` ★
   *
   *   实测抓到的缺陷：改造时只给"历史名"注册了 `<名>/canvas`，
   *   当前名那边却只有 `"canvas"` 与裸插件名两个键 ⇒
   *   `customBlockRenders` 里的键是 `["canvas", "<当前名>", "<旧名>/canvas"]`，
   *   而"补渲染"识别的 lang 列表里却有 `<当前名>/canvas` ——
   *   **注册表与识别列表不一致**，新名的嵌入块一旦需要补渲染就对不上。
   */
  const langs = [
    canvasEmbedLang(plugin.name),
    ...CANVAS_EMBED_LEGACY_PLUGIN_NAMES.map((name) => canvasEmbedLang(name)),
  ]

  plugin.customBlockRenders = plugin.customBlockRenders || {}
  plugin.customBlockRenders[CANVAS_EMBED_BLOCK_TYPE] = renderer
  plugin.customBlockRenders[plugin.name] = renderer
  for (const lang of langs) {
    plugin.customBlockRenders[lang] = renderer
  }

  lastRegisteredRenderer = renderer
  lastRegisteredLangs = [plugin.name, ...langs]
}

/** 最近一次注册的渲染器与它认的 lang —— 供「补渲染」使用 */
let lastRegisteredRenderer: CustomBlockRenderer | null = null
let lastRegisteredLangs: string[] = []

/**
 * 已经被我们「兜底补渲染」过的块 id 集合。
 *
 * ★ 为什么必须记这个 ★
 *   补渲染是轮询驱动的（500ms/2s）。若不加记忆，一旦思源自己在某个瞬间
 *   把 content 换掉（哪怕只是一帧），轮询就会**再补一次**，
 *   而补渲染又会触发思源再次重绘……形成新的自激循环。
 *
 *   实测教训：不加记忆时，6 轮里 6 轮都出现「挂载成功后又掉回 <pre>」
 *   （掉回采样 2~5 次）；加上记忆后完全稳定。
 *
 *   ⇒ 一个块**只救一次**：救过就记账，之后无论它变成什么样都不再插手，
 *     把后续渲染完全交还给思源自己的渲染器。
 */
const rescuedBlocks = new Set<string>()

/** 块是否「已被思源渲染过，但渲染器未接管」（只剩占位 <pre>） */
function isUnhandledCanvasBlock(block: Element): boolean {
  if (!(block instanceof HTMLElement)) return false
  if (block.getAttribute("data-type") !== "NodeCustomBlock") return false

  const info = block.getAttribute("data-info") || ""
  const lang = info.includes("/") ? info.split("/").slice(1).join("/") : info
  if (!lastRegisteredLangs.includes(lang)) return false

  const content = block.querySelector<HTMLElement>(":scope > .custom-block__content")
  if (!content) return false

  /* 已接管：我们的产物在。别动。 */
  if (content.querySelector(":scope > .dc-embed, :scope > .dc-embed-error")) return false

  /* 未接管：思源留下的占位 <pre>（或干脆空）就是证据。 */
  return true
}

/** 取块的稳定标识（优先 data-node-id；退化为来自路径）。 */
function canvasBlockKey(block: HTMLElement): string {
  const nodeId = block.getAttribute("data-node-id")
  if (nodeId) return nodeId
  const info = block.getAttribute("data-info") || ""
  const pre = block.querySelector(":scope > .custom-block__content > pre")
  return `${info}::${(pre?.textContent || "").trim().slice(0, 120)}`
}

/**
 * 把「思源已经渲染过、但当时我们还没注册渲染器」的画布块补渲染一遍。
 *
 * ★ 为什么必须有这个补丁 ★
 *   `onload` 是 async，而思源加载插件与渲染工作区是两条独立流水线。
 *   冷启动打开一个含画布块的文档时，**思源常常先渲染完文档**，
 *   再轮到我们执行 onload —— 此刻查 `customBlockRenders` 查不到，
 *   思源就用裸 `<pre>` 占位，并且**此后不再自动重绘**。
 *
 *   实测（NAS 真机，冷启动打开含块文档，观察 22s）：
 *     末态 cb=1 / stage=0 / dc=0 / pre=1 —— 全程零变化，块永久停在裸 JSON 状态。
 *   把注册提到 onload 最前面只能**减少**概率，不能根治（谁先跑由宿主管）。
 *
 * ★ 安全约束（踩过坑）★
 *   1. **每个块只救一次**（rescuedBlocks 记账）—— 否则会与思源自身的
 *      重绘互相激发，变成新的闪烁循环。
 *   2. 只处理「content 里连一个 .dc-embed 都没有」的块 —— 已经在正常工作的
 *      块永远不碰。
 *   3. 只在有可解析的 <pre> 文本时才动手；拿不到内容就跳过，避免把
 *      空块渲染成报错。
 *
 * @returns 本次补渲染的块数（便于测试断言）
 */
export function rerenderStaleCanvasBlocks(root: ParentNode = document): number {
  const renderer = lastRegisteredRenderer
  if (!renderer) return 0

  let count = 0
  const blocks = root.querySelectorAll<HTMLElement>('.custom-block[data-type="NodeCustomBlock"]')
  for (const block of Array.from(blocks)) {
    if (!isUnhandledCanvasBlock(block)) continue

    const key = canvasBlockKey(block)
    if (rescuedBlocks.has(key)) continue

    const content = block.querySelector<HTMLElement>(":scope > .custom-block__content")
    if (!content) continue

    const pre = content.querySelector(":scope > pre")
    const text = (pre?.textContent || "").trim()
    if (!text) continue

    try {
      renderer.render({ element: content, content: text })
      /* ★ 记账必须在 render 之后：万一 render 抛错，下次轮询还能再试一次。 */
      rescuedBlocks.add(key)
      count += 1
    } catch {
      /* 单个块失败不影响其它块（也没有记账，下轮可重试） */
    }
  }
  return count
}

/** 供其它模块复用的内核文件读取（保持单一实现） */
export const readCanvasWorkspaceText = readWorkspaceText
