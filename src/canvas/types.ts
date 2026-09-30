export type CanvasNodeType = "file" | "group" | "link" | "text" | "query"

export type CanvasSide = "bottom" | "left" | "right" | "top"

/**
 * 描边/连线样式（第 11 轮 #17）。
 *
 * 「卡片样式 / 分组样式 / 连线样式 增加虚线样式」——
 * 节点用边框虚线表达，连线用 stroke-dasharray 表达。
 * 缺省（字段不存在）＝实线，保证老画布不受影响。
 */
export type CanvasLineStyle = "solid" | "dashed"

export type CanvasIssueLevel = "error" | "warning"

export interface CanvasIssue {
  code: string
  level: CanvasIssueLevel
  message: string
  path?: string
}

export interface CanvasNodeBase {
  id: string
  type: CanvasNodeType
  x: number
  y: number
  width: number
  height: number
  color?: string
  /** 描边样式（虚线）。缺省 = 实线。见 CanvasLineStyle。 */
  lineStyle?: CanvasLineStyle
  /**
   * ★ 用户自定义的卡片抬头文本（第 39 轮）★
   *
   * 卡片顶部原本显示的是**自动推导**的类型名（「文本」/「画布文件」/「思源笔记」
   * /「内部文件」/「网盘文件」，由 `CanvasWorkspace.getNodeHeaderTitle` 出）。
   * 用户希望能改写它。
   *
   * 语义：**非空时才覆盖**自动推导值；缺省或空串 ⇒ 回退到类型名
   * （所以"清空输入框"＝恢复默认，不是显示空白）。
   */
  headerTitle?: string
  [key: string]: unknown
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: "text"
  text: string
}

export interface CanvasFileNode extends CanvasNodeBase {
  type: "file"
  file: string
  subpath?: string
}

export interface CanvasLinkNode extends CanvasNodeBase {
  type: "link"
  url: string
}

export interface CanvasQueryNode extends CanvasNodeBase {
  type: "query"
  sql: string
  refreshInterval?: number
  maxResults?: number
}

export interface CanvasGroupNode extends CanvasNodeBase {
  type: "group"
  label?: string
  background?: string
  backgroundStyle?: string
  collapsed?: boolean
  originalWidth?: number
  originalHeight?: number
  collapsedNodes?: CanvasNode[]
  collapsedEdges?: CanvasEdge[]
}

export type CanvasNode =
  | CanvasFileNode
  | CanvasGroupNode
  | CanvasLinkNode
  | CanvasTextNode
  | CanvasQueryNode

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide: CanvasSide
  startArrow?: boolean
  toNode: string
  toSide: CanvasSide
  endArrow?: boolean
  label?: string
  color?: string
  /** 连线样式（虚线）。缺省 = 实线。见 CanvasLineStyle。 */
  lineStyle?: CanvasLineStyle
  collapsedOriginalFromNode?: string
  collapsedOriginalToNode?: string
  [key: string]: unknown
}

export interface CanvasDocument {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  [key: string]: unknown
}

export interface CanvasParseResult {
  document: CanvasDocument | null
  errors: CanvasIssue[]
  warnings: CanvasIssue[]
}

export interface CanvasGeometryPatch {
  height?: number
  width?: number
  x?: number
  y?: number
}

export interface CanvasBounds {
  x: number
  y: number
  width: number
  height: number
}

export type CanvasNodeLayoutAction =
  | "left-align"
  | "center-horizontal"
  | "right-align"
  | "top-align"
  | "center-vertical"
  | "bottom-align"
  | "arrange-row"
  | "arrange-column"
  | "arrange-grid"
  | "distribute-horizontal"
  | "distribute-vertical"
  | "stretch-horizontal"
  | "stretch-vertical"
