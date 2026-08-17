import { Value } from '../value'
import { Fraction, mmod } from 'xen-dev-utils/fraction'
import { groupFjsInflections } from './fjs'
import { normalizeStaffAccidental, spellIntervalFormula } from './pitches'
import type {
  EvaluatedLiteral,
  FjsSpelling,
  PrimeMonzo,
  ScoreShape,
  StaffInflection,
  StaffNotationShape,
  StaffPitch,
} from './types'
import { flattenScoreSemantics } from './beat-events'

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const
const PYTHAGOREAN_THREES = [0, 2, 4, -1, 1, 3, 5] as const
const GREEK_RANK: Readonly<Record<string, number>> = {
  ETA: 0.5,
  ALP: 1.5,
  BET: 2.5,
  GAM: 3.5,
  DEL: 4.5,
  EPS: 5.5,
  ZET: 6.5,
  Η: 0.5,
  Α: 1.5,
  Β: 2.5,
  Γ: 3.5,
  Δ: 4.5,
  Ε: 5.5,
  Ζ: 6.5,
}

const UPWARD_GREEK_NOMINALS = new Set(['BET', 'Β'])

function formulaOf(value: EvaluatedLiteral): PrimeMonzo | undefined {
  if (value.kind === 'absolutePitch') return value.formula
  if (value.kind === 'pitchOffset')
    return value.formula ?? value.notationValue?.primeExponents() ?? value.value.primeExponents()
  return value.value.primeExponents()
}

function fjsInflections(formula: PrimeMonzo | undefined): FjsSpelling[] | undefined {
  if (!formula) return undefined
  const result: FjsSpelling[] = []
  for (const [prime, exponent] of formula) {
    if (prime < 5 || exponent.d !== 1) continue
    const direction = exponent.compare(0) > 0 ? 'numerator' : 'denominator'
    for (let index = 0; index < Math.abs(exponent.n); index++)
      result.push({ direction, prime: BigInt(prime) })
  }
  return result.length ? groupFjsInflections(result) : undefined
}

function inferredAccidentals(chromatic: number | undefined): string[] {
  if (!chromatic) return []
  const direction = chromatic > 0 ? 'sharp' : 'flat'
  const magnitude = Math.abs(chromatic)
  const whole = Math.floor(magnitude)
  const result = Array.from({ length: Math.floor(whole / 2) }, () => `double-${direction}`)
  if (whole % 2) result.push(direction)
  if (magnitude % 1 === 0.5) result.push(`half-${direction}`)
  if (!result.length) result.push(`${magnitude}-${direction}`)
  return result
}

function spellingChromatic(quality: string, number: number): number | undefined {
  const simple = ((number - 1) % 7) + 1
  const perfect = simple === 1 || simple === 4 || simple === 5
  if (quality === 'P' && perfect) return 0
  if (quality === 'M' && !perfect) return 0
  if (quality === 'm' && !perfect) return -1
  if (quality === 'n' && !perfect) return -0.5
  if (/^SA+$/.test(quality)) return quality.length - 1.5
  if (/^sd+$/.test(quality)) return -(quality.length - 1.5 + (perfect ? 0 : 1))
  if (/^A+$/.test(quality)) return quality.length
  if (/^d+$/.test(quality)) return -(quality.length + (perfect ? 0 : 1))
  return undefined
}

function decorations(value: EvaluatedLiteral, chromatic?: number) {
  if (value.kind === 'absolutePitch' && value.spelling.signature) return { accidentals: [] }
  const written = value.kind === 'absolutePitch' ? value.spelling.accidentals : undefined
  const fjs =
    value.kind === 'absolutePitch'
      ? value.spelling.inflections
      : value.kind === 'pitchOffset'
        ? value.spelling?.inflections
        : undefined
  const modifiers =
    value.kind === 'absolutePitch'
      ? value.spelling.modifiers
      : value.kind === 'pitchOffset'
        ? value.spelling?.modifiers
        : undefined
  const operatorInflections: StaffInflection[] = (modifiers ?? [])
    .filter((kind): kind is 'up' | 'down' | 'lift' | 'drop' =>
      ['up', 'down', 'lift', 'drop'].includes(kind),
    )
    .map((kind) => ({ kind }))
  const accidentals = written?.length
    ? written.map(normalizeStaffAccidental)
    : inferredAccidentals(chromatic)
  const inflections: StaffInflection[] = [...operatorInflections, ...(fjs ?? [])]
  return {
    accidentals,
    ...(inflections?.length ? { inflections } : {}),
  }
}

function soundingValue(value: EvaluatedLiteral): Value {
  if (value.kind === 'absolutePitch') return value.rootOffset
  if (value.kind === 'pitchOffset') return value.notationValue ?? value.value
  if (!value.value.dimensions.isDimensionless || value.value.valueOf() <= 0) {
    throw new TypeError('Staff notation requires a pitch or a positive ratio.')
  }
  return Value.pitch(value.value)
}

