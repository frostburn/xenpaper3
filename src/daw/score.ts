import {
  evaluateExpression,
  evaluateProgramShape,
  expandToBeatEvents,
  parse,
  type DirectiveExtension,
  type DirectiveExtensionState,
  type PitchContext,
  type Program,
  type BeatTimedNoteEvent,
} from '../../xenpaper-lang'
import { drumNames } from '../../sw-patch'
import DRUMKIT_PATCH_SOURCE from '../patches/drumkit.swpatch?raw'
import { beat, beatToNumber, type Beat, type DawProject, type InstrumentLane } from './project'

export interface EnvelopeSettings {
  readonly attack: number
  readonly decay: number
  readonly sustain: number
  readonly release: number
}

export interface ScheduledLaneNote {
  readonly beat: number
  readonly duration: number
  /** Authored pitch in cents relative to Xenpaper's C reference. */
  readonly cents: number
  /** Named SW Patch voice for a drum event; absent for pitched notes. */
  readonly sample?: string
  readonly velocity: number
  readonly envelope: EnvelopeSettings
  readonly glissando?: readonly PitchGlideSegment[]
}

const resolvePatchSource = (source: string): string =>
  source === 'drumkit' ? DRUMKIT_PATCH_SOURCE : source

export const drumSamplesForLane = (lane: InstrumentLane): readonly string[] =>
  lane.kind === 'drum' ? drumNames(resolvePatchSource(lane.patchSource)) : []

const lowerDrumSamples = (program: Program): Program => {
  const lower = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(lower)
    if (!value || typeof value !== 'object') return value
    const node = value as Record<string, unknown>
    if (node.type === 'DrumSampleLiteral') {
      return {
        type: 'DegreeLiteral',
        modifiers: [],
        degree: '0',
        raw: node.sample,
        location: node.location,
      }
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, lower(child)]))
  }
  return lower(program) as Program
}

export interface PitchGlideSegment {
  readonly start: number
  readonly duration: number
  readonly from: number
  readonly to: number
  readonly easing: string
}

const DEFAULT_ENVELOPE: EnvelopeSettings = Object.freeze({
  attack: 0.1,
  decay: 0.2,
  sustain: 0.7,
  release: 0.3,
})

const envelopeExtension: DirectiveExtension = {
  name: 'patch',
  initialState: DEFAULT_ENVELOPE,
  apply(directive, context, previousState) {
    const envelope = { ...(previousState as EnvelopeSettings) }
    const diagnostics = []
    for (const argument of directive.arguments) {
      if (argument.type !== 'NamedArgument' || !(argument.name in envelope))
        throw new Error('@patch accepts the named attack, decay, sustain, and release parameters.')
      const result = evaluateExpression(argument.value, context)
      diagnostics.push(...result.diagnostics)
      if (!('value' in result) || result.value.kind !== 'scalar')
        throw new Error(`Patch parameter ${argument.name} must be scalar.`)
      envelope[argument.name as keyof EnvelopeSettings] = result.value.value.valueOf()
    }
    return { state: Object.freeze(envelope), diagnostics }
  },
}

export interface SourceInitialization {
  readonly pitchContext?: PitchContext
  readonly directiveState?: DirectiveExtensionState
  /** Zero-duration source layers replayed before a clip to preserve built-in directive scope. */
  readonly sources?: readonly string[]
}

/** Evaluate a zero-duration source once and retain its prevailing state for child scopes. */
export const compileSourceInitialization = (
  source: string,
  parent: SourceInitialization = {},
): SourceInitialization => {
  const result = evaluateProgramShape(parse(source), {
    directiveExtensions: [envelopeExtension],
    pitchContext: parent.pitchContext,
    directiveState: parent.directiveState,
  })
  const errors = result.diagnostics.filter(({ severity }) => severity === 'error')
  if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))
  if (!('shape' in result)) return parent
  if (result.shape.duration.n)
    throw new Error('Initialization sources cannot contain duration-bearing expressions.')
  return {
    pitchContext: result.pitchContext,
    directiveState: result.directiveState,
    sources: Object.freeze([...(parent.sources ?? []), source]),
  }
}

const initializedProgram = (source: string, initialization: SourceInitialization): Program =>
  parse([...(initialization.sources ?? []), source].join('\n'))

