<script setup>
import { onMounted, ref } from 'vue'
import { getProgress } from '../lib/progress'

const last = ref(null)

onMounted(() => {
  const p = getProgress()
  last.value = p.last
})
</script>

<template>
  <div v-if="last" class="z2p-continue">
    <div class="z2p-continue__copy">
      <span class="z2p-continue__eyebrow">Continue where you left off</span>
      <strong class="z2p-continue__title">{{ last.title }}</strong>
    </div>
    <a class="z2p-continue__cta" :href="last.href">Resume reading</a>
  </div>
</template>
