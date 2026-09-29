<template>
  <!--
    画布文件管理窗口（工具栏「独立打开」右侧按钮打开）。

    三件事在这里收口，且**全部走同一套纯逻辑**（`canvas-file-manager.ts`）：
      ① 目录树浏览（文件夹 + 子画布，空文件夹也显示）
      ② 新建 / 重命名 / 复制 / 删除（文件与**文件夹**都支持）
      ③ 把某个画布文件**插入当前画布**（作为嵌套画布卡片）

    重命名之所以危险：画布路径同时写在**笔记嵌入块**、**别的画布**（嵌套节点）
    和插件最近文件里。改完名不补引用 ⇒ 链接静默失效、不报任何错。
    所以这里所有改名/改目录都走 `*WithRelink`，并把补引用结果如实报出来。
  -->
  <div
    class="canvas-dialog-backdrop"
    data-testid="canvas-file-manager"
    @click.self="emit('close')"
  >
    <div
      class="canvas-dialog canvas-dialog--manager"
      @wheel.passive.stop
    >
      <div class="canvas-dialog__header">
        <div class="canvas-manager__headline">
          <h2>{{ t('canvasManagerTitle') }}</h2>
          <span
            class="canvas-manager__count"
            data-testid="canvas-manager-count"
          >{{ t('canvasManagerCount', { count: visibleCanvasCount }) }}</span>
          <!-- 默认目录摆在标题行，用户一眼知道自己在哪棵树下 -->
          <span
            class="canvas-manager__root"
            data-testid="canvas-manager-root"
            :title="props.defaultDirectory"
          >{{ props.defaultDirectory }}</span>
        </div>
        <div class="canvas-manager__header-actions">
          <button
            class="canvas-manager__icon-button"
            data-testid="canvas-manager-expand-all"
            type="button"
            :aria-label="t('canvasManagerExpandAll')"
            :data-tooltip="t('canvasManagerExpandAll')"
            @click="expandAllFolders"
          >
            <CanvasIcon name="expand-all" :size="15" />
          </button>
          <button
            class="canvas-manager__icon-button"
            data-testid="canvas-manager-collapse-all"
            type="button"
            :aria-label="t('canvasManagerCollapseAll')"
            :data-tooltip="t('canvasManagerCollapseAll')"
            @click="collapseAllFolders"
          >
            <CanvasIcon name="fold" :size="15" />
          </button>
          <button
            class="canvas-manager__icon-button"
            data-testid="canvas-manager-close"
            type="button"
            :aria-label="t('dialogCancel')"
            :data-tooltip="t('dialogCancel')"
            @click="emit('close')"
          >
            <CanvasIcon name="close" :size="15" />
          </button>
        </div>
      </div>

      <div class="canvas-manager__toolbar">
        <div class="canvas-manager__search-wrap">
          <CanvasIcon
            class="canvas-manager__search-icon"
            name="search"
            :size="14"
          />
          <input
            v-model="query"
            class="canvas-dialog__control canvas-manager__search"
            data-testid="canvas-manager-search"
            :placeholder="t('canvasManagerSearchPlaceholder')"
          >
        </div>
        <span class="canvas-manager__toolbar-divider" aria-hidden="true" />
        <!--
          ★ 工具栏动作全部改为**图标按钮**（第 33 轮，用户指定）★

          用户原话：「文件管理每行上面的 新建画布，新建文件夹 删除，重命名，
                     复制，删除 用图标代替」。

          说明："每行上面的"指的是**每一行右侧的那组动作**（见下方 actions 区），
          但工具栏这两个（刷新 / 新建文件夹 / 新建画布）同样受益于图标化 ——
          一列中文按钮会把头部挤得很高，而这排图标本身还有 `data-tooltip` 兜底。
        -->
        <button
          class="canvas-manager__icon-button"
          data-testid="canvas-manager-refresh"
          type="button"
          :disabled="busy"
          :aria-label="t('canvasManagerRefresh')"
          :data-tooltip="t('canvasManagerRefresh')"
          @click="reload()"
        >
          <CanvasIcon name="refresh" :size="15" />
        </button>
        <button
          class="canvas-manager__icon-button"
          data-testid="canvas-manager-new-folder"
          type="button"
          :disabled="busy"
          :aria-label="t('canvasManagerNewFolder')"
          :data-tooltip="newTargetHint(t('canvasManagerNewFolder'))"
          @click="createFolder(createTargetDir())"
        >
          <CanvasIcon name="new-folder" :size="15" />
        </button>
        <button
          class="canvas-manager__icon-button canvas-manager__icon-button--primary"
          data-testid="canvas-manager-new"
          type="button"
          :disabled="busy"
          :aria-label="t('canvasManagerNew')"
          :data-tooltip="newTargetHint(t('canvasManagerNew'))"
          @click="createCanvas(createTargetDir())"
        >
          <CanvasIcon name="new-canvas" :size="15" />
        </button>
      </div>

      <div
        class="canvas-manager__list"
        data-testid="canvas-manager-list"
      >
        <p
          v-if="loading"
          class="canvas-manager__empty"
          data-testid="canvas-manager-loading"
        >
          {{ t('canvasManagerLoading') }}
        </p>

        <p
          v-else-if="errorMessage"
          class="canvas-manager__empty canvas-manager__error"
          data-testid="canvas-manager-error"
        >
          {{ errorMessage }}
        </p>

        <p
          v-else-if="visibleRows.length === 0"
          class="canvas-manager__empty"
          data-testid="canvas-manager-empty"
        >
          {{ t('canvasManagerEmpty') }}
        </p>

        <template v-else>
          <div
            v-for="row in visibleRows"
            :key="row.node.path"
            class="canvas-manager__row"
            :class="{
              'canvas-manager__row--folder': row.node.isDir,
              'canvas-manager__row--active': !row.node.isDir && isActiveCanvas(row.node.path),
              'canvas-manager__row--selected': selectedPath === row.node.path,
            }"
            :data-testid="row.node.isDir
              ? `canvas-manager-folder-${row.node.name}`
              : `canvas-manager-row-${row.node.name}`"
            @click="selectRow(row.node)"
          >
            <span
              class="canvas-manager__indent"
              :style="{ width: `${row.depth * 14}px` }"
            />

            <button
              v-if="row.node.isDir"
              class="canvas-manager__twisty"
              :class="{ 'canvas-manager__twisty--open': isExpanded(row.node.path) }"
              :data-testid="`canvas-manager-twisty-${row.node.name}`"
              type="button"
              :aria-label="isExpanded(row.node.path) ? t('canvasManagerCollapse') : t('canvasManagerExpand')"
              @click="toggleExpand(row.node.path)"
            >
              <CanvasIcon
                name="chevron-right"
                :size="12"
              />
            </button>
            <span
              v-else
              class="canvas-manager__twisty canvas-manager__twisty--ghost"
              aria-hidden="true"
            />

            <CanvasIcon
              class="canvas-manager__icon"
              :name="row.node.isDir ? (isExpanded(row.node.path) ? 'folder-open' : 'folder') : 'canvas-file'"
              :size="14"
            />

            <div class="canvas-manager__info">
              <span class="canvas-manager__name">{{ row.node.name }}</span>
              <span class="canvas-manager__path">{{ displayPath(row.node) }}</span>
            </div>

            <span
              v-if="row.node.isDir"
              class="canvas-manager__badge canvas-manager__badge--muted"
              :data-testid="`canvas-manager-folder-count-${row.node.name}`"
            >{{ row.node.canvasCount }}</span>

            <span
              v-if="isActiveCanvas(row.node.path)"
              class="canvas-manager__badge"
              data-testid="canvas-manager-active-badge"
            >{{ t('canvasManagerActive') }}</span>

            <div class="canvas-manager__actions">
              <span
                v-if="busyPath === row.node.path"
                class="canvas-manager__busy"
              >{{ t('canvasManagerBusy') }}</span>

              <template v-else>
                <!-- 画布文件：打开 / 插入当前画布 -->
                <button
                  v-if="!row.node.isDir"
                  class="canvas-manager__icon-button"
                  :data-testid="`canvas-manager-open-${row.node.name}`"
                  type="button"
                  :disabled="busy"
                  :aria-label="t('canvasManagerOpen')"
                  :data-tooltip="t('canvasManagerOpen')"
                  @click.stop="emit('open', row.node.path)"
                >
                  <CanvasIcon name="open" :size="15" />
                </button>
                <button
                  v-if="!row.node.isDir"
                  class="canvas-manager__icon-button"
                  :data-testid="`canvas-manager-insert-${row.node.name}`"
                  type="button"
                  :disabled="busy || !canInsert(row.node.path)"
                  :aria-label="t('canvasManagerInsert')"
                  :data-tooltip="canInsert(row.node.path) ? t('canvasManagerInsertHint') : t('canvasManagerInsertSelfHint')"
                  @click.stop="emit('insert', row.node.path)"
                >
                  <CanvasIcon name="canvas-file" :size="15" />
                </button>

                <!-- 文件夹：往下建画布 / 建子文件夹 -->
                <button
                  v-if="row.node.isDir"
                  class="canvas-manager__icon-button"
                  :data-testid="`canvas-manager-add-canvas-${row.node.name}`"
                  type="button"
                  :disabled="busy"
                  :aria-label="t('canvasManagerNew')"
                  :data-tooltip="t('canvasManagerNew')"
                  @click.stop="createCanvas(row.node.path)"
                >
                  <CanvasIcon name="new-canvas" :size="15" />
                </button>
                <button
                  v-if="row.node.isDir"
                  class="canvas-manager__icon-button"
                  :data-testid="`canvas-manager-add-folder-${row.node.name}`"
                  type="button"
                  :disabled="busy"
                  :aria-label="t('canvasManagerNewFolder')"
                  :data-tooltip="t('canvasManagerNewFolder')"
                  @click.stop="createFolder(row.node.path)"
                >
                  <CanvasIcon name="new-folder" :size="15" />
                </button>

                <!-- 文件与文件夹共有 -->
                <button
                  class="canvas-manager__icon-button"
                  :data-testid="`canvas-manager-rename-${row.node.name}`"
                  type="button"
                  :disabled="busy"
                  :aria-label="t('canvasManagerRename')"
                  :data-tooltip="t('canvasManagerRename')"
                  @click.stop="renameRow(row.node)"
                >
                  <CanvasIcon name="edit" :size="15" />
                </button>
                <button
                  class="canvas-manager__icon-button"
                  :data-testid="`canvas-manager-copy-${row.node.name}`"
                  type="button"
                  :disabled="busy"
                  :aria-label="t('canvasManagerCopy')"
                  :data-tooltip="t('canvasManagerCopy')"
                  @click.stop="copyRow(row.node)"
                >
                  <CanvasIcon name="copy" :size="15" />
                </button>
                <button
                  class="canvas-manager__icon-button canvas-manager__icon-button--danger"
                  :data-testid="`canvas-manager-delete-${row.node.name}`"
                  type="button"
                  :disabled="busy"
                  :aria-label="t('canvasManagerDelete')"
                  :data-tooltip="t('canvasManagerDelete')"
                  @click.stop="removeRow(row.node)"
                >
                  <CanvasIcon name="delete" :size="15" />
                </button>
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"

