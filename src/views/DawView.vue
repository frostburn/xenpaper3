<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import ClipSourceEditor from '../components/daw/ClipSourceEditor.vue'
import DrumLane from '../components/daw/DrumLane.vue'
import GlobalLane from '../components/daw/GlobalLane.vue'
import InstrumentHeader from '../components/daw/InstrumentHeader.vue'
import InstrumentPianoRollLane from '../components/daw/InstrumentPianoRollLane.vue'
import TransportControls from '../components/daw/TransportControls.vue'
import { DawAudioEngine } from '../daw/audio-engine'
import { compileSourceInitialization, drumSamplesForLane, sourceClipLength } from '../daw/score'
import {
  beat,
  beatToNumber,
  createClip,
  createDefaultProject,
  createDrumLane,
  createInstrumentLane,
  parseDawProject,
  snapBeat,
  type Beat,
  type ClipDisplayMode,
  type InstrumentLane,
  type SourceClip,
} from '../daw/project'

const project = ref(createDefaultProject())
const projectLoadError = ref('')
const selectedClipId = ref<string>()
const playhead = ref(0)
const pixelsPerBeat = ref(64)
const scrollLeft = ref(0)
const collapsedLaneIds = ref(new Set<string>())
const grid = ref<Beat>(beat(1, 4))
const displayMode = ref<ClipDisplayMode>('piano-roll')
const playing = ref(false)
const playbackError = ref('')
let playTimer: ReturnType<typeof setInterval> | undefined
let audioEngine: DawAudioEngine | undefined
const editor = ref<InstanceType<typeof ClipSourceEditor>>()
const selectedLaneId = ref<string>()
const selectedLane = computed(() =>
  project.value.instrumentLanes.find(({ id }) => id === selectedLaneId.value),
)
const selectedClip = computed(() =>
  selectedLane.value?.clips.find(({ id }) => id === selectedClipId.value),
)
const projectEndBeat = computed(() =>
  Math.max(
    0,
    ...project.value.instrumentLanes.flatMap((lane) =>
      lane.clips.map((clip) => beatToNumber(clip.start) + beatToNumber(clip.length)),
    ),
  ),
)
// Four empty bars beyond the last clip make room for extending the arrangement.
const maxScrollLeft = computed(() => Math.ceil((projectEndBeat.value + 16) * pixelsPerBeat.value))
watch(maxScrollLeft, (maximum) => {
  scrollLeft.value = Math.min(scrollLeft.value, maximum)
})
watchEffect(() => {
  const signature = project.value.globalTrack.timeSignatureChanges[0]!
  const defaultBar = beat(signature.numerator * 4, signature.denominator)
  let globalInitialization
  try {
    globalInitialization = compileSourceInitialization(project.value.globalTrack.source)
  } catch {
    // Keep independently valid clips usable while an initialization source is being edited.
    globalInitialization = undefined
  }

  for (const lane of project.value.instrumentLanes) {
    let initialization
    try {
      initialization = compileSourceInitialization(lane.source, globalInitialization)
    } catch {
      initialization = undefined
    }
    const samples = drumSamplesForLane(lane)
    for (const clip of lane.clips) {
      try {
        clip.length = sourceClipLength(clip.source, defaultBar, samples, initialization)
      } catch {
        // A clip may contain incomplete syntax while it is being edited. Isolate that
        // failure so initialization changes still resize every other clip in the project.
        clip.length = defaultBar
      }
    }
  }
})

const finishPlayback = () => {
  playing.value = false
  playhead.value = 0
  if (playTimer) clearInterval(playTimer)
  playTimer = undefined
}

const insertClip = async (lane: InstrumentLane, rawBeat: number) => {
  const start = snapBeat(Math.max(0, rawBeat), grid.value)
  const clip = createClip(lane, start)
  lane.clips.push(clip)
  selectedClipId.value = clip.id
  selectedLaneId.value = lane.id
  playhead.value = rawBeat
  await nextTick()
  editor.value?.focus()
}

const selectClip = (lane: InstrumentLane, clip: SourceClip) => {
  selectedClipId.value = clip.id
  selectedLaneId.value = lane.id
  playhead.value = beatToNumber(clip.start)
}

