import type { Expression } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import { evaluateLiteral, type NumericLiteralNode } from './literals'
import type { EvaluatedLiteral, SourceOrigin } from './types'
import type { PrimeMapping } from './types'
import { DEFAULT_MAPPING, evaluateIntervalLiteral, evaluatePitchLiteral, spellPitchDifference } from './pitches'

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

function result(
  kind: EvaluatedLiteral['kind'],
  value: Value,
  origins: readonly SourceOrigin[],
): EvaluatedLiteral {
  return { kind, value, origins }
}

function operatorOrigins(
  left: EvaluatedLiteral,
  right: EvaluatedLiteral,
  node: Expression,
): readonly SourceOrigin[] {
  return [...left.origins, ...right.origins, { location: node.location, role: 'operator' }]
}

function pitchCoercion(value: EvaluatedLiteral): EvaluatedLiteral {
  if (value.kind === 'pitchOffset') return value
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
      return { kind: 'pitchOffset', value: left.rootOffset.sub(right.rootOffset), spelling: spellPitchDifference(left, right), origins }
    }
    if (left.kind !== 'absolutePitch') throw new TypeError('A pitch offset cannot subtract an absolute pitch.')
    const offset = pitchCoercion(right)
    return { ...left, rootOffset: subtract ? left.rootOffset.sub(offset.value) : left.rootOffset.add(offset.value), origins }
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
  return result('scalar', subtract ? left.value.sub(right.value) : left.value.add(right.value), origins)
}

function multiplyOrDivide(
  left: EvaluatedLiteral,
  right: EvaluatedLiteral,
  divide: boolean,
  node: Expression,
): EvaluatedLiteral {
  if (left.kind === 'absolutePitch' || right.kind === 'absolutePitch') throw new TypeError('Absolute pitches cannot be multiplied or divided.')
  if (left.kind === 'pitchOffset' && right.kind === 'pitchOffset') {
    throw new TypeError('Pitch offsets cannot be multiplied or divided together.')
  }
  if (divide && right.kind === 'pitchOffset') {
    throw new TypeError('A scalar cannot be divided by a pitch offset.')
  }
  const kind = left.kind === 'pitchOffset' || right.kind === 'pitchOffset' ? 'pitchOffset' : 'scalar'
  return result(
    kind,
    divide ? left.value.div(right.value) : left.value.mul(right.value),
    operatorOrigins(left, right, node),
  )
}

function modulo(left: EvaluatedLiteral, right: EvaluatedLiteral, node: Expression): EvaluatedLiteral {
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
      return result(
        'scalar',
        left.value.pow(right.value),
        operatorOrigins(left, right, node),
      )
    }
    default:
      throw new TypeError(`Unknown binary operator ${operator}.`)
  }
}

/** Evaluate the arithmetic subset of the parser AST without throwing for source errors. */
export function evaluateExpression(node: Expression, mapping: PrimeMapping = DEFAULT_MAPPING): ExpressionEvaluationResult {
  try {
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
    if (node.type === 'PitchLiteral') return { value: evaluatePitchLiteral(node, mapping), diagnostics: [] }
    if (node.type === 'IntervalLiteral') return { value: evaluateIntervalLiteral(node, mapping), diagnostics: [] }
    if (node.type === 'Group') return evaluateExpression(node.expression, mapping)
    if (node.type === 'UnaryExpression') {
      const operand = evaluateExpression(node.operand, mapping)
      if (!('value' in operand)) return operand
      if (node.operator === '+') return operand
      if (node.operator !== '-') throw new TypeError(`Unknown unary operator ${node.operator}.`)
      return {
        value: result(operand.value.kind, operand.value.value.neg(), [
          ...operand.value.origins,
          { location: node.location, role: 'operator' },
        ]),
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
        if (argument.value.kind !== 'pitchOffset') throw new TypeError('ratio() expects a pitch offset.')
        return {
          value: result('scalar', Value.ratio(argument.value.value), argument.value.origins),
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