import { openConfirmDialog } from "@/canvas/confirm-dialog"
import { CanvasIcon } from "@/components/canvas/canvas-icon"
import { createCanvasFileDeps, findAvailableCanvasPath, renameCanvasFileWithRelink, resolveCanvasScanRoots } from "@/canvas/canvas-file-actions"
import type { CanvasTreeNode } from "@/canvas/canvas-file-manager"
import {
  collectCanvasPathsFromTree,
  duplicateCanvasFolder,
  isValidCanvasBaseName,
  listCanvasTree,
  renameCanvasFolderWithRelink,
} from "@/canvas/canvas-file-manager"
import { createEmptyCanvasDocument } from "@/canvas/document"
import { openTextInputDialog } from "@/canvas/text-input-dialog"
import type { CanvasI18nTranslator } from "@/canvas/use-canvas-editor-shared"

const props = defineProps<{
  t: CanvasI18nTranslator
  /** 默认画布目录（"新建"的落脚点，也是扫描范围之一） */
  defaultDirectory: string
  /** 当前打开的画布路径（用于高亮，并禁止把它插进自己） */
  activePath?: string
  /** 通知出口（由父组件注入 `plugin` 的 showMessage，避免本组件依赖 siyuan 模块） */
  notify?: (message: string, timeout?: number, type?: "info" | "error") => void
}>()

