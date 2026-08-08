<script setup lang="ts">
import { computed } from 'vue'
import type { BarlineStyle, StaffInflection, StaffNotationShape, StaffPitch } from '../../xenpaper-lang'

const props = defineProps<{
  notation?: StaffNotationShape
}>()

type StaffItem =
  | { kind: 'note'; pitch: StaffPitch; soundingCents?: readonly number[]; tiedFromIndex?: number }
  | { kind: 'rest' }
  | { kind: 'barline'; style: BarlineStyle }
  | { kind: 'annotation'; text: string }

const items = computed(() => {
  const result: StaffItem[] = []
  let activePitch: StaffPitch | undefined
  let activeNoteIndex: number | undefined
  const visit = (shape: StaffNotationShape) => {
    if (shape.kind === 'note') {
      activePitch = shape.pitch
      activeNoteIndex = result.length
      result.push({ kind: 'note', pitch: shape.pitch, soundingCents: shape.soundingCents })
    } else if (shape.kind === 'continue' && activePitch) {
      result.push({ kind: 'note', pitch: activePitch, tiedFromIndex: activeNoteIndex })
      activeNoteIndex = result.length - 1
    } else if (shape.kind === 'rest') {
      activePitch = undefined
      activeNoteIndex = undefined
      result.push({ kind: 'rest' })
    } else if (shape.kind === 'barline') {
      result.push({ kind: 'barline', style: shape.style })
    } else if (shape.kind === 'annotation') {
      result.push({ kind: 'annotation', text: shape.text })
    } else if (shape.kind === 'sequence') shape.children.forEach(visit)
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

const inflection = (value: StaffInflection) => {
  if ('kind' in value) {
    return { up: '^', down: 'v', lift: '/', drop: '\\' }[value.kind]
  }
  return `${value.direction === 'denominator' ? '/' : ''}${value.prime}${value.flavor ?? ''}`
}

const ledgerPositions = (position: number) => {
  const positions: number[] = []
  for (let current = 0; current >= position; current -= 2) positions.push(current)
  for (let current = 12; current <= position; current += 2) positions.push(current)
  return positions
}

const soundingLabel = (values: readonly number[]) => values
  .map((value) => `${Number.isInteger(value) ? value : value.toFixed(2)}¢`)
  .join(' / ')
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
      <text v-else-if="item.kind === 'annotation'" class="annotation" :x="x(index)" y="25">{{ item.text }}</text>
      <g
        v-else-if="item.kind === 'barline'"
        class="barline"
        :class="`barline--${item.style}`"
      >
        <line :x1="x(index) - (item.style === 'single' ? 0 : 3)" :x2="x(index) - (item.style === 'single' ? 0 : 3)" y1="52" y2="100" />
        <line v-if="item.style !== 'single'" :x1="x(index) + 3" :x2="x(index) + 3" y1="52" y2="100" />
        <template v-if="item.style === 'repeat-start' || item.style === 'repeat-end'">
          <circle :cx="x(index) + (item.style === 'repeat-start' ? 10 : -10)" cy="70" r="2.5" />
          <circle :cx="x(index) + (item.style === 'repeat-start' ? 10 : -10)" cy="82" r="2.5" />
        </template>
      </g>
      <template v-else>
        <path
          v-if="item.tiedFromIndex !== undefined"
          class="tie"
          :d="`M ${x(item.tiedFromIndex) + 6} ${y(item.pitch.staffPosition) + 7} Q ${(x(item.tiedFromIndex) + x(index)) / 2} ${y(item.pitch.staffPosition) + 17} ${x(index) - 6} ${y(item.pitch.staffPosition) + 7}`"
        />
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
          v-if="(item.pitch.inflections?.length || item.pitch.accidentals.length) && item.tiedFromIndex === undefined"
          class="pitch-decorations"
          :x="x(index) - 11"
          :y="y(item.pitch.staffPosition) + 5"
        >
          <tspan
            v-for="(value, inflectionIndex) in item.pitch.inflections"
            :key="`inflection-${inflectionIndex}`"
            class="inflection"
          >{{ inflection(value) }}</tspan><tspan v-if="item.pitch.accidentals.length" class="accidental">{{ item.pitch.accidentals.map(accidental).join('') }}</tspan>
        </text>
        <polygon
          v-if="item.pitch.notehead === 'triangle-down'"
          class="notehead"
          :points="`${x(index) - 7},${y(item.pitch.staffPosition) - 5} ${x(index) + 7},${y(item.pitch.staffPosition) - 5} ${x(index)},${y(item.pitch.staffPosition) + 6}`"
        />
        <polygon
          v-else-if="item.pitch.notehead === 'triangle-up'"
          class="notehead"
          :points="`${x(index)},${y(item.pitch.staffPosition) - 6} ${x(index) + 7},${y(item.pitch.staffPosition) + 5} ${x(index) - 7},${y(item.pitch.staffPosition) + 5}`"
        />
        <g v-else-if="item.pitch.notehead === 'x'" class="notehead x-notehead">
          <line
            :x1="x(index) - 6"
            :x2="x(index) + 6"
            :y1="y(item.pitch.staffPosition) - 6"
            :y2="y(item.pitch.staffPosition) + 6"
          />
          <line
            :x1="x(index) - 6"
            :x2="x(index) + 6"
            :y1="y(item.pitch.staffPosition) + 6"
            :y2="y(item.pitch.staffPosition) - 6"
          />
        </g>
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
        <text
          v-if="item.pitch.notehead === 'x' && item.soundingCents?.length"
          class="sounding-label"
          :x="x(index)"
          y="130"
        >{{ soundingLabel(item.soundingCents) }}</text>
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
.stem,
.barline line,
.x-notehead line,
.tie {
  stroke: currentColor;
  stroke-width: 1.5;
}

.barline circle {
  fill: currentColor;
}

.tie {
  fill: none;
}

.clef {
  font-size: 52px;
}

.notehead {
  fill: currentColor;
}

.pitch-decorations,
.rest {
  font-size: 18px;
}

.annotation {
  font-size: 12px;
  text-anchor: middle;
}

.sounding-label {
  font-size: 11px;
  text-anchor: middle;
}

.pitch-decorations {
  text-anchor: end;
}

.empty-message {
  fill: currentColor;
  font-size: 12px;
}
</style>
