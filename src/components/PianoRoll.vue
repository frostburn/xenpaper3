<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue'
import type { Fraction } from 'xen-dev-utils/fraction'
import type { BeatTimedScore } from '../../xenpaper-lang'

const props = defineProps<{ score?: BeatTimedScore }>()
export interface PianoRollElementInfo {
  index: number
  label: string
  kind: 'note'
  pitchKind: string
  cents: number
  start: string
  duration: string
  end: string
  dynamic: string
  glissando?: {
    curve: string
    fromCents: number
    toCents: number
    duration: string
  }
}

export interface PianoRollInspection {
  inspected?: PianoRollElementInfo
  selected: PianoRollElementInfo[]
}

const emit = defineEmits<{ inspectionChange: [inspection: PianoRollInspection] }>()
const hovered = ref<number>()
const selected = ref<number[]>([])
const selectionStart = ref<{ x: number; y: number }>()
const selectionEnd = ref<{ x: number; y: number }>()
const notes = computed(() => props.score?.events.filter((event) => event.kind === 'note') ?? [])
// Values deliberately contain frozen exact-form internals. Calling methods through a deep
// Vue proxy violates the Proxy invariants for those non-configurable properties.
const raw = <T>(value: T) => toRaw(value)
const beat = (value: { valueOf(): number }) => raw(value).valueOf()
const cents = (note: (typeof notes.value)[number]) => beat(note.pitch.value)
const duration = computed(() => (props.score ? beat(props.score.duration) : 0))
const low = computed(() => Math.floor((Math.min(0, ...notes.value.map(cents)) - 100) / 100) * 100)
const high = computed(
  () => Math.ceil((Math.max(1200, ...notes.value.map(cents)) + 100) / 100) * 100,
)
const rulerWidth = 70
const rulerGuideStart = -1000
const rightPadding = 50
const gridBottom = 275
const width = computed(() => Math.max(640, rulerWidth + duration.value * 100 + rightPadding))
const height = 320
const x = (value: { valueOf(): number }) => rulerWidth + beat(value) * 100
const y = (value: number) => 15 + ((high.value - value) / (high.value - low.value)) * 255
const rows = computed(() => {
  const result: number[] = []
  for (let value = low.value; value <= high.value; value += 100) result.push(value)
  return result
})
const beatLines = computed(() =>
  Array.from({ length: Math.ceil(duration.value) + 1 }, (_, beat) => beat),
)
const inspectedNote = computed(() =>
  hovered.value === undefined ? undefined : notes.value[hovered.value],
)
const noteEnd = (note: (typeof notes.value)[number]) => raw(note.start).add(raw(note.duration))
const tooltip = (note: (typeof notes.value)[number]) =>
  note.label ?? note.pitch.spelling?.raw ?? `${cents(note).toFixed(2)}¢`
const formatBeat = (value: Fraction) => {
  const fraction = raw(value)
  const whole = Math.floor(fraction.n / fraction.d)
  const remainder = fraction.n % fraction.d
  const sign = fraction.s < 0 ? '−' : ''
  if (!remainder) return `${sign}${whole}`
  return whole ? `${sign}${whole} ${remainder}/${fraction.d}` : `${sign}${remainder}/${fraction.d}`
}
const formatDynamic = (value: Fraction) => {
  const dynamic = raw(value)
  return `${formatBeat(dynamic)} (${(dynamic.valueOf() * 100).toFixed(2)}%)`
}
const pitchCents = (pitch: (typeof notes.value)[number]['pitch']) => beat(pitch.value)
const elementInfo = (note: (typeof notes.value)[number], index: number): PianoRollElementInfo => ({
  index,
  label: tooltip(note),
  kind: 'note',
  pitchKind: note.pitch.kind,
  cents: cents(note),
  start: formatBeat(note.start),
  duration: formatBeat(note.duration),
  end: formatBeat(noteEnd(note)),
  dynamic: formatDynamic(note.dynamic),
  ...(note.automation
    ? {
        glissando: {
          curve: note.automation.curve,
          fromCents: pitchCents(note.automation.from),
          toCents: pitchCents(note.automation.to),
          duration: formatBeat(note.automation.duration),
        },
      }
    : {}),
})
const inspection = computed<PianoRollInspection>(() => ({
  inspected:
    hovered.value === undefined
      ? undefined
      : elementInfo(notes.value[hovered.value]!, hovered.value),
  selected: selected.value.map((index) => elementInfo(notes.value[index]!, index)),
}))
watch(inspection, (value) => emit('inspectionChange', value), { immediate: true })
watch(notes, () => {
  selected.value = []
  hovered.value = undefined
})

