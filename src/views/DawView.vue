<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
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
</script>

<template>
  <div class="daw">
    <h1>Xenpaper DAW</h1>
    <TransportControls :playhead="playhead" @stop="playhead = 0" />
    <div class="timeline-controls">
      <label>Zoom <input v-model.number="pixelsPerBeat" type="range" min="32" max="160" /></label>
      <label>Scroll <input v-model.number="scrollLeft" type="range" min="0" max="2048" /></label>
    </div>
    <GlobalLane :track="project.globalTrack" />
    <InstrumentHeader :lane="lane" />
    <InstrumentPianoRollLane
      :lane="lane"
      :selected-clip-id="selectedClipId"
      :pixels-per-beat="pixelsPerBeat"
      :scroll-left="scrollLeft"
      @insert="insertClip"
      @select="selectClip"
      @place-playhead="playhead = $event"
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
