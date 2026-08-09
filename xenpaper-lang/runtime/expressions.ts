import type { Expression } from '../parser.generated.js'
import { Fraction } from 'xen-dev-utils/fraction'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import { evaluateLiteral, type NumericLiteralNode } from './literals'
import type { EvaluatedLiteral, PitchOffsetValue, ScalarValue, SourceOrigin } from './types'
import type { PitchContext, PrimeMapping } from './types'
import {
  createPitchContext,
  DEFAULT_PITCH_CONTEXT,
  evaluateIntervalLiteral,
  evaluatePitchLiteral,
  scalePitchOffset,
  spellPitchDifference,
} from './pitches'

function equaveShifts(modifiers: readonly { readonly kind: string }[]): number {
  return modifiers.reduce(
    (sum, modifier) =>
      sum +
      (modifier.kind === 'equaveUp'
        ? 1
        : modifier.kind === 'doubleEquaveUp'
          ? 2
          : modifier.kind === 'equaveDown'
            ? -1
            : 0),
    0,
  )
}

export type ExpressionEvaluationResult =
  | { readonly value: EvaluatedLiteral; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] }

function isNumericLiteral(node: Expression): node is NumericLiteralNode {
  return (
    node.type === 'IntegerLiteral' ||
    node.type === 'DecimalLiteral' ||
    node.type === 'RatioLiteral' ||
    node.type === 'QuantityLiteral' ||
    node.type === 'EqualDivisionLiteral'
  )
}

function diagnostic(node: Expression, error: unknown): Diagnostic {
  const message = error instanceof Error ? error.message : 'Invalid expression.'
  let code = 'XP_TYPE_MISMATCH'
  if (message.toLowerCase().includes('division by zero')) code = 'XP_DIVISION_BY_ZERO'
  else if (message.toLowerCase().includes('dimension')) code = 'XP_DIMENSION_MISMATCH'
  return { code, severity: 'error', message, locations: [node.location] }
}

function result(kind: 'scalar', value: Value, origins: readonly SourceOrigin[]): ScalarValue
function result(
  kind: 'pitchOffset',
  value: Value,
  origins: readonly SourceOrigin[],
): PitchOffsetValue
function result(
  kind: 'scalar' | 'pitchOffset',
  value: Value,
  origins: readonly SourceOrigin[],
): ScalarValue | PitchOffsetValue {
  return { kind, value, origins }
}

function operatorOrigins(
  left: EvaluatedLiteral,
  right: EvaluatedLiteral,
  node: Expression,
): readonly SourceOrigin[] {
  return [...left.origins, ...right.origins, { location: node.location, role: 'operator' }]
}

function pitchCoercion(value: EvaluatedLiteral): PitchOffsetValue {
  if (value.kind === 'pitchOffset') return value
  if (value.kind === 'absolutePitch')
    throw new TypeError('An absolute pitch cannot be coerced to a pitch offset.')
  const ratio = value.value.exactRational()
  if (!ratio || ratio.compare(0) <= 0) {
    throw new TypeError('A scalar mixed with a pitch offset must be a positive exact ratio.')
  }
  return result('pitchOffset', Value.pitch(value.value), value.origins)
}

function addOrSubtract(
  left: EvaluatedLiteral,
  right: EvaluatedLiteral,
  subtract: boolean,
  node: Expression,
): EvaluatedLiteral {
  const origins = operatorOrigins(left, right, node)
  if (left.kind === 'absolutePitch' || right.kind === 'absolutePitch') {
    if (left.kind === 'absolutePitch' && right.kind === 'absolutePitch') {
      if (!subtract) throw new TypeError('Absolute pitches cannot be added together.')
      return {
        kind: 'pitchOffset',
        value: left.rootOffset.sub(right.rootOffset),
        spelling: spellPitchDifference(left, right),
        origins,
      }
    }
    if (left.kind !== 'absolutePitch')
      throw new TypeError('A pitch offset cannot subtract an absolute pitch.')
    const offset = pitchCoercion(right)
    return {
      ...left,
      rootOffset: subtract ? left.rootOffset.sub(offset.value) : left.rootOffset.add(offset.value),
      origins,
    }
  }
  if (left.kind === 'pitchOffset' || right.kind === 'pitchOffset') {
    const lhs = pitchCoercion(left)
    const rhs = pitchCoercion(right)
    return result(
      'pitchOffset',
      subtract ? lhs.value.sub(rhs.value) : lhs.value.add(rhs.value),
      origins,
    )
  }
  return result(
    'scalar',
    subtract ? left.value.sub(right.value) : left.value.add(right.value),
    origins,
  )
}

