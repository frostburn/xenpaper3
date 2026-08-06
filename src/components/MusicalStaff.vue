<script setup lang="ts">
import { computed } from 'vue'
import type { StaffNotationShape, StaffPitch } from '../../xenpaper-lang'

const props = defineProps<{
  notation?: StaffNotationShape
}>()

type StaffItem = { kind: 'note'; pitch: StaffPitch } | { kind: 'rest' }

const items = computed(() => {
  const result: StaffItem[] = []
  const visit = (shape: StaffNotationShape) => {
    if (shape.kind === 'note') result.push({ kind: 'note', pitch: shape.pitch })
    else if (shape.kind === 'rest') result.push({ kind: 'rest' })
    else if (shape.kind === 'sequence') shape.children.forEach(visit)
    else if (shape.kind === 'parallel') shape.branches.forEach(visit)
  }
  if (props.notation) visit(props.notation)
  return result
})

const width = computed(() => Math.max(360, 80 + items.value.length * 52))
const x = (index: number) => 60 + index * 52
const y = (position: number) => 100 - (position - 2) * 6
const accidental = (value: string) =>
  ({
    flat: '♭',
    sharp: '♯',
    natural: '♮',
    'double-flat': '𝄫',
    'double-sharp': '𝄪',
    'half-flat': '𝄳',
    'half-sharp': '𝄲',
  })[value] ?? value

const ledgerPositions = (position: number) => {
  const positions: number[] = []
  for (let current = 0; current >= position; current -= 2) positions.push(current)
  for (let current = 12; current <= position; current += 2) positions.push(current)
  return positions
}
</script>

<template>
  <svg class="musical-staff" :viewBox="`0 0 ${width} 150`" role="img" aria-label="Musical staff">
    <g class="staff-lines">
      <line
        v-for="line in 5"
        :key="line"
        x1="20"
        :x2="width - 20"
        :y1="100 - (line - 1) * 12"
        :y2="100 - (line - 1) * 12"
      />
    </g>
    <text class="clef" x="25" y="98">𝄞</text>
    <text v-if="!items.length" class="empty-message" x="70" y="126">No notation loaded</text>
    <g v-for="(item, index) in items" :key="index">
      <text v-if="item.kind === 'rest'" class="rest" :x="x(index)" y="79">𝄽</text>
      <template v-else>
        <line
          v-for="position in ledgerPositions(item.pitch.staffPosition)"
          :key="position"
          class="ledger-line"
          :x1="x(index) - 12"
          :x2="x(index) + 12"
          :y1="y(position)"
          :y2="y(position)"
        />
        <text
          v-if="item.pitch.accidentals.length"
          class="accidental"
          :x="x(index) - 17"
          :y="y(item.pitch.staffPosition) + 5"
        >
          {{ item.pitch.accidentals.map(accidental).join('') }}
        </text>
        <polygon
          v-if="item.pitch.notehead === 'triangle-down'"
          class="notehead"
          :points="`${x(index) - 7},${y(item.pitch.staffPosition) - 5} ${x(index) + 7},${y(item.pitch.staffPosition) - 5} ${x(index)},${y(item.pitch.staffPosition) + 6}`"
        />
        <ellipse
          v-else
          class="notehead"
          :cx="x(index)"
          :cy="y(item.pitch.staffPosition)"
          rx="7"
          ry="5"
        />
        <line
          class="stem"
          :x1="x(index) + 6"
          :x2="x(index) + 6"
          :y1="y(item.pitch.staffPosition)"
          :y2="y(item.pitch.staffPosition) - 30"
        />
      </template>
    </g>
  </svg>
</template>

<style scoped>
.musical-staff {
  display: block;
  width: 100%;
  max-width: 100%;
  min-height: 150px;
}

.staff-lines line,
.ledger-line,
.stem {
  stroke: currentColor;
  stroke-width: 1.5;
}

.clef {
  font-size: 52px;
}

.notehead {
  fill: currentColor;
}

.accidental,
.rest {
  font-size: 18px;
  text-anchor: middle;
}

.empty-message {
  fill: currentColor;
  font-size: 12px;
}
</style>
