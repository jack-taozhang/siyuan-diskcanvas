import type { Custom } from "siyuan"
import type { IProtyle } from "siyuan"
import type {
  CanvasPluginUiState,
  CanvasPluginSettings,
  CanvasRecentFileSource,
  CanvasRecentFile,
} from "@/canvas/plugin-data"

import { ref } from "vue"
import type { CanvasTabBootstrap } from "@/main"
import {
  fetchSyncPost,
  getAllEditor,
  getFrontend,
  Plugin,
  Setting,
  showMessage,
} from "siyuan"
import PluginInfoString from "@/../plugin.json"
import {
  createDefaultCanvasPluginData,
  normalizeCanvasPluginData,
  rememberRecentCanvasFile,
  removeRecentCanvasFile,
  updateCanvasPluginUiState,
} from "@/canvas/plugin-data"
import { openCanvasPluginSettingsPanel } from "@/canvas/plugin-settings-panel"
import { detectCanvasPluginRuntime } from "@/canvas/plugin-runtime"
import { refreshNebulaClient } from "@/canvas/nebula-client-provider"
import { openTextInputDialog } from "@/canvas/text-input-dialog"
import { openCanvasFilePickerDialog } from "@/canvas/canvas-file-picker-dialog"
import {
  CANVAS_EDITOR_TAB_TYPE,
  openCanvasEditorTab,
  registerCanvasEditorTab,
} from "@/canvas/plugin-tabs"
import {
  CANVAS_TAB_ICON_BODY,
  CANVAS_TAB_ICON_ID,
} from "@/icons"
import { createCanvasI18n } from "@/i18n/canvas"
import { getCanvasFileName } from "@/canvas/use-canvas-editor-shared"
import {
  bindPlugin,
  mountCanvasApp,
  unmountCanvasApp,
} from "@/main"
import { setCanvasEmbedDebugEnabled, startCanvasEmbedObserver, stopCanvasEmbedObserver } from "@/canvas/canvas-embed-observer"
import { insertCanvasEmbed, insertCanvasLink } from "@/canvas/canvas-embed-insert"
import { getFileText, putFile as siyuanPutFile, readDir as siyuanReadDir, removeFile as siyuanRemoveFile } from "@/api"
import { openConfirmDialog } from "@/canvas/confirm-dialog"
import { createCanvasEditorWorkspaceTree, type CanvasEditorWorkspaceTree } from "@/canvas/use-canvas-editor-workspace-tree"
import { runCanvasEmbedCommand } from "@/canvas/canvas-embed-command"
import { registerCanvasEmbedBlock, rerenderStaleCanvasBlocks, setCanvasEmbedMounter } from "@/canvas/canvas-embed-block"
import { cleanupSlashText } from "@/canvas/slash-cleanup"

import "@/index.scss"

const pluginInfo = PluginInfoString as { name: string, version: string }
const STORAGE_KEY = "diskcanvas-plugin-data"

export default class SiyuanCanvasPlugin extends Plugin {
  public isBrowser = false
  public isElectron = false
  public isInWindow = false
  public isLocal = false
  public isMobile = false
  public platform: SyFrontendTypes
  public readonly version = pluginInfo.version
  public activeEditor = ref<any>(null)
  public workspaceTree: CanvasEditorWorkspaceTree | null = null
  private canvasData = createDefaultCanvasPluginData()
  private lastActiveProtyle: IProtyle | null = null

  public getOrCreateWorkspaceTree(): CanvasEditorWorkspaceTree {
    if (!this.workspaceTree) {
      this.workspaceTree = createCanvasEditorWorkspaceTree({
        readDir: siyuanReadDir,
        putFile: siyuanPutFile,
        removeFile: siyuanRemoveFile,
        showMessage,
        getSettings: () => this.getCanvasSettings(),
        plugin: this,
        onFilePathUpdate: (path: string) => {
          if (this.activeEditor?.value?.state) {
            this.activeEditor.value.state.filePath = path
          }
        },
        refreshRecentFiles: () => {
          // 触发近期文件同步
        },
        promptText: openTextInputDialog,
        confirm: openConfirmDialog,
        labels: {
          copyTitle: this.t("selectionToolbarCopy") || "复制",
          deleteCanvasTitle: this.t("selectionToolbarDelete") || "删除画布",
          deleteFolderTitle: this.t("contextMenuDelete") || "删除文件夹",
          dialogCancel: this.t("dialogCancel") || "取消",
          dialogConfirm: this.t("dialogConfirm") || "确认",
          folderNameTitle: this.t("inspectorNewFolder") || "新建文件夹",
          renameFolderTitle: this.t("contextMenuRename") || "重命名文件夹",
          renameTitle: this.t("contextMenuRename") || "重命名",
          unableToSaveMessage: this.t("unableToSave") || "无法保存",
          untitledCanvas: this.t("untitledCanvas") || "未命名画布.canvas",
        },
      })
    }
    return this.workspaceTree
  }

