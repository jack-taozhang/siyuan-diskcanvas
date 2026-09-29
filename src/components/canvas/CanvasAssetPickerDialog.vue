<template>
  <div
    class="canvas-dialog-backdrop"
    data-testid="asset-picker-dialog"
    @click.self="emit('close')"
  >
    <div
      class="canvas-dialog canvas-dialog--asset"
      @wheel.passive.stop
    >
      <div class="canvas-dialog__header">
        <h2>{{ t('assetPickerTitle') }}</h2>
      </div>

      <label class="canvas-dialog__field">
        <span>{{ t('assetPickerSearchLabel') }}</span>
        <input
          ref="searchRef"
          v-model="query"
          class="canvas-dialog__control"
          data-testid="asset-picker-search"
          :placeholder="t('assetPickerSearchPlaceholder')"
          @input="onQueryInput"
        >
      </label>

      <div
        class="canvas-node-picker__options canvas-asset__options"
        data-testid="asset-picker-options"
      >
        <p
          v-if="loading"
          class="canvas-node-picker__empty"
          data-testid="asset-picker-loading"
        >{{ t('assetPickerLoading') }}</p>

        <p
          v-else-if="errorMessage"
          class="canvas-node-picker__empty canvas-asset__error"
          data-testid="asset-picker-error"
        >{{ errorMessage }}</p>

        <template v-else>
          <button
            v-for="option in options"
            :key="option.path"
            :class="['canvas-node-picker__option canvas-asset__entry', { 'canvas-asset__entry--selected': selectedPath === option.path }]"
            type="button"
            data-testid="asset-picker-entry"
            :title="option.path"
            @click="onOptionClick(option)"
          >
            <span class="canvas-node-picker__option-kind">{{ option.badge }}</span>
            <strong>{{ option.name }}</strong>
            <span
              v-if="option.detail"
              class="canvas-asset__entry-meta"
            >{{ option.detail }}</span>
          </button>

          <p
            v-if="options.length === 0"
            class="canvas-node-picker__empty"
            data-testid="asset-picker-empty"
          >{{ query.trim() ? t('assetPickerNoResult') : t('assetPickerEmpty') }}</p>
        </template>
      </div>

      <div class="canvas-dialog__actions">
        <button
          class="toolbar__button"
          type="button"
          data-testid="asset-picker-cancel"
          @click="emit('close')"
        >
          {{ t('assetPickerCancel') }}
        </button>
        <button
          class="toolbar__button toolbar__button--primary"
          type="button"
          data-testid="asset-picker-insert"
          :disabled="!selectedOption"
          @click="insertSelected"
        >
          {{ t('assetPickerInsert') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import type { CanvasAssetPickerOption } from '@/canvas/asset-picker'

const props = defineProps<{
  /**
   * 资源搜索函数（依赖注入）。
   *
   * ★ 为什么用注入而不是在组件里直接 fetch ★
   *   组件只负责「搜索框 + 列表 + 选中」这套交互，不关心数据从哪来。
   *   这样单测里塞一个假函数即可，不必搭内核；真机上换成长短不一的
   *   内核查询也不会牵动组件代码。
   */
  search: (query: string) => Promise<CanvasAssetPickerOption[]>
  t: (key: string, params?: Record<string, unknown>) => string
}>()

const emit = defineEmits<{
  close: []
  insert: [payload: { path: string, name: string }]
}>()

const options = ref<CanvasAssetPickerOption[]>([])
const selectedPath = ref('')
const query = ref('')
const loading = ref(false)
const errorMessage = ref('')
const searchRef = ref<HTMLInputElement>()

/**
 * 搜索序号（乐观并发控制的锚点）。
 *
 * ★ 解决什么 ★ 用户连续输入时会有多个请求在飞。若不做序号比对，
 * 先发出但后返回的旧请求会**覆盖**新结果，出现「输入 abc，列表却显示 ab 的结果」。
 * 每次请求领一个自增号，回来时只认「自己是否仍是最新一次」。
 */
let searchSeq = 0

/**
 * 防抖定时器。
 * 逐字触发内核 SQL 查询代价高（每次一个 HTTP 往返），
 * 输入停顿 220ms 再查，既跟手又不刷爆内核。
 */
let debounceTimer: ReturnType<typeof setTimeout> | undefined

const selectedOption = computed(() => (
  options.value.find(option => option.path === selectedPath.value) ?? null
))

async function runSearch(keyword: string) {
  const seq = ++searchSeq
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await props.search(keyword)
    if (seq !== searchSeq) {
      // 已有更新的请求发出 ⇒ 本次结果作废，直接丢弃
      return
    }
    options.value = result
    // 选中项若已不在新结果里则清空，避免「插入了列表里已看不到的东西」
    if (!result.some(option => option.path === selectedPath.value)) {
      selectedPath.value = ''
    }
  } catch (error) {
    if (seq !== searchSeq) {
      return
    }
    options.value = []
    selectedPath.value = ''
    errorMessage.value = props.t('assetPickerLoadFailed', { error: String(error) })
  } finally {
    if (seq === searchSeq) {
      loading.value = false
    }
  }
}

function onQueryInput() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    void runSearch(query.value)
  }, 220)
}

function onOptionClick(option: CanvasAssetPickerOption) {
  selectedPath.value = selectedPath.value === option.path ? '' : option.path
}

function insertSelected() {
  const option = selectedOption.value
  if (!option) {
    return
  }

  emit('insert', { name: option.name, path: option.path })
}

onMounted(async () => {
  // 打开即列出最近资源：空关键字在内核侧已支持（返回最近 60 条），
  // 这样用户不必先想关键词，进来就能挑。
  await nextTick()
  searchRef.value?.focus()
  void runSearch('')
})

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
})

// 外部若清空 query（例如父组件复用组件实例），同步刷新列表
watch(query, (value, previous) => {
  if (value === previous || value !== '') {
    return
  }
  void runSearch('')
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

.canvas-dialog--asset {
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

.canvas-asset__error {
  color: var(--b3-theme-error, #d23f31);
}

.canvas-asset__entry strong {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.canvas-asset__entry--selected {
  background: var(--canvas-floating-button-bg-hover);
  outline: 1px solid var(--b3-theme-primary, #5b8ff9);
}

.canvas-asset__entry-meta {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--canvas-text-muted);
}

.canvas-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
