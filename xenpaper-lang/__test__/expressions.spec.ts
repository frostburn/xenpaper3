import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { parse, type Expression } from '../parser.generated.js'
import { evaluateExpression } from '../runtime/expressions'
import { groupFjsInflections } from '../runtime/fjs'
import { DEFAULT_PITCH_CONTEXT, applyPitchContextChange, edoMapping } from '../runtime/pitches'
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
    expect(evaluate(String.raw`ratio(13 * (1\13<3>))`).value.equals(3)).toBe(true)
  })

  it('evaluates square roots while preserving exact values and dimensions', () => {
    expect(evaluate('sqrt(4)').value.equals(2)).toBe(true)
    expect(evaluate('sqrt(2) * sqrt(2)').value.equals(2)).toBe(true)

    const duration = evaluate('sqrt(4 * 1s^2)')
    expect(duration.value.equals(Value.seconds(2))).toBe(true)
  })

  it('falls back to real arithmetic for sums of unrelated square roots', () => {
    const sum = evaluate('sqrt(2) + sqrt(3)')

    expect(sum.value.magnitude.kind).toBe('real')
    expect(sum.value.valueOf()).toBeCloseTo(Math.sqrt(2) + Math.sqrt(3))
  })

  it('rejects pitch arguments and invalid arity for conversion functions', () => {
    expect(evaluateExpression(expression('ratio(3/2)'))).toMatchObject({
      diagnostics: [{ code: 'XP_TYPE_MISMATCH', message: 'ratio() expects a pitch offset.' }],
    })
    expect(evaluateExpression(expression('sqrt(700c)'))).toMatchObject({
      diagnostics: [{ code: 'XP_TYPE_MISMATCH', message: 'sqrt() expects a scalar quantity.' }],
    })
    expect(evaluateExpression(expression('sqrt(1, 2)'))).toMatchObject({
      diagnostics: [{ code: 'XP_TYPE_MISMATCH', message: 'sqrt() expects one argument.' }],
    })
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
    if (c.kind !== 'absolutePitch' || g.kind !== 'absolutePitch')
      throw new Error('Expected pitches.')
    expect(c.rootOffset.equals(Value.cents(0))).toBe(true)
    expect(g.rootOffset.equals(Value.pitch(new Value(3n, 2n)))).toBe(true)
  })

  it('applies active mappings to formulas without moving C', () => {
    const evaluated = evaluateExpression(expression('G'), edoMapping(12))
    expect(evaluated.diagnostics).toEqual([])
    if (!('value' in evaluated) || evaluated.value.kind !== 'absolutePitch')
      throw new Error('Expected a pitch.')
    expect(evaluated.value.rootOffset.equals(Value.cents(700))).toBe(true)
  })

  it('subtracts absolute pitches as a named relative interval and rejects their sum', () => {
    const difference = evaluate('G - D')
    expect(difference.kind).toBe('pitchOffset')
    if (difference.kind !== 'pitchOffset') throw new Error('Expected an interval.')
    expect(difference.value.equals(Value.pitch(new Value(4n, 3n)))).toBe(true)
    expect(difference.spelling).toMatchObject({ quality: 'P', number: 4n, raw: 'P4' })
    expect(evaluateExpression(expression('G + D'))).toMatchObject({
      diagnostics: [{ code: 'XP_TYPE_MISMATCH' }],
    })
  })

  it('retains the diatonic result of pitch and interval arithmetic', () => {
    const pitch = evaluate('G - n3')
    const attachedPitch = evaluate('G-n3')
    const interval = evaluate('M3-n3')

    expect(pitch.kind === 'absolutePitch' && pitch.spelling).toMatchObject({ nominal: 'E' })
    expect(attachedPitch.kind === 'absolutePitch' && attachedPitch.spelling).toMatchObject({
      nominal: 'E',
    })
    expect(interval.kind).toBe('pitchOffset')
    expect(interval.value.equals(evaluate('M3 - n3').value)).toBe(true)
  })

  it('updates the exact pitch formula when transposing an absolute pitch', () => {
    const transposed = evaluate('A + M3')
    const difference = evaluate('(A + M3) - C')
    const expected = evaluate('c#')

    expect(transposed.kind === 'absolutePitch' && transposed.formula).toEqual(
      expected.kind === 'absolutePitch' ? expected.formula : undefined,
    )
    expect(difference.kind === 'pitchOffset' && difference.spelling).toMatchObject({
      quality: 'A',
      number: 8n,
    })
  })

  it('evaluates compound and chromatically altered relative intervals', () => {
    expect(evaluate('P4').value.equals(Value.pitch(new Value(4n, 3n)))).toBe(true)
    expect(evaluate('m10').value.equals(Value.pitch(new Value(64n, 27n)))).toBe(true)
    expect(evaluate('A1').value.equals(Value.pitch(new Value(2187n, 2048n)))).toBe(true)
  })

  it('evaluates Greek and ASCII semioctave nominals', () => {
    for (const source of ['γ', 'gam']) {
      const pitch = evaluate(source)
      expect(pitch.kind).toBe('absolutePitch')
      if (pitch.kind !== 'absolutePitch') throw new Error('Expected a pitch.')
      expect(pitch.rootOffset.equals(Value.cents(1800))).toBe(true)
    }
    for (const source of ['Γ', 'Gam']) {
      const pitch = evaluate(source)
      if (pitch.kind !== 'absolutePitch') throw new Error('Expected a pitch.')
      expect(pitch.rootOffset.equals(Value.cents(600))).toBe(true)
    }
  })

  it('evaluates and derives interordinal intervals', () => {
    const direct = evaluate('P4.5')
    expect(direct.value.equals(Value.equalDivision(1, 2, new Value(2)))).toBe(true)
    const difference = evaluate('Gam - C')
    expect(difference.kind).toBe('pitchOffset')
    if (difference.kind !== 'pitchOffset') throw new Error('Expected an interval.')
    expect(difference.value.equals(direct.value)).toBe(true)
    expect(difference.spelling?.raw).toBe('P4.5')
  })

  it('derives traditional quality and direction from pitch differences', () => {
    const descending = evaluate('C - D')
    const altered = evaluate('Eb - C')

    expect(descending.kind === 'pitchOffset' && descending.spelling).toMatchObject({
      quality: 'M',
      number: 2n,
      direction: 'descending',
    })
    expect(altered.kind === 'pitchOffset' && altered.spelling).toMatchObject({
      quality: 'm',
      number: 3n,
    })
  })

  it('supports neutral intervals and half accidentals', () => {
    expect(evaluate('n3').value.equals(Value.pitch(new Value(3n, 2n)).div(new Value(2)))).toBe(true)
    expect(
      evaluate('n4').value.equals(
        Value.pitch(new Value(3).pow(new Value(5n, 2n)).div(new Value(2).pow(new Value(7n, 2n)))),
      ),
    ).toBe(true)
    expect(evaluate('SA4').value.equals(evaluate('n4').value)).toBe(true)
    expect(evaluate('sd5').value.equals(evaluate('n5').value)).toBe(true)
    expect(evaluate('SAA4').spelling?.quality).toBe('SAA')
    expect(evaluate('sdd5').spelling?.quality).toBe('sdd')
    const halfSharp = evaluate('Ct')
    if (halfSharp.kind !== 'absolutePitch') throw new Error('Expected a pitch.')
    expect(
      halfSharp.rootOffset.equals(Value.pitch(new Value(2187n, 2048n)).div(new Value(2))),
    ).toBe(true)
  })

  it('retains named interval spelling when negating an interval', () => {
    const interval = evaluate('-n3')

    expect(interval.kind).toBe('pitchOffset')
    expect(interval.value.equals(Value.pitch(new Value(3n, 2n)).div(new Value(2)).neg())).toBe(true)
    expect(interval.kind === 'pitchOffset' && interval.spelling?.raw).toBe('n3')
    expect(interval.kind === 'pitchOffset' && interval.spelling?.direction).toBe('descending')
  })

  it('applies the Xenpaper 2 default up and lift offsets', () => {
    const up = evaluate('^C')
    const lift = evaluate('/C')
    if (up.kind !== 'absolutePitch' || lift.kind !== 'absolutePitch')
      throw new Error('Expected pitches.')
    expect(up.rootOffset.equals(Value.pitch(new Value(243n, 242n)).div(2))).toBe(true)
    expect(lift.rootOffset.equals(Value.pitch(new Value(50n, 49n)).div(2))).toBe(true)
  })

  it('reassociates a spelled pitch with the root', () => {
    const change = parse('{A = root}').body[0]
    if (change.type !== 'PitchContextChange') throw new Error('Expected a context change.')
    const context = applyPitchContextChange(change, DEFAULT_PITCH_CONTEXT)
    const a = evaluateExpression(expression('A'), context)
    const b = evaluateExpression(expression('B'), context)
    if (
      !('value' in a) ||
      a.value.kind !== 'absolutePitch' ||
      !('value' in b) ||
      b.value.kind !== 'absolutePitch'
    )
      throw new Error('Expected pitches.')
    expect(a.value.rootOffset.equals(Value.cents(0))).toBe(true)
    expect(b.value.rootOffset.equals(Value.pitch(new Value(9n, 8n)))).toBe(true)
  })

  it('moves the root frequency when assigning a pitch to root', () => {
    const change = parse('{root = D}').body[0]
    if (change.type !== 'PitchContextChange') throw new Error('Expected a context change.')
    const context = applyPitchContextChange(change, DEFAULT_PITCH_CONTEXT)
    const c = evaluateExpression(expression('C'), context)
    const d = evaluateExpression(expression('D'), context)
    if (
      !('value' in c) ||
      c.value.kind !== 'absolutePitch' ||
      !('value' in d) ||
      d.value.kind !== 'absolutePitch'
    )
      throw new Error('Expected pitches.')
    expect(context.rootDisplacement.equals(Value.pitch(new Value(9n, 8n)))).toBe(true)
    expect(c.value.rootOffset.equals(Value.cents(0))).toBe(true)
    expect(d.value.rootOffset.equals(Value.pitch(new Value(9n, 8n)))).toBe(true)
  })

  it('applies FJS inflections and normalizes scaled interval spelling', () => {
    const e5 = evaluate('E^5')
    if (e5.kind !== 'absolutePitch') throw new Error('Expected a pitch.')
    expect(e5.rootOffset.equals(Value.pitch(new Value(5n, 4n)))).toBe(true)

    const doubled = evaluate('2 * m3v5')
    expect(doubled.kind).toBe('pitchOffset')
    if (doubled.kind !== 'pitchOffset') throw new Error('Expected an interval.')
    expect(doubled.value.equals(Value.pitch(new Value(36n, 25n)))).toBe(true)
    expect(doubled.spelling?.raw).toBe('d5v25')

    const neutralMultiples = Array.from({ length: 14 }, (_, index) => evaluate(`${index + 1} * n3`))
    expect(
      neutralMultiples.every((interval) => interval.kind === 'pitchOffset' && interval.spelling),
    ).toBe(true)
    expect(neutralMultiples.map((interval) => interval.spelling?.quality)).toEqual([
      'n',
      'P',
      'n',
      'M',
      'SA',
      'M',
      'SA',
      'M',
      'SA',
      'M',
      'SA',
      'A',
      'SA',
      'A',
    ])
    expect(evaluate('19 * n3 - 5 * P8').spelling?.raw).toBe('SAA4')
    expect(evaluate('6 * P8 - 19 * n3').spelling?.raw).toBe('sdd5')
  })

  it('groups two-digit products in generated FJS inflections', () => {
    const products = [25n, 35n, 49n, 55n, 65n, 77n, 85n, 91n, 95n]
    const factors = [
      [5n, 5n],
      [5n, 7n],
      [7n, 7n],
      [5n, 11n],
      [5n, 13n],
      [7n, 11n],
      [5n, 17n],
      [7n, 13n],
      [5n, 19n],
    ]
    expect(
      factors.map(([left, right]) =>
        groupFjsInflections([
          { direction: 'denominator', prime: left! },
          { direction: 'denominator', prime: right! },
        ]),
      ),
    ).toEqual(products.map((prime) => [{ direction: 'denominator', prime }]))
  })

  it('factors FJS labels, ignores 2- and 3-limit factors, and supports neutral FJS', () => {
    const fraction = evaluate('Eb^6v5')
    if (fraction.kind !== 'absolutePitch') throw new Error('Expected a pitch.')
    expect(fraction.rootOffset.equals(Value.pitch(new Value(6n, 5n)))).toBe(true)

    expect(evaluate('n3^11n').value.equals(Value.pitch(new Value(11n, 9n)))).toBe(true)
    const absolute = evaluate('Ed^11n')
    if (absolute.kind !== 'absolutePitch') throw new Error('Expected a pitch.')
    expect(absolute.rootOffset.equals(Value.pitch(new Value(11n, 9n)))).toBe(true)

    const highPrime = evaluate('P1^101')
    expect(highPrime.kind).toBe('pitchOffset')
    if (highPrime.kind !== 'pitchOffset') throw new Error('Expected an interval.')
    expect(highPrime.formula?.get(101)?.equals(1)).toBe(true)
  })
})
