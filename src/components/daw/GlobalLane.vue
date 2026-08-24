<script setup lang="ts">
import type { GlobalTrack } from '../../daw/project'

defineProps<{ track: GlobalTrack }>()
defineEmits<{
  'update-tempo': [bpm: number]
  'update-time-signature': [numerator: number, denominator: number]
}>()
</script>

<template>
  <section class="global-lane" aria-label="Global track">
    <label v-for="tempo in track.tempoChanges" :key="tempo.id">
      ♩
      <input
        aria-label="Tempo in BPM"
        type="number"
        min="20"
        max="400"
        :value="tempo.bpm"
        @change="$emit('update-tempo', Number(($event.target as HTMLInputElement).value))"
      />
      BPM
    </label>
    <label v-for="signature in track.timeSignatureChanges" :key="signature.id">
      <input
        aria-label="Time signature numerator"
        type="number"
        min="1"
        max="32"
        :value="signature.numerator"
        @change="
          $emit(
            'update-time-signature',
            Number(($event.target as HTMLInputElement).value),
            signature.denominator,
          )
        "
      />
      /
      <select
        aria-label="Time signature denominator"
        :value="signature.denominator"
        @change="
          $emit(
            'update-time-signature',
            signature.numerator,
            Number(($event.target as HTMLSelectElement).value),
          )
        "
      >
        <option v-for="value in [1, 2, 4, 8, 16]" :key="value" :value="value">{{ value }}</option>
      </select>
    </label>
  </section>
</template>

<style scoped>
.global-lane {
  display: flex;
  gap: 1.5rem;
  padding: 0.5rem;
  background: #202738;
}
.global-lane label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.global-lane input {
  width: 4rem;
}
</style>
