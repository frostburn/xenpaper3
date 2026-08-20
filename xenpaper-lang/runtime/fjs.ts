import { circleDistance } from 'xen-dev-utils/core'
import { valueToCents } from 'xen-dev-utils/conversion'
import { Fraction } from 'xen-dev-utils/fraction'
import { accumulate, toMonzo, type Monzo } from 'xen-dev-utils/monzo'
import { isPrime, PRIMES } from 'xen-dev-utils/primes'
import type { FjsSpelling, PrimeMonzo } from './types'

export type FjsFlavor = '' | 'c' | 'n' | 'q' | 't' | 'h' | 'm' | 'l' | 's'

export interface FjsInflectionInput {
  readonly direction: string
  readonly prime: string
  readonly flavor?: string
}

const FIFTH = valueToCents(3 / 2)
const FOURTH = valueToCents(4 / 3)
const TRITAVE = valueToCents(3)
const FORMAL_RADIUS = valueToCents(65 / 63)
const SEMIAPOTOME = valueToCents(2187 / 2048) / 2 + 1e-6
const cache = new Map<string, PrimeMonzo>()

const SYNTONIC_RASTMIC = new Map<string, Monzo>([
  ['1', [-1 / 2, 5 / 2, 0, 0, -1]],
  ['2', [-1, 5, 0, 0, -2]],
  ['4', [-2, 10, 0, 0, -4]],
  ['8', [-4, 20, 0, 0, -8]],
  ['3', [-2, 2, -1 / 2]],
  ['6', [-4, 4, -1]],
  ['9', [-6, 6, -3 / 2]],
])

const LUMI = new Map<string, Monzo>([
  ['0', [-25 / 4, 17 / 4, 1, -1]],
  ['1', [3 / 4, 1 / 4, 1, 0, -1]],
  ['2', [-11 / 2, 7 / 2]],
  ['3', [1, -3 / 2, -1, 0, 0, 1]],
  ['4', [-9 / 2, 4, -2, 1]],
  ['5', [1 / 2, 0, 1, -1]],
  ['6', [1 / 3, -5 / 3, 1]],
  ['7', [5 / 3, -1 / 3, 1, 0, -1]],
  ['8', [5 / 2, -1, 0, 1, 0, -1]],
  ['9', [9 / 5, -13 / 5, 1]],
])

const HELMHOLTZ_ELLIS = new Map<number, string>([
  [5, '81/80'],
  [7, '64/63'],
  [11, '33/32'],
  [13, '27/26'],
  [17, '2187/2176'],
  [19, '513/512'],
  [23, '736/729'],
  [29, '261/256'],
  [31, '32/31'],
  [37, '37/36'],
  [41, '82/81'],
  [43, '129/128'],
  [47, '752/729'],
  [53, '54/53'],
  [59, '243/236'],
  [61, '244/243'],
  [67, '2187/2144'],
  [71, '72/71'],
  [73, '73/72'],
  [79, '81/79'],
  [83, '256/249'],
  [89, '729/712'],
])

const HEWM53 = new Map<number, string>([
  [5, '81/80'],
  [7, '64/63'],
  [11, '33/32'],
  [13, '27/26'],
  [17, '18/17'],
  [19, '19/18'],
  [23, '24/23'],
  [29, '261/256'],
  [31, '32/31'],
  [37, '37/36'],
  [41, '82/81'],
  [43, '129/128'],
  [47, '48/47'],
  [53, '54/53'],
])

function monzoToPrimeMonzo(monzo: Monzo): PrimeMonzo {
  const result = new Map<number, Fraction>()
  monzo.forEach((exponent, index) => {
    if (exponent) result.set(PRIMES[index]!, new Fraction(exponent))
  })
  return result
}

function digitComma(value: number, commas: Map<string, Monzo>): PrimeMonzo {
  if (!Number.isSafeInteger(value) || value < 0) return new Map()
  const result: Monzo = []
  for (const digit of value.toString()) {
    const comma = commas.get(digit)
    if (!comma) continue
    while (result.length < comma.length) result.push(0)
    accumulate(result, comma)
  }
  return monzoToPrimeMonzo(result)
}

/** Combine pairs of compatible FJS factors when their product remains a two-digit label. */
export function groupFjsInflections(inflections: readonly FjsSpelling[]): FjsSpelling[] {
  const result = inflections.map((inflection) => ({ ...inflection }))
  for (let left = 0; left < result.length; left++) {
    // 11² is already > 100
    if (result[left]!.prime > 7n) continue
    for (let right = left + 1; right < result.length; right++) {
      // 5*23 is already > 100
      if (result[right]!.prime > 19n) continue
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

function formalMaster(cents: number, radius: number): [number, number] {
  if (circleDistance(cents, 0) < radius) return [0, 0]
  for (let k = 1; ; k++) {
    if (circleDistance(cents, k * FIFTH) < radius) return [k, -k]
    if (circleDistance(cents, -k * FIFTH) < radius) return [-k, k]
  }
}

// Bridging radius tweaked manually to be as large as possible without disrupting original NFJS commas.
function neutralMaster(cents: number): [number, number] {
  for (let k = 0.5; ; k++) {
    if (circleDistance(cents, k * FIFTH) < 92.1) return [k, -k]
    if (circleDistance(cents, -k * FIFTH) < 92.1) return [-k, k]
  }
}

// Bridging radius tweaked manually to align with harmonic segments preferring the large limma.
function semiquartalMaster(cents: number): [number, number] {
  for (let k = 0.5; ; k++) {
    if (circleDistance(cents, k * FOURTH) < 137.2) return [-k - 0.5, k]
    if (circleDistance(cents, -k * FOURTH) < 137.2) return [k + 0.5, -k]
  }
}

// Bridging radius pulled out of a hat.
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
  if (flavor === 'h' || flavor === 'm') {
    const ratio = (flavor === 'h' ? HELMHOLTZ_ELLIS : HEWM53).get(prime)
    const result = ratio ? monzoToPrimeMonzo(toMonzo(ratio)) : new Map<number, Fraction>()
    cache.set(key, result)
    return result
  }
  const cents = valueToCents(prime)
  let pair: [number, number]
  if (flavor === 'n') pair = neutralMaster(cents)
  else if (flavor === 'q') pair = semiquartalMaster(cents)
  else if (flavor === 't') pair = toneSplitterMaster(cents)
  else pair = formalMaster(cents, flavor === 'c' ? FORMAL_RADIUS : SEMIAPOTOME)
  let twos = pair[0]
  const threes = pair[1]
  let commaCents = cents + 1200 * twos + TRITAVE * threes
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
  const digitFlavor = flavor === 'l' || flavor === 's'
  if (!Number.isSafeInteger(value) || value < 0 || (!digitFlavor && value < 1))
    throw new TypeError(`Invalid FJS inflection ${value}.`)
  if (flavor === 'l') return digitComma(value, LUMI)
  if (flavor === 's') return digitComma(value, SYNTONIC_RASTMIC)
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