const emit = defineEmits<{
  (event: "close"): void
  (event: "open", path: string): void
  (event: "insert", path: string): void
  /**
   * 改名/改目录成功。
   *
   * 文件改名时 `oldPath` 是旧文件路径；
   * **目录改名时 `oldPath` 是旧目录**，`newPath` 是新目录 ——
   * 调用方按"等于 or 前缀"两种情形处理即可（前缀语义天然覆盖文件改名）。
   */
  (event: "renamed", oldPath: string, newPath: string): void
  (event: "deleted", path: string): void
  /** 重新枚举完成（父组件据此清理"最近文件"里的死链） */
  (event: "reload", paths: string[]): void
}>()

const { t } = props
const notify = props.notify ?? (() => undefined)

/** 树节点 + 缩进层级（用扁平数组渲染，避免递归组件） */
interface ManagerRow {
  node: CanvasTreeNode
  depth: number
}

const tree = ref<CanvasTreeNode[]>([])
const expanded = ref<Set<string>>(new Set())
const loading = ref(true)
const busy = ref(false)
const busyPath = ref("")
const errorMessage = ref("")
const query = ref("")

/**
 * ★ 当前选中的条目路径（第 33 轮新增）★
 *
 * 用户要求：「鼠标选择文件或者文件夹条目后点击新建文件夹或文件。
 *           创建路径为点击选中所在路径」。
 *
 * 语义：选中的是**文件夹** ⇒ 建在它**里面**；
 *       选中的是**文件**   ⇒ 建在它**旁边**（即它所在的目录）。
 * 没有选中 ⇒ 落到**默认画布目录**的根。
 */
const selectedPath = ref("")

const scanRoots = computed(() => resolveCanvasScanRoots(props.defaultDirectory))
const activeCanvasPath = computed(() => String(props.activePath || ""))

function deps() {
  return createCanvasFileDeps((message, timeout, type) => notify(message, timeout, type))
}

/* ──────────────────────────────────────────────────────────────
 * 树 → 可见行
 * ────────────────────────────────────────────────────────────── */

function flattenInto(nodes: CanvasTreeNode[], depth: number, out: ManagerRow[]) {
  for (const node of nodes) {
    out.push({ node, depth })
    if (node.isDir && expanded.value.has(node.path)) {
      flattenInto(node.children, depth + 1, out)
    }
  }
}

/**
 * 搜索时**自动展开**（否则命中的文件藏在折叠的文件夹里，等于搜不到）。
 * 目录自身命中就保留它；子项都没命中且自身也没命中 ⇒ 整枝剪掉。
 */
