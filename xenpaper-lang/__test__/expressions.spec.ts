import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { parse, type Expression } from '../parser.generated.js'
import { evaluateExpression } from '../runtime/expressions'
import { edoMapping } from '../runtime/pitches'
import { Value } from '../value'

function expression(source: string): Expression {
  const directive = parse(`@test(${source})`).body[0]
  if (directive.type !== 'Directive') throw new Error('Expected a directive.')
  return directive.arguments[0]!
}

function evaluate(source: string) {
  const evaluated = evaluateExpression(expression(source))
  expect(evaluated.diagnostics).toEqual([])
  if (!('value' in evaluated)) throw new Error('Expected a value.')
  return evaluated.value
}

describe('arithmetic expression evaluation', () => {
  it('adds cents as pitch displacement', () => {
    const sum = evaluate('700c + 700c')

    expect(sum.kind).toBe('pitchOffset')
    expect(sum.value.equals(Value.cents(1400))).toBe(true)
  })

  it('adds ratios arithmetically rather than stacking them as pitches', () => {
    const sum = evaluate('3/2 + 3/2')

    expect(sum.kind).toBe('scalar')
    expect(sum.value.equals(3)).toBe(true)
  })

  it('supports exact scalar arithmetic and right-associative powers', () => {
    expect(evaluate('(5/2 - 1/2) * 3/4').value.equals(new Fraction(3, 2))).toBe(true)
    expect(evaluate('2 ^ 3 ^ 2').value.equals(512)).toBe(true)
    expect(evaluate('-5 mod 3').value.equals(1)).toBe(true)
  })

  it('scales pitch offsets only by rational scalars', () => {
    expect(evaluate('2 * 350c').value.equals(Value.cents(700))).toBe(true)
    expect(evaluate('700c / 2').value.equals(Value.cents(350))).toBe(true)
  })

  it('coerces a ratio when mixed with a pitch offset', () => {
    const mixed = evaluate('3/2 + 700c')

    expect(mixed.kind).toBe('pitchOffset')
    expect(mixed.value.equals(Value.pitch(new Value(3n, 2n)).add(Value.cents(700)))).toBe(true)
  })

  it('supports explicit pitch and ratio coercion calls', () => {
    expect(evaluate('pitch(3/2)').value.equals(Value.pitch(new Value(3n, 2n)))).toBe(true)
    expect(evaluate('ratio(700c)').value.equals(Value.ratio(Value.cents(700)))).toBe(true)
  })

  it('preserves literal and operator origins', () => {
    expect(evaluate('1/2 + 1/3').origins.map((origin) => origin.role)).toEqual([
      'literal',
      'literal',
      'operator',
    ])
  })

  it('returns diagnostics for invalid arithmetic instead of throwing', () => {
    expect(evaluateExpression(expression('1s + 2Hz'))).toMatchObject({
      diagnostics: [{ code: 'XP_DIMENSION_MISMATCH' }],
    })
    expect(evaluateExpression(expression('700c * 300c'))).toMatchObject({
      diagnostics: [{ code: 'XP_TYPE_MISMATCH' }],
    })
    expect(evaluateExpression(expression('1 mod 0'))).toMatchObject({
      diagnostics: [{ code: 'XP_DIVISION_BY_ZERO' }],
    })
  })

  it('evaluates Pythagorean Latin nominals as absolute pitches', () => {
    const c = evaluate('C')
    const g = evaluate('G')
    expect(c.kind).toBe('absolutePitch')
    expect(g.kind).toBe('absolutePitch')
    if (c.kind !== 'absolutePitch' || g.kind !== 'absolutePitch') throw new Error('Expected pitches.')
    expect(c.rootOffset.equals(Value.cents(0))).toBe(true)
    expect(g.rootOffset.equals(Value.pitch(new Value(3n, 2n)))).toBe(true)
  })

  it('applies active mappings to formulas without moving C', () => {
    const evaluated = evaluateExpression(expression('G'), edoMapping(12))
    expect(evaluated.diagnostics).toEqual([])
    if (!('value' in evaluated) || evaluated.value.kind !== 'absolutePitch') throw new Error('Expected a pitch.')
    expect(evaluated.value.rootOffset.equals(Value.cents(700))).toBe(true)
  })

  it('subtracts absolute pitches as a named relative interval and rejects their sum', () => {
    const difference = evaluate('G - D')
    expect(difference.kind).toBe('pitchOffset')
    if (difference.kind !== 'pitchOffset') throw new Error('Expected an interval.')
    expect(difference.value.equals(Value.pitch(new Value(4n, 3n)))).toBe(true)
    expect(difference.spelling).toMatchObject({ quality: 'P', number: 4n, raw: 'P4' })
    expect(evaluateExpression(expression('G + D'))).toMatchObject({ diagnostics: [{ code: 'XP_TYPE_MISMATCH' }] })
  })

  it('evaluates compound and chromatically altered relative intervals', () => {
    expect(evaluate('P4').value.equals(Value.pitch(new Value(4n, 3n)))).toBe(true)
    expect(evaluate('m10').value.equals(Value.pitch(new Value(64n, 27n)))).toBe(true)
    expect(evaluate('A1').value.equals(Value.pitch(new Value(2187n, 2048n)))).toBe(true)
  })
})
