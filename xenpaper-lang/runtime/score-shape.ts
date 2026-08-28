import type { Expression, Program } from '../parser.generated.js'
import { evaluateScoreSemantics } from './score-evaluation'
import type { ScoreShape, ScoreShapeEvaluationResult, ScoreShapeOptions } from './types'

export type { ScoreShapeEvaluationResult, ScoreShapeOptions } from './types'

/**
 * Build the abstract, duration-bearing tree used for staff notation.
 *
 * Playback-only state is deliberately projected out here. Dynamics and other
 * directives remain zero-duration annotations, but they do not alter attacks.
 */
export function evaluateScoreShape(
  node: Expression,
  options: ScoreShapeOptions = {},
): ScoreShapeEvaluationResult {
  return abstractResult(evaluateScoreSemantics(node, options))
}

/** Build one score shape for a complete program so context changes cross hard boundaries. */
export function evaluateProgramShape(
  program: Program,
  options: ScoreShapeOptions = {},
): ScoreShapeEvaluationResult {
  return abstractResult(evaluateProgramSemantics(program, options))
}

/** Build one playback-preserving score shape for a complete program. */
export function evaluateProgramSemantics(
  program: Program,
  options: ScoreShapeOptions = {},
): ScoreShapeEvaluationResult {
  const sequence = {
    type: 'Sequence',
    items: program.body,
    location: program.location,
  } as Expression
  return evaluateScoreSemantics(sequence, options)
}

const abstractResult = (result: ScoreShapeEvaluationResult): ScoreShapeEvaluationResult => {
  if (!('shape' in result)) return result
  const abstract = abstractShape(result.shape)
  return { ...result, shape: abstract }
}

const abstractShape = (shape: ScoreShape): ScoreShape => {
  if (shape.kind === 'attack') {
    const {
      dynamic: _dynamic,
      velocity: _velocity,
      velocityExplicit: _explicit,
      ...attack
    } = shape as ScoreShape & { dynamic?: unknown; velocity?: unknown; velocityExplicit?: unknown }
    return attack as ScoreShape
  }
  if (shape.kind === 'sequence') return { ...shape, children: shape.children.map(abstractShape) }
  if (shape.kind === 'parallel') return { ...shape, branches: shape.branches.map(abstractShape) }
  return shape
}
