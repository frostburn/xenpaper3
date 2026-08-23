<script setup lang="ts">
import type { GlobalTrack } from '../../daw/project'
defineProps<{ track: GlobalTrack }>()
</script>

<template>
  <section class="global-lane" aria-label="Global track">
    <span v-for="tempo in track.tempoChanges" :key="tempo.id">♩ {{ tempo.bpm }} BPM</span>
    <span v-for="signature in track.timeSignatureChanges" :key="signature.id">
      {{ signature.numerator }}/{{ signature.denominator }}
    </span>
  </section>
</template>

<style scoped>
.global-lane {
  display: flex;
  gap: 1.5rem;
  padding: 0.5rem;
  background: #202738;
}
</style>
