/**
 * 画布交互能力策略 —— **单一事实来源**
 * ============================================================================
 *
 * 为什么有这个文件
 * ---------------------------------------------------------------------------
 * 改造前，「只读」在代码里是**一个布尔**：
 *
 *     readonly = computed(() => Boolean(state.conflict || plugin.isMobile || isEmbedMode))
 *
 * 它把三种**语义完全不同**的来源揉在一起，于是产生三类问题：
 *
 *   1. **无法差异化**：移动端没有右键，却和嵌入预览共享同一套手势策略；
 *      文档冲突（需要用户去解决冲突）与「纯预览」也得到完全一样的能力。
 *   2. **判据双轨**：同一件事（"这是不是预览？"）时而判 `readonly`（宽），
 *      时而判 `isEmbedMode`（窄），没有规则可依，新人必然选错。
 *   3. **守卫散落**：15 处守卫分布在 渲染 / 界面事件 / 手势 / 文档 四层，
 *      每处都要记得手写 `if (readonly) return` —— **漏一处就是一个 bug**
 *      （实际已踩中两次：嵌入块仍渲染连线点、空白双击仍能建节点）。
 *
 * ⇒ 现在收敛为：**3 个原始信号 → 1 个运行模式 → 一组具名能力**。
 *   所有守卫改为**查询具名能力**，语义自解释，且新增交互时只要问一句
 *   "这项能力属于哪一格"，不会再漏。
 *
 * ---------------------------------------------------------------------------
 * 能力矩阵（★ 改行为前先改这张表，再改实现 ★）
 * ---------------------------------------------------------------------------
 *
 *  能力                 | 编辑 | 冲突 | 移动端 | 嵌入预览 | 说明
 *  ---------------------|------|------|--------|----------|------------------------------
 *  editDocument         |  ✅  |  ❌  |   ❌   |    ❌    | 改文档：增删/拖拽/连线/改尺寸
 *  persist              |  ✅  |  ✅  |   ✅   |    ❌    | 写盘（见下方"为什么冲突态仍可保存"）
 *  select               |  ✅  |  ❌  |   ❌   |    ❌    | 选中节点/连线（带选中环、端点手柄）
 *  marquee              |  ✅  |  ❌  |   ❌   |    ❌    | 左键框选
 *  createByDoubleClick  |  ✅  |  ❌  |   ❌   |    ❌    | 空白处双击新建节点
 *  renderNodeHandles    |  ✅  |  ❌  |   ❌   |    ❌    | 渲染连线锚点 + 缩放手柄
 *  openNodeTab          |  ✅  |  ✅  |   ✅   |    ❌    | 双击卡片打开/跳转页签
 *  zoom                 |  ✅  |  ✅  |   ✅   |    ✅    | 滚轮缩放（预览必须保留）
 *  pan                  |  ✅  |  ✅  |   ✅   |    ✅    | 右键按住平移（预览必须保留）
 *
 * ---------------------------------------------------------------------------
 * 两条容易搞错的边界（都写在这里，避免下次又踩）
 * ---------------------------------------------------------------------------
 *
 *  ★ 1. 为什么 `persist` 与 `openNodeTab` **只**受 embed 影响，而不是 `!readonly` ★
 *
 *     `persist`（写盘）如果跟着 `readonly` 走，会把**冲突态**也变成"不能保存"——
 *     那是错的：文档冲突的正常处理流程就是让用户解决后保存，卡住保存等于堵死出口。
 *     移动端同理，必须能保存。
 *     所以「嵌入预览不落盘」这条规则的真实理由与冲突/移动端**无关**：
 *     同一条 .canvas 可能正被页签实例打开，嵌入实例若也写盘，两者会互相覆盖。
 *     ⇒ `persist = !embed`，理由单一且明确。
 *
 *     `openNodeTab`（双击打开页签）同理：用户要求「预览态任何操作都不得打开/跳转页签」，
 *     这是**嵌入预览专属**的要求；移动端与冲突态仍应能正常打开页签。
 *     ⇒ `openNodeTab = !embed`。
 *
 *  ★ 2. `zoom` / `pan` 在**所有**模式下都为 true ★
 *
 *     预览态"只显示 + 能缩放 + 能平移"是用户的核心要求（原话：
 *     「只读模式下 就只显示，滚动放大和缩小。右键按住移动鼠标移动画布。」）。
 *     缩放走滚轮（`handleStageWheel` 本就不看任何只读标志），
 *     平移走右键（`startPan` 的 `button === 2` 分支刻意放在所有只读判断**之前**）。
 *     这两个能力**不得**被任何只读守卫误伤 —— 所以它们在这里是常量 true，
 *     而不是 `!readonly`，以免将来有人"顺手"把它们也关掉。
 */

