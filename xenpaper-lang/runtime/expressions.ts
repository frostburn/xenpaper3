import type { Expression } from '../parser.generated.js'
import { Fraction, mmod } from 'xen-dev-utils/fraction'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import { evaluateLiteral, type NumericLiteralNode } from './literals'
import type { EvaluatedLiteral, PitchOffsetValue, ScalarValue, SourceOrigin } from './types'
import type { PitchContext, PrimeMapping } from './types'
import {
  createPitchContext,
  DEFAULT_PITCH_CONTEXT,
  evaluateIntervalLiteral,
  evaluateMosIntervalLiteral,
  evaluatePitchLiteral,
  scalePitchOffset,
  mapFormula,
  spellIntervalFormula,
  spellPitchDifference,
  transposePitchSpelling,
  requirePitchOperator,
} from './pitches'

const MOS_HALF_ALTERATIONS: Readonly<Record<string, number>> = {
  '&': 2,
  '@': -2,
  e: 1,
  a: -1,
  _: 0,
  '♮': 0,
}

const EQUAVE_SHIFT_BY_MODIFIER: Readonly<Record<string, number>> = {
  equaveUp: 1,
  doubleEquaveUp: 2,
  equaveDown: -1,
}

const PITCH_MODIFIER_BY_OPERATOR = {
  "'": 'equaveUp',
  '"': 'doubleEquaveUp',
  '`': 'equaveDown',
  '^': 'up',
  v: 'down',
  '/': 'lift',
  '\\': 'drop',
} as const

type PitchOperator = keyof typeof PITCH_MODIFIER_BY_OPERATOR

function isPitchOperator(operator: string): operator is PitchOperator {
  return operator in PITCH_MODIFIER_BY_OPERATOR
}

function equaveShifts(modifiers: readonly { readonly kind: string }[]): number {
  return modifiers.reduce(
    (sum, modifier) => sum + (EQUAVE_SHIFT_BY_MODIFIER[modifier.kind] ?? 0),
    0,
  )
}

export type ExpressionEvaluationResult =
  | { readonly value: EvaluatedLiteral; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] }

