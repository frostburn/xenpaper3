import { compileSpreadAutomation, type SpreadAutomationPlan } from './spread-automation'
import type { DawProject, DrumkitSource, InstrumentSource } from './project'
import {
  compileEffectSettings,
  compileLaneSourceInitialization,
  compileEffectTimeline,
  type EffectSettings,
  compileSourceInitialization,
  parseLaneNotes,
  type EnvelopeSettings,
  type ScheduledLaneNote,
} from './score'
import { globalTimeSignatureChanges, TempoMap } from './timeline'
import {
  compileSignalCurves,
  signalRampValue,
  type SignalAutomationPlan,
  type SignalCurvePlan,
} from './signal-automation'

// Instrument sources contain JSON data. Read through entries so Vue proxies
// are copied as values, and freeze nested manifests as well as their settings.
const snapshotSource = <T extends InstrumentSource | DrumkitSource>(source: T): T => {
  const copy = (value: unknown): unknown => {
    if (Array.isArray(value)) return Object.freeze(value.map(copy))
    if (value && typeof value === 'object')
      return Object.freeze(
        Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)])),
      )
    return value
  }
  return copy(source) as T
}

export interface NotePlaybackWindow {
  readonly startBeat: number
  readonly endBeat: number
}

export type PitchCurvePlan = SignalCurvePlan

/** Signal values are authored, C-relative cents for note pitch automation. */
export type PitchAutomationPlan = SignalAutomationPlan

export interface PlaybackNote {
  readonly startBeat: number
  readonly endBeat: number
  /** Absolute position in the tempo-mapped project timeline, in seconds. */
  readonly when: number
  readonly duration: number
  readonly velocity: number
  readonly envelope: EnvelopeSettings
  readonly pitch: PitchAutomationPlan
  readonly sample?: string
}

interface BasePlaybackLane {
  readonly id: string
  readonly name: string
  readonly gain: number
  readonly notes: readonly PlaybackNote[]
  readonly effectBusId?: string
}

export interface PlaybackEffectLane {
  readonly id: string
  readonly name: string
  readonly patchPreset: 'ping-pong-delay'
  readonly gain: number
  readonly config: ReturnType<typeof compileEffectSettings>
  readonly automation?: Readonly<Record<keyof EffectSettings, SignalAutomationPlan>>
  readonly configChanges: readonly {
    readonly when: number
    readonly config: ReturnType<typeof compileEffectSettings>
  }[]
}

export type PlaybackLane =
  | (BasePlaybackLane & {
      readonly kind: 'instrument'
      readonly instrument: InstrumentSource
      readonly spread?: SpreadAutomationPlan
    })
  | (BasePlaybackLane & { readonly kind: 'drum'; readonly drumkit: DrumkitSource })

export interface PlaybackPlan {
  readonly startBeat: number
  readonly startTime: number
  readonly endBeat: number
  readonly endTime: number
  readonly tempoMap: TempoMap
  readonly lanes: readonly PlaybackLane[]
  readonly effects?: readonly PlaybackEffectLane[]
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
    return signalRampValue({ ...segment, start }, projectBeat)
  }
  return value
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
  return glissandoPitchAtBeat(
    note,
    tempoMap.secondsToBeat(tempoMap.beatToSeconds(startBeat) + durationSeconds * elapsedRatio),
  )
}

const compilePitchAutomation = (
  note: ScheduledLaneNote,
  tempoMap: TempoMap,
  playbackStartBeat: number,
  playbackEndBeat: number,
): PitchAutomationPlan =>
  Object.freeze({
    initialValue: glissandoPitchAtBeat(note, playbackStartBeat),
    curves: compileSignalCurves(
      (note.glissando ?? []).map((segment) => ({ ...segment, start: note.beat + segment.start })),
      tempoMap,
      playbackStartBeat,
      playbackEndBeat,
    ),
  })

const assertPlaybackStart = (fromBeat: number): void => {
  if (!Number.isFinite(fromBeat) || fromBeat < 0)
    throw new RangeError('Playback start must be a finite, non-negative beat')
}

export interface PlaybackPlanOptions {
  /** Snippets allow tempo directives in their hidden lane config and single clip. */
  readonly allowClipTempoDirective?: boolean
  /** Standalone snippets have no meter until their source explicitly declares one. */
  readonly inheritProjectTimeSignature?: boolean
}

