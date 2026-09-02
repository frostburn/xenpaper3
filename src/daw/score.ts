import {
  evaluateExpression,
  evaluateProgramSemantics,
  expandToBeatEvents,
  parse,
  type DirectiveExtension,
  type DirectiveExtensionState,
  type Diagnostic,
  type Expression,
  type LexicalEnvironment,
  type PitchContext,
  type Program,
  type ScoreShape,
  type ScoreVisitorContext,
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

const ENVELOPE_PARAMETERS = ['attack', 'decay', 'sustain', 'release'] as const

const envelopeDiagnostic = (message: string, locations: Diagnostic['locations']): Diagnostic => ({
  code: 'XP_DIRECTIVE_EXTENSION',
  severity: 'error',
  message,
  locations,
})

const evaluateEnvelope = (
  values: readonly { name: (typeof ENVELOPE_PARAMETERS)[number]; expression: Expression }[],
  context: PitchContext,
  previousState: unknown,
) => {
  const envelope = { ...(previousState as EnvelopeSettings) }
  const diagnostics: Diagnostic[] = []
  for (const { name, expression } of values) {
    const result = evaluateExpression(expression, context)
    diagnostics.push(...result.diagnostics)
    if (!('value' in result)) continue
    if (result.value.kind !== 'scalar') {
      diagnostics.push(
        envelopeDiagnostic(`Envelope parameter ${name} must be scalar.`, [expression.location]),
      )
      continue
    }
    const dimensions = result.value.value.dimensions
    const validDimension =
      name === 'sustain' ? dimensions.isDimensionless : dimensions.equals({ seconds: 1 })
    if (!validDimension) {
      diagnostics.push(
        envelopeDiagnostic(
          `Envelope parameter ${name} must be ${name === 'sustain' ? 'dimensionless' : 'a time value'}.`,
          [expression.location],
        ),
      )
      continue
    }
    envelope[name] = result.value.value.valueOf()
  }
  return { state: Object.freeze(envelope), diagnostics }
}

const envelopeExtension: DirectiveExtension = {
  name: 'patch',
  stateKey: 'patch',
  initialState: DEFAULT_ENVELOPE,
  apply(directive, context, previousState) {
    const values = []
    for (const argument of directive.arguments) {
      if (
        argument.type !== 'NamedArgument' ||
        !ENVELOPE_PARAMETERS.some((parameter) => parameter === argument.name)
      )
        throw new Error('@patch accepts the named attack, decay, sustain, and release parameters.')
      values.push({
        name: argument.name as (typeof ENVELOPE_PARAMETERS)[number],
        expression: argument.value,
      })
    }
    return evaluateEnvelope(values, context, previousState)
  },
}

const adsrExtension: DirectiveExtension = {
  name: 'adsr',
  stateKey: 'patch',
  initialState: DEFAULT_ENVELOPE,
  apply(directive, context, previousState) {
    if (directive.arguments.length !== 4)
      throw new Error(
        '@adsr requires exactly four positional arguments: attack, decay, sustain, release.',
      )
    if (directive.arguments.some((argument) => argument.type === 'NamedArgument'))
      throw new Error('@adsr accepts positional arguments only: attack, decay, sustain, release.')
    return evaluateEnvelope(
      directive.arguments.map((expression, index) => ({
        name: ENVELOPE_PARAMETERS[index]!,
        expression,
      })),
      context,
      previousState,
    )
  },
}

const ENVELOPE_EXTENSIONS = [envelopeExtension, adsrExtension]

export interface SourceInitialization {
  readonly pitchContext?: PitchContext
  readonly directiveState?: DirectiveExtensionState
  readonly lexicalEnvironment?: LexicalEnvironment
  /** Pre-evaluated state annotations applied before a clip without reparsing initialization source. */
  readonly shape?: ScoreShape
  /** Complete visitor scope spawned into the next initialization source or clip. */
  readonly visitorContext?: ScoreVisitorContext
}

const inheritedScoreOptions = (initialization: SourceInitialization) => ({
  pitchContext: initialization.visitorContext?.pitchContext ?? initialization.pitchContext,
  pulse: initialization.visitorContext?.pulse,
  dynamic: initialization.visitorContext?.dynamic,
  articulation: initialization.visitorContext?.articulation,
  articulationMarks: initialization.visitorContext?.articulationMarks,
  directiveState: initialization.visitorContext?.directiveState ?? initialization.directiveState,
  lexicalEnvironment:
    initialization.visitorContext?.lexicalEnvironment ?? initialization.lexicalEnvironment,
})

/** Evaluate a zero-duration source once and retain its prevailing state for child scopes. */
export const compileSourceInitialization = (
  source: string,
  parent: SourceInitialization = {},
): SourceInitialization => {
  const result = evaluateProgramSemantics(parse(source), {
    directiveExtensions: ENVELOPE_EXTENSIONS,
    ...inheritedScoreOptions(parent),
  })
  const errors = result.diagnostics.filter(({ severity }) => severity === 'error')
  if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))
  if (!('shape' in result)) return parent
  if (result.shape.duration.n)
    throw new Error('Initialization sources cannot contain duration-bearing expressions.')
  return {
    pitchContext: result.pitchContext,
    directiveState: result.directiveState,
    lexicalEnvironment: result.lexicalEnvironment,
    visitorContext: result.visitorContext,
    shape: parent.shape
      ? {
          kind: 'sequence',
          duration: result.shape.duration,
          origins: [...parent.shape.origins, ...result.shape.origins],
          children: [parent.shape, result.shape],
        }
      : result.shape,
  }
}

