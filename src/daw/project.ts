export interface Beat {
  numerator: number
  denominator: number
}

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
  id: string
  name: string
  patchSource: string
  oscillatorType: OscillatorType
  gain: number
  clips: SourceClip[]
}

export interface DawProject {
  version: 1
  title: string
  globalTrack: GlobalTrack
  instrumentLanes: InstrumentLane[]
}

export const DEFAULT_CLIP_SOURCE = `# New Xenpaper clip
@patch(attack: 25ms, decay: 180ms, sustain: 65%, release: 250ms)
[0,4,7]===
`
export const DEFAULT_SW_PATCH_SOURCE = 'default'

export const beat = (numerator: number, denominator = 1): Beat => {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new RangeError('Beat values require an integer numerator and positive denominator')
  }
  const divisor = greatestCommonDivisor(Math.abs(numerator), denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

const greatestCommonDivisor = (left: number, right: number): number =>
  right === 0 ? left || 1 : greatestCommonDivisor(right, left % right)

export const beatToNumber = (value: Beat) => value.numerator / value.denominator

export const snapBeat = (value: number, grid: Beat): Beat => {
  const units = Math.round(value / beatToNumber(grid))
  return beat(units * grid.numerator, grid.denominator)
}

export const pointerXToBeat = (pointerX: number, scrollLeft: number, pixelsPerBeat: number) =>
  (pointerX + scrollLeft) / pixelsPerBeat

export const createDefaultProject = (): DawProject => ({
  version: 1,
  title: 'Untitled project',
  globalTrack: {
    tempoChanges: [{ id: 'tempo-1', beat: beat(0), bpm: 120 }],
    timeSignatureChanges: [{ id: 'time-signature-1', beat: beat(0), numerator: 4, denominator: 4 }],
  },
  instrumentLanes: [
    {
      id: 'instrument-1',
      name: 'Instrument 1',
      patchSource: DEFAULT_SW_PATCH_SOURCE,
      oscillatorType: 'sawtooth',
      gain: 0.8,
      clips: [],
    },
  ],
})

export const createClip = (lane: InstrumentLane, start: Beat): SourceClip => {
  const usedIds = new Set(lane.clips.map((clip) => clip.id))
  let suffix = lane.clips.length + 1
  while (usedIds.has(`clip-${suffix}`)) suffix += 1
  return {
    id: `clip-${suffix}`,
    start,
    length: beat(4),
    source: DEFAULT_CLIP_SOURCE,
  }
}
