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
  const result = evaluateScoreSemantics(node, options)
  if (!('shape' in result)) return result

  const abstractShape = (shape: ScoreShape): ScoreShape => {
    if (shape.kind === 'attack') {
      const {
        dynamic: _dynamic,
        velocity: _velocity,
        velocityExplicit: _explicit,
        ...attack
      } = shape as ScoreShape & {
        dynamic?: unknown
        velocity?: unknown
        velocityExplicit?: unknown
      }
      return attack as ScoreShape
    }
    if (shape.kind === 'sequence') return { ...shape, children: shape.children.map(abstractShape) }
    if (shape.kind === 'parallel') return { ...shape, branches: shape.branches.map(abstractShape) }
    return shape
  }

  return { shape: abstractShape(result.shape), diagnostics: result.diagnostics }
}

/** Build one score shape for a complete program so context changes cross hard boundaries. */
export function evaluateProgramShape(
  program: Program,
  options: ScoreShapeOptions = {},
): ScoreShapeEvaluationResult {
  const sequence = {
    type: 'Sequence',
    items: program.body,
    location: program.location,
  } as Expression
  return evaluateScoreShape(sequence, options)
}