  private readonly rememberActiveProtyle = (event: CustomEvent<{ protyle?: IProtyle }>) => {
    if (event.detail?.protyle) {
      this.lastActiveProtyle = event.detail.protyle
    }
  }

  /** 补渲染轮询的定时器 —— onunload 时要清干净，避免卸载后还在跑 */
  private readonly sweepTimers: number[] = []

  async onload() {
    /* ══════════════════════════════════════════════════════════════════
     * ★★★ 必须在**第一个 await 之前**注册自定义块渲染器 ★★★
     *
     * 实测（NAS 真机 CDP，反复 4 轮）复现的偶发缺陷：
     *   · 4 次里约 1 次，笔记里的 `;;;…/canvas` 块**永远停在裸 <pre> 状态**
     *     （DOM 实测 stage=0 / pre=1 / dc=0），画布根本不挂载，也不闪不动。
     *   · 其余 3 次完全正常且长期稳定。
     *
     * 根因：`onload` 是 async，且下面第一行就 `await this.loadData(...)`。
     *   `await` 会让出事件循环；而思源**当前已打开的文档**会在这一刻
     *   立刻渲染，去查 `plugin.customBlockRenders[lang]`。
     *   此刻我们还没注册 ⇒ 思源用裸 <pre> 占位，并且**之后不会自动重绘**
     *   （这正是下面 registerCanvasEmbedBlock 注释里已写明的坑：
     *    「注册晚一步，历史嵌入块就会先被渲染成裸 JSON，之后再也不会重绘」）。
     *
     * 之前把注册放在 onload 中段（addTopBar / addCommand … 之后）**并不够**，
     * 因为那些调用仍然在 await 之后。
     *
     * 处置：把注册整体提到函数最前面。
     *   此时 `this.t` 已经可用（思源在调用 onload 之前就建好了 i18n），
     *   所以不需要惰性代理 —— 直接传 `(key, params) => this.t(key, params)`
     *   即可；渲染器内部保存的是这个**箭头函数**，真正取文案发生在渲染时，
     *   语言切换也能跟着变。
     * ══════════════════════════════════════════════════════════════════ */
    registerCanvasEmbedBlock(this, (key, params) => this.t(key, params))

    /* 挂载器注入也必须同步完成 —— 否则「注册了渲染器但挂载器还是 null」的
     * 那一次渲染会降级成静态 SVG 快照（不是报错，但用户看到的是死图）。
     * mountCanvasApp / unmountCanvasApp 是顶部静态 import，此处可直接用。 */
    setCanvasEmbedMounter(mountCanvasApp, unmountCanvasApp)

    /* ── 补渲染：把「思源已渲染、但我们当时还没注册」的画布块救回来 ──
     * 见 rerenderStaleCanvasBlocks 的注释：冷启动打开含块文档时，
     * 思源常常先渲染完文档再执行我们的 onload，那些块会永久停在裸 <pre>。
     *
     * ★ 为什么用「轮询」而不是 protyle 事件 ★
     *   实测（NAS 真机）v3.8.5 里**插件实例上没有可用的 eventBus**
     *   （`this.eventBus` 为 undefined，`window.siyuan.plugin` 也不存在），
     *   所以 `this.eventBus?.on?.("loaded-protyle-static", …)` 全是**静默空操作**，
     *   根本不会触发。靠事件补渲染 = 靠不住。
     *
     *   改用一个**有界轮询**：文档渲染完成的时间不可预测（实测 7~14s 都有），
     *   因此前 30 秒每 500ms 扫一次；之后转低频（2s）常驻，
     *   兜住「用户之后才切到某个含块文档」的情况。
     *   渲染器幂等 + 只查 DOM，开销可忽略。
     */
    const sweepStaleCanvasBlocks = () => {
      try { return rerenderStaleCanvasBlocks() } catch { return 0 }
    }
    sweepStaleCanvasBlocks()

    /* 高频段：前 30s，每 500ms —— 覆盖「文档比插件慢」的冷启动竞态 */
    let sweepTicks = 0
    const fastSweep = window.setInterval(() => {
      sweepTicks += 1
      sweepStaleCanvasBlocks()
      if (sweepTicks >= 60) {
        window.clearInterval(fastSweep)
      }
    }, 500)
    this.sweepTimers.push(fastSweep)

    /* 低频段：长期每 2s 一次，兜住后续切文档 */
    this.sweepTimers.push(window.setInterval(sweepStaleCanvasBlocks, 2000))

    this.canvasData = normalizeCanvasPluginData(await this.loadData(STORAGE_KEY))
    /* 记录「刚从磁盘读到的内容」作为已持久化快照 —— 只要之后的修改没有真正
     * 改变数据，persistCanvasData 就会直接跳过写盘，不触发 reloadPlugin 广播。 */
    try {
      this.lastPersistedSnapshot = JSON.stringify(this.canvasData)
    } catch {
      this.lastPersistedSnapshot = null
    }
    const frontend = getFrontend()
    const runtime = detectCanvasPluginRuntime(
      frontend as SyFrontendTypes,
      location.href,
      (moduleId) => require(moduleId),
    )
    this.platform = runtime.platform
    this.isMobile = runtime.isMobile
    this.isBrowser = runtime.isBrowser
    this.isLocal = runtime.isLocal
    this.isInWindow = runtime.isInWindow
    this.isElectron = runtime.isElectron

    bindPlugin(this)
    this.addIcons(`<symbol id="${CANVAS_TAB_ICON_ID}" viewBox="0 0 48 48">${CANVAS_TAB_ICON_BODY}</symbol>`)
    registerCanvasEditorTab(this, CANVAS_EDITOR_TAB_TYPE)

    /**
     * ★ 顶栏图标必须传**精灵图 ID**，不能传内联 `<svg>` 字符串 ★
     *
     * 实测依据（思源 3.8.5 桌面版 `main.<hash>.js` 的 addTopBar 实现）：
     *
     *   if (!Ve.element && !Ve.icon.startsWith("icon") && !Ve.icon.startsWith("<svg")) {
     *       console.error(`plugin ${this.name} addTopBar error: icon must be svg id or svg tag`)
     *       return
     *   }
     *   ...
     *   ke.innerHTML = Ve.icon.startsWith("icon")
     *       ? `<svg><use xlink:href="#${Ve.icon}"></use></svg>`   // ← 精灵图
     *       : Ve.icon                                             // ← 内联 svg 原样塞入
     *
     * 两条路都能通过校验（不报错），差别在渲染：
     *   - 精灵图分支：思源注入 `<svg>` 外壳，尺寸/着色由 `.toolbar__item svg` 规则统一管
     *   - 内联分支：字符串原样 innerHTML，**不套用**那套规则 —— 结果是顶栏上看不见
     *     （症状：右侧顶栏没有插件按钮）
     *
     * 佐证：本机另两个能正常显示顶栏按钮的第三方插件
     * （siyuan-nebuladisk `icon:"iconNebulaDisk"`、siyuan-plugins-index `icon:"iconList"`）
     * 传的都是 `icon` 前缀的精灵图 ID。
     */
    this.addTopBar({
      icon: CANVAS_TAB_ICON_ID,
      title: this.t("addTopBarIcon"),
      callback: () => {
        void this.openCanvasTab()
      },
    })

    this.addCommand({
      langKey: "openCanvas",
      langText: this.t("openCanvas"),
      callback: () => {
        void this.openCanvasTab()
      },
    })

    this.addCommand({
      langKey: "openCanvasPath",
      langText: this.t("openCanvasPath"),
      callback: async () => {
        const path = await openTextInputDialog({
          cancelLabel: this.t("dialogCancel"),
          confirmLabel: this.t("dialogConfirm"),
          initialValue: `${this.canvasData.settings.defaultCanvasDirectory}/${this.t("untitledCanvas")}`,
          title: this.t("promptWorkspacePath"),
        })
        if (!path) {
          return
        }

        void this.openCanvasTab({ path })
      },
    })

    this.addCommand({
      langKey: "openCanvasSettings",
      langText: this.t("openCanvasSettings"),
      callback: () => {
        this.openCanvasSettings()
      },
    })

    this.addCommand({
      langKey: "insertCanvasEmbed",
      langText: this.t("insertCanvasEmbed"),
      hotkey: "⌃⇧⌥C",
      callback: () => {
        void this.insertCanvasEmbedFromCommand()
      },
      editorCallback: (protyle) => {
        void this.insertCanvasEmbedFromCommand(protyle)
      },
    })

    this.protyleSlash = [
      {
        filter: [
          "insertCanvasEmbed",
          "插入 Canvas 预览",
          "charucanvas",
          "cr",
          "canvas",
          "preview",
          "wj",
          "yulan",
          "embed",
        ],
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#${CANVAS_TAB_ICON_ID}"></use></svg><span class="b3-list-item__text">${this.t("insertCanvasEmbedSlash")}</span></div>`,
        id: "insertCanvasEmbed",
        callback: (protyle: any, nodeElement: HTMLElement) => {
          // ★ 斜杠入口要传 fromSlash ★
          //   思源的 slug 菜单**不替插件删**用户敲的 `/过滤词`
          //   （它给普通分支都调了 deleteContents，唯独 plugin 分支没有），
          //   所以必须由我们在插入成功后清理，否则笔记里会残留 `/画布`。
          //   同时把 nodeElement 当 anchorEl 传下去 —— 清理要靠它定位块 id 与文本。
          void this.insertCanvasEmbedFromCommand(protyle, nodeElement, { fromSlash: true })
        },
      },
    ]

    this.eventBus?.on?.("loaded-protyle-static", this.rememberActiveProtyle)
    this.eventBus?.on?.("loaded-protyle-dynamic", this.rememberActiveProtyle)
    this.eventBus?.on?.("switch-protyle", this.rememberActiveProtyle)

    /* 注：此处**不再**挂 loaded-protyle-* 去补渲染 —— 见前面长注释，
     * 实测这一版思源里插件实例没有 eventBus，挂了也是空操作。
     * 补渲染统一由 sweepStaleCanvasBlocks 的轮询负责。 */

    startCanvasEmbedObserver(this, pluginInfo.name, {
      debugLogEnabled: this.canvasData.settings.enableDebugLog,
    })

    /**
     * 「画布」自定义块渲染器 + 真实画布挂载器**已在 onload 最前面
     * （第一个 await 之前）注册完成** —— 见函数开头的长注释。
     * 这里不再重复注册：重复注册本身无害（同一 renderer 覆盖自己），
     * 但会掩盖「同步注册」这一关键约束，容易在下次重构时被挪回去。
     */

    /**
     * ★ 测试出口（只读，不改变任何行为）★
     *
     *   `cleanupSlashText` 是本模块之外的**私有实现细节**，只被
     *   `runCanvasEmbedCommand` 内部调用。这带来一个验收盲区：
     *   想在真机上单独验证它（尤其是「路径不该被误删」这条），
     *   只能「照着它重写一遍」——而那种验证证明的是**测试脚本**对，
     *   不是**实现**对。
     *
     *   所以这里把它挂到插件实例上，单纯为了能验到**真函数本身**。
     *   命名用 `__dc` 前缀标明是内部调试用途；它不接受外部输入去做别的事，
     *   也不被任何生产代码路径引用，删掉不影响功能。
     *   （与 siyuan-nebuladisk 暴露 `__nbCleanupSlashText` 是同一考量。）
     */
    ;(this as unknown as Record<string, unknown>).__dcCleanupSlashText = cleanupSlashText
  }

