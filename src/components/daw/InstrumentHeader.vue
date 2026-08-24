<script setup lang="ts">
import type { InstrumentLane } from '../../daw/project'

defineProps<{ lane: InstrumentLane }>()
defineEmits<{ 'update-oscillator': [type: InstrumentLane['oscillatorType']] }>()
</script>

<template>
  <header class="instrument-header">
    <strong>{{ lane.name }}</strong>
    <label>
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
        <option v-for="type in ['sine', 'square', 'sawtooth', 'triangle']" :key="type">
          {{ type }}
        </option>
      </select>
    </label>
  </header>
</template>

<style scoped>
.instrument-header {
  display: flex;
  justify-content: space-between;
  padding: 0.6rem;
  background: #283143;
}
</style>