function flattenFiltered(nodes: CanvasTreeNode[], depth: number, needle: string, out: ManagerRow[]): boolean {
  let anyHit = false
  for (const node of nodes) {
    const selfHit = node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)
    if (node.isDir) {
      const before = out.length
      out.push({ node, depth })
      const childHit = flattenFiltered(node.children, depth + 1, needle, out)
      if (selfHit || childHit) {
        anyHit = true
      } else {
        out.splice(before, out.length - before)
      }
      continue
    }
    if (selfHit) {
      out.push({ node, depth })
      anyHit = true
    }
  }
  return anyHit
}

const visibleRows = computed<ManagerRow[]>(() => {
  const out: ManagerRow[] = []
  const needle = query.value.trim().toLowerCase()
  if (!needle) {
    flattenInto(tree.value, 0, out)
    return out
  }
  flattenFiltered(tree.value, 0, needle, out)
  return out
})

const visibleCanvasCount = computed(() => visibleRows.value.filter((row) => !row.node.isDir).length)

function isExpanded(path: string): boolean {
  return expanded.value.has(path)
}

function toggleExpand(path: string) {
  const next = new Set(expanded.value)
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  expanded.value = next
}

/* ──────────────────────────────────────────────────────────────
 * 选中 → 新建的落脚点
 * ────────────────────────────────────────────────────────────── */

/** 点行即选中；再点一次取消（不强迫用户必须取消，但给了退路） */
function selectRow(node: CanvasTreeNode) {
  selectedPath.value = selectedPath.value === node.path ? "" : node.path
}

/**
 * 从树里按路径找回节点。
 *
 * ★ 为什么不在选中时把节点对象存下来 ★
 *   `reload()` 会整体换掉 `tree.value`，旧对象立刻变成孤儿；
 *   拿旧对象去判 `isDir` 还能对，但路径已经不属于新树了。
 *   存**路径**、每次现查，天然跟得上刷新。
 */
function findNodeByPath(path: string): CanvasTreeNode | null {
  if (!path) {
    return null
  }
  let found: CanvasTreeNode | null = null
  const walk = (nodes: CanvasTreeNode[]) => {
    for (const node of nodes) {
      if (found) {
        return
      }
      if (node.path === path) {
        found = node
        return
      }
      if (node.isDir) {
        walk(node.children)
      }
    }
  }
  walk(tree.value)
  return found
}

/**
 * 新建的落脚目录。
 *
 *   · 选中文件夹 ⇒ 它本身
 *   · 选中文件   ⇒ 它的父目录
 *   · 没选中     ⇒ 默认画布目录
 *
 * ★ 选中项在刷新后消失了（被删/被改名）⇒ 静默退回默认目录 ★
 *   不弹错：用户当时按的是"新建"，目标目录没了不该拦着他。
 */
function createTargetDir(): string {
  const node = findNodeByPath(selectedPath.value)
  if (!node) {
    return props.defaultDirectory
  }
  if (node.isDir) {
    return node.path
  }
  return node.path.substring(0, node.path.lastIndexOf("/")) || props.defaultDirectory
}

/**
 * 工具栏那两个新建按钮的 tooltip 里**带上目标目录**，
 * 否则"会建到哪"完全不可见 —— 用户得先点一次才知道。
 */
function newTargetHint(label: string): string {
  const dir = createTargetDir()
  if (!dir || dir === props.defaultDirectory) {
    return label
  }
  return `${label} → ${dir}`
}