  onunload() {
    this.protyleSlash = []
    this.eventBus?.off?.("loaded-protyle-static", this.rememberActiveProtyle)
    this.eventBus?.off?.("loaded-protyle-dynamic", this.rememberActiveProtyle)
    this.eventBus?.off?.("switch-protyle", this.rememberActiveProtyle)
    for (const timer of this.sweepTimers) {
      window.clearInterval(timer)
    }
    this.sweepTimers.length = 0
    stopCanvasEmbedObserver()
  }

  async uninstall() {
    try {
      await this.removeData(STORAGE_KEY)
    } catch (e) {
      showMessage(this.t("uninstallDataRemoveFailed", { name: this.name, error: String(e) }), 2500, "error")
    }
  }

  override openSetting(): void {
    this.openCanvasSettings()
  }

  public async openCanvasTab(bootstrap: CanvasTabBootstrap = {}): Promise<void> {
    await openCanvasEditorTab(this, pluginInfo.name, bootstrap, this.t("untitledCanvas"))
  }

  public getCanvasSettings(): CanvasPluginSettings {
    return {
      ...this.canvasData.settings,
    }
  }

  public getCanvasUiState(): CanvasPluginUiState {
    return {
      inspectorSections: {
        ...this.canvasData.ui.inspectorSections,
      },
    }
  }

