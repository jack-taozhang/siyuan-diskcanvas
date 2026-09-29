<template>
  <div
    class="canvas-dialog-backdrop"
    data-testid="nebula-picker-dialog"
    @click.self="emit('close')"
  >
    <div
      class="canvas-dialog canvas-dialog--nebula"
      @wheel.passive.stop
    >
      <div class="canvas-dialog__header">
        <h2>{{ t('nebulaPickerTitle') }}</h2>
      </div>

      <!-- 未配置：不弹错误，直接给一条通往设置的路 -->
      <div
        v-if="!configured"
        class="canvas-nebula__notice"
        data-testid="nebula-picker-not-configured"
      >
        <p>{{ t('nebulaPickerNotConfigured') }}</p>
        <button
          class="toolbar__button toolbar__button--primary"
          type="button"
          @click="emit('open-settings')"
        >
          {{ t('nebulaPickerConfigure') }}
        </button>
      </div>

      <template v-else>
        <!-- 挂载点选择 -->
        <label class="canvas-dialog__field">
          <span>{{ t('nebulaPickerMountLabel') }}</span>
          <select
            v-model="activeMount"
            class="canvas-dialog__control"
            data-testid="nebula-picker-mount"
            @change="onMountChange"
          >
            <option
              v-for="mount in mounts"
              :key="mount.label"
              :value="mount.label"
            >{{ mount.label }}</option>
          </select>
        </label>

        <!-- 面包屑 + 返回上级 -->
        <div
          class="canvas-nebula__crumbs"
          data-testid="nebula-picker-crumbs"
        >
          <button
            class="canvas-nebula__crumb"
            type="button"
            data-testid="nebula-picker-root"
            @click="navigateTo('/')"
          >{{ activeMount || '/' }}</button>
          <template
            v-for="(segment, index) in pathSegments"
            :key="`${segment}-${index}`"
          >
            <span class="canvas-nebula__crumb-sep" aria-hidden="true">/</span>
            <button
              class="canvas-nebula__crumb"
              type="button"
              :data-testid="`nebula-picker-crumb-${index}`"
              @click="navigateTo('/' + pathSegments.slice(0, index + 1).join('/'))"
            >{{ segment }}</button>
          </template>
        </div>

        <label class="canvas-dialog__field">
          <span>{{ t('nebulaPickerSearchPlaceholder') }}</span>
          <input
            ref="searchRef"
            v-model="query"
            class="canvas-dialog__control"
            data-testid="nebula-picker-search"
            :placeholder="t('nebulaPickerSearchPlaceholder')"
          >
        </label>


        <div
          class="canvas-node-picker__options canvas-nebula__options"
          data-testid="nebula-picker-options"
        >
          <p
            v-if="loading"
            class="canvas-node-picker__empty"
            data-testid="nebula-picker-loading"
          >{{ t('nebulaPickerLoading') }}</p>

          <p
            v-else-if="errorMessage"
            class="canvas-node-picker__empty canvas-nebula__error"
            data-testid="nebula-picker-error"
          >{{ errorMessage }}</p>

          <template v-else>
            <button
              v-if="canGoUp"
              class="canvas-node-picker__option canvas-nebula__up"
              type="button"
              data-testid="nebula-picker-up"
              @click="goUp"
            >↑ {{ t('nebulaPickerUp') }}</button>

            <button
              v-for="entry in visibleEntries"
              :key="entry.path"
              :class="['canvas-node-picker__option canvas-nebula__entry', { 'canvas-nebula__entry--selected': selectedPath === entry.path }]"
              type="button"
              :data-testid="`nebula-picker-entry-${entry.isDir ? 'dir' : 'file'}`"
              :title="entry.path"
              @click="onEntryClick(entry)"
            >
              <span class="canvas-node-picker__option-kind">{{ entry.isDir ? 'DIR' : entryKindLabel(entry) }}</span>
              <strong>{{ entry.name }}</strong>
              <span class="canvas-nebula__entry-meta">{{ entry.isDir ? '' : formatSize(entry.size) }}</span>
            </button>

            <p
              v-if="visibleEntries.length === 0"
              class="canvas-node-picker__empty"
              data-testid="nebula-picker-empty"
            >{{ query.trim() ? t('nebulaPickerNoResult') : t('nebulaPickerEmpty') }}</p>
          </template>
        </div>

        <div class="canvas-dialog__actions">
          <button
            class="toolbar__button"
            type="button"
            data-testid="nebula-picker-cancel"
            @click="emit('close')"
          >
            {{ t('nebulaPickerCancel') }}
          </button>
          <button
            class="toolbar__button toolbar__button--primary"
            type="button"
            data-testid="nebula-picker-insert"
            :disabled="!selectedEntry"
            @click="insertSelected"
          >
            {{ t('nebulaPickerInsert') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NebulaEntry, NebulaMount } from '@/resources/nebula-client'
import type { NebulaClient } from '@/resources/nebula-client'

import {
  computed,
  onMounted,
  ref,
} from 'vue'
import { formatSize, pickViewer } from '@/resources/nebula-client'

const props = defineProps<{
  /**
   * 网盘客户端。
   *
   * ★ 为什么允许 null ★
   *   当插件设置里缺少 baseUrl / username / password 任一项时，
   *   `getNebulaClient()` 会返回 null。此前的写法是**外层**用
   *   `v-if="... && nebulaPickerClient"` 把对话框整个挡掉 ——
   *   导致「未配置」这段引导 UI（下方 `!configured` 分支）变成**死代码**，
   *   用户点「网盘文件」毫无反应。
   *   改为允许 null：对话框照常弹出，由 `configured` 决定显示
   *   「去设置」引导还是真正的文件浏览器。
   */
  client: NebulaClient | null
  t: (key: string, params?: Record<string, unknown>) => string
}>()

const emit = defineEmits<{
  close: []
  insert: [payload: { mount: string, path: string, name: string }]
  'open-settings': []
}>()

const mounts = ref<NebulaMount[]>([])
const activeMount = ref('')
const currentPath = ref('/')
const entries = ref<NebulaEntry[]>([])
const selectedEntry = ref<NebulaEntry | null>(null)
const query = ref('')
const loading = ref(false)
const errorMessage = ref('')
const searchRef = ref<HTMLInputElement>()

const configured = computed(() => props.client?.isConfigured() === true)

const pathSegments = computed(() => (
  currentPath.value.split('/').filter(Boolean)
))

const canGoUp = computed(() => pathSegments.value.length > 0)

/**
 * ★「包含子文件夹」+ 按后缀名搜索（第 12 轮 #15）★
 *
 * 用户要求：「网盘文件插件 支持包含子文件夹，以及文件的后缀名搜索」。
 *
 * 原本只有一个「当前目录内按名字 contains 匹配」的搜索：
 *   · 想找 `xxx.pdf` 但它在子目录里 ⇒ 必须一层层点进去；
 *   · 想「把所有 PDF 列出来」做不到。
 *
 * 现在：
 *   · **始终递归**：从当前目录收集全部子层级条目（用户要求「默认都包含所有层级」，故不再提供开关），带深度/数量上限防挂死；
 *   · 关键字匹配升级为**后缀优先**：输入 `pdf` 或 `.pdf` 时，扩展名精确等于该值的文件优先命中，
 *     同时仍保留"名字包含"的兜底（输入 `报表` 依然能搜到 `月报表.pdf`）。
 */
const recursiveEntries = ref<NebulaEntry[]>([])
const recursiveLoading = ref(false)

/** 递归收集的上限：目录深度与总条目数。挂载点可能很大，必须设闸。 */
const RECURSIVE_MAX_DEPTH = 4
const RECURSIVE_MAX_ENTRIES = 2000

/** 关键字是否"看起来像扩展名"（`pdf` / `.pdf` / `t.a.r` 之类单段字母数字） */
function readExtensionKeyword(keyword: string): string {
  const trimmed = keyword.trim().toLowerCase().replace(/^\./, '')
  return /^[a-z0-9]{1,12}$/.test(trimmed) ? trimmed : ''
}

/** 条目是否命中关键字（后缀优先，其次名字包含）。 */
function matchesQuery(entry: NebulaEntry, keyword: string): boolean {
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

  const ext = (entry.ext || name.split('.').pop() || '').toLowerCase()
  return ext === extQuery
}

/** 深度优先收集当前目录以下的全部条目（含目录本身，便于展示层级路径）。 */
async function loadRecursiveEntries() {
  const client = props.client
  if (!client || !activeMount.value) {
    recursiveEntries.value = []
    return
  }

  recursiveLoading.value = true
  const collected: NebulaEntry[] = []
  const queue: Array<{ path: string, depth: number }> = [{ path: currentPath.value || '/', depth: 0 }]

  try {
    while (queue.length > 0 && collected.length < RECURSIVE_MAX_ENTRIES) {
      const next = queue.shift()!
      if (next.depth > RECURSIVE_MAX_DEPTH) {
        continue
      }

      let children: NebulaEntry[] = []
      try {
        children = await client.list(activeMount.value, next.path)
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
          queue.push({ path: child.path, depth: next.depth + 1 })
        }
      }
    }
    recursiveEntries.value = collected
  } finally {
    recursiveLoading.value = false
  }
}

