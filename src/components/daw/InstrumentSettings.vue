<script setup lang="ts">
import { ref, watch } from 'vue'
import { githubRawUrl, parseDoughSampleMap } from '../../../sw-seq'
import {
  NOISE_COLORS,
  NOISE_INTERPOLATIONS,
  OSCILLATOR_TYPES,
  PERIODIC_OSCILLATOR_TYPES,
  type NoiseColor,
  type NoiseInterpolation,
  type OscillatorType,
  type PatchInstrumentSource,
  type PitchedInstrumentLane,
} from '../../daw/project'
const props = defineProps<{ lane: PitchedInstrumentLane }>()
const emit = defineEmits<{ 'update-instrument': [source: PitchedInstrumentLane['instrument']] }>()
const sampleUrl = ref(props.lane.instrument.type === 'samples' ? props.lane.instrument.url : '')
const sampleError = ref('')
const loadingSamples = ref(false)
type InstrumentMode = 'patch' | 'unison' | 'driven-noise' | 'samples'
const instrumentModeFor = (instrument: PitchedInstrumentLane['instrument']): InstrumentMode =>
  instrument.type === 'patch' &&
  (instrument.patchPreset === 'driven-noise' || instrument.patchPreset === 'unison')
    ? instrument.patchPreset
    : instrument.type
const instrumentMode = ref<InstrumentMode>(instrumentModeFor(props.lane.instrument))
const unisonInstrument = ref<PatchInstrumentSource>(
  props.lane.instrument.type === 'patch' && props.lane.instrument.patchPreset === 'unison'
    ? { ...props.lane.instrument, numberOfVoices: props.lane.instrument.numberOfVoices ?? 5 }
    : { type: 'patch', patchPreset: 'unison', oscillatorType: 'sawtooth', numberOfVoices: 5 },
)
const drivenNoiseInstrument = ref<PatchInstrumentSource>({
  type: 'patch',
  patchPreset: 'driven-noise',
  oscillatorType:
    props.lane.instrument.type === 'patch' ? props.lane.instrument.oscillatorType : 'sawtooth',
  color:
    props.lane.instrument.type === 'patch' && props.lane.instrument.patchPreset === 'driven-noise'
      ? (props.lane.instrument.color ?? 'white')
      : 'white',
  interpolation:
    props.lane.instrument.type === 'patch' && props.lane.instrument.patchPreset === 'driven-noise'
      ? (props.lane.instrument.interpolation ?? 'constant')
      : 'constant',
})
const patchInstrument = ref<PatchInstrumentSource>(
  props.lane.instrument.type === 'patch' &&
    !['driven-noise', 'unison'].includes(props.lane.instrument.patchPreset)
    ? { ...props.lane.instrument }
    : { type: 'patch', patchPreset: 'default', oscillatorType: 'sawtooth' },
)

watch(
  () => props.lane.instrument,
  (source) => {
    instrumentMode.value = instrumentModeFor(source)
    if (source.type === 'samples') {
      sampleUrl.value = source.url
    } else if (source.patchPreset === 'unison') {
      unisonInstrument.value = { ...source, numberOfVoices: source.numberOfVoices ?? 5 }
    } else if (source.patchPreset === 'driven-noise') {
      drivenNoiseInstrument.value = {
        ...source,
        color: source.color ?? 'white',
        interpolation: source.interpolation ?? 'constant',
      }
    } else {
      patchInstrument.value = { ...source }
    }
  },
)

const selectInstrumentMode = (mode: InstrumentMode) => {
  instrumentMode.value = mode
  sampleError.value = ''
  if (mode === 'patch') emit('update-instrument', { ...patchInstrument.value })
  if (mode === 'unison') emit('update-instrument', { ...unisonInstrument.value })
  if (mode === 'driven-noise') {
    drivenNoiseInstrument.value.oscillatorType = patchInstrument.value.oscillatorType
    emit('update-instrument', { ...drivenNoiseInstrument.value })
  }
}

const updateOscillator = (oscillatorType: OscillatorType) => {
  patchInstrument.value = { ...patchInstrument.value, oscillatorType }
  emit('update-instrument', { ...patchInstrument.value })
}

const updateUnison = (updates: Partial<PatchInstrumentSource>) => {
  unisonInstrument.value = { ...unisonInstrument.value, ...updates }
  emit('update-instrument', { ...unisonInstrument.value })
}
const updateVoices = (value: number) => {
  if (Number.isInteger(value) && value >= 1 && value <= 32) updateUnison({ numberOfVoices: value })
}

const updateDrivenNoise = (updates: { color?: NoiseColor; interpolation?: NoiseInterpolation }) => {
  drivenNoiseInstrument.value = { ...drivenNoiseInstrument.value, ...updates }
  emit('update-instrument', { ...drivenNoiseInstrument.value })
}

const importSampleJson = (text: string, url = '') => {
  const manifest = parseDoughSampleMap(JSON.parse(text))
  const instruments = Object.keys(manifest).filter((name) => name !== '_base')
  if (!instruments.length) throw new TypeError('The Dough manifest contains no instruments')
  emit('update-instrument', {
    type: 'samples',
    url,
    doughJson: manifest,
    instrument: instruments[0]!,
  })
  instrumentMode.value = 'samples'
  sampleError.value = ''
}

const loadSampleUrl = async () => {
  loadingSamples.value = true
  sampleError.value = ''
  try {
    const response = await fetch(githubRawUrl(sampleUrl.value, globalThis.location.href))
    if (!response.ok) throw new Error(`Unable to load instrument: HTTP ${response.status}`)
    importSampleJson(await response.text(), sampleUrl.value)
  } catch (error) {
    sampleError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loadingSamples.value = false
  }
}