/** Compile one clip into notes whose positions are relative to the clip start. */
export const parseClipNotes = (
  source: string,
  duration = Number.POSITIVE_INFINITY,
  initialization: SourceInitialization = {},
): ScheduledLaneNote[] => {
  const hasSourceLayers = Boolean(initialization.sources?.length)
  const result = expandToBeatEvents(initializedProgram(source, initialization), {
    directiveExtensions: [envelopeExtension],
    pitchContext: hasSourceLayers ? undefined : initialization.pitchContext,
    directiveState: hasSourceLayers ? undefined : initialization.directiveState,
  })
  const errors = result.diagnostics.filter(({ severity }) => severity === 'error')
  if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))
  if (!('score' in result)) return []

  return result.score.events
    .filter((event) => event.kind === 'note')
    .filter((event) => event.start.valueOf() < duration)
    .map((event) => ({
      beat: event.start.valueOf(),
      duration: Math.min(event.duration.valueOf(), duration - event.start.valueOf()),
      cents: event.pitch.value.valueOf(),
      velocity: event.dynamic.valueOf(),
      envelope: (event.directiveState.patch as EnvelopeSettings | undefined) ?? DEFAULT_ENVELOPE,
      glissando: event.automation
        ? (
            event.automation.segments ?? [
              {
                ...event.automation,
                start: { valueOf: () => 0 },
              },
            ]
          ).map((segment) => ({
            start: segment.start.valueOf(),
            duration: segment.duration.valueOf(),
            from: segment.from.value.valueOf(),
            to: segment.to.value.valueOf(),
            easing: segment.curve,
          }))
        : undefined,
    }))
}

/** Compile a drum clip through the shared score runtime while retaining named voices. */
export const parseDrumClipNotes = (
  source: string,
  samples: readonly string[],
  duration = Number.POSITIVE_INFINITY,
  initialization: SourceInitialization = {},
): ScheduledLaneNote[] => {
  const program = lowerDrumSamples(
    parse([...(initialization.sources ?? []), source].join('\n'), { drumSamples: samples }),
  )
  const hasSourceLayers = Boolean(initialization.sources?.length)
  const result = expandToBeatEvents(program, {
    directiveExtensions: [envelopeExtension],
    pitchContext: hasSourceLayers ? undefined : initialization.pitchContext,
    directiveState: hasSourceLayers ? undefined : initialization.directiveState,
  })
  const errors = result.diagnostics.filter(({ severity }) => severity === 'error')
  if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))
  if (!('score' in result)) return []
  return result.score.events
    .filter(
      (event): event is BeatTimedNoteEvent =>
        event.kind === 'note' && event.start.valueOf() < duration,
    )
    .map((event) => ({
      beat: event.start.valueOf(),
      duration: Math.min(event.duration.valueOf(), duration - event.start.valueOf()),
      cents: 0,
      sample: event.label,
      velocity: event.dynamic.valueOf(),
      envelope: DEFAULT_ENVELOPE,
    }))
}

/** Derive a clip's visual span from its score, using one bar for empty scores. */
export const sourceClipLength = (
  source: string,
  defaultBar = beat(4),
  samples: readonly string[] = [],
): Beat => {
  const program = samples.length
    ? lowerDrumSamples(parse(source, { drumSamples: samples }))
    : parse(source)
  const result = expandToBeatEvents(program, { directiveExtensions: [envelopeExtension] })
  if (!('score' in result) || result.diagnostics.some(({ severity }) => severity === 'error'))
    return defaultBar
  const duration = result.score.duration
  if (!duration.n) return defaultBar
  return duration
}

/** Compile a lane once and place its C-relative Xenpaper notes on the project timeline. */
export const parseLaneNotes = (
  lane: InstrumentLane,
  globalInitialization: SourceInitialization = {},
): ScheduledLaneNote[] => {
  const samples = drumSamplesForLane(lane)
  const laneInitialization = compileSourceInitialization(lane.source, globalInitialization)
  const notes = lane.clips.flatMap((clip) => {
    const clipStart = beatToNumber(clip.start)
    const clipNotes = samples.length
      ? parseDrumClipNotes(clip.source, samples, beatToNumber(clip.length), laneInitialization)
      : parseClipNotes(clip.source, beatToNumber(clip.length), laneInitialization)
    return clipNotes.map((event) => ({ ...event, beat: clipStart + event.beat }))
  })
  return notes.sort((left, right) => left.beat - right.beat)
}

/** Compile every lane without applying any synthesizer- or tuning-reference conversion. */
export const parseProjectScoreNotes = (project: DawProject): ScheduledLaneNote[] => {
  const globalInitialization = compileSourceInitialization(project.globalTrack.source)
  return project.instrumentLanes
    .flatMap((lane) => parseLaneNotes(lane, globalInitialization))
    .sort((left, right) => left.beat - right.beat)
}
