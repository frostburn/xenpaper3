<script setup lang="ts">
import { computed } from 'vue'
import type {
  BarlineStyle,
  DynamicMark,
  StaffInflection,
  StaffNotationShape,
  StaffPitch,
} from '../../xenpaper-lang'
import { Fraction } from 'xen-dev-utils/fraction'

const props = defineProps<{
  notation?: StaffNotationShape
}>()

type TupletSpan = {
  id: number
  count: number
  level: number
  startColumn: number
  endColumn: number
}

type StaffItemContent =
  | {
      kind: 'note'
      pitch: StaffPitch
      duration: Fraction
      displayLabel?: string
      grace?: boolean
      notatedDuration?: Fraction
    }
  | { kind: 'rest'; duration: Fraction }
  | { kind: 'barline'; style: BarlineStyle }
  | { kind: 'annotation'; text: string }
  | { kind: 'dynamic'; mark: DynamicMark }

type StaffItem = StaffItemContent & {
  column: number
  voice: number
  tuplets: TupletSpan[]
  tiedFromColumn?: number
  tiedToColumn?: number
  tiedToPosition?: number
  displayLabelRow?: number
}

type LayoutItem = StaffItemContent & {
  tuplets: LayoutTuplet[]
  offset: Fraction
  voice: number
  tiedFromOffset?: Fraction
}

type LayoutTuplet = {
  id: number
  count: number
  level: number
  startOffset: Fraction
  endOffset: Fraction
}

type NoteLayoutItem = Extract<LayoutItem, { kind: 'note' }>
type RhythmicLayoutItem = Extract<LayoutItem, { kind: 'note' | 'rest' }>

const durationValue = (duration: Fraction) => Number(duration.n) / Number(duration.d)
const fraction = (duration: Fraction) => new Fraction(duration.n, duration.d)