/** 只读的来源。三者语义不同，**不得**再合并成单个布尔去驱动差异化行为。 */
export type CanvasReadonlySource = "conflict" | "mobile" | "embed"

/** 运行时的三个原始信号（由上层把响应式状态求值后传入）。 */
export interface CanvasRuntimeSignals {
  /** 文档冲突：同一 .canvas 被外部改动，存在未解决的冲突。 */
  conflict: boolean
  /** 移动端（触屏设备）。 */
  mobile: boolean
  /** 嵌入预览：笔记正文里的自定义块（只读画布块）。 */
  embed: boolean
}

/**
 * 画布交互能力集。
 *
 * 约定：每个字段都回答一个**具体动作能不能做**，
 * 名称用动词/动宾短语，避免 "enabled/disabled" 这类需要回看上下文才能懂的词。
 */
export interface CanvasCapabilities {
  /** 修改文档内容：增删节点与连线、拖拽节点、改尺寸、改文字。 */
  editDocument: boolean
  /** 把内存中的文档写入磁盘文件。 */
  persist: boolean
  /** 选中节点或连线（会随之渲染选中环、端点手柄、选择工具条）。 */
  select: boolean
  /** 左键框选（marquee）。 */
  marquee: boolean
  /** 在空白处双击新建节点。 */
  createByDoubleClick: boolean
  /** 渲染节点把手：连线锚点（4 个点）与缩放手柄（8 个 + 1 个角）。 */
  renderNodeHandles: boolean
  /** 双击卡片打开/跳转对应页签（或进入编辑态）。 */
  openNodeTab: boolean
  /** 滚轮缩放。 */
  zoom: boolean
  /** 右键按住平移画布。 */
  pan: boolean
}

export interface CanvasInteractionPolicy {
  /** 是否存在任一"只读来源"。＝改造前 `readonly` 的语义，保留以便平滑迁移。 */
  readonly: boolean
  /** 只读来源集合，按 conflict → mobile → embed 顺序。便于诊断与打日志。 */
  readonlySources: CanvasReadonlySource[]
  /** 是否为"嵌入预览"实例。＝改造前 `isEmbedMode` 的语义。 */
  embedPreview: boolean
  /** 具名能力集。守卫一律查这里，不再各自判断 `readonly` / `isEmbedMode`。 */
  capabilities: CanvasCapabilities
}

/**
 * 由原始信号解析出完整的交互策略。
 *
 * 纯函数、无副作用、不依赖任何响应式系统 —— 便于单测覆盖完整能力矩阵。
 */
export function resolveCanvasInteractionPolicy(
  signals: CanvasRuntimeSignals,
): CanvasInteractionPolicy {
  const readonlySources: CanvasReadonlySource[] = []
  if (signals.conflict) {
    readonlySources.push("conflict")
  }
  if (signals.mobile) {
    readonlySources.push("mobile")
  }
  if (signals.embed) {
    readonlySources.push("embed")
  }

  const readonly = readonlySources.length > 0
  const embedPreview = signals.embed

  const capabilities: CanvasCapabilities = {
    // ── 所有只读来源都禁止改文档 ──
    editDocument: !readonly,

    // ── ★ 只受 embed 影响（见文件头"两条容易搞错的边界"）──
    persist: !embedPreview,
    openNodeTab: !embedPreview,

    // ── 所有只读来源都禁止选中/框选/双击新建/把手 ──
    select: !readonly,
    marquee: !readonly,
    createByDoubleClick: !readonly,
    renderNodeHandles: !readonly,

    // ── ★ 所有模式都保留：预览的"只显示 + 缩放 + 平移"靠它们 ──
    zoom: true,
    pan: true,
  }

  return {
    readonly,
    readonlySources,
    embedPreview,
    capabilities,
  }
}

/**
 * 把只读来源列表转成一行人类可读的说明（用于诊断面板 / 日志 / 测试断言）。
 *
 * 例：`["conflict", "embed"]` → `"conflict+embed"`
 */
export function describeReadonlySources(sources: CanvasReadonlySource[]): string {
  return sources.length > 0 ? sources.join("+") : "none"
}