function collectFolderPaths(nodes: CanvasTreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: CanvasTreeNode[]) => {
    for (const node of list) {
      if (node.isDir) {
        out.push(node.path)
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return out
}

function expandAllFolders() {
  expanded.value = new Set(collectFolderPaths(tree.value))
}

function collapseAllFolders() {
  expanded.value = new Set()
}

/** 路径显示：根目录那几层前缀很长，视觉上截断（完整路径放 title） */
function displayPath(node: CanvasTreeNode): string {
  const parent = node.path.substring(0, node.path.lastIndexOf("/"))
  return parent || node.path
}

/** 当前打开的画布不允许插进自己（嵌套卡片只会显示上一次保存的快照） */
function canInsert(path: string): boolean {
  return !activeCanvasPath.value || path !== activeCanvasPath.value
}

function isActiveCanvas(path: string): boolean {
  return Boolean(activeCanvasPath.value) && path === activeCanvasPath.value
}

/** 树里出现过的**所有**路径（文件 + 文件夹），用于"重名"判定 */
function allPaths(): Set<string> {
  const out = new Set<string>()
  const walk = (nodes: CanvasTreeNode[]) => {
    for (const node of nodes) {
      out.add(node.path)
      if (node.isDir) {
        walk(node.children)
      }
    }
  }
  walk(tree.value)
  return out
}

/**
 * 改名前把"所有引用它的地方"一次性重写（"链接不丢"的核心）。
 * 英文原因码 → 人话，避免把 `write-failed: xxx` 直接甩给用户。
 */
function describeRenameError(code: string): string {
  const [head, ...rest] = String(code || "").split(":")
  const detail = rest.join(":").trim()
  const map: Record<string, string> = {
    "exists": t("canvasManagerRenameReasonExists"),
    "invalid-name": t("canvasManagerRenameReasonInvalid"),
    "read-failed": t("canvasManagerRenameReasonRead"),
    "remove-failed": t("canvasManagerRenameReasonRemove"),
    "same-name": t("canvasManagerRenameReasonSame"),
    "write-failed": t("canvasManagerRenameReasonWrite"),
  }
  return `${map[head.trim()] || code}${detail ? `（${detail}）` : ""}`
}

/* ──────────────────────────────────────────────────────────────
 * 读取
 * ────────────────────────────────────────────────────────────── */

let firstLoadDone = false

async function reload(): Promise<void> {
  loading.value = true
  errorMessage.value = ""
  try {
    const nodes = await listCanvasTree(scanRoots.value, deps().readDir)
    tree.value = nodes

    /**
     * 展开策略：
     *   · 首次加载把"根 + 一级子目录"都展开 —— 否则一进来只有几个折叠的根，像是空的
     *   · 之后只保证根是展开的，**不覆盖用户的折叠状态**（否则每次刷新都弹回来）
     */
    const next = new Set(expanded.value)
    for (const root of nodes) {
      next.add(root.path)
      if (!firstLoadDone) {
        for (const child of root.children) {
          if (child.isDir) {
            next.add(child.path)
          }
        }
      }
    }
    firstLoadDone = true
    expanded.value = next

    emit("reload", collectCanvasPathsFromTree(nodes))
  } catch (error) {
    errorMessage.value = String(error)
  } finally {
    loading.value = false
  }
}

/* ──────────────────────────────────────────────────────────────
 * 新建
 * ────────────────────────────────────────────────────────────── */

async function createCanvas(targetDir: string) {
  const dir = String(targetDir || props.defaultDirectory || "").trim()
  if (!dir) {
    return
  }
  busy.value = true
  try {
    const canvasDeps = deps()
    const baseName = t("untitledCanvas").replace(/\.canvas$/i, "") || "未命名"
    const taken = allPaths()
    const path = await findAvailableCanvasPath(canvasDeps, dir, baseName, (candidate) => taken.has(candidate))
    await canvasDeps.writeText(path, JSON.stringify(createEmptyCanvasDocument(), null, 2))
    expanded.value = new Set([...expanded.value, dir])
    // 新建完把选中挪到新文件上：连续新建会落在同一个目录，符合"接着往下加"的直觉
    selectedPath.value = path
    notify(t("canvasManagerCreated", { name: path.split("/").pop() || path }), 4000)
    await reload()
  } catch {
    notify(t("canvasManagerCreateFailed"), 4000, "error")
  } finally {
    busy.value = false
  }
}

async function createFolder(targetDir: string) {
  const dir = String(targetDir || props.defaultDirectory || "").trim()
  if (!dir) {
    return
  }
  const name = await openTextInputDialog({
    cancelLabel: t("dialogCancel"),
    confirmLabel: t("dialogConfirm"),
    initialValue: "",
    title: t("canvasManagerFolderNameTitle"),
  })
  const base = String(name ?? "").trim()
  if (!base) {
    return
  }
  if (!isValidCanvasBaseName(base)) {
    notify(t("canvasManagerRenameReasonInvalid"), 5000, "error")
    return
  }
  const path = `${dir}/${base}`
  if (allPaths().has(path)) {
    notify(t("canvasManagerRenameReasonExists"), 5000, "error")
    return
  }

  busy.value = true
  try {
    // 思源里"建目录"就是 putFile(path, isDir=true, 空 Blob)
    await deps().createDir(path)
    expanded.value = new Set([...expanded.value, dir])
    // 选中新文件夹：紧接着"新建画布"就会落到它里面，这是最常用的一串操作
    selectedPath.value = path
    notify(t("canvasManagerFolderCreated", { name: base }), 4000)
    await reload()
  } catch {
    notify(t("canvasManagerFolderCreateFailed"), 4000, "error")
  } finally {
    busy.value = false
  }
}

/* ──────────────────────────────────────────────────────────────
 * 重命名
 * ────────────────────────────────────────────────────────────── */

/** 改名后把展开状态跟着迁走（否则改完名目录突然折叠了） */
function moveExpandedPrefix(oldPrefix: string, newPrefix: string): Set<string> {
  const next = new Set<string>()
  for (const path of expanded.value) {
    if (path === oldPrefix) {
      next.add(newPrefix)
    } else if (path.startsWith(`${oldPrefix}/`)) {
      next.add(`${newPrefix}${path.slice(oldPrefix.length)}`)
    } else {
      next.add(path)
    }
  }
  return next
}

async function renameRow(node: CanvasTreeNode) {
  const currentBase = node.isDir ? node.name : node.name.replace(/\.canvas$/i, "")
  const next = await openTextInputDialog({
    cancelLabel: t("dialogCancel"),
    confirmLabel: t("dialogConfirm"),
    initialValue: currentBase,
    title: node.isDir ? t("canvasManagerFolderRenameTitle") : t("canvasManagerRenameTitle"),
  })
  const base = String(next ?? "").trim()
  if (!base || base === currentBase) {
    return
  }

  busy.value = true
  busyPath.value = node.path
  try {
    if (node.isDir) {
      await renameFolder(node, base)
    } else {
      await renameFile(node, base)
    }
  } finally {
    busy.value = false
    busyPath.value = ""
  }
}

async function renameFile(node: CanvasTreeNode, baseName: string) {
  const outcome = await renameCanvasFileWithRelink(deps(), {
    defaultDirectory: props.defaultDirectory,
    existingPaths: allPaths(),
    newBaseName: baseName,
    oldPath: node.path,
    scanRoots: scanRoots.value,
  })

  if (!outcome.ok || !outcome.newPath) {
    notify(t("canvasManagerRenameFailed", { reason: describeRenameError(outcome.error || "") }), 6000, "error")
    return
  }

  const newName = outcome.newPath.split("/").pop() || outcome.newPath
  const blocks = outcome.relink?.updatedBlocks ?? 0
  const canvases = outcome.relink?.updatedCanvases ?? 0
  if (blocks + canvases > 0) {
    notify(t("canvasManagerRenamed", { blocks, canvases, name: newName }), 6000)
  } else {
    notify(t("canvasManagerRenamedNoLinks", { name: newName }), 4000)
  }
  reportRelinkFailures(outcome.relink?.failures ?? [])

  emit("renamed", node.path, outcome.newPath)
  await reload()
}

async function renameFolder(node: CanvasTreeNode, baseName: string) {
  const oldDir = node.path
  const outcome = await renameCanvasFolderWithRelink(deps(), {
    existingPaths: allPaths(),
    newBaseName: baseName,
    oldDir,
    scanRoots: scanRoots.value,
  })

  if (!outcome.ok || !outcome.newDir) {
    notify(t("canvasManagerFolderRenameFailed", { reason: describeRenameError(outcome.error || "") }), 6000, "error")
    return
  }

  expanded.value = moveExpandedPrefix(oldDir, outcome.newDir)

  const blocks = outcome.relink?.updatedBlocks ?? 0
  const canvases = outcome.relink?.updatedCanvases ?? 0
  const name = outcome.newDir.split("/").pop() || outcome.newDir
  if (blocks + canvases > 0) {
    notify(t("canvasManagerFolderRenamed", { blocks, canvases, name }), 6000)
  } else {
    notify(t("canvasManagerFolderRenamedNoLinks", { name }), 4000)
  }
  reportRelinkFailures(outcome.relink?.failures ?? [])

  emit("renamed", oldDir, outcome.newDir)
  await reload()
}

function reportRelinkFailures(failures: string[]) {
  if (failures.length === 0) {
    return
  }
  notify(
    t("canvasManagerRelinkWarning", { count: failures.length, detail: failures.slice(0, 2).join("；") }),
    8000,
    "error",
  )
}

/* ──────────────────────────────────────────────────────────────
 * 复制
 * ────────────────────────────────────────────────────────────── */

async function copyRow(node: CanvasTreeNode) {
  const currentBase = node.isDir ? node.name : node.name.replace(/\.canvas$/i, "")
  const next = await openTextInputDialog({
    cancelLabel: t("dialogCancel"),
    confirmLabel: t("dialogConfirm"),
    initialValue: `${currentBase} 副本`,
    title: node.isDir ? t("canvasManagerFolderCopyTitle") : t("canvasManagerCopyTitle"),
  })
  const base = String(next ?? "").trim()
  if (!base) {
    return
  }

  busy.value = true
  busyPath.value = node.path
  try {
    if (node.isDir) {
      await copyFolder(node, base)
    } else {
      await copyFile(node, base)
    }
  } finally {
    busy.value = false
    busyPath.value = ""
  }
}

async function copyFile(node: CanvasTreeNode, baseName: string) {
  try {
    const canvasDeps = deps()
    const text = await canvasDeps.readText(node.path)
    if (text === null) {
      notify(t("canvasManagerCopyFailed"), 4000, "error")
      return
    }
    const dir = node.path.substring(0, node.path.lastIndexOf("/"))
    const taken = allPaths()
    const candidate = await findAvailableCanvasPath(canvasDeps, dir, baseName, (path) => taken.has(path))
    await canvasDeps.writeText(candidate, text)
    notify(t("canvasManagerCopied", { name: candidate.split("/").pop() || candidate }), 4000)
    await reload()
  } catch {
    notify(t("canvasManagerCopyFailed"), 4000, "error")
  }
}

async function copyFolder(node: CanvasTreeNode, baseName: string) {
  const parent = node.path.substring(0, node.path.lastIndexOf("/"))
  const taken = allPaths()
  // 先挑一个不重名的目录名：`duplicateCanvasFolder` 对重名是"直接拒绝"，不替用户猜
  let candidate = baseName
  for (let index = 2; taken.has(`${parent}/${candidate}`) && index <= 200; index += 1) {
    candidate = `${baseName} ${index}`
  }

  const outcome = await duplicateCanvasFolder(deps(), {
    existingPaths: taken,
    fromDir: node.path,
    newBaseName: candidate,
  })
  if (!outcome.ok || !outcome.newDir) {
    notify(t("canvasManagerFolderCopyFailed", { reason: describeRenameError(outcome.error || "") }), 6000, "error")
    return
  }

  expanded.value = new Set([...expanded.value, parent])
  notify(
    t("canvasManagerFolderCopied", {
      count: outcome.copiedFiles ?? 0,
      name: outcome.newDir.split("/").pop() || outcome.newDir,
    }),
    4000,
  )
  await reload()
}

/* ──────────────────────────────────────────────────────────────
 * 删除
 * ────────────────────────────────────────────────────────────── */

async function removeRow(node: CanvasTreeNode) {
  if (node.isDir) {
    await removeFolder(node)
    return
  }

  const confirmed = await openConfirmDialog(
    t("canvasManagerDeleteConfirmTitle"),
    t("canvasManagerDeleteConfirmText", { name: node.name }),
  )
  if (!confirmed) {
    return
  }

  busy.value = true
  busyPath.value = node.path
  try {
    await deps().removeFile(node.path)
    notify(t("canvasManagerDeleted", { name: node.name }), 4000)
    emit("deleted", node.path)
    await reload()
  } catch {
    notify(t("canvasManagerDeleteFailed"), 4000, "error")
  } finally {
    busy.value = false
    busyPath.value = ""
  }
}

async function removeFolder(node: CanvasTreeNode) {
  const inside = collectCanvasPathsFromTree([node])
  const confirmed = await openConfirmDialog(
    t("canvasManagerFolderDeleteConfirmTitle"),
    t("canvasManagerFolderDeleteConfirmText", { count: inside.length, name: node.name }),
  )
  if (!confirmed) {
    return
  }

  busy.value = true
  busyPath.value = node.path
  try {
    await deps().removeFile(node.path)
    notify(t("canvasManagerFolderDeleted", { name: node.name }), 4000)
    // 逐个上报，让父组件把"最近文件"里的死链一并清掉
    for (const path of inside) {
      emit("deleted", path)
    }
    await reload()
  } catch {
    notify(t("canvasManagerFolderDeleteFailed"), 4000, "error")
  } finally {
    busy.value = false
    busyPath.value = ""
  }
}

onMounted(() => {
  void reload()
})
</script>

<style scoped lang="scss">
.canvas-dialog-backdrop {
  position: absolute;
  inset: 0;
  /*
   * ★ 必须高于 `.canvas-toolbar`（z-index: 10）★
   *
   * 用户反馈：「文件管理窗口顶部 被 编辑界面的工具条挡住了一部分」。
   * 根因就在这里：backdrop 原本是 `z-index: 6`，而工具栏是 `10`。
   * 两者是**兄弟**（backdrop 在 `.canvas-shell` 的 Teleport 出口、
   * 工具栏是 shell 的第一个 grid 行），同处一个层叠上下文，
   * 于是工具栏稳稳压住模态框的头部 —— 看起来"顶部被吃了一块"。
   *
   * 提到 40：仍低于 `--canvas-floating` 系列里最高的 100/999
   * （那些是选择工具条、折叠条等**应当**浮在模态框之上的东西），
   * 只是确保盖过工具栏。
   */
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--b3-theme-on-surface) 24%, transparent);
  backdrop-filter: blur(4px);
}