/** Convert an evaluated Xenpaper pitch/interval into renderer-independent staff data. */
export interface StaffNotationOptions {
  readonly rootPitch?: Extract<EvaluatedLiteral, { kind: 'absolutePitch' }>
}

function naturalCents(position: number): number {
  const octave = Math.floor(position / 7)
  const letter = mmod(position, 7)
  return octave * 1200 + SEMITONES[letter]! * 100
}

function formulaChromatic(formula: PrimeMonzo, position: number): number | undefined {
  if ([...formula].some(([prime, exponent]) => prime > 3 && exponent.n)) return undefined
  const letter = mmod(position, 7)
  const threes = formula.get(3) ?? new Fraction(0)
  const chromatic = threes.sub(PYTHAGOREAN_THREES[letter]!).div(7)
  return chromatic.d <= 2 ? chromatic.valueOf() : undefined
}

function absoluteIntervalFormula(
  value: Extract<EvaluatedLiteral, { kind: 'pitchOffset' }>,
  rootPitch: Extract<EvaluatedLiteral, { kind: 'absolutePitch' }> | undefined,
): PrimeMonzo | undefined {
  if (!value.formula) return undefined
  const result = new Map<number, Fraction>()
  for (const [prime, exponent] of rootPitch?.formula ?? [])
    result.set(prime, new Fraction(exponent))
  for (const [prime, exponent] of value.formula) {
    const combined = (result.get(prime) ?? new Fraction(0)).add(exponent)
    if (combined.n) result.set(prime, combined)
    else result.delete(prime)
  }
  return result
}

function equaveStaffShift(modifiers: readonly string[] | undefined): number {
  return (modifiers ?? []).reduce(
    (total, kind) =>
      total +
      (kind === 'equaveUp' ? 7 : kind === 'doubleEquaveUp' ? 14 : kind === 'equaveDown' ? -7 : 0),
    0,
  )
}

export function constructStaffNotation(
  value: EvaluatedLiteral,
  options: StaffNotationOptions = {},
): StaffPitch {
  const cents = soundingValue(value).valueOf()
  const rootPosition = options.rootPitch
    ? constructStaffNotation(options.rootPitch).staffPosition
    : 0
  if (!Number.isFinite(cents)) throw new RangeError('Staff pitch must be finite.')

  if (value.kind !== 'absolutePitch' && cents === 0) {
    return options.rootPitch
      ? constructStaffNotation(options.rootPitch)
      : {
          staffPosition: rootPosition,
          accidentals: [],
          notehead: 'normal',
          cents,
        }
  }

  if (value.kind === 'absolutePitch') {
    if (value.mos) {
      const isDiatonicMos =
        [...value.mos.context.pattern].filter((step) => step === 'L').length === 5 &&
        [...value.mos.context.pattern].filter((step) => step === 's').length === 2
      return {
        staffPosition: value.mos.rank,
        ...decorations(value),
        notehead: 'normal',
        cents,
        ...(isDiatonicMos
          ? {}
          : { diamondMos: { rank: value.mos.rank, pattern: value.mos.context.pattern } }),
      }
    }
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
      const writtenOctave =
        (rawNominal === rawNominal.toLowerCase() ? 1 : 0) +
        equaveStaffShift(value.spelling.modifiers) / 7
      const position = writtenOctave * 7 + latin
      const chromatic =
        (value.spelling.derived ? formulaChromatic(value.formula, position) : undefined) ??
        Math.round((cents - naturalCents(position)) / 50) / 2
      return {
        staffPosition: position,
        ...decorations(value, value.spelling.derived ? chromatic : undefined),
        notehead: 'normal',
        cents,
      }
    }
  }

  if (value.kind === 'pitchOffset' && value.spelling) {
    const numericNumber = Number(value.spelling.number.valueOf())
    const zeroBased = numericNumber - 1
    const descending = value.spelling.direction === 'descending'
    const position =
      rootPosition +
      (descending ? -1 : 1) * (Math.ceil(zeroBased) + equaveStaffShift(value.spelling.modifiers))
    const exactFormula = absoluteIntervalFormula(value, options.rootPitch)
    const chromatic =
      (exactFormula ? formulaChromatic(exactFormula, position) : undefined) ??
      (descending ? undefined : spellingChromatic(value.spelling.quality, numericNumber)) ??
      Math.round((naturalCents(rootPosition) + cents - naturalCents(position)) / 50) / 2
    return {
      staffPosition: position,
      ...decorations(value, chromatic),
      notehead: Number.isInteger(zeroBased) ? 'normal' : 'triangle-down',
      cents,
    }
  }

  const formula = formulaOf(value)
  const formulaSpelling = formula ? spellIntervalFormula(formula) : undefined
  if (formulaSpelling) {
    const numericNumber = Number(formulaSpelling.number.valueOf())
    const position = rootPosition + Math.ceil(numericNumber - 1)
    const chromatic = spellingChromatic(formulaSpelling.quality, numericNumber)
    return {
      staffPosition: position,
      accidentals: inferredAccidentals(chromatic),
      ...(formulaSpelling.inflections?.length ? { inflections: formulaSpelling.inflections } : {}),
      notehead: 'normal',
      cents,
    }
  }

  const absoluteCents = cents + naturalCents(rootPosition)
  const midiOffset = Math.round(absoluteCents / 100)
  const octaveOffset = Math.floor(midiOffset / 12)
  const pitchClass = mmod(midiOffset, 12)
  let letter = 0
  let accidental: string | undefined
  let best = Infinity
  for (let index = 0; index < SEMITONES.length; index++) {
    const distance = Math.abs(SEMITONES[index]! - pitchClass)
    if (distance < best) {
      best = distance
      letter = index
    }
  }
  if (SEMITONES[letter] !== pitchClass)
    accidental = pitchClass > SEMITONES[letter]! ? 'sharp' : 'flat'
  const position = octaveOffset * 7 + letter
  const inflections = fjsInflections(formula)
  return {
    staffPosition: position,
    accidentals: accidental ? [accidental] : [],
    ...(inflections ? { inflections } : {}),
    notehead: 'normal',
    cents,
  }
}

