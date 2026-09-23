import { Fraction } from 'xen-dev-utils/fraction'
import type { Program } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { evaluateProgramSemantics } from './score-shape'
import type {
  ScoreInitialization,
  ScoreShape,
  ScoreShapeOptions,
  ScoreVisitorContext,
  TimedScoreContext,
} from './types'

export function contextAt(initialization: ScoreInitialization | undefined, start: Fraction) {
  const changes = initialization?.changes ?? []
  let low = 0,
    high = changes.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (changes[middle]!.start.compare(start) <= 0) low = middle + 1
    else high = middle
  }
  return changes[low - 1]?.context ?? initialization?.context
}

/** Collect exact grid positions, restoring state when explicit scopes end. */
function timelineContexts(shape: ScoreShape, base: ScoreVisitorContext): TimedScoreContext[] {
  const changes: TimedScoreContext[] = []
  const visit = (
    current: ScoreShape,
    start: Fraction,
    context: ScoreVisitorContext,
  ): ScoreVisitorContext => {
    let active = current.visitorContextChange ?? context
    if (current.visitorContextChange) changes.push({ start, context: active })
    if (current.kind === 'sequence') {
      let cursor = start
      for (const child of current.children) {
        active = visit(child, cursor, active)
        cursor = cursor.add(child.duration)
      }
    } else if (current.kind === 'parallel') {
      for (const branch of current.branches) {
        visit({ ...branch, isolatedDirectiveScope: true }, start, active)
      }
    }
    if (current.isolatedDirectiveScope && active !== context) {
      changes.push({ start: start.add(current.duration), context })
      return context
    }
    return active
  }
  visit(shape, new Fraction(0), base)
  return [
    ...new Map(
      changes
        .sort((left, right) => left.start.compare(right.start))
        .map((change) => [change.start.toFraction(), change]),
    ).values(),
  ]
}

function containsAttack(shape: ScoreShape): boolean {
  return (
    shape.kind === 'attack' ||
    (shape.kind === 'sequence' && shape.children.some(containsAttack)) ||
    (shape.kind === 'parallel' && shape.branches.some(containsAttack))
  )
}

/** Compile a global timeline or a zero-duration enclosing source without any audio concepts. */
export function evaluateInitialization(
  program: Program,
  options: ScoreShapeOptions & { readonly allowDuration?: boolean } = {},
): { readonly initialization?: ScoreInitialization; readonly diagnostics: readonly Diagnostic[] } {
  const { initialization: parent = {}, allowDuration = false, ...settings } = options
  if (settings.timeSignature)
    settings.timeSignature = {
      ...settings.timeSignature,
      origin: settings.timeSignature.origin ?? new Fraction(0),
    }
  const diagnostics: Diagnostic[] = []
  const evaluate = (context?: ScoreVisitorContext) => {
    const result = evaluateProgramSemantics(program, { ...settings, ...context })
    diagnostics.push(...result.diagnostics)
    if (!('shape' in result)) return undefined
    const message = containsAttack(result.shape)
      ? 'Initialization sources cannot contain pitch-bearing expressions.'
      : result.shape.duration.n && !allowDuration
        ? 'Initialization sources cannot contain duration-bearing expressions.'
        : undefined
    if (message)
      diagnostics.push({
        code: 'XP_INITIALIZATION',
        severity: 'error',
        message,
        locations: [program.location],
      })
    return result
  }
  const result = evaluate(contextAt(parent, new Fraction(0)))
  if (!result) return { diagnostics }
  let initialization: ScoreInitialization
  if (result.shape.duration.n) {
    const base = evaluateProgramSemantics(
      { ...program, body: [] },
      { ...settings, ...parent.context },
    )
    if (!('shape' in base) || !base.visitorContext) return { diagnostics }
    initialization = {
      context: base.visitorContext,
      changes: timelineContexts(result.shape, base.visitorContext),
      timelineShape: result.shape,
      shape: parent.shape,
    }
  } else {
    const changes = parent.changes?.map(({ start, context }) => ({
      start,
      context: evaluate(context)?.visitorContext ?? context,
    }))
    initialization = {
      context: result.visitorContext,
      changes,
      timelineShape: parent.timelineShape,
      shape: parent.shape
        ? {
            kind: 'sequence',
            duration: new Fraction(0),
            origins: [],
            children: [parent.shape, result.shape],
          }
        : result.shape,
    }
  }
  return diagnostics.some(({ severity }) => severity === 'error')
    ? { diagnostics }
    : { initialization, diagnostics }
}
