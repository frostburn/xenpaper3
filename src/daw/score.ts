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

export interface EffectSettings {
  readonly delayTime: number
  readonly feedback: number
  readonly wet: number
  readonly separation: number
}

export interface EffectRamp {
  readonly start: number
  readonly duration: number
  readonly easing: string
  readonly from: EffectSettings
  readonly to: EffectSettings
}

export interface TimedEffectSettings {
  readonly beat: number
  readonly settings: EffectSettings
}

export const DEFAULT_EFFECT_SETTINGS: EffectSettings = Object.freeze({
  delayTime: 0.25,
  feedback: 0.55,
  wet: 0.35,
  separation: 1,
})

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

export interface SpreadSettings {
  readonly value: number
}
export const DEFAULT_SPREAD: SpreadSettings = Object.freeze({ value: 20 })
const spreadExtension: DirectiveExtension = {
  name: 'spread',
  stateKey: 'spread',
  initialState: DEFAULT_SPREAD,
  apply(directive, context) {
    if (directive.arguments.length !== 1 || directive.arguments[0]?.type === 'NamedArgument')
      throw new Error('@spread requires exactly one cent value.')
    const result = evaluateExpression(directive.arguments[0] as Expression, context)
    if (
      !('value' in result) ||
      result.value.kind !== 'pitchOffset' ||
      !result.value.value.dimensions.equals({ pitch: 1 })
    )
      throw new Error('@spread requires a cent value.')
    const value = Number(result.value.value)
    if (!Number.isFinite(value) || value < 0)
      throw new Error('@spread must be finite and non-negative.')
    return { state: Object.freeze({ value }) }
  },
}
export const ENVELOPE_EXTENSIONS = [envelopeExtension, adsrExtension, spreadExtension]

const effectExtension = (
  name: 'delay' | 'feedback' | 'wet' | 'separation',
  property: keyof EffectSettings,
): DirectiveExtension => ({
  name,
  stateKey: 'effect',
  initialState: DEFAULT_EFFECT_SETTINGS,
  apply(directive, context, previousState) {
    if (directive.arguments.length !== 1 || directive.arguments[0]?.type === 'NamedArgument')
      throw new Error(`@${name} requires exactly one positional argument.`)
    const expression = directive.arguments[0] as Expression
    const result = evaluateExpression(expression, context)
    if (!('value' in result) || result.value.kind !== 'scalar')
      throw new Error(`@${name} requires a scalar value.`)
    const value = result.value.value
    const validDimension =
      property === 'delayTime'
        ? value.dimensions.equals({ seconds: 1 })
        : value.dimensions.isDimensionless
    if (!validDimension)
      throw new Error(
        `@${name} requires ${property === 'delayTime' ? 'a time value' : 'a dimensionless level'}.`,
      )
    const numeric = value.valueOf()
    if (!Number.isFinite(numeric) || numeric < 0 || (property !== 'delayTime' && numeric > 1))
      throw new Error(
        `@${name} must be ${property === 'delayTime' ? 'non-negative' : 'between 0% and 100%'}.`,
      )
    return {
      state: Object.freeze({ ...(previousState as EffectSettings), [property]: numeric }),
      diagnostics: result.diagnostics,
    }
  },
})

const EFFECT_EXTENSIONS = [
  effectExtension('delay', 'delayTime'),
  effectExtension('feedback', 'feedback'),
  effectExtension('wet', 'wet'),
  effectExtension('separation', 'separation'),
]

/** Compile the control directives supported by the ping-pong delay effect lane. */
export const compileEffectTimeline = (
  source: string,
  timeSignature = { numerator: 4, denominator: 4 },
): { readonly changes: readonly TimedEffectSettings[]; readonly ramps: readonly EffectRamp[] } => {
  const result = evaluateInitialization(parse(source), {
    directiveExtensions: EFFECT_EXTENSIONS,
    allowDuration: true,
    timeSignature,
  })
  const errors = result.diagnostics.filter(({ severity }) => severity === 'error')
  if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))
  const timeline = [{ beat: 0, settings: DEFAULT_EFFECT_SETTINGS }]
  const changes = result.initialization?.changes ?? []
  if (!changes.length) {
    const settings = result.initialization?.context?.directiveState.effect as
      | EffectSettings
      | undefined
    if (settings) timeline.push({ beat: 0, settings })
  }
  for (const change of changes) {
    const settings = change.context.directiveState.effect as EffectSettings | undefined
    if (settings) timeline.push({ beat: change.start.valueOf(), settings })
  }
  const signalRamps = (result.initialization?.directiveRamps ?? [])
    .filter(({ stateKey }) => stateKey === 'effect')
    .sort((left, right) => left.start.compare(right.start))
  const ends = new Map<string, Fraction>()
  for (const ramp of signalRamps) {
    const previousEnd = ends.get(ramp.directiveName)
    if (previousEnd && ramp.start.compare(previousEnd) < 0)
      throw new Error(`Overlapping @ramp segments for @${ramp.directiveName} are not supported.`)
    ends.set(ramp.directiveName, ramp.start.add(ramp.duration))
  }
  const ramps = signalRamps.map((ramp) => {
    if (ramp.duration.compare(0) <= 0)
      throw new Error('@ramp requires a positive duration between signal directives.')
    const property =
      ramp.directiveName === 'delay' ? 'delayTime' : (ramp.directiveName as keyof EffectSettings)
    const from = ramp.from as EffectSettings
    const target = ramp.to as EffectSettings
    return Object.freeze({
      start: ramp.start.valueOf(),
      duration: ramp.duration.valueOf(),
      easing: ramp.curve,
      from,
      to: Object.freeze({ ...from, [property]: target[property] }),
    })
  })
  return Object.freeze({
    changes: Object.freeze(timeline.map((change) => Object.freeze(change))),
    ramps: Object.freeze(ramps),
  })
}

/** Compile discrete effect settings, preserving the existing timeline API. */
export const compileEffectSettingsTimeline = (
  source: string,
  timeSignature = { numerator: 4, denominator: 4 },
): readonly TimedEffectSettings[] => compileEffectTimeline(source, timeSignature).changes

/** Compile the settings prevailing at the end of an effect source. */
export const compileEffectSettings = (
  source: string,
  timeSignature = { numerator: 4, denominator: 4 },
): EffectSettings => {
  const timeline = compileEffectSettingsTimeline(source, timeSignature)
  return timeline[timeline.length - 1]!.settings
}

export type SourceInitialization = ScoreInitialization

/** Supply the DAW's envelope extension to the language-level initialization compiler. */
export const compileSourceInitialization = (
  source: string,
  parent: SourceInitialization = {},
  allowDuration = false,
  timeSignature?: { readonly numerator: number; readonly denominator: number },
  allowTempoDirective = allowDuration,
): SourceInitialization => {
  const result = evaluateInitialization(parse(source), {
    initialization: parent,
    directiveExtensions: ENVELOPE_EXTENSIONS,
    allowDuration,
    allowTempoDirective,
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
): SourceInitialization => compileSourceInitialization(source, parent, true, timeSignature, false)

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
  allowTempoDirective = false,
): ScheduledLaneNote[] => {
  const sourceIdentity = 'xenpaper:clip-source'
  const program = parse(source, { drumSamples: samples, grammarSource: sourceIdentity })
  const result = expandToBeatEvents(program, {
    directiveExtensions: ENVELOPE_EXTENSIONS,
    initialization,
    beatOffset: clipOffset,
    timeSignature,
    timeSignatureChanges,
    allowTempoDirective,
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
  allowTempoDirective = false,
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
      allowTempoDirective,
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
