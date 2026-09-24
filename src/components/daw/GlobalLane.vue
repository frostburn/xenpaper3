<script setup lang="ts">
import type { Diagnostic } from '../../../xenpaper-lang'
import type { GlobalTrack } from '../../daw/project'
import XenpaperSourceEditor from './XenpaperSourceEditor.vue'

defineProps<{
  track: GlobalTrack
  diagnostics?: readonly Diagnostic[]
  sourceOpen?: boolean
  sourceTarget?: HTMLElement
}>()
defineEmits<{
  'update-source': [source: string]
  'update-tempo': [bpm: number]
  'update-time-signature': [numerator: number, denominator: number]
}>()
</script>

<template>
  <section class="global-lane" aria-label="Global track">
    <Teleport v-if="sourceOpen && sourceTarget" :to="sourceTarget">
      <section class="global-source-settings" aria-label="Global source editor">
        <header>
          <p>GLOBAL TRACK</p>
          <h2>Global source</h2>
        </header>
        <XenpaperSourceEditor
          editor-label="Global source"
          :source="track.source"
          :diagnostics="diagnostics"
          :rows="14"
          @update:source="$emit('update-source', $event)"
        />
        <p class="source-help">
          Set the tuning, tempo changes, meter changes, and defaults shared by every lane and clip.
        </p>
      </section>
    </Teleport>
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
  background: var(--xenpaper-slate-875);
}
.global-source-settings {
  min-width: 0;
}
.global-source-settings header {
  margin-bottom: 1rem;
}
.global-source-settings h2 {
  margin: 0.15rem 0;
  font-size: 1.15rem;
}
.global-source-settings header p {
  margin: 0;
  color: var(--xenpaper-cyan);
  font-size: 0.7rem;
}
.global-source-settings .xenpaper-source-editor {
  box-sizing: border-box;
  width: 100%;
  font-family: monospace;
}
.source-help {
  color: var(--xenpaper-slate-400);
  font-size: 0.75rem;
  line-height: 1.6;
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