const items = computed(() => {
  const layout: LayoutItem[] = []
  let nextTupletId = 0
  let nextVoiceId = 1
  type VisitState = {
    activeItems: RhythmicLayoutItem[]
    activeNotes: NoteLayoutItem[]
    activeSpan?: Fraction
    barlineSinceActiveItems?: boolean
    hasFollowingContinuation?: boolean
  }
  const visit = (
    shape: StaffNotationShape,
    offset: Fraction,
    state: VisitState,
    voice: number,
  ): Fraction => {
    if (shape.kind === 'note') {
      const note: NoteLayoutItem = {
        kind: 'note',
        offset,
        pitch: shape.pitch,
        duration: shape.duration,
        displayLabel: shape.displayLabel,
        grace: shape.grace,
        notatedDuration: shape.notatedDuration,
        tuplets: [],
        voice,
      }
      layout.push(note)
      state.activeItems = [note]
      state.activeNotes = [note]
      state.activeSpan = shape.duration
      state.barlineSinceActiveItems = false
    } else if (shape.kind === 'continue' && state.activeItems.length && state.activeSpan) {
      const continuedDuration = fraction(shape.duration)
      const activeSpan = fraction(state.activeSpan)
      const factor = continuedDuration.div(activeSpan)
      if (state.barlineSinceActiveItems) {
        const activeStartOffset = state.activeItems.reduce(
          (earliest, item) => (item.offset.compare(earliest) < 0 ? item.offset : earliest),
          state.activeItems[0]!.offset,
        )
        const continuedItems = state.activeItems.map((item) => {
          const duration = fraction(item.duration).mul(factor)
          const continuedOffset = fraction(offset).add(item.offset.sub(activeStartOffset).mul(factor))
          const continuedItem: RhythmicLayoutItem =
            item.kind === 'note'
              ? {
                  ...item,
                  offset: continuedOffset,
                  duration,
                  tiedFromOffset: item.offset,
                  tuplets: [],
                }
              : { ...item, offset: continuedOffset, duration, tuplets: [] }
          layout.push(continuedItem)
          return continuedItem
        })
        state.activeItems = continuedItems
        state.activeNotes = continuedItems.filter(
          (item): item is NoteLayoutItem => item.kind === 'note',
        )
        state.activeSpan = continuedDuration
        state.barlineSinceActiveItems = false
      } else {
        state.activeItems.forEach((item) => {
          const duration = fraction(item.duration)
          item.duration = duration.add(duration.mul(factor))
        })
        state.activeSpan = activeSpan.add(continuedDuration)
      }
      const tupletIds = state.activeNotes[0]?.tuplets.map((tuplet) => tuplet.id) ?? []
      const resolvesToRegularNotes = state.activeNotes.every(
        (note) =>
          note.tuplets.map((tuplet) => tuplet.id).join(',') === tupletIds.join(',') &&
          Number.isInteger(Math.log2(durationValue(note.duration))),
      )
      if (!state.hasFollowingContinuation && tupletIds.length && resolvesToRegularNotes) {
        state.activeNotes.forEach((note) => {
          note.tuplets = []
        })
      }
    } else if (shape.kind === 'rest') {
      state.activeItems = []
      state.activeNotes = []
      state.activeSpan = undefined
      state.barlineSinceActiveItems = false
      layout.push({ kind: 'rest', offset, duration: shape.duration, tuplets: [], voice })
    } else if (shape.kind === 'barline') {
      layout.push({ kind: 'barline', offset, style: shape.style, tuplets: [], voice })
      if (state.activeItems.length) state.barlineSinceActiveItems = true
    } else if (shape.kind === 'annotation') {
      layout.push({ kind: 'annotation', offset, text: shape.text, tuplets: [], voice })
    } else if (shape.kind === 'dynamic') {
      layout.push({ kind: 'dynamic', offset, mark: shape.mark, tuplets: [], voice })
    } else if (shape.kind === 'sequence') {
      const startOffset = offset
      const startIndex = layout.length
      const inheritedFollowingContinuation = state.hasFollowingContinuation
      shape.children.forEach((child, index) => {
        state.hasFollowingContinuation =
          inheritedFollowingContinuation ||
          shape.children[index + 1]?.kind === 'continue'
        offset = visit(child, offset, state, voice)
      })
      state.hasFollowingContinuation = inheritedFollowingContinuation
      if (shape.normalized || shape.tuplet) {
        const rhythmicItems = layout
          .slice(startIndex)
          .filter((item) => item.kind === 'note' || item.kind === 'rest')
        if (shape.tuplet) {
          const level = Math.max(
            0,
            ...rhythmicItems.flatMap((item) => item.tuplets.map((t) => t.level + 1)),
          )
          const span: LayoutTuplet = {
            id: nextTupletId++,
            count: shape.tuplet,
            level,
            startOffset,
            endOffset: rhythmicItems[rhythmicItems.length - 1]?.offset ?? startOffset,
          }
          rhythmicItems.forEach((item) => item.tuplets.push(span))
        }
        let lastRest = -1
        rhythmicItems.forEach((item, index) => {
          if (item.kind === 'rest') lastRest = index
        })
        state.activeNotes = rhythmicItems
          .slice(lastRest + 1)
          .filter((item): item is NoteLayoutItem => item.kind === 'note')
        state.activeItems = rhythmicItems
        state.activeSpan = rhythmicItems.length ? shape.duration : undefined
      }
      return offset
    } else if (shape.kind === 'parallel') {
      const branchStates = shape.branches.map(
        (): VisitState => ({ activeItems: [], activeNotes: [] }),
      )
      const branchEnds = shape.branches.map((branch, index) =>
        visit(branch, offset, branchStates[index]!, nextVoiceId++),
      )
      state.activeNotes = branchStates.flatMap((branch) => branch.activeNotes)
      state.activeItems = branchStates.flatMap((branch) => branch.activeItems)
      state.activeSpan = shape.duration
      state.barlineSinceActiveItems = branchStates.some(
        (branch) => branch.barlineSinceActiveItems,
      )
      return branchEnds.reduce((latest, end) => (end.compare(latest) > 0 ? end : latest), offset)
    }
    return shape.duration ? offset.add(shape.duration) : offset
  }
  if (props.notation)
    visit(props.notation, new Fraction(0), { activeItems: [], activeNotes: [] }, 0)

  const offsets = [
    ...layout.map((item) => item.offset),
    ...layout.flatMap((item) => item.tuplets.map((tuplet) => tuplet.endOffset)),
  ].sort((a, b) => a.compare(b))
  const uniqueOffsets = offsets.filter(
    (offset, index) => !index || !offset.equals(offsets[index - 1]!),
  )
  const column = (offset: Fraction) =>
    uniqueOffsets.findIndex((candidate) => candidate.equals(offset))

  const staffItems = layout.map(({ offset, tiedFromOffset, tuplets, ...item }) => {
    const itemColumn = column(offset)

    return {
      ...item,
      column: itemColumn,
      tuplets: tuplets.map((tuplet) => ({
        id: tuplet.id,
        count: tuplet.count,
        level: tuplet.level,
        startColumn: column(tuplet.startOffset),
        endColumn: column(tuplet.endOffset),
      })),
      tiedFromColumn: tiedFromOffset ? column(tiedFromOffset) : undefined,
    }
  }) as StaffItem[]

  // A non-binary subdivision directive (for example @3) produces ordinary
  // exact-duration items rather than a normalized sequence node. Infer spans
  // independently in each voice, ignoring zero-duration staff events. A final
  // short group is deliberately retained: `@3 C D` is a valid incomplete triplet.
  const voices = new Map<number, Extract<StaffItem, { kind: 'note' | 'rest' }>[]>()
  staffItems.forEach((item) => {
    if (item.kind !== 'note' && item.kind !== 'rest') return
    const rhythmicItems = voices.get(item.voice) ?? []
    rhythmicItems.push(item)
    voices.set(item.voice, rhythmicItems)
  })
  voices.forEach((rhythmicItems) => {
    for (let start = 0; start < rhythmicItems.length;) {
      const first = rhythmicItems[start]!
      if (!first.duration) {
        start++
        continue
      }
      const engravingDuration = first.tuplets.reduce(
        (duration, tuplet) => duration.mul(tuplet.count).div(2),
        fraction(first.duration),
      )
      let count = engravingDuration.d
      while (count % 2 === 0) count /= 2
      if (count <= 1 || !Number.isSafeInteger(count)) {
        start++
        continue
      }
      const containingTuplets = first.tuplets.map((tuplet) => tuplet.id).join(',')
      let end = start
      while (
        end < rhythmicItems.length &&
        rhythmicItems[end]!.duration &&
        rhythmicItems[end]!.tuplets.map((tuplet) => tuplet.id).join(',') === containingTuplets &&
        rhythmicItems[end]!.tuplets.reduce(
          (duration, tuplet) => duration.mul(tuplet.count).div(2),
          fraction(rhythmicItems[end]!.duration),
        ).equals(engravingDuration)
      )
        end++
      const containingIds = new Set(first.tuplets.map((tuplet) => tuplet.id))
      if (first.tuplets.some((tuplet) => tuplet.level === 0)) {
        staffItems.forEach((item) =>
          item.tuplets.forEach((tuplet) => {
            if (containingIds.has(tuplet.id)) tuplet.level++
          }),
        )
      }
      for (let chunkStart = start; chunkStart < end; chunkStart += count) {
        const run = rhythmicItems.slice(chunkStart, Math.min(chunkStart + count, end))
        const span: TupletSpan = {
          id: nextTupletId++,
          count,
          level: 0,
          startColumn: run[0]!.column,
          endColumn: run[run.length - 1]!.column,
        }
        run.forEach((item) => item.tuplets.push(span))
      }
      start = end
    }
  })

  staffItems.forEach((item, index) => {
    if (item.kind !== 'note' || !item.grace) return
    const donor = staffItems
      .slice(index + 1)
      .find((candidate) => candidate.kind === 'note' && !candidate.grace)
    if (donor?.kind === 'note') {
      item.tiedToColumn = donor.column
      item.tiedToPosition = donor.pitch.staffPosition
    }
  })

  const labeledNotesByColumn = new Map<number, Extract<StaffItem, { kind: 'note' }>[]>()
  staffItems.forEach((item) => {
    if (item.kind !== 'note' || !item.displayLabel) return
    const columnLabels = labeledNotesByColumn.get(item.column) ?? []
    columnLabels.push(item)
    labeledNotesByColumn.set(item.column, columnLabels)
  })
  labeledNotesByColumn.forEach((columnLabels) => {
    columnLabels
      .sort((a, b) => b.pitch.staffPosition - a.pitch.staffPosition)
      .forEach((item, displayLabelRow) => {
        item.displayLabelRow = displayLabelRow
      })
  })

  return staffItems
})

