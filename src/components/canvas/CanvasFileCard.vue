<template>
  <div
    class="file-card"
    :title="tooltip"
  >
    <!--
      ★ 画布卡片的缩略图预览已移除（第 33 轮，用户指定）★

      用户原话：「画布插入块的样式 参照 网盘文件的样式。顶部 标题 改为 画布文件，
      下面是文件名称，然后是路径。后面就没有了。删除现在的预览。和 open nested canvas.」

      所以这里**不再渲染** `.file-card__canvas-preview`（SVG 节点/连线缩略图）。
      `preview.thumbnail` 的数据通路仍然保留（`loadCanvasTargetPreview` 照旧解析），
      只是不再消费 —— 将来若要恢复预览，把这段 JSX 加回来即可。
    -->
    <img
      v-if="imageSrc"
      :src="imageSrc"
      alt=""
      class="file-card__image"
      @error="emit('image-error', node)"
    >
    <div
      v-if="showHeadline"
      class="canvas-node__title"
    >
      {{ displayHeadline }}
    </div>
    <!--
      ★ 画布卡片正文（第 35 轮：与网盘卡片同构）★
      第 1 行 = 文件名（**粗体**，与网盘卡片的文件名同一处观感）
      第 2 行 = 完整路径（灰色小字）
      两行同属一块信息 ⇒ 用 `.file-card__canvas-name` 收掉行间距，只隔 2px。
    -->
    <div
      v-if="isCanvasPreview && preview.detail"
      class="canvas-node__title file-card__canvas-name"
    >
      {{ preview.detail }}
    </div>
    <div
      v-if="isCanvasPreview && preview.pathLine"
      class="canvas-node__meta file-card__path-line"
    >
      {{ preview.pathLine }}
    </div>
    <div
      v-if="!isCanvasPreview && showDetail"
      class="canvas-node__meta"
    >
      {{ preview.detail }}
    </div>
    <div
      v-if="['block', 'document'].includes(preview.kind) && documentPreviewHtml"
      ref="documentPreviewRef"
      class="file-card__document-preview markdown-preview protyle-wysiwyg"
      v-html="documentPreviewHtml"
      @error.capture="emit('preview-image-error', node, $event)"
    />
    <div
      v-if="showHelper && preview.helper"
      class="file-card__helper"
    >
      {{ preview.helper }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUpdated, ref, watch } from 'vue'
import type { CanvasFileTargetPreview } from '@/canvas/file-target-preview'
import { triggerNativeProtyleRender } from '@/canvas/protyle-native-render'
import type { CanvasFileNode } from '@/canvas/types'

const props = withDefaults(defineProps<{
  canvasThumbnailViewBox?: string
  documentPreviewHtml: string
  imageSrc?: string
  node: CanvasFileNode
  preview: CanvasFileTargetPreview
  showDetail: boolean
  showHelper?: boolean
  showHeadline: boolean
  /**
   * 「画布文件」这个固定标题的**本地化文案**。
   *
   * 组件里不 import i18n（与 CanvasFileManagerDialog 的 `t` prop 同一约定），
   * 由父组件注入；父组件没给时退回 preview 里的英文兜底常量。
   */
  canvasHeadline?: string
  tooltip?: string
}>(), {
  showHelper: true,
})

const emit = defineEmits<{
  'image-error': [node: CanvasFileNode]
  'preview-image-error': [node: CanvasFileNode, event: Event]
}>()

const documentPreviewRef = ref<HTMLElement | null>(null)

const isCanvasPreview = computed(() => props.preview.kind === 'canvas')

/**
 * 正文第一行的标题文案。
 *
 * ★ 第 35 轮：画布卡片**不再**在这里显示「画布文件」★
 *   那个固定标题已经移到**卡片抬头**（`CanvasWorkspace.getNodeHeaderTitle`
 *   的 `canvas` 分支），因为抬头才是"这是什么"的位置，与网盘卡片一致。
 *   这里对画布卡片保留通用语义 —— 显示 `preview.headline`（= 文件名），
 *   作为父组件未把 `showHeadline` 置为 false 时的兜底；正常情况下
 *   画布卡片的这一行由下面的 `.file-card__canvas-name` 承担，不会再重复渲染。
 */
const displayHeadline = computed(() => props.preview.headline)

function scheduleNativeRender() {
  void nextTick(() => {
    triggerNativeProtyleRender(documentPreviewRef.value)
  })
}

onMounted(() => {
  scheduleNativeRender()
})

onUpdated(() => {
  scheduleNativeRender()
})

watch(() => props.documentPreviewHtml, () => {
  scheduleNativeRender()
})
</script>

<style scoped lang="scss">
.file-card {
  display: grid;
  gap: 8px;
}

.file-card:has(.file-card__image) {
  height: 100%;
  grid-template-rows: auto minmax(0, 1fr);
}

.file-card:has(.file-card__document-preview) {
  height: 100%;
  grid-template-rows: auto auto minmax(0, 1fr);
}

