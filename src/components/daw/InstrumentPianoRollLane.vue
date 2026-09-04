<script setup lang="ts">
import { computed } from 'vue'
import { clamp, frequencyToCentOffset } from 'xen-dev-utils'
import { compileSourceInitialization, parseClipNotes } from '../../daw/score'
import { easeGlissando } from '../../daw/easing'
import {
  beatToNumber,
  OSCILLATOR_TYPES,
  type ClipDisplayMode,
  type InstrumentLane,
  type SourceClip,
} from '../../daw/project'
import InstrumentLaneComponent from './InstrumentLane.vue'

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
  'update-oscillator': [type: InstrumentLane['oscillatorType']]
  'update-gain': [gain: number]
  'delete-lane': []
  'toggle-collapse': []
}>()

type PreviewNote = ReturnType<typeof parseClipNotes>[number]

const XENPAPER_C_OFFSET_FROM_A4 = -900
const MINIMUM_AUDIBLE_CENTS = frequencyToCentOffset(20) - XENPAPER_C_OFFSET_FROM_A4
const MAXIMUM_AUDIBLE_CENTS = frequencyToCentOffset(20_000) - XENPAPER_C_OFFSET_FROM_A4
const clampAudiblePitch = (cents: number) =>
  clamp(MINIMUM_AUDIBLE_CENTS, MAXIMUM_AUDIBLE_CENTS, cents)
const isAudiblePitch = (cents: number) =>
  cents >= MINIMUM_AUDIBLE_CENTS && cents <= MAXIMUM_AUDIBLE_CENTS

const segmentPitch = (segment: NonNullable<PreviewNote['glissando']>[number], t: number) =>
  segment.from + (segment.to - segment.from) * easeGlissando(segment.easing, t)

/** Pitches reached before a clip-truncated note ends. */
const notePitches = (note: PreviewNote) => {
  const pitches = [note.cents]
  for (const segment of note.glissando ?? []) {
    if (segment.start >= note.duration) break
    const progress = Math.min(1, (note.duration - segment.start) / segment.duration)
    pitches.push(segment.from, segmentPitch(segment, progress))
    if (progress < 1) break
  }
  return pitches
}

const pianoRoll = computed(() => {
  let initialization
  try {
    const globalInitialization = compileSourceInitialization(props.globalSource ?? '')
    initialization = compileSourceInitialization(props.lane.source, globalInitialization)
  } catch {
    initialization = undefined
  }
  const parsedClips = props.lane.clips.map((clip) => {
    try {
      if (!initialization) throw new Error('Invalid initialization source')
      return {
        clip,
        notes: parseClipNotes(clip.source, beatToNumber(clip.length), initialization),
      }
    } catch {
      // Invalid source is expected while the user is editing; show an empty preview.
      return { clip, notes: [] }
    }
  })
  const clipCenters = parsedClips
    .flatMap(({ notes }) => {
      // Inaudible pitches are warning markers, not representative musical content.
      // Excluding them prevents an extreme value from folding audible clips away.
      const pitches = notes.flatMap(notePitches).filter(isAudiblePitch)
      return pitches.length ? [(Math.min(...pitches) + Math.max(...pitches)) / 2] : []
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
    const pitches = notes.flatMap(notePitches)
    const clipCenter = (Math.min(...pitches) + Math.max(...pitches)) / 2
    const distance = clipCenter - laneCenter
    // Fold disparate registers into the representative lane range by whole octaves.
    // The authored register remains explicit in the label rendered on that clip.
    const hasInaudiblePitch = notes.flatMap(notePitches).some((pitch) => !isAudiblePitch(pitch))
    const registerOffset =
      !hasInaudiblePitch && Math.abs(distance) >= 1200 ? Math.round(distance / 1200) * 1200 : 0
    return { clip, notes, registerOffset }
  })
  const pitches = displayClips.flatMap(({ notes, registerOffset }) =>
    notes.flatMap(notePitches).map((cents) => clampAudiblePitch(cents - registerOffset)),
  )
  // Keep zero visible as the pitch reference and guarantee enough room around tightly
  // clustered material. Outlying clips expand this scale only as far as human hearing.
  const lowestPitch = Math.min(0, ...pitches)
  const highestPitch = Math.max(0, ...pitches)
  const minimumSpan = 2400
  const contentSpan = highestPitch - lowestPitch
  const padding = Math.max(100, contentSpan * 0.06)
  const missingSpan = Math.max(0, minimumSpan - contentSpan)
  const lowerBound = clampAudiblePitch(lowestPitch - padding - missingSpan / 2)
  const upperBound = clampAudiblePitch(highestPitch + padding + missingSpan / 2)
  const pitchSpan = upperBound - lowerBound
  const pitchTop = (cents: number) =>
    `${((upperBound - clampAudiblePitch(cents)) / pitchSpan) * 100}%`
  const point = (beat: number, cents: number, clipDuration: number) =>
    `${(beat / clipDuration) * 100},${((upperBound - clampAudiblePitch(cents)) / pitchSpan) * 100}`

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
            notes: notes.map((note) => {
              const inaudible = notePitches(note).some((pitch) => !isAudiblePitch(pitch))
              const glissandoPath = note.glissando
                ? (() => {
                    const points = [point(note.beat, note.cents - registerOffset, clipDuration)]
                    let heldPitch = note.cents
                    const noteEndBeat = note.beat + note.duration
                    for (const segment of note.glissando) {
                      const startBeat = note.beat + segment.start
                      if (startBeat >= noteEndBeat) break
                      if (startBeat > note.beat) {
                        points.push(point(startBeat, heldPitch - registerOffset, clipDuration))
                      }
                      const audibleDuration = Math.min(segment.duration, noteEndBeat - startBeat)
                      const endProgress = audibleDuration / segment.duration
                      const samples = Math.max(1, Math.ceil(16 * endProgress))
                      for (let sample = 1; sample <= samples; sample += 1) {
                        const t = (sample / samples) * endProgress
                        const pitch = segmentPitch(segment, t)
                        points.push(
                          point(
                            startBeat + segment.duration * t,
                            pitch - registerOffset,
                            clipDuration,
                          ),
                        )
                      }
                      heldPitch = segmentPitch(segment, endProgress)
                      if (endProgress < 1) break
                    }
                    points.push(point(noteEndBeat, heldPitch - registerOffset, clipDuration))
                    return `M ${points.join(' L ')}`
                  })()
                : undefined
              return {
                ...note,
                left: `${(note.beat / clipDuration) * 100}%`,
                width: `${(note.duration / clipDuration) * 100}%`,
                top: pitchTop(note.cents - registerOffset),
                glissandoPath,
                inaudible,
              }
            }),
          },
        ]
      }),
    ),
  }
})

