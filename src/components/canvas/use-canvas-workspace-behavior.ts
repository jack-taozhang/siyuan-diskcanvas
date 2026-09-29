import type { CanvasNode } from "@/canvas/types"

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue"
import { getNodeSelectionColorValue } from "@/components/canvas/canvas-workspace-display"
import { isWebUrl } from "@/canvas/url-detection"

interface CanvasWorkspaceEditor {
  activateNode: (node: CanvasNode) => void
  closeEdgePopover: () => void
  closeSelectionPopover: () => void
  convertTextToLink: (nodeId: string, url: string) => void
  convertLinkToText: (nodeId: string, text: string) => void
  edgeToolbar: {
    visible: boolean
  }
  edgeToolbarPopover: "closed" | "color" | "direction"
  importCanvas: (file: File) => Promise<void>
  /**
   * 是否为「嵌入预览」实例。
   *
   * 预览态下**任何操作都不得打开/跳转页签**（用户明确要求），
   * 双击分发点需要它来做整条拦截。
   */
  isEmbedMode: boolean
  selectNode: (nodeId: string) => void
  selectedNode: CanvasNode | null
  selectedNodeCount: number
  setEdgeToolbarSize: (size: { height: number, width: number }) => void
  selectionToolbar: {
    visible: boolean
  }
  selectionToolbarPopover: "closed" | "color" | "layout"
  setSelectionToolbarSize: (size: { height: number, width: number }) => void
  state: {
    document: {
      nodes: CanvasNode[]
    }
    isDirty: boolean
    selectedNodeIds: string[]
  }
  updateTextNodeContent: (nodeId: string, text: string) => void
  toggleGroupCollapse: (nodeId: string) => void
}

