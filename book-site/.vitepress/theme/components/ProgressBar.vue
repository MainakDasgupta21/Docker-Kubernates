<script setup>
defineProps({
  progress: {
    type: Object,
    required: true,
  },
})
</script>

<template>
  <div class="z2p-progress" aria-label="Reading progress">
    <div class="z2p-progress__label">
      <span>Your path</span>
      <strong>{{ progress.percent }}%</strong>
    </div>
    <div class="z2p-progress__track" role="progressbar" :aria-valuenow="progress.percent" aria-valuemin="0" aria-valuemax="100">
      <div class="z2p-progress__fill" :style="{ width: progress.percent + '%' }" />
    </div>
    <p class="z2p-progress__meta">{{ progress.done }} / {{ progress.total }} chapters</p>
  </div>
</template>
