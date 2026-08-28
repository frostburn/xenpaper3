import { Fraction } from 'xen-dev-utils'

export type Beat = Fraction

export interface TempoChange {
  id: string
  beat: Beat
  bpm: number
}

export interface TimeSignatureChange {
  id: string
  beat: Beat
  numerator: number
  denominator: number
}

export interface GlobalTrack {
  source: string
  tempoChanges: TempoChange[]
  timeSignatureChanges: TimeSignatureChange[]
}

export const OSCILLATOR_TYPES = ['sine', 'square', 'sawtooth', 'triangle'] as const
export type OscillatorType = (typeof OSCILLATOR_TYPES)[number]

export const CLIP_DISPLAY_MODES = ['piano-roll', 'source'] as const
export type ClipDisplayMode = (typeof CLIP_DISPLAY_MODES)[number]

export interface SourceClip {
  id: string
  start: Beat
  length: Beat
  source: string
}

export interface InstrumentLane {
  /** Absent on version-1 projects created before drum lanes; interpreted as instrument. */
  kind?: 'instrument' | 'drum'
  id: string
  name: string
  patchSource: string
  oscillatorType: OscillatorType
  gain: number
  source: string
  clips: SourceClip[]
}

export interface DawProject {
  version: 1
  title: string
  globalTrack: GlobalTrack
  instrumentLanes: InstrumentLane[]
}

export const DEFAULT_CLIP_SOURCE = `# New Xenpaper clip
[0,4,7]===
`
export const DEFAULT_DRUM_CLIP_SOURCE = `# Basic 4/4 beat
[bd,hh] hh [sd,hh] hh
`
export const DEFAULT_SW_PATCH_SOURCE = 'default'
export const DEFAULT_GLOBAL_SOURCE = `# Shared tuning and score initialization (for example: {12edo})
`
export const DEFAULT_INSTRUMENT_SOURCE = `# Defaults inherited by every clip in this lane
@patch(attack: 100ms, decay: 200ms, sustain: 70%, release: 300ms)
`

export const beat = (numerator: number, denominator = 1): Beat => {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new RangeError('Beat values require an integer numerator and positive denominator')
  }
  return new Fraction(numerator, denominator)
}

export const beatToNumber = (value: Beat) => value.valueOf()

export const snapBeat = (value: number, grid: Beat): Beat => {
  const units = Math.round(value / grid.valueOf())
  return grid.mul(units)
}

export const pointerXToBeat = (pointerX: number, scrollLeft: number, pixelsPerBeat: number) =>
  (pointerX + scrollLeft) / pixelsPerBeat

export const createInstrumentLane = (project: DawProject): InstrumentLane => {
  const usedIds = new Set(project.instrumentLanes.map((lane) => lane.id))
  let suffix = 1
  while (usedIds.has(`instrument-${suffix}`)) suffix += 1
  return {
    id: `instrument-${suffix}`,
    kind: 'instrument',
    name: `Instrument ${suffix}`,
    patchSource: DEFAULT_SW_PATCH_SOURCE,
    oscillatorType: 'sawtooth',
    gain: 0.8,
    source: DEFAULT_INSTRUMENT_SOURCE,
    clips: [],
  }
}

export const createDrumLane = (project: DawProject): InstrumentLane => {
  const usedIds = new Set(project.instrumentLanes.map((lane) => lane.id))
  let suffix = 1
  while (usedIds.has(`drum-${suffix}`)) suffix += 1
  return {
    id: `drum-${suffix}`,
    kind: 'drum',
    name: `Drums ${suffix}`,
    patchSource: 'drumkit',
    oscillatorType: 'sine',
    gain: 0.8,
    source: '',
    clips: [],
  }
}

export const createDefaultProject = (): DawProject => {
  const project: DawProject = {
    version: 1,
    title: 'Untitled project',
    globalTrack: {
      source: DEFAULT_GLOBAL_SOURCE,
      tempoChanges: [{ id: 'tempo-1', beat: beat(0), bpm: 120 }],
      timeSignatureChanges: [
        { id: 'time-signature-1', beat: beat(0), numerator: 4, denominator: 4 },
      ],
    },
    instrumentLanes: [],
  }
  project.instrumentLanes.push(createInstrumentLane(project))
  return project
}

export const createClip = (lane: InstrumentLane, start: Beat): SourceClip => {
  const usedIds = new Set(lane.clips.map((clip) => clip.id))
  let suffix = lane.clips.length + 1
  while (usedIds.has(`clip-${suffix}`)) suffix += 1
  return {
    id: `clip-${suffix}`,
    start,
    length: beat(4),
    source: lane.kind === 'drum' ? DEFAULT_DRUM_CLIP_SOURCE : DEFAULT_CLIP_SOURCE,
  }
}