const svgPoint = (event: MouseEvent) => {
  const svg = event.currentTarget as SVGSVGElement
  const screenMatrix = svg.getScreenCTM?.()
  if (screenMatrix && svg.createSVGPoint) {
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const transformed = point.matrixTransform(screenMatrix.inverse())
    return { x: transformed.x, y: transformed.y }
  }

  // getScreenCTM is unavailable in non-rendering DOM implementations such as jsdom.
  const bounds = svg.getBoundingClientRect()
  return {
    x: ((event.clientX - bounds.left) / (bounds.width || width.value)) * width.value,
    y: ((event.clientY - bounds.top) / (bounds.height || height)) * height,
  }
}
const startSelection = (event: MouseEvent) => {
  if ((event.target as Element).closest('.note')) return
  selectionStart.value = svgPoint(event)
  selectionEnd.value = selectionStart.value
}
const moveSelection = (event: MouseEvent) => {
  if (selectionStart.value) selectionEnd.value = svgPoint(event)
}
const selectNote = (index: number) => {
  selected.value = [index]
}
const finishSelection = (event: MouseEvent) => {
  if (!selectionStart.value) return
  selectionEnd.value = svgPoint(event)
  const left = Math.min(selectionStart.value.x, selectionEnd.value.x)
  const right = Math.max(selectionStart.value.x, selectionEnd.value.x)
  const top = Math.min(selectionStart.value.y, selectionEnd.value.y)
  const bottom = Math.max(selectionStart.value.y, selectionEnd.value.y)
  selected.value = notes.value.flatMap((note, index) => {
    const noteLeft = x(note.start)
    const noteRight = noteLeft + Math.max(2, beat(note.duration) * 100)
    const noteTop = y(cents(note)) - 5
    const noteBottom = noteTop + 10
    return noteRight >= left && noteLeft <= right && noteBottom >= top && noteTop <= bottom
      ? [index]
      : []
  })
  selectionStart.value = undefined
  selectionEnd.value = undefined
}
const selectionBox = computed(() => {
  if (!selectionStart.value || !selectionEnd.value) return undefined
  return {
    x: Math.min(selectionStart.value.x, selectionEnd.value.x),
    y: Math.min(selectionStart.value.y, selectionEnd.value.y),
    width: Math.abs(selectionStart.value.x - selectionEnd.value.x),
    height: Math.abs(selectionStart.value.y - selectionEnd.value.y),
  }
})
</script>

