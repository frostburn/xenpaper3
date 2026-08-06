import { Fraction } from 'xen-dev-utils/fraction'
import type { IntervalLiteral, PitchLiteral } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import type {
  AbsolutePitchValue,
  PitchOffsetValue,
  PrimeMapping,
  PrimeMonzo,
  SourceOrigin,
} from './types'

export const DEFAULT_MAPPING: PrimeMapping = {
  id: 'untempered',
  mapPrime: (prime) => Value.pitch(new Value(BigInt(prime))),
}

/** Equal-temperament patent-val mapping (prime 2 is exactly the equave). */
export function edoMapping(divisions: number): PrimeMapping {
  if (!Number.isSafeInteger(divisions) || divisions <= 0) throw new RangeError('EDO divisions must be a positive integer.')
  return {
    id: `${divisions}edo`,
    mapPrime: (prime) => Value.cents(new Fraction(Math.round(divisions * Math.log2(prime)) * 1200, divisions)),
  }
}

function formula(entries: readonly (readonly [number, number])[]): Map<number, Fraction> {
  return new Map(entries.filter(([, exponent]) => exponent).map(([prime, exponent]) => [prime, new Fraction(exponent)]))
}

const NOMINALS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  C: [], D: [[2, -3], [3, 2]], E: [[2, -6], [3, 4]], F: [[2, 2], [3, -1]],
  G: [[2, -1], [3, 1]], A: [[2, -4], [3, 3]], B: [[2, -7], [3, 5]],
}

// Greek nominals interleave the diatonic chain at half-octave positions.  The
// final four are manual semiquartal spellings retained by the historical
// Xenpaper notation.
const GREEK_NOMINALS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  ALP: [[2, -4.5], [3, 3]], BET: [[2, -7.5], [3, 5]], GAM: [[2, 0.5]],
  DEL: [[2, -2.5], [3, 2]], EPS: [[2, -5.5], [3, 4]],
  ZET: [[2, 2.5], [3, -1]], ETA: [[2, -1.5], [3, 1]],
  PHI: [[2, 1], [3, -0.5]], CHI: [[2, -2], [3, 1.5]],
  PSI: [[3, 0.5]], OME: [[2, -3], [3, 2.5]],
}

const GREEK_SCRIPT: Readonly<Record<string, string>> = {
  Α: 'ALP', Β: 'BET', Γ: 'GAM', Δ: 'DEL', Ε: 'EPS', Ζ: 'ZET', Η: 'ETA',
  Φ: 'PHI', Χ: 'CHI', Ψ: 'PSI', Ω: 'OME',
}

export function mapFormula(monzo: PrimeMonzo, mapping: PrimeMapping): Value {
  let result = Value.cents(0)
  for (const [prime, exponent] of monzo) result = result.add(mapping.mapPrime(prime).mul(new Value(exponent)))
  return result
}

const origin = (node: PitchLiteral | IntervalLiteral): readonly SourceOrigin[] => [{ location: node.location, role: 'literal' }]

function shifts(modifiers: readonly { kind: string }[]): number {
  return modifiers.reduce((sum, modifier) => sum + (modifier.kind === 'equaveUp' ? 1 : modifier.kind === 'doubleEquaveUp' ? 2 : modifier.kind === 'equaveDown' ? -1 : 0), 0)
}

/** Preserve the diatonic meaning of subtracting two naturally spelled pitches. */
export function spellPitchDifference(left: AbsolutePitchValue, right: AbsolutePitchValue) {
  const letters = 'CDEFGAB'
  const leftStep = letters.indexOf(left.spelling.nominal.toUpperCase()) + (left.spelling.nominal === left.spelling.nominal.toLowerCase() ? 7 : 0)
  const rightStep = letters.indexOf(right.spelling.nominal.toUpperCase()) + (right.spelling.nominal === right.spelling.nominal.toLowerCase() ? 7 : 0)
  const distance = leftStep - rightStep
  if (distance < 0) return undefined
  const number = BigInt(distance + 1)
  const simple = distance % 7 + 1
  const quality = simple === 1 || simple === 4 || simple === 5 ? 'P' : 'M'
  return { quality, number, raw: `${quality}${number}` }
}