const tupletSpans = computed(() => {
  const spans = new Map<number, TupletSpan>()
  items.value.forEach((item) => item.tuplets.forEach((span) => spans.set(span.id, span)))
  return [...spans.values()]
})

const tupletCount = (item: StaffItem) =>
  item.tuplets.length
    ? item.tuplets.reduce((factor, tuplet) => factor * tuplet.count, 1) /
      2 ** (item.tuplets.length - 1)
    : undefined

const repeatMarkerColumns = computed(
  () =>
    new Set(
      items.value
        .filter(
          (item) =>
            item.kind === 'barline' &&
            (item.style === 'repeat-start' || item.style === 'repeat-end'),
        )
        .map((item) => item.column),
    ),
)
const repeatMarkerSpace = 24
const repeatSpaceBefore = (column: number) =>
  [...repeatMarkerColumns.value].filter((markerColumn) => markerColumn <= column).length *
  repeatMarkerSpace
const width = computed(() =>
  Math.max(
    360,
    80 +
      (Math.max(-1, ...items.value.map((item) => item.column)) + 1) * 52 +
      repeatMarkerColumns.value.size * repeatMarkerSpace,
  ),
)
const height = computed(() =>
  Math.max(170, 158 + Math.max(0, ...items.value.map((item) => item.displayLabelRow ?? 0)) * 13),
)
const x = (column: number) => 60 + column * 52 + repeatSpaceBefore(column)
const barlineX = (item: Extract<StaffItem, { kind: 'barline' }>) =>
  x(item.column) - 26 - (repeatMarkerColumns.value.has(item.column) ? repeatMarkerSpace / 2 : 0)
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

