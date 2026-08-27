import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { Value } from '../value'

function exactExponents(value: Value): ReadonlyMap<number, unknown> {
  if (value.magnitude.kind !== 'exact') throw new TypeError('Expected an exact value.')
  return value.magnitude.value.exponents
}

describe('Xenpaper value arithmetic', () => {
  it('adds integers exactly', () => {
    expect(new Value(5).add(7).equals(new Value(12))).toBe(true)
  })

  it('negates and subtracts exact values', () => {
    expect(new Value(2).neg().valueOf()).toBe(-2)
    expect(new Value(5).sub(2).equals(3)).toBe(true)
    expect(new Value(-2).neg().equals(2)).toBe(true)
  })

  it('evaluates negative exact values with one sign application', () => {
    expect(new Value(-2).valueOf()).toBe(-2)
    expect(new Value(-5).add(2).equals(-3)).toBe(true)
  })

  it('keeps exact zero and one identities usable', () => {
    const one = new Value(7).pow(0)
    const zero = new Value(7).mul(0)
    expect(one.valueOf()).toBe(1)
    expect(one.equals(1)).toBe(true)
    expect(zero.valueOf()).toBe(0)
    expect(zero.equals(0)).toBe(true)
  })

  it('handles the sign of odd-denominator rational powers separately', () => {
    expect(new Value(-8).pow(new Fraction(1, 3)).valueOf()).toBeCloseTo(-2)
    expect(new Value(-8).pow(new Fraction(2, 3)).valueOf()).toBeCloseTo(4)
  })

  it('divides fractions exactly', () => {
    const majorThird = new Value(new Fraction(81, 64))
    const syntonicComma = new Value(new Fraction(81, 80))
    expect(majorThird.div(syntonicComma).equals(new Value(new Fraction(5, 4)))).toBe(true)
  })

  it('calculates mathematical and geometric modulo', () => {
    expect(new Value(1_000_000_000).mmod(3).equals(1)).toBe(true)
    expect(new Value(2).reduce(new Fraction(3, 2)).equals(new Fraction(4, 3))).toBe(true)
  })

  it('makes progress when calculating modulo with real values', () => {
    const remainder = Value.real(1).mmod(Value.real(2 ** -100))
    expect(remainder.valueOf()).toBeGreaterThanOrEqual(0)
    expect(remainder.valueOf()).toBeLessThan(2 ** -100)
  })

  it('cancels huge exact interval stacks', () => {
    const archytas = new Value(new Fraction(64, 63))
    const unity = archytas
      .pow(100)
      .div(new Value(2).pow(600))
      .mul(new Value(7).pow(100))
      .mul(new Value(3).pow(200))
    expect(unity.equals(1)).toBe(true)
  })

  it('accepts bigint integers without retaining bigint state', () => {
    const huge = 2n ** 100n * 3n
    const value = new Value(huge)
    expect(value.equals(new Value(2).pow(100).mul(3))).toBe(true)
    expect(exactExponents(value)).toBeInstanceOf(Map)
  })

  it('accepts rational input as two bigints', () => {
    expect(new Value(81n, 64n).div(new Value(81n, 80n)).equals(new Fraction(5, 4))).toBe(true)
    expect(() => new Value(1n, 0n)).toThrow('Division by zero.')
  })

  it('stores high-prime factors sparsely', () => {
    const value = new Value(7919)
    expect(exactExponents(value)).toEqual(new Map([[7919, 1]]))
  })

  it('adds beat fractions to exact bar boundaries', () => {
    const cell = Value.beats(new Fraction(1, 12))
    expect(cell.mul(48).equals(Value.beats(4))).toBe(true)
  })

  it('converts beats through exact tempo dimensions', () => {
    const tempo = Value.beats(2).div(Value.seconds(1))
    expect(
      Value.beats(3)
        .div(tempo)
        .equals(Value.seconds(new Fraction(3, 2))),
    ).toBe(true)
  })

  it('falls back instead of constructing a symbolic radical sum', () => {
    const sum = new Value(2).pow(new Fraction(1, 2)).add(new Value(3).pow(new Fraction(1, 2)))
    expect(sum.isExact()).toBe(false)
    expect(sum.valueOf()).toBeCloseTo(Math.sqrt(2) + Math.sqrt(3))
  })

  it('falls back instead of constructing a non-algebraic radical', () => {
    const rad = new Value(2).pow(new Value(2).pow(new Fraction(1, 2)))
    expect(rad.isExact()).toBe(false)
    expect(rad.valueOf()).toBeCloseTo(2 ** (2 ** 0.5))
  })
})

