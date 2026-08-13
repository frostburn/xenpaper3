import { Fraction } from 'xen-dev-utils/fraction'
import type { Program } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { expandRepeats } from './repeat-expansion'
import { evaluateScoreSemantics } from './score-evaluation'
import type {
  BeatTimedEvent,
  BeatTimedNoteEvent,
  BeatTimedScore,
  ExpandedNode,
  RepeatExpansionOptions,
  ScoreShape,
  ScoreShapeOptions,
} from './types'

export interface BeatEventExpansionOptions extends ScoreShapeOptions, RepeatExpansionOptions {}

export type BeatEventExpansionResult =
  | { readonly score: BeatTimedScore; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] }

interface BeatEventFlatteningResult {
  readonly score: BeatTimedScore
  readonly diagnostics: readonly Diagnostic[]
}

const copy = (value: Fraction) => new Fraction(value.n, value.d)

/** Flatten evaluated playback semantics without converting exact beat positions to seconds. */
function flattenScoreSemantics(shape: ScoreShape): BeatEventFlatteningResult {
  const events: BeatTimedEvent[] = []
  const diagnostics: Diagnostic[] = []
  type MutableNoteEvent = Omit<BeatTimedNoteEvent, 'duration' | 'origins'> & {
    duration: Fraction
    origins: readonly BeatTimedNoteEvent['origins'][number][]
  }
  type State = { active: MutableNoteEvent[]; activeSpan?: Fraction }

  const visit = (current: ScoreShape, start: Fraction, state: State): Fraction => {
    if (current.kind === 'attack') {
      const event: MutableNoteEvent = {
        kind: 'note',
        start: copy(start),
        duration: copy(current.duration),
        pitch: current.pitch,
        rootPitch: current.rootPitch,
        dynamic: copy((current as typeof current & { readonly velocity: Fraction }).velocity),
        automation: current.automation,
        label: current.authoredLabel ?? current.displayLabel,
        origins: current.origins,
      }
      events.push(event)
      state.active = [event]
      state.activeSpan = copy(current.duration)
    } else if (current.kind === 'continue') {
      if (!state.active.length) {
        diagnostics.push({
          code: 'XP_CONTINUE_WITHOUT_ATTACK',
          severity: 'error',
          message: 'A continuation requires an active note.',
          locations: current.origins.map((origin) => origin.location),
        })
      } else {
        const activeSpan = state.activeSpan ?? current.duration
        const factor = current.duration.div(activeSpan)
        for (const event of state.active) {
          event.duration = event.duration.add(event.duration.mul(factor))
          event.origins = [...event.origins, ...current.origins]
        }
        state.activeSpan = activeSpan.add(current.duration)
      }
    } else if (current.kind === 'rest') {
      state.active = []
      state.activeSpan = undefined
    } else if (
      current.kind === 'barline' ||
      current.kind === 'annotation' ||
      current.kind === 'dynamic'
    ) {
      events.push({
        kind: 'marker',
        start: copy(start),
        marker: current.kind,
        label:
          current.kind === 'barline'
            ? current.style
            : current.kind === 'dynamic'
              ? current.mark
              : current.text,
        origins: current.origins,
      })
    } else if (current.kind === 'sequence') {
      const firstEvent = events.length
      let cursor = start
      for (const child of current.children) cursor = visit(child, cursor, state)
      if (current.normalized) {
        state.active = events
          .slice(firstEvent)
          .filter((event): event is MutableNoteEvent => event.kind === 'note')
        state.activeSpan = copy(current.duration)
      }
      return start.add(current.duration)
    } else {
      const states = current.branches.map((): State => ({ active: [] }))
      current.branches.forEach((branch, index) => visit(branch, start, states[index]!))
      state.active = states.flatMap((branch) => branch.active)
      state.activeSpan = copy(current.duration)
      return start.add(current.duration)
    }
    return start.add(current.duration)
  }

  visit(shape, new Fraction(0), { active: [] })
  events.sort((left, right) => left.start.compare(right.start))
  return { score: { duration: copy(shape.duration), events }, diagnostics }
}

/** Expand repeats, evaluate score semantics, then produce exact beat-timed events. */
export function expandToBeatEvents(
  program: Program,
  options: BeatEventExpansionOptions = {},
): BeatEventExpansionResult {
  const expanded = expandRepeats(program, options)
  if (!expanded.program) return { diagnostics: expanded.diagnostics }
  const body = expanded.program.body
  if (!body.length)
    return { score: { duration: new Fraction(0), events: [] }, diagnostics: expanded.diagnostics }
  const location = program.location
  const node = {
    type: 'Sequence',
    items: body,
    location,
    expansionPath: [],
  } as unknown as ExpandedNode
  const evaluated = evaluateScoreSemantics(node as never, options)
  const diagnostics = [...expanded.diagnostics, ...evaluated.diagnostics]
  if (!('shape' in evaluated)) return { diagnostics }
  const flattened = flattenScoreSemantics(evaluated.shape)
  const allDiagnostics = [...diagnostics, ...flattened.diagnostics]
  return allDiagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { diagnostics: allDiagnostics }
    : { score: flattened.score, diagnostics: allDiagnostics }
}
