#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复 use-canvas-editor.ts 的运行时断链。

背景：上一轮用 Python 脚本删了 import，但代码体调用点没删。
vite/esbuild 不做跨模块符号解析 → 构建通过 → 运行时崩溃。
所以这次改动后必须用 tools/check-broken-refs.mjs 复检。

本脚本做的 8 件事（全部基于精确文本替换，替换失败即报错退出）：
 1. 补 import：createCanvasBlockJumpHighlighter / BLOCK_NAVIGATION_ACTIONS /
    createCanvasEditorWorkspaceTree / createCanvasEditorFileNodeHelpers /
    CanvasSearchDecoration / 搜索桥 6 个符号
 2. 补回被误删的 SiyuanCanvasTextGateway（文件存在，import 丢了）—— 实际已存在，跳过
 3. 删除 presentation 装配（useCanvasPresentation）→ presentation.isActive 全部替换为 false
 4. 删除 selectionExport 装配 → 3 个包装函数改为 no-op
 5. 删除 stageDrop 装配 → handleStageDragOver/handleStageDrop 改为 no-op
 6. 删除 nodeActivation 装配 → activateNode 改为走 openDocumentAtBlock
 7. 删除搜索桥装配（createCanvasSearchHost / registerCanvasSearchHost / onBeforeUnmount 注销）
 8. 修正 focusNodeByIdFn 赋值表达式
"""
import io
import re
import sys

P = "src/canvas/use-canvas-editor.ts"

with io.open(P, encoding="utf-8") as fh:
    src = fh.read()

orig_len = len(src)


def sub_once(pattern, replacement, label, count=1, flags=0):
    """精确替换；替换次数不足则报错退出。"""
    global src
    new, n = re.subn(pattern, replacement, src, count=count, flags=flags)
    if n != count:
        sys.stderr.write("[FAIL] %s: 期望替换 %d 次，实际 %d 次\n" % (label, count, n))
        sys.exit(1)
    src = new
    sys.stdout.write("[ ok ] %s\n" % label)


def cut(start_marker, end_marker, label, replacement=""):
    """从 start_marker 开始删到 end_marker（含 end_marker）。"""
    global src
    i = src.find(start_marker)
    if i < 0:
        sys.stderr.write("[FAIL] %s: 找不到起点\n" % label)
        sys.exit(1)
    j = src.find(end_marker, i)
    if j < 0:
        sys.stderr.write("[FAIL] %s: 找不到终点\n" % label)
        sys.exit(1)
    src = src[:i] + replacement + src[j + len(end_marker):]
    sys.stdout.write("[ ok ] %s\n" % label)


# ---------------------------------------------------------------- 1. 补 import
ANCHOR = 'import { SiyuanCanvasTextGateway } from "@/canvas/siyuan-text-gateway"\n'
if ANCHOR not in src:
    sys.stderr.write("[FAIL] 找不到 SiyuanCanvasTextGateway import 锚点\n")
    sys.exit(1)

NEW_IMPORTS = ANCHOR + '''import { createCanvasBlockJumpHighlighter } from "@/canvas/block-jump-highlight"
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
'''
src = src.replace(ANCHOR, NEW_IMPORTS, 1)
sys.stdout.write("[ ok ] 补 6 组 import + 2 个基础模块 import\n")

# search-bridge 从 .stripped 恢复
import shutil  # noqa: E402
import os  # noqa: E402
if not os.path.exists("src/canvas/search-bridge.ts"):
    shutil.copyfile(".stripped/canvas/search-bridge.ts", "src/canvas/search-bridge.ts")
    sys.stdout.write("[ ok ] 从 .stripped 恢复 search-bridge.ts\n")

# ------------------------------------------------- 2. presentation 装配整体删除
# 注意：不能用 "  })\n" 当终点 —— 块内 saveRecordedPath 回调结尾是 "    }),\n"，
# 会被前面匹配到（已踩过一次，留下 "    },\n  })\n" 残片导致 esbuild 报 Unexpected ","）。
# 终点用实际的收尾 "  })\n\n" 且从块内定位（唯一）。
cut(
    "  let focusNodeByIdFn: (id: string) => void\n",
    "        },\n      })\n    },\n  })\n",
    "删除 presentation 装配块",
    "  let focusNodeByIdFn: (id: string) => void\n",
)

# presentationActive 传参（第 1066 行附近）—— 必须在 presentation.isActive 全局替换之前处理，
# 否则 presentation.isActive 已被换成 false，正则就匹配不到了。
sub_once(
    r"    presentationActive: computed\(\(\) => presentation\.isActive\),\n",
    "",
    "删除 presentationActive 传参",
)

# presentation.isActive -> false
n = src.count("presentation.isActive")
src = src.replace("presentation.isActive", "false")
sys.stdout.write("[ ok ] presentation.isActive -> false（%d 处）\n" % n)
src = src.replace("        presentation: {\n", "")

# 删除 type 段里的 presentation? 使用时的问题：只剩 spread，无需额外处理

# ------------------------------------------------- 3. selectionExport 装配
cut(
    "  // 选区导出/合并逻辑已提取到 use-canvas-editor-selection-export.ts\n",
    "  })\n",
    "删除 selectionExport 装配",
)

sub_once(
    r"    return selectionExport\.decomposeSelectedDocument\(selectedNode\.value, canDecomposeSelectedDocument\.value\)",
    "    return false",
    "decomposeSelectedDocument -> no-op",
)
sub_once(
    r"    return selectionExport\.convertSelectionToDocument\(state\.selectedNodeIds\)",
    "    return false",
    "convertSelectionToDocument -> no-op",
)
sub_once(
    r"    return selectionExport\.convertSelectionToText\(state\.selectedNodeIds\)",
    "    return false",
    "convertSelectionToText -> no-op",
)

# ------------------------------------------------- 4. stageDrop 装配
cut(
    "  } = createCanvasEditorStageDropActions({\n",
    "  })\n",
    "删除 stageDrop 装配",
    """  } = {
    handleStageDragOver: (_event: DragEvent) => {},
    handleStageDrop: async (_event: DragEvent) => false,
  } as {
    handleStageDragOver: (event: DragEvent) => void
    handleStageDrop: (event: DragEvent) => Promise<boolean>
  }