/**
 * Compile mutable editor state into one immutable, browser-independent playback snapshot.
 *
 * Parsing, clip placement, tempo integration, resume windows, and glissando sampling all
 * happen here. The Web Audio layer only translates this plan into nodes and automation.
 */
export const createPlaybackPlan = (
  project: DawProject,
  fromBeat = 0,
  options: PlaybackPlanOptions = {},
): PlaybackPlan => {
  assertPlaybackStart(fromBeat)
  const tempoMap = TempoMap.fromProject(project)
  const timeSignature =
    options.inheritProjectTimeSignature === false
      ? undefined
      : project.globalTrack.timeSignatureChanges[0]
  const globalInitialization = compileSourceInitialization(
    project.globalTrack.source,
    {},
    true,
    timeSignature,
  )
  const timeSignatureChanges = timeSignature
    ? globalTimeSignatureChanges(project.globalTrack.source, timeSignature)
    : undefined
  let endBeat = fromBeat
  const lanes: PlaybackLane[] = []

  for (const lane of project.instrumentLanes) {
    const notes: PlaybackNote[] = []
    for (const note of parseLaneNotes(
      lane,
      globalInitialization,
      timeSignature,
      timeSignatureChanges,
      options.allowClipTempoDirective,
    )) {
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
          sample: note.sample,
        }),
      )
    }
    if (!notes.length) continue
    const common = {
      id: lane.id,
      name: lane.name,
      gain: lane.gain,
      notes: Object.freeze(notes),
      ...(lane.effectBusId === undefined ? {} : { effectBusId: lane.effectBusId }),
    }
    lanes.push(
      lane.kind === 'drum'
        ? Object.freeze({ ...common, kind: 'drum', drumkit: snapshotSource(lane.drumkit) })
        : Object.freeze({
            ...common,
            kind: 'instrument',
            instrument: snapshotSource(lane.instrument),
            ...(lane.instrument.type === 'patch' && lane.instrument.patchPreset === 'unison'
              ? {
                  spread: compileSpreadAutomation(
                    compileLaneSourceInitialization(
                      lane.source,
                      globalInitialization,
                      timeSignature,
                      options.allowClipTempoDirective,
                    ),
                    tempoMap,
                    fromBeat,
                  ),
                }
              : {}),
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
    effects: Object.freeze(
      project.effectLanes.map((effect) => {
        const effectTimeline = compileEffectTimeline(
          effect.source,
          project.globalTrack.timeSignatureChanges[0],
        )
        const { changes: timeline, ramps } = effectTimeline
        const properties = ['delayTime', 'feedback', 'wet', 'separation'] as const
        const preceding = timeline.filter(({ beat }) => beat <= fromBeat)
        const initial = { ...preceding[preceding.length - 1]!.settings }
        const automation = Object.freeze(
          Object.fromEntries(
            properties.map((property) => {
              const segments = ramps
                .filter((ramp) => ramp.from[property] !== ramp.to[property])
                .map((ramp) => ({
                  start: ramp.start,
                  duration: ramp.duration,
                  from: ramp.from[property],
                  to: ramp.to[property],
                  easing: ramp.easing,
                }))
              for (const segment of segments)
                if (fromBeat >= segment.start && fromBeat < segment.start + segment.duration)
                  initial[property] = signalRampValue(segment, fromBeat)
              return [
                property,
                Object.freeze({
                  initialValue: initial[property],
                  curves: compileSignalCurves(segments, tempoMap, fromBeat),
                }),
              ]
            }),
          ),
        ) as Readonly<Record<keyof EffectSettings, SignalAutomationPlan>>
        return Object.freeze({
          id: effect.id,
          name: effect.name,
          patchPreset: effect.patchPreset,
          gain: effect.gain,
          automation,
          config: Object.freeze({ ...initial }),
          configChanges: Object.freeze(
            timeline
              .filter(({ beat }) => beat > fromBeat)
              .map(({ beat, settings }) =>
                Object.freeze({
                  when: tempoMap.beatToSeconds(beat),
                  config: Object.freeze({ ...settings }),
                }),
              ),
          ),
        })
      }),
    ),
  })
}
