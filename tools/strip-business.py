#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剥离上游业务：切除 main.ts / index.ts / use-canvas-editor-file-actions.ts 中的业务引用。

每处替换都断言命中次数，不命中即失败 —— 避免静默改错。
用法： python tools/strip-business.py
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

    # ── main.ts：切除 CanvasDock（上游文档树侧栏）────────────────
    print("[main.ts] 切除 CanvasDock")
    ok &= patch("src/main.ts", [
        (
            "删除 CanvasDock import 与挂载函数",
            '''
import CanvasDock from "@/components/canvas/CanvasDock.vue"

const dockAppMap = new WeakMap<HTMLElement, VueApp>()

export function mountCanvasDockApp(
  element: HTMLElement,
  plugin: Plugin,
): void {
  const app = createApp(CanvasDock, {
    plugin,
  })
  app.mount(element)
  bindThemeSync(element, plugin)
  dockAppMap.set(element, app)
}

export function unmountCanvasDockApp(element: HTMLElement): void {
  themeCleanupMap.get(element)?.()
  themeCleanupMap.delete(element)

  const app = dockAppMap.get(element)
  if (!app) {
    return
  }

  app.unmount()
  dockAppMap.delete(element)
  element.innerHTML = ""
}
''',
            '''
/**
 * ★ 侧边栏面板（CanvasDock）已被移除 ★
 *
 *   上游的侧栏是「工作区文档树」，属于上游业务，本插件不沿用。
 *   本插件的资料入口是画布内的选择器（网盘文件 / 思源笔记），
 *   而不是一个独立的文档树侧栏。
 *
 *   若将来要加侧栏（例如网盘文件浏览器），
 *   在此处新增 mount 函数并在 index.ts 的 addDock 里接上即可。
 */
''',
            1,
        ),
    ])

    # ── use-canvas-editor-file-actions.ts：切除 PNG 导出 ────────
    print("[use-canvas-editor-file-actions.ts] 切除 PNG 导出")
    ok &= patch("src/canvas/use-canvas-editor-file-actions.ts", [
        (
            "删除 png-export import",
            '''import {
  createCanvasPngExportFilename,
  exportCanvasWorldToPng,
  resolveCanvasPngExportBackground,
  resolveCanvasPngExportBounds,
  type CanvasPngExportOptions,
} from "@/canvas/png-export"
''',
            '',
            1,
        ),
    ])

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
