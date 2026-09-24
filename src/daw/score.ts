import {
  evaluateExpression,
  evaluateInitialization,
  expandToBeatEvents,
  parse,
  type DirectiveExtension,
  type Diagnostic,
  type Expression,
  type PitchContext,
  type ScoreInitialization,
  type BeatTimedNoteEvent,
} from '../../xenpaper-lang'
import { Fraction, type FractionValue } from 'xen-dev-utils/fraction'
import { drumNames } from '../../sw-patch'
import { parseStrudelSampleMap, strudelSampleNames, type StrudelSampleMap } from '../../sw-seq'
import DRUMKIT_PATCH_SOURCE from '../patches/drumkit.swpatch?raw'
import {
  beat,
  type Beat,
  type DawProject,
  type InstrumentLane,
  type TimeSignatureChange,
} from './project'
import { globalTimeSignatureChanges } from './timeline'

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
  /** Clip-source spans which contributed to this sounding event. */
  readonly sourceRanges: readonly SourceRange[]
}

export interface SourceRange {
  readonly start: number
  readonly end: number
}

export interface SourceLineCaret {
  /** Zero-based source line containing the authored note. */
  readonly line: number
  /** Earliest clip-relative beat contributed by that line. */
  readonly beat: number
}

/** Locate the first sounding event authored on each source line. */
export const sourceLineCarets = (
  source: string,
  notes: readonly ScheduledLaneNote[],
): SourceLineCaret[] => {
  const lineAtOffset: number[] = Array.from({ length: source.length + 1 })
  let line = 0
  for (let offset = 0; offset <= source.length; offset++) {
    lineAtOffset[offset] = line
    if (source[offset] === '\n') line++
  }

  const beats = new Map<number, number>()
  for (const note of notes) {
    for (const range of note.sourceRanges) {
      const sourceLine = lineAtOffset[Math.min(range.start, source.length)] ?? 0
      beats.set(sourceLine, Math.min(beats.get(sourceLine) ?? Infinity, note.beat))
    }
  }
  return [...beats].map(([sourceLine, beat]) => ({ line: sourceLine, beat }))
}

const eventSourceRanges = (
  event: BeatTimedNoteEvent,
  sourceIdentity: string,
): readonly SourceRange[] =>
  event.origins
    .filter(({ role, location }) => role !== 'generated' && location.source === sourceIdentity)
    .map(({ location }) => ({ start: location.start.offset, end: location.end.offset }))
    .filter(({ start, end }) => start < end)

const resolvePatchSource = (source: string): string =>
  source === 'drumkit' ? DRUMKIT_PATCH_SOURCE : source

export const sampledDrumkitManifest = (lane: InstrumentLane): StrudelSampleMap | undefined =>
  lane.kind === 'drum' && lane.drumkit.type === 'samples'
    ? parseStrudelSampleMap(lane.drumkit.strudelJson)
    : undefined

export const drumSamplesForLane = (lane: InstrumentLane): readonly string[] => {
  if (lane.kind !== 'drum') return []
  const manifest = sampledDrumkitManifest(lane)
  if (manifest) return strudelSampleNames(manifest)
  if (lane.drumkit.type !== 'patch') return []
  return drumNames(resolvePatchSource(lane.drumkit.patchPreset))
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

export type SourceInitialization = ScoreInitialization

/** Supply the DAW's envelope extension to the language-level initialization compiler. */
export const compileSourceInitialization = (
  source: string,
  parent: SourceInitialization = {},
  allowDuration = false,
  timeSignature?: { readonly numerator: number; readonly denominator: number },
): SourceInitialization => {
  const result = evaluateInitialization(parse(source), {
    initialization: parent,
    directiveExtensions: ENVELOPE_EXTENSIONS,
    allowDuration,
    allowTempoDirective: allowDuration,
    timeSignature,
  })
  const errors = result.diagnostics.filter(({ severity }) => severity === 'error')
  if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))
  return result.initialization ?? parent
}

/** Compile a lane source, whose duration-bearing score acts as that lane's timeline. */
export const compileLaneSourceInitialization = (
  source: string,
  parent: SourceInitialization = {},
  timeSignature?: { readonly numerator: number; readonly denominator: number },
): SourceInitialization => compileSourceInitialization(source, parent, true, timeSignature)