/** Compile one clip into notes whose positions are relative to the clip start. */
export const parseClipNotes = (
  source: string,
  duration = Number.POSITIVE_INFINITY,
  initialization: SourceInitialization = {},
  clipOffset: Beat = beat(0),
): ScheduledLaneNote[] => {
  const result = expandToBeatEvents(parse(source), {
    directiveExtensions: ENVELOPE_EXTENSIONS,
    ...inheritedScoreOptions(initialization),
    initializationShape: initialization.shape,
    beatOffset: clipOffset,
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

/** Evaluate a clip for source diagnostics, retaining warnings for editor highlighting. */
export const clipSourceDiagnostics = (
  source: string,
  samples: readonly string[] = [],
  initialization: SourceInitialization = {},
  clipOffset: Beat = beat(0),
  timeSignature?: { readonly numerator: number; readonly denominator: number },
): readonly Diagnostic[] => {
  const program = samples.length
    ? lowerDrumSamples(parse(source, { drumSamples: samples }))
    : parse(source)
  return expandToBeatEvents(program, {
    directiveExtensions: ENVELOPE_EXTENSIONS,
    ...inheritedScoreOptions(initialization),
    initializationShape: initialization.shape,
    beatOffset: clipOffset,
    timeSignature,
  }).diagnostics
}

/** Compile a drum clip through the shared score runtime while retaining named voices. */
export const parseDrumClipNotes = (
  source: string,
  samples: readonly string[],
  duration = Number.POSITIVE_INFINITY,
  initialization: SourceInitialization = {},
  clipOffset: Beat = beat(0),
): ScheduledLaneNote[] => {
  const program = lowerDrumSamples(parse(source, { drumSamples: samples }))
  const result = expandToBeatEvents(program, {
    directiveExtensions: ENVELOPE_EXTENSIONS,
    ...inheritedScoreOptions(initialization),
    initializationShape: initialization.shape,
    beatOffset: clipOffset,
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
      envelope: (event.directiveState.patch as EnvelopeSettings | undefined) ?? DEFAULT_ENVELOPE,
    }))
}

/** Derive a clip's visual span from its score, using one bar for empty scores. */
export const sourceClipLength = (
  source: string,
  defaultBar = beat(4),
  samples: readonly string[] = [],
  initialization: SourceInitialization = {},
): Beat => {
  const program = samples.length
    ? lowerDrumSamples(parse(source, { drumSamples: samples }))
    : parse(source)
  const result = expandToBeatEvents(program, {
    directiveExtensions: ENVELOPE_EXTENSIONS,
    ...inheritedScoreOptions(initialization),
    initializationShape: initialization.shape,
  })
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
      ? parseDrumClipNotes(
          clip.source,
          samples,
          beatToNumber(clip.length),
          laneInitialization,
          clip.start,
        )
      : parseClipNotes(clip.source, beatToNumber(clip.length), laneInitialization, clip.start)
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
