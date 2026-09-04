<script setup lang="ts">
import { OSCILLATOR_TYPES, type InstrumentLane } from '../../daw/project'
import XenpaperSourceEditor from './XenpaperSourceEditor.vue'

defineProps<{ lane: InstrumentLane; collapsed?: boolean }>()
defineEmits<{
  'update-name': [name: string]
  'update-oscillator': [type: InstrumentLane['oscillatorType']]
  'update-gain': [gain: number]
  'update-source': [source: string]
  delete: []
  'toggle-collapse': []
}>()
</script>

<template>
  <header class="instrument-header" :class="{ collapsed }">
    <input
      class="lane-name"
      aria-label="Instrument lane name"
      :value="lane.name"
      @input="$emit('update-name', ($event.target as HTMLInputElement).value)"
    />
    <button
      type="button"
      class="collapse-lane"
      :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${lane.name}`"
      :aria-expanded="!collapsed"
      @click="$emit('toggle-collapse')"
    >
      {{ collapsed ? '▸ Expand' : '▾ Collapse' }}
    </button>
    <button
      type="button"
      class="delete-lane"
      :aria-label="`Delete ${lane.name}`"
      @click="$emit('delete')"
    >
      Delete lane
    </button>
    <label v-if="!collapsed">
      {{ lane.patchSource }} SW Patch ·
      <select
        aria-label="Waveform"
        :value="lane.oscillatorType"
        @change="
          $emit(
            'update-oscillator',
            ($event.target as HTMLSelectElement).value as InstrumentLane['oscillatorType'],
          )
        "
      >
        <option v-for="type in OSCILLATOR_TYPES" :key="type">
          {{ type }}
        </option>
      </select>
    </label>
    <label v-if="!collapsed">
      Gain
      <input
        aria-label="Instrument gain"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="lane.gain"
        @input="$emit('update-gain', Number(($event.target as HTMLInputElement).value))"
      />
      <output>{{ Math.round(lane.gain * 100) }}%</output>
    </label>
    <label v-if="!collapsed" class="source-control">
      Lane source
      <XenpaperSourceEditor
        editor-label="Instrument lane source"
        :source="lane.source"
        :rows="3"
        @update:source="$emit('update-source', $event)"
      />
    </label>
  </header>
</template>

<style scoped>
.instrument-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem;
  background: var(--xenpaper-bg-light);
}
.instrument-header.collapsed {
  justify-content: flex-start;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
}
.instrument-header.collapsed .delete-lane {
  margin-left: auto;
  padding-block: 0.2rem;
}
.instrument-header label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.lane-name {
  min-width: 6rem;
  width: 10rem;
  font: inherit;
  font-weight: bold;
}
.collapse-lane {
  flex: none;
  white-space: nowrap;
}
.delete-lane {
  color: var(--xenpaper-light-red);
  border: 1px solid var(--xenpaper-light-red);
  border-radius: 0.25rem;
  padding: 0.35rem 0.55rem;
  background: var(--xenpaper-bg);
  cursor: pointer;
}
.source-control {
  flex: 1 0 100%;
  align-items: stretch !important;
  flex-direction: column;
}
.source-control .xenpaper-source-editor {
  min-width: 0;
  font-family: monospace;
}
</style>