const clipPreview = (clipId: string) => pianoRoll.value.notesByClip[clipId]!
</script>

<template>
  <InstrumentLaneComponent
    :lane="lane"
    :selected-clip-id="selectedClipId"
    :pixels-per-beat="pixelsPerBeat"
    :scroll-left="scrollLeft"
    :display-mode="displayMode"
    :collapsed="collapsed"
    lane-label="Instrument lane"
    timeline-label="Instrument piano roll"
    editor-label="Instrument lane source"
    @insert="emit('insert', $event)"
    @select="emit('select', $event)"
    @place-playhead="emit('place-playhead', $event)"
    @move="(clip, beat) => emit('move', clip, beat)"
    @delete="emit('delete', $event)"
    @update-source="emit('update-source', $event)"
    @update-name="emit('update-name', $event)"
    @update-gain="emit('update-gain', $event)"
    @delete-lane="emit('delete-lane')"
    @toggle-collapse="emit('toggle-collapse')"
  >
    <template #settings>
      <label>
        {{ lane.patchSource }} SW Patch ·
        <select
          aria-label="Waveform"
          :value="lane.oscillatorType"
          @change="
            emit(
              'update-oscillator',
              ($event.target as HTMLSelectElement).value as InstrumentLane['oscillatorType'],
            )
          "
        >
          <option v-for="type in OSCILLATOR_TYPES" :key="type">{{ type }}</option>
        </select>
      </label>
    </template>
    <template #preview="{ clip }">
      <span class="piano-roll" aria-label="Piano roll preview">
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
        <svg
          class="bendy-notes"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            v-for="(note, index) in clipPreview(clip.id).notes.filter((note) => note.glissandoPath)"
            :key="index"
            class="bendy-note"
            :class="{ inaudible: note.inaudible }"
            :data-beat="note.beat"
            :data-duration="note.duration"
            :data-cents="note.cents"
            :d="note.glissandoPath"
          />
        </svg>
        <i
          v-for="(note, index) in clipPreview(clip.id).notes"
          v-show="!note.glissandoPath"
          :key="index"
          :data-beat="note.beat"
          :data-duration="note.duration"
          :data-cents="note.cents"
          :class="{ inaudible: note.inaudible }"
          :style="{ top: note.top, left: note.left, width: note.width }"
        />
      </span>
    </template>
  </InstrumentLaneComponent>
</template>

<style scoped>
.piano-roll {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent 0 11%,
    color-mix(in srgb, var(--xenpaper-text) 7%, transparent) 12% 13%
  );
  pointer-events: none;
}
.pitch-guide {
  position: absolute;
  right: 0;
  left: 0;
  border-top: 1px dashed color-mix(in srgb, var(--xenpaper-light-red) 67%, transparent);
}
.pitch-guide.global-reference {
  z-index: 1;
  border-top: 3px solid var(--xenpaper-red);
}
.register-label {
  position: absolute;
  z-index: 2;
  top: 0.2rem;
  right: 0.25rem;
  padding: 0.08rem 0.25rem;
  border-radius: 2px;
  background: color-mix(in srgb, var(--xenpaper-bg-control) 87%, transparent);
  color: var(--xenpaper-light-red);
  font: 0.65rem/1.2 monospace;
}
.piano-roll i {
  position: absolute;
  z-index: 2;
  transform: translateY(-50%);
  height: 9%;
  min-width: 2px;
  border-radius: 2px;
  background: var(--xenpaper-cyan);
}
.piano-roll i.inaudible {
  background: var(--xenpaper-orange);
}
.bendy-notes {
  position: absolute;
  z-index: 2;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.bendy-note {
  fill: none;
  stroke: var(--xenpaper-cyan);
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.bendy-note.inaudible {
  stroke: var(--xenpaper-orange);
}
</style>
