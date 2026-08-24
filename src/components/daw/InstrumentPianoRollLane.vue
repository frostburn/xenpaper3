<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseClipNotes } from '../../daw/audio-engine'
import {
  beatToNumber,
  pointerXToBeat,
  type InstrumentLane,
  type SourceClip,
} from '../../daw/project'

const props = defineProps<{
  lane: InstrumentLane
  selectedClipId?: string
  pixelsPerBeat: number
  scrollLeft: number
  displayMode: 'source' | 'piano-roll'
}>()
const emit = defineEmits<{
  insert: [beat: number]
  select: [clip: SourceClip]
  'place-playhead': [beat: number]
  move: [clip: SourceClip, beat: number]
}>()

const dragging = ref<{ clip: SourceClip; pointerOffset: number }>()
const laneElement = ref<HTMLElement>()

const pianoRolls = computed(() =>
  Object.fromEntries(
    props.lane.clips.map((clip) => {
      const clipDuration = beatToNumber(clip.length)
      try {
        const notes = parseClipNotes(clip.source, clipDuration)
        const pitches = notes.map(({ cents }) => cents)
        const lowest = Math.min(...pitches)
        const highest = Math.max(...pitches)
        const pitchSpan = highest - lowest
        return [
          clip.id,
          notes.map((note) => ({
            ...note,
            left: `${(note.beat / clipDuration) * 100}%`,
            width: `${(note.duration / clipDuration) * 100}%`,
            top: `${pitchSpan ? 8 + ((highest - note.cents) / pitchSpan) * 76 : 46}%`,
          })),
        ]
      } catch {
        // Invalid source is expected while the user is editing; show an empty preview.
        return [clip.id, []]
      }
    }),
  ),
)

const pointerBeat = (event: MouseEvent) =>
  pointerXToBeat(
    event.clientX - (laneElement.value?.getBoundingClientRect().left ?? 0),
    props.scrollLeft,
    props.pixelsPerBeat,
  )

const onClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.clip')) return
  emit('place-playhead', pointerBeat(event))
}

const onDoubleClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.clip')) return
  emit('insert', pointerBeat(event))
}

const startDrag = (event: PointerEvent, clip: SourceClip) => {
  emit('select', clip)
  dragging.value = { clip, pointerOffset: pointerBeat(event) - beatToNumber(clip.start) }
  const clipElement = event.currentTarget as HTMLElement
  clipElement.setPointerCapture?.(event.pointerId)
}

const moveDrag = (event: PointerEvent) => {
  if (!dragging.value) return
  emit('move', dragging.value.clip, Math.max(0, pointerBeat(event) - dragging.value.pointerOffset))
}
</script>

<template>
  <div
    ref="laneElement"
    class="lane"
    aria-label="Instrument piano roll"
    @click="onClick"
    :style="{
      '--beat-width': `${pixelsPerBeat}px`,
      '--grid-offset': `${-scrollLeft}px`,
    }"
    @dblclick="onDoubleClick"
    @pointermove="moveDrag"
    @pointerup="dragging = undefined"
    @pointercancel="dragging = undefined"
  >
    <button
      v-for="clip in lane.clips"
      :key="clip.id"
      type="button"
      class="clip"
      :class="{ selected: selectedClipId === clip.id }"
      :style="{
        left: `${beatToNumber(clip.start) * pixelsPerBeat - scrollLeft}px`,
        width: `${beatToNumber(clip.length) * pixelsPerBeat}px`,
      }"
      @click.stop="emit('select', clip)"
      @dblclick.stop
      @pointerdown.prevent="startDrag($event, clip)"
    >
      <pre v-if="displayMode === 'source'">{{ clip.source }}</pre>
      <span v-else class="piano-roll" aria-label="Piano roll preview">
        <i
          v-for="(note, index) in pianoRolls[clip.id]"
          :key="index"
          :data-beat="note.beat"
          :data-duration="note.duration"
          :data-cents="note.cents"
          :style="{ top: note.top, left: note.left, width: note.width }"
        />
      </span>
    </button>
    <span v-if="!lane.clips.length" class="hint">Double-click to create a clip</span>
  </div>
</template>

<style scoped>
.lane {
  position: relative;
  overflow: hidden;
  height: 9rem;
  cursor: crosshair;
  background-color: #151b27;
  background-image: linear-gradient(90deg, #30394a 1px, transparent 1px);
  background-position-x: var(--grid-offset);
  background-size: var(--beat-width) 100%;
  user-select: none;
  touch-action: none;
}
.clip {
  position: absolute;
  top: 1rem;
  height: 7rem;
  overflow: hidden;
  border: 2px solid #788aa8;
  background: #40577d;
  color: white;
  text-align: left;
  user-select: none;
}
.clip pre {
  height: 100%;
  margin: 0;
  overflow: hidden;
  white-space: pre-wrap;
  pointer-events: none;
}
.piano-roll {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, transparent 0 11%, #ffffff13 12% 13%);
  pointer-events: none;
}
.piano-roll i {
  position: absolute;
  height: 9%;
  min-width: 2px;
  border-radius: 2px;
  background: #9de3ff;
}
.clip.selected {
  border-color: #8ce6ff;
  background: #486d93;
}
.hint {
  position: absolute;
  inset: 3.5rem 0 auto;
  text-align: center;
  color: #9aa5b8;
  pointer-events: none;
}
</style>
