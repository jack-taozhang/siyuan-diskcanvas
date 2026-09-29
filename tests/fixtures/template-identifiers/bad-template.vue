<template>
  <!-- 反面样例①：模板里引用了一个既没声明也没 import 的名字（真实事故形态） -->
  <div v-if="!notDeclared.visible">x</div>
</template>

<script setup lang="ts">
const visible = true
void visible
</script>
