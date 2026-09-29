/* @vitest-environment jsdom */

import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  computed,
  ref,
  reactive,
} from 'vue'

import { createCanvasEditorGestureHandlers } from '@/canvas/use-canvas-editor-gestures'
import type { CanvasGridSettings } from '@/canvas/grid'
import { DEFAULT_CANVAS_GRID_SETTINGS } from '@/canvas/grid'
import { resolveCanvasInteractionPolicy } from '@/canvas/canvas-interaction-policy'
import type { CanvasNode } from '@/canvas/types'

/**
 * 由「是否只读」构造完整能力集（测试便捷函数）。
 *
 * ★ 为什么不再直接传 `readonly` ★
 *   手势层的依赖已从裸布尔 `readonly` 改为具名能力 `capabilities`
 *   （见 canvas-interaction-policy.ts）。这里用**冲突态**代表"只读"这一通用来源，
 *   因为它不影响 `persist` / `openNodeTab`（那两个只受 embed 影响），
 *   与这些用例关心的语义（能不能改文档 / 能不能框选）最贴合。
 */
function capsFor(readonly: boolean) {
  return resolveCanvasInteractionPolicy({
    conflict: readonly,
    mobile: false,
    embed: false,
  }).capabilities
}

function createGestureHarness(
  nodes: CanvasNode[],
  selectedNodeIds: string[] = [],
  options: {
    showDragAlignmentGuides?: boolean
    autoCreateTextCardOnDrag?: boolean
    grid?: Partial<CanvasGridSettings>
  } = {},
) {
  const stage = document.createElement('div')
  const viewport = { scale: 1, x: 0, y: 0 }
  const alignmentGuides = {
    guides: [],
    visible: false,
  }
  const showDragAlignmentGuides = ref(options.showDragAlignmentGuides ?? true)
  const autoCreateTextCardOnDrag = ref(options.autoCreateTextCardOnDrag ?? false)
  /**
   * 网格设置。默认取 `DEFAULT_CANVAS_GRID_SETTINGS`（吸附关闭）——
   * 从真实常量派生，将来默认值变了这里自动跟上，不会静默用一份写死的假值。
   */
  const gridSettings = ref<CanvasGridSettings>({ ...DEFAULT_CANVAS_GRID_SETTINGS, ...options.grid })
  const connectionDraft = reactive({
    fromNodeId: '',
    fromSide: 'left' as const,
    toNodeId: '',
    toSide: 'left' as const,
    toX: 0,
    toY: 0,
    visible: false,
  })
  const state = {
    document: {
      nodes: [...nodes],
      edges: [],
    },
    selectNode: vi.fn((id: string) => {
      state.selectedNodeIds = [id]
    }),
    selectNodes: vi.fn((ids: string[]) => {
      state.selectedNodeIds = [...ids]
    }),
    selectedNodeIds: [...selectedNodeIds],
    pendingEditNodeId: '',
  }
  const commitDocument = vi.fn((document) => {
    state.document = document
  })
  const handlers = createCanvasEditorGestureHandlers({
    board: computed(() => ({ height: 2400, left: 0, top: 0, width: 3200 })),
    alignmentGuides,
    commitDocument,
    connectionDraft,
    edgeReconnectDraft: {} as any,
    getAnchor: vi.fn((node, side) => {
      if (side === 'left') return { x: node.x, y: node.y + node.height / 2 }
      if (side === 'right') return { x: node.x + node.width, y: node.y + node.height / 2 }
      if (side === 'top') return { x: node.x + node.width / 2, y: node.y }
      if (side === 'bottom') return { x: node.x + node.width / 2, y: node.y + node.height }
      return { x: node.x, y: node.y }
    }),
    capabilities: computed(() => capsFor(false)),
    selectionBox: {} as any,
    selectedEdge: computed(() => null),
    stageRef: ref(stage),
    state: state as any,
    viewport,
    showDragAlignmentGuides: computed(() => showDragAlignmentGuides.value),
    autoCreateTextCardOnDrag: computed(() => autoCreateTextCardOnDrag.value),
    gridSettings,
    showNodeHeader: computed(() => false),
  })

  return {
    commitDocument,
    alignmentGuides,
    handlers,
    stage,
    state,
    viewport,
    showDragAlignmentGuides,
  }
}

