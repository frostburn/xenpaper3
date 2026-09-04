<script setup lang="ts">
import type { GlobalTrack } from '../../daw/project'
import XenpaperSourceEditor from './XenpaperSourceEditor.vue'

defineProps<{ track: GlobalTrack }>()
defineEmits<{
  'update-source': [source: string]
  'update-tempo': [bpm: number]
  'update-time-signature': [numerator: number, denominator: number]
}>()
</script>

<template>
  <section class="global-lane" aria-label="Global track">
    <label class="source-control">
      Global source
      <XenpaperSourceEditor
        editor-label="Global source"
        :source="track.source"
        :rows="3"
        @update:source="$emit('update-source', $event)"
      />
    </label>
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
  background: var(--xenpaper-bg-light);
}
.source-control {
  flex: 1;
  align-items: stretch !important;
  flex-direction: column;
}
.source-control .xenpaper-source-editor {
  min-width: 20rem;
  font-family: monospace;
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
