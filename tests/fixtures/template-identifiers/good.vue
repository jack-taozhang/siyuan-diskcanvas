<template>
  <section>
    <div
      v-for="node in nodes"
      :key="node.id"
      :class="{ 'is-active': node.id === activeId }"
      :style="{ color: accentColor }"
      @click="handleClick(node)"
    >
      {{ label(node) }}
    </div>
    <p v-if="visible">{{ t("hello") }}</p>
  </section>
</template>

<script setup lang="ts">
import type { CanvasNode } from "@/canvas/types"

/**
 * 正面样例：这里出现的每个名字都必须有来源。
 * 闸门如果对这个文件报错，说明它**误报**了 —— 单测会因此失败。
 */
const props = defineProps<{
  activeId?: string
  accentColor: string
  nodes: CanvasNode[]
  visible: boolean
}>()

const emit = defineEmits<{
  (event: "pick", id: string): void
}>()

function label(node: CanvasNode): string {
  return node.id + (props.activeId || "")
}

const t = (key: string): string => `i18n:${key}`

function handleClick(node: CanvasNode): void {
  emit("pick", node.id)
  // 正则标志位（`/…/i.test`）不应被误报成标识符
  const isImage = /\.(png|jpg)$/i.test(node.id)
  // 无括号的单参箭头函数
  const ids = props.nodes.map(n => n.id)
  // ★ 解构剩余项：`rest` 由这一行声明，不该被报成"没有来源"
  const [head, ...rest] = ids
  const { id: firstId, ...others } = node
  if (isImage && ids.length > 0) {
    void label(node)
    void head
    void rest.join(",")
    void firstId
    void others
  }
}
</script>
