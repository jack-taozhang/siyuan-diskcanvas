import type {
  ComputedRef,
  Ref,
} from "vue"
import {
  ref,
  watch,
} from "vue"
import type { CanvasBoardMetrics } from "@/canvas/board"
import type { CanvasCapabilities } from "@/canvas/canvas-interaction-policy"
import type { CanvasEditorState } from "@/canvas/editor-state"
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  CanvasSide,
} from "@/canvas/types"

import {
  toBoardX,
  toBoardY,
} from "@/canvas/board"
import type { CanvasAlignmentGuide } from "@/canvas/alignment-guides"
import { resolveCanvasAlignmentGuides } from "@/canvas/alignment-guides"
import type { CanvasGridSettings } from "@/canvas/grid"
import { snapCanvasDragDelta } from "@/canvas/grid"
import { cloneCanvasDocument } from "@/canvas/canvas-history"
import {
  createCanvasEdge,
  createCanvasNode,
  removeCanvasEdge,
  setCanvasEdgeEndpoint,
  setCanvasNodeGeometry,
  upsertCanvasEdge,
  upsertCanvasNode,
} from "@/canvas/document"
import {
  CONNECTION_SNAP_DISTANCE,
  findNearestCanvasAnchor,
  resizeCanvasNodeFromCorner,
  resizeCanvasNodeFromSide,
} from "@/canvas/node-interaction"
import {
  createBoundsFromPoints,
  createEdgeCurvePath,
  resolveDragNodeIds,
  resolveMarqueeSelectionEdgeIds,
  resolveMarqueeSelectionNodeIds,
} from "@/canvas/selection-toolbar"
import {
  clampViewportScale,
  scaleViewportAtPoint,
} from "@/canvas/viewport"
import {
  createCanvasWheelSourceClassifier,
  normalizeCanvasWheelDelta,
  WHEEL_ZOOM_SENSITIVITY,
} from "@/canvas/wheel-gesture"

export interface CanvasEditorSelectionBoxState {
  height: number
  visible: boolean
  width: number
  x: number
  y: number
}

export interface CanvasEditorAlignmentGuideState {
  guides: CanvasAlignmentGuide[]
  visible: boolean
}

export interface CanvasEditorConnectionDraftState {
  fromNodeId: string
  fromSide: CanvasSide
  toNodeId: string
  toSide: CanvasSide
  toX: number
  toY: number
  visible: boolean
}

export interface CanvasEditorEdgeReconnectDraftState {
  edgeId: string
  endpoint: "" | "from" | "to"
  targetNodeId: string
  targetSide: "" | CanvasSide
  toX: number
  toY: number
  visible: boolean
}

interface CanvasEditorGestureOptions {
  alignmentGuides: CanvasEditorAlignmentGuideState
  board: ComputedRef<CanvasBoardMetrics>
  commitDocument: (document: CanvasDocument, options?: { coalesceKey?: string }) => void
  connectionDraft: CanvasEditorConnectionDraftState
  edgeReconnectDraft: CanvasEditorEdgeReconnectDraftState
  getAnchor: (node: CanvasNode, side: CanvasSide) => { x: number, y: number }
  /**
   * ★ 具名交互能力（单一事实来源，见 canvas-interaction-policy.ts）★
   *
   * 手势层**不**再直接判断 `readonly`，而是查询具体能力：
   *   · `editDocument` → 拖拽 / 复制拖拽 / 连线 / 改线端点 / 改尺寸
   *   · `marquee`      → 空白处左键框选
   * 平移（`pan`）与缩放（`zoom`）不在此处门控 —— 平移的右键分支刻意放在
   * 所有能力判断**之前**，缩放走 wheel 且本就不看任何只读标志。
   */
  capabilities: ComputedRef<CanvasCapabilities>
  selectionBox: CanvasEditorSelectionBoxState
  selectedEdge: ComputedRef<CanvasEdge | null>
  showDragAlignmentGuides: ComputedRef<boolean>
  /**
   * 网格设置（样式/间距/吸附）。
   *
   * 为什么整份对象传进来而不是传 `gridSnap` + `gridSize` 两个值：
   * 吸附与间距是同一件事的两面，分两个 ref 传很容易出现
   * "吸附开关更新了但间距还是上一轮"的中间态（同一次设置改动被拆成两次响应式更新）。
   */
  gridSettings: Ref<CanvasGridSettings>
  autoCreateTextCardOnDrag: ComputedRef<boolean>
  stageRef: Ref<HTMLElement | undefined>
  state: CanvasEditorState
  viewport: {
    scale: number
    x: number
    y: number
  }
  showNodeHeader: ComputedRef<boolean>
}

