<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  compileSourceInitialization,
  drumSamplesForLane,
  parseDrumClipNotes,
} from '../../daw/score'
import {
  beatToNumber,
  pointerXToBeat,
  type ClipDisplayMode,
  type InstrumentLane,
  type SourceClip,
} from '../../daw/project'
import XenpaperSourceEditor from './XenpaperSourceEditor.vue'
import XenpaperSourceHighlight from './XenpaperSourceHighlight.vue'

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
const laneElement = ref<HTMLElement>()
const dragging = ref<{ clip: SourceClip; pointerOffset: number }>()
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
const pointerBeat = (event: MouseEvent) =>
  pointerXToBeat(
    event.clientX - (laneElement.value?.getBoundingClientRect().left ?? 0),
    props.scrollLeft,
    props.pixelsPerBeat,
  )
const startDrag = (event: PointerEvent, clip: SourceClip) => {
  emit('select', clip)
  dragging.value = { clip, pointerOffset: pointerBeat(event) - beatToNumber(clip.start) }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}
const moveDrag = (event: PointerEvent) => {
  if (dragging.value)
    emit(
      'move',
      dragging.value.clip,
      Math.max(0, pointerBeat(event) - dragging.value.pointerOffset),
    )
}
</script>

<template>
  <section class="drum-lane">
    <header :class="{ collapsed }">
      <input
        class="lane-name"
        aria-label="Drum lane name"
        :value="lane.name"
        @input="emit('update-name', ($event.target as HTMLInputElement).value)"
      />
      <button
        type="button"
        :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${lane.name}`"
        :aria-expanded="!collapsed"
        @click="emit('toggle-collapse')"
      >
        {{ collapsed ? '▸ Expand' : '▾ Collapse' }}
      </button>
      <button
        type="button"
        class="delete-lane"
        :aria-label="`Delete ${lane.name}`"
        @click="emit('deleteLane')"
      >
        Delete lane
      </button>
      <span v-if="!collapsed">{{ samples.join(' · ') }} · drumkit SW Patch</span>
      <label v-if="!collapsed">
        Gain
        <input
          aria-label="Drum gain"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="lane.gain"
          @input="emit('update-gain', Number(($event.target as HTMLInputElement).value))"
        />
        <output>{{ Math.round(lane.gain * 100) }}%</output>
      </label>
      <label v-if="!collapsed" class="source-control">
        Lane source
        <XenpaperSourceEditor
          editor-label="Drum lane source"
          :source="lane.source"
          :drum-samples="samples"
          :rows="3"
          @update:source="emit('update-source', $event)"
        />
      </label>
    </header>
    <div
      v-show="!collapsed"
      ref="laneElement"
      class="drum-grid"
      aria-label="Drum lane"
      :style="{ '--beat-width': `${pixelsPerBeat}px`, '--grid-offset': `${-scrollLeft}px` }"
      @click="emit('place-playhead', pointerBeat($event))"
      @dblclick="emit('insert', pointerBeat($event))"
      @pointermove="moveDrag"
      @pointerup="dragging = undefined"
      @pointercancel="dragging = undefined"
    >
      <button
        v-for="clip in lane.clips"
        :key="clip.id"
        type="button"
        class="clip drum-clip"
        :class="{ selected: selectedClipId === clip.id }"
        :style="{
          left: `${beatToNumber(clip.start) * pixelsPerBeat - scrollLeft}px`,
          width: `${beatToNumber(clip.length) * pixelsPerBeat}px`,
        }"
        @click.stop="emit('select', clip)"
        @dblclick.stop
        @pointerdown.prevent="startDrag($event, clip)"
      >
        <pre v-if="displayMode === 'source'"><XenpaperSourceHighlight
          :source="clip.source"
          :drum-samples="samples"
        /></pre>
        <span v-else class="drum-preview" aria-label="Drum pattern preview">
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
      </button>
    </div>
  </section>
</template>

<style scoped>
.drum-lane header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem;
  background: #3a2f43;
}
.drum-lane header.collapsed {
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
}
.drum-lane header.collapsed > :last-child {
  margin-left: auto;
}
.drum-lane header span {
  flex: 1;
  color: #cfbadb;
}
.lane-name {
  min-width: 6rem;
  width: 10rem;
  font: inherit;
  font-weight: bold;
}
.drum-lane header button {
  white-space: nowrap;
}
.delete-lane {
  color: #ffd8d8;
  border: 1px solid #a85d67;
  border-radius: 0.25rem;
  padding: 0.35rem 0.55rem;
  background: #4d2730;
  cursor: pointer;
}
.source-control {
  display: flex;
  flex: 1 0 100%;
  align-items: stretch;
  flex-direction: column;
  gap: 0.4rem;
}
.source-control .xenpaper-source-editor {
  min-width: 0;
  font-family: monospace;
}
.drum-grid {
  position: relative;
  height: 8rem;
  overflow: hidden;
  background: repeating-linear-gradient(
    90deg,
    #151b26 0 calc(var(--beat-width) - 1px),
    #39445a calc(var(--beat-width) - 1px) var(--beat-width)
  );
}
.drum-clip {
  position: absolute;
  top: 0.5rem;
  bottom: 0.5rem;
  overflow: hidden;
  border: 1px solid #b078cf;
  background: #39254a;
  color: white;
}
.drum-clip.selected {
  outline: 2px solid #f0bdff;
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
    -1px -1px 0 #281732,
    1px -1px 0 #281732,
    -1px 1px 0 #281732,
    1px 1px 0 #281732;
  border-bottom: 1px solid #654b74;
  pointer-events: none;
}
.drum-preview i {
  position: absolute;
  z-index: 1;
  border-radius: 0.2rem;
  background: #f0bdff;
}
.drum-clip pre {
  margin: 0;
  text-align: left;
}
</style>