const startPlayback = async (fromBeat: number, playbackProject = project.value) => {
  playbackError.value = ''
  try {
    // Keep the transport usable in SSR/test environments; browsers take the audio path below.
    if (typeof AudioContext === 'undefined') {
      if (playTimer) clearInterval(playTimer)
      playhead.value = fromBeat
      playing.value = true
      playTimer = setInterval(() => (playhead.value += 0.05), 25)
      return
    }
    audioEngine ??= new DawAudioEngine()
    audioEngine.addEventListener('ended', finishPlayback)
    if (audioEngine.context.state === 'suspended') await audioEngine.context.resume()
    await audioEngine.play(playbackProject, fromBeat)
    if (playTimer) clearInterval(playTimer)
    playhead.value = fromBeat
    playing.value = true
    playTimer = setInterval(() => {
      playhead.value = audioEngine?.positionBeats ?? playhead.value
    }, 25)
  } catch (error) {
    playbackError.value = error instanceof Error ? error.message : String(error)
  }
}

const togglePlayback = async () => {
  if (playing.value) {
    audioEngine?.stop()
    playing.value = false
    if (playTimer) clearInterval(playTimer)
    playTimer = undefined
    return
  }
  await startPlayback(playhead.value)
}

const playSelectedClip = (solo: boolean) => {
  if (!selectedLane.value || !selectedClip.value) return
  const fromBeat = beatToNumber(selectedClip.value.start)
  if (!solo) return startPlayback(fromBeat)
  const soloLane = { ...selectedLane.value, clips: [selectedClip.value] }
  return startPlayback(fromBeat, { ...project.value, instrumentLanes: [soloLane] })
}