const uploadSamples = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    importSampleJson(await file.text())
  } catch (error) {
    sampleError.value = error instanceof Error ? error.message : String(error)
  } finally {
    input.value = ''
  }
}
</script>
<template>
  <fieldset class="instrument-kind">
    <legend>Instrument sound source</legend>
    <label
      ><input
        type="radio"
        value="patch"
        :checked="instrumentMode === 'patch'"
        @change="selectInstrumentMode('patch')"
      />
      Default</label
    >
    <label
      ><input
        type="radio"
        value="unison"
        :checked="instrumentMode === 'unison'"
        @change="selectInstrumentMode('unison')"
      />
      Unison</label
    >
    <label
      ><input
        type="radio"
        value="driven-noise"
        :checked="instrumentMode === 'driven-noise'"
        @change="selectInstrumentMode('driven-noise')"
      />
      Noise</label
    >
    <label
      ><input
        type="radio"
        value="samples"
        :checked="instrumentMode === 'samples'"
        @change="selectInstrumentMode('samples')"
      />
      Sampled</label
    >
  </fieldset>
  <section
    v-if="instrumentMode === 'patch'"
    class="instrument-source"
    aria-label="SW Patch instrument source"
  >
    <strong
      >{{ lane.instrument.type === 'patch' ? lane.instrument.patchPreset : 'default' }} SW
      Patch</strong
    >
    <label
      >Waveform
      <select
        aria-label="Waveform"
        :value="lane.instrument.type === 'patch' ? lane.instrument.oscillatorType : 'sawtooth'"
        @change="updateOscillator(($event.target as HTMLSelectElement).value as OscillatorType)"
      >
        <option v-for="type in OSCILLATOR_TYPES" :key="type">{{ type }}</option>
      </select>
    </label>
  </section>
  <section
    v-else-if="instrumentMode === 'unison'"
    class="instrument-source"
    aria-label="Unison instrument source"
  >
    <strong>Unison SW Patch</strong>
    <label
      >Waveform
      <select
        aria-label="Unison waveform"
        :value="unisonInstrument.oscillatorType"
        @change="
          updateUnison({
            oscillatorType: ($event.target as HTMLSelectElement).value as OscillatorType,
          })
        "
      >
        <option v-for="type in PERIODIC_OSCILLATOR_TYPES" :key="type">{{ type }}</option>
      </select>
    </label>
    <label
      >Voices
      <input
        aria-label="Unison voices"
        type="number"
        min="1"
        max="32"
        step="1"
        :value="unisonInstrument.numberOfVoices"
        @change="updateVoices(($event.target as HTMLInputElement).valueAsNumber)"
      />
    </label>
  </section>
  <section
    v-else-if="instrumentMode === 'samples'"
    class="instrument-source"
    aria-label="Sampled instrument source"
  >
    <strong>{{
      lane.instrument.type === 'samples' ? 'Dough samples loaded' : 'Choose a Dough JSON manifest'
    }}</strong>
    <span class="instrument-import">
      <input
        v-model="sampleUrl"
        aria-label="Instrument JSON URL"
        type="url"
        placeholder="https://…/samples.json"
      />
      <button type="button" :disabled="loadingSamples || !sampleUrl" @click="loadSampleUrl">
        {{ loadingSamples ? 'Loading…' : 'Load URL' }}
      </button>
      <label class="sample-upload"
        >Upload JSON
        <input
          aria-label="Upload instrument JSON"
          type="file"
          accept="application/json,.json"
          @change="uploadSamples"
        />
      </label>
    </span>
    <label v-if="lane.instrument.type === 'samples'"
      >Sample bank
      <select
        :value="lane.instrument.instrument"
        @change="
          emit('update-instrument', {
            ...lane.instrument,
            instrument: ($event.target as HTMLSelectElement).value,
          })
        "
      >
        <option
          v-for="name in Object.keys(lane.instrument.doughJson).filter((name) => name !== '_base')"
          :key="name"
        >
          {{ name }}
        </option>
      </select>
    </label>
  </section>
  <section v-else class="instrument-source" aria-label="Driven noise instrument source">
    <strong>Driven noise SW Patch</strong>
    <label
      >Color
      <select
        aria-label="Noise color"
        :value="drivenNoiseInstrument.color"
        @change="
          updateDrivenNoise({ color: ($event.target as HTMLSelectElement).value as NoiseColor })
        "
      >
        <option v-for="color in NOISE_COLORS" :key="color">{{ color }}</option>
      </select>
    </label>
    <label
      >Interpolation
      <select
        aria-label="Noise interpolation"
        :value="drivenNoiseInstrument.interpolation"
        @change="
          updateDrivenNoise({
            interpolation: ($event.target as HTMLSelectElement).value as NoiseInterpolation,
          })
        "
      >
        <option v-for="interpolation in NOISE_INTERPOLATIONS" :key="interpolation">
          {{ interpolation }}
        </option>
      </select>
    </label>
  </section>
  <span v-if="sampleError" class="instrument-error" role="alert">{{ sampleError }}</span>
</template>
<style scoped>
.instrument-source {
  display: grid;
  align-items: center;
  gap: 0.25rem;
  flex: 1 1 24rem;
}
.instrument-kind {
  display: flex;
  gap: 0.75rem;
  border: 0;
  padding: 0;
}
.instrument-import {
  display: flex;
  gap: 0.4rem;
}
.instrument-import input[type='url'] {
  flex: 1;
  min-width: 12rem;
}
.sample-upload {
  cursor: pointer;
}
.sample-upload input {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
}
.instrument-error {
  color: var(--xenpaper-light-red);
}
</style>
