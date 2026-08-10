import { Fraction } from 'xen-dev-utils/fraction'
import type { FjsSpelling, PrimeMonzo } from './types'

export type FjsFlavor = '' | 'c' | 'n' | 'q' | 't' | 'h' | 'm'

export interface FjsInflectionInput {
  readonly direction: string
  readonly prime: string
  readonly flavor?: string
}

const FIFTH = 1200 * Math.log2(3 / 2)
const FOURTH = 1200 * Math.log2(4 / 3)
const FORMAL_RADIUS = 1200 * Math.log2(65 / 63)
const SEMIAPOTOME = 600 * Math.log2(2187 / 2048) + 1e-6
const cache = new Map<string, PrimeMonzo>()

/** Combine pairs of compatible FJS factors when their product remains a two-digit label. */
export function groupFjsInflections(inflections: readonly FjsSpelling[]): FjsSpelling[] {
  const result = inflections.map((inflection) => ({ ...inflection }))
  for (let left = 0; left < result.length; left++) {
    for (let right = left + 1; right < result.length; right++) {
      if (
        result[left]!.direction !== result[right]!.direction ||
        result[left]!.flavor !== result[right]!.flavor
      )
        continue
      const product = result[left]!.prime * result[right]!.prime
      if (product >= 100n) continue
      result[left] = { ...result[left]!, prime: product }
      result.splice(right, 1)
      break
    }
  }
  return result
}

function circleDistance(left: number, right: number) {
  const distance = Math.abs(left - right) % 1200
  return Math.min(distance, 1200 - distance)
}

function formalMaster(cents: number, radius: number): [number, number] {
  if (circleDistance(cents, 0) < radius) return [0, 0]
  for (let k = 1; ; k++) {
    if (circleDistance(cents, k * FIFTH) < radius) return [k, -k]
    if (circleDistance(cents, -k * FIFTH) < radius) return [-k, k]
  }
}

function neutralMaster(cents: number): [number, number] {
  for (let k = 0.5; ; k++) {
    if (circleDistance(cents, k * FIFTH) < 92.1) return [k, -k]
    if (circleDistance(cents, -k * FIFTH) < 92.1) return [-k, k]
  }
}

function semiquartalMaster(cents: number): [number, number] {
  for (let k = 0.5; ; k++) {
    if (circleDistance(cents, k * FOURTH) < 137.2) return [-k - 0.5, k]
    if (circleDistance(cents, -k * FOURTH) < 137.2) return [k + 0.5, -k]
  }
}

function toneSplitterMaster(cents: number): [number, number] {
  for (let k = 0.5; ; k++) {
    const center = 600 + (k - 0.5) * FIFTH
    if (circleDistance(cents, center) < 137.2) return [k, 0.5 - k]
    if (circleDistance(cents, -center) < 137.2) return [-k, k - 0.5]
  }
}

/** Superscript adjustment for a single prime in the requested FJS flavor. */
export function fjsPrimeComma(prime: number, flavor: FjsFlavor = ''): PrimeMonzo {
  if (!Number.isSafeInteger(prime) || prime < 5 || !isPrime(prime))
    throw new TypeError(`Invalid FJS prime ${prime}.`)
  const key = `${prime}:${flavor}`
  const cached = cache.get(key)
  if (cached) return cached
  const cents = 1200 * Math.log2(prime)
  let pair: [number, number]
  if (flavor === 'n') pair = neutralMaster(cents)
  else if (flavor === 'q') pair = semiquartalMaster(cents)
  else if (flavor === 't') pair = toneSplitterMaster(cents)
  else pair = formalMaster(cents, flavor === 'c' ? FORMAL_RADIUS : SEMIAPOTOME)
  let twos = pair[0]
  const threes = pair[1]
  let commaCents = cents + 1200 * twos + 1200 * Math.log2(3) * threes
  while (commaCents > 600) {
    commaCents -= 1200
    twos--
  }
  while (commaCents < -600) {
    commaCents += 1200
    twos++
  }
  const result = new Map<number, Fraction>([[prime, new Fraction(1)]])
  if (twos) result.set(2, new Fraction(twos))
  if (threes) result.set(3, new Fraction(threes))
  cache.set(key, result)
  return result
}

/** Factor an FJS label, deliberately ignoring its 2- and 3-limit factors. */
export function fjsInflection(value: number, flavor: FjsFlavor = ''): PrimeMonzo {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new TypeError(`Invalid FJS inflection ${value}.`)
  const result = new Map<number, Fraction>()
  let remaining = value
  for (let prime = 2; prime * prime <= remaining; prime++) {
    let exponent = 0
    while (remaining % prime === 0) {
      remaining /= prime
      exponent++
    }
    if (prime <= 3 || !exponent) continue
    for (const [component, amount] of fjsPrimeComma(prime, flavor)) {
      result.set(
        component,
        (result.get(component) ?? new Fraction(0)).add(new Fraction(amount).mul(exponent)),
      )
    }
  }
  if (remaining > 3) {
    for (const [component, amount] of fjsPrimeComma(remaining, flavor)) {
      result.set(component, (result.get(component) ?? new Fraction(0)).add(amount))
    }
  }
  return result
}

export function applyFjsInflections(
  result: Map<number, Fraction>,
  inflections: readonly FjsInflectionInput[],
) {
  for (const inflection of inflections) {
    const sign = inflection.direction === 'numerator' ? 1 : -1
    for (const [prime, exponent] of fjsInflection(
      Number(inflection.prime),
      (inflection.flavor ?? '') as FjsFlavor,
    )) {
      const combined = (result.get(prime) ?? new Fraction(0)).add(new Fraction(exponent).mul(sign))
      if (combined.n) result.set(prime, combined)
      else result.delete(prime)
    }
  }
}

function isPrime(value: number) {
  for (let divisor = 2; divisor * divisor <= value; divisor++)
    if (value % divisor === 0) return false
  return true
}
