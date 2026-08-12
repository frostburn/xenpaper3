import { valueToEquaveDivision } from 'xen-dev-utils/conversion'
import { Fraction } from 'xen-dev-utils/fraction'
import { PRIMES } from 'xen-dev-utils/primes'
import { Value } from '../value'
import type { PrimeMapping } from './types'

function primeAtWart(wart: string): number {
  const index = wart.toLowerCase().charCodeAt(0) - 97
  if (index < 0 || index > 14) throw new RangeError(`Unsupported val wart ${wart}.`)
  const prime = PRIMES[index]
  if (!prime) throw new RangeError(`Unsupported val wart ${wart}.`)
  return prime
}

function valuation(target: number, wartCount: number): number {
  const patent = Math.round(target)
  if (!wartCount) return patent
  const candidates = Array.from(
    { length: wartCount * 2 + 4 },
    (_, index) => patent + index - wartCount - 2,
  )
    .filter((candidate) => candidate !== patent)
    .sort((left, right) => Math.abs(left - target) - Math.abs(right - target) || left - right)
  return candidates[wartCount - 1]!
}

/** Construct a rank-1 val, including arbitrary repeated wart letters. */
export function valMapping(divisions: number, equave: number, warts = ''): PrimeMapping {
  if (!Number.isSafeInteger(divisions) || divisions <= 0)
    throw new RangeError('Val divisions must be a positive integer.')
  if (!Number.isSafeInteger(equave) || equave < 2)
    throw new RangeError('Val equave must be a prime of at least 2.')
  const counts = new Map<number, number>()
  for (const wart of warts) {
    const prime = primeAtWart(wart)
    counts.set(prime, (counts.get(prime) ?? 0) + 1)
  }
  return {
    id: `${warts}${divisions}ed${equave}`,
    mapPrime: (prime) => {
      const target = valueToEquaveDivision(prime, divisions, equave)
      const steps = prime === equave ? divisions : valuation(target, counts.get(prime) ?? 0)
      return Value.equalDivision(new Fraction(steps), new Fraction(divisions), new Value(equave))
    },
  }
}

/** Parse patent/wart and explicit equal-division val notation. */
export function parseVal(raw: string): {
  mapping: PrimeMapping
  divisions: number
  equave: number
} {
  const explicit = /^(\d+)ed(\d+)(?:\/(\d+))?$/i.exec(raw)
  if (explicit) {
    const numerator = Number(explicit[2])
    const denominator = Number(explicit[3] ?? 1)
    if (denominator !== 1)
      return {
        divisions: Number(explicit[1]),
        equave: numerator / denominator,
        mapping: equalDivisionRatioMapping(Number(explicit[1]), numerator, denominator),
      }
    const divisions = Number(explicit[1])
    return { mapping: valMapping(divisions, numerator), divisions, equave: numerator }
  }
  const match = /^([a-z]*)(\d+)([a-z]*)$/i.exec(raw)
  if (!match) throw new TypeError(`Unsupported val ${raw}.`)
  const prefix = match[1]!.toLowerCase()
  const suffix = match[3]!.toLowerCase()
  const divisions = Number(match[2])
  const equave = prefix ? primeAtWart(prefix[0]!) : 2
  const warts = prefix.slice(1) + suffix.replace(/p/g, '')
  return { mapping: valMapping(divisions, equave, warts), divisions, equave }
}

function equalDivisionRatioMapping(
  divisions: number,
  numerator: number,
  denominator: number,
): PrimeMapping {
  const equave = new Value(BigInt(numerator), BigInt(denominator))
  const equaveValue = numerator / denominator
  return {
    id: `${divisions}ed${numerator}/${denominator}`,
    mapPrime: (prime) =>
      Value.equalDivision(
        new Fraction(Math.round(valueToEquaveDivision(prime, divisions, equaveValue))),
        new Fraction(divisions),
        equave,
      ),
  }
}
