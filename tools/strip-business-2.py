#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剥离上游业务（第二批）：切除残留调用点。

覆盖：
  · index.ts —— 移除 addDock（侧栏文档树）与相关 import
  · use-canvas-editor-file-actions.ts —— 移除 exportCanvasPng 函数与导出

用法： python tools/strip-business-2.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def patch(rel_path: str, replacements: list) -> bool:
    path = ROOT / rel_path
    if not path.exists():
        print(f"FAIL: 文件不存在 {rel_path}")
        return False

    text = path.read_text(encoding="utf-8")
    errors = []
    for desc, old, new, expected in replacements:
        count = text.count(old)
        if count != expected:
            errors.append(f"    [未命中] {desc}: 期望 {expected}，实际 {count}")
            continue
        text = text.replace(old, new, expected)
        print(f"    [OK] {desc}")

    if errors:
        print(f"  以下替换失败，{rel_path} 未写入：")
        print("\n".join(errors))
        return False

    path.write_text(text, encoding="utf-8")
    print(f"  已写入 {rel_path}\n")
    return True


def main() -> int:
    ok = True

    # ── index.ts：移除 dock 挂载与 import ──────────────────────
    print("[index.ts] 移除侧栏 dock")
    ok &= patch("src/index.ts", [
        (
            "删除 mount/unmountCanvasDockApp import",
            '''import {
  bindPlugin,
  mountCanvasDockApp,
  unmountCanvasDockApp,
} from "@/main"
''',
            '''import {
  bindPlugin,
} from "@/main"
''',
            1,
        ),
        (
            "删除 addDock 整块",
            '''    this.addDock({
      config: {
        position: "RightTop",
        size: { width: "320px", height: "0" },
        icon: CANVAS_TAB_ICON_ID,
        title: this.t("canvasHelper"),
        show: false,
      },
      type: "siyuan-canvas-dock",
      init(this: any) {
        mountCanvasDockApp(this.element, pluginInstance)
      },
      destroy(this: any) {
        unmountCanvasDockApp(this.element)
      },
    })

''',
            '',
            1,
        ),
    ])

    # ── file-actions：移除 PNG 导出函数 ────────────────────────
    print("[use-canvas-editor-file-actions.ts] 移除 PNG 导出函数")
    png_fn = '''
  async function exportCanvasPng(options: CanvasPngExportOptions) {
    const stage = stageRef.value
    const world = stage?.querySelector<HTMLElement>(".stage__world")
    if (!stage || !world) {
      console.error("[Canvas PNG Export] stage or world element not found", { stage: !!stage, world: !!world })
      showMessage(t("messageCanvasPngExportFailed"), 4000, "error")
      return
    }

    const bounds = resolveCanvasPngExportBounds({
      nodes: state.document.nodes,
      padding: 48,
      range: options.range,
      stageSize: {
        height: stage.clientHeight,
        width: stage.clientWidth,
      },
      viewport: {
        scale: viewport.scale,
        x: viewport.x,
        y: viewport.y,
      },
    })
    const exportBounds = options.range === "full"
      ? {
          ...bounds,
          x: toBoardX(board.value, bounds.x),
          y: toBoardY(board.value, bounds.y),
        }
      : bounds
    const iframeCount = world.querySelectorAll("iframe").length

    debugLog("[Canvas PNG Export] starting export", {
      background: options.background,
      bounds: exportBounds,
      filename: createCanvasPngExportFilename(suggestedFilename.value || state.filePath),
      iframeCount,
      nodeCount: state.document.nodes.length,
      range: options.range,
      worldSize: { h: world.offsetHeight, w: world.offsetWidth },
    })

    if (iframeCount > 0) {
      debugLog("[Canvas PNG Export] world contains iframe nodes; they will be excluded from export", {
        iframeCount,
      })
    }

    try {
      await exportCanvasWorldToPng({
        backgroundColor: resolveCanvasPngExportBackground(options.background),
        bounds: exportBounds,
        filename: createCanvasPngExportFilename(suggestedFilename.value || state.filePath),
        world,
      })
      debugLog("[Canvas PNG Export] completed successfully")
    } catch (error) {
      console.error("[Canvas PNG Export] failed", error)
      const message = error instanceof Error ? error.message : String(error)
      showMessage(message || t("messageCanvasPngExportFailed"), 4000, "error")
    }
  }
'''
    ok &= patch("src/canvas/use-canvas-editor-file-actions.ts", [
        (
            "删除 exportCanvasPng 函数体",
            png_fn,
            '',
            1,
        ),
        (
            "从返回对象移除 exportCanvasPng",
            '''    exportCanvas,
    exportCanvasPng,
    importCanvas,''',
            '''    exportCanvas,
    importCanvas,''',
            1,
        ),
    ])

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
