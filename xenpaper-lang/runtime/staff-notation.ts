import { Fraction } from 'xen-dev-utils/fraction'
import { Value } from '../value'
import type { EvaluatedLiteral, FjsSpelling, PrimeMonzo, StaffPitch } from './types'

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const
const GREEK_RANK: Readonly<Record<string, number>> = {
  ETA: 0.5, ALP: 1.5, BET: 2.5, GAM: 3.5, DEL: 4.5, EPS: 5.5, ZET: 6.5,
  'Η': 0.5, 'Α': 1.5, 'Β': 2.5, 'Γ': 3.5, 'Δ': 4.5, 'Ε': 5.5, 'Ζ': 6.5,
}

function factor(integer: number, direction: number, result: Map<number, Fraction>) {
  let remainder = integer
  for (let prime = 2; prime * prime <= remainder; prime++) {
    while (remainder % prime === 0) {
      result.set(prime, (result.get(prime) ?? new Fraction(0)).add(direction))
      remainder /= prime
    }
  }
  if (remainder > 1) result.set(remainder, (result.get(remainder) ?? new Fraction(0)).add(direction))
}

function formulaOf(value: EvaluatedLiteral): PrimeMonzo | undefined {
  if ('formula' in value && value.formula) return value.formula
  const ratio = value.kind === 'scalar' ? value.value.exactRational() : undefined
  if (!ratio || ratio.compare(0) <= 0 || !Number.isSafeInteger(ratio.n) || !Number.isSafeInteger(ratio.d)) return undefined
  const result = new Map<number, Fraction>()
  factor(ratio.n, 1, result)
  factor(ratio.d, -1, result)
  return result
}

function fjsInflections(formula: PrimeMonzo | undefined): FjsSpelling[] | undefined {
  if (!formula) return undefined
  const result: FjsSpelling[] = []
  for (const [prime, exponent] of formula) {
    if (prime < 5 || exponent.d !== 1) continue
    const direction = exponent.compare(0) > 0 ? 'numerator' : 'denominator'
    for (let index = 0; index < Math.abs(exponent.n); index++) result.push({ direction, prime: BigInt(prime) })
  }
  return result.length ? result : undefined
}

function soundingValue(value: EvaluatedLiteral): Value {
  if (value.kind === 'absolutePitch') return value.rootOffset
  if (value.kind === 'pitchOffset') return value.value
  const ratio = value.value.exactRational()
  if (!ratio || ratio.compare(0) <= 0) throw new TypeError('Staff notation requires a pitch or a positive exact ratio.')
  return Value.pitch(value.value)
}

/** Convert an evaluated Xenpaper pitch/interval into renderer-independent staff data. */
export function constructStaffNotation(value: EvaluatedLiteral): StaffPitch {
  const cents = soundingValue(value).valueOf()
  if (!Number.isFinite(cents)) throw new RangeError('Staff pitch must be finite.')

  if (value.kind === 'absolutePitch') {
    const rawNominal = value.spelling.nominal
    const key = rawNominal.toUpperCase()
    const greekRank = GREEK_RANK[key]
    if (greekRank !== undefined) {
      const lowerCaseOctave = rawNominal === rawNominal.toLowerCase() ? 7 : 0
      const position = Math.ceil(greekRank) + lowerCaseOctave
      const octave = 4 + Math.floor(position / 7)
      return { staffPosition: position, nominal: LETTERS[((position % 7) + 7) % 7]!, octave, notehead: 'triangle-down', cents }
    }
    const latin = LETTERS.indexOf(key as (typeof LETTERS)[number])
    if (latin >= 0) {
      const writtenOctave = rawNominal === rawNominal.toLowerCase() ? 1 : 0
      const soundingOctave = Math.round((cents - SEMITONES[latin]!) / 1200)
      const position = (writtenOctave || soundingOctave) * 7 + latin
      const chromatic = Math.round((cents - (soundingOctave * 1200 + SEMITONES[latin]!)) / 100)
      const writtenFlat = /(?:b|♭)/.test(value.spelling.raw)
      const writtenSharp = /(?:#|♯)/.test(value.spelling.raw)
      const inflections = fjsInflections(value.formula)
      return {
        staffPosition: position,
        nominal: LETTERS[latin]!,
        octave: 4 + Math.floor(position / 7),
        ...(writtenFlat || chromatic < 0
          ? { accidental: 'flat' as const }
          : writtenSharp || chromatic > 0
            ? { accidental: 'sharp' as const }
            : {}),
        ...(inflections ? { inflections } : {}),
        notehead: 'normal',
        cents,
      }
    }
  }

  const midiOffset = Math.round(cents / 100)
  const octaveOffset = Math.floor(midiOffset / 12)
  const pitchClass = ((midiOffset % 12) + 12) % 12
  let letter = 0
  let accidental: StaffPitch['accidental']
  let best = Infinity
  for (let index = 0; index < SEMITONES.length; index++) {
    const distance = Math.abs(SEMITONES[index]! - pitchClass)
    if (distance < best) { best = distance; letter = index }
  }
  if (SEMITONES[letter] !== pitchClass) accidental = pitchClass > SEMITONES[letter]! ? 'sharp' : 'flat'
  const position = octaveOffset * 7 + letter
  const inflections = fjsInflections(formulaOf(value))
  return {
    staffPosition: position,
    nominal: LETTERS[letter]!,
    octave: 4 + Math.floor(position / 7),
    ...(accidental ? { accidental } : {}),
    ...(inflections ? { inflections } : {}),
    notehead: 'normal',
    cents,
  }
}

/** Short alias for callers that treat the conversion as a projection. */
export const toStaffPitch = constructStaffNotation
