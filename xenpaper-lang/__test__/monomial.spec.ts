import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { Monomial } from '../monomial'

describe('Exact monomial coordinates', () => {
  it('normalizes sparse coordinates and does not retain caller-owned maps', () => {
    const input = new Map<number, Fraction>([
      [2, new Fraction(1)],
      [3, new Fraction(0)],
    ])
    const coordinate = new Monomial(input)
    const cancelled = new Monomial([
      [2, 1],
      [2, -1],
    ])
    input.set(5, new Fraction(1))

    expect(coordinate.size).toBe(1)
    expect(cancelled.equals(Monomial.ZERO)).toBe(true)
    expect(coordinate.get(2)?.equals(1)).toBe(true)
    expect(coordinate.has(5)).toBe(false)
  })

  it('factors and reconstructs rational ratios exactly', () => {
    const comma = Monomial.fromRatio(new Fraction(81, 80))

    expect(comma.get(2)?.equals(-4)).toBe(true)
    expect(comma.get(3)?.equals(4)).toBe(true)
    expect(comma.get(5)?.equals(-1)).toBe(true)
    expect(comma.toFraction()?.equals(new Fraction(81, 80))).toBe(true)
  })

  it('adds, subtracts, and scales lattice coordinates', () => {
    const fifth = Monomial.fromRatio(new Fraction(3, 2))
    const fourth = Monomial.fromRatio(new Fraction(4, 3))

    expect(fifth.add(fourth).equals(Monomial.fromRatio(2))).toBe(true)
    expect(fifth.sub(fifth).equals(Monomial.ZERO)).toBe(true)
    expect(fifth.scale(2).equals(Monomial.fromRatio(new Fraction(9, 4)))).toBe(true)
  })

  it('represents equal divisions without choosing cents or a frequency reference', () => {
    const step = Monomial.equalDivision(1, 13, Monomial.fromRatio(3))

    expect(step.scale(13).equals(Monomial.fromRatio(3))).toBe(true)
    expect(step.toFraction()).toBeUndefined()
  })

  it('supports exact temperament mappings without leaving the lattice', () => {
    const fifth = Monomial.fromRatio(new Fraction(3, 2))
    const mapped = fifth.remap((prime) =>
      prime === 3 ? Monomial.equalDivision(19, 31) : Monomial.fromRatio(prime),
    )

    expect(mapped.equals(Monomial.equalDivision(-12, 31))).toBe(true)
  })

  it('projects through an explicitly supplied logarithmic prime mapping', () => {
    const fifth = Monomial.fromRatio(new Fraction(3, 2))
    const projected = fifth.project((prime) => Math.log2(prime))

    expect(projected).toBeCloseTo(Math.log2(3 / 2))
    expect(fifth.ratioValue()).toBeCloseTo(3 / 2)
  })

  it('rejects invalid axes and non-positive ratios', () => {
    expect(() => new Monomial([[4, 1]])).toThrow('positive primes')
    expect(() => Monomial.fromRatio(0)).toThrow()
    expect(() => Monomial.fromRatio(-1)).toThrow()
  })
})
