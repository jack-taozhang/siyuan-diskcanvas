<template>
  <div>x</div>
</template>

<script setup lang="ts">
/**
 * 反面样例②：脚本里调用了一个**没 import** 的函数。
 * 打包器会把它当全局变量原样发出（构建成功），运行时才 ReferenceError。
 */
const value = missingHelper(1)
void value
</script>
