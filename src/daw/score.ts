import {
  compile,
  evaluateExpression,
  type Diagnostic,
  type DirectiveExtension,
  type GridPitchAutomation,
} from '../../xenpaper-lang/core'
import { monomialToCents } from '../music/pitch-projection'
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
  /** Cents are an explicit DAW projection of Xenpaper's exact monomial coordinate. */
  readonly cents: number
  readonly velocity: number
  readonly envelope: EnvelopeSettings
  readonly glissando?: readonly PitchGlideSegment[]
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

const projectAutomation = (
  automation: GridPitchAutomation | undefined,
): readonly PitchGlideSegment[] | undefined => {
  if (!automation) return undefined
  if (!automation.segments) {
    return [
      {
        start: 0,
        duration: automation.duration.valueOf(),
        from: monomialToCents(automation.from.sounding),
        to: monomialToCents(automation.to.sounding),
        easing: automation.curve,
      },
    ]
  }
  return automation.segments.map((segment) => ({
    start: segment.start.valueOf(),
    duration: segment.duration.valueOf(),
    from: monomialToCents(segment.from.sounding),
    to: monomialToCents(segment.to.sounding),
    easing: segment.curve,
  }))
}

const errorsOf = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter(({ severity }) => severity === 'error')

/** Compile one clip, then project its exact grid into the DAW's numeric display/audio model. */
export const parseClipNotes = (
  source: string,
  duration = Number.POSITIVE_INFINITY,
  defaultEnvelope: EnvelopeSettings = DEFAULT_ENVELOPE,
): ScheduledLaneNote[] => {
  const extension = { ...envelopeExtension, initialState: Object.freeze({ ...defaultEnvelope }) }
  const result = compile(source, { directiveExtensions: [extension] })
  const errors = errorsOf(result.diagnostics)
  if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))
  if (!('grid' in result)) return []

  return result.grid.events
    .filter((event) => event.kind === 'note')
    .filter((event) => event.start.valueOf() < duration)
    .map((event) => ({
      beat: event.start.valueOf(),
      duration: Math.min(event.duration.valueOf(), duration - event.start.valueOf()),
      cents: monomialToCents(event.pitch.sounding),
      velocity: event.dynamic.valueOf(),
      envelope: (event.extensions.patch as EnvelopeSettings | undefined) ?? DEFAULT_ENVELOPE,
      glissando: projectAutomation(event.automation),
    }))
}

/** Derive a clip's visual span from its exact score grid, using one bar for invalid/empty source. */
export const sourceClipLength = (source: string, defaultBar = beat(4)): Beat => {
  const result = compile(source, { directiveExtensions: [envelopeExtension] })
  if (!('grid' in result) || errorsOf(result.diagnostics).length) return defaultBar
  const duration = result.grid.span
  if (!duration.n) return defaultBar
  return beat(Number(duration.s * duration.n), duration.d)
}

/** Compile a lane once and place its C-relative Xenpaper notes on the project timeline. */
export const parseLaneNotes = (lane: InstrumentLane): ScheduledLaneNote[] => {
  const notes = lane.clips.flatMap((clip) => {
    const clipStart = beatToNumber(clip.start)
    return parseClipNotes(clip.source, beatToNumber(clip.length), lane.envelope).map((event) => ({
      ...event,
      beat: clipStart + event.beat,
    }))
  })
  return notes.sort((left, right) => left.beat - right.beat)
}

/** Compile every lane without applying any synthesizer- or tuning-reference conversion. */
export const parseProjectScoreNotes = (project: DawProject): ScheduledLaneNote[] =>
  project.instrumentLanes.flatMap(parseLaneNotes).sort((left, right) => left.beat - right.beat)
