<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import ClipSourceEditor from '../components/daw/ClipSourceEditor.vue'
import GlobalLane from '../components/daw/GlobalLane.vue'
import InstrumentHeader from '../components/daw/InstrumentHeader.vue'
import InstrumentPianoRollLane from '../components/daw/InstrumentPianoRollLane.vue'
import TransportControls from '../components/daw/TransportControls.vue'
import {
  beatToNumber,
  createClip,
  createDefaultProject,
  snapBeat,
  type Beat,
  type SourceClip,
} from '../daw/project'

const project = ref(createDefaultProject())
const selectedClipId = ref<string>()
const playhead = ref(0)
const pixelsPerBeat = ref(64)
const scrollLeft = ref(0)
const grid = ref<Beat>({ numerator: 1, denominator: 4 })
const displayMode = ref<'source' | 'piano-roll'>('piano-roll')
const playing = ref(false)
let playTimer: ReturnType<typeof setInterval> | undefined
const editor = ref<InstanceType<typeof ClipSourceEditor>>()
const lane = computed(() => project.value.instrumentLanes[0]!)
const selectedClip = computed(() => lane.value.clips.find(({ id }) => id === selectedClipId.value))

const insertClip = async (rawBeat: number) => {
  const start = snapBeat(Math.max(0, rawBeat), grid.value)
  const clip = createClip(lane.value, start)
  lane.value.clips.push(clip)
  selectedClipId.value = clip.id
  playhead.value = rawBeat
  await nextTick()
  editor.value?.focus()
}

const selectClip = (clip: SourceClip) => {
  selectedClipId.value = clip.id
  playhead.value = beatToNumber(clip.start)
}

const togglePlayback = () => {
  playing.value = !playing.value
  if (playTimer) clearInterval(playTimer)
  playTimer = playing.value ? setInterval(() => (playhead.value += 0.05), 25) : undefined
}

const stopPlayback = () => {
  playing.value = false
  playhead.value = 0
  if (playTimer) clearInterval(playTimer)
  playTimer = undefined
}

const moveClip = (clip: SourceClip, rawBeat: number) => {
  clip.start = snapBeat(rawBeat, grid.value)
  playhead.value = beatToNumber(clip.start)
}

onBeforeUnmount(() => {
  if (playTimer) clearInterval(playTimer)
})
</script>

<template>
  <div class="daw">
    <h1>Xenpaper DAW</h1>
    <TransportControls
      :playhead="playhead"
      :playing="playing"
      @play="togglePlayback"
      @stop="stopPlayback"
    />
    <div class="timeline-controls">
      <label>Zoom <input v-model.number="pixelsPerBeat" type="range" min="32" max="160" /></label>
      <label>Scroll <input v-model.number="scrollLeft" type="range" min="0" max="2048" /></label>
      <label>
        Clip view
        <select v-model="displayMode" aria-label="Clip display">
          <option value="piano-roll">Piano roll</option>
          <option value="source">Source</option>
        </select>
      </label>
    </div>
    <GlobalLane
      :track="project.globalTrack"
      @update-tempo="project.globalTrack.tempoChanges[0]!.bpm = $event"
      @update-time-signature="
        (numerator, denominator) => {
          project.globalTrack.timeSignatureChanges[0]!.numerator = numerator
          project.globalTrack.timeSignatureChanges[0]!.denominator = denominator
        }
      "
    />
    <InstrumentHeader :lane="lane" @update-oscillator="lane.oscillatorType = $event" />
    <InstrumentPianoRollLane
      :lane="lane"
      :selected-clip-id="selectedClipId"
      :pixels-per-beat="pixelsPerBeat"
      :scroll-left="scrollLeft"
      :display-mode="displayMode"
      @insert="insertClip"
      @select="selectClip"
      @place-playhead="playhead = $event"
      @move="moveClip"
    />
    <ClipSourceEditor
      ref="editor"
      :clip="selectedClip"
      @update-source="selectedClip && (selectedClip.source = $event)"
    />
  </div>
</template>

<style scoped>
.daw {
  max-width: 1100px;
  margin: auto;
  padding: 1rem;
  color: #eef3ff;
  background: #101622;
}
.timeline-controls {
  display: flex;
  gap: 2rem;
  padding: 0.5rem;
}
.timeline-controls label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