""",
)

# ------------------------------------------------- 5. nodeActivation 装配
cut(
    "  const { activateNode } = createCanvasEditorNodeActivationActions({\n",
    "  })\n",
    "删除 nodeActivation 装配",
    """  async function activateNode(node: CanvasNode) {
    if (node.type === "file" && node.file) {
      const resolved = getResolvedFileNode(node.id)
      if (resolved && resolved.kind === "block") {
        await openDocumentAtBlock(resolved.id, resolved.documentId)
        return true
      }
    }
    return false
  }
""",
)

# ------------------------------------------------- 6. 搜索桥装配
sub_once(
    r"""  function createCanvasSearchHost\(root: HTMLElement\) \{
    return \{
      version: 1 as const,""",
    """  function _unusedCreateCanvasSearchHost(root: HTMLElement) {
    return {
      version: 1 as const,""",
    "标记 createCanvasSearchHost 待删（定位起点）",
)

# 删除整个 createCanvasSearchHost 函数体
start = src.find("  function _unusedCreateCanvasSearchHost(root: HTMLElement) {")
if start < 0:
    sys.stderr.write("[FAIL] 找不到搜索宿主函数起点\n")
    sys.exit(1)
end_anchor = "  onMounted(async () => {"
end = src.find(end_anchor, start)
if end < 0:
    sys.stderr.write("[FAIL] 找不到 onMounted 锚点\n")
    sys.exit(1)
src = src[:start] + src[end:]
sys.stdout.write("[ ok ] 删除 createCanvasSearchHost 函数体\n")

# onMounted 里的注册
sub_once(
    r"""    window\.addEventListener\("siyuan-canvas-settings-changed", handleExternalSettingsChange\)
    const hostRoot = stageRef\.value\?\.closest<HTMLElement>\("\.siyuan-canvas__tab"\)
      \?\? stageRef\.value
    if \(hostRoot\) \{
      unregisterCanvasSearchHost = registerCanvasSearchHost\(createCanvasSearchHost\(hostRoot\)\)
    \}""",
    """    window.addEventListener("siyuan-canvas-settings-changed", handleExternalSettingsChange)""",
    "删除搜索宿主注册",
)

# onBeforeUnmount 里的注销
sub_once(
    r"""    closeFloatLayer\(\)
    unregisterCanvasSearchHost\?\.\(\)
    unregisterCanvasSearchHost = null
""",
    """    closeFloatLayer()
""",
    "删除搜索宿主注销",
)

# 删除未使用的变量声明
sub_once(
    r"  const searchListeners = new Set<\(\) => void>\(\)\n  let unregisterCanvasSearchHost: \(\(\) => void\) \| null = null\n",
    "",
    "删除 searchListeners / unregisterCanvasSearchHost 声明",
)

# ------------------------------------------------- 7. focusNodeByIdFn 赋值修正
sub_once(
    r"  focusNodeByIdFn = focusNodeById\n",
    "  focusNodeByIdFn = focusNodeById\n",
    "focusNodeByIdFn 赋值（保持）",
)

# ------------------------------------------------- 8. 清理 type 引用
sub_once(
    r"      presentation,\n",
    "",
    "删除 bindings 中 presentation 字段",
)

with io.open(P, "w", encoding="utf-8") as fh:
    fh.write(src)

sys.stdout.write("\n完成：%d 字节 -> %d 字节\n" % (orig_len, len(src)))
