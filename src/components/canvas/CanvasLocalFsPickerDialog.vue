<template>
  <div
    class="canvas-dialog-backdrop"
    data-testid="localfs-picker-dialog"
    @click.self="emit('close')"
  >
    <div
      class="canvas-dialog canvas-dialog--localfs"
      @wheel.passive.stop
    >
      <div class="canvas-dialog__header">
        <h2>{{ t('localFsPickerTitle') }}</h2>
      </div>

      <!-- 拿不到「本机存储」契约：不弹错误，给一条可读的出路 -->
      <div
        v-if="!client"
        class="canvas-localfs__notice"
        data-testid="localfs-picker-not-configured"
      >
        <p data-testid="localfs-picker-unavailable">{{ unavailableText }}</p>
        <button
          class="toolbar__button toolbar__button--primary"
          type="button"
          @click="emit('open-settings')"
        >
          {{ t('localFsPickerConfigure') }}
        </button>
      </div>

      <template v-else>
        <!-- 位置：设了「常用文件夹」就只列这几个，否则列本机全部存储空间 -->
        <label
          v-if="roots.length > 1"
          class="canvas-dialog__field"
        >
          <span>{{ t('localFsPickerRootLabel') }}</span>
          <select
            v-model="activeRoot"
            class="canvas-dialog__control"
            data-testid="localfs-picker-root-select"
            @change="onRootChange"
          >
            <option
              v-for="root in roots"
              :key="root.path"
              :value="root.path"
            >{{ root.label }}</option>
          </select>
        </label>

        <!-- 面包屑 + 返回上级（相对当前根，根本身不显示成一段） -->
        <div
          class="canvas-localfs__crumbs"
          data-testid="localfs-picker-crumbs"
        >
          <button
            class="canvas-localfs__crumb"
            type="button"
            data-testid="localfs-picker-root"
            @click="navigateTo(activeRoot)"
          >{{ activeRootLabel }}</button>
          <template
            v-for="(segment, index) in pathSegments"
            :key="`${segment}-${index}`"
          >
            <span class="canvas-localfs__crumb-sep" aria-hidden="true">/</span>
            <button
              class="canvas-localfs__crumb"
              type="button"
              :data-testid="`localfs-picker-crumb-${index}`"
              @click="navigateTo(segmentPath(index))"
            >{{ segment }}</button>
          </template>
        </div>

        <label class="canvas-dialog__field">
          <span>{{ t('localFsPickerSearchPlaceholder') }}</span>
          <input
            ref="searchRef"
            v-model="query"
            class="canvas-dialog__control"
            data-testid="localfs-picker-search"
            :placeholder="t('localFsPickerSearchPlaceholder')"
          >
        </label>

        <div
          class="canvas-node-picker__options canvas-localfs__options"
          data-testid="localfs-picker-options"
        >
          <p
            v-if="loading || searchScanning"
            class="canvas-node-picker__empty"
            data-testid="localfs-picker-loading"
          >{{ t('localFsPickerLoading') }}</p>

          <p
            v-else-if="errorMessage"
            class="canvas-node-picker__empty canvas-localfs__error"
            data-testid="localfs-picker-error"
          >{{ errorMessage }}</p>

          <template v-else>
            <button
              v-if="canGoUp"
              class="canvas-node-picker__option canvas-localfs__up"
              type="button"
              data-testid="localfs-picker-up"
              @click="goUp"
            >↑ {{ t('localFsPickerUp') }}</button>

            <button
              v-for="entry in visibleEntries"
              :key="entry.path"
              :class="['canvas-node-picker__option canvas-localfs__entry', { 'canvas-localfs__entry--selected': selectedEntry?.path === entry.path }]"
              type="button"
              :data-testid="`localfs-picker-entry-${entry.isDir ? 'dir' : 'file'}`"
              :title="entry.path"
              @click="onEntryClick(entry)"
            >
              <span class="canvas-node-picker__option-kind">{{ entry.isDir ? 'DIR' : entryKindLabel(entry) }}</span>
              <strong>{{ entry.name }}</strong>
              <span class="canvas-localfs__entry-meta">{{ entry.isDir ? '' : formatFileSize(entry.size) }}</span>
            </button>

            <p
              v-if="visibleEntries.length === 0"
              class="canvas-node-picker__empty"
              data-testid="localfs-picker-empty"
            >{{ query.trim() ? t('localFsPickerNoResult') : t('localFsPickerEmpty') }}</p>
          </template>
        </div>

        <div class="canvas-dialog__actions">
          <button
            class="toolbar__button"
            type="button"
            data-testid="localfs-picker-cancel"
            @click="emit('close')"
          >
            {{ t('localFsPickerCancel') }}
          </button>
          <button
            class="toolbar__button toolbar__button--primary"
            type="button"
            data-testid="localfs-picker-insert"
            :disabled="!selectedEntry"
            @click="insertSelected"
          >
            {{ t('localFsPickerInsert') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { LocalFsContractClient, LocalFsEntry, LocalFsRoot } from '@/canvas/localfs-client'

import {
  computed,
  onMounted,
  ref,
  watch,
} from 'vue'
import { extOfPath, formatFileSize, localFsUnavailableMessage } from '@/canvas/localfs-client'

const props = defineProps<{
  /**
   * 「本机存储」客户端。
   *
   * ★ 为什么允许 null ★
   *   没装 / 没启用 / 版本过旧时 `getLocalFsClient()` 返回 null。
   *   若在外层用 `v-if="... && client"` 把对话框整个挡掉，
   *   用户点「本机文件」将**毫无反应**（连提示都没有）。
   *   所以照常弹出，由模板里的 `!client` 分支给出可读的出路。
   */
  client: LocalFsContractClient | null
  /**
   * 画布自己的「常用文件夹」（绝对路径）。
   *   非空 ⇒ 只列这几个作为根；空 ⇒ 列本机全部存储空间。
   */
  favorites: string[]
  t: (key: string, params?: Record<string, unknown>) => string
}>()

const emit = defineEmits<{
  close: []
  insert: [payload: { name: string, path: string }]
  'open-settings': []
}>()

const roots = ref<LocalFsRoot[]>([])
const activeRoot = ref('')
const currentPath = ref('')
const entries = ref<LocalFsEntry[]>([])
const selectedEntry = ref<LocalFsEntry | null>(null)
const query = ref('')
const loading = ref(false)
const errorMessage = ref('')
const searchRef = ref<HTMLInputElement>()

const activeRootLabel = computed(() => (
  roots.value.find((root) => root.path === activeRoot.value)?.label || activeRoot.value
))

/**
 * 拿不到契约时的正文。
 *
 * ★ 两种情况必须分开说 ★
 *   "没装"和"装了但页面跑的还是旧版 JS"对用户是**两个完全不同的动作**：
 *   前者去插件市场，后者刷新思源页面（内核缓存插件 JS，升版本号才破得掉）。
 *   只说"未检测到插件"，第二种人会把插件卸了装、装了卸，永远修不好 ——
 *   真机实测踩到过。
 */
const unavailableText = computed(() => localFsUnavailableMessage(props.t, {
  absent: 'localFsPickerNotConfigured',
  outdated: 'localFsPickerPluginOutdated',
}))

/** 面包屑**相对当前根**：根本身已经显示在最左边，不再重复成一段 */
const pathSegments = computed(() => {
  const base = activeRoot.value
  const path = currentPath.value || base
  const relative = base && path.startsWith(base) ? path.slice(base.length) : path
  return relative.split('/').filter(Boolean)
})

const canGoUp = computed(() => Boolean(currentPath.value) && currentPath.value !== activeRoot.value)

function segmentPath(index: number): string {
  const base = activeRoot.value.replace(/\/+$/, '')
  return `${base}/${pathSegments.value.slice(0, index + 1).join('/')}`
}

/**
 * ★ 始终递归搜索（沿用上一版选择器的约定）★
 *
 * 「本机文件选择器 支持包含子文件夹，以及文件的后缀名搜索」——
 * 想找 `xxx.pdf` 时它常在子目录里，一层层点进去太慢。
 * 所以从当前目录收集全部子层级条目，并给深度/数量上限防止挂死。
 * 关键字匹配**后缀优先**（输入 `pdf` / `.pdf`），同时保留"名字包含"的兜底。
 *
 * ★ 两个关键约束（都是真机踩出来的）★
 *   ① **懒触发**：只有用户真输了关键字才扫（见 `watch(query)`）。
 *      以前每次进目录都全树扫，一卷就是成百上千次列目录请求 ——
 *      对 NAS 是实打实的负担，而用户不搜索时根本用不上。
 *   ② **边扫边出**：每收够 `RECURSIVE_PUBLISH_STEP` 条就发布一次。
 *      以前是扫完整棵树才**一次性**写入，搜索结果要等全树扫完才出现 ——
 *      大卷上等于"搜不出来"。分批发布既让结果早点可见，
 *      又不会因为每列一个目录就整体重渲染而卡顿。
 */
const recursiveEntries = ref<LocalFsEntry[]>([])
const recursiveLoading = ref(false)

const RECURSIVE_MAX_DEPTH = 4
const RECURSIVE_MAX_ENTRIES = 2000
/** 每收够这么多条就发布一次（上限 2000 ⇒ 最多 40 次重渲染） */
const RECURSIVE_PUBLISH_STEP = 50

function readExtensionKeyword(keyword: string): string {
  const trimmed = keyword.trim().toLowerCase().replace(/^\./, '')
  return /^[a-z0-9]{1,12}$/.test(trimmed) ? trimmed : ''
}

function matchesQuery(entry: LocalFsEntry, keyword: string): boolean {
  if (!keyword) {
    return true
  }

  const name = entry.name.toLowerCase()
  if (name.includes(keyword)) {
    return true
  }

  if (entry.isDir) {
    return false
  }

  const extQuery = readExtensionKeyword(keyword)
  if (!extQuery) {
    return false
  }

  const ext = (entry.ext || extOfPath(entry.path)).toLowerCase()
  return ext === extQuery
}

/** 深度优先收集当前目录以下的全部条目（含目录本身，便于展示层级路径）。 */
async function loadRecursiveEntries() {
  const client = props.client
  if (!client || !currentPath.value) {
    recursiveEntries.value = []
    return
  }

  recursiveLoading.value = true
  const collected: LocalFsEntry[] = []
  let published = 0
  const queue: Array<{ path: string, depth: number }> = [{ depth: 0, path: currentPath.value }]

  try {
    while (queue.length > 0 && collected.length < RECURSIVE_MAX_ENTRIES) {
      const next = queue.shift()!
      if (next.depth > RECURSIVE_MAX_DEPTH) {
        continue
      }

      let children: LocalFsEntry[] = []
      try {
        children = await client.list(next.path)
      } catch {
        // 单个目录读失败（权限/被删）不应中断整棵树的收集
        continue
      }

      for (const child of children) {
        if (collected.length >= RECURSIVE_MAX_ENTRIES) {
          break
        }
        collected.push(child)
        if (child.isDir) {
          queue.push({ depth: next.depth + 1, path: child.path })
        }
      }

      // 边扫边发布：搜索不必等全树扫完（见函数头 ②）
      if (collected.length - published >= RECURSIVE_PUBLISH_STEP) {
        published = collected.length
        recursiveEntries.value = [...collected]
      }
    }
    recursiveEntries.value = collected
  } finally {
    recursiveLoading.value = false
  }
}

/**
 * 列表内容。
 *
 * ★★ 为什么"没输关键字"时只看**当前目录**（`entries`）★★
 *   旧版（网盘时期）把整棵子树的递归结果当成**唯一**数据源，
 *   而递归结果是一次扫完才**整体**写入的。挂载点小的时候看不出来；
 *   换成"这台机器上的存储空间"（`/vol1` 这种动辄数千项的卷）之后，
 *   全树扫完之前列表恒为空 ⇒ 界面显示"此目录为空"，
 *   用户看到的现象就是**"读不出来本地文件夹"**（真机实测踩到）。
 *   ⇒ 打开/进目录必须**立刻显示当前目录的内容**；
 *     递归只在真搜索时才需要 —— "默认包含所有层级"说的是**搜索范围**，
 *     不是"打开就一直全树扫描"。
 *
 * ★ 为什么搜索时用递归结果 ★
 *   用户想找 `xxx.pdf` 时它常在某个子目录里，一层层点进去太慢。
 *   关键字非空 ⇒ 在收集到的子树里匹配（后缀优先，见 `matchesQuery`）。
 */
const visibleEntries = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  const source = keyword ? recursiveEntries.value : entries.value
  const filtered = source.filter((entry) => matchesQuery(entry, keyword))

  return [...filtered].sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
})