export function evaluatePitchLiteral(node: PitchLiteral, mapping: PrimeMapping): AbsolutePitchValue {
  const upper = node.nominal.value.toUpperCase()
  const greekKey = GREEK_SCRIPT[upper] ?? upper
  const entries = node.nominal.system === 'latin' ? NOMINALS[upper] : GREEK_NOMINALS[greekKey]
  if (!entries) throw new TypeError(`Undefined nominal ${node.nominal.value}.`)
  const result = formula(entries)
  const octave = (node.nominal.value === node.nominal.value.toLowerCase() ? 1 : 0) + shifts(node.modifiers)
  if (octave) result.set(2, (result.get(2) ?? new Fraction(0)).add(octave))
  let chromatic = 0
  for (const accidental of node.accidentals) {
    if (accidental.value === '#' || accidental.value === '♯') chromatic++
    else if (accidental.value === 'b' || accidental.value === '♭') chromatic--
    else if (accidental.value === 'x' || accidental.value === '𝄪') chromatic += 2
    else if (accidental.value === '𝄫') chromatic -= 2
    else if (accidental.value === '𝄲' || accidental.value === '‡' || accidental.value === 't') chromatic += 0.5
    else if (accidental.value === '𝄳' || accidental.value === 'd') chromatic -= 0.5
    else if (accidental.value === 'p') {
      result.set(2, (result.get(2) ?? new Fraction(0)).sub(19))
      result.set(3, (result.get(3) ?? new Fraction(0)).add(12))
    } else if (accidental.value === 'q') {
      result.set(2, (result.get(2) ?? new Fraction(0)).add(19))
      result.set(3, (result.get(3) ?? new Fraction(0)).sub(12))
    } else if (accidental.value === '𝄬') {
      result.set(2, (result.get(2) ?? new Fraction(0)).add(7)); result.set(3, (result.get(3) ?? new Fraction(0)).sub(3)); result.set(5, (result.get(5) ?? new Fraction(0)).sub(1))
    } else if (accidental.value === '𝄭') {
      result.set(2, (result.get(2) ?? new Fraction(0)).add(15)); result.set(3, (result.get(3) ?? new Fraction(0)).sub(11)); result.set(5, (result.get(5) ?? new Fraction(0)).add(1))
    } else if (accidental.value === '𝄮') {
      result.set(2, (result.get(2) ?? new Fraction(0)).sub(4)); result.set(3, (result.get(3) ?? new Fraction(0)).add(4)); result.set(5, (result.get(5) ?? new Fraction(0)).sub(1))
    } else if (accidental.value === '𝄯') {
      result.set(2, (result.get(2) ?? new Fraction(0)).add(4)); result.set(3, (result.get(3) ?? new Fraction(0)).sub(4)); result.set(5, (result.get(5) ?? new Fraction(0)).add(1))
    } else if (accidental.value === '𝄰') {
      result.set(2, (result.get(2) ?? new Fraction(0)).sub(15)); result.set(3, (result.get(3) ?? new Fraction(0)).add(11)); result.set(5, (result.get(5) ?? new Fraction(0)).sub(1))
    } else if (accidental.value === '𝄱') {
      result.set(2, (result.get(2) ?? new Fraction(0)).sub(7)); result.set(3, (result.get(3) ?? new Fraction(0)).add(3)); result.set(5, (result.get(5) ?? new Fraction(0)).add(1))
    } else if (accidental.value !== '♮' && accidental.value !== '_') throw new TypeError(`Unsupported accidental ${accidental.value}.`)
  }
  if (chromatic) {
    result.set(2, (result.get(2) ?? new Fraction(0)).sub(11 * chromatic))
    result.set(3, (result.get(3) ?? new Fraction(0)).add(7 * chromatic))
  }
  return { kind: 'absolutePitch', rootOffset: mapFormula(result, mapping), formula: result, spelling: { nominal: node.nominal.value, raw: node.raw }, origins: origin(node) }
}

export function evaluateIntervalLiteral(node: IntervalLiteral, mapping: PrimeMapping): PitchOffsetValue {
  const number = BigInt(node.number)
  if (number < 1n) throw new TypeError('Interval number must be positive.')
  const simple = Number((number - 1n) % 7n) + 1
  const octaves = Number((number - 1n) / 7n) + shifts(node.modifiers)
  const perfect = simple === 1 || simple === 4 || simple === 5
  let chromatic: number
  if (node.quality.startsWith('A')) chromatic = node.quality.length
  else if (node.quality.startsWith('d')) chromatic = -(node.quality.length + (perfect ? 0 : 1))
  else if (node.quality === 'P' && perfect) chromatic = 0
  else if (node.quality === 'M' && !perfect) chromatic = 0
  else if (node.quality === 'm' && !perfect) chromatic = -1
  else if (node.quality === 'n' && !perfect) chromatic = -0.5
  else if (node.quality === 'n' && simple === 4) chromatic = 0.5
  else if (node.quality === 'n' && simple === 5) chromatic = -0.5
  else throw new TypeError(`Quality ${node.quality} is invalid for interval ${node.number}.`)
  const result = formula(NOMINALS[['C', 'D', 'E', 'F', 'G', 'A', 'B'][simple - 1]!]!)
  if (octaves) result.set(2, (result.get(2) ?? new Fraction(0)).add(octaves))
  if (chromatic) {
    result.set(2, (result.get(2) ?? new Fraction(0)).sub(11 * chromatic))
    result.set(3, (result.get(3) ?? new Fraction(0)).add(7 * chromatic))
  }
  return { kind: 'pitchOffset', value: mapFormula(result, mapping), formula: result, spelling: { quality: node.quality, number, raw: node.raw }, origins: origin(node) }
}

export type PitchEvaluationResult = { readonly value: AbsolutePitchValue | PitchOffsetValue; readonly diagnostics: readonly Diagnostic[] }
