#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
改造 use-canvas-editor.ts：切除上游业务装配，保留画布内核装配。

策略：精确文本替换（每处替换都断言命中次数，命中 != 1 立即失败），
      避免"静默改错"。改完由 vite build 验证。

用法： python tools/refactor-editor-bindings.py
"""
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "src" / "canvas" / "use-canvas-editor.ts"

# (说明, 原文, 新文, 期望命中次数)
REPLACEMENTS = [
    # ── 1. 删除业务 import ─────────────────────────────────────────
    (
        "删除 workspace-tree import",
        'import { createCanvasEditorWorkspaceTree } from "@/canvas/use-canvas-editor-workspace-tree"\n',
        '',
        1,
    ),
    (
        "删除 file-nodes import",
        'import { createCanvasEditorFileNodeHelpers } from "@/canvas/use-canvas-editor-file-nodes"\n',
        '',
        1,
    ),
    (
        "删除 stage-drop import",
        'import { createCanvasEditorStageDropActions } from "@/canvas/use-canvas-editor-stage-drop"\n',
        '',
        1,
    ),
    (
        "删除 node-activation import",
        'import { createCanvasEditorNodeActivationActions } from "@/canvas/use-canvas-editor-node-activation"\n',
        '',
        1,
    ),
    (
        "删除 selection-export import（多行）",
        'import {\n  createCanvasEditorSelectionExport,\n} from "@/canvas/use-canvas-editor-selection-export"\n',
        '',
        1,
    ),
    (
        "删除 block-jump-highlight import",
        'import { createCanvasBlockJumpHighlighter } from "@/canvas/block-jump-highlight"\n',
        '',
        1,
    ),
    (
        "删除 protyle-navigation import",
        'import { BLOCK_NAVIGATION_ACTIONS } from "@/canvas/protyle-navigation"\n',
        '',
        1,
    ),
    (
        "删除 search-bridge import（多行）",
        'import {\n  collectCanvasSearchTargets,\n  createCanvasSearchRevision,\n  parseCanvasTargetId,\n  registerCanvasSearchHost,\n  replaceCanvasTextTargetRanges,\n  type CanvasSearchDecoration,\n} from "@/canvas/search-bridge"\n\n\n',
        '',
        1,
    ),
    (
        "删除 use-canvas-presentation import",
        'import { useCanvasPresentation } from "@/canvas/use-canvas-presentation"\n',
        '',
        1,
    ),
]


def main() -> int:
    if not TARGET.exists():
        print(f"FAIL: 目标文件不存在 {TARGET}")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    original_len = len(text)
    errors = []

    for desc, old, new, expected in REPLACEMENTS:
        count = text.count(old)
        if count != expected:
            errors.append(f"  [未命中] {desc}: 期望 {expected} 次，实际 {count} 次")
            continue
        text = text.replace(old, new, expected)
        print(f"  [OK] {desc}")

    if errors:
        print("\n以下替换失败，文件未写入：")
        print("\n".join(errors))
        return 1

    TARGET.write_text(text, encoding="utf-8")
    print(f"\n完成：{original_len} -> {len(text)} 字符（减少 {original_len - len(text)}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