/** 正在搜索、且还没出结果 ⇒ 该显示"加载中"而不是"没有匹配" */
const searchScanning = computed(() => (
  query.value.trim().length > 0 && recursiveLoading.value && visibleEntries.value.length === 0
))

/** 类型标签直接取扩展名 —— 卡片徽标也是同一套（`getFileBadge`），两边不会各写一套 */
function entryKindLabel(entry: LocalFsEntry): string {
  return extOfPath(entry.path).toUpperCase() || 'FILE'
}

function rootLabelOf(path: string): string {
  const segments = String(path || '').split('/').filter(Boolean)
  return segments[segments.length - 1] || path
}

/**
 * 载入根列表。
 *   ① 画布设了「常用文件夹」⇒ 只列它们（用户明确圈定的范围）；
 *   ② 没设 ⇒ 问「本机存储」要本机全部存储空间。
 */
async function loadRoots() {
  const client = props.client
  if (!client) {
    roots.value = []
    return
  }

  loading.value = true
  errorMessage.value = ''
  try {
    if (props.favorites.length > 0) {
      roots.value = props.favorites.map((path) => ({ label: rootLabelOf(path), path }))
    } else {
      roots.value = await client.roots()
    }

    if (roots.value.length === 0) {
      errorMessage.value = t('localFsPickerNoRoots')
      return
    }

    if (!activeRoot.value) {
      activeRoot.value = roots.value[0].path
    }
    await loadDirectory(activeRoot.value)
  } catch (error) {
    errorMessage.value = t('localFsPickerLoadFailed', { error: String(error) })
  } finally {
    loading.value = false
  }
}

