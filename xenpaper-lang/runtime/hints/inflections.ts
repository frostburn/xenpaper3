import { valueToCents } from 'xen-dev-utils/conversion'
import { circleDistance } from 'xen-dev-utils/core'
import { toMonzo, type Monzo } from 'xen-dev-utils/monzo'
import { PRIME_CENTS } from 'xen-dev-utils/primes'

import type { InflectionFlavorType, InflectionType } from '../grammar.generated'
import {
  getHelmholtzEllisComma,
  getHewm53Comma,
  getLumisComma,
  getSyntonicRastmicComma,
} from './extra-commas'

const RADIUS_OF_TOLERANCE = valueToCents(65 / 63)
const SEMIAPOTOME = 0.5 * valueToCents(2187 / 2048) + 1e-6
const NEUTRAL_BRIDGING_RADIUS = 92.1
const SEMIQUARTAL_BRIDGING_RADIUS = 137.2
const TONE_SPLITTER_BRIDGING_RADIUS = SEMIQUARTAL_BRIDGING_RADIUS
const FIFTH = PRIME_CENTS[1]! - PRIME_CENTS[0]!
const FOURTH = 2 * PRIME_CENTS[0]! - PRIME_CENTS[1]!
const OCTAVE = PRIME_CENTS[0]!
const commaCache = new Map<string, Monzo>()

const formalMaster = (primeCents: number, radius = RADIUS_OF_TOLERANCE): [number, number] => {
  let pythagoras = 0
  let k = 0
  if (circleDistance(primeCents, pythagoras) < radius) return [k, -k]

  while (true) {
    pythagoras += FIFTH
    k++
    if (circleDistance(primeCents, pythagoras) < radius) return [k, -k]
    if (circleDistance(primeCents, -pythagoras) < radius) return [-k, k]
  }
}

const neutralMaster = (primeCents: number): [number, number] => {
  let pythagoras = 0.5 * FIFTH
  let k = 0.5
  while (true) {
    if (circleDistance(primeCents, pythagoras) < NEUTRAL_BRIDGING_RADIUS) return [k, -k]
    if (circleDistance(primeCents, -pythagoras) < NEUTRAL_BRIDGING_RADIUS) return [-k, k]
    pythagoras += FIFTH
    k++
  }
}

const semiquartalMaster = (primeCents: number): [number, number] => {
  let pythagoras = 0.5 * FOURTH
  let k = 0.5
  while (true) {
    if (circleDistance(primeCents, pythagoras) < SEMIQUARTAL_BRIDGING_RADIUS) return [-k - 0.5, k]
    if (circleDistance(primeCents, -pythagoras) < SEMIQUARTAL_BRIDGING_RADIUS) return [k + 0.5, -k]
    pythagoras += FOURTH
    k++
  }
}

const toneSplitterMaster = (primeCents: number): [number, number] => {
  let pythagoras = 0.5 * OCTAVE
  let k = 0.5
  while (true) {
    if (circleDistance(primeCents, pythagoras) < TONE_SPLITTER_BRIDGING_RADIUS) return [k, 0.5 - k]
    if (circleDistance(primeCents, -pythagoras) < TONE_SPLITTER_BRIDGING_RADIUS)
      return [-k, k - 0.5]
    pythagoras += FIFTH
    k++
  }
}

const getCommaMonzo = (primeIndex: number, flavor: InflectionFlavorType): Monzo => {
  if (primeIndex < 2) return []

  const cacheKey = `${primeIndex}:${flavor}`
  const cached = commaCache.get(cacheKey)
  if (cached) return cached

  if (flavor === 'h') {
    const comma = getHelmholtzEllisComma(primeIndex)
    commaCache.set(cacheKey, comma)
    return comma
  }
  if (flavor === 'm') {
    const comma = getHewm53Comma(primeIndex)
    commaCache.set(cacheKey, comma)
    return comma
  }

  const master =
    flavor === 'n'
      ? neutralMaster
      : flavor === 'q'
        ? semiquartalMaster
        : flavor === 't'
          ? toneSplitterMaster
          : flavor === 'c'
            ? (primeCents: number) => formalMaster(primeCents)
            : (primeCents: number) => formalMaster(primeCents, SEMIAPOTOME)

  const [initialTwos, threes] = master(PRIME_CENTS[primeIndex]!)
  let twos = initialTwos
  let commaCents = PRIME_CENTS[primeIndex]! + twos * PRIME_CENTS[0]! + threes * PRIME_CENTS[1]!
  while (commaCents > 600) {
    commaCents -= PRIME_CENTS[0]!
    twos--
  }
  while (commaCents < -600) {
    commaCents += PRIME_CENTS[0]!
    twos++
  }

  const result = Array(primeIndex + 1).fill(0) as Monzo
  result[0] = twos
  result[1] = threes
  result[primeIndex] = 1
  commaCache.set(cacheKey, result)
  return result
}

const inflectionToMonzo = ({ value, flavor }: InflectionType): Monzo => {
  if (flavor === 'l') {
    return getLumisComma(value)
  }
  if (flavor === 's') {
    return getSyntonicRastmicComma(value)
  }

  const result: Monzo = []
  const valueMonzo = toMonzo(value)
  for (let index = 0; index < valueMonzo.length; index++) {
    const exponent = valueMonzo[index] ?? 0
    if (!exponent) continue
    const comma = getCommaMonzo(index, flavor)
    for (let commaIndex = 0; commaIndex < comma.length; commaIndex++) {
      result[commaIndex] = (result[commaIndex] ?? 0) + (comma[commaIndex] ?? 0) * exponent
    }
  }
  return result
}

export const applyFjsInflections = (monzo: Monzo, inflections: InflectionType[]): Monzo => {
  const result = monzo.slice()
  for (const inflection of inflections) {
    const comma = inflectionToMonzo(inflection)
    const direction = inflection.type === 'superscript' ? 1 : -1
    for (let index = 0; index < comma.length; index++) {
      result[index] = (result[index] ?? 0) + direction * (comma[index] ?? 0)
    }
  }
  return result
}
