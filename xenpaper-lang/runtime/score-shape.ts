import { Fraction, type FractionValue } from 'xen-dev-utils/fraction'
import type { Expression } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import { evaluateExpression } from './expressions'
import { DEFAULT_PITCH_CONTEXT, applyPitchContextChange } from './pitches'
import type {
  AttackShape,
  ContinueShape,
  ParallelShape,
  PitchOffsetValue,
  RestShape,
  ScoreShape,
  SequenceShape,
  SourceOrigin,
  PitchContext,
} from './types'

export interface ScoreShapeOptions {
  readonly pulse?: FractionValue
  readonly pitchContext?: PitchContext
}

export type ScoreShapeEvaluationResult =
  | { readonly shape: ScoreShape; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] }

function hasShape(
  result: ScoreShapeEvaluationResult,
): result is { readonly shape: ScoreShape; readonly diagnostics: readonly Diagnostic[] } {
  return 'shape' in result
}

function origin(node: Expression, role: SourceOrigin['role'] = 'structural'): SourceOrigin {
  return { location: node.location, role }
}

function sequence(children: readonly ScoreShape[], origins: readonly SourceOrigin[]): SequenceShape {
  return {
    kind: 'sequence',
    children,
    duration: children.reduce((duration, child) => duration.add(child.duration), new Fraction(0)),
    origins,
  }
}

function generatedRest(duration: Fraction): RestShape {
  return { kind: 'rest', duration, generated: true, origins: [] }
}

function pad(shape: ScoreShape, duration: Fraction): ScoreShape {
  const missing = duration.sub(shape.duration)
  if (!missing.n) return shape
  return sequence([shape, generatedRest(missing)], shape.origins)
}

function scaleShape(shape: ScoreShape, factor: Fraction): ScoreShape {
  const duration = shape.duration.mul(factor)
  switch (shape.kind) {
    case 'attack':
    case 'rest':
    case 'continue':
      return { ...shape, duration }
    case 'sequence':
      return { ...shape, duration, children: shape.children.map((child) => scaleShape(child, factor)) }
    case 'parallel':
      return { ...shape, duration, branches: shape.branches.map((branch) => scaleShape(branch, factor)) }
  }
}

function playablePitch(node: Expression, context: PitchContext):
  | { readonly pitch: PitchOffsetValue; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] } {
  const evaluated = evaluateExpression(node, context)
  if (!('value' in evaluated)) return evaluated
  if (evaluated.value.kind === 'pitchOffset') {
    return { pitch: evaluated.value, diagnostics: evaluated.diagnostics }
  }
  if (evaluated.value.kind === 'absolutePitch') {
    return {
      pitch: { kind: 'pitchOffset', value: evaluated.value.rootOffset, formula: evaluated.value.formula, origins: evaluated.value.origins },
      diagnostics: evaluated.diagnostics,
    }
  }
  const ratio = evaluated.value.value.exactRational()
  if (!ratio || ratio.compare(0) <= 0) {
    return {
      diagnostics: [
        ...evaluated.diagnostics,
        {
          code: 'XP_TYPE_MISMATCH',
          severity: 'error',
          message: 'A score atom must be a pitch offset or positive exact ratio.',
          locations: [node.location],
        },
      ],
    }
  }
  return {
    pitch: { kind: 'pitchOffset', value: Value.pitch(evaluated.value.value), origins: evaluated.value.origins },
    diagnostics: evaluated.diagnostics,
  }
}