const toggleLaneCollapse = (laneId: string) => {
  const next = new Set(collapsedLaneIds.value)
  if (next.has(laneId)) next.delete(laneId)
  else next.add(laneId)
  collapsedLaneIds.value = next
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

const deleteClip = (lane: InstrumentLane, clip: SourceClip) => {
  const index = lane.clips.findIndex(({ id }) => id === clip.id)
  if (index === -1) return
  lane.clips.splice(index, 1)
  if (selectedLaneId.value === lane.id && selectedClipId.value === clip.id) {
    selectedClipId.value = undefined
    selectedLaneId.value = undefined
  }
}

const addInstrumentLane = () =>
  project.value.instrumentLanes.push(createInstrumentLane(project.value))
const addDrumLane = () => project.value.instrumentLanes.push(createDrumLane(project.value))

const deleteInstrumentLane = (lane: InstrumentLane) => {
  const index = project.value.instrumentLanes.findIndex(({ id }) => id === lane.id)
  if (index === -1) return
  project.value.instrumentLanes.splice(index, 1)
  const nextCollapsedLaneIds = new Set(collapsedLaneIds.value)
  nextCollapsedLaneIds.delete(lane.id)
  collapsedLaneIds.value = nextCollapsedLaneIds
  if (selectedLaneId.value === lane.id) {
    selectedClipId.value = undefined
    selectedLaneId.value = undefined
  }
}

const deleteSelectedClip = () => {
  if (selectedLane.value && selectedClip.value) deleteClip(selectedLane.value, selectedClip.value)
}

const updateClipSource = (clip: SourceClip, source: string) => {
  clip.source = source
}

onMounted(async () => {
  const projectUrl = new URL(document.location.href).searchParams.get('project')
  if (!projectUrl) return
  try {
    const response = await fetch(new URL(projectUrl, document.baseURI))
    if (!response.ok) throw new Error(`Could not load project (${response.status})`)
    project.value = parseDawProject(await response.text())
  } catch (error) {
    projectLoadError.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (playTimer) clearInterval(playTimer)
  audioEngine?.dispose()
  audioEngine?.removeEventListener('ended', finishPlayback)
})
</script>

<template>
  <div class="daw">
    <h1>Xenpaper DAW</h1>
    <p v-if="projectLoadError" class="playback-error" role="alert">{{ projectLoadError }}</p>
    <TransportControls
      :playhead="playhead"
      :playing="playing"
      @play="togglePlayback"
      @stop="stopPlayback"
    />
    <p v-if="playbackError" class="playback-error" role="alert">{{ playbackError }}</p>
    <div class="timeline-controls">
      <label
        >Zoom
        <input
          v-model.number="pixelsPerBeat"
          aria-label="Timeline zoom"
          type="range"
          min="8"
          max="160"
      /></label>
      <label>
        Clip view
        <select v-model="displayMode" aria-label="Clip display">
          <option value="piano-roll">Piano roll</option>
          <option value="source">Source</option>
        </select>
      </label>
    </div>
    <div class="scroll-controls">
      <label>
        Timeline scroll
        <input
          v-model.number="scrollLeft"
          aria-label="Timeline scroll"
          type="range"
          min="0"
          :max="maxScrollLeft"
        />
      </label>
    </div>
    <GlobalLane
      :track="project.globalTrack"
      @update-source="project.globalTrack.source = $event"
      @update-tempo="project.globalTrack.tempoChanges[0]!.bpm = $event"
      @update-time-signature="
        (numerator, denominator) => {
          project.globalTrack.timeSignatureChanges[0]!.numerator = numerator
          project.globalTrack.timeSignatureChanges[0]!.denominator = denominator
        }
      "
    />
    <section v-for="lane in project.instrumentLanes" :key="lane.id" class="instrument-lane">
      <DrumLane
        v-if="lane.kind === 'drum'"
        :lane="lane"
        :global-source="project.globalTrack.source"
        :selected-clip-id="selectedLaneId === lane.id ? selectedClipId : undefined"
        :pixels-per-beat="pixelsPerBeat"
        :scroll-left="scrollLeft"
        :display-mode="displayMode"
        :collapsed="collapsedLaneIds.has(lane.id)"
        @insert="insertClip(lane, $event)"
        @select="selectClip(lane, $event)"
        @place-playhead="playhead = $event"
        @move="moveClip"
        @delete="deleteClip(lane, $event)"
        @update-source="lane.source = $event"
        @update-gain="lane.gain = $event"
        @delete-lane="deleteInstrumentLane(lane)"
        @toggle-collapse="toggleLaneCollapse(lane.id)"
      />
      <template v-else>
        <InstrumentHeader
          :lane="lane"
          :collapsed="collapsedLaneIds.has(lane.id)"
          @update-source="lane.source = $event"
          @update-oscillator="lane.oscillatorType = $event"
          @update-gain="lane.gain = $event"
          @delete="deleteInstrumentLane(lane)"
          @toggle-collapse="toggleLaneCollapse(lane.id)"
        />
        <InstrumentPianoRollLane
          v-show="!collapsedLaneIds.has(lane.id)"
          :lane="lane"
          :global-source="project.globalTrack.source"
          :selected-clip-id="selectedLaneId === lane.id ? selectedClipId : undefined"
          :pixels-per-beat="pixelsPerBeat"
          :scroll-left="scrollLeft"
          :display-mode="displayMode"
          @insert="insertClip(lane, $event)"
          @select="selectClip(lane, $event)"
          @place-playhead="playhead = $event"
          @move="moveClip"
          @delete="deleteClip(lane, $event)"
        />
      </template>
    </section>
    <div class="add-lanes">
      <button type="button" class="add-lane" @click="addInstrumentLane">Add instrument lane</button>
      <button type="button" class="add-lane add-drum-lane" @click="addDrumLane">
        Add drum lane
      </button>
    </div>
    <ClipSourceEditor
      ref="editor"
      :clip="selectedClip"
      :drum-samples="selectedLane ? drumSamplesForLane(selectedLane) : undefined"
      @update-source="selectedClip && updateClipSource(selectedClip, $event)"
      @delete="deleteSelectedClip"
      @play="playSelectedClip(false)"
      @play-solo="playSelectedClip(true)"
      @stop="stopPlayback"
    />
  </div>
</template>

<style scoped>
.daw {
  max-width: 1200px;
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
.timeline-controls input[type='range'] {
  width: min(28rem, 45vw);
}
.scroll-controls {
  padding: 0 0.5rem 0.75rem;
}
.scroll-controls label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.scroll-controls input {
  flex: 1;
  min-width: 0;
}
.playback-error {
  color: #ff9b9b;
  margin: 0 0.75rem;
}
.instrument-lane + .instrument-lane {
  margin-top: 1rem;
}
.add-lane {
  flex: 1;
  margin: 0.75rem 0;
  border: 1px dashed #7184a8;
  border-radius: 0.25rem;
  padding: 0.65rem;
  color: #eef3ff;
  background: #1b2536;
  cursor: pointer;
}
.add-lanes {
  display: flex;
  gap: 0.75rem;
}
</style>