  public getRecentCanvasFiles(): CanvasRecentFile[] {
    return this.canvasData.recentFiles.map((item) => ({ ...item }))
  }

  public async rememberRecentCanvas(path: string, title?: string, sourceType: CanvasRecentFileSource = "workspace"): Promise<void> {
    if (!path) {
      return
    }

    const nextTitle = title || getCanvasFileName(path) || path
    const head = this.canvasData.recentFiles[0]

    /**
     * ★★★ 幂等守卫：避免「打开即写盘 → 宿主广播重载 → 再打开 → 再写盘」自激循环 ★★★
     *
     * 真机实测（CDP + Network + 调用栈，NAS <netdisk-host>）复现的缺陷：
     *   画布页签一挂载就调用 `initializeCanvasEditor` →
     *   `rememberRecentPath()` → `rememberRecentCanvas()` → `saveData()` →
     *   `/api/file/putFile` 写 `data/storage/petal/siyuan-diskcanvas-next/diskcanvas-plugin-data` →
     *   思源把这次写入通过 **WebSocket 广播给所有前端（包括发起写入的本前端）**：
     *     `reloadPlugin{dataChangePlugins:["siyuan-diskcanvas-next"],dataChangeReason:"overwrite"}`
     *   （对应 SiYuan issue #19187：petal 写入未携带受信 `app` 时用
     *     `BroadcastByType` 而非 `BroadcastByTypeAndExcludeApp`）
     *   → 插件被重载 → 页签 init 再次执行 → 再次写盘 → **每 ~5 秒一轮，永不停止**。
     *
     * 后果正是用户报的「编辑器 和嵌入块 不稳定」：
     *   Vue 应用每 5 秒被 unmount + remount 一次，`.canvas-shell` 随之重建，
     *   高度在 826px ↔ 4414px 之间跳变、画布 fit-view 比例反复重置 = 闪烁／空白。
     *
     * 为什么旧代码必然每次都写：`openedAt: new Date().toISOString()` **每次调用都不同**，
     *   所以「同一画布被同一页签反复打开」永远无法被判为「无变化」。
     *
     * 处置：只有当「最近文件列表真的会发生变化」时才写盘 ——
     *   即 目标 path 不是当前首项，或 标题/来源类型 与首项不同。
     *   首项已完全相同时**直接返回**，不刷新 `openedAt`。
     *
     *   「最近打开时间」退化为「最近一次**首次**打开时间」，这对排序毫无影响
     *   （首项本来就是最新打开的），但彻底切断了自激链。
     *   用户主动切换画布时 path 变化 → 正常写盘并置顶，行为不变。
     */
    if (
      head
      && head.path === path
      && head.title === nextTitle
      && head.sourceType === sourceType
    ) {
      return
    }

    this.canvasData = rememberRecentCanvasFile(this.canvasData, {
      openedAt: new Date().toISOString(),
      path,
      sourceType,
      title: nextTitle,
    })
    await this.persistCanvasData()
  }

