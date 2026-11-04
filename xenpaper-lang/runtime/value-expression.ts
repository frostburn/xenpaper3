import type { Expression } from '../parser.js'
import type { Fraction } from 'xen-dev-utils/fraction'
import type { LocationRange } from 'peggy'
import type { EvaluatedLiteral, MusicValue } from './types'

/** Internal leaves retain values without manufacturing lexical variable names. */
export type ValueExpression = Expression & {
  readonly broadcastArticulation?: Fraction
  readonly evaluatedValue?: EvaluatedLiteral
  readonly musicContext?: Pick<MusicValue, 'environment' | 'pitchContext'>
}

export function valueExpression(value: EvaluatedLiteral, location: LocationRange): ValueExpression {
  if (value.kind === 'music')
    return {
      type: 'Group',
      expression: value.expression,
      location,
      musicContext: value,
    }
  if (value.kind !== 'container')
    return {
      type: 'Identifier',
      name: '$value',
      location,
      evaluatedValue: value,
      ...('authoredLabel' in value ? { raw: value.authoredLabel } : {}),
      ...('broadcastArticulation' in value
        ? { broadcastArticulation: value.broadcastArticulation }
        : {}),
    }
  const children = value.values.map((item) => valueExpression(item, location))
  const expression: Expression =
    value.composition === 'parallel'
      ? { type: 'Parallel', branches: children, location }
      : { type: 'Sequence', items: children, location }
  const composed: Expression = value.grouped ? { type: 'Group', expression, location } : expression
  return value.normalized
    ? { type: 'NormalizeToSlot', expression: children.length ? composed : null, location }
    : composed
}
