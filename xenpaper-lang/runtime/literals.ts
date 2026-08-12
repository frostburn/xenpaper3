import { Fraction } from 'xen-dev-utils/fraction'
import { isPrime, nthPrime, primes } from 'xen-dev-utils/primes'
import type {
  DecimalLiteral,
  EqualDivisionLiteral,
  IntegerLiteral,
  MonzoLiteral,
  QuantityLiteral,
  RealLiteral,
  RatioLiteral,
} from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import type { EvaluatedLiteral } from './types'

export type NumericLiteralNode =
  | DecimalLiteral
  | EqualDivisionLiteral
  | IntegerLiteral
  | MonzoLiteral
  | QuantityLiteral
  | RealLiteral
  | RatioLiteral

export type LiteralEvaluationResult =
  | { readonly value: EvaluatedLiteral; readonly diagnostics: readonly [] }
  | { readonly diagnostics: readonly [Diagnostic] }

function failure(node: NumericLiteralNode, code: string, message: string): LiteralEvaluationResult {
  return {
    diagnostics: [{ code, severity: 'error', message, locations: [node.location] }],
  }
}

function signed(text: string, sign?: string | null): string {
  return sign === '-' ? `-${text}` : text
}

/** Convert a source decimal to a reduced fraction without passing through IEEE-754. */
export function decimalFraction(text: string): Fraction {
  const match = /^([+-]?)(\d+)\.(\d*)$/.exec(text)
  if (!match) throw new TypeError(`Invalid decimal literal ${text}.`)
  const [, sign, whole, fractional] = match
  // Fraction's string constructor parses the digits directly, unlike a
  // Number conversion, which would round before Fraction sees the value.
  return new Fraction(`${sign}${whole}.${fractional}`)
}

function rationalLiteral(
  node: IntegerLiteral | DecimalLiteral | RealLiteral | RatioLiteral,
): Value {
  if (node.type === 'IntegerLiteral') return new Value(BigInt(node.value))
  if (node.type === 'RealLiteral') return Value.real(Number(node.value))
  if (node.type === 'DecimalLiteral')
    return new Value(decimalFraction(signed(node.value, node.sign)))
  return new Value(BigInt(signed(node.numerator, node.sign)), BigInt(node.denominator))
}

function monzoLiteral(node: MonzoLiteral): Value {
  const bases = node.subgroup.map((component) => new Fraction(component))
  if (node.continuation) {
    const last = bases[bases.length - 1] ?? new Fraction(1)
    if (bases.length && (last.d !== 1 || !isPrime(last.n)))
      throw new TypeError('A monzo subgroup may only continue after a prime.')
    let primeIndex = primes(2, last.n).length
    while (bases.length < node.components.length) {
      bases.push(new Fraction(nthPrime(primeIndex)))
      primeIndex += 1
    }
  }
  if (bases.length !== node.components.length)
    throw new TypeError('The monzo vector and subgroup must have the same number of components.')

  let ratio = new Value(1)
  for (let index = 0; index < node.components.length; index += 1) {
    const base = bases[index]!
    if (!(base.valueOf() > 0)) throw new TypeError('Monzo subgroup components must be positive.')
    ratio = ratio.mul(new Value(base).pow(new Fraction(node.components[index]!)))
  }
  return Value.pitch(ratio)
}

function scalar(value: Value, node: NumericLiteralNode): EvaluatedLiteral {
  return { kind: 'scalar', value, origins: [{ location: node.location, role: 'literal' }] }
}

function pitchOffset(value: Value, node: NumericLiteralNode): EvaluatedLiteral {
  return { kind: 'pitchOffset', value, origins: [{ location: node.location, role: 'literal' }] }
}

function quantity(node: QuantityLiteral): EvaluatedLiteral {
  const magnitude = node.magnitude.includes('.')
    ? decimalFraction(signed(node.magnitude, node.sign))
    : new Fraction(signed(node.magnitude, node.sign))

  switch (node.unit.toLowerCase()) {
    case 'c':
      return pitchOffset(Value.cents(magnitude), node)
    case 'db':
      return scalar(Value.decibels(magnitude), node)
    case 'beat':
    case 'beats':
      return scalar(Value.beats(magnitude), node)
    case 's':
      return scalar(Value.seconds(magnitude), node)
    case 'ms':
      return scalar(Value.seconds(magnitude.div(1000)), node)
    case 'hz':
      return scalar(Value.hertz(magnitude), node)
    case 'khz':
      return scalar(Value.hertz(magnitude.mul(1000)), node)
    case '%':
      return scalar(new Value(magnitude.div(100)), node)
    default:
      throw new TypeError(`Unsupported unit ${node.unit}.`)
  }
}

/** Evaluate a numeric leaf. Equal divisions accept an already-evaluated equave. */
export function evaluateLiteral(
  node: NumericLiteralNode,
  equave: Value = new Value(2),
): LiteralEvaluationResult {
  try {
    if (node.type === 'MonzoLiteral')
      return { value: pitchOffset(monzoLiteral(node), node), diagnostics: [] }
    if (node.type === 'QuantityLiteral') return { value: quantity(node), diagnostics: [] }
    if (node.type !== 'EqualDivisionLiteral') {
      return { value: scalar(rationalLiteral(node), node), diagnostics: [] }
    }

    const divisions = new Fraction(node.divisions)
    if (!divisions.n) {
      return failure(node, 'XP_DIVISION_BY_ZERO', 'Equal division count cannot be zero.')
    }
    if (!equave.dimensions.isDimensionless || !(equave.valueOf() > 0)) {
      return failure(node, 'XP_LITERAL', 'Equal-division equave must be a positive ratio.')
    }
    const steps = new Fraction(signed(node.steps, node.sign))
    return {
      value: pitchOffset(Value.equalDivision(steps, divisions, equave), node),
      diagnostics: [],
    }
  } catch (error) {
    const divisionByZero = error instanceof RangeError && error.message.includes('Division by zero')
    return failure(
      node,
      divisionByZero ? 'XP_DIVISION_BY_ZERO' : 'XP_LITERAL',
      error instanceof Error ? error.message : 'Invalid numeric literal.',
    )
  }
}
