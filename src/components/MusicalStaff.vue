<script setup lang="ts">
import { computed } from 'vue'
import type {
  BarlineStyle,
  StaffInflection,
  StaffNotationShape,
  StaffPitch,
} from '../../xenpaper-lang'
import type { Fraction } from 'xen-dev-utils/fraction'

const props = defineProps<{
  notation?: StaffNotationShape
}>()

type StaffItem =
  | { kind: 'note'; pitch: StaffPitch; duration: Fraction; soundingLabel?: string; tiedFromIndex?: number; tupletPosition?: number; tupletCount?: number }
  | { kind: 'rest'; duration: Fraction }
  | { kind: 'barline'; style: BarlineStyle }
  | { kind: 'annotation'; text: string }

const durationValue = (duration: Fraction) => Number(duration.n) / Number(duration.d)

const items = computed(() => {
  const result: StaffItem[] = []
  let activePitch: StaffPitch | undefined
  let activeNoteIndex: number | undefined
  const visit = (shape: StaffNotationShape, tupletPosition?: number, tupletCount?: number) => {
    if (shape.kind === 'note') {
      activePitch = shape.pitch
      activeNoteIndex = result.length
      result.push({ kind: 'note', pitch: shape.pitch, duration: shape.duration, soundingLabel: shape.soundingLabel, tupletPosition, tupletCount })
    } else if (shape.kind === 'continue' && activePitch) {
      result.push({ kind: 'note', pitch: activePitch, duration: shape.duration, tiedFromIndex: activeNoteIndex })
      activeNoteIndex = result.length - 1
    } else if (shape.kind === 'rest') {
      activePitch = undefined
      activeNoteIndex = undefined
      result.push({ kind: 'rest', duration: shape.duration })
    } else if (shape.kind === 'barline') {
      result.push({ kind: 'barline', style: shape.style })
    } else if (shape.kind === 'annotation') {
      result.push({ kind: 'annotation', text: shape.text })
    } else if (shape.kind === 'sequence') {
      shape.children.forEach((child, index) => visit(
        child,
        shape.tuplet ? index : undefined,
        shape.tuplet,
      ))
    }
    else if (shape.kind === 'parallel') shape.branches.forEach((branch) => visit(branch))
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

const flagCount = (duration?: Fraction, tupletCount?: number) => {
  if (!duration) return 0
  if (tupletCount) return Math.max(1, Math.ceil(Math.log2(tupletCount)) - 1)
  const value = durationValue(duration)
  if (value >= 1 || value <= 0) return 0
  const subdivision = Math.round(1 / value)
  const binarySubdivision = subdivision % 3 === 0 ? subdivision / 3 : subdivision
  const binaryFlags = Math.log2(binarySubdivision)
  return Number.isInteger(binaryFlags) ? binaryFlags + (subdivision % 3 === 0 ? 1 : 0) : 0
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
      <text v-else-if="item.kind === 'annotation'" class="annotation" :x="x(index)" y="25">
        {{ item.text }}
      </text>
      <g v-else-if="item.kind === 'barline'" class="barline" :class="`barline--${item.style}`">
        <line
          :x1="x(index) - (item.style === 'single' ? 0 : 3)"
          :x2="x(index) - (item.style === 'single' ? 0 : 3)"
          y1="52"
          y2="100"
        />
        <line
          v-if="item.style !== 'single'"
          :x1="x(index) + 3"
          :x2="x(index) + 3"
          y1="52"
          y2="100"
        />
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
          v-if="
            (item.pitch.inflections?.length || item.pitch.accidentals.length) &&
            item.tiedFromIndex === undefined
          "
          class="pitch-decorations"
          :x="x(index) - 11"
          :y="y(item.pitch.staffPosition) + 5"
        >
          <tspan
            v-for="(value, inflectionIndex) in item.pitch.inflections"
            :key="`inflection-${inflectionIndex}`"
            class="inflection"
          >
            {{ inflection(value) }}
          </tspan>
          <tspan v-if="item.pitch.accidentals.length" class="accidental">
            {{ item.pitch.accidentals.map(accidental).join('') }}
          </tspan>
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
        <path
          v-for="flag in flagCount(item.duration, item.tupletCount)"
          :key="`flag-${flag}`"
          class="flag"
          :d="`M ${x(index) + 6} ${y(item.pitch.staffPosition) - 30 + (flag - 1) * 7} Q ${x(index) + 20} ${y(item.pitch.staffPosition) - 23 + (flag - 1) * 7} ${x(index) + 12} ${y(item.pitch.staffPosition) - 13 + (flag - 1) * 7}`"
        />
        <text
          v-if="item.tupletPosition === Math.floor((item.tupletCount ?? 0) / 2)"
          class="tuplet-number"
          :x="x(index)"
          y="31"
        >{{ item.tupletCount }}</text>
        <path
          v-if="item.tupletPosition === Math.floor((item.tupletCount ?? 0) / 2)"
          class="tuplet-bracket"
          :d="`M ${x(index - item.tupletPosition!) - 10} 40 V 34 H ${x(index) - 10} M ${x(index) + 10} 34 H ${x(index - item.tupletPosition! + item.tupletCount! - 1) + 10} V 40`"
        />
        <text
          v-if="item.pitch.notehead === 'x' && item.soundingLabel"
          class="sounding-label"
          :x="x(index)"
          y="130"
        >
          {{ item.soundingLabel }}
        </text>
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

.flag {
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
}

.tuplet-bracket {
  fill: none;
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

.tuplet-number {
  font-size: 12px;
  font-weight: 600;
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
