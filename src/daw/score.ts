import {
  evaluateExpression,
  expandToBeatEvents,
  parse,
  type DirectiveExtension,
} from '../../xenpaper-lang'
import { beat, beatToNumber, type Beat, type DawProject } from './project'

export interface EnvelopeSettings {
  readonly attack: number
  readonly decay: number
  readonly sustain: number
  readonly release: number
}

export interface ScheduledLaneNote {
  readonly beat: number
  readonly duration: number
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

/** Compile one clip into notes whose positions are relative to the clip start. */
export const parseClipNotes = (
  source: string,
  duration = Number.POSITIVE_INFINITY,
  defaultEnvelope: EnvelopeSettings = DEFAULT_ENVELOPE,
): ScheduledLaneNote[] => {
  const extension = { ...envelopeExtension, initialState: Object.freeze({ ...defaultEnvelope }) }
  const result = expandToBeatEvents(parse(source), { directiveExtensions: [extension] })
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

/** Derive a clip's visual span from its score, using one bar for empty scores. */
export const sourceClipLength = (source: string, defaultBar = beat(4)): Beat => {
  const result = expandToBeatEvents(parse(source), { directiveExtensions: [envelopeExtension] })
  if (!('score' in result) || result.diagnostics.some(({ severity }) => severity === 'error'))
    return defaultBar
  const duration = result.score.duration
  if (!duration.n) return defaultBar
  return beat(Number(duration.s * duration.n), duration.d)
}

/** Compile every clip and place its Xenpaper notes on the project timeline. */
export const parseProjectNotes = (project: DawProject): ScheduledLaneNote[] => {
  const notes = project.instrumentLanes.flatMap((lane) =>
    lane.clips.flatMap((clip) => {
      const clipStart = beatToNumber(clip.start)
      return parseClipNotes(clip.source, beatToNumber(clip.length), lane.envelope).map((event) => ({
        ...event,
        beat: clipStart + event.beat,
      }))
    }),
  )
  return notes.sort((left, right) => left.beat - right.beat)
}
