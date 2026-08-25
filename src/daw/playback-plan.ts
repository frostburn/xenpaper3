import { easeGlissando } from './easing'
import type { DawProject, OscillatorType } from './project'
import {
  parseLaneNotes,
  type EnvelopeSettings,
  type ScheduledLaneNote,
} from './score'
import { TempoMap } from './timeline'

const GLISSANDO_SAMPLES_PER_SECOND = 120

export interface NotePlaybackWindow {
  readonly startBeat: number
  readonly endBeat: number
}

export interface PitchCurvePlan {
  /** Seconds after this note becomes audible. */
  readonly offset: number
  /** Nominal musical duration; the Web Audio adapter may shorten the endpoint slightly. */
  readonly duration: number
  readonly startValue: number
  readonly values: readonly number[]
}

export interface PitchAutomationPlan {
  /** Authored, C-relative pitch held at the playback start. */
  readonly initialValue: number
  readonly curves: readonly PitchCurvePlan[]
}

export interface PlaybackNote {
  readonly startBeat: number
  readonly endBeat: number
  /** Absolute position in the tempo-mapped project timeline, in seconds. */
  readonly when: number
  readonly duration: number
  readonly velocity: number
  readonly envelope: EnvelopeSettings
  readonly pitch: PitchAutomationPlan
}

export interface PlaybackLane {
  readonly id: string
  readonly name: string
  readonly patchSource: string
  readonly oscillatorType: OscillatorType
  readonly gain: number
  readonly notes: readonly PlaybackNote[]
}

export interface PlaybackPlan {
  readonly startBeat: number
  readonly startTime: number
  readonly endBeat: number
  readonly endTime: number
  readonly tempoMap: TempoMap
  readonly lanes: readonly PlaybackLane[]
}

export function notePlaybackWindow(
  noteBeat: number,
  noteDuration: number,
  fromBeat: number,
): NotePlaybackWindow | undefined {
  const endBeat = noteBeat + noteDuration
  if (endBeat <= fromBeat) return undefined
  return { startBeat: Math.max(noteBeat, fromBeat), endBeat }
}

/** Resolve the C-relative pitch held by a note at an absolute project beat. */
export const glissandoPitchAtBeat = (note: ScheduledLaneNote, projectBeat: number): number => {
  let value = note.cents
  for (const segment of note.glissando ?? []) {
    const start = note.beat + segment.start
    const end = start + segment.duration
    if (projectBeat < start) break
    if (projectBeat >= end) {
      value = segment.to
      continue
    }
    const progress = (projectBeat - start) / segment.duration
    return segment.from + (segment.to - segment.from) * easeGlissando(segment.easing, progress)
  }
  return value
}

const glissandoPitchAtSeconds = (
  note: ScheduledLaneNote,
  tempoMap: TempoMap,
  startSeconds: number,
  durationSeconds: number,
  elapsedRatio: number,
): number => {
  const beat = tempoMap.secondsToBeat(startSeconds + durationSeconds * elapsedRatio)
  return glissandoPitchAtBeat(note, beat)
}

/** Compatibility helper for sampling a beat-defined glide uniformly in audio time. */
export const glissandoPitchAtElapsedTime = (
  note: ScheduledLaneNote,
  project: DawProject,
  startBeat: number,
  durationSeconds: number,
  elapsedRatio: number,
): number => {
  const tempoMap = TempoMap.fromProject(project)
  return glissandoPitchAtSeconds(
    note,
    tempoMap,
    tempoMap.beatToSeconds(startBeat),
    durationSeconds,
    elapsedRatio,
  )
}

const compilePitchAutomation = (
  note: ScheduledLaneNote,
  tempoMap: TempoMap,
  playbackStartBeat: number,
  playbackEndBeat: number,
): PitchAutomationPlan => {
  const curves: PitchCurvePlan[] = []
  const noteStartSeconds = tempoMap.beatToSeconds(playbackStartBeat)
  for (const segment of note.glissando ?? []) {
    if (segment.duration <= 0) continue
    const segmentStartBeat = note.beat + segment.start
    const segmentEndBeat = Math.min(segmentStartBeat + segment.duration, playbackEndBeat)
    if (segmentEndBeat <= playbackStartBeat) continue

    const audibleStartBeat = Math.max(segmentStartBeat, playbackStartBeat)
    if (segmentEndBeat <= audibleStartBeat) continue
    const audibleStartSeconds = tempoMap.beatToSeconds(audibleStartBeat)
    const duration = tempoMap.beatToSeconds(segmentEndBeat) - audibleStartSeconds
    if (duration <= 0) continue

    const progress = (audibleStartBeat - segmentStartBeat) / segment.duration
    const startValue =
      segment.from + (segment.to - segment.from) * easeGlissando(segment.easing, progress)
    const sampleCount = Math.max(2, Math.ceil(duration * GLISSANDO_SAMPLES_PER_SECOND))
    const values = Object.freeze(
      Array.from({ length: sampleCount }, (_, index) =>
        glissandoPitchAtSeconds(
          note,
          tempoMap,
          audibleStartSeconds,
          duration,
          index / (sampleCount - 1),
        ),
      ),
    )
    curves.push(
      Object.freeze({
        offset: audibleStartSeconds - noteStartSeconds,
        duration,
        startValue,
        values,
      }),
    )
  }
  return Object.freeze({
    initialValue: glissandoPitchAtBeat(note, playbackStartBeat),
    curves: Object.freeze(curves),
  })
}

const assertPlaybackStart = (fromBeat: number): void => {
  if (!Number.isFinite(fromBeat) || fromBeat < 0)
    throw new RangeError('Playback start must be a finite, non-negative beat')
}

/**
 * Compile mutable editor state into one immutable, browser-independent playback snapshot.
 *
 * Parsing, clip placement, tempo integration, resume windows, and glissando sampling all
 * happen here. The Web Audio layer only translates this plan into nodes and automation.
 */
export const createPlaybackPlan = (project: DawProject, fromBeat = 0): PlaybackPlan => {
  assertPlaybackStart(fromBeat)
  const tempoMap = TempoMap.fromProject(project)
  let endBeat = fromBeat
  const lanes: PlaybackLane[] = []

  for (const lane of project.instrumentLanes) {
    const notes: PlaybackNote[] = []
    for (const note of parseLaneNotes(lane)) {
      const window = notePlaybackWindow(note.beat, note.duration, fromBeat)
      if (!window) continue
      const when = tempoMap.beatToSeconds(window.startBeat)
      const end = tempoMap.beatToSeconds(window.endBeat)
      endBeat = Math.max(endBeat, window.endBeat)
      notes.push(
        Object.freeze({
          startBeat: window.startBeat,
          endBeat: window.endBeat,
          when,
          duration: end - when,
          velocity: note.velocity,
          envelope: Object.freeze({ ...note.envelope }),
          pitch: compilePitchAutomation(note, tempoMap, window.startBeat, window.endBeat),
        }),
      )
    }
    if (!notes.length) continue
    lanes.push(
      Object.freeze({
        id: lane.id,
        name: lane.name,
        patchSource: lane.patchSource,
        oscillatorType: lane.oscillatorType,
        gain: lane.gain,
        notes: Object.freeze(notes),
      }),
    )
  }

  return Object.freeze({
    startBeat: fromBeat,
    startTime: tempoMap.beatToSeconds(fromBeat),
    endBeat,
    endTime: tempoMap.beatToSeconds(endBeat),
    tempoMap,
    lanes: Object.freeze(lanes),
  })
}