function multiplyOrDivide(
  left: EvaluatedLiteral,
  right: EvaluatedLiteral,
  divide: boolean,
  node: Expression,
): EvaluatedLiteral {
  if (left.kind === 'absolutePitch' || right.kind === 'absolutePitch')
    throw new TypeError('Absolute pitches cannot be multiplied or divided.')
  if (left.kind === 'pitchOffset' && right.kind === 'pitchOffset') {
    throw new TypeError('Pitch offsets cannot be multiplied or divided together.')
  }
  if (divide && right.kind === 'pitchOffset') {
    throw new TypeError('A scalar cannot be divided by a pitch offset.')
  }
  if (left.kind === 'pitchOffset' || right.kind === 'pitchOffset') {
    const scalar = left.kind === 'pitchOffset' ? right : left
    const offset = left.kind === 'pitchOffset' ? left : right
    if (scalar.kind !== 'scalar' || offset.kind !== 'pitchOffset')
      throw new TypeError('Pitch offsets require a scalar factor.')
    const factor = scalar.value.exactRational()
    if (!factor) throw new TypeError('Pitch offsets can only be scaled by exact rational scalars.')
    return {
      ...scalePitchOffset(offset, divide ? new Fraction(1).div(factor) : factor),
      origins: operatorOrigins(left, right, node),
    }
  }
  return result(
    'scalar',
    divide ? left.value.div(right.value) : left.value.mul(right.value),
    operatorOrigins(left, right, node),
  )
}

function modulo(
  left: EvaluatedLiteral,
  right: EvaluatedLiteral,
  node: Expression,
): EvaluatedLiteral {
  if (left.kind !== 'scalar' || right.kind !== 'scalar') {
    throw new TypeError('Modulo requires scalar operands.')
  }
  const lhs = left.value.exactRational()
  const rhs = right.value.exactRational()
  if (!lhs || !rhs) throw new TypeError('Modulo requires exact dimensionless rational operands.')
  if (!rhs.n) throw new RangeError('Division by zero.')
  return result('scalar', new Value(lhs.mmod(rhs)), operatorOrigins(left, right, node))
}

function binary(
  operator: string,
  left: EvaluatedLiteral,
  right: EvaluatedLiteral,
  node: Expression,
): EvaluatedLiteral {
  switch (operator) {
    case '+':
      return addOrSubtract(left, right, false, node)
    case '-':
      return addOrSubtract(left, right, true, node)
    case '*':
      return multiplyOrDivide(left, right, false, node)
    case '/':
    case 'div':
      return multiplyOrDivide(left, right, true, node)
    case 'mod':
      return modulo(left, right, node)
    case '^': {
      if (left.kind !== 'scalar' || right.kind !== 'scalar') {
        throw new TypeError('Exponentiation requires scalar operands.')
      }
      return result('scalar', left.value.pow(right.value), operatorOrigins(left, right, node))
    }
    default:
      throw new TypeError(`Unknown binary operator ${operator}.`)
  }
}