/** 目录按名称排序（目录优先），文件按名称排序 */
const visibleEntries = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  // ★ 始终递归（用户要求：「包含子文件夹选项不需要显示出来，默认都包含所有层级」）
  const source = recursiveEntries.value
  const filtered = source.filter((entry) => matchesQuery(entry, keyword))

  return [...filtered].sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
})

/**
 * 取文件类型标签。
 * 直接复用 nebula-client 的 pickViewer —— 这样画布卡片上的类型与
 * 选择器里的标签永远同源，不会出现「这里写 IMAGE、那里写 DOWNLOAD」。
 */
function entryKindLabel(entry: NebulaEntry): string {
  return pickViewer(entry.name).toUpperCase()
}

async function loadMounts() {
  // client 为 null = 未配置；此时 UI 走 `!configured` 引导分支，不需要发请求
  const client = props.client
  if (!client) {
    mounts.value = []
    entries.value = []
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    mounts.value = await client.listMounts()
    if (!activeMount.value && mounts.value.length > 0) {
      activeMount.value = mounts.value[0].label
    }
    if (activeMount.value) {
      await loadDirectory(activeMount.value, '/')
    }
  } catch (error) {
    errorMessage.value = props.t('nebulaPickerLoadFailed', { error: String(error) })
  } finally {
    loading.value = false
  }
}