  public async removeRecentCanvasFile(path: string): Promise<void> {
    this.canvasData = removeRecentCanvasFile(this.canvasData, path)
    await this.persistCanvasData()
  }

  public async updateCanvasSettings(settings: Partial<CanvasPluginSettings>): Promise<void> {
    this.canvasData = normalizeCanvasPluginData({
      ...this.canvasData,
      settings: {
        ...this.canvasData.settings,
        ...settings,
      },
    })
    await this.persistCanvasData()
    refreshNebulaClient()
  }

  public async updateCanvasUiState(ui: Partial<CanvasPluginUiState>): Promise<void> {
    this.canvasData = updateCanvasPluginUiState(this.canvasData, ui)
    await this.persistCanvasData()
  }


  public openCanvasSettings(): void {
    this.setting = openCanvasPluginSettingsPanel({
      createSetting: (options) => new Setting(options),
      getSettings: () => this.getCanvasSettings(),
      onSettingsChanged: () => {
        setCanvasEmbedDebugEnabled(this.canvasData.settings.enableDebugLog)
        window.dispatchEvent(new CustomEvent("diskcanvas-settings-changed"))
      },
      pluginName: this.name,
      saveSettings: async (settings) => {
        await this.updateCanvasSettings(settings)
      },
      t: (key, replacements) => this.t(key, replacements),
    })
  }

