import type { CanvasColorThemeId } from "@/canvas/canvas-color-themes"
import type {
  CanvasBounds,
  CanvasDocument,
  CanvasEdge,
  CanvasFileNode,
  CanvasNodeLayoutAction,
  CanvasNode,
  CanvasSide,
  CanvasTextNode,
} from "@/canvas/types"
import type { CanvasTabBootstrap } from "@/main"
import type {
  CanvasPluginUiState,
  CanvasPluginSettings,
  CanvasRecentFile,
} from "@/canvas/plugin-data"
import type { ResolvedCanvasFileTarget } from "@/canvas/file-target-resolution"
import type { CanvasFileTargetPreview } from "@/canvas/file-target-preview"
import type { CanvasPluginBridge } from "@/canvas/use-canvas-editor-shared"
import type { CanvasEditorFileSource } from "@/canvas/use-canvas-editor-shared"

import {
  buildColorStyles,
  CANVAS_COLOR_THEMES,
  getColorThemeById,
} from "@/canvas/canvas-color-themes"
import {
  openTab,
  showMessage,
} from "siyuan"
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue"
import { resolveCanvasInteractionPolicy } from "@/canvas/canvas-interaction-policy"
import {
  putFile,
  readDir,
  removeFile,
} from "@/api"
import {
  createCanvasBoardMetrics,
  toBoardX,
  toBoardY,
} from "@/canvas/board"
import { clampViewportScale, scaleViewportAtPoint } from "@/canvas/viewport"
import {
  getCanvasSelectionBounds,
  setCanvasEdgeEndpoint,
  setCanvasNodeGeometry,
  upsertCanvasEdge,
  collapseCanvasGroup,
  expandCanvasGroup,
} from "@/canvas/document"
import { createCanvasEditorBindings } from "@/canvas/editor-bindings"
import { CanvasEditorState } from "@/canvas/editor-state"
import { CanvasHistoryStack, cloneCanvasDocument } from "@/canvas/canvas-history"
import { createCanvasEditorFileActions } from "@/canvas/use-canvas-editor-file-actions"
import { createCanvasEditorFilePickerActions } from "@/canvas/use-canvas-editor-file-picker"

import {
  createCanvasEditorGestureHandlers,
  type CanvasEditorAlignmentGuideState,
  type CanvasEditorConnectionDraftState,
  type CanvasEditorEdgeReconnectDraftState,
  type CanvasEditorSelectionBoxState,
} from "@/canvas/use-canvas-editor-gestures"
import { initializeCanvasEditor, syncCanvasEditorSelectionUi } from "@/canvas/use-canvas-editor-lifecycle"
import { createCanvasEditorNodeEdgeActions } from "@/canvas/use-canvas-editor-node-edge-actions"
import { createCanvasEditorKeyboardHandler } from "@/canvas/use-canvas-editor-shortcuts"
import { createCanvasEditorSelectionUi } from "@/canvas/use-canvas-editor-selection-ui"
import { createDebugLog } from "@/canvas/debug-log"
import {
  getCanvasFileName,
} from "@/canvas/use-canvas-editor-shared"
import {
  createDefaultCanvasPluginSettings,
  createDefaultCanvasPluginUiState,
} from "@/canvas/plugin-data"
import { CanvasFileService } from "@/canvas/file-service"
import {
  findSiyuanBlockById,
  findSiyuanDocumentByBlockId,
  findSiyuanBlocksByQuery,
  findSiyuanDocumentsByQuery,
  findSiyuanImageAssetByBlockId,
  findSiyuanImageAssetsByQuery,
} from "@/canvas/siyuan-kernel-file-node-lookups"
import {
  validateCanvasDocument,
} from "@/canvas/format"

import { createCanvasI18n } from "@/i18n/canvas"
import { getCanvasNodeAnchor } from "@/canvas/node-interaction"
import { SiyuanCanvasTextGateway } from "@/canvas/siyuan-text-gateway"
import { createCanvasBlockJumpHighlighter } from "@/canvas/block-jump-highlight"
import { BLOCK_NAVIGATION_ACTIONS } from "@/canvas/protyle-navigation"
import { createCanvasEditorWorkspaceTree } from "@/canvas/use-canvas-editor-workspace-tree"
import { createCanvasEditorFileNodeHelpers } from "@/canvas/use-canvas-editor-file-nodes"
import {
  collectCanvasSearchTargets,
  createCanvasSearchRevision,
  parseCanvasTargetId,
  registerCanvasSearchHost,
  replaceCanvasTextTargetRanges,
  type CanvasSearchDecoration,
} from "@/canvas/search-bridge"
// ▲ 说明（2026-09-28）：
//   上面这几个函数式导入**当前都没有调用点** —— 搜索集成在「只借用内核」的
//   裁剪中被移除了，只剩这一行 import。它们会产生 TS6133 未使用告警（既有问题，
//   与本次改动无关），但**不能顺手删掉整行**：`CanvasSearchDecoration` 仍在
//   下面第 160 行被使用（`ref<CanvasSearchDecoration[]>`）。
//   若要彻底清理，应连 `searchDecorations` 一起处理，属于独立的重构任务。
import {
  createEdgeCurvePath,
  getEdgeMidpointPosition,
} from "@/canvas/selection-toolbar"

const SIDES: CanvasSide[] = ["top", "right", "bottom", "left"]
/**
 * 调色板里可选的色键（顺序即 UI 展示顺序）。
 *
 * ★ 第 11 轮从 6 色扩到 12 色（用户 #16）★
 *   前 6 个键是**既有颜色**，顺序与取值都没动 ——
 *   老画布存的 `color: "3"` 必须继续解析成同一个颜色。
 *   新增的 7..12 追加在末尾。
 */
const SELECTION_COLORS = [
  "1", "2", "3", "4", "5", "6",
  "7", "8", "9", "10", "11", "12",
] as const

/**
 * 提供「页签打开网盘文件」能力的插件注册名。
 *
 * ★ 为什么是硬编码字符串 ★
 *   这是**对方插件的身份**，不是本插件可配置项 —— 它写在对方的 plugin.json 里，
 *   在思源里是稳定标识（用户改不了）。写成常量便于全局检索与说明来由，
 *   但不适合做成设置项（用户改了只会坏事）。
 */
const NEBULA_PLUGIN_NAME = "siyuan-nebuladisk"