export function useCanvasWorkspaceBehavior(editor: CanvasWorkspaceEditor) {
  const editingMarkdown = ref("")
  const editingNodeId = ref("")
  const editingOriginalText = ref("")
  const editingTextareaRef = ref<HTMLTextAreaElement>()
  const canvasShellRef = ref<HTMLElement>()
  const edgeToolbarRef = ref<HTMLElement>()
  const selectionToolbarRef = ref<HTMLElement>()
  const selectionToolbarThemeMode = ref<"dark" | "light">("light")

  let canvasThemeObserver: MutationObserver | null = null
  let edgeToolbarResizeObserver: ResizeObserver | null = null
  let selectionToolbarResizeObserver: ResizeObserver | null = null

  const activeSelectionColor = computed(() => {
    if (!editor.state.selectedNodeIds.length) {
      return null
    }

    const selectedNodeIds = new Set(editor.state.selectedNodeIds)
    const selectedNodes = editor.state.document.nodes.filter((node) => selectedNodeIds.has(node.id))

    if (!selectedNodes.length) {
      return null
    }

    const firstColor = getNodeSelectionColorValue(selectedNodes[0])

    return selectedNodes.every((node) => getNodeSelectionColorValue(node) === firstColor)
      ? firstColor
      : null
  })

  function setEditingTextareaRef(value: Element | null) {
    editingTextareaRef.value = value instanceof HTMLTextAreaElement ? value : undefined
  }

  function syncSelectionToolbarThemeMode() {
    selectionToolbarThemeMode.value = canvasShellRef.value?.dataset.themeMode === "dark" ? "dark" : "light"
  }

  function syncSelectionToolbarSize() {
    if (!selectionToolbarRef.value) {
      return
    }

    const { height, width } = selectionToolbarRef.value.getBoundingClientRect()
    editor.setSelectionToolbarSize({
      height: Math.round(height),
      width: Math.round(width),
    })
  }

  function observeSelectionToolbar() {
    selectionToolbarResizeObserver?.disconnect()
    selectionToolbarResizeObserver = null

    if (!selectionToolbarRef.value || typeof ResizeObserver === "undefined") {
      return
    }

    selectionToolbarResizeObserver = new ResizeObserver(() => {
      syncSelectionToolbarSize()
    })
    selectionToolbarResizeObserver.observe(selectionToolbarRef.value)
  }

  function syncEdgeToolbarSize() {
    if (!edgeToolbarRef.value) {
      return
    }

    const { height, width } = edgeToolbarRef.value.getBoundingClientRect()
    editor.setEdgeToolbarSize({
      height: Math.round(height),
      width: Math.round(width),
    })
  }

  function observeEdgeToolbar() {
    edgeToolbarResizeObserver?.disconnect()
    edgeToolbarResizeObserver = null

    if (!edgeToolbarRef.value || typeof ResizeObserver === "undefined") {
      return
    }

    edgeToolbarResizeObserver = new ResizeObserver(() => {
      syncEdgeToolbarSize()
    })
    edgeToolbarResizeObserver.observe(edgeToolbarRef.value)
  }

  function setSelectionToolbarRef(value: Element | null) {
    selectionToolbarRef.value = value instanceof HTMLElement ? value : undefined
    observeSelectionToolbar()
    syncSelectionToolbarSize()
  }

  function setEdgeToolbarRef(value: Element | null) {
    edgeToolbarRef.value = value instanceof HTMLElement ? value : undefined
    observeEdgeToolbar()
    syncEdgeToolbarSize()
  }

  function handleToolbarEdit() {
    if (!editor.selectedNode || editor.selectedNodeCount !== 1) {
      return
    }

    handleNodeDoubleClick(editor.selectedNode)
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!(event.target instanceof HTMLElement)) {
      if (editor.selectionToolbarPopover !== "closed") {
        editor.closeSelectionPopover()
      }
      if (editor.edgeToolbarPopover !== "closed") {
        editor.closeEdgePopover()
      }
      return
    }

    if (editor.selectionToolbarPopover !== "closed" && !event.target.closest(".selection-toolbar")) {
      editor.closeSelectionPopover()
    }

    if (editor.edgeToolbarPopover !== "closed" && !event.target.closest(".edge-toolbar")) {
      editor.closeEdgePopover()
    }
  }

  function handleNodeDoubleClick(node: CanvasNode) {
    /**
     * ★ 嵌入预览：双击节点**什么都不做** ★
     *
     * 用户要求：「画布区域任何操作都不能打开跳转到页签。」
     *
     * 这里是画布内「双击卡片」的唯一分发点（模板 `@dblclick.stop`，
     * 另外两处调用来自 `handleToolbarEdit` 与 `pendingEditNodeId` 监听），
     * 所以在这一层整条拦住最彻底 —— 不管是 file 节点（会打开页签）
     * 还是 text/group/query 节点（会进入编辑态），预览态下一律不做。
     *
     * `editor.activateNode` 自己也有 `capabilities.openNodeTab` 早退（对"打开"这条链），
     * 但**编辑态分支**不经过它，只在能力边界上被间接挡住。
     * 双保险：那里挡"打开"，这里挡"双击这件事本身"。
     *
     * ★ 判据用 capabilities.openNodeTab（只受 embed 影响）★
     *   ＝改造前 `isEmbedMode` 的语义，保证冲突态/移动端仍能双击进入编辑。
     */
    if (!editor.capabilities.openNodeTab) {
      return
    }

    if (node.type === "group" && node.collapsed) {
      editor.toggleGroupCollapse(node.id)
      return
    }
    if (!["group", "text", "link", "query"].includes(node.type)) {
      editor.activateNode(node)
      return
    }

    editor.selectNode(node.id)
    editingNodeId.value = node.id
    const initialText: string = node.type === "group"
      ? (node.label || "")
      : node.type === "text"
        ? (node.text || "")
        : node.type === "link"
          ? (node.url || "")
          : node.type === "query"
            ? (node.sql || "")
            : ""
    editingMarkdown.value = initialText
    editingOriginalText.value = initialText
    void nextTick(() => {
      editingTextareaRef.value?.focus()
      if (initialText === "New note") {
        editingTextareaRef.value?.select()
      } else {
        editingTextareaRef.value?.setSelectionRange(editingMarkdown.value.length, editingMarkdown.value.length)
      }
    })
  }

  function commitTextNodeEditing() {
    if (!editingNodeId.value) {
      return
    }

    const trimmed = editingMarkdown.value.trim()
    const node = editor.state.document.nodes.find((candidate) => candidate.id === editingNodeId.value)
    if (node?.type === "query") {
      editor.updateNodeField(editingNodeId.value, "sql", editingMarkdown.value.trim())
    } else if (node?.type === "text" && isWebUrl(trimmed)) {
      editor.convertTextToLink(editingNodeId.value, trimmed)
    } else if (node?.type === "link") {
      if (isWebUrl(trimmed)) {
        editor.updateTextNodeContent(editingNodeId.value, trimmed)
      } else {
        editor.convertLinkToText(editingNodeId.value, editingMarkdown.value)
      }
    } else {
      editor.updateTextNodeContent(editingNodeId.value, editingMarkdown.value)
    }

    editingNodeId.value = ""
    editingMarkdown.value = ""
    editingOriginalText.value = ""
  }

  watch(editingMarkdown, (next) => {
    if (!editingNodeId.value) {
      return
    }

    if (next !== editingOriginalText.value) {
      editor.state.isDirty = true
    }
  })

  watch(
    () => editor.state.pendingEditNodeId,
    (newId) => {
      if (newId) {
        const node = editor.state.document.nodes.find((candidate) => candidate.id === newId)
        if (node) {
          handleNodeDoubleClick(node)
        }
        editor.state.pendingEditNodeId = ""
      }
    },
  )

  async function handleImport(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) {
      return
    }

    await editor.importCanvas(file)
    input.value = ""
  }

  onMounted(() => {
    syncSelectionToolbarThemeMode()
    window.addEventListener("pointerdown", handleWindowPointerDown)

    if (canvasShellRef.value && typeof MutationObserver !== "undefined") {
      canvasThemeObserver = new MutationObserver(() => {
        syncSelectionToolbarThemeMode()
      })
      canvasThemeObserver.observe(canvasShellRef.value, {
        attributeFilter: ["data-theme-mode"],
        attributes: true,
      })
    }
  })

  onBeforeUnmount(() => {
    canvasThemeObserver?.disconnect()
    window.removeEventListener("pointerdown", handleWindowPointerDown)
    edgeToolbarResizeObserver?.disconnect()
    selectionToolbarResizeObserver?.disconnect()
  })

  watch(
    () => `${editor.selectionToolbar.visible}|${editor.selectedNodeCount}`,
    async () => {
      await nextTick()
      syncSelectionToolbarSize()
    },
  )

  watch(
    () => editor.edgeToolbar.visible,
    async () => {
      await nextTick()
      syncEdgeToolbarSize()
    },
  )

  return {
    activeSelectionColor,
    canvasShellRef,
    commitTextNodeEditing,
    editingMarkdown,
    editingNodeId,
    setEdgeToolbarRef,
    handleImport,
    handleNodeDoubleClick,
    handleToolbarEdit,
    selectionToolbarThemeMode,
    setEditingTextareaRef,
    setSelectionToolbarRef,
  }
}