  private async insertCanvasEmbedFromCommand(
    protyle?: IProtyle,
    nodeElement?: HTMLElement,
    opts: { fromSlash?: boolean } = {},
  ): Promise<void> {
    const pickerResult = await openCanvasFilePickerDialog({
      cancelLabel: this.t("dialogCancel"),
      confirmLabel: this.t("dialogConfirm"),
      insertLinkSwitchLabel: this.t("canvasFilePickerInsertLink"),
      noResultsLabel: this.t("canvasFilePickerNoResults"),
      searchPlaceholder: this.t("canvasFilePickerSearchPlaceholder"),
      title: this.t("insertCanvasEmbedPrompt"),
      defaultDirectory: this.canvasData.settings.defaultCanvasDirectory,
    })
    if (!pickerResult) {
      return
    }
    const { path, mode } = pickerResult
    const blockId = await runCanvasEmbedCommand({
      canvasPath: path,
      mode,
      anchorEl: nodeElement ?? null,
      commandProtyle: protyle,
      fromSlash: Boolean(opts.fromSlash),
      targetNodeElement: nodeElement,
      targetBlockId: nodeElement?.getAttribute?.("data-node-id") || undefined,
      debugLog: (message, payload) => this.debugInsertCanvasEmbed(message, payload),
      getAllEditor: () => getAllEditor?.() ?? [],
      getFileText,
      getWorkspaceDir: async () => {
        const resp = await fetchSyncPost('/api/system/getConf', {})
        return resp?.data?.conf?.system?.workspaceDir
      },
      insertCanvasEmbed: (embedOptions) => insertCanvasEmbed({
        ...embedOptions,
        pluginName: this.name,
      }),
      insertCanvasLink,
      lastActiveProtyle: this.lastActiveProtyle,
      messages: {
        insertCanvasEmbedFailed: this.t("insertCanvasEmbedFailed"),
        insertCanvasEmbedNoDocument: this.t("insertCanvasEmbedNoDocument"),
        insertCanvasEmbedSuccess: this.t("insertCanvasEmbedSuccess"),
        insertCanvasLinkFailed: this.t("insertCanvasLinkFailed"),
        insertCanvasLinkSuccess: this.t("insertCanvasLinkSuccess"),
        messageUnableOpenCanvasFile: this.t("messageUnableOpenCanvasFile"),
      },
      showMessage,
    })

    if (blockId && protyle) {
      this.lastActiveProtyle = protyle!
    }
  }

  private debugInsertCanvasEmbed(message: string, payload: Record<string, unknown>): void {
    if (!this.canvasData.settings.enableDebugLog) {
      return
    }
    console.warn("[diskcanvas] insert canvas embed:", message, payload)
  }

  /**
   * 把插件数据写入 petal 目录。
   *
   * ★★★ 内容去重：值没变就绝不写盘 ★★★
   *
   * 这是自激循环的**第二道防线**（第一道是 `rememberRecentCanvas` 的幂等守卫）。
   * 真机实测证明：任何一次 `saveData()` → petal 写入，都会让思源向**所有前端
   * （含发起写入的本前端）**广播 `reloadPlugin`，进而重载插件本体、
   * 重建画布 Vue 应用 —— 视觉上就是「编辑器 和嵌入块 不稳定」的每 5 秒闪烁。
   *
   * 所以这里用「上一次真正写入的序列化快照」做比较：
   * 序列化结果一致 ⇒ 直接跳过，不产生任何网络写入、不触发任何广播。
   *
   * 只在 `saveData` **真正发生前后**维护快照（而非在修改内存对象时），
   * 这样「改了又改回去」也能被正确识别为「无变化」，不会漏写。
   */
  private lastPersistedSnapshot: string | null = null

  private async persistCanvasData(): Promise<void> {
    let snapshot: string
    try {
      snapshot = JSON.stringify(this.canvasData)
    } catch {
      // 序列化失败（不应发生）时退化为直接写，保证数据不丢
      snapshot = ""
    }

    if (snapshot && snapshot === this.lastPersistedSnapshot) {
      return
    }

    await this.saveData(STORAGE_KEY, this.canvasData)
    this.lastPersistedSnapshot = snapshot
  }

  private t(
    key: Parameters<ReturnType<typeof createCanvasI18n>>[0],
    replacements?: Record<string, number | string>,
  ): string {
    return createCanvasI18n((this as Plugin & { i18n?: Record<string, string> }).i18n)(key, replacements)
  }
}