const inflection = (
  value: StaffInflection,
  index: number,
  inflections: readonly StaffInflection[],
) => {
  if ('kind' in value) {
    return { up: '^', down: 'v', lift: '/', drop: '\\' }[value.kind]
  }
  const hasMatchingFactor = inflections
    .slice(0, index)
    .some((candidate) => !('kind' in candidate) && candidate.direction === value.direction)
  const separator = hasMatchingFactor ? ',' : value.direction === 'denominator' ? '/' : ''
  return `${separator}${value.prime}${value.flavor ?? ''}`
}

const orderedInflections = (inflections: readonly StaffInflection[]) =>
  [...inflections].sort((left, right) => {
    const rank = (value: StaffInflection) =>
      'kind' in value ? 0 : value.direction === 'numerator' ? 1 : 2
    return rank(left) - rank(right)
  })

const formattedInflections = (inflections: readonly StaffInflection[]) => {
  const ordered = orderedInflections(inflections)
  return ordered.map((value, index) => inflection(value, index, ordered))
}

const ledgerPositions = (position: number) => {
  const positions: number[] = []
  for (let current = 0; current >= position; current -= 2) positions.push(current)
  for (let current = 12; current <= position; current += 2) positions.push(current)
  return positions
}

const flagCount = (duration?: Fraction, tupletCount?: number) => {
  if (!duration) return 0
  const value = durationValue(duration) * (tupletCount ? tupletCount / 2 : 1)
  if (value >= 1 || value <= 0) return 0
  const subdivision = Math.round(1 / value)
  const binarySubdivision = subdivision % 3 === 0 ? subdivision / 3 : subdivision
  const binaryFlags = Math.log2(binarySubdivision)
  return Number.isInteger(binaryFlags) ? binaryFlags + (subdivision % 3 === 0 ? 1 : 0) : 0
}

