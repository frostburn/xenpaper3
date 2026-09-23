import type { Expression, Program } from '../parser.generated.js'
import { expandRepeats } from './repeat-expansion'
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
  return abstractResult(
    evaluateScoreSemantics(
      {
        type: 'Sequence',
        items: program.body,
        location: program.location,
      } as Expression,
      options,
    ),
  )
}

/** Build one playback-preserving score shape for a complete program. */
export function evaluateProgramSemantics(
  program: Program,
  options: ScoreShapeOptions = {},
): ScoreShapeEvaluationResult {
  const expanded = expandRepeats(program, { ...options, preserveBarlines: true })
  if (!expanded.program) return { diagnostics: expanded.diagnostics }
  const sequence = {
    type: 'Sequence',
    items: expanded.program.body,
    location: program.location,
  } as unknown as Expression
  const result = evaluateScoreSemantics(sequence, options)
  const warned = new Set<string>()
  const diagnostics = [...expanded.diagnostics, ...result.diagnostics].filter((diagnostic) => {
    if (diagnostic.code !== 'XP_BARLINE_OFF_CYCLE') return true
    const key = JSON.stringify(diagnostic.locations)
    if (warned.has(key)) return false
    warned.add(key)
    return true
  })
  return { ...result, diagnostics }
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
