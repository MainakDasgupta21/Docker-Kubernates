<script setup>
import { onMounted, ref, watch } from 'vue'
import { useData, useRoute } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import ProgressBar from './components/ProgressBar.vue'
import FocusToggle from './components/FocusToggle.vue'
import ContinueBanner from './components/ContinueBanner.vue'
import { trackProgress, getProgress, isFocusMode, setFocusMode } from './lib/progress'
import { enhanceCallouts } from './lib/callouts'

const { Layout } = DefaultTheme
const { page } = useData()
const route = useRoute()
const progress = ref(getProgress())

function refresh() {
  trackProgress(page.value.relativePath)
  progress.value = getProgress()
  requestAnimationFrame(() => enhanceCallouts())
}

onMounted(() => {
  document.documentElement.classList.add('z2p-ready')
  setFocusMode(isFocusMode())
  refresh()
  window.addEventListener('z2p-progress', () => {
    progress.value = getProgress()
  })
})

watch(
  () => route.path,
  () => {
    refresh()
  },
)
</script>

<template>
  <Layout>
    <template #nav-bar-content-after>
      <FocusToggle />
    </template>
    <template #sidebar-nav-before>
      <ProgressBar :progress="progress" />
    </template>
    <template #doc-before>
      <ContinueBanner v-if="page.relativePath === 'index.md'" />
    </template>
  </Layout>
</template>
