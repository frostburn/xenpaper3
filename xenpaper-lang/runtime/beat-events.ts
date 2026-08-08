import { Fraction } from 'xen-dev-utils/fraction'
import type { Program } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { expandRepeats } from './repeat-expansion'
import { evaluateScoreShape, type ScoreShapeOptions } from './score-shape'
import type {
  BeatTimedEvent,
  BeatTimedNoteEvent,
  BeatTimedScore,
  ExpandedNode,
  RepeatExpansionOptions,
  ScoreShape,
} from './types'

export interface BeatEventExpansionOptions extends ScoreShapeOptions, RepeatExpansionOptions {}

export type BeatEventExpansionResult =
  | { readonly score: BeatTimedScore; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] }

export interface BeatEventFlatteningResult {
  readonly score: BeatTimedScore
  readonly diagnostics: readonly Diagnostic[]
}

const copy = (value: Fraction) => new Fraction(value.n, value.d)

/** Flatten a score-shape tree without converting its exact beat positions to seconds. */
export function flattenScoreShape(shape: ScoreShape): BeatEventFlatteningResult {
  const events: BeatTimedEvent[] = []
  const diagnostics: Diagnostic[] = []
  type MutableNoteEvent = Omit<BeatTimedNoteEvent, 'duration' | 'origins'> & {
    duration: Fraction
    origins: readonly BeatTimedNoteEvent['origins'][number][]
  }
  type State = { active: MutableNoteEvent[] }

  const visit = (current: ScoreShape, start: Fraction, state: State): Fraction => {
    if (current.kind === 'attack') {
      const event: MutableNoteEvent = {
        kind: 'note',
        start: copy(start),
        duration: copy(current.duration),
        pitch: current.pitch,
        rootStaffPosition: current.rootStaffPosition,
        label: current.soundingLabel,
        origins: current.origins,
      }
      events.push(event)
      state.active = [event]
    } else if (current.kind === 'continue') {
      if (!state.active.length) {
        diagnostics.push({
          code: 'XP_CONTINUE_WITHOUT_ATTACK',
          severity: 'error',
          message: 'A continuation requires an active note.',
          locations: current.origins.map((origin) => origin.location),
        })
      } else {
        for (const event of state.active) {
          event.duration = event.duration.add(current.duration)
          event.origins = [...event.origins, ...current.origins]
        }
      }
    } else if (current.kind === 'rest') {
      state.active = []
    } else if (current.kind === 'barline' || current.kind === 'annotation') {
      events.push({
        kind: 'marker',
        start: copy(start),
        marker: current.kind,
        label: current.kind === 'barline' ? current.style : current.text,
        origins: current.origins,
      })
    } else if (current.kind === 'sequence') {
      let cursor = start
      for (const child of current.children) cursor = visit(child, cursor, state)
      return start.add(current.duration)
    } else {
      const states = current.branches.map((): State => ({ active: [] }))
      current.branches.forEach((branch, index) => visit(branch, start, states[index]!))
      state.active = states.flatMap((branch) => branch.active)
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
  if (!body.length) return { score: { duration: new Fraction(0), events: [] }, diagnostics: expanded.diagnostics }
  const location = program.location
  const node = {
    type: 'Sequence',
    items: body,
    location,
    expansionPath: [],
  } as unknown as ExpandedNode
  const evaluated = evaluateScoreShape(node as never, options)
  const diagnostics = [...expanded.diagnostics, ...evaluated.diagnostics]
  if (!('shape' in evaluated)) return { diagnostics }
  const flattened = flattenScoreShape(evaluated.shape)
  return { score: flattened.score, diagnostics: [...diagnostics, ...flattened.diagnostics] }
}
