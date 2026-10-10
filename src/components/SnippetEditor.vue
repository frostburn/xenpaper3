<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { compileSnippet } from '../snippet'
import { DawAudioEngine } from '../daw/audio-engine'
import {
  createDefaultProject,
  type InstrumentSource,
  type PitchedInstrumentLane,
} from '../daw/project'
import XenpaperSourceEditor from './daw/XenpaperSourceEditor.vue'
import InstrumentSettings from './daw/InstrumentSettings.vue'
import PianoRoll from './PianoRoll.vue'

const props = withDefaults(
  defineProps<{
    source: string
    instrument: InstrumentSource
    gain: number
    laneSource?: string
    simplified?: boolean
    editorLabel?: string
    rows?: number
  }>(),
  { laneSource: '', simplified: false, editorLabel: 'Xenpaper snippet source', rows: 16 },
)
const emit = defineEmits<{
  'update:source': [source: string]
  'update:instrument': [instrument: InstrumentSource]
  'update:gain': [gain: number]
}>()
const snippet = computed(() => ({
  source: props.source,
  lane: { source: props.laneSource, instrument: props.instrument, gain: props.gain },
}))
const compiled = computed(() => {
  try {
    return { result: compileSnippet(snippet.value), error: '' }
  } catch (error) {
    return { result: undefined, error: error instanceof Error ? error.message : String(error) }
  }
})
const settingsLane = computed<PitchedInstrumentLane>(() => ({
  ...(createDefaultProject().instrumentLanes[0]! as PitchedInstrumentLane),
  ...snippet.value.lane,
}))
const audioError = ref('')
const playing = ref(false)
const pending = ref(false)
const playhead = ref(0)
let engine: DawAudioEngine | undefined
let timer: ReturnType<typeof setInterval> | undefined
let playRequest = 0

const stop = () => {
  playRequest++
  engine?.stop()
  clearInterval(timer)
  timer = undefined
  playing.value = false
  pending.value = false
  playhead.value = 0
}
watch(
  snippet,
  () => {
    stop()
    audioError.value = ''
  },
  { deep: true },
)

const play = async () => {
  const result = compiled.value.result
  if (!result || pending.value) return
  stop()
  const request = ++playRequest
  pending.value = true
  audioError.value = ''
  try {
    engine ??= new DawAudioEngine()
    engine.addEventListener('ended', stop)
    if (engine.context.state === 'suspended') await engine.context.resume()
    if (request !== playRequest) return
    await engine.play(result.project, 0, { allowClipTempoDirective: true })
    if (request !== playRequest) return
    playing.value = true
    timer = setInterval(() => {
      playhead.value = engine?.positionBeats ?? 0
    }, 25)
  } catch (error) {
    if (request === playRequest)
      audioError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (request === playRequest) pending.value = false
  }
}
defineExpose({ stop })
onBeforeUnmount(() => {
  stop()
  engine?.removeEventListener('ended', stop)
  engine?.dispose()
})
</script>

<template>
  <div class="snippet-editor" :class="{ simplified }">
    <div class="toolbar">
      <div class="transport" aria-label="Transport controls">
        <button
          type="button"
          aria-label="Play"
          :aria-pressed="playing"
          :disabled="pending || !compiled.result"
          @click="play"
        >
          Play
        </button>
        <button type="button" aria-label="Stop" @click="stop">Stop</button>
        <output v-if="!simplified">Beat {{ playhead.toFixed(2) }}</output>
      </div>
      <span v-if="pending" role="status">Preparing audio…</span>
      <span v-if="!simplified && compiled.result" class="duration"
        >{{ compiled.result.score.duration.toFraction() }} beats</span
      >
    </div>
    <p v-if="audioError" role="alert" class="error">{{ audioError }}</p>
    <div class="workspace">
      <section aria-label="Clip editor" class="clip-editor">
        <h2 v-if="!simplified">Clip source</h2>
        <XenpaperSourceEditor
          :editor-label="editorLabel"
          :source="source"
          :rows="rows"
          :diagnostics="compiled.result?.diagnostics"
          @update:source="emit('update:source', $event)"
        />
        <p v-if="compiled.error" role="alert" class="error">{{ compiled.error }}</p>
      </section>
      <section aria-label="Instrument config" class="instrument-config">
        <h2 v-if="!simplified">Instrument config</h2>
        <label class="gain"
          >Gain
          <input
            aria-label="Instrument gain"
            :value="gain"
            type="range"
            min="0"
            max="1"
            step="0.01"
            @input="emit('update:gain', ($event.target as HTMLInputElement).valueAsNumber)"
          />
          <output>{{ Math.round(gain * 100) }}%</output>
        </label>
        <InstrumentSettings
          :lane="settingsLane"
          :simplified="simplified"
          @update-instrument="emit('update:instrument', $event)"
        />
      </section>
    </div>
    <section v-if="!simplified" class="preview" aria-label="Snippet piano roll">
      <PianoRoll :score="compiled.result?.score" />
    </section>
  </div>
</template>

<style scoped>
.snippet-editor {
  min-width: 0;
  color: var(--xenpaper-slate-100);
  font-size: 0.875rem;
}
.toolbar,
.transport,
.gain {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.toolbar {
  border-block: 1px solid var(--xenpaper-slate-500);
  padding: 0.75rem 0;
}
.duration {
  margin-left: auto;
  color: var(--xenpaper-slate-400);
}
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 1.5rem;
  margin-top: 1.5rem;
}
.clip-editor,
.instrument-config {
  min-width: 0;
}
.instrument-config {
  padding-left: 1.5rem;
  border-left: 1px solid var(--xenpaper-slate-500);
}
h2 {
  margin: 0 0 1rem;
  font-size: 1.15rem;
}
.gain {
  margin-bottom: 1rem;
}
.gain input {
  flex: 1;
  min-width: 5rem;
}
.gain output {
  min-width: 3rem;
}
.error {
  color: var(--xenpaper-light-red);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.preview {
  margin: 1.5rem 0;
  min-width: 0;
  overflow-x: auto;
}
.snippet-editor :deep(button:not(.line-caret)),
.snippet-editor :deep(select),
.snippet-editor :deep(input:not([type='range']):not([type='radio']):not([type='file'])) {
  min-height: 2rem;
  border: 1px solid var(--xenpaper-slate-500);
  border-radius: 0.3rem;
  padding: 0.35rem 0.55rem;
  color: inherit;
  background: var(--xenpaper-slate-850);
  font: inherit;
}
.snippet-editor :deep(button) {
  cursor: pointer;
}
.snippet-editor :deep(button:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}
.snippet-editor :deep(input[type='range']),
.snippet-editor :deep(input[type='radio']) {
  accent-color: var(--xenpaper-cyan);
}
.snippet-editor :deep(.instrument-kind),
.snippet-editor :deep(.instrument-import) {
  flex-wrap: wrap;
}
.snippet-editor :deep(.instrument-import input[type='url']) {
  min-width: 0;
  width: 100%;
}
.snippet-editor :deep(.instrument-source label) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.4rem;
}
.snippet-editor :deep(.instrument-source select) {
  min-width: 0;
  max-width: 70%;
}
.simplified .workspace {
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}
.simplified .instrument-config {
  padding: 0;
  border: 0;
}
.simplified .toolbar {
  border: 0;
  padding: 0;
}
@media (max-width: 760px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .instrument-config {
    padding: 1rem 0 0;
    border-left: 0;
    border-top: 1px solid var(--xenpaper-slate-500);
  }
  .duration {
    margin-left: 0;
  }
}
</style>