async function loadDirectory(path: string) {
  const client = props.client
  if (!client) {
    entries.value = []
    return
  }

  loading.value = true
  errorMessage.value = ''
  selectedEntry.value = null
  try {
    entries.value = await client.list(path)
    currentPath.value = path || activeRoot.value
    // 换目录 ⇒ 上一轮的搜索缓存作废（同一个目录内才复用，见 watch(query)）
    recursiveEntries.value = []
    scannedPath = ''
  } catch (error) {
    entries.value = []
    errorMessage.value = t('localFsPickerLoadFailed', { error: String(error) })
  } finally {
    loading.value = false
  }
}

/**
 * 已经为哪个目录扫过子树。
 *
 * ★ 为什么要记它 ★
 *   搜索关键字是逐个字符输入的（`p` → `pd` → `pdf`），
 *   每次都重新扫全树会把 NAS 打爆。同一个目录内只扫一次，
 *   后续输入靠 `matchesQuery` 在已收集的结果里过滤 —— 这本来就是
 *   本地过滤，比重新请求快得多。进新目录时置空（见 `loadDirectory`）。
 */
let scannedPath = ''

/**
 * 只在**真正开始搜索**时才做全树扫描。
 *
 * 不在 `loadDirectory` 里扫：那样每次进目录都会把整卷走一遍，
 * 而绝大多数时候用户根本不搜索（真机实测：一卷扫不完 ⇒ 列表长时间空白）。
 */
