<script setup lang="ts">
import { computed, toRaw } from 'vue'
import type { BeatTimedScore } from '../../xenpaper-lang'

const props = defineProps<{ score?: BeatTimedScore }>()
const notes = computed(() => props.score?.events.filter((event) => event.kind === 'note') ?? [])
// Value deliberately contains frozen exact-form internals. Calling its methods through a
// deep Vue proxy violates the Proxy invariants for those non-configurable properties.
const numericValue = (value: { valueOf(): number }) => toRaw(value).valueOf()
const beat = numericValue
const cents = (note: (typeof notes.value)[number]) => numericValue(note.pitch.value)
const duration = computed(() => (props.score ? beat(props.score.duration) : 0))
const low = computed(() => Math.floor((Math.min(0, ...notes.value.map(cents)) - 100) / 100) * 100)
const high = computed(
  () => Math.ceil((Math.max(1200, ...notes.value.map(cents)) + 100) / 100) * 100,
)
const width = computed(() => Math.max(640, 90 + duration.value * 100))
const height = 300
const x = (value: { valueOf(): number }) => 70 + beat(value) * 100
const y = (value: number) => 15 + ((high.value - value) / (high.value - low.value)) * (height - 40)
const rows = computed(() => {
  const result: number[] = []
  for (let value = low.value; value <= high.value; value += 100) result.push(value)
  return result
})
const beatLines = computed(() =>
  Array.from({ length: Math.ceil(duration.value) + 1 }, (_, beat) => beat),
)
</script>

<template>
  <section class="piano-roll" aria-label="Piano roll visualiser">
    <h2>Piano roll</h2>
    <div class="scroll">
      <svg
        :viewBox="`0 0 ${width} ${height}`"
        :style="{ minWidth: `${width}px` }"
        role="img"
        aria-label="Beat-timed piano roll"
      >
        <g v-for="row in rows" :key="row">
          <line class="pitch-line" x1="70" :x2="width" :y1="y(row)" :y2="y(row)" />
          <text x="6" :y="y(row) + 4">{{ row }}¢</text>
        </g>
        <template v-if="score">
          <line
            v-for="lineBeat in beatLines"
            :key="lineBeat"
            class="beat-line"
            :x1="70 + lineBeat * 100"
            :x2="70 + lineBeat * 100"
            y1="10"
            :y2="height - 20"
          />
        </template>
        <rect
          v-for="(note, index) in notes"
          :key="index"
          class="note"
          :x="x(note.start)"
          :y="y(cents(note)) - 5"
          :width="Math.max(2, beat(note.duration) * 100)"
          height="10"
        >
          <title>
            {{ note.label ?? `${cents(note).toFixed(2)}¢` }} — beat {{ beat(note.start) }}
          </title>
        </rect>
        <text v-if="!notes.length" class="empty" x="90" y="150">No notes loaded</text>
      </svg>
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
svg {
  display: block;
  height: 300px;
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
text {
  fill: #555;
  font: 11px sans-serif;
}
.empty {
  font-size: 14px;
}
</style>