const effectiveDuration = (duration: Fraction, tupletCount?: number) =>
  fraction(duration)
    .mul(tupletCount ?? 2)
    .div(2)

const isPowerOfTwoFraction = (value: Fraction) => {
  let numerator = value.n
  let denominator = value.d
  while (numerator > 1 && numerator % 2 === 0) numerator /= 2
  while (denominator > 1 && denominator % 2 === 0) denominator /= 2
  return numerator === 1 && denominator === 1
}

const isSupportedNoteDuration = (duration?: Fraction, tupletCount?: number) => {
  if (!duration) return false
  const value = effectiveDuration(duration, tupletCount)
  if (value.s <= 0 || value.compare(6) > 0) return false
  return isPowerOfTwoFraction(value) || isPowerOfTwoFraction(value.div(3))
}

const isOpenNotehead = (duration: Fraction) => durationValue(duration) >= 2
const hasStem = (duration: Fraction) => durationValue(duration) < 4
const engravingDuration = (item: Extract<StaffItem, { kind: 'note' }>) =>
  item.notatedDuration ?? item.duration
const isDotted = (duration: Fraction) => {
  const relativeToDottedHalf = durationValue(duration) / 3
  return relativeToDottedHalf > 0 && Number.isInteger(Math.log2(relativeToDottedHalf))
}

const restSymbol = (duration: Fraction, tupletCount?: number) => {
  const value = effectiveDuration(duration, tupletCount)
  const base = isDotted(value) ? value.mul(2).div(3) : value
  return base.equals(4) || base.equals(2)
    ? ''
    : base.equals(1)
      ? '𝄽'
      : base.equals('1/2')
        ? '𝄾'
        : base.equals('1/4')
          ? '𝄿'
          : '?'
}

const restBox = (duration: Fraction, tupletCount?: number) => {
  const value = effectiveDuration(duration, tupletCount)
  const base = isDotted(value) ? value.mul(2).div(3) : value
  return base.equals(4) ? 'whole' : base.equals(2) ? 'half' : undefined
}

const isSupportedRestDuration = (duration: Fraction, tupletCount?: number) =>
  Boolean(restBox(duration, tupletCount)) || restSymbol(duration, tupletCount) !== '?'

const restDotY = (duration: Fraction, tupletCount?: number) =>
  restBox(duration, tupletCount) === 'whole'
    ? 68
    : restBox(duration, tupletCount) === 'half'
      ? 72
      : 76
</script>