watch(query, (value) => {
  const keyword = value.trim()
  if (!keyword || !props.client || !currentPath.value) {
    return
  }
  if (scannedPath === currentPath.value) {
    return
  }
  scannedPath = currentPath.value
  void loadRecursiveEntries()
})

function t(key: string, params?: Record<string, unknown>): string {
  return props.t(key, params)
}

function onRootChange() {
  void loadDirectory(activeRoot.value)
}

function navigateTo(path: string) {
  void loadDirectory(path || activeRoot.value)
}

function goUp() {
  const base = activeRoot.value.replace(/\/+$/, '')
  const next = pathSegments.value.slice(0, -1)
  navigateTo(next.length ? `${base}/${next.join('/')}` : activeRoot.value)
}

function onEntryClick(entry: LocalFsEntry) {
  if (entry.isDir) {
    navigateTo(entry.path)
    return
  }

  selectedEntry.value = selectedEntry.value?.path === entry.path ? null : entry
}

function insertSelected() {
  const entry = selectedEntry.value
  if (!entry || entry.isDir) {
    return
  }

  emit('insert', { name: entry.name, path: entry.path })
}

onMounted(() => {
  // 没有契约时不发请求：模板里那个分支会给出可读的出路
  if (!props.client) {
    return
  }
  void loadRoots()
})
</script>