function appearanceKey(pitch: StaffPitch): string {
  const inflections = (pitch.inflections ?? []).map((value) =>
    'kind' in value ? value.kind : `${value.direction}:${value.prime}:${value.flavor ?? ''}`,
  )
  return [
    pitch.staffPosition,
    pitch.notehead,
    pitch.accidentals.join(','),
    inflections.join(','),
  ].join('|')
}

/** Project a duration-bearing score tree, including rests, into staff data. */
export function constructStaffNotationShape(shape: ScoreShape): StaffNotationShape {
  switch (shape.kind) {
    case 'attack': {
      const pitch = constructStaffNotation(shape.pitch, {
        rootPitch: shape.rootPitch,
      })
      const alternatives = (shape.alternateAppearances ?? []).map((appearance) =>
        constructStaffNotation(appearance.pitch, {
          rootPitch: appearance.rootPitch,
        }),
      )
      const ambiguous = alternatives.some(
        (alternative) => appearanceKey(alternative) !== appearanceKey(pitch),
      )
      return {
        kind: 'note',
        pitch: ambiguous ? { ...pitch, notehead: 'x' } : pitch,
        duration: shape.duration,
        ...(shape.displayLabel ? { displayLabel: shape.displayLabel } : {}),
        ...(shape.justIntonation ? { justIntonation: true } : {}),
        ...(shape.grace ? { grace: true } : {}),
        ...(shape.notatedDuration ? { notatedDuration: shape.notatedDuration } : {}),
        ...(shape.articulationMarks?.length ? { articulationMarks: shape.articulationMarks } : {}),
      }
    }
    case 'rest':
      return { kind: 'rest', duration: shape.duration, generated: shape.generated }
    case 'continue':
      return { kind: 'continue', duration: shape.duration }
    case 'barline':
      return {
        kind: 'barline',
        style: shape.style,
        duration: shape.duration,
        endingNumber: shape.endingNumber,
      }
    case 'annotation':
      return { kind: 'annotation', text: shape.text, duration: shape.duration }
    case 'dynamic':
      return { kind: 'dynamic', mark: shape.mark, duration: shape.duration }
    case 'clef':
      return { kind: 'clef', clef: shape.clef, duration: shape.duration }
    case 'key-signature':
      return {
        kind: 'key-signature',
        pitches: shape.pitches.map((pitch) => {
          const spelling = pitch.spelling.signature
            ? { ...pitch.spelling, signature: false }
            : pitch.spelling
          return constructStaffNotation({ ...pitch, spelling })
        }),
        duration: shape.duration,
      }
    case 'groove':
      if (!shape.template || !shape.controlCount)
        return { kind: 'annotation', text: 'straight', duration: shape.duration }
      else {
        const flattened = flattenScoreSemantics(shape.template).score
        const notes = flattened.events.filter((event) => event.kind === 'note')
        const grooveDurations = notes.map((note, index) =>
          (notes[index + 1]?.start ?? flattened.duration).sub(note.start),
        )
        const oddDenominator = (value: number) => {
          while (value % 2 === 0) value /= 2
          return value
        }
        const tuplet = Math.max(...grooveDurations.map((duration) => oddDenominator(duration.d)))
        return {
          kind: 'swing',
          straightDurations: notes.map(() => flattened.duration.div(notes.length)),
          grooveDurations,
          ...(tuplet > 1 ? { tuplet } : {}),
          duration: shape.duration,
        }
      }
    case 'sequence':
      return {
        kind: 'sequence',
        duration: shape.duration,
        children: shape.children.map(constructStaffNotationShape),
        ...(shape.normalized ? { normalized: true } : {}),
        ...(shape.tuplet ? { tuplet: shape.tuplet } : {}),
      }
    case 'parallel':
      return {
        kind: 'parallel',
        duration: shape.duration,
        branches: shape.branches.map(constructStaffNotationShape),
      }
  }
}

/** Short alias for callers that treat the conversion as a projection. */
export const toStaffPitch = constructStaffNotation
