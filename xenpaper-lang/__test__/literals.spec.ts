import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { parse } from '../parser.generated.js'
import { decimalFraction, evaluateLiteral, type NumericLiteralNode } from '../runtime/literals'
import { Value } from '../value'

function literal(source: string): NumericLiteralNode {
  const directive = parse(`@test(${source})`).body[0]
  if (directive.type !== 'Directive') throw new Error('Expected a directive.')
  return directive.arguments[0] as NumericLiteralNode
}

function value(source: string, equave?: Value): Value {
  const result = evaluateLiteral(literal(source), equave)
  expect(result.diagnostics).toEqual([])
  if (!('value' in result)) throw new Error('Expected a value.')
  return result.value.value
}

describe('numeric literal evaluation', () => {
  it('evaluates monzo literals in the prime and custom subgroups', () => {
    expect(value('[-4 4 -1>@').equals(Value.pitch(new Fraction(81, 80)))).toBe(true)
    expect(value('[1 -2 0 -2>@101.2..').equals(Value.pitch(new Fraction(101, 100)))).toBe(true)
    expect(
      value('[1/2>@4/9').equals(Value.pitch(new Value(new Fraction(4, 9)).pow(new Fraction(1, 2)))),
    ).toBe(true)
  })

  it('rejects subgroup continuation after a non-prime', () => {
    expect(evaluateLiteral(literal('[1 2>@4..'))).toMatchObject({
      diagnostics: [{ code: 'XP_LITERAL', message: expect.stringContaining('after a prime') }],
    })
    expect(evaluateLiteral(literal('[1 2>@7927..'))).toMatchObject({
      diagnostics: [{ code: 'XP_LITERAL', message: expect.stringContaining('supported range') }],
    })
    expect(evaluateLiteral(literal('[1 2>@7919..'))).toMatchObject({
      diagnostics: [
        { code: 'XP_LITERAL', message: expect.stringContaining('supported prime range') },
      ],
    })
  })
  it('constructs decimals exactly from their source digits', () => {
    expect(decimalFraction('1.95').equals(new Fraction(39, 20))).toBe(true)
    expect(decimalFraction('-0.125').equals(new Fraction(-1, 8))).toBe(true)
    expect(value('1.95e').equals(new Fraction(39, 20))).toBe(true)
  })

  it('constructs raw real literals without exact semantics', () => {
    const approximate = value('3.14159r')

    expect(approximate.magnitude).toEqual({ kind: 'real', value: 3.14159 })
    expect(approximate.equals(decimalFraction('3.14159'))).toBe(false)
  })

  it('constructs signed integers and ratios exactly', () => {
    expect(value('-1152921504606846976').equals(new Value(2).pow(60).neg())).toBe(true)
    expect(value('-81/64').equals(new Fraction(-81, 64))).toBe(true)
  })

  it.each([
    ['150c', Value.cents(150)],
    ['-6dB', Value.decibels(-6)],
    ['3beats', Value.beats(3)],
    ['1.5s', Value.seconds(new Fraction(3, 2))],
    ['250ms', Value.seconds(new Fraction(1, 4))],
    ['440Hz', Value.hertz(440)],
    ['1.25kHz', Value.hertz(1250)],
    ['12.5%', new Value(new Fraction(1, 8))],
  ])('evaluates %s without losing exactness', (source, expected) => {
    expect(value(source).strictEquals(expected)).toBe(true)
  })

  it('tags cents and equal divisions as pitch offsets', () => {
    const cents = evaluateLiteral(literal('100c'))
    const edo = evaluateLiteral(literal(String.raw`7\12`))

    expect('value' in cents && cents.value.kind).toBe('pitchOffset')
    expect('value' in edo && edo.value.kind).toBe('pitchOffset')
    expect('value' in cents && cents.value.origins).toMatchObject([{ role: 'literal' }])
  })

  it('evaluates signed equal divisions with an exact custom equave', () => {
    expect(value(String.raw`-1\13<3>`, new Value(3)).equals(Value.equalDivision(-1, 13, 3))).toBe(
      true,
    )
  })

  it('diagnoses zero divisions instead of throwing', () => {
    expect(evaluateLiteral(literal(String.raw`1\0`))).toMatchObject({
      diagnostics: [{ code: 'XP_DIVISION_BY_ZERO', severity: 'error' }],
    })
  })

  it('diagnoses a zero or unitful equave instead of throwing', () => {
    expect(evaluateLiteral(literal(String.raw`1\12<0>`), new Value(0))).toMatchObject({
      diagnostics: [{ code: 'XP_LITERAL' }],
    })
    expect(evaluateLiteral(literal(String.raw`1\12<1s>`), Value.seconds(1))).toMatchObject({
      diagnostics: [{ code: 'XP_LITERAL' }],
    })
  })
})