.canvas-dialog {
  display: grid;
  gap: 12px;
  width: min(520px, calc(100% - 32px));
  padding: 18px;
  border: 1px solid var(--canvas-border);
  border-radius: 20px;
  background: var(--canvas-surface);
  box-shadow: var(--canvas-shadow-strong);
  box-sizing: border-box;
}

.canvas-dialog--manager {
  width: min(1080px, calc(100% - 32px));
  max-height: calc(100% - 48px);
  grid-template-rows: auto auto minmax(0, 1fr);
}

.canvas-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.canvas-dialog__header h2 {
  margin: 0;
  font-size: 16px;
  color: var(--canvas-text);
}

.canvas-dialog__control {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--canvas-border);
  border-radius: 12px;
  background: var(--canvas-surface);
  padding: 9px 10px;
  font: inherit;
  color: var(--canvas-text);
}

.canvas-manager__headline {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.canvas-manager__count {
  flex: none;
  font-size: 12px;
  color: var(--canvas-text-muted);
}

/* 默认目录：标题行里的弱化标签，过长时省略号截断（完整值在 title 上） */
.canvas-manager__root {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--canvas-text-muted);
  opacity: 0.75;
}

.canvas-manager__header-actions {
  display: flex;
  gap: 6px;
  flex: none;
}

