import { Fraction } from 'xen-dev-utils'
import { version } from '../../package.json'
import { APERIODIC_TIMBRES, BASIC_OSCILLATOR_TYPES, PERIODIC_TIMBRES } from '../../sw-patch'

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

export const OSCILLATOR_TYPES = [
  ...BASIC_OSCILLATOR_TYPES,
  ...PERIODIC_TIMBRES,
  ...APERIODIC_TIMBRES,
] as const
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
  format: 'xenpaper3-daw'
  version: 1
  createdAt: string
  xenpaperVersion: string
  title: string
  globalTrack: GlobalTrack
  instrumentLanes: InstrumentLane[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isString = (value: unknown): value is string => typeof value === 'string'
const isId = (value: unknown): value is string => isString(value) && !value.includes('\u0000')
const hasUniqueIds = (values: readonly unknown[]): boolean => {
  const ids = new Set<string>()
  return values.every((value) => {
    if (!isRecord(value) || !isId(value.id) || ids.has(value.id)) return false
    ids.add(value.id)
    return true
  })
}
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0
const isBeat = (value: unknown): value is Beat =>
  value instanceof Fraction && Number.isFinite(value.valueOf())
const isNonnegativeBeat = (value: unknown): value is Beat => isBeat(value) && value.valueOf() >= 0
const isPositiveBeat = (value: unknown): value is Beat => isBeat(value) && value.valueOf() > 0

export const parseDawProject = (source: string): DawProject => {
  const project: unknown = JSON.parse(source, Fraction.reviver)
  if (!isRecord(project)) throw new TypeError('Invalid Xenpaper project file')

  const globalTrack = project.globalTrack
  const validGlobalTrack =
    isRecord(globalTrack) &&
    isString(globalTrack.source) &&
    Array.isArray(globalTrack.tempoChanges) &&
    globalTrack.tempoChanges.length > 0 &&
    hasUniqueIds(globalTrack.tempoChanges) &&
    globalTrack.tempoChanges.every(
      (change) =>
        isRecord(change) &&
        isNonnegativeBeat(change.beat) &&
        isFiniteNumber(change.bpm) &&
        change.bpm > 0,
    ) &&
    Array.isArray(globalTrack.timeSignatureChanges) &&
    globalTrack.timeSignatureChanges.length > 0 &&
    hasUniqueIds(globalTrack.timeSignatureChanges) &&
    globalTrack.timeSignatureChanges.every(
      (change) =>
        isRecord(change) &&
        isNonnegativeBeat(change.beat) &&
        isPositiveInteger(change.numerator) &&
        isPositiveInteger(change.denominator),
    )

  const validInstrumentLanes =
    Array.isArray(project.instrumentLanes) &&
    hasUniqueIds(project.instrumentLanes) &&
    project.instrumentLanes.every(
      (lane) =>
        isRecord(lane) &&
        (lane.kind === undefined || lane.kind === 'instrument' || lane.kind === 'drum') &&
        isString(lane.name) &&
        isString(lane.patchSource) &&
        isString(lane.oscillatorType) &&
        OSCILLATOR_TYPES.includes(lane.oscillatorType as OscillatorType) &&
        isFiniteNumber(lane.gain) &&
        isString(lane.source) &&
        Array.isArray(lane.clips) &&
        hasUniqueIds(lane.clips) &&
        lane.clips.every(
          (clip) =>
            isRecord(clip) &&
            isNonnegativeBeat(clip.start) &&
            isPositiveBeat(clip.length) &&
            isString(clip.source),
        ),
    )

  if (
    project.format !== 'xenpaper3-daw' ||
    project.version !== 1 ||
    !isString(project.createdAt) ||
    !Number.isFinite(Date.parse(project.createdAt)) ||
    !isString(project.xenpaperVersion) ||
    !isString(project.title) ||
    !validGlobalTrack ||
    !validInstrumentLanes
  ) {
    throw new TypeError('Invalid Xenpaper project file')
  }
  return project as unknown as DawProject
}

export const serializeDawProject = (project: DawProject): string => {
  const source = `${JSON.stringify(project, null, 2)}\n`
  parseDawProject(source)
  return source
}

export const DEFAULT_CLIP_SOURCE = `# New Xenpaper clip
[0,4,7]===
`
export const DEFAULT_DRUM_CLIP_SOURCE = `# Basic 4/4 beat
[bd,hh hh] [hh hh] [sd,hh hh] [hh hh]
`
export const DEFAULT_SW_PATCH_SOURCE = 'default'
export const DEFAULT_GLOBAL_SOURCE = `# Shared tuning and score initialization (for example: {12edo})
`
export const DEFAULT_INSTRUMENT_SOURCE = `# Defaults inherited by every clip in this lane
@adsr(100ms, 200ms, 70%, 300ms)
`
export const DEFAULT_DRUM_SOURCE = `# Defaults inherited by every clip in this lane
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
    source: DEFAULT_DRUM_SOURCE,
    clips: [],
  }
}

export const createDefaultProject = (): DawProject => {
  const project: DawProject = {
    format: 'xenpaper3-daw',
    version: 1,
    createdAt: new Date().toISOString(),
    xenpaperVersion: version,
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
