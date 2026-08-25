<script setup lang="ts">
import { OSCILLATOR_TYPES, type InstrumentLane } from '../../daw/project'

defineProps<{ lane: InstrumentLane }>()
defineEmits<{
  'update-oscillator': [type: InstrumentLane['oscillatorType']]
  'update-gain': [gain: number]
  'update-envelope': [parameter: keyof InstrumentLane['envelope'], value: number]
}>()
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
        <option v-for="type in OSCILLATOR_TYPES" :key="type">
          {{ type }}
        </option>
      </select>
    </label>
    <fieldset class="envelope-controls">
      <legend>Default ADSR</legend>
      <label
        v-for="parameter in ['attack', 'decay', 'sustain', 'release'] as const"
        :key="parameter"
      >
        {{ parameter[0]!.toUpperCase() }}
        <input
          :aria-label="`Default ${parameter}`"
          type="number"
          min="0"
          :max="parameter === 'sustain' ? 1 : undefined"
          step="0.01"
          :value="lane.envelope[parameter]"
          @input="
            $emit('update-envelope', parameter, Number(($event.target as HTMLInputElement).value))
          "
        />
      </label>
    </fieldset>
    <label>
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
  </header>
</template>

<style scoped>
.instrument-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem;
  background: #283143;
}
.instrument-header label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.envelope-controls {
  display: flex;
  gap: 0.4rem;
  border: 0;
  padding: 0;
}
.envelope-controls legend {
  position: absolute;
  clip: rect(0 0 0 0);
}
.envelope-controls input {
  width: 4rem;
}
</style>