export function createCanvasEditorGestureHandlers(options: CanvasEditorGestureOptions) {
  const {
    alignmentGuides,
    board,
    commitDocument,
    connectionDraft,
    edgeReconnectDraft,
    getAnchor,
    capabilities,
    selectionBox,
    selectedEdge,
    showDragAlignmentGuides,
    gridSettings,
    autoCreateTextCardOnDrag,
    stageRef,
    state,
    viewport,
    showNodeHeader,
  } = options

  // 拖拽/缩放期间挂起自动保存，避免拖拽中途触发宿主侧文件写入与重布局导致闪烁
  const isDragging = ref(false)

  // 触控板双指滑动与鼠标滚轮共用 wheel 事件，来源需按手势锁存，避免滑动中途被误判
  const wheelSourceClassifier = createCanvasWheelSourceClassifier()

  function clearSelectionBox() {
    selectionBox.visible = false
    selectionBox.x = 0
    selectionBox.y = 0
    selectionBox.width = 0
    selectionBox.height = 0
  }

  function clearConnectionDraft() {
    connectionDraft.fromNodeId = ""
    connectionDraft.toNodeId = ""
    connectionDraft.toX = 0
    connectionDraft.toY = 0
    connectionDraft.visible = false
  }

  function clearEdgeReconnectDraft() {
    edgeReconnectDraft.edgeId = ""
    edgeReconnectDraft.endpoint = ""
    edgeReconnectDraft.targetNodeId = ""
    edgeReconnectDraft.targetSide = ""
    edgeReconnectDraft.toX = 0
    edgeReconnectDraft.toY = 0
    edgeReconnectDraft.visible = false
  }

  function clearAlignmentGuides() {
    alignmentGuides.guides = []
    alignmentGuides.visible = false
  }

  watch(showDragAlignmentGuides, (enabled) => {
    if (!enabled) {
      clearAlignmentGuides()
    }
  }, { flush: "sync" })

  function startPointerGesture(
    event: PointerEvent,
    onMove: (dx: number, dy: number, moveEvent: PointerEvent) => void,
    handlers: {
      onEnd?: (dx: number, dy: number, upEvent: PointerEvent) => void
    } = {},
  ) {
    const startX = event.clientX
    const startY = event.clientY

    // 指针捕获：防止拖拽过程中指针移出窗口或悬停在 iframe/其他元素上时丢失事件
    const targetElement = event.target instanceof Element ? event.target : null
    if (targetElement && typeof targetElement.setPointerCapture === "function") {
      try {
        targetElement.setPointerCapture(event.pointerId)
      } catch {
        // 部分测试环境或非活动指针可能报错，安全忽略
      }
    }

    let rafId: number | null = null
    let latestDx = 0
    let latestDy = 0
    let latestMoveEvent: PointerEvent | null = null
    let hasMoved = false

    const isTestEnv = typeof process !== "undefined" && (process.env?.VITEST === "true" || process.env?.NODE_ENV === "test")

    const handleMove = (moveEvent: PointerEvent) => {
      latestDx = moveEvent.clientX - startX
      latestDy = moveEvent.clientY - startY
      latestMoveEvent = moveEvent

      if (Math.hypot(latestDx, latestDy) > 2) {
        hasMoved = true
      }

      if (!isTestEnv && typeof requestAnimationFrame === "function") {
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            rafId = null
            if (latestMoveEvent) {
              onMove(latestDx, latestDy, latestMoveEvent)
            }
          })
        }
      } else {
        onMove(latestDx, latestDy, latestMoveEvent)
      }
    }

    const handleUp = (upEvent: PointerEvent) => {
      if (rafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId)
        rafId = null
        // 保证在松手时触发最新一帧的位置计算
        if (latestMoveEvent) {
          onMove(latestDx, latestDy, latestMoveEvent)
        }
      }

      window.removeEventListener("pointermove", handleMove, true)
      window.removeEventListener("pointerup", handleUp, true)

      if (targetElement && typeof targetElement.releasePointerCapture === "function") {
        try {
          if (targetElement.hasPointerCapture(event.pointerId)) {
            targetElement.releasePointerCapture(event.pointerId)
          }
        } catch {
          // 安全忽略
        }
      }

      // 若拖动过程中发生了实质位移，在捕获阶段拦截随后浏览器合成触发的 click 事件，避免误触卡片内部链接或选择逻辑
      if (hasMoved) {
        const suppressClick = (clickEvent: MouseEvent) => {
          clickEvent.stopPropagation()
          clickEvent.preventDefault()
          window.removeEventListener("click", suppressClick, true)
        }
        window.addEventListener("click", suppressClick, true)
        setTimeout(() => {
          window.removeEventListener("click", suppressClick, true)
        }, 200)
      }

      handlers.onEnd?.(upEvent.clientX - startX, upEvent.clientY - startY, upEvent)
    }

    /**
     * ★★★ 必须用**捕获阶段**监听，不能只用冒泡阶段 ★★★
     *
     * 背景：思源对每个自定义块元素（`NodeCustomBlock`）都挂了一组**冒泡阶段**的
     * 监听器，无条件 `stopPropagation()`：
     *
     *   const I = ["beforeinput","input","keydown",...,"pointerdown","pointermove",
     *              "pointerup","pointercancel","touchstart","touchmove",...]
     *   I.forEach(type => el.addEventListener(type, e => e.stopPropagation()))
     *
     * （见 stage/build/desktop/main.*.js 的 custom block 生命周期）
     *
     * 后果：在**嵌入（预览）块内部**按下右键拖拽时，pointermove 会在自定义块那一层
     * 被 stopPropagation 截断，**永远到不了 window 的冒泡监听** ⇒ 平移手势"点了没反应"；
     * 而在块外（如侧栏）按下时事件不经过自定义块 ⇒ 平移正常。这正是
     * 「按下右键，鼠标移到嵌入块外画布才移动」的真实原因。
     *
     * 补救：window 的**捕获阶段**监听在"捕获下行"时就触发，早于目标元素的冒泡监听，
     * 因此不受其 stopPropagation 影响。removeEventListener 的第三参必须同为 true，
     * 否则监听不会真正解绑（会造成手势叠加/内存泄漏）。
     */
    window.addEventListener("pointermove", handleMove, true)
    window.addEventListener("pointerup", handleUp, true)
  }

  // 以指针位置为锚点缩放，保持光标下的画布坐标不动
  function applyAnchoredZoom(event: WheelEvent) {
    const stage = stageRef.value
    if (!stage) {
      return
    }

    const rect = stage.getBoundingClientRect()
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    const { y: deltaY } = normalizeCanvasWheelDelta(event)
    // 不对 scale 取整：取整会把每帧的缩放增量抹平（1.00 * exp(-1 * 0.0015) 仍会舍入回 1.00），
    // 导致小幅度捏合完全推不动画布；缩放百分比由界面层自行取整显示
    const nextScale = clampViewportScale(viewport.scale * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY))
    const nextViewport = scaleViewportAtPoint(viewport, point, nextScale)

    viewport.scale = nextViewport.scale
    viewport.x = nextViewport.x
    viewport.y = nextViewport.y
  }

  function handleStageWheel(event: WheelEvent) {
    // 无位移的事件（部分设备在手指落下时会上报）既不消耗，也不参与来源判定
    if (event.deltaX === 0 && event.deltaY === 0) {
      return
    }

    // 拖拽/缩放卡片期间冻结视口：节点位移按当前 scale 换算，中途改变缩放会让卡片跳变
    if (isDragging.value) {
      return
    }

    // 每次事件都参与判定，捏合事件会刷新手势时效但不改变已锁存的来源
    const source = wheelSourceClassifier.classify(event)

    if (event.ctrlKey || event.metaKey || source === "mouse") {
      applyAnchoredZoom(event)
    } else {
      // 平移取「内容跟随手指」的方向，与 startPan 的指针拖拽增量相反：
      // deltaY > 0 表示向下滚动，画布内容相应上移，因此视口偏移量相减
      const { x, y } = normalizeCanvasWheelDelta(event)
      viewport.x -= x
      viewport.y -= y
    }

    // 画布已消费该手势：阻止浏览器把横向滑动解释为前进/后退，以及 Ctrl+滚轮缩放整个宿主界面
    event.preventDefault()
  }

  watch(() => stageRef.value, (stage) => {
    if (!stage) return

    let initialPinchDistance = 0
    let initialScale = 1
    let initialWorldCenter = { x: 0, y: 0 }

    stage.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault()
        const t1 = e.touches[0]
        const t2 = e.touches[1]
        initialPinchDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
        initialScale = viewport.scale
        
        const rect = stage.getBoundingClientRect()
        const initialPinchCenter = {
          x: (t1.clientX + t2.clientX) / 2 - rect.left,
          y: (t1.clientY + t2.clientY) / 2 - rect.top,
        }
        initialWorldCenter = {
          x: (initialPinchCenter.x - viewport.x) / viewport.scale,
          y: (initialPinchCenter.y - viewport.y) / viewport.scale,
        }
      }
    }, { passive: false })

    stage.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault()
        const t1 = e.touches[0]
        const t2 = e.touches[1]
        const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
        
        if (initialPinchDistance > 0) {
          const scaleRatio = distance / initialPinchDistance
          const nextScale = clampViewportScale(Number((initialScale * scaleRatio).toFixed(2)))
          
          const rect = stage.getBoundingClientRect()
          const currentPinchCenter = {
            x: (t1.clientX + t2.clientX) / 2 - rect.left,
            y: (t1.clientY + t2.clientY) / 2 - rect.top,
          }
          
          viewport.scale = nextScale
          viewport.x = currentPinchCenter.x - initialWorldCenter.x * nextScale
          viewport.y = currentPinchCenter.y - initialWorldCenter.y * nextScale
        }
      }
    }, { passive: false })

    stage.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) {
        initialPinchDistance = 0
      }
    })
  }, { immediate: true })

  function isAdditiveSelectionGesture(event: MouseEvent | PointerEvent): boolean {
    return Boolean(event.ctrlKey || event.metaKey || event.shiftKey)
  }

  function isCopyDragGesture(event: MouseEvent | PointerEvent): boolean {
    return Boolean(event.ctrlKey || event.metaKey)
  }

  function createCopiedNodeId(nodeId: string): string {
    return `${nodeId}-copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }

  function resolveDragDelta(dx: number, dy: number, options: { lockAxis: boolean }) {
    const deltaX = Math.round(dx / viewport.scale)
    const deltaY = Math.round(dy / viewport.scale)

    if (!options.lockAxis) {
      return { deltaX, deltaY }
    }

    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      return { deltaX, deltaY: 0 }
    }

    return { deltaX: 0, deltaY }
  }

  function resolveAlignmentDragDelta(options: {
    deltaX: number
    deltaY: number
    movingNodeIds: string[]
    nodes: CanvasNode[]
  }) {
    /**
     * ★ 顺序：**先吸网格，再让对齐辅助线微调** ★
     *
     *   两者都会改写同一个 delta，先后必然互相覆盖，所以要明确优先级：
     *     · 网格是"背景参考线"，用户要的是**大致落在格子上**；
     *     · 辅助线是"我在跟旁边的卡片对齐"，是**更强的意图**，阈值只有屏幕 8px。
     *   ⇒ 先网格归位，再让辅助线在 8px 内把它拉到邻居的边/中线上。
     *     反过来（先辅助线后网格）会把刚对齐好的结果再推走，辅助线等于白做。
     */
    const snapped = applyGridSnapToDragDelta(options)

    if (!showDragAlignmentGuides.value) {
      clearAlignmentGuides()
      return {
        deltaX: snapped.deltaX,
        deltaY: snapped.deltaY,
        guides: [],
      }
    }

    // 基于当前视口缩放比例自适应调整吸附阈值，确保在不同缩放比例下，屏幕上物理吸附距离保持约 8 像素
    const resolved = resolveCanvasAlignmentGuides({
      ...options,
      deltaX: snapped.deltaX,
      deltaY: snapped.deltaY,
      threshold: 8 / viewport.scale,
    })
    alignmentGuides.guides = resolved.guides
    alignmentGuides.visible = resolved.guides.length > 0
    return resolved
  }

  /**
   * 网格吸附（关闭时原样返回）。
   *
   * ★ 锚点节点怎么选 ★
   *   多选拖动时整组一起动，必须挑**一个**节点作为"要落在网格上的那个"，
   *   其余节点跟随同一修正量（组内相对位置不变）。
   *   这里取 `movingNodeIds[0]` 在**拖动开始快照**（`options.nodes`）里的位置 ——
   *   `options.nodes` 传进来的就是拖动起点的快照（见两处调用点的 `nodes: initialNodes`），
   *   所以"初始位置 + delta = 目标位置"这个等式成立。
   *
   *   不取鼠标下的那个节点：那个 id 在事件里更靠后、拿不到稳定顺序，
   *   而 `movingNodeIds[0]` 至少是**每次拖动都同一个**，行为可预测、可测。
   */
  function applyGridSnapToDragDelta(options: {
    deltaX: number
    deltaY: number
    movingNodeIds: string[]
    nodes: CanvasNode[]
  }): { deltaX: number, deltaY: number } {
    const grid = gridSettings.value
    if (!grid?.snap) {
      return { deltaX: options.deltaX, deltaY: options.deltaY }
    }

    const anchorId = options.movingNodeIds[0]
    const anchor = anchorId
      ? options.nodes.find((node) => node.id === anchorId)
      : undefined
    if (!anchor) {
      return { deltaX: options.deltaX, deltaY: options.deltaY }
    }

    return snapCanvasDragDelta({
      anchorX: anchor.x,
      anchorY: anchor.y,
      deltaX: options.deltaX,
      deltaY: options.deltaY,
      size: grid.size,
    })
  }

  function isNodeGestureTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false
    }

    // 排除节点上"应该消化点击"的元素：尺寸把手、连接锚点、可交互控件
    const excludeSelector = [
      ".canvas-node__resize-handle",
      ".canvas-node__resize-corner",
      ".canvas-node__anchor",
      "a",
      "button",
      "input",
      "textarea",
      "select",
    ]

    // 如果开启了显示标题栏，那么卡片主体（selectable区域）是不允许拖拽的，需要排除它
    if (showNodeHeader.value) {
      excludeSelector.push(".canvas-node__body--selectable")
    }

    return !target.closest(excludeSelector.join(", "))
  }

  function isStageGestureTarget(target: EventTarget | null): target is Element {
    if (!(target instanceof Element)) {
      return false
    }

    return !target.closest(".canvas-node, .selection-toolbar")
      && !target.closest(".stage__edge, .stage__edge-label")
      && !target.closest("a, button, input, textarea, select")
  }

  function toCanvasX(stageX: number): number {
    return (stageX - viewport.x) / viewport.scale + board.value.left
  }

  function toCanvasY(stageY: number): number {
    return (stageY - viewport.y) / viewport.scale + board.value.top
  }

  function updateSelectionBox(startPoint: { x: number, y: number }, currentPoint: { x: number, y: number }) {
    const bounds = createBoundsFromPoints(startPoint, currentPoint)

    selectionBox.visible = true
    selectionBox.x = bounds.x
    selectionBox.y = bounds.y
    selectionBox.width = bounds.width
    selectionBox.height = bounds.height
  }

  function finalizeSelectionBox(
    startPoint: { x: number, y: number },
    endPoint: { x: number, y: number },
    options: {
      additive: boolean
    },
  ) {
    const stageBounds = createBoundsFromPoints(startPoint, endPoint)

    clearSelectionBox()

    if (stageBounds.width < 3 && stageBounds.height < 3) {
      if (!options.additive) {
        state.selectNodes([])
      }
      return
    }

    const selectedNodeIds = resolveMarqueeSelectionNodeIds(state.document, {
      height: stageBounds.height / viewport.scale,
      width: stageBounds.width / viewport.scale,
      x: toCanvasX(stageBounds.x),
      y: toCanvasY(stageBounds.y),
    })

    if (selectedNodeIds.length > 0) {
      state.selectNodes(selectedNodeIds, { additive: options.additive })
      return
    }

    const selectedEdgeIds = resolveMarqueeSelectionEdgeIds(state.document, {
      height: stageBounds.height / viewport.scale,
      width: stageBounds.width / viewport.scale,
      x: toCanvasX(stageBounds.x),
      y: toCanvasY(stageBounds.y),
    })

    if (selectedEdgeIds.length > 0) {
      state.selectEdge(selectedEdgeIds[0])
      return
    }

    if (!options.additive) {
      state.selectNodes([])
    }
  }

  function startPan(event: PointerEvent) {
    /**
     * ★ 平移统一为「右键按住」（编辑态与预览态一致）★
     *
     * 用户要求：「编辑界面是右键按住可以平移画布。预览模式也按这个方式来吧。」
     *
     * 曾经只读下把**左键**也当作平移（`readonly && button === 0`），
     * 当时的理由是想让预览态"随手就能拖"。但实测这会带来两个问题：
     *   1. 与编辑界面的操作习惯不一致 —— 同一个插件里两套手势，用户要记两遍；
     *   2. 左键按下即进入平移手势，松开时若位移不足 2px（`hasMoved` 判据），
     *      抑制 click 的逻辑不触发，click/dblclick 会照常派发到卡片上
     *      ⇒ 预览态里"想拖一下画布"却意外触发了卡片上的交互。
     *
     * ⇒ 现在两种模式都只认右键；左键回到它本来的语义（框选 / 卡片交互）。
     */
    if (event.button === 2) {
      /**
       * ★ 右键：平移画布（编辑态与预览态统一）★
       *
       * ★ 为什么必须在**捕获阶段**再补一层 contextmenu 拦截 ★
       *   `preventDefault()` 打在 pointerdown 上**不保证**抑制随后的 contextmenu：
       *   实测（Chromium）在按住右键拖拽时，松开瞬间仍可能弹出系统右键菜单，
       *   而且菜单会**抢走**后续 pointer 事件 ⇒ 手势断在半路，
       *   用户体感就是"右键拖不动画布"（正是「预览模式也按这个方式来吧」的场景）。
       *
       *   这里在 window 上以**捕获**挂一次性的 contextmenu 拦截，
       *   覆盖拖拽全程；手势结束后自动摘掉，不做全局常驻监听。
       *   （CanvasWorkspace 的 `.stage` 上另有 `@contextmenu.prevent`，
       *     但节点内部元素被 `.stop` 过，事件不会一路冒泡到 stage，
       *     所以只靠模板那一层是不够的。）
       */
      event.preventDefault()

      const suppressContextMenu = (menuEvent: Event) => {
        menuEvent.preventDefault()
        menuEvent.stopPropagation()
      }
      window.addEventListener("contextmenu", suppressContextMenu, true)

      const initialX = viewport.x
      const initialY = viewport.y
      startPointerGesture(
        event,
        (dx, dy) => {
          viewport.x = initialX + dx
          viewport.y = initialY + dy
        },
        {
          onEnd: () => {
            // 手势一结束就摘掉；留一个宏任务兜底，避免"松手即弹菜单"漏网
            setTimeout(() => {
              window.removeEventListener("contextmenu", suppressContextMenu, true)
            }, 0)
          },
        },
      )
      return
    }

    if (event.button !== 0 || !isStageGestureTarget(event.target)) {
      return
    }

    /**
     * ★★★ 右下角框选（marquee）在**只读/嵌入（预览）**态下必须禁用 ★★★
     *
     * 用户要求：「嵌入块只做预览」「左右会点中画布里面的块」。
     *
     * 实测（NAS 真机，合成 PointerEvent）：嵌入块里在空白处按住左键拖一个框，
     * `finalizeSelectionBox` 会把框内的节点**全部**选中
     * （11 个节点的画布上 `sel: 1 → 11`），
     * 于是预览态出现满屏选中环 + 选择工具条 —— 正是用户看到的"点中画布里面的块"。
     *
     * 只读态下「框选」本就没有语义（选中了也不能编辑/拖动），
     * 直接在进入手势前返回，连选框都不画。
     * 平移在只读态统一走**右键**（上面 `event.button === 2` 分支已处理），
     * 与用户「预览模式也按右键平移」的要求一致。
     */
    if (!capabilities.value.marquee) {
      return
    }

    const stage = stageRef.value
    if (!stage) {
      return
    }

    event.preventDefault()
    const rect = stage.getBoundingClientRect()
    const startPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    const additive = isAdditiveSelectionGesture(event)

    updateSelectionBox(startPoint, startPoint)
    startPointerGesture(
      event,
      (_dx, _dy, moveEvent) => {
        updateSelectionBox(startPoint, {
          x: moveEvent.clientX - rect.left,
          y: moveEvent.clientY - rect.top,
        })
      },
      {
        onEnd: (_dx, _dy, upEvent) => {
          finalizeSelectionBox(
            startPoint,
            {
              x: upEvent.clientX - rect.left,
              y: upEvent.clientY - rect.top,
            },
            { additive },
          )
        },
      },
    )
  }

  function handleNodePointerDown(node: CanvasNode, event: PointerEvent) {
    if (event.button === 2) {
      startPan(event)
      return
    }

    if (event.button !== 0) {
      return
    }

    // 排除节点上"应该消化点击"的元素：尺寸把手、连接锚点、可交互控件（如链接、按钮、文本输入框等）
    const isInteractive = event.target instanceof HTMLElement && event.target.closest(
      "a, button, input, textarea, select, .canvas-node__resize-handle, .canvas-node__resize-corner, .canvas-node__anchor"
    )
    if (isInteractive) {
      return
    }

    if (!capabilities.value.editDocument) {
      /**
       * ★ 只读下「在卡片上按住左键」— 什么都不做 ★
       *
       * 历史上这里会调 `startPan(event)`，想让预览态"在卡片上也能拖着画布走"。
       * 但走到这一行时 `event.button` 已经被上面钉死为 0（左键），
       * 而 `startPan` 现在只认右键（`button === 2`）⇒ 左键进来只会一路退到
       * `isStageGestureTarget` 检查并返回，**是个死分支**：
       * 读代码的人会以为"左键在卡片上可以平移"，实际什么都不发生。
       *
       * 现在把它写明白：只读下卡片上的左键拖拽**没有语义**（框选/拖拽都被禁用，
       * 平移统一交给右键），直接返回，不再绕经 startPan。
       * 右键在更上面（`event.button === 2`）已经处理过了。
       */
      return
    }

    if (!isNodeGestureTarget(event.target)) {
      return
    }

    if (isCopyDragGesture(event)) {
      event.preventDefault()
      startCopyDrag(node, event)
      return
    }

    if (isAdditiveSelectionGesture(event)) {
      return
    }

    // 阻止浏览器默认行为（如文本选取、原生图片拖拽、HTML5 dragstart），避免穿透到思源宿主
    event.preventDefault()
    startDrag(node, event)
  }

  function startDrag(node: CanvasNode, event: PointerEvent) {
    if (!capabilities.value.editDocument) return
    const selectedNodeIds = resolveDragNodeIds(state.document, node.id, state.selectedNodeIds)
    // 锁存拖拽开始前的初始节点状态，避免拖动过程中的 commit 导致对齐基准抖动
    const initialNodes = [...state.document.nodes]
    const initialPositions = new Map(
      initialNodes
        .filter((candidate) => selectedNodeIds.includes(candidate.id))
        .map((candidate) => [candidate.id, {
          x: candidate.x,
          y: candidate.y,
        }]),
    )
    if (!state.selectedNodeIds.includes(node.id)) {
      state.selectNode(node.id)
    }
    isDragging.value = true
    startPointerGesture(event, (dx, dy, moveEvent) => {
      const rawDelta = resolveDragDelta(dx, dy, { lockAxis: moveEvent.shiftKey })
      const {
        deltaX,
        deltaY,
      } = resolveAlignmentDragDelta({
        deltaX: rawDelta.deltaX,
        deltaY: rawDelta.deltaY,
        movingNodeIds: selectedNodeIds,
        nodes: initialNodes,
      })
      const movedDocument = state.document.nodes.reduce((document, candidate) => {
        const initial = initialPositions.get(candidate.id)
        if (!initial) {
          return document
        }

        return setCanvasNodeGeometry(document, candidate.id, {
          x: initial.x + deltaX,
          y: initial.y + deltaY,
        })
      }, state.document)

      commitDocument(movedDocument, { coalesceKey: `drag-${node.id}` })
    }, {
      onEnd: () => {
        isDragging.value = false
        clearAlignmentGuides()
      },
    })
  }

  function startCopyDrag(node: CanvasNode, event: PointerEvent) {
    if (!capabilities.value.editDocument) return
    const selectedNodeIds = resolveDragNodeIds(state.document, node.id, state.selectedNodeIds)
    const copiedNodes = state.document.nodes
      .filter(candidate => selectedNodeIds.includes(candidate.id))
      .map((candidate) => {
        const copiedNode = cloneCanvasDocument({ nodes: [candidate], edges: [] }).nodes[0]
        return {
          ...copiedNode,
          id: createCopiedNodeId(candidate.id),
        } as CanvasNode
      })

    if (copiedNodes.length === 0) {
      return
    }

    const copiedNodeIds = copiedNodes.map(candidate => candidate.id)
    const initialPositions = new Map(copiedNodes.map(candidate => [candidate.id, {
      x: candidate.x,
      y: candidate.y,
    }]))
    // 锁存拖拽开始前的初始非移动节点列表，避免拖动过程中的 commit 导致对齐基准抖动
    const initialTargetNodes = state.document.nodes.filter(candidate =>
      !copiedNodeIds.includes(candidate.id) && !selectedNodeIds.includes(candidate.id),
    )
    let hasCopied = false

    isDragging.value = true
    startPointerGesture(event, (dx, dy, moveEvent) => {
      const rawDelta = resolveDragDelta(dx, dy, { lockAxis: moveEvent.shiftKey })
      const {
        deltaX,
        deltaY,
      } = resolveAlignmentDragDelta({
        deltaX: rawDelta.deltaX,
        deltaY: rawDelta.deltaY,
        movingNodeIds: copiedNodeIds,
        nodes: [
          ...initialTargetNodes,
          ...copiedNodes,
        ],
      })
      if (deltaX === 0 && deltaY === 0) {
        return
      }
      const movedCopiedNodes = copiedNodes.map((candidate) => {
        const initial = initialPositions.get(candidate.id)!
        return {
          ...candidate,
          x: initial.x + deltaX,
          y: initial.y + deltaY,
        }
      })
      const movedDocument: CanvasDocument = {
        ...state.document,
        nodes: [
          ...state.document.nodes.filter(candidate => !copiedNodeIds.includes(candidate.id)),
          ...movedCopiedNodes,
        ],
      }

      commitDocument(movedDocument, { coalesceKey: `copy-drag-${node.id}` })
      if (!hasCopied) {
        state.selectNodes(copiedNodeIds)
        hasCopied = true
      }
    }, {
      onEnd: () => {
        isDragging.value = false
        clearAlignmentGuides()
      },
    })
  }

  function getStagePoint(event: PointerEvent) {
    const stage = stageRef.value
    if (!stage) {
      return null
    }

    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return null
    }

    const rect = stage.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  function updateConnectionTarget(event: PointerEvent) {
    const stagePoint = getStagePoint(event)
    if (!stagePoint) {
      return
    }

    const canvasPoint = {
      x: toCanvasX(stagePoint.x),
      y: toCanvasY(stagePoint.y),
    }
    const target = findNearestCanvasAnchor(state.document.nodes, canvasPoint, {
      excludeNodeId: connectionDraft.fromNodeId,
      maxDistance: CONNECTION_SNAP_DISTANCE,
    })

    connectionDraft.toNodeId = target?.nodeId || ""
    connectionDraft.toSide = target?.side || "left"
    connectionDraft.toX = target?.x ?? canvasPoint.x
    connectionDraft.toY = target?.y ?? canvasPoint.y
  }

  function getConnectionDraftPath() {
    if (!connectionDraft.visible) {
      return ""
    }

    const fromNode = state.document.nodes.find((node) => node.id === connectionDraft.fromNodeId)
    if (!fromNode) {
      return ""
    }

    const from = getAnchor(fromNode, connectionDraft.fromSide)
    const to = {
      x: toBoardX(board.value, connectionDraft.toX),
      y: toBoardY(board.value, connectionDraft.toY),
    }

    return createEdgeCurvePath(from, connectionDraft.fromSide, to, connectionDraft.toSide)
  }

  function isConnectionTarget(nodeId: string, side: CanvasSide) {
    const isCreationTarget = connectionDraft.visible
      && connectionDraft.toNodeId === nodeId
      && connectionDraft.toSide === side
    const isReconnectTarget = edgeReconnectDraft.visible
      && edgeReconnectDraft.targetNodeId === nodeId
      && edgeReconnectDraft.targetSide === side

    return isCreationTarget || isReconnectTarget
  }

  function getEdgeReconnectDraftPath() {
    if (!edgeReconnectDraft.visible || !edgeReconnectDraft.edgeId || !edgeReconnectDraft.endpoint) {
      return ""
    }

    const edge = state.document.edges.find((candidate) => candidate.id === edgeReconnectDraft.edgeId)
    if (!edge) {
      return ""
    }

    const fixedNode = state.document.nodes.find((node) =>
      node.id === (edgeReconnectDraft.endpoint === "from" ? edge.toNode : edge.fromNode),
    )
    if (!fixedNode) {
      return ""
    }

    const fixedSide = edgeReconnectDraft.endpoint === "from" ? edge.toSide : edge.fromSide
    const movingSide = edgeReconnectDraft.targetSide || "left"
    const fixedPoint = getAnchor(fixedNode, fixedSide)
    const movingPoint = {
      x: edgeReconnectDraft.toX,
      y: edgeReconnectDraft.toY,
    }

    if (edgeReconnectDraft.endpoint === "from") {
      return createEdgeCurvePath(movingPoint, movingSide, fixedPoint, fixedSide)
    }

    return createEdgeCurvePath(fixedPoint, fixedSide, movingPoint, movingSide)
  }

  function finishConnectionDrag() {
    if (!connectionDraft.fromNodeId) {
      clearConnectionDraft()
      return
    }

    if (!connectionDraft.toNodeId) {
      if (autoCreateTextCardOnDrag.value) {
        const fromNode = state.document.nodes.find((node) => node.id === connectionDraft.fromNodeId)
        if (fromNode) {
          const newNode = createCanvasNode("text")
          const W = newNode.width
          const H = newNode.height
          const fromSide = connectionDraft.fromSide
          let toSide: CanvasSide = "left"

          if (fromSide === "right") {
            toSide = "left"
            newNode.x = Math.round(connectionDraft.toX)
            newNode.y = Math.round(connectionDraft.toY - H / 2)
          } else if (fromSide === "left") {
            toSide = "right"
            newNode.x = Math.round(connectionDraft.toX - W)
            newNode.y = Math.round(connectionDraft.toY - H / 2)
          } else if (fromSide === "bottom") {
            toSide = "top"
            newNode.x = Math.round(connectionDraft.toX - W / 2)
            newNode.y = Math.round(connectionDraft.toY)
          } else if (fromSide === "top") {
            toSide = "bottom"
            newNode.x = Math.round(connectionDraft.toX - W / 2)
            newNode.y = Math.round(connectionDraft.toY - H)
          }

          const edge = createCanvasEdge(connectionDraft.fromNodeId, newNode.id)
          edge.fromSide = fromSide
          edge.toSide = toSide

          let updatedDoc = upsertCanvasNode(state.document, newNode)
          updatedDoc = upsertCanvasEdge(updatedDoc, edge)
          commitDocument(updatedDoc)

          state.selectNode(newNode.id)
          state.pendingEditNodeId = newNode.id
        }
      }
      clearConnectionDraft()
      return
    }

    const edge = createCanvasEdge(connectionDraft.fromNodeId, connectionDraft.toNodeId)
    edge.fromSide = connectionDraft.fromSide
    edge.toSide = connectionDraft.toSide
    commitDocument(upsertCanvasEdge(state.document, edge))
    state.selectEdge(edge.id)
    clearConnectionDraft()
  }

  function startConnectionDrag(node: CanvasNode, side: CanvasSide, event: PointerEvent) {
    if (event.button !== 0 || !capabilities.value.editDocument) {
      return
    }

    event.preventDefault?.()
    const anchor = getAnchor(node, side)
    connectionDraft.fromNodeId = node.id
    connectionDraft.fromSide = side
    connectionDraft.toNodeId = ""
    connectionDraft.toSide = "left"
    connectionDraft.toX = anchor.x
    connectionDraft.toY = anchor.y
    connectionDraft.visible = true

    startPointerGesture(
      event,
      (_dx, _dy, moveEvent) => {
        updateConnectionTarget(moveEvent)
      },
      {
        onEnd: (_dx, _dy, upEvent) => {
          updateConnectionTarget(upEvent)
          finishConnectionDrag()
        },
      },
    )
  }

  function updateEdgeReconnectTarget(edge: CanvasEdge, endpoint: "from" | "to", event: PointerEvent) {
    const stagePoint = getStagePoint(event)
    if (!stagePoint) {
      return
    }

    const canvasPoint = {
      x: toCanvasX(stagePoint.x),
      y: toCanvasY(stagePoint.y),
    }
    const oppositeNodeId = endpoint === "from" ? edge.toNode : edge.fromNode
    const target = findNearestCanvasAnchor(state.document.nodes, canvasPoint, {
      maxDistance: CONNECTION_SNAP_DISTANCE,
    })

    edgeReconnectDraft.edgeId = edge.id
    edgeReconnectDraft.endpoint = endpoint
    edgeReconnectDraft.targetNodeId = target?.nodeId || ""
    edgeReconnectDraft.targetSide = target?.side || ""
    edgeReconnectDraft.toX = target ? toBoardX(board.value, target.x) : toBoardX(board.value, canvasPoint.x)
    edgeReconnectDraft.toY = target ? toBoardY(board.value, target.y) : toBoardY(board.value, canvasPoint.y)
    edgeReconnectDraft.visible = true

    if (target?.nodeId === oppositeNodeId) {
      edgeReconnectDraft.targetNodeId = ""
      edgeReconnectDraft.targetSide = ""
      edgeReconnectDraft.toX = toBoardX(board.value, canvasPoint.x)
      edgeReconnectDraft.toY = toBoardY(board.value, canvasPoint.y)
    }
  }

  function finishEdgeEndpointDrag(edge: CanvasEdge, endpoint: "from" | "to") {
    if (!edgeReconnectDraft.targetNodeId || !edgeReconnectDraft.targetSide) {
      commitDocument(removeCanvasEdge(state.document, edge.id))
      state.selectEdge()
      clearEdgeReconnectDraft()
      return
    }

    commitDocument(setCanvasEdgeEndpoint(state.document, edge.id, endpoint, {
      nodeId: edgeReconnectDraft.targetNodeId,
      side: edgeReconnectDraft.targetSide,
    }))
    state.selectEdge(edge.id)
    clearEdgeReconnectDraft()
  }

  function startEdgeEndpointDrag(endpoint: "from" | "to", event: PointerEvent) {
    if (event.button !== 0 || !capabilities.value.editDocument) {
      return
    }

    const edge = selectedEdge.value
    if (!edge) {
      return
    }

    event.preventDefault?.()
    clearEdgeReconnectDraft()

    startPointerGesture(
      event,
      (_dx, _dy, moveEvent) => {
        updateEdgeReconnectTarget(edge, endpoint, moveEvent)
      },
      {
        onEnd: (_dx, _dy, upEvent) => {
          updateEdgeReconnectTarget(edge, endpoint, upEvent)
          finishEdgeEndpointDrag(edge, endpoint)
        },
      },
    )
  }

  function startResize(node: CanvasNode, side: CanvasSide, event: PointerEvent) {
    if (event.button !== 0 || !capabilities.value.editDocument) {
      return
    }

    event.preventDefault?.()
    isDragging.value = true
    startPointerGesture(event, (dx, dy) => {
      commitDocument(
        setCanvasNodeGeometry(
          state.document,
          node.id,
          // 传网格设置：开了吸附时，正在拖的那条边会吸到网格线上
          resizeCanvasNodeFromSide(node, side, dx / viewport.scale, dy / viewport.scale, gridSettings.value),
        ),
        { coalesceKey: `resize-${node.id}-${side}` },
      )
    }, {
      onEnd: () => {
        isDragging.value = false
      },
    })
  }

  function startCornerResize(node: CanvasNode, event: PointerEvent) {
    if (event.button !== 0 || !capabilities.value.editDocument) {
      return
    }

    event.preventDefault?.()
    isDragging.value = true
    startPointerGesture(event, (dx, dy) => {
      commitDocument(
        setCanvasNodeGeometry(
          state.document,
          node.id,
          // 角缩放同理：右下两条边分别吸网格
          resizeCanvasNodeFromCorner(node, dx / viewport.scale, dy / viewport.scale, gridSettings.value),
        ),
        { coalesceKey: `resize-corner-${node.id}` },
      )
    }, {
      onEnd: () => {
        isDragging.value = false
      },
    })
  }

  return {
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
  }
}
