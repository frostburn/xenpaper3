import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { parse, type Expression } from '../parser.generated.js'
import { evaluateExpression } from '../runtime/expressions'
import { fjsInflection, groupFjsInflections } from '../runtime/fjs'
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
  it('retains Diamond-MOS interval spelling when subtracting MOS pitches', () => {
    const declaration = parse('MOS{5L2s}').body[0]
    if (declaration.type !== 'PitchContextChange') throw new Error('Expected a MOS declaration.')
    const context = applyPitchContextChange(declaration)
    const difference = evaluateExpression(expression('K - J'), context)

    expect(difference.diagnostics).toEqual([])
    if (!('value' in difference) || difference.value.kind !== 'pitchOffset')
      throw new Error('Expected a MOS pitch offset.')
    expect(difference.value.spelling).toMatchObject({
      quality: 'M',
      number: 1n,
      raw: 'M1ms',
    })
  })

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

  it('tempers ratios and converts them to pitch offsets', () => {
    const tempered = evaluateExpression(expression('~81/64'), edoMapping(12))
    expect(tempered.diagnostics).toEqual([])
    if (!('value' in tempered)) throw new Error('Expected a value.')
    expect(tempered.value.kind).toBe('pitchOffset')
    expect(tempered.value.value.equals(Value.cents(400))).toBe(true)

    const radical = evaluateExpression(expression('~sqrt(2)'), edoMapping(12))
    expect(radical.diagnostics).toEqual([])
    if (!('value' in radical)) throw new Error('Expected a value.')
    expect(radical.value.value.equals(Value.cents(600))).toBe(true)

    const underflow = evaluate('~(2 ** -2000)')
    expect(underflow.kind).toBe('pitchOffset')
    expect(underflow.value.equals(Value.pitch(new Value(2).pow(-2000)))).toBe(true)

    const sum = evaluate('~3/2 + ~3/2')
    expect(sum.kind).toBe('pitchOffset')
    expect(sum.value.equals(Value.pitch(new Value(9n, 4n)))).toBe(true)
  })

  it('supports exact scalar arithmetic and right-associative powers', () => {
    expect(evaluate('(5/2 - 1/2) * 3/4').value.equals(new Fraction(3, 2))).toBe(true)
    expect(evaluate('2 ** 3 ** 2').value.equals(512)).toBe(true)
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

    const duration = evaluate('sqrt(4 * 1s**2)')
    expect(duration.value.equals(Value.seconds(2))).toBe(true)
  })

  it('applies pitch operators uniformly without coercing scalars to pitches', () => {
    expect(evaluate("'sqrt(2)").value.equals(evaluate('sqrt(8)').value)).toBe(true)
    const up = evaluate('^3/2')
    expect(up.kind).toBe('scalar')
    expect(up.value.equals(new Value(3n, 2n).mul(Value.ratio(DEFAULT_PITCH_CONTEXT.up)))).toBe(true)
    expect(up.origins.map((origin) => origin.role)).toEqual(['literal', 'operator'])
  })

  it('keeps the written octave separate from a custom degree equave', () => {
    const change = parse('{3/2}').body[0]
    if (change.type !== 'PitchContextChange') throw new Error('Expected a pitch context change.')
    const context = applyPitchContextChange(change, DEFAULT_PITCH_CONTEXT)
    const customEvaluate = (source: string) => {
      const result = evaluateExpression(expression(source), context)
      expect(result.diagnostics).toEqual([])
      if (!('value' in result)) throw new Error('Expected a value.')
      return result.value
    }

    const pitch = customEvaluate("'G")
    expect(pitch.kind === 'absolutePitch' && pitch.spelling).toMatchObject({
      nominal: 'G',
      modifiers: ['equaveUp'],
    })
    const lowerC = customEvaluate("'C")
    const upperC = customEvaluate('c')
    expect(lowerC.kind === 'absolutePitch' && lowerC.rootOffset.equals(Value.cents(1200))).toBe(
      true,
    )
    expect(
      lowerC.kind === 'absolutePitch' &&
        upperC.kind === 'absolutePitch' &&
        lowerC.rootOffset.equals(upperC.rootOffset),
    ).toBe(true)
    const interval = customEvaluate("'P5")
    expect(interval.kind === 'pitchOffset' && interval.spelling).toMatchObject({
      quality: 'P',
      number: 5n,
      modifiers: ['equaveUp'],
    })
    expect(interval.value.equals(Value.pitch(new Value(3)))).toBe(true)
    const ratio = customEvaluate("'3/2")
    expect(ratio.kind).toBe('scalar')
    expect(ratio.value.equals(new Value(9n, 4n))).toBe(true)
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

  it('adds relative intervals to absolute pitches in either order', () => {
    for (const source of ['C + P5', 'P5 + C']) {
      const pitch = evaluate(source)

      expect(pitch.kind).toBe('absolutePitch')
      expect(
        pitch.kind === 'absolutePitch' && pitch.rootOffset.equals(Value.pitch(new Value(3n, 2n))),
      ).toBe(true)
      expect(pitch.kind === 'absolutePitch' && pitch.spelling).toMatchObject({ nominal: 'G' })
    }
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
    const compoundDescending = evaluate("C - 'D")
    const loweredRight = evaluate('C - `D')

    expect(descending.kind === 'pitchOffset' && descending.spelling).toMatchObject({
      quality: 'M',
      number: 2n,
      direction: 'descending',
    })
    expect(altered.kind === 'pitchOffset' && altered.spelling).toMatchObject({
      quality: 'm',
      number: 3n,
    })
    expect(compoundDescending.kind === 'pitchOffset' && compoundDescending.spelling).toMatchObject({
      quality: 'M',
      number: 9n,
      direction: 'descending',
    })
    expect(loweredRight.kind === 'pitchOffset' && loweredRight.spelling).toMatchObject({
      quality: 'm',
      number: 7n,
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
    const change = parse('{A as root}').body[0]
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
    const middleC = Value.hertz(new Value(440).div(new Value(2).pow(new Fraction(3, 4))))
    expect(context.rootFrequency.equals(middleC)).toBe(true)
  })

  it.each(["{root as 'A}", "{'A as root}"])(
    'reassociates an octave-shifted nominal with the root using %s',
    (source) => {
      const change = parse(source).body[0]
      if (change.type !== 'PitchContextChange') throw new Error('Expected a context change.')
      const context = applyPitchContextChange(change, DEFAULT_PITCH_CONTEXT)
      const unshiftedChange = parse('{A as root}').body[0]
      if (unshiftedChange.type !== 'PitchContextChange')
        throw new Error('Expected a context change.')
      const unshifted = applyPitchContextChange(unshiftedChange, DEFAULT_PITCH_CONTEXT)
      expect(context.rootPitch.spelling.raw).toBe("'A")
      expect(
        context.rootPitch.rootOffset.sub(unshifted.rootPitch.rootOffset).equals(Value.cents(1200)),
      ).toBe(true)
    },
  )

  it('reassociates a Diamond-MOS pitch with the root', () => {
    const declaration = parse('MOS{5L2s 5|1; L=9/8}').body[0]
    if (declaration.type !== 'PitchContextChange') throw new Error('Expected a MOS declaration.')
    const mosContext = applyPitchContextChange(declaration, DEFAULT_PITCH_CONTEXT)
    expect(mosContext.up).toBe(DEFAULT_PITCH_CONTEXT.up)
    expect(mosContext.lift).toBe(DEFAULT_PITCH_CONTEXT.lift)
    expect(mosContext.mos?.up).toBeUndefined()
    expect(mosContext.mos?.lift).toBeUndefined()
    const change = parse('{K as root}').body[0]
    if (change.type !== 'PitchContextChange') throw new Error('Expected a context change.')
    const context = applyPitchContextChange(change, mosContext)
    const j = evaluateExpression(expression('J'), context)
    const k = evaluateExpression(expression('K'), context)
    if (
      !('value' in j) ||
      j.value.kind !== 'absolutePitch' ||
      !('value' in k) ||
      k.value.kind !== 'absolutePitch'
    )
      throw new Error('Expected pitches.')
    expect(k.value.rootOffset.equals(Value.cents(0))).toBe(true)
    expect(j.value.rootOffset.equals(Value.pitch(new Value(8n, 9n)))).toBe(true)
  })

  it('uses a pitch frequency assignment as a root frequency and spelling shorthand', () => {
    const shorthand = parse('{A = 440Hz}').body[0]
    const expanded = parse('{root = 440Hz; A as root}').body[0]
    if (shorthand.type !== 'PitchContextChange' || expanded.type !== 'PitchContextChange')
      throw new Error('Expected context changes.')

    const shorthandContext = applyPitchContextChange(shorthand, DEFAULT_PITCH_CONTEXT)
    const expandedContext = applyPitchContextChange(expanded, DEFAULT_PITCH_CONTEXT)

    expect(shorthandContext.rootFrequency.equals(expandedContext.rootFrequency)).toBe(true)
    expect(shorthandContext.rootDisplacement.equals(expandedContext.rootDisplacement)).toBe(true)
    expect(shorthandContext.rootPitch.rootOffset.equals(expandedContext.rootPitch.rootOffset)).toBe(
      true,
    )
    expect(shorthandContext.rootPitch.spelling).toEqual(expandedContext.rootPitch.spelling)
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
    const expectedFrequency = Value.hertz(
      new Value(440).div(new Value(2).pow(new Fraction(3, 4))).mul(new Fraction(9, 8)),
    )
    expect(context.rootFrequency.equals(expectedFrequency)).toBe(true)
    expect(c.value.rootOffset.equals(Value.cents(0))).toBe(true)
    expect(d.value.rootOffset.equals(Value.pitch(new Value(9n, 8n)))).toBe(true)
  })

  it('normalizes a root frequency ratio against the current frequency', () => {
    const change = parse('{root = 8/9}').body[0]
    if (change.type !== 'PitchContextChange') throw new Error('Expected a context change.')

    const context = applyPitchContextChange(change, DEFAULT_PITCH_CONTEXT)

    expect(
      context.rootFrequency.equals(DEFAULT_PITCH_CONTEXT.rootFrequency.mul(new Fraction(8, 9))),
    ).toBe(true)
    expect(context.rootDisplacement.equals(Value.pitch(new Value(8n, 9n)))).toBe(true)
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

  it('supports Helmholtz-Ellis, HEWM53, Lumi, and syntonic-rastmic FJS', () => {
    expect(fjsInflection(5, 'h')).toEqual(
      new Map([
        [2, new Fraction(-4)],
        [3, new Fraction(4)],
        [5, new Fraction(-1)],
      ]),
    )
    expect(fjsInflection(17, 'm')).toEqual(
      new Map([
        [2, new Fraction(1)],
        [3, new Fraction(2)],
        [17, new Fraction(-1)],
      ]),
    )

    // Lumi and syntonic-rastmic labels stack digit commas instead of factoring the label.
    expect(fjsInflection(12, 'l')).toEqual(
      new Map([
        [2, new Fraction(-19, 4)],
        [3, new Fraction(15, 4)],
        [5, new Fraction(1)],
        [11, new Fraction(-1)],
      ]),
    )
    expect(fjsInflection(12, 's')).toEqual(
      new Map([
        [2, new Fraction(-3, 2)],
        [3, new Fraction(15, 2)],
        [11, new Fraction(-3)],
      ]),
    )

    expect(expression('P1^12l')).toMatchObject({ inflections: [{ prime: '12', flavor: 'l' }] })
    expect(expression('P1v12s')).toMatchObject({ inflections: [{ prime: '12', flavor: 's' }] })
  })
})