<template>
  <svg
    class="musical-staff"
    :viewBox="`0 0 ${width} ${height}`"
    role="img"
    aria-label="Musical staff"
  >
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
    <g v-for="tuplet in tupletSpans" :key="`tuplet-${tuplet.id}`" class="tuplet">
      <text
        class="tuplet-number"
        :x="(x(tuplet.startColumn) + x(tuplet.endColumn)) / 2"
        :y="31 - tuplet.level * 16"
      >
        {{ tuplet.count }}
      </text>
      <path
        class="tuplet-bracket"
        :d="`M ${x(tuplet.startColumn) - 10} ${40 - tuplet.level * 16} V ${34 - tuplet.level * 16} H ${(x(tuplet.startColumn) + x(tuplet.endColumn)) / 2 - 10} M ${(x(tuplet.startColumn) + x(tuplet.endColumn)) / 2 + 10} ${34 - tuplet.level * 16} H ${x(tuplet.endColumn) + 10} V ${40 - tuplet.level * 16}`"
      />
    </g>
    <g
      v-for="(item, index) in items"
      :key="index"
      :class="{ 'grace-note': item.kind === 'note' && item.grace }"
    >
      <template v-if="item.kind === 'rest'">
        <rect
          v-if="restBox(item.duration, tupletCount(item))"
          class="rest rest-box"
          :class="`rest-box--${restBox(item.duration, tupletCount(item))}`"
          :x="x(item.column) - 7"
          :y="restBox(item.duration, tupletCount(item)) === 'whole' ? 64 : 70"
          width="14"
          height="6"
        />
        <text v-else class="rest" :x="x(item.column)" y="79">
          {{ restSymbol(item.duration, tupletCount(item)) }}
        </text>
        <circle
          v-if="
            isSupportedRestDuration(item.duration, tupletCount(item)) &&
            isDotted(effectiveDuration(item.duration, tupletCount(item)))
          "
          class="augmentation-dot rest-dot"
          :cx="x(item.column) + 17"
          :cy="restDotY(item.duration, tupletCount(item))"
          r="2"
        />
      </template>
      <text v-else-if="item.kind === 'annotation'" class="annotation" :x="x(item.column)" y="25">
        {{ item.text }}
      </text>
      <text
        v-else-if="item.kind === 'dynamic'"
        class="performance-label dynamic-label"
        :x="x(item.column)"
        y="145"
      >
        {{ item.mark }}
      </text>
      <g v-else-if="item.kind === 'barline'" class="barline" :class="`barline--${item.style}`">
        <line
          :x1="barlineX(item) - (item.style === 'single' ? 0 : 3)"
          :x2="barlineX(item) - (item.style === 'single' ? 0 : 3)"
          y1="52"
          y2="100"
        />
        <line
          v-if="item.style !== 'single'"
          :x1="barlineX(item) + 3"
          :x2="barlineX(item) + 3"
          y1="52"
          y2="100"
        />
        <template v-if="item.style === 'repeat-start' || item.style === 'repeat-end'">
          <circle
            :cx="barlineX(item) + (item.style === 'repeat-start' ? 10 : -10)"
            cy="70"
            r="2.5"
          />
          <circle
            :cx="barlineX(item) + (item.style === 'repeat-start' ? 10 : -10)"
            cy="82"
            r="2.5"
          />
        </template>
      </g>
      <template v-else>
        <path
          v-if="item.grace && item.tiedToColumn !== undefined && item.tiedToPosition !== undefined"
          class="grace-tie"
          :d="`M ${x(item.column) + 5} ${y(item.pitch.staffPosition) + 5} Q ${(x(item.column) + x(item.tiedToColumn)) / 2} ${Math.max(y(item.pitch.staffPosition), y(item.tiedToPosition)) + 15} ${x(item.tiedToColumn) - 7} ${y(item.tiedToPosition) + 7}`"
        />
        <text
          v-if="!isSupportedNoteDuration(engravingDuration(item), tupletCount(item))"
          class="notation-error"
          :x="x(item.column)"
          :y="y(item.pitch.staffPosition) + 5"
        >
          ?
        </text>
        <template v-else>
          <path
            v-if="item.tiedFromColumn !== undefined"
            class="tie"
            :d="`M ${x(item.tiedFromColumn) + 6} ${y(item.pitch.staffPosition) + 7} Q ${(x(item.tiedFromColumn) + x(item.column)) / 2} ${y(item.pitch.staffPosition) + 17} ${x(item.column) - 6} ${y(item.pitch.staffPosition) + 7}`"
          />
          <line
            v-for="position in ledgerPositions(item.pitch.staffPosition)"
            :key="position"
            class="ledger-line"
            :x1="x(item.column) - 12"
            :x2="x(item.column) + 12"
            :y1="y(position)"
            :y2="y(position)"
          />
          <text
            v-if="
              (item.pitch.inflections?.length || item.pitch.accidentals.length) &&
              item.tiedFromColumn === undefined
            "
            class="pitch-decorations"
            :x="x(item.column) - 11"
            :y="y(item.pitch.staffPosition) + 5"
          >
            <tspan
              v-for="(value, inflectionIndex) in formattedInflections(item.pitch.inflections ?? [])"
              :key="`inflection-${inflectionIndex}`"
              class="inflection"
            >
              {{ value }}
            </tspan>
            <tspan v-if="item.pitch.accidentals.length" class="accidental">
              {{ item.pitch.accidentals.map(accidental).join('') }}
            </tspan>
          </text>
          <polygon
            v-if="item.pitch.notehead === 'triangle-down'"
            class="notehead"
            :points="`${x(item.column) - 7},${y(item.pitch.staffPosition) - 5} ${x(item.column) + 7},${y(item.pitch.staffPosition) - 5} ${x(item.column)},${y(item.pitch.staffPosition) + 6}`"
          />
          <polygon
            v-else-if="item.pitch.notehead === 'triangle-up'"
            class="notehead"
            :points="`${x(item.column)},${y(item.pitch.staffPosition) - 6} ${x(item.column) + 7},${y(item.pitch.staffPosition) + 5} ${x(item.column) - 7},${y(item.pitch.staffPosition) + 5}`"
          />
          <g v-else-if="item.pitch.notehead === 'x'" class="notehead x-notehead">
            <line
              :x1="x(item.column) - 6"
              :x2="x(item.column) + 6"
              :y1="y(item.pitch.staffPosition) - 6"
              :y2="y(item.pitch.staffPosition) + 6"
            />
            <line
              :x1="x(item.column) - 6"
              :x2="x(item.column) + 6"
              :y1="y(item.pitch.staffPosition) + 6"
              :y2="y(item.pitch.staffPosition) - 6"
            />
          </g>
          <ellipse
            v-else
            class="notehead"
            :class="{
              'notehead--open': isOpenNotehead(
                effectiveDuration(engravingDuration(item), tupletCount(item)),
              ),
            }"
            :cx="x(item.column)"
            :cy="y(item.pitch.staffPosition)"
            rx="7"
            ry="5"
          />
          <circle
            v-if="isDotted(effectiveDuration(engravingDuration(item), tupletCount(item)))"
            class="augmentation-dot"
            :cx="x(item.column) + 13"
            :cy="y(item.pitch.staffPosition) - (item.pitch.staffPosition % 2 ? 0 : 3)"
            r="2"
          />
          <line
            v-if="hasStem(effectiveDuration(engravingDuration(item), tupletCount(item)))"
            class="stem"
            :x1="x(item.column) + 6"
            :x2="x(item.column) + 6"
            :y1="y(item.pitch.staffPosition)"
            :y2="y(item.pitch.staffPosition) - 30"
          />
          <path
            v-for="flag in flagCount(engravingDuration(item), tupletCount(item))"
            :key="`flag-${flag}`"
            class="flag"
            :d="`M ${x(item.column) + 6} ${y(item.pitch.staffPosition) - 30 + (flag - 1) * 7} Q ${x(item.column) + 20} ${y(item.pitch.staffPosition) - 23 + (flag - 1) * 7} ${x(item.column) + 12} ${y(item.pitch.staffPosition) - 13 + (flag - 1) * 7}`"
          />
          <text
            v-if="item.displayLabel"
            class="sounding-label"
            :x="x(item.column)"
            :y="130 + (item.displayLabelRow ?? 0) * 13"
          >
            {{ item.displayLabel }}
          </text>
        </template>
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

.grace-tie {
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
}

.grace-note .notehead {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(0.68);
}

.grace-note .stem {
  stroke-width: 1;
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

.notehead--open {
  fill: white;
  stroke: currentColor;
  stroke-width: 1.5;
}

.augmentation-dot {
  fill: currentColor;
}

.rest-box {
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

.sounding-label,
.performance-label {
  font-size: 11px;
  text-anchor: middle;
}

.performance-label {
  font-style: italic;
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