.canvas-manager__toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
}

.canvas-manager__search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
}

.canvas-manager__search-icon {
  position: absolute;
  left: 10px;
  color: var(--canvas-text-muted);
  pointer-events: none;
}

.canvas-manager__search {
  flex: 1 1 auto;
  /* 给左侧的放大镜图标腾出位置 */
  padding-left: 30px;
}

.canvas-manager__toolbar-divider {
  flex: none;
  width: 1px;
  height: 20px;
  margin: 0 2px;
  background: var(--canvas-border);
}

/* ──────────────────────────────────────────────────────────────
 * 图标按钮（工具栏 + 每行动作共用一套）
 * ────────────────────────────────────────────────────────────── */

.canvas-manager__icon-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--canvas-text-muted);
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease;
}

.canvas-manager__icon-button:hover:not(:disabled) {
  background: var(--canvas-floating-button-bg-hover, color-mix(in srgb, var(--b3-theme-on-surface) 12%, transparent));
  color: var(--canvas-text);
}

.canvas-manager__icon-button:focus-visible {
  outline: 2px solid var(--canvas-accent);
  outline-offset: 1px;
}

.canvas-manager__icon-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.canvas-manager__icon-button--primary {
  color: var(--canvas-accent);
}

.canvas-manager__icon-button--danger {
  color: var(--b3-theme-error, #d23f31);
}

.canvas-manager__icon-button--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--b3-theme-error, #d23f31) 14%, transparent);
  color: var(--b3-theme-error, #d23f31);
}

/**
 * 图标按钮的 tooltip。
 *
 * ★ 为什么不用 `.canvas-toolbar [data-tooltip]` 那套 ★
 *   那是 `canvas-workspace.scss` 里给**工具栏按钮**写的全局规则，
 *   本组件是 scoped 样式、且不在那个容器里。这里按同样的视觉语言独立实现一份：
 *   `::after` 定位在按钮下方，`pointer-events: none` 避免挡到下一行的点击。
 */
.canvas-manager__icon-button[data-tooltip] {
  position: relative;
}

.canvas-manager__icon-button[data-tooltip]::after {
  content: attr(data-tooltip);
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--canvas-floating-tooltip-bg, rgba(30, 30, 30, 0.92));
  color: var(--canvas-floating-tooltip-text, #fff);
  font-size: 11px;
  line-height: 1.3;
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-2px);
  transition:
    opacity 0.12s ease,
    transform 0.12s ease,
    visibility 0.12s;
  pointer-events: none;
}

