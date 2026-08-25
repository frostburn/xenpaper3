<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseClipNotes } from '../../daw/score'
import {
  beatToNumber,
  pointerXToBeat,
  type ClipDisplayMode,
  type InstrumentLane,
  type SourceClip,
} from '../../daw/project'

const props = defineProps<{
  lane: InstrumentLane
  selectedClipId?: string
  pixelsPerBeat: number
  scrollLeft: number
  displayMode: ClipDisplayMode
}>()
const emit = defineEmits<{
  insert: [beat: number]
  select: [clip: SourceClip]
  'place-playhead': [beat: number]
  move: [clip: SourceClip, beat: number]
  delete: [clip: SourceClip]
}>()

const dragging = ref<{ clip: SourceClip; pointerOffset: number }>()
const laneElement = ref<HTMLElement>()

const pianoRoll = computed(() => {
  const parsedClips = props.lane.clips.map((clip) => {
    try {
      return {
        clip,
        notes: parseClipNotes(clip.source, beatToNumber(clip.length)),
      }
    } catch {
      // Invalid source is expected while the user is editing; show an empty preview.
      return { clip, notes: [] }
    }
  })
  const clipCenters = parsedClips
    .filter(({ notes }) => notes.length)
    .map(({ notes }) => {
      const pitches = notes.map(({ cents }) => cents)
      return (Math.min(...pitches) + Math.max(...pitches)) / 2
    })
    .sort((left, right) => left - right)
  const middle = Math.floor(clipCenters.length / 2)
  const laneCenter = clipCenters.length
    ? clipCenters.length % 2
      ? clipCenters[middle]!
      : (clipCenters[middle - 1]! + clipCenters[middle]!) / 2
    : 0
  const displayClips = parsedClips.map(({ clip, notes }) => {
    if (!notes.length) return { clip, notes, registerOffset: 0 }
    const pitches = notes.map(({ cents }) => cents)
    const clipCenter = (Math.min(...pitches) + Math.max(...pitches)) / 2
    const distance = clipCenter - laneCenter
    // Fold disparate registers into the representative lane range by whole octaves.
    // The authored register remains explicit in the label rendered on that clip.
    const registerOffset = Math.abs(distance) >= 1200 ? Math.round(distance / 1200) * 1200 : 0
    return { clip, notes, registerOffset }
  })
  const pitches = displayClips.flatMap(({ notes, registerOffset }) =>
    notes.map(({ cents }) => cents - registerOffset),
  )
  // Keep zero visible as the pitch reference and guarantee enough room around tightly
  // clustered material. Outlying clips still expand this single lane-wide scale.
  const lowestPitch = Math.min(0, ...pitches)
  const highestPitch = Math.max(0, ...pitches)
  const minimumSpan = 2400
  const contentSpan = highestPitch - lowestPitch
  const padding = Math.max(100, contentSpan * 0.06)
  const missingSpan = Math.max(0, minimumSpan - contentSpan)
  const lowerBound = lowestPitch - padding - missingSpan / 2
  const upperBound = highestPitch + padding + missingSpan / 2
  const pitchSpan = upperBound - lowerBound
  const pitchTop = (cents: number) => `${((upperBound - cents) / pitchSpan) * 100}%`

  const firstOctave = Math.ceil(lowerBound / 1200)
  const lastOctave = Math.floor(upperBound / 1200)
  const displayGuides = Array.from(
    { length: lastOctave - firstOctave + 1 },
    (_, index) => (firstOctave + index) * 1200,
  )

  return {
    notesByClip: Object.fromEntries(
      displayClips.map(({ clip, notes, registerOffset }) => {
        const clipDuration = beatToNumber(clip.length)
        return [
          clip.id,
          {
            registerOffset,
            guides: displayGuides.map((displayCents) => ({
              cents: displayCents + registerOffset,
              top: pitchTop(displayCents),
            })),
            notes: notes.map((note) => ({
              ...note,
              left: `${(note.beat / clipDuration) * 100}%`,
              width: `${(note.duration / clipDuration) * 100}%`,
              top: pitchTop(note.cents - registerOffset),
            })),
          },
        ]
      }),
    ),
  }
})

const clipPreview = (clipId: string) => pianoRoll.value.notesByClip[clipId]!

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
  // Preventing the pointer event keeps dragging smooth, but also suppresses the
  // button's native focus behavior. Restore it so keyboard actions target the clip.
  clipElement.focus({ preventScroll: true })
  clipElement.setPointerCapture?.(event.pointerId)
}

const moveDrag = (event: PointerEvent) => {
  if (!dragging.value) return
  emit('move', dragging.value.clip, Math.max(0, pointerBeat(event) - dragging.value.pointerOffset))
}

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key !== 'Delete' || !props.selectedClipId) return
  const clip = props.lane.clips.find(({ id }) => id === props.selectedClipId)
  if (!clip) return
  event.preventDefault()
  emit('delete', clip)
}
</script>

<template>
  <div
    ref="laneElement"
    class="lane"
    aria-label="Instrument piano roll"
    tabindex="0"
    @click="onClick"
    :style="{
      '--beat-width': `${pixelsPerBeat}px`,
      '--grid-offset': `${-scrollLeft}px`,
    }"
    @dblclick="onDoubleClick"
    @pointermove="moveDrag"
    @pointerup="dragging = undefined"
    @pointercancel="dragging = undefined"
    @keydown="onKeyDown"
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
        <span v-if="clipPreview(clip.id).registerOffset" class="register-label"
          >{{ clipPreview(clip.id).registerOffset > 0 ? '+' : ''
          }}{{ clipPreview(clip.id).registerOffset }}¢</span
        >
        <span
          v-for="guide in clipPreview(clip.id).guides"
          :key="guide.cents"
          class="pitch-guide"
          :class="{ 'global-reference': guide.cents === 0 }"
          :data-cents="guide.cents"
          :style="{ top: guide.top }"
        />
        <i
          v-for="(note, index) in clipPreview(clip.id).notes"
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
.pitch-guide {
  position: absolute;
  right: 0;
  left: 0;
  border-top: 1px dashed #ff6666aa;
}
.pitch-guide.global-reference {
  z-index: 1;
  border-top: 3px solid #ff3535;
}
.register-label {
  position: absolute;
  z-index: 2;
  top: 0.2rem;
  right: 0.25rem;
  padding: 0.08rem 0.25rem;
  border-radius: 2px;
  background: #1b2638dd;
  color: #ffaaaa;
  font: 0.65rem/1.2 monospace;
}
.piano-roll i {
  position: absolute;
  z-index: 2;
  transform: translateY(-50%);
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