/** Convert the exact language score at the sound/preview boundary. */
const realizeClipNotes = (
  source: string,
  duration: FractionValue = Number.POSITIVE_INFINITY,
  initialization: SourceInitialization = {},
  clipOffset: Beat = beat(0),
  timeSignature?: { readonly numerator: number; readonly denominator: number },
  timeSignatureChanges?: readonly TimeSignatureChange[],
  samples: readonly string[] = [],
  placement = beat(0),
): ScheduledLaneNote[] => {
  const sourceIdentity = 'xenpaper:clip-source'
  const program = parse(source, { drumSamples: samples, grammarSource: sourceIdentity })
  const result = expandToBeatEvents(program, {
    directiveExtensions: ENVELOPE_EXTENSIONS,
    initialization,
    beatOffset: clipOffset,
    timeSignature,
    timeSignatureChanges,
  })
  const errors = result.diagnostics.filter(({ severity }) => severity === 'error')
  if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))
  if (!('score' in result)) return []

  const events = result.score.events.filter(
    (event): event is BeatTimedNoteEvent => event.kind === 'note',
  )
  const limit = duration === Infinity ? undefined : new Fraction(duration)
  return events
    .filter((event) => !limit || event.start.compare(limit) < 0)
    .map((event) => ({
      beat: placement.add(event.start).valueOf(),
      duration:
        limit && event.start.add(event.duration).compare(limit) > 0
          ? limit.sub(event.start).valueOf()
          : event.duration.valueOf(),
      cents: samples.length ? 0 : event.pitch.value.valueOf(),
      sample: samples.length ? event.label : undefined,
      velocity: event.dynamic.valueOf(),
      envelope: (event.directiveState.patch as EnvelopeSettings | undefined) ?? DEFAULT_ENVELOPE,
      sourceRanges: eventSourceRanges(event, sourceIdentity),
      glissando:
        !samples.length && event.automation
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

/** Compile one pitched clip at positions relative to its start. */
export const parseClipNotes = (
  source: string,
  duration = Infinity,
  initialization: SourceInitialization = {},
  clipOffset = beat(0),
  timeSignature?: { readonly numerator: number; readonly denominator: number },
  timeSignatureChanges?: readonly TimeSignatureChange[],
): ScheduledLaneNote[] =>
  realizeClipNotes(
    source,
    duration,
    initialization,
    clipOffset,
    timeSignature,
    timeSignatureChanges,
  )

/** Evaluate a clip for source diagnostics, retaining warnings for editor highlighting. */
export const clipSourceDiagnostics = (
  source: string,
  samples: readonly string[] = [],
  initialization: SourceInitialization = {},
  clipOffset: Beat = beat(0),
  timeSignature?: { readonly numerator: number; readonly denominator: number },
  timeSignatureChanges?: readonly TimeSignatureChange[],
  allowTempoDirective = false,
): readonly Diagnostic[] => {
  const program = parse(source, { drumSamples: samples })
  return expandToBeatEvents(program, {
    directiveExtensions: ENVELOPE_EXTENSIONS,
    initialization,
    beatOffset: clipOffset,
    timeSignature,
    timeSignatureChanges,
    allowTempoDirective,
  }).diagnostics
}

/** Compile a named-voice clip through the same grid evaluation as pitched music. */
export const parseDrumClipNotes = (
  source: string,
  samples: readonly string[],
  duration = Infinity,
  initialization: SourceInitialization = {},
  clipOffset = beat(0),
  timeSignature?: { readonly numerator: number; readonly denominator: number },
  timeSignatureChanges?: readonly TimeSignatureChange[],
): ScheduledLaneNote[] =>
  realizeClipNotes(
    source,
    duration,
    initialization,
    clipOffset,
    timeSignature,
    timeSignatureChanges,
    samples,
  )

/** Derive a clip's visual span from its score, using one bar for empty scores. */
export const sourceClipLength = (
  source: string,
  defaultBar = beat(4),
  samples: readonly string[] = [],
  initialization: SourceInitialization = {},
  timeSignature?: { readonly numerator: number; readonly denominator: number },
  clipOffset: Beat = beat(0),
  timeSignatureChanges?: readonly TimeSignatureChange[],
): Beat => {
  const program = parse(source, { drumSamples: samples })
  const result = expandToBeatEvents(program, {
    directiveExtensions: ENVELOPE_EXTENSIONS,
    initialization,
    timeSignature,
    beatOffset: clipOffset,
    timeSignatureChanges,
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
  timeSignature?: { readonly numerator: number; readonly denominator: number },
  timeSignatureChanges?: readonly TimeSignatureChange[],
): ScheduledLaneNote[] => {
  const samples = drumSamplesForLane(lane)
  const laneInitialization = compileLaneSourceInitialization(
    lane.source,
    globalInitialization,
    timeSignature,
  )
  const notes = lane.clips.flatMap((clip) =>
    realizeClipNotes(
      clip.source,
      clip.length,
      laneInitialization,
      clip.start,
      timeSignature,
      timeSignatureChanges,
      samples,
      clip.start,
    ),
  )
  return notes.sort((left, right) => left.beat - right.beat)
}

/** Compile every lane without applying any synthesizer- or tuning-reference conversion. */
export const parseProjectScoreNotes = (project: DawProject): ScheduledLaneNote[] => {
  const timeSignature = project.globalTrack.timeSignatureChanges[0]
  const globalInitialization = compileSourceInitialization(
    project.globalTrack.source,
    {},
    true,
    timeSignature,
  )
  const timeSignatureChanges = globalTimeSignatureChanges(
    project.globalTrack.source,
    timeSignature!,
  )
  return project.instrumentLanes
    .flatMap((lane) =>
      parseLaneNotes(lane, globalInitialization, timeSignature, timeSignatureChanges),
    )
    .sort((left, right) => left.beat - right.beat)
}