.canvas-manager__icon-button[data-tooltip]:hover::after,
.canvas-manager__icon-button[data-tooltip]:focus-visible::after {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

/* 每行最右侧的按钮组：悬停时才浮现，静止时保持列表干净 */
.canvas-manager__actions {
  display: flex;
  gap: 2px;
  flex: none;
  align-items: center;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.canvas-manager__row:hover .canvas-manager__actions,
.canvas-manager__row--selected .canvas-manager__actions,
.canvas-manager__row:focus-within .canvas-manager__actions {
  opacity: 1;
}

.canvas-manager__busy {
  font-size: 12px;
  color: var(--canvas-text-muted);
  opacity: 1;
}

.canvas-manager__list {
  overflow: auto;
  min-height: 160px;
  border: 1px solid var(--canvas-border);
  border-radius: 14px;
  background: var(--canvas-surface);
}

.canvas-manager__empty {
  margin: 0;
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--canvas-text-muted);
}

.canvas-manager__error {
  color: var(--b3-theme-error, #d23f31);
}

.canvas-manager__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  min-width: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--canvas-border) 60%, transparent);
}

.canvas-manager__row:last-child {
  border-bottom: none;
}

.canvas-manager__row--folder {
  background: color-mix(in srgb, var(--canvas-border) 14%, transparent);
}

.canvas-manager__row--active {
  box-shadow: inset 3px 0 0 var(--b3-theme-primary, #3575f0);
}

/**
 * ★ 选中态（第 33 轮新增）★
 *
 * 用途有两层：
 *   1. 它决定"点新建会建到哪"（`createTargetDir`）—— 用户必须**看得见**自己选中了谁，
 *      否则"新建到选中位置"就成了一个不可见的状态机。
 *   2. 选中时让行内的动作按钮常显（见 `.canvas-manager__actions` 的悬停规则）。
 *
 * 用背景色 + 左侧竖条，和 `--active`（当前打开的画布，用 box-shadow 竖条）
 * 区分开：两者可能同时成立（选中的正是当前打开的画布）。
 */
.canvas-manager__row--selected {
  background: var(--canvas-accent-soft);
  box-shadow: inset 3px 0 0 var(--canvas-accent);
}

.canvas-manager__row--folder.canvas-manager__row--selected {
  background: color-mix(in srgb, var(--canvas-accent) 18%, transparent);
}

.canvas-manager__row {
  cursor: pointer;
}

.canvas-manager__indent {
  flex: none;
  height: 1px;
}

.canvas-manager__twisty {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--canvas-text-muted);
  cursor: pointer;
  transition: transform 0.12s ease;
}

.canvas-manager__twisty--open {
  transform: rotate(90deg);
}

.canvas-manager__twisty--ghost {
  visibility: hidden;
}

.canvas-manager__icon {
  flex: none;
  color: var(--canvas-text-muted);
}

.canvas-manager__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}

.canvas-manager__name {
  font-size: 13px;
  color: var(--canvas-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-manager__path {
  font-size: 11px;
  color: var(--canvas-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-manager__badge {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: color-mix(in srgb, var(--b3-theme-primary, #3575f0) 18%, transparent);
  color: var(--canvas-text);
}

.canvas-manager__badge--muted {
  background: color-mix(in srgb, var(--canvas-border) 40%, transparent);
  color: var(--canvas-text-muted);
}
</style>
