<script setup lang="ts">
import { computed } from 'vue'
import {
  compileSourceInitialization,
  drumSamplesForLane,
  parseDrumClipNotes,
} from '../../daw/score'
import {
  beatToNumber,
  type ClipDisplayMode,
  type InstrumentLane,
  type SourceClip,
} from '../../daw/project'
import InstrumentLaneComponent from './InstrumentLane.vue'

const props = defineProps<{
  lane: InstrumentLane
  globalSource?: string
  selectedClipId?: string
  pixelsPerBeat: number
  scrollLeft: number
  displayMode: ClipDisplayMode
  collapsed?: boolean
}>()
const emit = defineEmits<{
  insert: [beat: number]
  select: [clip: SourceClip]
  'place-playhead': [beat: number]
  move: [clip: SourceClip, beat: number]
  delete: [clip: SourceClip]
  'update-source': [source: string]
  'update-name': [name: string]
  'update-gain': [gain: number]
  deleteLane: []
  'toggle-collapse': []
}>()

// Rows run top-to-bottom, so reverse alphabetical order puts alphabetical
// progression from the bottom of the roll upwards.
const samples = computed(() =>
  [...drumSamplesForLane(props.lane)].sort((left, right) => right.localeCompare(left)),
)
const eventsByClip = computed(() => {
  let initialization
  try {
    const globalInitialization = compileSourceInitialization(props.globalSource ?? '')
    initialization = compileSourceInitialization(props.lane.source, globalInitialization)
  } catch {
    initialization = undefined
  }
  return Object.fromEntries(
    props.lane.clips.map((clip) => {
      try {
        if (!initialization) throw new Error('Invalid initialization source')
        return [
          clip.id,
          parseDrumClipNotes(clip.source, samples.value, beatToNumber(clip.length), initialization),
        ]
      } catch {
        return [clip.id, []]
      }
    }),
  )
})
</script>

<template>
  <InstrumentLaneComponent
    class="drum-lane"
    :lane="lane"
    :selected-clip-id="selectedClipId"
    :pixels-per-beat="pixelsPerBeat"
    :scroll-left="scrollLeft"
    :display-mode="displayMode"
    :collapsed="collapsed"
    lane-label="Drum lane"
    timeline-label="Drum lane"
    editor-label="Drum lane source"
    :drum-samples="samples"
    @insert="emit('insert', $event)"
    @select="emit('select', $event)"
    @place-playhead="emit('place-playhead', $event)"
    @move="(clip, beat) => emit('move', clip, beat)"
    @delete="emit('delete', $event)"
    @update-source="emit('update-source', $event)"
    @update-name="emit('update-name', $event)"
    @update-gain="emit('update-gain', $event)"
    @delete-lane="emit('deleteLane')"
    @toggle-collapse="emit('toggle-collapse')"
  >
    <template #settings>
      <span class="drum-description">{{ samples.join(' · ') }} · drumkit SW Patch</span>
    </template>
    <template #preview="{ clip }">
      <span class="drum-preview" aria-label="Drum pattern preview">
        <span
          v-for="sample in samples"
          :key="sample"
          class="drum-row-label"
          :style="{ height: `${100 / samples.length}%` }"
          >{{ sample }}</span
        >
        <i
          v-for="(event, index) in eventsByClip[clip.id]"
          :key="`${event.sample}-${event.beat}-${index}`"
          :data-sample="event.sample"
          :data-beat="event.beat"
          :style="{
            left: `${(event.beat / beatToNumber(clip.length)) * 100}%`,
            width: `${Math.max(2, (event.duration / beatToNumber(clip.length)) * 100)}%`,
            height: `${60 / samples.length}%`,
            top: `${(samples.indexOf(event.sample ?? '') * 100 + 20) / samples.length}%`,
          }"
        />
      </span>
    </template>
  </InstrumentLaneComponent>
</template>

<style scoped>
.drum-description {
  flex: 1;
  color: var(--xenpaper-lavender);
}
.drum-preview {
  position: absolute;
  inset: 0;
}
.drum-row-label {
  position: relative;
  display: block;
  z-index: 2;
  padding-left: 0.25rem;
  text-align: left;
  color: white;
  font-weight: 700;
  text-shadow:
    -1px -1px 0 var(--xenpaper-purple),
    1px -1px 0 var(--xenpaper-purple),
    -1px 1px 0 var(--xenpaper-purple),
    1px 1px 0 var(--xenpaper-purple);
  border-bottom: 1px solid var(--xenpaper-purple);
  pointer-events: none;
}
.drum-preview i {
  position: absolute;
  z-index: 1;
  border-radius: 0.2rem;
  background: var(--xenpaper-lavender);
}
</style>