.file-card__badge {
  justify-self: start;
  border-radius: 999px;
  background: var(--canvas-accent-soft);
  color: var(--canvas-text);
  padding: 4px 8px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.file-card__image {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  border-radius: 12px;
  border: 1px solid var(--canvas-border);
  background: var(--canvas-surface);
}

/*
 * ★ 画布卡片的缩略图样式已随模板一并删除（第 33 轮）★
 *   `.file-card__canvas-preview` / `.file-card__thumbnail*` 三条规则此前只服务于
 *   那段 SVG 预览；组件不再渲染它，规则留着就是死代码。
 *   同时删掉 `.file-card:has(.file-card__canvas-preview)` 那条网格规则 ——
 *   否则画布卡片会被套上 `height: 100%`，内容只有三行时被撑出一大片空白。
 */

.file-card__document-preview {
  margin-top: 2px;
  min-height: 0;
  overflow: auto;
}

.file-card__helper {
  font-size: 12px;
  color: var(--canvas-text-muted);
}

.canvas-node__title {
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}

.canvas-node__meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--canvas-text-muted);
  word-break: break-all;
}

/*
 * 画布卡片的**文件名行**（正文第一行）。
 *
 * ★ 为什么复用 `.canvas-node__title` 还要加这个类（第 35 轮）★
 *   复用 `.canvas-node__title` 是为了拿到与网盘卡片文件名**完全一致**的
 *   粗体/字号/行高；加这个类只为收掉"标题 → 正文"那段 `margin-top: 8px`：
 *   它下面紧跟的是同一张文件的路径，两行属于同一块信息，隔 8px 会被读成
 *   两个不相干的区块（网盘卡片那里 detail 就是路径、本来就只有一行，没这个问题）。
 */
.file-card__canvas-name {
  margin-top: 0;
}

/*
 * 画布卡片的路径行：紧跟在文件名下面，视觉上属于同一块信息。
 * `.canvas-node__meta` 本身带 `margin-top: 8px`（那是给"标题 → 正文"的间距），
 * 这两行之间只需要 2px —— 否则会被读成两个不相干的信息块。
 */
.file-card__path-line {
  margin-top: 2px;
  font-size: 11px;
  opacity: 0.85;
}

.markdown-preview {
  white-space: normal;
  color: var(--canvas-text);
}

.markdown-preview :deep(*) {
  margin: 0;
}

.markdown-preview :deep(h1) {
  margin-top: 14px;
  margin-bottom: 8px;
  color: var(--canvas-text);
  font-size: 1.55em;
  font-weight: 700;
  line-height: 1.3;
}

.markdown-preview :deep(h2) {
  margin-top: 12px;
  margin-bottom: 6px;
  color: var(--canvas-text);
  font-size: 1.35em;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-preview :deep(h3) {
  margin-top: 10px;
  margin-bottom: 6px;
  color: var(--canvas-text);
  font-size: 1.18em;
  font-weight: 600;
  line-height: 1.35;
}

.markdown-preview :deep(h4) {
  margin-top: 8px;
  margin-bottom: 4px;
  color: var(--canvas-text);
  font-size: 1.06em;
  font-weight: 600;
  line-height: 1.4;
}

.markdown-preview :deep(h5) {
  margin-top: 6px;
  margin-bottom: 4px;
  color: var(--canvas-text);
  font-size: 0.98em;
  font-weight: 600;
  line-height: 1.4;
}

.markdown-preview :deep(h6) {
  margin-top: 6px;
  margin-bottom: 4px;
  color: var(--canvas-text-muted, var(--canvas-text));
  font-size: 0.9em;
  font-weight: 600;
  line-height: 1.4;
}


/* ★ 笔记卡片里的大纲：字号不超过卡片标题，且**按层级区分** ★
 *
 * 用户反馈：「document 下面的标题比大纲字体还小，需要进一步缩小大纲字体，且层级显示」。
 *
 * ★★ 为什么这些规则必须写在**本组件**里（第 17 轮踩的坑）★★
 *   一开始我把它们写在 `canvas-workspace.scss`（CanvasWorkspace 的 scope），
 *   编译出的选择器是 `.file-card__document-preview[data-v-<workspace>] h3`。
 *   但 `.file-card__document-preview` 是**本组件内部的元素** ——
 *   Vue scoped 只会把父 scope 属性加在子组件的**根元素**上，内部元素不带，
 *   所以那条规则**永不匹配**，大纲字号一直卡在通用的 `1.18em`（约 18.9px）。
 *   真机实测确认：该元素只带本组件的 `data-v-<CanvasFileCard>`。
 *
 * 用**绝对 px**（卡片里那行 detail 是 12px）：逐级递减 + 逐级缩进，
 * 层级一眼可辨，且全部 ≤ 10.5px，保证**小于**卡片标题。
 */
.file-card__document-preview {
  :deep(h1) {
    margin: 0 0 2px;
    padding-left: 0;
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1.5;
  }

  :deep(h2) {
    margin: 0 0 2px;
    padding-left: 8px;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.5;
  }

  :deep(h3) {
    margin: 0 0 2px;
    padding-left: 16px;
    font-size: 9.5px;
    font-weight: 500;
    line-height: 1.5;
  }

  :deep(h4) {
    margin: 0 0 1px;
    padding-left: 24px;
    font-size: 9px;
    font-weight: 500;
    line-height: 1.5;
  }

  :deep(h5) {
    margin: 0 0 1px;
    padding-left: 32px;
    font-size: 8.5px;
    font-weight: 500;
    line-height: 1.5;
  }

  :deep(h6) {
    margin: 0 0 1px;
    padding-left: 40px;
    font-size: 8.5px;
    font-weight: 500;
    line-height: 1.5;
  }
}
.markdown-preview :deep(> :first-child) {
  margin-top: 0 !important;
}

.markdown-preview :deep(> :last-child) {
  margin-bottom: 0 !important;
}

.markdown-preview :deep(p),
.markdown-preview :deep(blockquote),
.markdown-preview :deep(pre),
.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  margin-bottom: 10px;
}