<style scoped lang="scss">
.canvas-dialog-backdrop {
  position: absolute;
  inset: 0;
  /* 必须高于 `.canvas-toolbar`（z-index: 10），否则模态框顶部被工具栏盖住 */
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

.canvas-dialog--localfs {
  width: min(600px, calc(100% - 32px));
}

.canvas-dialog__header h2 {
  margin: 0;
  font-size: 16px;
  color: var(--canvas-text);
}

.canvas-dialog__field {
  display: grid;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--canvas-text-muted);
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

.canvas-localfs__notice {
  display: grid;
  gap: 12px;
  justify-items: start;
  padding: 16px;
  border: 1px solid var(--canvas-border);
  border-radius: 14px;
  color: var(--canvas-text);
}

.canvas-localfs__notice p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
}

.canvas-localfs__crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--canvas-text-muted);
}

.canvas-localfs__crumb {
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 2px 6px;
  font: inherit;
  color: var(--canvas-text);
  cursor: pointer;
}

.canvas-localfs__crumb:hover {
  background: var(--canvas-floating-button-bg-hover);
}

.canvas-localfs__crumb-sep {
  opacity: 0.6;
}

.canvas-node-picker__options {
  display: grid;
  gap: 6px;
  max-height: 260px;
  overflow: auto;
}

.canvas-node-picker__option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 10px;
  background: var(--canvas-floating-button-bg);
  padding: 8px 10px;
  color: var(--canvas-text);
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}

.canvas-node-picker__option:hover {
  background: var(--canvas-floating-button-bg-hover);
}

.canvas-node-picker__option-kind {
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--canvas-accent-soft);
  color: var(--canvas-text);
  padding: 2px 8px;
  font-size: 10px;
  letter-spacing: 0.06em;
}

.canvas-node-picker__empty {
  margin: 0;
  padding: 8px 10px;
  color: var(--canvas-text-muted);
  font-size: 12px;
}

.canvas-localfs__error {
  color: var(--b3-theme-error, #d23f31);
}

.canvas-localfs__entry strong {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.canvas-localfs__entry--selected {
  background: var(--canvas-floating-button-bg-hover);
  outline: 1px solid var(--b3-theme-primary, #5b8ff9);
}

.canvas-localfs__entry-meta {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--canvas-text-muted);
}

.canvas-localfs__up {
  justify-content: center;
  color: var(--canvas-text-muted);
}

.canvas-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