describe('Pitch displacement arithmetic', () => {
  it('uses ordinary addition for cents', () => {
    expect(Value.cents(600).add(Value.cents(600)).equals(Value.cents(1200))).toBe(true)
  })

  it('evaluates huge exact pitch displacements in logarithmic space', () => {
    expect(Value.cents(2_400_000).valueOf()).toBe(2_400_000)
  })

  it('normalizes pitch(2) and 7\\12 to rational cents', () => {
    expect(Value.pitch(2).equals(Value.cents(1200))).toBe(true)
    expect(Value.cents(1200).equals(new Fraction(2, 1))).toBe(true)
    expect(Value.cents(1200).strictEquals(new Fraction(2, 1))).toBe(false)
    expect(Value.equalDivision(7, 12).equals(Value.cents(700))).toBe(true)
  })

  it('compares cents and ratios as pitch displacement', () => {
    expect(Value.cents(1200).equals(new Value(2))).toBe(true)
    expect(Value.cents(1201).equals(new Value(2))).toBe(false)
    expect(Value.cents(1200).compare(new Value(2))).toBe(0)
    expect(Value.cents(1199).compare(new Value(2))).toBeLessThan(0)
    expect(Value.cents(1201).compare(new Value(2))).toBeGreaterThan(0)
  })

  it('stacks thirteen equal tritave steps exactly', () => {
    const step = Value.equalDivision(1, 13, 3)
    expect(step.mul(13).equals(Value.pitch(3))).toBe(true)
    expect(Value.ratio(step).pow(13).equals(3)).toBe(true)
  })

  it('keeps huge non-octave equal-division stacks exact', () => {
    const stack = Value.equalDivision(1, 13, 3).mul(13_000)
    expect(Value.ratio(stack).equals(new Value(3).pow(1000))).toBe(true)
  })

  it('mixes rational cents with non-octave logarithmic terms exactly', () => {
    const mixed = Value.cents(700).add(Value.equalDivision(1, 13, 3))
    const expected = new Value(2)
      .pow(new Fraction(7, 12))
      .mul(new Value(3).pow(new Fraction(1, 13)))
    expect(Value.ratio(mixed).equals(expected)).toBe(true)
  })

  it('keeps the Pythagorean-vs-12EDO fifth error exact', () => {
    const error = Value.pitch(new Value(new Fraction(3, 2))).sub(Value.cents(700))
    expect(error.isExact()).toBe(true)
    expect(error.valueOf()).toBeCloseTo(1.955000865)
  })
})

describe('Other quantities', () => {
  it('retains monomial quantity magnitudes and fractional dimension powers', () => {
    const middleC = Value.hertz(new Value(440).div(new Value(2).pow(new Fraction(3, 4))))
    expect(middleC.isExact()).toBe(true)
    expect(middleC.mul(new Value(2).pow(new Fraction(3, 4))).equals(Value.hertz(440))).toBe(true)

    const rootSecond = Value.seconds(9).pow(new Fraction(1, 2))
    expect(rootSecond.isExact()).toBe(true)
    expect(rootSecond.dimensions.equals({ seconds: new Fraction(1, 2) })).toBe(true)
    expect(rootSecond.pow(2).equals(Value.seconds(9))).toBe(true)
    expect(rootSecond.dimensions.toString()).toBe('seconds^1/2')
  })

  it('keeps decibels unitful until explicitly divided', () => {
    const exponent = Value.decibels(2).div(Value.decibels(20))
    expect(new Value(10).pow(exponent).valueOf()).toBeCloseTo(1.2589254118)
  })

  it('does not use epsilon equality', () => {
    const exact = Value.cents(700)
    const approximate = Value.real(700.0000000001, { pitch: 1 })
    expect(exact.equals(approximate)).toBe(false)
    expect(exact.approximatelyEquals(approximate, Value.cents(new Fraction(1, 1_000_000)))).toBe(
      true,
    )
  })
})

describe('Nonsense', () => {
  it('throws when adding seconds to cents', () => {
    const duration = Value.seconds(2)
    const fourth = Value.cents(500)
    expect(() => duration.add(fourth)).toThrow(
      'Cannot add incompatible dimensions seconds and pitch.',
    )
    expect(() => fourth.add(duration)).toThrow(
      'Cannot add incompatible dimensions pitch and seconds.',
    )
  })

  it('throws when adding integers and cents', () => {
    const tritone = Value.cents(600)
    const three = new Value(3)
    expect(() => tritone.add(three)).toThrow('Cannot add incompatible dimensions pitch and 1.')
    expect(() => three.add(tritone)).toThrow('Cannot add incompatible dimensions 1 and pitch.')
  })

  it('refuses to produce square cents', () => {
    const semitone = Value.cents(100)
    expect(() => semitone.mul(semitone)).toThrow(
      'Pitch displacements cannot be multiplied together.',
    )
    expect(() => semitone.pow(2)).toThrow('Pitch displacements cannot be exponentiated.')
  })
})