.markdown-preview :deep(ul) {
  list-style-type: disc;
  list-style-position: outside;
  padding-left: 22px;
}

.markdown-preview :deep(ol) {
  list-style-type: decimal;
  list-style-position: outside;
  padding-left: 22px;
}

.markdown-preview :deep(li) {
  display: list-item;
  margin-bottom: 4px;
}

.markdown-preview :deep(li > p) {
  margin-bottom: 4px;
}

.markdown-preview :deep(ul ul),
.markdown-preview :deep(ol ul) {
  list-style-type: circle;
  margin-top: 4px;
  margin-bottom: 4px;
  padding-left: 20px;
}

.markdown-preview :deep(ul ul ul),
.markdown-preview :deep(ol ul ul),
.markdown-preview :deep(ul ol ul),
.markdown-preview :deep(ol ol ul) {
  list-style-type: square;
}

.markdown-preview :deep(ol ol),
.markdown-preview :deep(ul ol) {
  list-style-type: lower-alpha;
  margin-top: 4px;
  margin-bottom: 4px;
  padding-left: 20px;
}

.markdown-preview :deep(ol ol ol),
.markdown-preview :deep(ul ol ol),
.markdown-preview :deep(ol ol ol),
.markdown-preview :deep(ul ul ol) {
  list-style-type: lower-roman;
}

.markdown-preview :deep(ul.task-list),
.markdown-preview :deep(ol.task-list) {
  list-style-type: none;
  padding-left: 4px;
}

.markdown-preview :deep(li.task-list-item) {
  list-style-type: none;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.markdown-preview :deep(li.task-list-item input.task-list-item-checkbox) {
  margin: 3px 0 0 0;
  cursor: default;
  flex-shrink: 0;
}

.markdown-preview :deep(blockquote) {
  border-left: 3px solid var(--canvas-border-strong);
  padding-left: 10px;
  color: var(--canvas-text-muted);
}

.markdown-preview :deep(code) {
  border-radius: 6px;
  background: var(--canvas-code-bg);
  padding: 2px 6px;
  font-size: 12px;
}

.markdown-preview :deep(pre) {
  overflow: auto;
  border-radius: 10px;
  background: var(--canvas-code-bg);
  padding: 10px;
}

.markdown-preview :deep(pre code) {
  background: transparent;
  padding: 0;
}

.markdown-preview :deep(p:has(> img)) {
  display: flex;
  justify-content: center;
  align-items: center;
  max-height: 100%;
}

.markdown-preview :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 100%;
  height: auto;
  object-fit: contain;
  border-radius: 12px;
}

.markdown-preview :deep(a) {
  color: var(--canvas-accent);
  text-decoration: underline;
}

.markdown-preview :deep(table) {
  width: 100%;
  max-width: 100%;
  margin-top: 6px;
  margin-bottom: 12px;
  border-collapse: collapse;
  border-spacing: 0;
  empty-cells: show;
  border: 1px solid var(--canvas-border, var(--b3-border-color));
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
}

.markdown-preview :deep(thead) {
  background: var(--canvas-code-bg, color-mix(in srgb, var(--b3-theme-on-surface) 6%, transparent));
  color: var(--canvas-text);
  font-weight: 600;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  padding: 6px 12px;
  border: 1px solid var(--canvas-border, var(--b3-border-color));
  text-align: left;
  vertical-align: middle;
  word-break: break-word;
}

.markdown-preview :deep(th) {
  font-weight: 600;
  background: var(--canvas-code-bg, color-mix(in srgb, var(--b3-theme-on-surface) 6%, transparent));
}

.markdown-preview :deep(tbody tr:nth-child(even)) {
  background: color-mix(in srgb, var(--b3-theme-on-surface) 3%, transparent);
}

.markdown-preview :deep(tbody tr:hover) {
  background: color-mix(in srgb, var(--b3-theme-on-surface) 6%, transparent);
}

.markdown-preview :deep(th[align="center"]),
.markdown-preview :deep(td[align="center"]) {
  text-align: center;
}

.markdown-preview :deep(th[align="right"]),
.markdown-preview :deep(td[align="right"]) {
  text-align: right;
}
</style>
