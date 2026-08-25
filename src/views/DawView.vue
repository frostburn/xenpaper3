<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import ClipSourceEditor from '../components/daw/ClipSourceEditor.vue'
import GlobalLane from '../components/daw/GlobalLane.vue'
import InstrumentHeader from '../components/daw/InstrumentHeader.vue'
import InstrumentPianoRollLane from '../components/daw/InstrumentPianoRollLane.vue'
import TransportControls from '../components/daw/TransportControls.vue'
import { DawAudioEngine } from '../daw/audio-engine'
import { sourceClipLength } from '../daw/score'
import {
  beat,
  beatToNumber,
  createClip,
  createDefaultProject,
  snapBeat,
  type Beat,
  type ClipDisplayMode,
  type SourceClip,
} from '../daw/project'

const project = ref(createDefaultProject())
const selectedClipId = ref<string>()
const playhead = ref(0)
const pixelsPerBeat = ref(64)
const scrollLeft = ref(0)
const grid = ref<Beat>({ numerator: 1, denominator: 4 })
const displayMode = ref<ClipDisplayMode>('piano-roll')
const playing = ref(false)
const playbackError = ref('')
let playTimer: ReturnType<typeof setInterval> | undefined
let audioEngine: DawAudioEngine | undefined
const editor = ref<InstanceType<typeof ClipSourceEditor>>()
const lane = computed(() => project.value.instrumentLanes[0]!)
const selectedClip = computed(() => lane.value.clips.find(({ id }) => id === selectedClipId.value))

const finishPlayback = () => {
  playing.value = false
  playhead.value = 0
  if (playTimer) clearInterval(playTimer)
  playTimer = undefined
}

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

const togglePlayback = async () => {
  if (playing.value) {
    audioEngine?.stop()
    playing.value = false
    if (playTimer) clearInterval(playTimer)
    playTimer = undefined
    return
  }
  playbackError.value = ''
  try {
    // Keep the transport usable in SSR/test environments; browsers take the audio path below.
    if (typeof AudioContext === 'undefined') {
      playing.value = true
      playTimer = setInterval(() => (playhead.value += 0.05), 25)
      return
    }
    audioEngine ??= new DawAudioEngine()
    audioEngine.addEventListener('ended', finishPlayback)
    if (audioEngine.context.state === 'suspended') await audioEngine.context.resume()
    audioEngine.play(project.value, playhead.value)
    playing.value = true
    playTimer = setInterval(() => {
      playhead.value = audioEngine?.positionBeats ?? playhead.value
    }, 25)
  } catch (error) {
    playbackError.value = error instanceof Error ? error.message : String(error)
    playing.value = false
  }
}

const stopPlayback = () => {
  playing.value = false
  playhead.value = 0
  audioEngine?.stop()
  if (playTimer) clearInterval(playTimer)
  playTimer = undefined
}

const moveClip = (clip: SourceClip, rawBeat: number) => {
  clip.start = snapBeat(rawBeat, grid.value)
  playhead.value = beatToNumber(clip.start)
}

const deleteClip = (clip: SourceClip) => {
  const index = lane.value.clips.findIndex(({ id }) => id === clip.id)
  if (index === -1) return
  lane.value.clips.splice(index, 1)
  if (selectedClipId.value === clip.id) selectedClipId.value = undefined
}

const updateClipSource = (clip: SourceClip, source: string) => {
  clip.source = source
  const signature = project.value.globalTrack.timeSignatureChanges[0]!
  clip.length = sourceClipLength(source, beat(signature.numerator * 4, signature.denominator))
}

onBeforeUnmount(() => {
  if (playTimer) clearInterval(playTimer)
  audioEngine?.dispose()
  audioEngine?.removeEventListener('ended', finishPlayback)
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
    <p v-if="playbackError" class="playback-error" role="alert">{{ playbackError }}</p>
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
    <InstrumentHeader
      :lane="lane"
      @update-oscillator="lane.oscillatorType = $event"
      @update-gain="lane.gain = $event"
      @update-envelope="(parameter, value) => (lane.envelope[parameter] = value)"
    />
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
      @delete="deleteClip"
    />
    <ClipSourceEditor
      ref="editor"
      :clip="selectedClip"
      @update-source="selectedClip && updateClipSource(selectedClip, $event)"
      @delete="selectedClip && deleteClip(selectedClip)"
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
.playback-error {
  color: #ff9b9b;
  margin: 0 0.75rem;
}
</style>