/** Build the exact-duration score-shape tree for sequencing, parallelism, and slots. */
export function evaluateScoreShape(
  node: Expression,
  options: ScoreShapeOptions = {},
): ScoreShapeEvaluationResult {
  const pulse = new Fraction(options.pulse ?? 1)
  if (pulse.compare(0) <= 0) throw new RangeError('pulse must be positive.')

  const visit = (current: Expression, context: PitchContext): ScoreShapeEvaluationResult => {
    if (current.type === 'Rest') {
      return {
        shape: { kind: 'rest', duration: pulse, generated: false, origins: [origin(current)] },
        diagnostics: [],
      }
    }
    if (current.type === 'DetachedContinue') {
      const shape: ContinueShape = {
        kind: 'continue',
        duration: pulse,
        origins: [origin(current, 'duration')],
      }
      return { shape, diagnostics: [] }
    }
    if (current.type === 'Sequence') {
      let activeContext = context
      const results: ScoreShapeEvaluationResult[] = []
      for (const item of current.items) {
        if (item.type === 'PitchContextChange') {
          try {
            activeContext = applyPitchContextChange(item, activeContext)
          } catch (error) {
            results.push({ diagnostics: [{ code: 'XP_CONTEXT', severity: 'error', message: error instanceof Error ? error.message : 'Invalid pitch context.', locations: [item.location] }] })
          }
        } else results.push(visit(item, activeContext))
      }
      const diagnostics = results.flatMap((result) => result.diagnostics)
      if (!results.every(hasShape)) return { diagnostics }
      return {
        shape: sequence(results.map((result) => result.shape), [origin(current)]),
        diagnostics,
      }
    }
    if (current.type === 'Parallel') {
      const results = current.branches.map((branch) => visit(branch, context))
      const diagnostics = results.flatMap((result) => result.diagnostics)
      if (!results.every(hasShape)) return { diagnostics }
      const branches = results.map((result) => result.shape)
      const duration = branches.reduce(
        (maximum, branch) => (branch.duration.compare(maximum) > 0 ? branch.duration : maximum),
        new Fraction(0),
      )
      const shape: ParallelShape = {
        kind: 'parallel',
        duration,
        branches: branches.map((branch) => pad(branch, duration)),
        origins: [origin(current)],
      }
      return { shape, diagnostics }
    }
    if (current.type === 'Group') return visit(current.expression, context)
    if (current.type === 'NormalizeToSlot') {
      if (!current.expression) {
        return {
          shape: { kind: 'rest', duration: pulse, generated: false, origins: [origin(current)] },
          diagnostics: [],
        }
      }
      const evaluated = visit(current.expression, context)
      if (!('shape' in evaluated)) return evaluated
      if (!evaluated.shape.duration.n) {
        return {
          diagnostics: [
            ...evaluated.diagnostics,
            {
              code: 'XP_NORMALIZE_ZERO',
              severity: 'error',
              message: 'A non-empty zero-duration fragment cannot be normalized.',
              locations: [current.location],
            },
          ],
        }
      }
      return {
        shape: scaleShape(evaluated.shape, pulse.div(evaluated.shape.duration)),
        diagnostics: evaluated.diagnostics,
      }
    }
    if (current.type === 'PostfixExpression') {
      const evaluated = visit(current.expression, context)
      if (!('shape' in evaluated)) return evaluated
      const continuations = current.marks.filter((mark) => mark.type === 'DetachedContinue')
      if (!continuations.length) return evaluated
      return {
        shape: sequence(
          [
            evaluated.shape,
            ...continuations.map<ContinueShape>((mark) => ({
              kind: 'continue',
              duration: pulse,
              origins: [origin(mark, 'duration')],
            })),
          ],
          [origin(current)],
        ),
        diagnostics: evaluated.diagnostics,
      }
    }

    if (current.type === 'PitchContextChange') {
      return { shape: sequence([], [origin(current, 'context')]), diagnostics: [] }
    }
    const evaluated = playablePitch(current, context)
    if (!('pitch' in evaluated)) return evaluated
    const shape: AttackShape = {
      kind: 'attack',
      pitch: evaluated.pitch,
      duration: pulse,
      origins: evaluated.pitch.origins,
    }
    return { shape, diagnostics: evaluated.diagnostics }
  }

  return visit(node, options.pitchContext ?? DEFAULT_PITCH_CONTEXT)
}