<template>
  <section class="piano-roll" aria-label="Piano roll visualiser">
    <h2>Piano roll</h2>
    <div class="scroll">
      <div class="canvas" :style="{ width: `${width}px` }">
        <svg
          class="grid"
          :viewBox="`0 0 ${width} ${height}`"
          role="img"
          aria-label="Beat-timed piano roll"
          @mousedown="startSelection"
          @mousemove="moveSelection"
          @mouseup="finishSelection"
          @mouseleave="selectionStart = undefined"
        >
          <line
            v-for="row in rows"
            :key="row"
            class="pitch-line"
            :x1="rulerWidth"
            :x2="width"
            :y1="y(row)"
            :y2="y(row)"
          />
          <template v-if="score">
            <line
              v-for="lineBeat in beatLines"
              :key="lineBeat"
              class="beat-line"
              :x1="rulerWidth + lineBeat * 100"
              :x2="rulerWidth + lineBeat * 100"
              y1="10"
              :y2="gridBottom"
            />
          </template>
          <template v-if="inspectedNote">
            <line
              class="inspection-line"
              :x1="rulerGuideStart"
              :x2="x(inspectedNote.start)"
              :y1="y(cents(inspectedNote))"
              :y2="y(cents(inspectedNote))"
            />
            <g
              v-for="boundary in [inspectedNote.start, noteEnd(inspectedNote)]"
              :key="formatBeat(boundary)"
            >
              <line
                class="boundary-line"
                :x1="x(boundary)"
                :x2="x(boundary)"
                :y1="y(cents(inspectedNote))"
                y2="292"
              />
              <text class="beat-label" :x="x(boundary)" y="307">{{ formatBeat(boundary) }}</text>
            </g>
          </template>
          <rect
            v-for="(note, index) in notes"
            :key="index"
            class="note"
            :class="{ inspected: hovered === index, selected: selected.includes(index) }"
            :x="x(note.start)"
            :y="y(cents(note)) - 5"
            :width="Math.max(2, beat(note.duration) * 100)"
            height="10"
            @mouseenter="hovered = index"
            @mouseleave="hovered = undefined"
            @click="selectNote(index)"
          >
            <title>{{ tooltip(note) }}</title>
          </rect>
          <rect
            v-if="selectionBox"
            class="selection-box"
            v-bind="selectionBox"
            aria-hidden="true"
          />
          <text v-if="!notes.length" class="empty" x="90" y="150">No notes loaded</text>
        </svg>
        <svg class="ruler" :viewBox="`0 0 ${rulerWidth} ${height}`" aria-hidden="true">
          <rect class="ruler-background" :width="rulerWidth" :height="gridBottom" />
          <g v-for="row in rows" :key="row">
            <text x="6" :y="y(row) + 4">{{ row }}¢</text>
          </g>
          <g v-if="inspectedNote" class="cents-label">
            <rect x="4" :y="y(cents(inspectedNote)) - 9" width="62" height="18" rx="3" />
            <text x="35" :y="y(cents(inspectedNote)) + 4">
              {{ cents(inspectedNote).toFixed(2) }}¢
            </text>
          </g>
        </svg>
      </div>
    </div>
  </section>
</template>

<style scoped>
.piano-roll {
  width: 100%;
  margin-top: 1rem;
}
.scroll {
  overflow-x: auto;
  border: 1px solid #aaa;
  border-radius: 0.35rem;
  background: #fafafa;
}
.canvas {
  position: relative;
  min-width: 100%;
  height: 320px;
}
svg {
  display: block;
  height: 320px;
}
.grid {
  width: 100%;
}
.ruler {
  position: sticky;
  z-index: 2;
  bottom: 0;
  left: 0;
  width: 70px;
  margin-top: -320px;
  pointer-events: none;
  overflow: visible;
}
.ruler-background {
  fill: #fafafa;
  stroke: #aaa;
  stroke-width: 1;
}
.pitch-line {
  stroke: #ddd;
  stroke-width: 1;
}
.beat-line {
  stroke: #bbb;
  stroke-dasharray: 3 3;
}
.note {
  fill: #6750a4;
  stroke: #342366;
  rx: 2px;
}
.note.inspected {
  fill: #8068bd;
}
.note.selected {
  fill: #b33c68;
  stroke-width: 2;
}
.selection-box {
  fill: rgb(179 60 104 / 15%);
  stroke: #b33c68;
  stroke-width: 1.5;
  stroke-dasharray: 5 3;
  pointer-events: none;
}
.inspection-line,
.boundary-line {
  stroke: #b33c68;
  stroke-width: 1.5;
}
.boundary-line {
  stroke-dasharray: 4 2;
}
text {
  fill: #555;
  font: 11px sans-serif;
}
.beat-label {
  text-anchor: middle;
  font-weight: 600;
}
.cents-label rect {
  fill: #fff;
  stroke: #b33c68;
  stroke-width: 1.5;
}
.cents-label line {
  stroke: #b33c68;
  stroke-width: 1.5;
}
.cents-label text {
  fill: #762344;
  font-weight: 700;
  text-anchor: middle;
}
.empty {
  font-size: 14px;
}
</style>