async function loadDirectory(mount: string, path: string) {
  const client = props.client
  if (!client) {
    entries.value = []
    return
  }
  loading.value = true
  errorMessage.value = ''
  selectedEntry.value = null
  try {
    entries.value = await client.list(mount, path)
    currentPath.value = path || '/'
    // 换目录时重收子树（始终递归，见 visibleEntries 的说明）
    void loadRecursiveEntries()
  } catch (error) {
    entries.value = []
    errorMessage.value = props.t('nebulaPickerLoadFailed', { error: String(error) })
  } finally {
    loading.value = false
  }
}

function onMountChange() {
  void loadDirectory(activeMount.value, '/')
}

function navigateTo(path: string) {
  void loadDirectory(activeMount.value, path || '/')
}

function goUp() {
  const segments = pathSegments.value.slice(0, -1)
  navigateTo(segments.length ? `/${segments.join('/')}` : '/')
}

function onEntryClick(entry: NebulaEntry) {
  if (entry.isDir) {
    navigateTo(entry.path)
    return
  }

  selectedEntry.value = selectedEntry.value?.path === entry.path ? null : entry
}

function insertSelected() {
  const entry = selectedEntry.value
  if (!entry || !activeMount.value) {
    return
  }

  emit('insert', {
    mount: activeMount.value,
    name: entry.name,
    path: entry.path,
  })
}

onMounted(() => {
  // 未配置时不发请求：直接呈现「去设置」引导
  if (!props.client) return
  void loadMounts()
})
</script>

<style scoped lang="scss">
.canvas-dialog-backdrop {
  position: absolute;
  inset: 0;
  z-index: 6;
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

.canvas-dialog--nebula {
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

.canvas-nebula__notice {
  display: grid;
  gap: 12px;
  justify-items: start;
  padding: 16px;
  border: 1px solid var(--canvas-border);
  border-radius: 14px;
  color: var(--canvas-text);
}

.canvas-nebula__notice p {
  margin: 0;
  font-size: 13px;
}

.canvas-nebula__crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--canvas-text-muted);
}

.canvas-nebula__crumb {
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 2px 6px;
  font: inherit;
  color: var(--canvas-text);
  cursor: pointer;
}

.canvas-nebula__crumb:hover {
  background: var(--canvas-floating-button-bg-hover);
}

.canvas-nebula__crumb-sep {
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

.canvas-nebula__error {
  color: var(--b3-theme-error, #d23f31);
}

.canvas-nebula__entry strong {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.canvas-nebula__entry--selected {
  background: var(--canvas-floating-button-bg-hover);
  outline: 1px solid var(--b3-theme-primary, #5b8ff9);
}

.canvas-nebula__entry-meta {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--canvas-text-muted);
}

.canvas-nebula__up {
  justify-content: center;
  color: var(--canvas-text-muted);
}

.canvas-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