function isNumericLiteral(node: Expression): node is NumericLiteralNode {
  return (
    node.type === 'IntegerLiteral' ||
    node.type === 'MonzoLiteral' ||
    node.type === 'DecimalLiteral' ||
    node.type === 'RealLiteral' ||
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
    if (subtract && left.kind !== 'absolutePitch')
      throw new TypeError('A pitch offset cannot subtract an absolute pitch.')
    const pitch = left.kind === 'absolutePitch' ? left : right
    if (pitch.kind !== 'absolutePitch') throw new TypeError('Expected an absolute pitch.')
    const offset = pitchCoercion(left.kind === 'absolutePitch' ? right : left)
    const spelling = transposePitchSpelling(pitch.spelling, offset.spelling, subtract)
    const rootOffset = subtract
      ? pitch.rootOffset.sub(offset.value)
      : pitch.rootOffset.add(offset.value)
    let mos = pitch.mos
    let mosSpelling
    if (mos && offset.spelling?.raw.endsWith('ms')) {
      const mosContext = mos.context
      const registerSteps = (offset.spelling.modifiers ?? []).reduce(
        (sum, modifier) =>
          sum + (EQUAVE_SHIFT_BY_MODIFIER[modifier] ?? 0) * mosContext.nominals.size,
        0,
      )
      let steps = Number(offset.spelling.number.valueOf()) + registerSteps
      if (offset.spelling.direction === 'descending') steps = -steps
      if (subtract) steps = -steps
      const rank = mos.rank + steps
      const nominals = [...mos.context.nominals.keys()]
      const nominal = nominals[((rank % nominals.length) + nominals.length) % nominals.length]!
      const registers = Math.floor(rank / nominals.length)
      const modifiers = registers
        ? Array.from({ length: Math.abs(registers) }, () =>
            registers > 0 ? 'equaveUp' : 'equaveDown',
          )
        : undefined
      const naturalOffset = mos.context.nominals
        .get(nominal)!
        .add(mos.context.equave.mul(new Value(registers)))
      const sourceRegister = Math.floor(mos.rank / nominals.length)
      const sourceNominal = nominals[mmod(mos.rank, nominals.length)]!
      const sourceNaturalOffset = mos.context.nominals
        .get(sourceNominal)!
        .add(mos.context.equave.mul(new Value(sourceRegister)))
      const chroma = mos.context.large.sub(mos.context.small).valueOf()
      const sourceHalfAlterations = (pitch.spelling.accidentals ?? []).reduce(
        (sum, token) => sum + (MOS_HALF_ALTERATIONS[token] ?? 0),
        0,
      )
      const intervalAlteration = rootOffset
        .sub(pitch.rootOffset)
        .sub(naturalOffset.sub(sourceNaturalOffset))
      const halfAlterations =
        sourceHalfAlterations +
        (chroma ? Math.round((2 * intervalAlteration.valueOf()) / chroma) : 0)
      const accidental = halfAlterations > 0 ? '&' : '@'
      const halfAccidental = halfAlterations > 0 ? 'e' : 'a'
      const accidentals: string[] = Array.from(
        { length: Math.floor(Math.abs(halfAlterations) / 2) },
        () => accidental,
      )
      if (Math.abs(halfAlterations) % 2) accidentals.push(halfAccidental)
      mos = { ...mos, rank }
      mosSpelling = {
        nominal,
        raw: nominal,
        system: 'mos' as const,
        derived: true,
        accidentals,
        ...(modifiers ? { modifiers } : {}),
      }
    }
    const formula = offset.formula
      ? new Map([...pitch.formula].map(([prime, exponent]) => [prime, new Fraction(exponent)]))
      : undefined
    if (formula && offset.formula) {
      for (const [prime, exponent] of offset.formula) {
        const combined = (formula.get(prime) ?? new Fraction(0)).add(
          subtract ? new Fraction(exponent).neg() : exponent,
        )
        if (combined.n) formula.set(prime, combined)
        else formula.delete(prime)
      }
    }
    return {
      ...pitch,
      rootOffset,
      ...(formula ? { formula } : {}),
      ...(mosSpelling ? { spelling: mosSpelling } : spelling ? { spelling } : {}),
      ...(mos ? { mos } : {}),
      origins,
    }
  }
  if (left.kind === 'pitchOffset' || right.kind === 'pitchOffset') {
    const lhs = pitchCoercion(left)
    const rhs = pitchCoercion(right)
    const value = subtract ? lhs.value.sub(rhs.value) : lhs.value.add(rhs.value)
    if (!lhs.formula || !rhs.formula) return result('pitchOffset', value, origins)
    const formula = new Map(
      [...lhs.formula].map(([prime, exponent]) => [prime, new Fraction(exponent)]),
    )
    for (const [prime, exponent] of rhs.formula) {
      const combined = (formula.get(prime) ?? new Fraction(0)).add(
        subtract ? new Fraction(exponent).neg() : exponent,
      )
      if (combined.n) formula.set(prime, combined)
      else formula.delete(prime)
    }
    return {
      kind: 'pitchOffset',
      value,
      formula,
      spelling: spellIntervalFormula(formula),
      origins,
    }
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
  if (left.kind === 'absolutePitch' || right.kind === 'absolutePitch') {
    throw new TypeError('Modulo does not support absolute pitches.')
  }
  const value = left.value.mmod(right.value)
  if (left.kind === 'pitchOffset' || right.kind === 'pitchOffset') {
    const difference = addOrSubtract(left, right, true, node)
    if (difference.kind === 'pitchOffset' && difference.value.equals(value)) return difference
    return result('pitchOffset', value, operatorOrigins(left, right, node))
  }
  return result('scalar', value, operatorOrigins(left, right, node))
}

function geometricModulo(
  left: EvaluatedLiteral,
  right: EvaluatedLiteral,
  node: Expression,
): EvaluatedLiteral {
  if (left.kind !== 'scalar' || right.kind !== 'scalar') {
    throw new TypeError('Geometric modulo requires ratio operands.')
  }
  return result('scalar', left.value.reduce(right.value), operatorOrigins(left, right, node))
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
    case 'rd':
      return geometricModulo(left, right, node)
    case '**': {
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
      const context = 'rootPitch' in mapping ? mapping : createPitchContext(mapping)
      const degree = Number(node.degree)
      const degrees = context.degrees
      const value = (
        degree
          ? degrees[mmod(degree - 1, degrees.length)]!.add(
              context.degreeEquave.mul(new Value(Math.floor((degree - 1) / degrees.length))),
            )
          : Value.cents(0)
      ).add(context.degreeEquave.mul(new Value(equaveShifts(node.modifiers))))
      return {
        value: {
          ...result('pitchOffset', value, [{ location: node.location, role: 'literal' }]),
          scaleDegree: degree,
        },
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
    if (node.type === 'MosIntervalLiteral')
      return { value: evaluateMosIntervalLiteral(node, mapping), diagnostics: [] }
    if (node.type === 'Group') return evaluateExpression(node.expression, mapping)
    if (node.type === 'UnaryExpression') {
      const operand = evaluateExpression(node.operand, mapping)
      if (!('value' in operand)) return operand
      if (node.operator === '+') return operand
      if (node.operator === '~') {
        if (operand.value.kind === 'absolutePitch')
          throw new TypeError('An absolute pitch cannot be tempered.')
        if (operand.value.kind === 'pitchOffset') return operand
        const ratio = operand.value.value
        if (!ratio.isPositiveExactRatio())
          throw new TypeError('Tempering requires a positive exact ratio.')
        const formula = ratio.primeExponents()!
        const context = 'rootPitch' in mapping ? mapping : createPitchContext(mapping)
        return {
          value: {
            kind: 'pitchOffset',
            value: mapFormula(formula, context.mapping),
            formula,
            spelling: spellIntervalFormula(formula),
            origins: [
              ...operand.value.origins,
              { location: node.location, role: 'operator' as const },
            ],
          },
          diagnostics: operand.diagnostics,
        }
      }
      if (isPitchOperator(node.operator)) {
        const context = 'rootPitch' in mapping ? mapping : createPitchContext(mapping)
        const modifier = PITCH_MODIFIER_BY_OPERATOR[node.operator]
        const equaveShift = EQUAVE_SHIFT_BY_MODIFIER[modifier] ?? 0
        const inflectionKind = node.operator === '^' || node.operator === 'v' ? 'up' : 'lift'
        let inflection = requirePitchOperator(context, inflectionKind)
        if (node.operator !== '^' && node.operator !== '/') inflection = inflection.neg()
        // Equave shifts use the scale's degree equave for scalar arithmetic, but
        // written pitches and intervals always move by notational octaves.
        const scalarDisplacement = equaveShift
          ? context.degreeEquave.mul(new Value(equaveShift))
          : inflection
        const pitchDisplacement = equaveShift
          ? Value.pitch(new Value(2).pow(equaveShift))
          : inflection
        const operatorOrigin: SourceOrigin = { location: node.location, role: 'operator' }
        const origins = [...operand.value.origins, operatorOrigin]
        const equaveFormula = equaveShift
          ? Value.ratio(pitchDisplacement).primeExponents()
          : undefined
        const shiftedFormula = (formula: ReadonlyMap<number, Fraction>) => {
          if (!equaveFormula) return formula
          const shifted = new Map(formula)
          for (const [prime, exponent] of equaveFormula) {
            shifted.set(prime, (shifted.get(prime) ?? new Fraction(0)).add(exponent))
          }
          return shifted
        }
        if (operand.value.kind === 'scalar') {
          return {
            value: result(
              'scalar',
              operand.value.value.mul(Value.ratio(scalarDisplacement)),
              origins,
            ),
            diagnostics: operand.diagnostics,
          }
        }
        if (operand.value.kind === 'absolutePitch') {
          return {
            value: {
              ...operand.value,
              origins,
              rootOffset: operand.value.rootOffset.add(pitchDisplacement),
              formula: shiftedFormula(operand.value.formula),
              spelling: {
                ...operand.value.spelling,
                modifiers: [modifier, ...(operand.value.spelling.modifiers ?? [])],
              },
            },
            diagnostics: operand.diagnostics,
          }
        }
        const offset =
          operand.value.kind === 'pitchOffset' ? operand.value : pitchCoercion(operand.value)
        return {
          value: {
            ...offset,
            origins,
            value: offset.value.add(pitchDisplacement),
            ...(offset.formula ? { formula: shiftedFormula(offset.formula) } : {}),
            ...(offset.spelling
              ? {
                  spelling: {
                    ...offset.spelling,
                    modifiers: [modifier, ...(offset.spelling.modifiers ?? [])],
                  },
                }
              : {}),
          },
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
            : {
                ...operand.value,
                value: operand.value.value.neg(),
                formula: operand.value.formula
                  ? new Map(
                      [...operand.value.formula].map(([prime, exponent]) => [
                        prime,
                        new Fraction(exponent).neg(),
                      ]),
                    )
                  : undefined,
                spelling: operand.value.spelling
                  ? {
                      ...operand.value.spelling,
                      direction:
                        operand.value.spelling.direction === 'descending'
                          ? 'ascending'
                          : 'descending',
                      inflections: operand.value.spelling.inflections?.map((inflection) => ({
                        ...inflection,
                        direction:
                          inflection.direction === 'numerator' ? 'denominator' : 'numerator',
                      })),
                    }
                  : undefined,
                origins,
              },
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
          value: {
            ...result('pitchOffset', Value.pitch(argument.value.value), argument.value.origins),
            ...(argument.value.value.isPositiveExactRatio() ? { justIntonation: true } : {}),
          },
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
