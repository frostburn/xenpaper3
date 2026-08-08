<script setup lang="ts">
import { computed } from 'vue'
import type { BeatTimedScore } from '../../xenpaper-lang'

const props = defineProps<{ score?: BeatTimedScore }>()
const notes = computed(() => props.score?.events.filter((event) => event.kind === 'note') ?? [])
const beat = (value: { valueOf(): number }) => value.valueOf()
const cents = (note: (typeof notes.value)[number]) => note.pitch.value.valueOf()
const low = computed(() => Math.floor((Math.min(0, ...notes.value.map(cents)) - 100) / 100) * 100)
const high = computed(() => Math.ceil((Math.max(1200, ...notes.value.map(cents)) + 100) / 100) * 100)
const width = computed(() => Math.max(640, 90 + beat(props.score?.duration ?? { valueOf: () => 0 }) * 100))
const height = 300
const x = (value: { valueOf(): number }) => 70 + beat(value) * 100
const y = (value: number) => 15 + ((high.value - value) / (high.value - low.value)) * (height - 40)
const rows = computed(() => {
  const result: number[] = []
  for (let value = low.value; value <= high.value; value += 100) result.push(value)
  return result
})
</script>

<template>
  <section class="piano-roll" aria-label="Piano roll visualiser">
    <h2>Piano roll</h2>
    <div class="scroll">
      <svg :viewBox="`0 0 ${width} ${height}`" :style="{ minWidth: `${width}px` }" role="img" aria-label="Beat-timed piano roll">
        <g v-for="row in rows" :key="row">
          <line class="pitch-line" x1="70" :x2="width" :y1="y(row)" :y2="y(row)" />
          <text x="6" :y="y(row) + 4">{{ row }}¢</text>
        </g>
        <template v-if="score">
          <line v-for="bar in Math.ceil(beat(score.duration)) + 1" :key="bar" class="beat-line" :x1="x({ valueOf: () => bar - 1 })" :x2="x({ valueOf: () => bar - 1 })" y1="10" :y2="height - 20" />
        </template>
        <rect v-for="(note, index) in notes" :key="index" class="note" :x="x(note.start)" :y="y(cents(note)) - 5" :width="Math.max(2, beat(note.duration) * 100)" height="10">
          <title>{{ note.label ?? `${cents(note).toFixed(2)}¢` }} — beat {{ beat(note.start) }}</title>
        </rect>
        <text v-if="!notes.length" class="empty" x="90" y="150">No notes loaded</text>
      </svg>
    </div>
  </section>
</template>

<style scoped>
.piano-roll { width: 100%; margin-top: 1rem; }
.scroll { overflow-x: auto; border: 1px solid #aaa; border-radius: 0.35rem; background: #fafafa; }
svg { display: block; height: 300px; }
.pitch-line { stroke: #ddd; stroke-width: 1; }
.beat-line { stroke: #bbb; stroke-dasharray: 3 3; }
.note { fill: #6750a4; stroke: #342366; rx: 2px; }
text { fill: #555; font: 11px sans-serif; }
.empty { font-size: 14px; }
</style>