describe('canvas editor gesture handlers', () => {
  describe('wheel navigation', () => {
    const stageRect = {
      bottom: 440,
      height: 400,
      left: 40,
      right: 640,
      top: 40,
      width: 600,
      x: 40,
      y: 40,
      toJSON: () => ({}),
    }

    function createWheelHarness(nodes: CanvasNode[] = []) {
      const harness = createGestureHarness(nodes)
      harness.stage.getBoundingClientRect = vi.fn(() => stageRect)
      // 光标落在 stage 内的 (150, 120)，视口初始偏移为 (10, 20)
      harness.viewport.x = 10
      harness.viewport.y = 20
      return harness
    }

    function createWheelEvent(init: {
      clientX?: number
      clientY?: number
      ctrlKey?: boolean
      deltaMode?: number
      deltaX?: number
      deltaY?: number
    } = {}) {
      return {
        clientX: 190,
        clientY: 160,
        ctrlKey: false,
        deltaMode: 0,
        deltaX: 0,
        deltaY: 0,
        preventDefault: vi.fn(),
        ...init,
      } as unknown as WheelEvent & { preventDefault: ReturnType<typeof vi.fn> }
    }

    it('pans the canvas on a trackpad two-finger swipe without changing the scale', () => {
      const { handlers, viewport } = createWheelHarness()
      const event = createWheelEvent({ deltaX: 12, deltaY: 4 })

      handlers.handleStageWheel(event)

      // 画布已消费该手势，需阻止浏览器把横向滑动解释为前进/后退
      expect(event.preventDefault).toHaveBeenCalled()
      expect(viewport.x).toBe(10 - 12)
      expect(viewport.y).toBe(20 - 4)
      expect(viewport.scale).toBe(1)

      handlers.handleStageWheel(createWheelEvent({ deltaY: 30 }))
      expect(viewport.x).toBe(10 - 12)
      expect(viewport.y).toBe(20 - 4 - 30)
      expect(viewport.scale).toBe(1)
    })

    it('keeps zooming around the cursor on a mouse wheel', () => {
      const { handlers, viewport } = createWheelHarness()
      const event = createWheelEvent({ deltaY: 120 })

      handlers.handleStageWheel(event)

      expect(event.preventDefault).toHaveBeenCalled()
      expect(viewport.scale).toBeCloseTo(0.8353, 4)
      expect((150 - viewport.x) / viewport.scale).toBeCloseTo(140)
      expect((120 - viewport.y) / viewport.scale).toBeCloseTo(100)
    })

    it('zooms around the cursor on a trackpad pinch', () => {
      const { handlers, viewport } = createWheelHarness()

      handlers.handleStageWheel(createWheelEvent({ ctrlKey: true, deltaY: 120 }))

      expect(viewport.scale).toBeCloseTo(0.8353, 4)
      expect((150 - viewport.x) / viewport.scale).toBeCloseTo(140)
      expect((120 - viewport.y) / viewport.scale).toBeCloseTo(100)
    })

    it('lets the pinch branch win when the delta looks like a trackpad swipe', () => {
      const { handlers, viewport } = createWheelHarness()

      // 带横向分量本会判为触控板，但 ctrlKey 优先，应当缩放而不是平移
      handlers.handleStageWheel(createWheelEvent({ ctrlKey: true, deltaX: 4, deltaY: -8 }))

      expect(viewport.scale).toBeGreaterThan(1)
      expect((150 - viewport.x) / viewport.scale).toBeCloseTo(140)
      expect((120 - viewport.y) / viewport.scale).toBeCloseTo(100)
    })

    it('zooms on a line-mode mouse wheel instead of stalling at the current scale', () => {
      const { handlers, viewport } = createWheelHarness()

      // Firefox 鼠标滚轮上报 ±3 行，折算为 48 像素；不折算会几乎不动，保留取整则完全不动
      handlers.handleStageWheel(createWheelEvent({ deltaMode: 1, deltaY: 3 }))

      expect(viewport.scale).not.toBe(1)
      expect(viewport.scale).toBeCloseTo(Math.exp(-48 * 0.0015), 4)
    })

    it('keeps panning when a fast flick emits a mouse-sized delta mid-gesture', () => {
      const { handlers, viewport } = createWheelHarness()

      // 首个事件是小增量，判定为触控板并锁存，后续的满刻度增量不应改判为缩放
      handlers.handleStageWheel(createWheelEvent({ deltaY: 8 }))
      handlers.handleStageWheel(createWheelEvent({ deltaY: 120 }))

      expect(viewport.scale).toBe(1)
      expect(viewport.y).toBe(20 - 8 - 120)
    })

    it('ignores wheel events without displacement', () => {
      const { handlers, viewport } = createWheelHarness()
      const event = createWheelEvent()

      handlers.handleStageWheel(event)

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(viewport.x).toBe(10)
      expect(viewport.y).toBe(20)
      expect(viewport.scale).toBe(1)
    })

    it('freezes the viewport while a card is being dragged', () => {
      const node = { height: 80, id: 'node-1', type: 'text', width: 100, x: 50, y: 60 } as CanvasNode
      const { handlers, viewport } = createWheelHarness([node])
      const pointerDownEvent = new PointerEvent('pointerdown', {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      })
      Object.defineProperty(pointerDownEvent, 'target', { value: document.createElement('div') })

      handlers.handleNodePointerDown(node, pointerDownEvent)
      expect(handlers.isDragging.value).toBe(true)

      // 拖拽期间改变缩放会让卡片位移换算跳变，因此滚轮不生效
      handlers.handleStageWheel(createWheelEvent({ deltaY: 120 }))
      expect(viewport.scale).toBe(1)
      expect(viewport.y).toBe(20)

      window.dispatchEvent(new PointerEvent('pointerup', {
        clientX: 100,
        clientY: 100,
      }))
      expect(handlers.isDragging.value).toBe(false)
    })

    it('clamps the scale on the zoom path', () => {
      const { handlers, viewport } = createWheelHarness()

      for (let index = 0; index < 12; index += 1) {
        handlers.handleStageWheel(createWheelEvent({ ctrlKey: true, deltaY: -120 }))
      }

      expect(viewport.scale).toBe(2.5)
    })

    it('applies trackpad pan deltas without clamping the offset', () => {
      const { handlers, viewport } = createWheelHarness()

      // 与 startPan 一致，平移不做边界收敛
      handlers.handleStageWheel(createWheelEvent({ deltaX: 4000 }))

      expect(viewport.x).toBe(10 - 4000)
    })
  })

  it('pans the canvas with the right button, in readonly and editable mode alike', () => {
    /**
     * ★ 规格已变更（用户要求）★
     *
     * 旧规格：只读下**左键**在卡片上拖拽 = 平移画布。
     * 新规格：「编辑界面是右键按住可以平移画布。预览模式也按这个方式来吧。」
     *   ⇒ 两种模式**统一**为右键平移；左键回到它本来的语义。
     *
     * 这个用例现在同时覆盖两件事：
     *   1. 右键（button 2）在卡片上按下 → 平移生效（编辑态与只读态都要）
     *   2. 左键（button 0）在只读态的卡片上按下 → **什么都不做**（不平移、不改文档）
     */
    function setup(readonlyValue: boolean) {
      const stage = document.createElement('div')
      const viewport = { scale: 1, x: 0, y: 0 }
      const commitDocument = vi.fn()

      const handlers = createCanvasEditorGestureHandlers({
        alignmentGuides: {
          guides: [],
          visible: false,
        },
        board: computed(() => ({ height: 2400, left: 0, top: 0, width: 3200 })),
        commitDocument,
        connectionDraft: {} as any,
        edgeReconnectDraft: {} as any,
        getAnchor: vi.fn(),
        capabilities: computed(() => capsFor(readonlyValue)),
        selectionBox: {} as any,
        selectedEdge: computed(() => null),
        showDragAlignmentGuides: computed(() => true),
      gridSettings: ref({ ...DEFAULT_CANVAS_GRID_SETTINGS }),
        gridSettings: ref({ ...DEFAULT_CANVAS_GRID_SETTINGS }),
        stageRef: ref(stage),
        state: {
          document: {
            nodes: [],
            edges: [],
          },
          selectNode: vi.fn(),
          selectedNodeIds: [],
        } as any,
        viewport,
        showNodeHeader: computed(() => true),
      })

      return { handlers, viewport, commitDocument }
    }

    const node = { id: 'node-1', type: 'text', x: 50, y: 50, width: 100, height: 100 }

    // ── 1) 右键：编辑态平移 ──
    {
      const { handlers, viewport, commitDocument } = setup(false)
      const target = document.createElement('button')
      const down = new PointerEvent('pointerdown', { button: 2, clientX: 100, clientY: 100, bubbles: true })
      Object.defineProperty(down, 'target', { value: target })
      handlers.handleNodePointerDown(node as any, down)

      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 170 }))
      window.dispatchEvent(new PointerEvent('pointerup', { button: 2, clientX: 150, clientY: 170 }))

      expect(viewport.x).toBe(50)
      expect(viewport.y).toBe(70)
      expect(commitDocument).not.toHaveBeenCalled()
    }

    // ── 2) 右键：只读态同样平移（预览模式按同一方式） ──
    {
      const { handlers, viewport, commitDocument } = setup(true)
      const target = document.createElement('button')
      const down = new PointerEvent('pointerdown', { button: 2, clientX: 100, clientY: 100, bubbles: true })
      Object.defineProperty(down, 'target', { value: target })
      handlers.handleNodePointerDown(node as any, down)

      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 130, clientY: 140 }))
      window.dispatchEvent(new PointerEvent('pointerup', { button: 2, clientX: 130, clientY: 140 }))

      expect(viewport.x).toBe(30)
      expect(viewport.y).toBe(40)
      expect(commitDocument).not.toHaveBeenCalled()
    }

    // ── 3) 左键 + 只读：不得平移、不得改文档 ──
    {
      const { handlers, viewport, commitDocument } = setup(true)
      const target = document.createElement('div')
      const down = new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true })
      Object.defineProperty(down, 'target', { value: target })
      handlers.handleNodePointerDown(node as any, down)

      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 170 }))
      window.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 150, clientY: 170 }))

      expect(viewport.x).toBe(0)
      expect(viewport.y).toBe(0)
      expect(commitDocument).not.toHaveBeenCalled()
    }
  })

  it('drags the node when showNodeHeader is false and clicking on selectable body', () => {
    const stage = document.createElement('div')
    const viewport = { scale: 1, x: 0, y: 0 }
    const commitDocument = vi.fn()
    const node = { id: 'node-1', type: 'text', x: 50, y: 50, width: 100, height: 100 }

    const handlers = createCanvasEditorGestureHandlers({
      alignmentGuides: {
        guides: [],
        visible: false,
      },
      board: computed(() => ({ height: 2400, left: 0, top: 0, width: 3200 })),
      commitDocument,
      connectionDraft: {} as any,
      edgeReconnectDraft: {} as any,
      getAnchor: vi.fn(),
      capabilities: computed(() => capsFor(false)),
      selectionBox: {} as any,
      selectedEdge: computed(() => null),
      showDragAlignmentGuides: computed(() => true),
      gridSettings: ref({ ...DEFAULT_CANVAS_GRID_SETTINGS }),
      stageRef: ref(stage),
      state: {
        document: {
          nodes: [node],
          edges: [],
        },
        selectNode: vi.fn(),
        selectedNodeIds: [],
      } as any,
      viewport,
      showNodeHeader: computed(() => false),
    })

    // Click target has selectable class
    const target = document.createElement('div')
    target.className = 'canvas-node__body--selectable'
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: target })

    handlers.handleNodePointerDown(node as any, pointerDownEvent)

    // Simulate pointermove
    const pointerMoveEvent = new PointerEvent('pointermove', {
      clientX: 150,
      clientY: 170,
    })
    window.dispatchEvent(pointerMoveEvent)

    // When showNodeHeader is false, selectable body is not excluded, so it should drag the node
    expect(commitDocument).toHaveBeenCalled()
    expect(viewport.x).toBe(0) // Viewport should not pan
  })

  it('does not drag the node when showNodeHeader is true and clicking on selectable body', () => {
    const stage = document.createElement('div')
    const viewport = { scale: 1, x: 0, y: 0 }
    const commitDocument = vi.fn()
    const node = { id: 'node-1', type: 'text', x: 50, y: 50, width: 100, height: 100 }

    const handlers = createCanvasEditorGestureHandlers({
      alignmentGuides: {
        guides: [],
        visible: false,
      },
      board: computed(() => ({ height: 2400, left: 0, top: 0, width: 3200 })),
      commitDocument,
      connectionDraft: {} as any,
      edgeReconnectDraft: {} as any,
      getAnchor: vi.fn(),
      capabilities: computed(() => capsFor(false)),
      selectionBox: {} as any,
      selectedEdge: computed(() => null),
      showDragAlignmentGuides: computed(() => true),
      gridSettings: ref({ ...DEFAULT_CANVAS_GRID_SETTINGS }),
      stageRef: ref(stage),
      state: {
        document: {
          nodes: [node],
          edges: [],
        },
        selectNode: vi.fn(),
        selectedNodeIds: [],
      } as any,
      viewport,
      showNodeHeader: computed(() => true),
    })

    // Click target has selectable class
    const target = document.createElement('div')
    target.className = 'canvas-node__body--selectable'
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: target })

    handlers.handleNodePointerDown(node as any, pointerDownEvent)

    // Simulate pointermove
    const pointerMoveEvent = new PointerEvent('pointermove', {
      clientX: 150,
      clientY: 170,
    })
    window.dispatchEvent(pointerMoveEvent)

    // When showNodeHeader is true, selectable body is excluded, so it should neither drag nor pan
    expect(commitDocument).not.toHaveBeenCalled()
    expect(viewport.x).toBe(0)
  })

  it('copies the dragged card when holding ctrl', () => {
    const node = { id: 'node-1', type: 'text', x: 50, y: 60, width: 100, height: 80 } as CanvasNode
    const { commitDocument, handlers, state } = createGestureHarness([node])
    const target = document.createElement('div')
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: target })

    handlers.handleNodePointerDown(node, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 140,
      clientY: 130,
      ctrlKey: true,
    }))

    expect(commitDocument).toHaveBeenCalled()
    expect(state.document.nodes).toHaveLength(2)
    expect(state.document.nodes[0]).toMatchObject({ id: 'node-1', x: 50, y: 60 })
    expect(state.document.nodes[1]).toMatchObject({ x: 90, y: 90 })
    expect(state.document.nodes[1]?.id).not.toBe('node-1')
    expect(state.selectedNodeIds).toEqual([state.document.nodes[1]?.id])
  })

  it('does not copy or change selection when ctrl-clicking a card without dragging', () => {
    const node = { id: 'node-1', type: 'text', x: 50, y: 60, width: 100, height: 80 } as CanvasNode
    const { commitDocument, handlers, state } = createGestureHarness([node], ['node-1'])
    const target = document.createElement('div')
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: target })

    handlers.handleNodePointerDown(node, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
    }))

    expect(commitDocument).not.toHaveBeenCalled()
    expect(state.document.nodes).toHaveLength(1)
    expect(state.selectedNodeIds).toEqual(['node-1'])
  })

  it('copies the selected card group when ctrl-dragging one selected card', () => {
    const firstNode = { id: 'node-1', type: 'text', x: 50, y: 60, width: 100, height: 80 } as CanvasNode
    const secondNode = { id: 'node-2', type: 'text', x: 220, y: 90, width: 100, height: 80 } as CanvasNode
    const { handlers, state } = createGestureHarness([firstNode, secondNode], ['node-1', 'node-2'])
    const target = document.createElement('div')
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: target })

    handlers.handleNodePointerDown(firstNode, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 140,
      clientY: 130,
      ctrlKey: true,
    }))

    expect(state.document.nodes).toHaveLength(4)
    expect(state.document.nodes[0]).toMatchObject({ id: 'node-1', x: 50, y: 60 })
    expect(state.document.nodes[1]).toMatchObject({ id: 'node-2', x: 220, y: 90 })
    expect(state.document.nodes[2]).toMatchObject({ x: 90, y: 90 })
    expect(state.document.nodes[3]).toMatchObject({ x: 260, y: 120 })
    expect(state.selectedNodeIds).toEqual([
      state.document.nodes[2]?.id,
      state.document.nodes[3]?.id,
    ])
  })

  it('copies the dragged card horizontally when holding ctrl and shift with wider x movement', () => {
    const node = { id: 'node-1', type: 'text', x: 50, y: 60, width: 100, height: 80 } as CanvasNode
    const { handlers, state } = createGestureHarness([node])
    const target = document.createElement('div')
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: target })

    handlers.handleNodePointerDown(node, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 180,
      clientY: 130,
      ctrlKey: true,
      shiftKey: true,
    }))

    expect(state.document.nodes).toHaveLength(2)
    expect(state.document.nodes[1]).toMatchObject({ x: 130, y: 60 })
  })

  it('copies the dragged card vertically when holding ctrl and shift with taller y movement', () => {
    const node = { id: 'node-1', type: 'text', x: 50, y: 60, width: 100, height: 80 } as CanvasNode
    const { handlers, state } = createGestureHarness([node])
    const target = document.createElement('div')
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: target })

    handlers.handleNodePointerDown(node, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 125,
      clientY: 170,
      ctrlKey: true,
      shiftKey: true,
    }))

    expect(state.document.nodes).toHaveLength(2)
    expect(state.document.nodes[1]).toMatchObject({ x: 50, y: 130 })
  })

  it('snaps a dragged card to nearby vertical alignment guides', () => {
    const moving = { id: 'moving', type: 'text', x: 106, y: 220, width: 100, height: 80 } as CanvasNode
    const target = { id: 'target', type: 'text', x: 100, y: 20, width: 100, height: 80 } as CanvasNode
    const { alignmentGuides, handlers, state } = createGestureHarness([moving, target])
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: document.createElement('div') })

    handlers.handleNodePointerDown(moving, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 97,
      clientY: 100,
    }))

    expect(state.document.nodes[0]).toMatchObject({ x: 100, y: 220 })
    expect(alignmentGuides.visible).toBe(true)
    expect(alignmentGuides.guides).toEqual([
      { axis: 'x', kind: 'left', position: 100 },
    ])

    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 97,
      clientY: 100,
    }))

    expect(alignmentGuides.visible).toBe(false)
    expect(alignmentGuides.guides).toEqual([])
  })

  it('does not snap or show guides when drag alignment guides are disabled', () => {
    const moving = { id: 'moving', type: 'text', x: 106, y: 220, width: 100, height: 80 } as CanvasNode
    const target = { id: 'target', type: 'text', x: 100, y: 20, width: 100, height: 80 } as CanvasNode
    const { alignmentGuides, handlers, state } = createGestureHarness([moving, target], [], {
      showDragAlignmentGuides: false,
    })
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: document.createElement('div') })

    handlers.handleNodePointerDown(moving, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 97,
      clientY: 100,
    }))

    expect(state.document.nodes[0]).toMatchObject({ x: 103, y: 220 })
    expect(alignmentGuides.visible).toBe(false)
    expect(alignmentGuides.guides).toEqual([])
  })

  /**
   * ★ 缩放（resize）也要吃网格吸附 ★
   *
   *   纯函数测试证明「算得对」，不能证明「拖边框的时候真的传了网格设置进去」。
   *   这一条走完整手势链路：startResize → pointermove → commitDocument。
   *   卡片 x=50（不在 32 的格上）是关键：只有「吸边坐标」才能让右边落到 384。
   */
  it('snaps the dragged edge to the grid while resizing (and leaves it alone when snap is off)', () => {
    const node = { id: 'moving', type: 'text', x: 50, y: 50, width: 300, height: 200 } as CanvasNode

    // ① 开吸附：右边 50+300+37=387 ⇒ 吸到 384
    const snapped = createGestureHarness([{ ...node }], [], { grid: { size: 32, snap: true } })
    const downSnap = new PointerEvent('pointerdown', { button: 0, clientX: 350, clientY: 150, bubbles: true })
    Object.defineProperty(downSnap, 'target', { value: document.createElement('div') })
    snapped.handlers.startResize(node, 'right', downSnap)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 387, clientY: 150 }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 387, clientY: 150 }))
    const snappedGeometry = snapped.state.document.nodes[0]
    expect(snappedGeometry.x).toBe(50)
    expect(snappedGeometry.x + snappedGeometry.width).toBe(384)

    // ② 关吸附（对照组）：同样位移必须原样保留
    const plain = createGestureHarness([{ ...node }], [], { grid: { size: 32, snap: false } })
    const downPlain = new PointerEvent('pointerdown', { button: 0, clientX: 350, clientY: 150, bubbles: true })
    Object.defineProperty(downPlain, 'target', { value: document.createElement('div') })
    plain.handlers.startResize(node, 'right', downPlain)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 387, clientY: 150 }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 387, clientY: 150 }))
    expect(plain.state.document.nodes[0]).toMatchObject({ width: 337, x: 50 })
  })
  /**
   * ★ 缩放（resize）也要吃网格吸附 ★
   *
   *   纯函数测试证明「算得对」，不能证明「拖边框的时候真的传了网格设置进去」。
   *   这一条走完整手势链路：startResize → pointermove → commitDocument。
   *   卡片 x=50（不在 32 的格上）是关键：只有「吸边坐标」才能让右边落到 384。
   */
  it('snaps the dragged edge to the grid while resizing (and leaves it alone when snap is off)', () => {
    const node = { id: 'moving', type: 'text', x: 50, y: 50, width: 300, height: 200 } as CanvasNode

    // ① 开吸附：右边 50+300+37=387 ⇒ 吸到 384
    const snapped = createGestureHarness([{ ...node }], [], { grid: { size: 32, snap: true } })
    const downSnap = new PointerEvent('pointerdown', { button: 0, clientX: 350, clientY: 150, bubbles: true })
    Object.defineProperty(downSnap, 'target', { value: document.createElement('div') })
    snapped.handlers.startResize(node, 'right', downSnap)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 387, clientY: 150 }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 387, clientY: 150 }))
    const snappedGeometry = snapped.state.document.nodes[0]
    expect(snappedGeometry.x).toBe(50)
    expect(snappedGeometry.x + snappedGeometry.width).toBe(384)

    // ② 关吸附（对照组）：同样位移必须原样保留
    const plain = createGestureHarness([{ ...node }], [], { grid: { size: 32, snap: false } })
    const downPlain = new PointerEvent('pointerdown', { button: 0, clientX: 350, clientY: 150, bubbles: true })
    Object.defineProperty(downPlain, 'target', { value: document.createElement('div') })
    plain.handlers.startResize(node, 'right', downPlain)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 387, clientY: 150 }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 387, clientY: 150 }))
    expect(plain.state.document.nodes[0]).toMatchObject({ width: 337, x: 50 })
  })
  /**
   * 网格吸附（走**手势层**，不是只测纯函数）。
   *
   * 纯函数测试只能证明"算得对"，证明不了"拖卡片的时候真的调用了它"。
   * 这一组补上后者 —— 本轮加网格吸附时，正是因为没加它，
   * `gridSettings` 少传一处也全绿（纯函数照样通过）。
   */
  it('snaps a dragged card onto the grid when grid snap is enabled', () => {
    // 起点不在格上（50）：必须能吸上去 —— 这是"落点取整"与"位移取整"的分水岭
    const moving = { id: 'moving', type: 'text', x: 50, y: 50, width: 100, height: 80 } as CanvasNode
    const { handlers, state } = createGestureHarness([moving], [], { grid: { size: 32, snap: true } })
    const pointerDownEvent = new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true })
    Object.defineProperty(pointerDownEvent, 'target', { value: document.createElement('div') })

    handlers.handleNodePointerDown(moving, pointerDownEvent)
    // 位移只有 5px：50+5=55 ⇒ 吸到 64（若按位移取整则会停在 50，永远吸不上去）
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 105, clientY: 105 }))

    expect(state.document.nodes[0]).toMatchObject({ x: 64, y: 64 })
  })

  it('does not snap when grid snap is disabled (control)', () => {
    const moving = { id: 'moving', type: 'text', x: 50, y: 50, width: 100, height: 80 } as CanvasNode
    const { handlers, state } = createGestureHarness([moving], [], { grid: { size: 32, snap: false } })
    const pointerDownEvent = new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true })
    Object.defineProperty(pointerDownEvent, 'target', { value: document.createElement('div') })

    handlers.handleNodePointerDown(moving, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 105, clientY: 105 }))

    // 对照组：关掉吸附必须是原始位移（5px），证明上一条的 64 确实来自吸附
    expect(state.document.nodes[0]).toMatchObject({ x: 55, y: 55 })
  })

  it('grid snap respects the configured spacing (a coarser grid snaps further)', () => {
    const moving = { id: 'moving', type: 'text', x: 50, y: 50, width: 100, height: 80 } as CanvasNode
    const { handlers, state } = createGestureHarness([moving], [], { grid: { size: 48, snap: true } })
    const pointerDownEvent = new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true })
    Object.defineProperty(pointerDownEvent, 'target', { value: document.createElement('div') })

    handlers.handleNodePointerDown(moving, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 105, clientY: 105 }))

    // 50+5=55 ⇒ 最近的 48 的倍数是 48（55 到 48 差 7，到 96 差 41）
    expect(state.document.nodes[0]).toMatchObject({ x: 48, y: 48 })
  })

  /**
   * ★ 优先级：对齐辅助线**优先于**网格吸附 ★
   *
   * 辅助线是"我在跟旁边的卡片对齐"，是更强的意图，阈值只有屏幕 8px；
   * 网格只是背景参考。若顺序反过来（先辅助线后网格），
   * 刚对齐好的边会被网格再推走 —— 等于辅助线白开。
   */
  it('lets alignment guides win over grid snap when both are enabled', () => {
    const moving = { id: 'moving', type: 'text', x: 106, y: 220, width: 100, height: 80 } as CanvasNode
    const target = { id: 'target', type: 'text', x: 100, y: 20, width: 100, height: 80 } as CanvasNode
    const { alignmentGuides, handlers, state } = createGestureHarness(
      [moving, target],
      [],
      { grid: { size: 32, snap: true }, showDragAlignmentGuides: true },
    )
    const pointerDownEvent = new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true })
    Object.defineProperty(pointerDownEvent, 'target', { value: document.createElement('div') })

    handlers.handleNodePointerDown(moving, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 97, clientY: 100 }))

    /**
     * 两个轴的结果**不同**，正好把顺序说清楚：
     *   x：106-3=103 ⇒ 网格吸到 96 ⇒ 被 left 辅助线（100，距离 4px < 8px 阈值）拉回 100 ⇒ **辅助线赢**
     *   y：位移为 0 ⇒ 220 被网格吸到 224 ⇒ 没有横向辅助线纠正 ⇒ 保持吸附结果
     * 若顺序反过来（先辅助线后网格），x 会从 100 被再推回 96 —— 这条断言就会红。
     */
    expect(state.document.nodes[0]).toMatchObject({ x: 100, y: 224 })
    expect(alignmentGuides.guides).toEqual([{ axis: 'x', kind: 'left', position: 100 }])
  })

  it('snaps selected group bounds while dragging multiple cards', () => {
    const firstNode = { id: 'node-1', type: 'text', x: 306, y: 60, width: 100, height: 80 } as CanvasNode
    const secondNode = { id: 'node-2', type: 'text', x: 456, y: 80, width: 100, height: 80 } as CanvasNode
    const target = { id: 'target', type: 'text', x: 300, y: 280, width: 120, height: 80 } as CanvasNode
    const { alignmentGuides, handlers, state } = createGestureHarness([firstNode, secondNode, target], ['node-1', 'node-2'])
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: document.createElement('div') })

    handlers.handleNodePointerDown(firstNode, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 97,
      clientY: 100,
    }))

    expect(state.document.nodes[0]).toMatchObject({ x: 300, y: 60 })
    expect(state.document.nodes[1]).toMatchObject({ x: 450, y: 80 })
    expect(alignmentGuides.guides).toEqual([
      { axis: 'x', kind: 'left', position: 300 },
    ])
  })

  it('snaps copied cards to alignment guides while ctrl-dragging', () => {
    const moving = { id: 'moving', type: 'text', x: 106, y: 220, width: 100, height: 80 } as CanvasNode
    const target = { id: 'target', type: 'text', x: 100, y: 20, width: 100, height: 80 } as CanvasNode
    const { alignmentGuides, handlers, state } = createGestureHarness([moving, target])
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: document.createElement('div') })

    handlers.handleNodePointerDown(moving, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 97,
      clientY: 100,
      ctrlKey: true,
    }))

    expect(state.document.nodes).toHaveLength(3)
    expect(state.document.nodes[2]).toMatchObject({ x: 100, y: 220 })
    expect(alignmentGuides.guides).toEqual([
      { axis: 'x', kind: 'left', position: 100 },
    ])
  })


  it('reacts to drag alignment guide setting changes in the current canvas', () => {
    const moving = { id: 'moving', type: 'text', x: 106, y: 220, width: 100, height: 80 } as CanvasNode
    const target = { id: 'target', type: 'text', x: 100, y: 20, width: 100, height: 80 } as CanvasNode
    const { alignmentGuides, handlers, showDragAlignmentGuides, state } = createGestureHarness([moving, target], [], {
      showDragAlignmentGuides: false,
    })
    const pointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    })
    Object.defineProperty(pointerDownEvent, 'target', { value: document.createElement('div') })

    handlers.handleNodePointerDown(moving, pointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 97,
      clientY: 100,
    }))

    expect(state.document.nodes[0]).toMatchObject({ x: 103, y: 220 })
    expect(alignmentGuides.visible).toBe(false)

    showDragAlignmentGuides.value = true
    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: 97,
      clientY: 100,
    }))

    const secondPointerDownEvent = new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    })
    Object.defineProperty(secondPointerDownEvent, 'target', { value: document.createElement('div') })
    handlers.handleNodePointerDown(moving, secondPointerDownEvent)
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 97,
      clientY: 100,
    }))

    expect(state.document.nodes[0]).toMatchObject({ x: 100, y: 220 })
    expect(alignmentGuides.visible).toBe(true)
    expect(alignmentGuides.guides).toEqual([
      { axis: 'x', kind: 'left', position: 100 },
    ])

    showDragAlignmentGuides.value = false

    expect(alignmentGuides.visible).toBe(false)
    expect(alignmentGuides.guides).toEqual([])
  })

  it('performs pinch-to-zoom and pan correctly on touch devices', () => {
    const stage = document.createElement('div')
    stage.getBoundingClientRect = vi.fn(() => ({
      bottom: 400,
      height: 400,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))

    const viewport = ref({ scale: 1, x: 0, y: 0 })

    createCanvasEditorGestureHandlers({
      alignmentGuides: {
        guides: [],
        visible: false,
      },
      board: computed(() => ({ height: 2400, left: 0, top: 0, width: 3200 })),
      commitDocument: vi.fn(),
      connectionDraft: {} as any,
      edgeReconnectDraft: {} as any,
      getAnchor: vi.fn(),
      capabilities: computed(() => capsFor(false)),
      selectionBox: {} as any,
      selectedEdge: computed(() => null),
      showDragAlignmentGuides: computed(() => true),
      gridSettings: ref({ ...DEFAULT_CANVAS_GRID_SETTINGS }),
      stageRef: ref(stage),
      state: {
        document: {
          nodes: [],
          edges: [],
        },
        selectNode: vi.fn(),
        selectedNodeIds: [],
      } as any,
      viewport: viewport.value,
      showNodeHeader: computed(() => true),
    })

    // 1. Simulate TouchStart with 2 fingers
    const touchStartEvent = new Event('touchstart', { bubbles: true }) as any
    touchStartEvent.touches = [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 200 },
    ]
    touchStartEvent.preventDefault = vi.fn()
    stage.dispatchEvent(touchStartEvent)

    expect(touchStartEvent.preventDefault).toHaveBeenCalled()

    // 2. Simulate TouchMove moving fingers apart (scale up from distance ~141.42 to ~282.84, which is ratio 2.0)
    // Keep fingers center at (150, 150)
    const touchMoveEvent1 = new Event('touchmove', { bubbles: true }) as any
    touchMoveEvent1.touches = [
      { clientX: 50, clientY: 50 },
      { clientX: 250, clientY: 250 },
    ]
    touchMoveEvent1.preventDefault = vi.fn()
    stage.dispatchEvent(touchMoveEvent1)

    expect(touchMoveEvent1.preventDefault).toHaveBeenCalled()
    expect(viewport.value.scale).toBe(2)
    // initialWorldCenter was (150, 150). currentCenter is (150, 150).
    // viewport.x = 150 - 150 * 2 = -150
    expect(viewport.value.x).toBe(-150)
    expect(viewport.value.y).toBe(-150)

    // 3. Simulate TouchMove moving fingers apart AND panning (shift center to (200, 200))
    // fingers at (100, 100) and (300, 300), distance ~282.84, center (200, 200)
    const touchMoveEvent2 = new Event('touchmove', { bubbles: true }) as any
    touchMoveEvent2.touches = [
      { clientX: 100, clientY: 100 },
      { clientX: 300, clientY: 300 },
    ]
    stage.dispatchEvent(touchMoveEvent2)

    expect(viewport.value.scale).toBe(2)
    // viewport.x = currentCenter.x - initialWorldCenter.x * scale = 200 - 150 * 2 = -100
    expect(viewport.value.x).toBe(-100)
    expect(viewport.value.y).toBe(-100)

    // 4. Simulate TouchEnd releasing fingers
    const touchEndEvent = new Event('touchend', { bubbles: true }) as any
    touchEndEvent.touches = []
    stage.dispatchEvent(touchEndEvent)

    // No longer scaling if fingers touched again in single touch
    const touchMoveEvent3 = new Event('touchmove', { bubbles: true }) as any
    touchMoveEvent3.touches = [
      { clientX: 100, clientY: 100 },
    ]
    stage.dispatchEvent(touchMoveEvent3)
    // Viewport should remain same since it's not 2 touches
    expect(viewport.value.scale).toBe(2)
    expect(viewport.value.x).toBe(-100)
  })

  describe("autoCreateTextCardOnDrag", () => {
    it("automatically creates a text card and connection when dragging to empty canvas and setting is enabled", () => {
      const fromNode = { id: "node-1", type: "text", x: 100, y: 100, width: 200, height: 100 } as CanvasNode
      const { commitDocument, handlers, state } = createGestureHarness([fromNode], [], { autoCreateTextCardOnDrag: true })

      const event = new PointerEvent("pointerdown", {
        button: 0,
        clientX: 300,
        clientY: 150,
        bubbles: true,
      })

      handlers.startConnectionDrag(fromNode, "right", event)

      // Simulate dragging to empty space
      const pointerMoveEvent = new PointerEvent("pointermove", {
        clientX: 600,
        clientY: 200,
        bubbles: true,
      })
      window.dispatchEvent(pointerMoveEvent)

      // Simulate pointerup to release
      const pointerUpEvent = new PointerEvent("pointerup", {
        clientX: 600,
        clientY: 200,
        bubbles: true,
      })
      window.dispatchEvent(pointerUpEvent)

      // Expectations
      expect(commitDocument).toHaveBeenCalled()
      expect(state.document.nodes).toHaveLength(2)
      
      const newNode = state.document.nodes.find((n) => n.id !== "node-1")
      expect(newNode).toBeDefined()
      expect(newNode!.type).toBe("text")

      // fromNode's right handle is dragged to x=600, y=200.
      // So new node should align left side to x=600, center y to 200.
      // W=320, H=180.
      // newNode.x = 600
      // newNode.y = 200 - 180/2 = 110
      expect(newNode!.x).toBe(600)
      expect(newNode!.y).toBe(110)

      expect(state.document.edges).toHaveLength(1)
      const edge = state.document.edges[0]
      expect(edge).toBeDefined()
      expect(edge!.fromNode).toBe("node-1")
      expect(edge!.toNode).toBe(newNode!.id)
      expect(edge!.fromSide).toBe("right")
      expect(edge!.toSide).toBe("left")

      expect(state.selectedNodeIds).toEqual([newNode!.id])
      expect(state.pendingEditNodeId).toBe(newNode!.id)
    })

    it("does not create a text card when dragging to empty canvas and setting is disabled", () => {
      const fromNode = { id: "node-1", type: "text", x: 100, y: 100, width: 200, height: 100 } as CanvasNode
      const { commitDocument, handlers, state } = createGestureHarness([fromNode], [], { autoCreateTextCardOnDrag: false })

      const event = new PointerEvent("pointerdown", {
        button: 0,
        clientX: 300,
        clientY: 150,
        bubbles: true,
      })

      handlers.startConnectionDrag(fromNode, "right", event)

      // Simulate dragging to empty space
      const pointerMoveEvent = new PointerEvent("pointermove", {
        clientX: 600,
        clientY: 200,
        bubbles: true,
      })
      window.dispatchEvent(pointerMoveEvent)

      // Simulate pointerup to release
      const pointerUpEvent = new PointerEvent("pointerup", {
        clientX: 600,
        clientY: 200,
        bubbles: true,
      })
      window.dispatchEvent(pointerUpEvent)

      expect(commitDocument).not.toHaveBeenCalled()
      expect(state.document.nodes).toHaveLength(1)
      expect(state.document.edges).toHaveLength(0)
    })
  })

  describe("pointer event confinement and capture", () => {
    it("calls event.preventDefault and sets/releases pointer capture during card drag", () => {
      const node = { id: "node-1", type: "text", x: 100, y: 100, width: 200, height: 100 } as CanvasNode
      const { handlers } = createGestureHarness([node])

      const target = document.createElement("div")
      target.className = "canvas-node__header"
      const setPointerCapture = vi.fn()
      const releasePointerCapture = vi.fn()
      const hasPointerCapture = vi.fn().mockReturnValue(true)
      target.setPointerCapture = setPointerCapture
      target.releasePointerCapture = releasePointerCapture
      target.hasPointerCapture = hasPointerCapture

      const pointerDownEvent = new PointerEvent("pointerdown", {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 42,
        bubbles: true,
        cancelable: true,
      })
      Object.defineProperty(pointerDownEvent, "target", { value: target })
      const preventDefaultSpy = vi.spyOn(pointerDownEvent, "preventDefault")

      handlers.handleNodePointerDown(node, pointerDownEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(setPointerCapture).toHaveBeenCalledWith(42)

      // Simulate pointerup
      const pointerUpEvent = new PointerEvent("pointerup", {
        clientX: 150,
        clientY: 150,
        pointerId: 42,
        bubbles: true,
      })
      window.dispatchEvent(pointerUpEvent)

      expect(releasePointerCapture).toHaveBeenCalledWith(42)
    })

    it("suppresses synthetic click event after significant drag displacement", () => {
      const node = { id: "node-1", type: "text", x: 100, y: 100, width: 200, height: 100 } as CanvasNode
      const { handlers } = createGestureHarness([node])

      const target = document.createElement("div")
      target.className = "canvas-node__header"
      const pointerDownEvent = new PointerEvent("pointerdown", {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        bubbles: true,
      })
      Object.defineProperty(pointerDownEvent, "target", { value: target })

      handlers.handleNodePointerDown(node, pointerDownEvent)

      // 产生实质位移 (> 2px)
      const pointerMoveEvent = new PointerEvent("pointermove", {
        clientX: 120,
        clientY: 130,
      })
      window.dispatchEvent(pointerMoveEvent)

      // 释放指针
      const pointerUpEvent = new PointerEvent("pointerup", {
        clientX: 120,
        clientY: 130,
      })
      window.dispatchEvent(pointerUpEvent)

      // 模拟随后浏览器派发的 click 事件
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      })
      const preventDefaultSpy = vi.spyOn(clickEvent, "preventDefault")
      const stopPropagationSpy = vi.spyOn(clickEvent, "stopPropagation")

      window.dispatchEvent(clickEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(stopPropagationSpy).toHaveBeenCalled()
    })

    it("marks isDragging true during card drag and resets it on pointerup", () => {
      const node = { id: "node-1", type: "text", x: 100, y: 100, width: 200, height: 100 } as CanvasNode
      const { handlers } = createGestureHarness([node])

      const target = document.createElement("div")
      target.className = "canvas-node__header"
      const pointerDownEvent = new PointerEvent("pointerdown", {
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      })
      Object.defineProperty(pointerDownEvent, "target", { value: target })

      handlers.handleNodePointerDown(node, pointerDownEvent)
      expect(handlers.isDragging.value).toBe(true)

      window.dispatchEvent(new PointerEvent("pointermove", {
        clientX: 130,
        clientY: 140,
      }))
      expect(handlers.isDragging.value).toBe(true)

      window.dispatchEvent(new PointerEvent("pointerup", {
        clientX: 130,
        clientY: 140,
      }))
      expect(handlers.isDragging.value).toBe(false)
    })
  })
})
