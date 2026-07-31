<script setup>
import { onMounted, ref } from 'vue'
import { isFocusMode, setFocusMode } from '../lib/progress'

const on = ref(false)

onMounted(() => {
  on.value = isFocusMode()
  setFocusMode(on.value)
})

function toggle() {
  on.value = !on.value
  setFocusMode(on.value)
}
</script>

<template>
  <button
    type="button"
    class="z2p-focus-btn"
    :aria-pressed="on"
    :title="on ? 'Exit focus mode' : 'Focus mode — hide sidebar'"
    @click="toggle"
  >
    {{ on ? 'Exit focus' : 'Focus' }}
  </button>
</template>
