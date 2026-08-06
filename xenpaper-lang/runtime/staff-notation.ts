import { Value } from '../value'
import type { EvaluatedLiteral, FjsSpelling, PrimeMonzo, ScoreShape, StaffInflection, StaffNotationShape, StaffPitch } from './types'

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const
const GREEK_RANK: Readonly<Record<string, number>> = {
  ETA: 0.5, ALP: 1.5, BET: 2.5, GAM: 3.5, DEL: 4.5, EPS: 5.5, ZET: 6.5,
  'Η': 0.5, 'Α': 1.5, 'Β': 2.5, 'Γ': 3.5, 'Δ': 4.5, 'Ε': 5.5, 'Ζ': 6.5,
}

const UPWARD_GREEK_NOMINALS = new Set(['BET', 'Β'])

function formulaOf(value: EvaluatedLiteral): PrimeMonzo | undefined {
  if (value.kind === 'absolutePitch') return value.formula
  if (value.kind === 'pitchOffset' && value.formula) return value.formula
  return value.value.primeExponents()
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

function inferredAccidental(chromatic: number): string | undefined {
  if (!chromatic) return undefined
  if (chromatic === 1) return 'sharp'
  if (chromatic === -1) return 'flat'
  if (chromatic === 2) return 'double-sharp'
  if (chromatic === -2) return 'double-flat'
  return chromatic > 0 ? `${chromatic}-sharp` : `${-chromatic}-flat`
}

function writtenAccidental(token: string): string {
  if (token === 'b' || token === '♭') return 'flat'
  if (token === '#' || token === '♯') return 'sharp'
  if (token === 'x' || token === '𝄪') return 'double-sharp'
  if (token === '𝄫') return 'double-flat'
  if (token === 't' || token === '𝄲' || token === '‡') return 'half-sharp'
  if (token === 'd' || token === '𝄳') return 'half-flat'
  if (token === '_' || token === '♮') return 'natural'
  return token
}

function decorations(value: EvaluatedLiteral, chromatic?: number) {
  const written = value.kind === 'absolutePitch' ? value.spelling.accidentals : undefined
  const fjs = value.kind === 'absolutePitch'
    ? value.spelling.inflections
    : value.kind === 'pitchOffset'
      ? value.spelling?.inflections
      : undefined
  const modifiers = value.kind === 'absolutePitch'
    ? value.spelling.modifiers
    : value.kind === 'pitchOffset'
      ? value.spelling?.modifiers
      : undefined
  const operatorInflections: StaffInflection[] = (modifiers ?? [])
    .filter((kind): kind is 'up' | 'down' | 'lift' | 'drop' => ['up', 'down', 'lift', 'drop'].includes(kind))
    .map((kind) => ({ kind }))
  const accidental = written?.length
    ? written.map(writtenAccidental).join('+')
    : chromatic === undefined
      ? undefined
      : inferredAccidental(chromatic)
  const inflections: StaffInflection[] = [...operatorInflections, ...(fjs ?? [])]
  return {
    accidentals: accidental ? [accidental] : [],
    ...(inflections?.length ? { inflections } : {}),
  }
}

function soundingValue(value: EvaluatedLiteral): Value {
  if (value.kind === 'absolutePitch') return value.rootOffset
  if (value.kind === 'pitchOffset') return value.value
  const ratio = value.value.exactRational()
  if (!ratio || ratio.compare(0) <= 0) throw new TypeError('Staff notation requires a pitch or a positive exact ratio.')
  return Value.pitch(value.value)
}

/** Convert an evaluated Xenpaper pitch/interval into renderer-independent staff data. */
export interface StaffNotationOptions {
  readonly rootStaffPosition?: number
}

function naturalCents(position: number): number {
  const octave = Math.floor(position / 7)
  const letter = ((position % 7) + 7) % 7
  return octave * 1200 + SEMITONES[letter]! * 100
}

function equaveStaffShift(modifiers: readonly string[] | undefined): number {
  return (modifiers ?? []).reduce(
    (total, kind) => total + (kind === 'equaveUp' ? 7 : kind === 'doubleEquaveUp' ? 14 : kind === 'equaveDown' ? -7 : 0),
    0,
  )
}

export function constructStaffNotation(value: EvaluatedLiteral, options: StaffNotationOptions = {}): StaffPitch {
  const cents = soundingValue(value).valueOf()
  const rootPosition = options.rootStaffPosition ?? 0
  if (!Number.isFinite(cents)) throw new RangeError('Staff pitch must be finite.')

  if (value.kind === 'absolutePitch') {
    const rawNominal = value.spelling.nominal
    const key = rawNominal.toUpperCase()
    const greekRank = GREEK_RANK[key]
    if (greekRank !== undefined) {
      const octaveOffset = Math.floor(cents / 1200)
      const position = Math.ceil(greekRank) + octaveOffset * 7
      return {
        staffPosition: position,
        ...decorations(value),
        notehead: UPWARD_GREEK_NOMINALS.has(key) ? 'triangle-up' : 'triangle-down',
        cents,
      }
    }
    const latin = LETTERS.indexOf(key as (typeof LETTERS)[number])
    if (latin >= 0) {
      const soundingOctave = Math.round((cents - SEMITONES[latin]! * 100) / 1200)
      const position = soundingOctave * 7 + latin
      const chromatic = Math.round((cents - (soundingOctave * 1200 + SEMITONES[latin]! * 100)) / 100)
      return {
        staffPosition: position,
        ...decorations(value, chromatic),
        notehead: 'normal',
        cents,
      }
    }
  }

  if (value.kind === 'pitchOffset' && value.spelling) {
    const numericNumber = Number(value.spelling.number.valueOf())
    const zeroBased = numericNumber - 1
    const position = rootPosition + Math.ceil(zeroBased) + equaveStaffShift(value.spelling.modifiers)
    const chromatic = Math.round((naturalCents(rootPosition) + cents - naturalCents(position)) / 100)
    return {
      staffPosition: position,
      ...decorations(value, chromatic),
      notehead: Number.isInteger(zeroBased) ? 'normal' : 'triangle-down',
      cents,
    }
  }

  const absoluteCents = cents + naturalCents(rootPosition)
  const midiOffset = Math.round(absoluteCents / 100)
  const octaveOffset = Math.floor(midiOffset / 12)
  const pitchClass = ((midiOffset % 12) + 12) % 12
  let letter = 0
  let accidental: string | undefined
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
    accidentals: accidental ? [accidental] : [],
    ...(inflections ? { inflections } : {}),
    notehead: 'normal',
    cents,
  }
}

/** Project a duration-bearing score tree, including rests, into staff data. */
export function constructStaffNotationShape(shape: ScoreShape): StaffNotationShape {
  switch (shape.kind) {
    case 'attack':
      return { kind: 'note', pitch: constructStaffNotation(shape.pitch, { rootStaffPosition: shape.rootStaffPosition }), duration: shape.duration }
    case 'rest':
      return { kind: 'rest', duration: shape.duration, generated: shape.generated }
    case 'continue':
      return { kind: 'continue', duration: shape.duration }
    case 'barline':
      return { kind: 'barline', duration: shape.duration }
    case 'sequence':
      return { kind: 'sequence', duration: shape.duration, children: shape.children.map(constructStaffNotationShape) }
    case 'parallel':
      return { kind: 'parallel', duration: shape.duration, branches: shape.branches.map(constructStaffNotationShape) }
  }
}

/** Short alias for callers that treat the conversion as a projection. */
export const toStaffPitch = constructStaffNotation
