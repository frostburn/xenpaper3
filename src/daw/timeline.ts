import { expandToBeatEvents, parse } from '../../xenpaper-lang'
import {
  beatToNumber,
  type DawProject,
  type TempoChange,
  type TimeSignatureChange,
} from './project'

const DEFAULT_BPM = 120

export interface TempoPoint {
  readonly beat: number
  readonly seconds: number
  readonly bpm: number
}

const assertFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`)
}

const lastPointAtOrBefore = (
  points: readonly TempoPoint[],
  target: number,
  coordinate: 'beat' | 'seconds',
): TempoPoint => {
  let low = 0
  let high = points.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle]![coordinate] <= target) low = middle + 1
    else high = middle
  }
  return points[Math.max(0, low - 1)]!
}

const normalizeTempoChanges = (
  changes: readonly TempoChange[],
): Array<{ beat: number; bpm: number }> => {
  const byBeat = new Map<number, number>()
  for (const change of changes) {
    const changeBeat = beatToNumber(change.beat)
    if (!Number.isFinite(changeBeat) || changeBeat < 0) continue
    if (!Number.isFinite(change.bpm) || change.bpm <= 0) continue
    byBeat.set(changeBeat, change.bpm)
  }
  if (!byBeat.has(0)) byBeat.set(0, DEFAULT_BPM)
  return [...byBeat]
    .map(([beat, bpm]) => ({ beat, bpm }))
    .sort((left, right) => left.beat - right.beat)
}

/**
 * Immutable, pre-integrated snapshot of a project's piecewise-constant tempo map.
 *
 * Playback and visualisation can share one instance without repeatedly sorting the
 * project or observing tempo edits halfway through an already scheduled session.
 */
export class TempoMap {
  readonly points: readonly TempoPoint[]

  constructor(changes: readonly TempoChange[]) {
    const points: TempoPoint[] = []
    let seconds = 0
    let previousBeat = 0
    let previousBpm = DEFAULT_BPM
    for (const point of normalizeTempoChanges(changes)) {
      seconds += ((point.beat - previousBeat) * 60) / previousBpm
      points.push(Object.freeze({ ...point, seconds }))
      previousBeat = point.beat
      previousBpm = point.bpm
    }
    this.points = Object.freeze(points)
    Object.freeze(this)
  }

  static fromProject(project: DawProject): TempoMap {
    return new TempoMap(
      globalTempoChanges(
        project.globalTrack.source,
        project.globalTrack.tempoChanges,
        project.globalTrack.timeSignatureChanges[0],
      ),
    )
  }

  /** Integrate the tempo map from beat zero, extrapolating backwards at the initial tempo. */
  beatToSeconds(targetBeat: number): number {
    assertFinite(targetBeat, 'Target beat')
    const point = lastPointAtOrBefore(this.points, targetBeat, 'beat')
    return point.seconds + ((targetBeat - point.beat) * 60) / point.bpm
  }

  /** Invert the tempo map, extrapolating backwards at the initial tempo. */
  secondsToBeat(targetSeconds: number): number {
    assertFinite(targetSeconds, 'Target seconds')
    const point = lastPointAtOrBefore(this.points, targetSeconds, 'seconds')
    return point.beat + ((targetSeconds - point.seconds) * point.bpm) / 60
  }
}

export const createTempoMap = (project: DawProject): TempoMap => TempoMap.fromProject(project)

/** Compatibility helper for callers that do not need to retain a tempo-map snapshot. */
export const projectBeatToSeconds = (project: DawProject, targetBeat: number): number =>
  TempoMap.fromProject(project).beatToSeconds(targetBeat)

/** Compatibility helper for callers that do not need to retain a tempo-map snapshot. */
export const projectSecondsToBeat = (project: DawProject, seconds: number): number =>
  TempoMap.fromProject(project).secondsToBeat(seconds)

/**
 * Interpret the duration-bearing global source as a meter timeline. The time signature
 * selected in the project UI prevails until the source reaches an authored @time directive.
 */
export const globalTimeSignatureChanges = (
  source: string,
  initial: TimeSignatureChange,
): TimeSignatureChange[] => {
  let result
  try {
    result = expandToBeatEvents(parse(source), {
      timeSignature: initial,
      allowTempoDirective: true,
    })
  } catch {
    return [initial]
  }
  if (!('score' in result) || result.diagnostics.some(({ severity }) => severity === 'error')) {
    return [initial]
  }

  const byBeat = new Map<number, TimeSignatureChange>([[beatToNumber(initial.beat), initial]])
  let index = 0
  for (const event of result.score.events) {
    if (event.kind !== 'marker' || event.marker !== 'time-signature') continue
    const [numerator, denominator] = event.label.split('/').map(Number)
    if (!numerator || !denominator) continue
    const position = event.start.valueOf()
    byBeat.set(position, {
      id: `global-source-time-${index++}`,
      beat: event.start,
      numerator,
      denominator,
    })
  }
  return [...byBeat.values()].sort(
    (left, right) => beatToNumber(left.beat) - beatToNumber(right.beat),
  )
}

/** Interpret tempo directives in the duration-bearing DAW global source. */
export const globalTempoChanges = (
  source: string,
  initial: readonly TempoChange[],
  timeSignature: { readonly numerator: number; readonly denominator: number } = {
    numerator: 4,
    denominator: 4,
  },
): TempoChange[] => {
  let result
  try {
    result = expandToBeatEvents(parse(source), {
      allowTempoDirective: true,
      timeSignature,
    })
  } catch {
    return [...initial]
  }
  if (!('score' in result) || result.diagnostics.some(({ severity }) => severity === 'error')) {
    return [...initial]
  }

  const byBeat = new Map<number, TempoChange>(
    initial.map((change) => [beatToNumber(change.beat), change]),
  )
  let index = 0
  for (const event of result.score.events) {
    if (event.kind !== 'marker' || event.marker !== 'tempo') continue
    const bpm = Number(event.label)
    if (!Number.isFinite(bpm) || bpm <= 0) continue
    const position = event.start.valueOf()
    byBeat.set(position, {
      id: `global-source-tempo-${index++}`,
      beat: event.start,
      bpm,
    })
  }
  return [...byBeat.values()].sort(
    (left, right) => beatToNumber(left.beat) - beatToNumber(right.beat),
  )
}

/** Return every measure boundary in a meter timeline up to the requested beat. */
export const measureBoundaries = (
  changes: readonly TimeSignatureChange[],
  endBeat: number,
): number[] => {
  const result = new Set<number>()
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]!
    const start = beatToNumber(change.beat)
    const end = Math.min(
      endBeat,
      changes[index + 1] ? beatToNumber(changes[index + 1]!.beat) : endBeat,
    )
    const length = (change.numerator * 4) / change.denominator
    if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) continue
    for (let beat = start; beat <= end + Number.EPSILON; beat += length) result.add(beat)
  }
  return [...result].filter((beat) => beat <= endBeat).sort((left, right) => left - right)
}
