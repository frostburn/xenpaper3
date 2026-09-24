<script setup lang="ts">
import type { Diagnostic } from '../../../xenpaper-lang'
import type { GlobalTrack } from '../../daw/project'
import XenpaperSourceEditor from './XenpaperSourceEditor.vue'

defineProps<{
  track: GlobalTrack
  diagnostics?: readonly Diagnostic[]
  settingsOpen?: boolean
  settingsTarget?: HTMLElement
}>()
defineEmits<{
  'edit-settings': []
  'update-source': [source: string]
  'update-tempo': [bpm: number]
  'update-time-signature': [numerator: number, denominator: number]
}>()
</script>

<template>
  <section class="global-lane" aria-label="Global track">
    <div class="global-summary">
      <strong>{{ track.tempoChanges[0]!.bpm }} BPM</strong>
      <span
        >{{ track.timeSignatureChanges[0]!.numerator }}/{{
          track.timeSignatureChanges[0]!.denominator
        }}</span
      >
      <span>Global tuning &amp; defaults</span>
    </div>
    <button
      type="button"
      class="edit-global-settings"
      :aria-expanded="settingsOpen || false"
      aria-label="Edit global tempo, time signature, and source"
      @click="$emit('edit-settings')"
    >
      Tempo &amp; source
    </button>
    <Teleport v-if="settingsOpen && settingsTarget" :to="settingsTarget">
      <section class="global-settings" aria-label="Global settings">
        <header>
          <p>GLOBAL TRACK</p>
          <h2>Tempo &amp; source</h2>
        </header>
        <div class="global-controls">
          <label v-for="tempo in track.tempoChanges" :key="tempo.id">
            Tempo
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
            Time signature
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
              <option v-for="value in [1, 2, 4, 8, 16]" :key="value" :value="value">
                {{ value }}
              </option>
            </select>
          </label>
        </div>
        <span class="source-label">Global source</span>
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
  </section>
</template>

<style scoped>
.global-lane {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem;
  background: var(--xenpaper-slate-875);
}
.global-summary {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;
}
.global-summary span {
  color: var(--xenpaper-slate-400);
}
.edit-global-settings {
  margin-left: auto;
}
.global-settings {
  min-width: 0;
}
.global-settings header {
  margin-bottom: 1rem;
}
.global-settings h2 {
  margin: 0.15rem 0;
  font-size: 1.15rem;
}
.global-settings header p {
  margin: 0;
  color: var(--xenpaper-cyan);
  font-size: 0.7rem;
}
.global-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.global-controls label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.global-controls input {
  width: 4rem;
}
.source-label {
  display: block;
  margin-bottom: 0.4rem;
}
.global-settings .xenpaper-source-editor {
  box-sizing: border-box;
  width: 100%;
  font-family: monospace;
}
.source-help {
  color: var(--xenpaper-slate-400);
  font-size: 0.75rem;
  line-height: 1.6;
}
</style>