export function useCanvasEditor(
  plugin: CanvasPluginBridge,
  bootstrap: CanvasTabBootstrap,
  setTitle: (title: string) => void,
) {
  const t = createCanvasI18n(plugin.i18n)
  const blockJumpHighlighter = createCanvasBlockJumpHighlighter(plugin)
  const fileService = new CanvasFileService(new SiyuanCanvasTextGateway())
  const state = reactive(new CanvasEditorState(fileService))
  const history = new CanvasHistoryStack({ capacity: 100 })
  // Vue 反应式不能感知 class 内部状态，这里靠版本号触发 canUndo/canRedo 的 computed 重算
  const historyVersion = ref(0)
  const isSaving = ref(false)
  const viewport = reactive({
    scale: 1,
    x: 0,
    y: 0,
  })
  const fileInputRef = ref<HTMLInputElement>()
  const fileNodeMeta = ref<Record<string, ResolvedCanvasFileTarget & {
    detail: string
    excerptHtml?: string
    imageSrc?: string
    thumbnail?: CanvasFileTargetPreview["thumbnail"]
  }>>({})
  const isBootstrapLocal = bootstrap.path ? (/^[a-zA-Z]:[/\\]/.test(bootstrap.path) || /^[/\\]+[a-zA-Z]:/.test(bootstrap.path) || bootstrap.path.startsWith("file://")) : false
  const fileSource = ref<CanvasEditorFileSource>(bootstrap.path ? (isBootstrapLocal ? "local" : "workspace") : "unsaved")
  const stageRef = ref<HTMLElement>()
  const searchDecorations = ref<CanvasSearchDecoration[]>([])
  const recentFiles = ref<CanvasRecentFile[]>([])
  const colorThemeId = ref<CanvasColorThemeId>(
    getPluginSettings().colorTheme ?? "classic",
  )
  const settingsVersion = ref(0)
  const currentColorStyles = computed(() =>
    buildColorStyles(getColorThemeById(colorThemeId.value)),
  )

  const workspaceTree = (plugin as any)?.getOrCreateWorkspaceTree
    ? (plugin as any).getOrCreateWorkspaceTree()
    : ((plugin as any)?.workspaceTree ?? createCanvasEditorWorkspaceTree({
        readDir: (path) => readDir(path) as Promise<Array<{ name: string, isDir: boolean, updated?: number }>>,
        putFile,
        removeFile,
        showMessage,
        getSettings: getPluginSettings,
        plugin,
        refreshRecentFiles,
        onFilePathUpdate: (path) => { state.filePath = path },
        labels: {
          copyTitle: t("contextMenuCopy"),
          deleteCanvasDescription: path => t("workspaceDeleteCanvasDescription", { path }),
          deleteCanvasTitle: t("workspaceDeleteCanvasTitle"),
          deleteFolderDescription: name => t("workspaceDeleteFolderDescription", { name }),
          deleteFolderTitle: t("contextMenuDeleteFolderConfirm"),
          dialogCancel: t("dialogCancel"),
          dialogConfirm: t("dialogConfirm"),
          fileAlreadyExistsMessage: t("messageFileAlreadyExists"),
          folderNameTitle: t("workspaceFolderNameTitle"),
          messageFileCopied: name => t("workspaceFileCopied", { name }),
          messageFileMoved: (name, folder) => t("messageFileMoved", { folder, name }),
          messageFileRenamed: name => t("messageFileRenamed", { name }),
          messageFolderRenamed: name => t("workspaceFolderRenamed", { name }),
          newFolderMessage: name => t("workspaceNewFolder", { name }),
          notAvailableInBrowserMessage: t("workspaceNotAvailableInBrowser"),
          renameFolderTitle: t("workspaceRenameFolderTitle"),
          renameTitle: t("contextMenuRename"),
          unableToCopyFileMessage: t("workspaceUnableCopyFile"),
          unableToGetWorkspacePathMessage: t("workspaceUnableGetWorkspacePath"),
          unableToMoveFileMessage: t("messageUnableMoveFile"),
          unableToOpenFolderMessage: t("workspaceUnableOpenFolder"),
          unableToRenameFileMessage: t("messageUnableRenameFile"),
          unableToRenameFolderMessage: t("workspaceUnableRenameFolder"),
          unableToSaveMessage: t("messageUnableSaveCanvas"),
          untitledCanvas: t("untitledCanvas"),
        },
      }))

  const suggestedFilename = ref(bootstrap.title || t("untitledCanvas"))
  const floatLayerActive = ref(false)
  const bottomToolbarVisible = ref(false)
  const createEdgeDialog = reactive({
    visible: false,
  })
  const filePickerDialog = reactive({
    groups: {
      blocks: [] as CanvasFilePickerOption[],
      canvases: [] as CanvasFilePickerOption[],
      documents: [] as CanvasFilePickerOption[],
      images: [] as CanvasFilePickerOption[],
    },
    query: "",
    visible: false,
  })
  const inspectorSectionState = reactive({
    ...(
      plugin.getCanvasUiState?.().inspectorSections
      ?? createDefaultCanvasPluginUiState().inspectorSections
    ),
  })
  const selectionBox = reactive<CanvasEditorSelectionBoxState>({
    height: 0,
    visible: false,
    width: 0,
    x: 0,
    y: 0,
  })
  const alignmentGuides = reactive<CanvasEditorAlignmentGuideState>({
    guides: [],
    visible: false,
  })
  const connectionDraft = reactive<CanvasEditorConnectionDraftState>({
    fromNodeId: "",
    fromSide: "right" as CanvasSide,
    toNodeId: "",
    toSide: "left" as CanvasSide,
    toX: 0,
    toY: 0,
    visible: false,
  })
  const edgeReconnectDraft = reactive<CanvasEditorEdgeReconnectDraftState>({
    edgeId: "",
    endpoint: "",
    targetNodeId: "",
    targetSide: "",
    toX: 0,
    toY: 0,
    visible: false,
  })
  const newEdgeFromSide = ref<CanvasSide>("right")
  const newEdgeLabel = ref("")
  const newEdgeSourceId = ref("")
  const newEdgeSourceQuery = ref("")
  const newEdgeTargetId = ref("")
  const newEdgeTargetQuery = ref("")
  const newEdgeToSide = ref<CanvasSide>("left")
  const inspectorExpanded = ref(true)
  const editingEdgeLabelId = ref("")
  const edgeLabelDraft = ref("")

  const displayNodes = computed(() =>
    [...state.document.nodes].sort((left, right) => {
      if (left.type === right.type) {
        return 0
      }

      return left.type === "group" ? -1 : 1
    }),
  )
  const nodeMap = computed(() => {
    const map = new Map<string, CanvasNode>()
    for (const node of state.document.nodes) {
      map.set(node.id, node)
    }
    return map
  })
  const selectedNode = computed(
    () => (state.selectedNodeId ? nodeMap.value.get(state.selectedNodeId) || null : null),
  )
  const selectedNodeCount = computed(() => state.selectedNodeIds.length)
  const canRefreshSelectedSiyuanNode = computed(() => {
    if (selectedNodeCount.value !== 1 || selectedNode.value?.type !== 'file') {
      return false
    }

    const resolved = getResolvedFileNode(selectedNode.value)
    return resolved.kind === 'block'
      || resolved.kind === 'document'
      || (resolved.kind === 'image' && Boolean(resolved.blockId))
  })
  const canDecomposeSelectedDocument = computed(() => {
    if (selectedNodeCount.value !== 1) {
      return false
    }

    if (selectedNode.value?.type === 'text') {
      return true
    }

    if (selectedNode.value?.type === 'file') {
      return getResolvedFileNode(selectedNode.value).kind === 'document'
    }

    return false
  })
  const canRelayoutConnectedNodes = computed(() => {
    if (selectedNodeCount.value !== 1 || !selectedNode.value) {
      return false
    }
    return state.document.edges.some(
      e => e.fromNode === selectedNode.value!.id || e.toNode === selectedNode.value!.id,
    )
  })
  const selectedEdge = computed(
    () => state.document.edges.find((edge) => edge.id === state.selectedEdgeId) || null,
  )
  const selectionBounds = computed<CanvasBounds | null>(() =>
    getCanvasSelectionBounds(state.document, state.selectedNodeIds),
  )
  const edgeSourceNode = computed(
    () => state.document.nodes.find((node) => node.id === newEdgeSourceId.value) || null,
  )
  const edgeTargets = computed(() =>
    filterEdgeNodeOptions(
      state.document.nodes.filter((node) => node.id !== newEdgeSourceId.value),
      newEdgeTargetQuery.value,
    ),
  )
  const edgeSources = computed(() =>
    filterEdgeNodeOptions(state.document.nodes, newEdgeSourceQuery.value),
  )
  const board = computed(() => createCanvasBoardMetrics(state.document.nodes))
  const canDelete = computed(() => Boolean(state.selectedNodeIds.length || selectedEdge.value))
  const {
    closeEdgePopover,
    closeSelectionPopover,
    edgeToolbar,
    edgeToolbarPopover,
    selectedEdgeAnchors,
    selectedEdgeHandlePositions,
    selectionToolbar,
    selectionToolbarPopover,
    setEdgeToolbarSize,
    setSelectionToolbarSize,
  } = createCanvasEditorSelectionUi({
    board,
    getCanvasNodeAnchor,
    getNodeById: (id: string) => nodeMap.value.get(id),
    selectedEdge,
    selectionBounds,
    stageRef,
    state,
    viewport,
  })
  const selectedEdgeDirectionMode = computed<"both" | "none" | "single">(() => {
    if (!selectedEdge.value) {
      return "single"
    }

    const startArrow = selectedEdge.value.startArrow ?? false
    const endArrow = selectedEdge.value.endArrow ?? true

    if (startArrow && endArrow) {
      return "both"
    }

    if (!startArrow && !endArrow) {
      return "none"
    }

    return "single"
  })
  const edgeLabelEditorPosition = computed(() => {
    const edge = state.document.edges.find((candidate) => candidate.id === editingEdgeLabelId.value)
    if (!edge) {
      return null
    }

    const fromNode = state.document.nodes.find((node) => node.id === edge.fromNode)
    const toNode = state.document.nodes.find((node) => node.id === edge.toNode)
    const stage = stageRef.value
    if (!fromNode || !toNode || !stage) {
      return null
    }

    const midpoint = getEdgeMidpointPosition(
      {
        x: toBoardX(board.value, getCanvasNodeAnchor(fromNode, edge.fromSide).x),
        y: toBoardY(board.value, getCanvasNodeAnchor(fromNode, edge.fromSide).y),
      },
      edge.fromSide,
      {
        x: toBoardX(board.value, getCanvasNodeAnchor(toNode, edge.toSide).x),
        y: toBoardY(board.value, getCanvasNodeAnchor(toNode, edge.toSide).y),
      },
      edge.toSide,
    )

    return {
      x: midpoint.x * viewport.scale + viewport.x,
      y: midpoint.y * viewport.scale + viewport.y,
    }
  })
  const selectionColors = computed(() => [...SELECTION_COLORS])
  const selectionLayoutActions = computed<Array<{ action: CanvasNodeLayoutAction, label: string }>>(() => [
    { action: "left-align", label: t("layoutLeftAlign") },
    { action: "center-horizontal", label: t("layoutCenterHorizontal") },
    { action: "right-align", label: t("layoutRightAlign") },
    { action: "top-align", label: t("layoutTopAlign") },
    { action: "center-vertical", label: t("layoutCenterVertical") },
    { action: "bottom-align", label: t("layoutBottomAlign") },
    { action: "arrange-row", label: t("layoutArrangeRow") },
    { action: "arrange-column", label: t("layoutArrangeColumn") },
    { action: "arrange-grid", label: t("layoutArrangeGrid") },
    { action: "distribute-horizontal", label: t("layoutDistributeHorizontal") },
    { action: "distribute-vertical", label: t("layoutDistributeVertical") },
    { action: "stretch-horizontal", label: t("layoutStretchHorizontal") },
    { action: "stretch-vertical", label: t("layoutStretchVertical") },
  ])
  const getFileName = getCanvasFileName

  function getPluginSettings(): CanvasPluginSettings {
    return plugin.getCanvasSettings?.() ?? createDefaultCanvasPluginSettings()
  }

  function getReactivePluginSettings(): CanvasPluginSettings {
    void settingsVersion.value
    return getPluginSettings()
  }

  function filterEdgeNodeOptions(nodes: CanvasNode[], query: string) {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return nodes
    }

    return nodes.filter((node) => {
      const title = getNodeTitle(node).toLowerCase()
      return title.includes(normalizedQuery) || node.id.toLowerCase().includes(normalizedQuery)
    })
  }

  function refreshRecentFiles() {
    recentFiles.value = plugin.getRecentCanvasFiles?.() ?? []
  }

  async function setColorTheme(themeId: CanvasColorThemeId) {
    colorThemeId.value = themeId
    await plugin.updateCanvasSettings?.({ colorTheme: themeId })
  }

  /**
   * ★ 已删除：notifyCanvasSearchChanged()（2026-09-28）★
   *
   *   原实现是 `searchListeners.forEach(listener => listener())`，
   *   但 `searchListeners` 这个数组**从未被定义过** ——
   *   搜索集成（search-bridge 的 registerCanvasSearchHost / subscribe）在
   *   「只借用内核」的裁剪中被移除，却留下了这个引用。
   *
   *   后果不是"没反应"，而是**每次文档提交都抛未捕获异常**：
   *     ReferenceError: searchListeners is not defined
   *   它在 commitDocument/patchDocument 链路里同步抛出，
   *   会把调用方在该点之后的逻辑一并中断。
   *   实测（CDP 真机）在打开文档时稳定复现。
   *
   *   因为注册搜索 host 的代码同样已被移除（registerCanvasSearchHost 无调用点），
   *   即使补一个空数组也永远是空转 ⇒ 直接移除函数与调用点，
   *   而不是留一个"看起来在通知、实际没人订阅"的空壳。
   */

  function handleExternalSettingsChange() {
    settingsVersion.value += 1
    const settings = getPluginSettings()
    if (settings.colorTheme && settings.colorTheme !== colorThemeId.value) {
      colorThemeId.value = settings.colorTheme
    }
  }

  function activateCanvasSurface() {
    bottomToolbarVisible.value = true
  }

  function deactivateCanvasSurface() {
    bottomToolbarVisible.value = false
  }

  async function expandAllInspectorSections() {
    const allKeys = Object.keys(inspectorSectionState) as Array<keyof typeof inspectorSectionState>
    for (const key of allKeys) {
      inspectorSectionState[key] = true
    }
    await plugin.updateCanvasUiState?.({
      inspectorSections: {
        createEdge: true,
        document: true,
        edge: true,
        node: true,
        nodeEdges: true,
        recent: true,
        selection: true,
      },
    })
    if (workspaceTree.allFoldersExpanded.value) {
      workspaceTree.collapseAllFolders()
    } else {
      workspaceTree.expandAllFolders()
    }
  }

  function removeRecentFileRecord(path: string) {
    return workspaceTree.removeRecentFileRecord(path)
  }

  async function openDocumentAtBlock(blockId: string, documentId?: string) {
    blockJumpHighlighter.requestBlockHighlight(blockId)
    if (blockId) {
      await openTab({
        app: plugin.app,
        doc: {
          action: BLOCK_NAVIGATION_ACTIONS,
          id: blockId,
        },
        keepCursor: false,
        openNewTab: true,
      })
    }
  }

  async function refreshSelectedSiyuanNode() {
    const node = selectedNode.value
    if (!canRefreshSelectedSiyuanNode.value || !node || node.type !== 'file') {
      return
    }

    try {
      await refreshFileNodeMetadata([node.id])

      // 等待 DOM 挂载和微任务渲染（如 Mermaid SVG / ECharts / Markdown）
      await nextTick()

      /**
       * ★★ 刷新**只更新内容，不改节点尺寸**（第 21 轮）★★
       *
       * 用户反馈了两轮：「按卡片刷新时，卡片尺寸会变大，刷新一次大一次」。
       *
       * 曾经这里会调用内容测量函数、把量出来的宽高回写进节点。那条链路本身是
       * **自反馈**：量的是"被卡片拉伸后的元素"，而结果又用来改卡片尺寸，
       * 于是每一轮都在原尺寸上再加一遍 padding/header（实测每轮 +31~60px）。
       * 试过连续修三处取数（scrollHeight 的下限、宽度自推、offsetTop 的 offsetParent），
       * 都没有归零 —— 只要"刷新 = 回写尺寸"还在，就总有个细节把尺寸往一边推。
       *
       * ⇒ 直接**从结构上拿掉这条链路**（连带删除了已无任何引用的内容测量模块）。
       *
       * 理由：**刷新按钮的职责是「重新读取笔记内容」，不是「重新排版卡片」**。
       *   · 卡片尺寸本就该由用户拖拽决定；
       *   · 内容变多时卡片内部本来就能滚动，不需要替用户改尺寸；
       *   · 拿掉后，这类自反馈增长从结构上不可能再发生。
       *
       * `refreshFileNodeMetadata` 已经完成了"刷新内容"这件事。
       */
      await nextTick()
      // 短暂延时确保原生渲染器（如 Mermaid / ECharts 直绘）微任务执行完毕，
      // 让新内容完整呈现即可；**尺寸保持不动**。
      await new Promise(resolve => setTimeout(resolve, 60))
    } catch {
      showMessage(t('messageUnableRefreshSiyuanNode'), 4000, 'error')
    }
  }

  watch(
    () => [state.filePath, state.isDirty, suggestedFilename.value],
    () => {
      const title = getFileName(state.filePath) || suggestedFilename.value || t("untitledCanvas")
      setTitle(`${state.isDirty ? "● " : ""}${title}`)
    },
    { immediate: true },
  )

  const {
    getFileNodeDescription,
    getFileNodeKind,
    getFileNodePreview,
    getNodeTitle,
    getResolvedFileNode,
    refreshFileNodeMetadata,
  } = createCanvasEditorFileNodeHelpers({
    fileNodeMeta,
    state,
    t,
  })

  function getNodeStyle(node: CanvasNode) {
    return {
      height: `${node.height}px`,
      width: `${node.width}px`,
      transform: `translate(${toBoardX(board.value, node.x)}px, ${toBoardY(board.value, node.y)}px)`,
    }
  }

  function getAnchor(node: CanvasNode, side: CanvasSide) {
    const anchor = getCanvasNodeAnchor(node, side)
    return {
      x: toBoardX(board.value, anchor.x),
      y: toBoardY(board.value, anchor.y),
    }
  }

  function getEdgePath(edge: CanvasEdge): string {
    const fromNode = nodeMap.value.get(edge.fromNode)
    const toNode = nodeMap.value.get(edge.toNode)
    if (!fromNode || !toNode) {
      return ""
    }

    const from = getAnchor(fromNode, edge.fromSide)
    const to = getAnchor(toNode, edge.toSide)
    return createEdgeCurvePath(from, edge.fromSide, to, edge.toSide)
  }

  function getEdgeLabelPosition(edge: CanvasEdge) {
    const fromNode = nodeMap.value.get(edge.fromNode)
    const toNode = nodeMap.value.get(edge.toNode)
    if (!fromNode || !toNode) {
      return {
        x: 0,
        y: 0,
      }
    }

    const from = getAnchor(fromNode, edge.fromSide)
    const to = getAnchor(toNode, edge.toSide)
    return getEdgeMidpointPosition(from, edge.fromSide, to, edge.toSide)
  }

  function resetViewport() {
    const stage = stageRef.value
    if (!stage || state.document.nodes.length === 0) {
      viewport.scale = 1
      viewport.x = 0
      viewport.y = 0
      return
    }

    const minX = Math.min(...state.document.nodes.map((node) => node.x))
    const minY = Math.min(...state.document.nodes.map((node) => node.y))
    const maxX = Math.max(...state.document.nodes.map((node) => node.x + node.width))
    const maxY = Math.max(...state.document.nodes.map((node) => node.y + node.height))
    const contentWidth = maxX - minX
    const contentHeight = maxY - minY
    const centerX = toBoardX(board.value, (minX + maxX) / 2)
    const centerY = toBoardY(board.value, (minY + maxY) / 2)

    const padding = 0.9
    const fitScale = Math.min(
      (stage.clientWidth * padding) / contentWidth,
      (stage.clientHeight * padding) / contentHeight,
      1,
    )
    const scale = clampViewportScale(Number(fitScale.toFixed(2)))
    viewport.scale = scale
    viewport.x = stage.clientWidth / 2 - centerX * scale
    viewport.y = stage.clientHeight / 2 - centerY * scale
  }

  function commitDocument(nextDocument: CanvasDocument, options: { coalesceKey?: string } = {}) {
    /**
     * ★ 只读（含嵌入模式）下**禁止任何文档变更** ★
     *
     * 这里是全部 39 处编辑入口的**唯一收口**：工具栏按钮（新建节点/撤销/重做）、
     * 键盘快捷键、拖拽、连线、拖放、右键菜单……最终都要经过它。
     * 在这一点拦住，就不必逐个去给几十个 action 加守卫
     * （逐个加必漏，漏掉的那个就是「明明只读却还能改」的漏洞）。
     *
     * 为什么必须有：实测顶部工具栏**没有任何 readonly 判断**
     * （template 里 `.canvas-toolbar` 下一处都没有），
     * 嵌入块里点「+」「撤销」会真的改动内存中的画布 ——
     * 与用户要求「就是不能编辑具体内容」直接冲突。
     *
     * 为什么不会挡住加载：实测加载/初始化路径用的是 state.patchDocument，
     * 39 处 commitDocument 调用点里没有一处来自 lifecycle/load。
     *
     * 为什么能力在下面才声明也没问题：本函数仅在用户操作时被调用，
     * 那时 setup 主体早已执行完、`capabilities` 已初始化（不是 TDZ 场景）。
     */
    if (!capabilities.value.editDocument) {
      return
    }

    // 采用惰性快照：仅在需要产生新的历史记录步时才执行 cloneCanvasDocument 全量深拷贝
    const didRecord = history.recordLazy(
      () => ({
        document: cloneCanvasDocument(state.document),
        selectedNodeIds: [...state.selectedNodeIds],
        selectedNodeId: state.selectedNodeId,
        selectedEdgeId: state.selectedEdgeId,
      }),
      { coalesceKey: options.coalesceKey },
    )
    if (didRecord) {
      historyVersion.value++
    }
    state.patchDocument(nextDocument)
    // 连续拖拽的中间帧跳过全量规范校验与搜索更新，消除多余的 CPU 消耗
    if (didRecord || !options.coalesceKey) {
      state.issues = validateCanvasDocument(nextDocument)
    }
  }

  function toggleGroupCollapse(nodeId: string) {
    const node = state.document.nodes.find((n) => n.id === nodeId && n.type === "group") as CanvasGroupNode
    if (!node) {
      return
    }

    let nextDocument: CanvasDocument
    if (node.collapsed) {
      nextDocument = expandCanvasGroup(state.document, nodeId)
    } else {
      nextDocument = collapseCanvasGroup(state.document, nodeId)
    }

    // 处理选中状态的清理
    const childNodeIds = node.collapsedNodes?.map((n) => n.id) || []
    let nextSelectedNodeIds = [...state.selectedNodeIds]
    let nextSelectedNodeId = state.selectedNodeId

    if (nextSelectedNodeIds.some((id) => childNodeIds.includes(id))) {
      nextSelectedNodeIds = nextSelectedNodeIds.filter((id) => !childNodeIds.includes(id))
      if (childNodeIds.includes(nextSelectedNodeId)) {
        nextSelectedNodeId = nodeId
      }
    }

    // 提交前，我们可以临时修改选中状态，以便 commitDocument 在记录历史时使用正确的选中状态
    state.selectedNodeIds = nextSelectedNodeIds
    state.selectedNodeId = nextSelectedNodeId

    commitDocument(nextDocument)
  }

  function applyHistorySnapshot(snapshot: ReturnType<typeof cloneCanvasDocument> extends infer _T ? import("@/canvas/canvas-history").CanvasHistorySnapshot : never) {
    state.document = snapshot.document
    state.selectedNodeIds = [...snapshot.selectedNodeIds]
    state.selectedNodeId = snapshot.selectedNodeId
    state.selectedEdgeId = snapshot.selectedEdgeId
    state.isDirty = true
    state.issues = validateCanvasDocument(snapshot.document)
  }

  function undo() {
    const current = {
      document: cloneCanvasDocument(state.document),
      selectedNodeIds: [...state.selectedNodeIds],
      selectedNodeId: state.selectedNodeId,
      selectedEdgeId: state.selectedEdgeId,
    }
    const previous = history.undo(current)
    if (!previous) {
      return
    }
    applyHistorySnapshot(previous)
    historyVersion.value++
  }

  function redo() {
    const current = {
      document: cloneCanvasDocument(state.document),
      selectedNodeIds: [...state.selectedNodeIds],
      selectedNodeId: state.selectedNodeId,
      selectedEdgeId: state.selectedEdgeId,
    }
    const next = history.redo(current)
    if (!next) {
      return
    }
    applyHistorySnapshot(next)
    historyVersion.value++
  }

  function duplicateSelection() {
    if (state.selectedNodeIds.length === 0) {
      return
    }
    const idMap = new Map<string, string>()
    const offset = 24
    const newNodes: CanvasNode[] = []
    for (const node of state.document.nodes) {
      if (!state.selectedNodeIds.includes(node.id)) {
        continue
      }
      const newId = `${node.id}-copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      idMap.set(node.id, newId)
      newNodes.push({
        ...cloneCanvasDocument({ nodes: [node], edges: [] }).nodes[0],
        id: newId,
        x: node.x + offset,
        y: node.y + offset,
      } as CanvasNode)
    }
    if (newNodes.length === 0) {
      return
    }

    const nextDocument: CanvasDocument = {
      ...state.document,
      nodes: [...state.document.nodes, ...newNodes],
    }
    commitDocument(nextDocument)
    state.selectNodes([...idMap.values()])
  }

  function zoomToActualSize() {
    const stage = stageRef.value
    if (!stage) {
      viewport.scale = 1
      return
    }
    const rect = stage.getBoundingClientRect()
    const center = { x: rect.width / 2, y: rect.height / 2 }
    const nextViewport = scaleViewportAtPoint(viewport, center, 1)
    viewport.scale = nextViewport.scale
    viewport.x = nextViewport.x
    viewport.y = nextViewport.y
  }

  function zoomToFit() {
    resetViewport()
  }

  function closeFloatLayer() {
    const panels = (window as any).siyuan?.blockPanels
    if (Array.isArray(panels)) {
      for (const panel of [...panels]) {
        panel.destroy?.()
      }
    }
    floatLayerActive.value = false
  }

  const debugLog = createDebugLog(getPluginSettings)

  function showFloatLayerForSelection() {
    const node = selectedNode.value
    if (!node || node.type !== 'file') {
      debugLog('float layer skipped: no file node selected')
      return
    }

    const meta = fileNodeMeta.value[node.id]
    if (!meta) {
      debugLog('float layer skipped: no meta for node', node.id)
      return
    }

    let refID: string | undefined
    if (meta.kind === 'block') {
      refID = meta.id
    } else if (meta.kind === 'document') {
      refID = meta.id
    } else if (meta.kind === 'image' && meta.blockId) {
      refID = meta.blockId
    }
    if (!refID) {
      debugLog('float layer skipped: no refID for kind', meta.kind)
      return
    }

    debugLog('showFloatLayer', { refID, kind: meta.kind })
    closeFloatLayer()

    const stage = stageRef.value
    const targetElement = stage?.querySelector(`[data-canvas-node-id="${node.id}"]`) as HTMLElement | undefined
    plugin.addFloatLayer({
      refDefs: [{ refID }],
      isBacklink: false,
      ...(targetElement ? { targetElement } : {}),
    })
    floatLayerActive.value = true
  }

  const {
    ensureCanvasPath,
    exportCanvas,
    exportCanvasPng,
    importCanvas,
    reloadFromDisk,
    loadConflictVersion,
    newCanvas,
    openPath,
    openRecentFile,
    openRecentPath,
    openSettings,
    openWorkspacePath,
    overwriteConflictVersion,
    rememberRecentPath,
    save: saveImpl,
    silentSave: silentSaveImpl,
    triggerImport,
  } = createCanvasEditorFileActions({
    board,
    fileInputRef,
    fileSource,
    getPluginSettings,
    plugin,
    refreshRecentFiles,
    refreshWorkspaceDocuments: workspaceTree.refreshWorkspaceDocuments,
    resetViewport,
    stageRef,
    state,
    suggestedFilename,
    t,
    viewport,
  })

  /**
   * 保存包装：维护 isSaving 标志，让顶栏徽标可以呈现 saving 态。
   * 同时在打开新文件 / 新建画布时清空历史栈，避免跨文档 undo 出诡异结果。
   */
  let saveInFlight = false

  async function save() {
    // ★ 嵌入实例绝不写盘 ★
    //   同一条 .canvas 可能正被页签实例打开；嵌入实例若也保存，
    //   两者会互相覆盖（后写的赢），用户会看到「画布内容莫名回退」。
    //   只读下 isDirty 不会变真、自动保存本就不会触发，但 Ctrl+S 仍能走到这里
    //   （快捷键处理不看只读标志），所以必须显式挡掉。
    //
    //   ★ 用 capabilities.persist 而不是 capabilities.editDocument ★
    //     写盘能力**只**受 embed 影响：冲突态必须仍能保存（否则用户没法解决冲突），
    //     移动端也必须能保存。详见 canvas-interaction-policy.ts 的能力矩阵。
    if (!capabilities.value.persist) {
      return
    }
    if (saveInFlight) {
      return
    }
    saveInFlight = true
    isSaving.value = true
    try {
      await saveImpl()
    } finally {
      isSaving.value = false
      saveInFlight = false
    }
  }

  /**
   * 静默保存包装：不弹对话框直接写入当前文件路径。
   * 与手动保存不同，这里不翻转 isSaving（静默保存不应触发顶栏「保存中」状态切换），
   * 仅用非响应式的 saveInFlight 守卫并发，避免任何响应式状态抖动引起画布重渲染闪烁。
   */
  async function silentSave() {
    // 同上：嵌入实例不写盘（＝ capabilities.persist === false）
    if (!capabilities.value.persist) {
      return
    }
    if (saveInFlight) {
      return
    }
    saveInFlight = true
    try {
      await silentSaveImpl()
    } finally {
      saveInFlight = false
    }
  }

  function clearHistory() {
    history.clear()
    historyVersion.value++
  }

  let focusNodeByIdFn: (id: string) => void

  // 跟踪 filePath 变化（newCanvas / open* 都会改 filePath），切换文档时清空历史
  watch(
    () => state.filePath,
    () => {
      clearHistory()
    },
  )

  const canUndo = computed(() => {
    // 读 historyVersion 触发重算
    void historyVersion.value
    return history.canUndo
  })
  const canRedo = computed(() => {
    void historyVersion.value
    return history.canRedo
  })
  /**
   * 嵌入模式（笔记正文里的自定义块）。
   *
   * 关于位置：它声明在 save/silentSave **之后**，看似有 TDZ 风险 —— 实际没有：
   * 那两个是函数声明（提升），只在被**调用**时才读这个变量，而调用发生在
   * 用户操作/自动保存时，那时 setup 主体早已执行完、赋值已完成。
   */
  const isEmbedMode = Boolean(bootstrap.embed)

  /**
   * ★★★ 交互能力策略 —— 所有只读守卫的**单一事实来源** ★★★
   *
   * 把三个原始信号（文档冲突 / 移动端 / 嵌入预览）解析成一组**具名能力**，
   * 见 `canvas-interaction-policy.ts` 的完整能力矩阵。
   *
   * 改造前这里是：
   *   `const readonly = computed(() => Boolean(state.conflict || plugin.isMobile || isEmbedMode))`
   * 一个布尔被 15 处守卫各自解读，语义靠注释约定 —— 漏一处就出 bug。
   *
   * 现在：守卫一律查 `capabilities.value.xxx`，名字即语义。
   *
   * ★ 预览态（嵌入）的能力，与用户要求逐条对应 ★
   *   保留（恒为 true，不受只读影响）：
   *     · 滚轮缩放      → capabilities.zoom（handleStageWheel 本就不看只读标志）
   *     · 右键按住平移  → capabilities.pan （startPan 的 `button === 2` 分支
   *                                        刻意放在所有只读判断**之前**）
   *   禁止（预览下为 false）：
   *     · 改文档（拖拽/改尺寸/连线/改端点）→ capabilities.editDocument
   *     · 选中节点/连线（选中环、端点手柄）→ capabilities.select
   *     · 空白左键框选                      → capabilities.marquee
   *     · 空白双击新建                      → capabilities.createByDoubleClick
   *     · 渲染连线点与缩放手柄              → capabilities.renderNodeHandles
   *     · 双击卡片打开页签                  → capabilities.openNodeTab
   *     · 写盘                              → capabilities.persist
   */
  const interactionPolicy = computed(() => resolveCanvasInteractionPolicy({
    conflict: Boolean(state.conflict),
    mobile: Boolean(plugin.isMobile),
    embed: isEmbedMode,
  }))
  /** 具名能力集（守卫查这个）。 */
  const capabilities = computed(() => interactionPolicy.value.capabilities)
  /** 是否存在任一"只读来源"。保留旧语义，便于尚未迁移的调用点平滑过渡。 */
  const readonly = computed(() => interactionPolicy.value.readonly)

  const {
    addNode,
    addNodeAtPosition,
    applyEdgeColor,
    applyEdgeLineStyle,
    applySelectedNodeAsEdgeSource,
    applySelectionColor,
    applySelectionLineStyle,
    applySelectionLayout,
    cancelEdgeLabelEditing,
    centerEdgeInViewport,
    centerSelectionInViewport,
    focusNodeById,
    closeCreateEdgeDialog,
    createEdgeFromSelection,
    createMindMapChildNode,
    createMindMapSiblingNode,
    createGroupFromSelection,
    deleteSelection,
    getRenderedMarkdown,
    isRelayouting,
    openCreateEdgeDialog,
    relayoutConnectedNodes,
    selectEdge,
    selectNode,
    setNewEdgeSourceId,
    setNewEdgeTargetId,
    startEdgeLabelEditing,
    submitCreateEdgeDialog,
    submitEdgeLabelEditing,
    toggleEdgePopover,
    toggleSelectionPopover,
    updateEdgeField,
    updateEdgeSide,
    applySelectedNodeChanges,
    updateEditingEdgeLabel,
    updateNodeField,
    updateNumericNodeField,
    updateSelectedNodeZIndex,
    moveSelectedNodeZIndex,
    moveSelectedNodeToBottom,
    moveSelectedNodeToTop,
    updateSelectedEdgeDirection,
    updateTextNodeContent,
    zoomIn,
    zoomOut,
    convertTextToLink,
    convertLinkToText,
    sproutLoading,
    sproutRelations,
    loadSproutRelations,
    toggleSproutItemSelect,
    setAllSproutItemsSelected,
    executeSprout,
  } = createCanvasEditorNodeEdgeActions({
    state,
    commitDocument,
    t,
    geometry: {
      board,
      viewport,
      stageRef,
    },
    selectionUI: {
      closeEdgePopover,
      closeSelectionPopover,
      edgeLabelDraft,
      editingEdgeLabelId,
      edgeToolbarPopover,
      selectedEdge,
      selectedEdgeAnchors,
      selectedNode,
      selectionBounds,
      selectionToolbarPopover,
    },
    createEdgeForm: {
      dialog: createEdgeDialog,
      fromSide: newEdgeFromSide,
      label: newEdgeLabel,
      sourceId: newEdgeSourceId,
      sourceQuery: newEdgeSourceQuery,
      targetId: newEdgeTargetId,
      targetQuery: newEdgeTargetQuery,
      toSide: newEdgeToSide,
    },
    activateCanvasSurface,
    fileFieldRefresh: refreshFileNodeMetadata,
    getSettings: getPluginSettings,
  })

  focusNodeByIdFn = focusNodeById

  const {
    closeFilePickerDialog,
    handleClipboardImagePaste,
    insertNebulaFileNode,
    insertSiyuanAssetNode,
    openFilePickerDialog,
    selectFilePickerResult,
    updateFilePickerQuery,
  } = createCanvasEditorFilePickerActions({
    board,
    commitDocument,
    filePickerDialog,
    fileSource,
    refreshFileNodeMetadata,
    resolveBlockById: findSiyuanBlockById,
    resolveBlocksByQuery: findSiyuanBlocksByQuery,
    resolveDocumentByBlockId: findSiyuanDocumentByBlockId,
    resolveDocumentsByQuery: findSiyuanDocumentsByQuery,
    resolveImageAssetByBlockId: findSiyuanImageAssetByBlockId,
    resolveImageAssetsByQuery: findSiyuanImageAssetsByQuery,
    selectNode,
    state,
    t,
    viewport,
    workspaceDocuments: workspaceTree.workspaceDocuments,
  })

  /**
   * ★ 接收「从网盘 dock 拖进来的文件」（第 16 轮 #19）★
   *
   * 用户要求：「支持从网盘文件 dock 拖入画布创建插入网盘文件块」。
   *
   * 查证结果（另一个仓库 `siyuan-nebuladisk` 的 `src/tree.js`）：
   *   **拖拽源早就存在** —— 树/列表里的文件行是 `draggable`，`dragstart` 时写入：
   *     · `application/x-nebuladisk-embed` → `{ kind:"file", mount, path, name, isDir:false }`
   *     · `text/plain` → 文件名（保底）
   *   ⇒ **只差画布侧把它接住**。这里那个 `handleStageDrop` 原本是 fork 剥离时
   *     留下的 `async () => false` **死桩**（模板一直绑着它，所以拖上去毫无反应）。
   *
   * ★ 两条必须遵守的约定（网盘插件自己的注释里写明了）★
   *   1. **各自都要把自己不认的拖拽放过去** —— 只处理 `x-nebuladisk-embed`，
   *      其余（系统文件、思源内部拖拽…）一律不 `preventDefault`，
   *      否则会把别人的链路弄坏（实测过"两边都无脑 preventDefault 导致行为错乱"）。
   *   2. 网盘插件是挂在 **document 的冒泡阶段**处理这个 MIME 的（往思源正文插嵌入块）。
   *      我们已经在画布上接住了，就必须 `stopPropagation()`，
   *      否则同一次拖放会**既建画布节点、又插一个正文嵌入块**。
   */
  const NEBULA_DND_MIME = "application/x-nebuladisk-embed"

  /** 解析网盘拖拽载荷；不是网盘拖拽（或格式不对）返回 null，交给别人处理。 */
  function readNebulaDragPayload(event: DragEvent): { mount: string, path: string } | null {
    let raw = ""
    try {
      raw = event.dataTransfer?.getData(NEBULA_DND_MIME) || ""
    } catch {
      // 某些环境下 getData 在非 drop 阶段会抛，安全忽略
      return null
    }
    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as {
        isDir?: boolean
        kind?: string
        mount?: unknown
        path?: unknown
      }
      if (parsed
        && parsed.kind === "file"
        && !parsed.isDir
        && typeof parsed.mount === "string"
        && typeof parsed.path === "string"
        && parsed.mount
        && parsed.path) {
        return { mount: parsed.mount, path: parsed.path }
      }
    } catch {
      // 非法 JSON —— 不是我们的载荷
    }

    return null
  }

  function nebulaDragOver(event: DragEvent) {
    const types = event.dataTransfer?.types
    if (!types || !Array.from(types).includes(NEBULA_DND_MIME)) {
      // ★ 不认的拖拽**不要** preventDefault，放过去
      return
    }
    event.preventDefault()
    try {
      event.dataTransfer!.dropEffect = "copy"
    } catch {
      // dropEffect 只读，忽略
    }
  }

  async function nebulaDrop(event: DragEvent): Promise<boolean> {
    const payload = readNebulaDragPayload(event)
    if (!payload) {
      return false
    }

    // 见上方约定 2：挡住网盘插件挂在 document 上的处理器，避免重复插入
    event.stopPropagation()

    const rect = stageRef.value?.getBoundingClientRect()
    const stagePoint = rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : undefined

    await insertNebulaFileNode(payload.mount, payload.path, stagePoint)
    return true
  }

  const handleStageDragOver = nebulaDragOver
  const handleStageDrop = nebulaDrop

  function toggleInspector() {
    inspectorExpanded.value = !inspectorExpanded.value
  }

  async function toggleInspectorSection(section: keyof CanvasPluginUiState["inspectorSections"]) {
    const nextValue = !inspectorSectionState[section]
    inspectorSectionState[section] = nextValue
    await plugin.updateCanvasUiState?.({
      inspectorSections: {
        [section]: nextValue,
      },
    })
  }

  /**
   * 取 siyuan-nebuladisk 插件实例（用于「双击网盘文件 → 在页签中打开」）。
   *
   * ★ 为什么走插件实例的 openFile()，而不是自己 openTab ★
   *   网盘页签的注册键是 `${网盘插件名}${TAB_TYPE}`，且 init 里要 new 它自己的
   *   Viewer（负责分派 OnlyOffice / kkFileView / CAD / 图片 / 视频 等通道）。
   *   画布侧若自己拼 `custom.id`，一旦对方改常量就静默打不开；
   *   而 `openFile(item)` 是对方**公开的实例方法**，内部自己拼 key、自己定 title，
   *   与「在网盘 dock 里双击文件」走的是**同一条**代码路径 —— 行为天然一致。
   *
   * ★ 拿不到就返回 null，绝不抛 ★
   *   网盘插件可能没装 / 被禁用 / 版本过旧没有 openFile。
   *   此时画布必须优雅降级（给出提示），而不是让双击炸掉整个页面。
   */
  function getNebulaPlugin(): { openFile?: (item: Record<string, unknown>, opts?: Record<string, unknown>) => unknown } | null {
    const app = (plugin as { app?: { plugins?: unknown[] } }).app
    const list = app?.plugins
    if (!Array.isArray(list)) {
      return null
    }
    const found = list.find(
      (candidate) => (candidate as { name?: string })?.name === NEBULA_PLUGIN_NAME,
    )
    return (found as ReturnType<typeof getNebulaPlugin>) ?? null
  }

  /**
   * 双击节点时的「打开」行为。
   *
   * 目前支持两类：
   *   · 笔记节点（kind=block）→ 跳回思源打开该文档（并高亮目标块）
   *   · 网盘文件节点（kind=nebula）→ 在页签中打开（复用网盘插件的打开逻辑）
   *
   * @returns 是否真的执行了「打开」（false = 该节点没有可打开的目标，交给调用方处理）
   */
  async function activateNode(node: CanvasNode) {
    /**
     * ★ 嵌入（预览）模式下，画布区域**任何操作都不得打开/跳转页签** ★
     *
     * 用户要求：「目前在画布区域，会打开跳转到页签，这个不需要。
     *           画布区域任何操作都不能打开跳转到页签。」
     *
     * 实测：这是画布区域**唯一**的打开入口 ——
     *   `activateNode` 全项目只有一个调用点
     *   （use-canvas-workspace-behavior.ts 的 `handleNodeDoubleClick`），
     *   而 dblclick 正是在**松开左键之后**派发的，
     *   与用户"感觉是放开左键的时候"的观察吻合。
     *   卡片组件（CanvasFileCard 等）内部没有任何 @click / @dblclick 处理器。
     *
     * ⇒ 在这里一点拦住，画布区域就彻底没有打开路径了。
     *   要打开该画布走嵌入块头部的「在页签中打开」按钮（显式入口，不误触）。
     *
     * ★ 用 capabilities.openNodeTab（只受 embed 影响）★
     *   「不得打开页签」是**嵌入预览专属**要求；冲突态/移动端仍应能正常打开。
     */
    if (!capabilities.value.openNodeTab) {
      return false
    }

    if (node.type === "file" && node.file) {
      // ★ 必须传 node 对象本身，不能传 node.id ★
      //   getResolvedFileNode(node: CanvasNode) 会先做 `node.type !== "file"` 守卫，
      //   传字符串时 node.type 为 undefined ⇒ 直接 throw
      //   "Resolved file-node metadata requested for a non-file node."
      //   该异常发生在 async 函数内 ⇒ 变成未处理的 promise rejection 被静默吞掉，
      //   外部表现就是「双击毫无反应」。本函数其余调用点（297/312/1285）均传对象。
      const resolved = getResolvedFileNode(node)
      if (!resolved) {
        return false
      }

      // ★ 思源目标有两种 kind，必须都处理 ★
      //   · kind === "block"    → file 里存的是裸块 ID（如 20230617-abc1234）
      //   · kind === "document" → file 里存的是工作区路径（如 /xxx/yyy.sy）
      //     由 resolveDocumentByPath 解析而来，**不会**是 "block"
      //   （line 298 的 canRefreshSelectedSiyuanNode 同样把这两个 kind 并列判断）
      //   漏掉 "document" ⇒ 双击文档节点静默无反应。
      if (resolved.kind === "block") {
        await openDocumentAtBlock(resolved.id, resolved.documentId)
        return true
      }

      if (resolved.kind === "document") {
        // 文档目标没有 documentId 字段，其 id 本身就是文档块 ID；
        // 仍带上 hpath 作为跳转失败时的兜底信息。
        await openDocumentAtBlock(resolved.id)
        return true
      }

      if (resolved.kind === "nebula") {
        const nebulaPlugin = getNebulaPlugin()
        if (!nebulaPlugin || typeof nebulaPlugin.openFile !== "function") {
          showMessage(t("messageNebulaPluginMissing"), 4000, "error")
          return false
        }
        const fileName = resolved.nebulaPath.split("/").filter(Boolean).pop() ?? resolved.title
        // 与网盘 dock 双击文件完全同一条路径：交给对方的 openFile 决定用哪个预览通道。
        nebulaPlugin.openFile({
          mount: resolved.mount,
          name: fileName,
          path: resolved.nebulaPath,
        })
        return true
      }

      /**
       * ★ 思源资源图片：打开它所在的文档并跳到该图片块 ★
       *
       * 精简 `activateNode` 时漏了这一支 ——
       * `file-target-resolution` 仍会产出 `kind: "image"`（带 `blockId`），
       * 但没有分支消费它，于是**双击图片节点静默无反应**。
       *
       * 只有带 `blockId` 的才是"思源内部资源"（能定位到文档与块）；
       * 画布同级 `.assets/` 下的图片没有块 ID，那种情况留给调用方按 `openPath` 处理。
       */
      if (resolved.kind === "image" && resolved.blockId) {
        await openDocumentAtBlock(resolved.blockId)
        return true
      }

      /**
       * ★ 思源资源（非图片，如 PDF）也要能「跳转」（第 14 轮修 #10）★
       *
       * 用户：「这个还需要跳转」。行为与图片一致：
       * 打开该资源**所在的文档**并跳到它那个块 ——
       * 也就是把「在思源里找到它」这件事交给思源自己，画布只负责带路。
       */
      if (resolved.kind === "asset" && resolved.blockId) {
        await openDocumentAtBlock(resolved.blockId)
        return true
      }
    }
    return false
  }
  const {
    clearConnectionDraft,
    clearEdgeReconnectDraft,
    clearSelectionBox,
    finishConnectionDrag,
    getConnectionDraftPath,
    getEdgeReconnectDraftPath,
    handleNodePointerDown,
    handleStageWheel,
    isConnectionTarget,
    isDragging,
    startEdgeEndpointDrag,
    startConnectionDrag,
    startCornerResize,
    startDrag,
    startPan,
    startResize,
  } = createCanvasEditorGestureHandlers({
    alignmentGuides,
    board,
    commitDocument,
    connectionDraft,
    edgeReconnectDraft,
    getAnchor,
    capabilities,
    selectionBox,
    selectedEdge,
    stageRef,
    state,
    viewport,
    showDragAlignmentGuides: computed(() => getReactivePluginSettings().showDragAlignmentGuides !== false),
    autoCreateTextCardOnDrag: computed(() => getReactivePluginSettings().autoCreateTextCardOnDrag),
    showNodeHeader: computed(() => getReactivePluginSettings().showNodeHeader),
  })

  // 自动保存：文档变脏后 1 秒静默保存到当前路径；拖拽/缩放期间挂起，结束后再恢复调度
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleAutoSave() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    if (state.isDirty && !isDragging.value) {
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null
        void silentSave()
      }, 1000)
    }
  }
  watch(() => state.isDirty, scheduleAutoSave)
  watch(isDragging, scheduleAutoSave)

  function nudgeSelectedNodes(dx: number, dy: number) {
    if (!state.selectedNodeIds.length) {
      return
    }

    const nextDocument = state.document.nodes.reduce((doc, node) => {
      if (!state.selectedNodeIds.includes(node.id)) {
        return doc
      }

      return setCanvasNodeGeometry(doc, node.id, {
        x: node.x + dx,
        y: node.y + dy,
      })
    }, state.document)

    commitDocument(nextDocument, { coalesceKey: "nudge-nodes" })
  }

  const { handleKeydown } = createCanvasEditorKeyboardHandler({
    canDelete: () => canDelete.value,
    cancelEdgeLabelEditing,
    closeEdgePopover,
    closeFloatLayer,
    closeSelectionPopover,
    createMindMapChildNode,
    createMindMapSiblingNode,
    deleteSelection,
    duplicateSelection,
    getEdgeToolbarPopover: () => edgeToolbarPopover.value,
    getEditingEdgeLabelId: () => editingEdgeLabelId.value,
    getSelectionToolbarPopover: () => selectionToolbarPopover.value,
    hasFloatLayer: () => floatLayerActive.value,
    hasSelectedNodes: () => state.selectedNodeIds.length > 0,
    nudgeSelectedNodes,
    openFilePickerDialog,
    redo,
    save,
    silentSave,
    selectAllNodes: () => state.selectAllNodes(),
    selectEdge: () => state.selectEdge(),
    selectNode: () => state.selectNode(),
    showFloatLayerForSelection,
    undo,
    zoomIn,
    zoomOut,
    zoomToActualSize,
    zoomToFit,
  })

  function getCanvasSearchTitle() {
    return getFileName(state.filePath) || suggestedFilename.value || t("untitledCanvas")
  }

  function getFileNodeSearchTextById() {
    const textById = new Map<string, string>()
    for (const node of state.document.nodes) {
      if (node.type !== "file") {
        continue
      }

      const resolved = getResolvedFileNode(node)
      textById.set(node.id, [
        resolved.title,
        resolved.path,
        resolved.detail,
        resolved.excerptHtml?.replace(/<[^>]+>/g, " "),
      ].filter(Boolean).join("\n"))
    }

    return textById
  }

  onMounted(async () => {
    await initializeCanvasEditor({
      bootstrap,
      fileSource,
      getFileName,
      newCanvas,
      refreshFileNodeMetadata,
      refreshRecentFiles,
      refreshWorkspaceDocuments: workspaceTree.refreshWorkspaceDocuments,
      rememberRecentPath,
      resetViewport,
      state,
      suggestedFilename,
      t,
    })
    window.addEventListener("keydown", handleKeydown)
    window.addEventListener("diskcanvas-settings-changed", handleExternalSettingsChange)
  })

  onBeforeUnmount(() => {
    closeFloatLayer()
    window.removeEventListener("keydown", handleKeydown)
    window.removeEventListener("diskcanvas-settings-changed", handleExternalSettingsChange)
    blockJumpHighlighter.dispose()
  })

  watch(
    () => state.document.nodes
      .filter((node) => node.type === "file")
      .map((node) => `${node.id}:${node.file}`)
      .join(","),
    () => {
      void refreshFileNodeMetadata()
    },
    { deep: false },
  )

  watch(
    () => `${state.selectedEdgeId}|${state.selectedNodeIds.join(",")}`,
    () => {
      syncCanvasEditorSelectionUi({
        applySelectedNodeAsEdgeSource,
        cancelEdgeLabelEditing,
        clearEdgeReconnectDraft,
        clearSelectionBox,
        closeEdgePopover,
        closeSelectionPopover,
        edgeReconnectDraft,
        state,
      })
    },
  )

  return createCanvasEditorBindings(
    {
      commitDocument,
      applySelectionColor,
      applySelectionLineStyle,
      applyEdgeColor,
      applyEdgeLineStyle,
      applySelectionLayout,
      relayoutConnectedNodes,
      activateCanvasSurface,
      board,
      bottomToolbarVisible,
      canDelete,
      canDecomposeSelectedDocument,
      canRefreshSelectedSiyuanNode,
      canRelayoutConnectedNodes,
      centerEdgeInViewport,
      centerSelectionInViewport,
      focusNodeById,
      closeCreateEdgeDialog,
      closeEdgePopover,
      closeSelectionPopover,
      createGroupFromSelection,
      createEdgeDialog,
      filePickerDialog,
      displayNodes,
      nodeMap,
      getNodeById: (id: string) => nodeMap.value.get(id),
      deactivateCanvasSurface,
      createWorkspaceFolder: workspaceTree.createWorkspaceFolder,
      createWorkspaceCanvas: workspaceTree.createWorkspaceCanvas,
      deleteWorkspaceDocument: workspaceTree.deleteWorkspaceDocument,
      deleteWorkspaceFolder: workspaceTree.deleteWorkspaceFolder,
      openInExplorer: workspaceTree.openInExplorer,
      moveWorkspaceFile: workspaceTree.moveWorkspaceFile,
      renameWorkspaceDocument: workspaceTree.renameWorkspaceDocument,
      renameWorkspaceFolder: workspaceTree.renameWorkspaceFolder,
      copyWorkspaceDocument: workspaceTree.copyWorkspaceDocument,
      expandAllInspectorSections,
      removeRecentFileRecord,
      connectionDraft,
      edgeColorOptions: selectionColors,
      alignmentGuides,
      edgeLabelDraft,
      edgeLabelEditorPosition,
      edgeReconnectDraft,
      edgeSources,
      edgeToolbar,
      edgeToolbarPopover,
      edgeTargets,
      editingEdgeLabelId,
      exportCanvas,
      exportCanvasPng,
      fileInputRef,
      finishConnectionDrag,
      getEdgeLabelPosition,
      getEdgePath,
      getConnectionDraftPath,
      getEdgeReconnectDraftPath,
      getFileName,
      getFileNodeDescription,
      getFileNodeKind,
      getFileNodePreview,
      getPluginSettings,
      getNodeStyle,
      getNodeTitle,
      importCanvas,
      isConnectionTarget,
      isRelayouting,
      newCanvas,
      newEdgeFromSide,
      newEdgeLabel,
      newEdgeSourceId,
      newEdgeSourceQuery,
      newEdgeTargetId,
      newEdgeTargetQuery,
      newEdgeToSide,
      openCreateEdgeDialog,
      openFilePickerDialog,
      openPath,
      openRecentFile,
      reloadFromDisk,
      resetViewport,
      save,
      silentSave,
      closeFilePickerDialog,
      selectFilePickerResult,
      selectEdge,
      selectNode,
      selectedEdge,
      selectedNode,
      selectedNodeCount,
      selectionBox,
      selectionBounds,
      sides: SIDES,
      stageRef,
      startConnectionDrag,
      startCornerResize,
      startDrag,
      startPan,
      startResize,
      state,
      submitCreateEdgeDialog,
      suggestedFilename,
      setNewEdgeSourceId,
      setNewEdgeTargetId,
      triggerImport,
      toggleInspectorSection,
      updateFilePickerQuery,
      updateTextNodeContent,
      convertTextToLink,
      convertLinkToText,
      updateEdgeField,
      updateEdgeSide,
      applySelectedNodeChanges,
      updateNodeField,
      updateNumericNodeField,
      updateSelectedNodeZIndex,
      moveSelectedNodeZIndex,
      moveSelectedNodeToBottom,
      moveSelectedNodeToTop,
      viewport,
      zoomIn,
      zoomOut,
      zoomToActualSize,
      zoomToFit,
      undo,
      redo,
      canUndo,
      canRedo,
      readonly,
      /**
       * ★★★ 具名交互能力（单一事实来源，见 canvas-interaction-policy.ts）★★★
       *
       * 守卫**一律查这里**，不要再各自判断 `readonly` / `isEmbedMode`：
       *   · `capabilities.editDocument`      改文档（拖拽/改尺寸/连线/改端点）
       *   · `capabilities.select`            选中节点或连线
       *   · `capabilities.marquee`           空白左键框选
       *   · `capabilities.createByDoubleClick` 空白双击新建
       *   · `capabilities.renderNodeHandles` 渲染连线点与缩放手柄
       *   · `capabilities.openNodeTab`       双击卡片打开页签
       *   · `capabilities.persist`           写盘
       *   · `capabilities.zoom` / `.pan`     缩放 / 平移（预览态**恒为 true**）
       */
      capabilities,
      /**
       * 是否为「嵌入预览」实例（笔记里的只读画布块）。
       *
       * 保留给"只与嵌入有关"的判据（＝ `capabilities.persist` / `.openNodeTab` 的语义）。
       * 新代码优先用 `capabilities`，名字更明确。
       */
      isEmbedMode,
      isSaving,
      duplicateSelection,
      getRenderedMarkdown,
      handleClipboardImagePaste,
      insertNebulaFileNode,
      insertSiyuanAssetNode,
      handleStageDragOver,
      handleStageDrop,
      handleNodePointerDown,
      handleStageWheel,
      inspectorExpanded,
      inspectorSectionState,
      addNode,
      addNodeAtPosition,
      createEdgeFromSelection,
      deleteSelection,
      activateNode,
      openDocumentAtBlock,
      loadConflictVersion,
      openRecentPath,
      openSettings,
      openWorkspacePath,
      overwriteConflictVersion,
      recentFiles,
      searchDecorations,
      refreshSelectedSiyuanNode,
      expandAllFolders: workspaceTree.expandAllFolders,
      collapseAllFolders: workspaceTree.collapseAllFolders,
      allFoldersExpanded: workspaceTree.allFoldersExpanded,
      expandedFolders: workspaceTree.expandedFolders,
      setWorkspaceSortDirection: workspaceTree.setWorkspaceSortDirection,
      setWorkspaceSortField: workspaceTree.setWorkspaceSortField,
      toggleFolderExpand: workspaceTree.toggleFolderExpand,
      workspaceDocuments: workspaceTree.workspaceDocuments,
      workspaceSortDirection: workspaceTree.workspaceSortDirection,
      workspaceSortField: workspaceTree.workspaceSortField,
      selectionColors,
      colorThemeId,
      colorThemes: CANVAS_COLOR_THEMES,
      currentColorStyles,
      setColorTheme,
      selectionLayoutActions,
      selectionToolbar,
      selectionToolbarPopover,
      selectedEdgeHandlePositions,
      setSelectionToolbarSize,
      setEdgeToolbarSize,
      startEdgeEndpointDrag,
      startEdgeLabelEditing,
      submitEdgeLabelEditing,
      cancelEdgeLabelEditing,
      updateEditingEdgeLabel,
      toggleInspector,
      toggleGroupCollapse,
      toggleEdgePopover,
      toggleSelectionPopover,
      updateSelectedEdgeDirection,
      selectedEdgeDirectionMode,
      settings: computed(() => getReactivePluginSettings()),
      defaultCanvasDirectory: computed(() => getPluginSettings().defaultCanvasDirectory),
      sproutLoading,
      sproutRelations,
      loadSproutRelations,
      toggleSproutItemSelect,
      setAllSproutItemsSelected,
      executeSprout,
      getResolvedFileNode,
    },
    ["fileInputRef", "stageRef"],
  )
}