/** Evaluate the arithmetic subset of the parser AST without throwing for source errors. */
export function evaluateExpression(
  node: Expression,
  mapping: PrimeMapping | PitchContext = DEFAULT_PITCH_CONTEXT,
): ExpressionEvaluationResult {
  try {
    if (node.type === 'DegreeLiteral') {
      const context = 'rootFormula' in mapping ? mapping : createPitchContext(mapping)
      const value = context.degreeStep
        .mul(new Value(BigInt(node.degree)))
        .add(context.degreeEquave.mul(new Value(equaveShifts(node.modifiers))))
      return {
        value: result('pitchOffset', value, [{ location: node.location, role: 'literal' }]),
        diagnostics: [],
      }
    }
    if (isNumericLiteral(node)) {
      if (node.type === 'EqualDivisionLiteral' && node.equave) {
        const equave = evaluateExpression(node.equave, mapping)
        if (!('value' in equave)) return equave
        if (equave.value.kind !== 'scalar') {
          throw new TypeError('Equal-division equave must be a scalar ratio.')
        }
        return evaluateLiteral(node, equave.value.value)
      }
      return evaluateLiteral(node)
    }
    if (node.type === 'PitchLiteral')
      return { value: evaluatePitchLiteral(node, mapping), diagnostics: [] }
    if (node.type === 'IntervalLiteral')
      return { value: evaluateIntervalLiteral(node, mapping), diagnostics: [] }
    if (node.type === 'Group') return evaluateExpression(node.expression, mapping)
    if (node.type === 'UnaryExpression') {
      const operand = evaluateExpression(node.operand, mapping)
      if (!('value' in operand)) return operand
      if (node.operator === '+') return operand
      if (["'", '"', '`'].includes(node.operator)) {
        if (operand.value.kind === 'absolutePitch')
          throw new TypeError('An equave shift requires a pitch offset.')
        const context = 'rootFormula' in mapping ? mapping : createPitchContext(mapping)
        const shift = node.operator === "'" ? 1 : node.operator === '"' ? 2 : -1
        const offset =
          operand.value.kind === 'pitchOffset' ? operand.value : pitchCoercion(operand.value)
        return {
          value: { ...offset, value: offset.value.add(context.degreeEquave.mul(new Value(shift))) },
          diagnostics: operand.diagnostics,
        }
      }
      if (node.operator !== '-') throw new TypeError(`Unknown unary operator ${node.operator}.`)
      if (operand.value.kind === 'absolutePitch')
        throw new TypeError('An absolute pitch cannot be negated.')
      const origins: readonly SourceOrigin[] = [
        ...operand.value.origins,
        { location: node.location, role: 'operator' },
      ]
      return {
        value:
          operand.value.kind === 'scalar'
            ? result('scalar', operand.value.value.neg(), origins)
            : result('pitchOffset', operand.value.value.neg(), origins),
        diagnostics: operand.diagnostics,
      }
    }
    if (node.type === 'BinaryExpression') {
      const left = evaluateExpression(node.left, mapping)
      const right = evaluateExpression(node.right, mapping)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      if (!('value' in left) || !('value' in right)) return { diagnostics }
      return { value: binary(node.operator, left.value, right.value, node), diagnostics }
    }
    if (node.type === 'CallExpression') {
      if (node.arguments.length !== 1) throw new TypeError(`${node.callee}() expects one argument.`)
      const argumentNode = node.arguments[0]!
      const argument = evaluateExpression(argumentNode, mapping)
      if (!('value' in argument)) return argument
      if (node.callee === 'pitch') {
        if (argument.value.kind !== 'scalar') throw new TypeError('pitch() expects a scalar ratio.')
        return {
          value: result('pitchOffset', Value.pitch(argument.value.value), argument.value.origins),
          diagnostics: argument.diagnostics,
        }
      }
      if (node.callee === 'ratio') {
        if (argument.value.kind !== 'pitchOffset')
          throw new TypeError('ratio() expects a pitch offset.')
        return {
          value: result('scalar', Value.ratio(argument.value.value), argument.value.origins),
          diagnostics: argument.diagnostics,
        }
      }
      if (node.callee === 'sqrt') {
        if (argument.value.kind !== 'scalar')
          throw new TypeError('sqrt() expects a scalar quantity.')
        return {
          value: result(
            'scalar',
            argument.value.value.pow(new Fraction(1, 2)),
            argument.value.origins,
          ),
          diagnostics: argument.diagnostics,
        }
      }
      throw new TypeError(`Unknown call ${node.callee}().`)
    }
    throw new TypeError(`${node.type} is not an arithmetic expression.`)
  } catch (error) {
    return { diagnostics: [diagnostic(node, error)] }
  }
}
