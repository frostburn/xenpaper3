<script setup lang="ts">
defineProps<{ playhead: number }>()
defineEmits<{ play: []; stop: [] }>()
</script>

<template>
  <div class="transport" aria-label="Transport controls">
    <button type="button" aria-label="Play" @click="$emit('play')">▶</button>
    <button type="button" aria-label="Stop" @click="$emit('stop')">■</button>
    <output>Beat {{ playhead.toFixed(2) }}</output>
  </div>
</template>

<style scoped>
.transport {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
}
</style>
