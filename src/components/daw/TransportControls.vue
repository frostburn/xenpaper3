<script setup lang="ts">
defineProps<{ playhead: number; playing: boolean }>()
defineEmits<{ play: []; stop: [] }>()
</script>

<template>
  <div class="transport" aria-label="Transport controls">
    <button
      type="button"
      aria-label="Play"
      :title="playing ? 'Pause (Space)' : 'Play (Space)'"
      :aria-pressed="playing"
      @click="$emit('play')"
    >
      {{ playing ? '❚❚ Pause' : '▶ Play' }}
    </button>
    <button
      type="button"
      aria-label="Stop"
      title="Stop and return to the beginning (Escape)"
      @click="$emit('stop')"
    >
      ■ Stop
    </button>
    <output>Beat {{ playhead.toFixed(2) }}</output>
  </div>
</template>

<style scoped>
.transport {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0;
  flex: none;
}
.transport output {
  min-width: 6.5rem;
  font: 0.85rem monospace;
  font-variant-numeric: tabular-nums;
}
</style>
