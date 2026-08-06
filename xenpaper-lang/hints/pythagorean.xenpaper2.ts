import { type Monzo, accumulate, decumulate } from 'xen-dev-utils/monzo'

import type { AccidentalType, InflectionType, KeyModeType, KeyTonicType } from './grammar.generated'

export type PtolMonzo = readonly [number, number, number]

const NOMINAL_MONZOS = new Map<string, PtolMonzo>([
  // Up
  ['A', [1, 0, 0]], // 2/1
  ['E', [-1, 1, 0]], // 3/2
  ['B', [-2, 2, 0]], // 9/4
  // Down
  ['D', [2, -1, 0]], // 4/3
  ['G', [4, -2, 0]], // 16/9
  ['C', [5, -3, 0]], // 32/27
  ['F', [7, -4, 0]], // 128/81

  // Greek = Latin +- semioctave
  ['ALP', [0.5, 0, 0]], // A - 1\2
  ['Α', [0.5, 0, 0]],

  ['EPS', [-0.5, 1, 0]], // E + 1\2
  ['Ε', [-0.5, 1, 0]],

  ['BET', [-2.5, 2, 0]], // B - 1\2
  ['Β', [-2.5, 2, 0]],

  ['DEL', [2.5, -1, 0]], // D + 1\2
  ['Δ', [2.5, -1, 0]],

  ['GAM', [5.5, -3, 0]], // C + 1\2
  ['Γ', [5.5, -3, 0]],

  ['ETA', [3.5, -2, 0]], // G - 1\2
  ['Η', [3.5, -2, 0]],

  ['ZET', [7.5, -4, 0]], // F + 1\2
  ['Ζ', [7.5, -4, 0]],
])

const ACCIDENTAL_MONZOS = new Map<AccidentalType, PtolMonzo>([
  ['♮', [0, 0, 0]],
  ['_', [0, 0, 0]],

  ['♯', [-11, 7, 0]],
  ['#', [-11, 7, 0]],

  ['♭', [11, -7, 0]],
  ['b', [11, -7, 0]],

  ['𝄪', [-22, 14, 0]],
  ['x', [-22, 14, 0]],

  ['𝄫', [22, -14, 0]],

  ['p', [-19, 12, 0]],
  ['q', [19, -12, 0]],

  ['𝄲', [-5.5, 3.5, 0]],
  ['‡', [-5.5, 3.5, 0]],
  ['t', [-5.5, 3.5, 0]],

  ['𝄳', [5.5, -3.5, 0]],
  ['d', [5.5, -3.5, 0]],

  ['𝄬', [7, -3, -1]],
  ['𝄭', [15, -11, 1]],
  ['𝄮', [-4, 4, -1]],
  ['𝄯', [4, -4, 1]],
  ['𝄰', [-15, 11, -1]],
  ['𝄱', [-7, 3, 1]],
])

const GREEK_TO_SCRIPT = new Map<string, string>([
  ['alp', 'α'],
  ['bet', 'β'],
  ['gam', 'γ'],
  ['del', 'δ'],
  ['eps', 'ε'],
  ['zet', 'ζ'],
  ['eta', 'η'],
  ['phi', 'φ'],
  ['chi', 'χ'],
  ['psi', 'ψ'],
  ['ome', 'ω'],
  ['the', 'θ'],
  ['iot', 'ι'],
  ['kap', 'κ'],
  ['lam', 'λ'],
  ['muu', 'μ'],
  ['nuu', 'ν'],
  ['xii', 'ξ'],
  ['omi', 'ο'],
  ['pii', 'π'],
  ['rho', 'ρ'],
  ['fsi', 'ς'],
  ['sig', 'σ'],
  ['tau', 'τ'],
  ['ups', 'υ'],
])

const NOMINAL_TO_KEY_LETTER = new Map<string, string>([
  ['ALP', 'A'],
  ['Α', 'A'],
  ['BET', 'B'],
  ['Β', 'B'],
  ['GAM', 'C'],
  ['Γ', 'C'],
  ['DEL', 'D'],
  ['Δ', 'D'],
  ['EPS', 'E'],
  ['Ε', 'E'],
  ['ZET', 'F'],
  ['Ζ', 'F'],
  ['ETA', 'G'],
  ['Η', 'G'],
])

const KEY_LETTER_TO_NOMINALS = new Map<string, string[]>([
  ['A', ['A', 'ALP', 'Α']],
  ['B', ['B', 'BET', 'Β']],
  ['C', ['C', 'GAM', 'Γ']],
  ['D', ['D', 'DEL', 'Δ']],
  ['E', ['E', 'EPS', 'Ε']],
  ['F', ['F', 'ZET', 'Ζ']],
  ['G', ['G', 'ETA', 'Η']],
])

const MAJOR_KEY_FIFTHS = new Map<string, number>([
  ['C', 0],
  ['G', 1],
  ['D', 2],
  ['A', 3],
  ['E', 4],
  ['B', 5],
  ['F', -1],
])

const KEY_MODE_FIFTH_OFFSETS = new Map<KeyModeType, number>([
  ['ionian', 0],
  ['dorian', -2],
  ['phrygian', -4],
  ['lydian', 1],
  ['mixolydian', -1],
  ['aeolian', -3],
  ['locrian', -5],
])

const SHARP_KEY_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLAT_KEY_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F']
const ALL_KEY_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const NATURAL_ACCIDENTALS = new Set<AccidentalType>(['♮', '_'])

export function nominalToMonzo(nominal: string, accidentals: AccidentalType[]) {
  const key = nominal.toUpperCase()
  const result = NOMINAL_MONZOS.get(key)?.slice()
  if (result === undefined) {
    throw new Error(`Undefined nominal '${nominal}'.`)
  }

  // Lower-case = octave higher
  if (nominal[0] !== key[0]) {
    result[0]! += 1
  }
  for (const accidental of accidentals) {
    accumulate(result, ACCIDENTAL_MONZOS.get(accidental) as unknown as Monzo)
  }
  return result as unknown as PtolMonzo
}

export type KeySignatureAdjustment = {
  ups: number
  lifts: number
  accidentals: AccidentalType[]
  inflections: InflectionType[]
}

export type KeySignature = Map<string, KeySignatureAdjustment>

const keySignatureAdjustmentFromTonic = (tonic: KeyTonicType): KeySignatureAdjustment => ({
  ups: tonic.ups,
  lifts: tonic.lifts,
  accidentals: tonic.accidentals.filter((accidental) => !NATURAL_ACCIDENTALS.has(accidental)),
  inflections: tonic.inflections,
})

export function keySignatureFromPitches(pitches: KeyTonicType[]): KeySignature {
  const result: KeySignature = new Map()

  for (const pitch of pitches) {
    const key = pitch.nominal.toUpperCase()
    if (!NOMINAL_MONZOS.has(key)) {
      throw new Error(`Undefined key signature nominal '${pitch.nominal}'.`)
    }

    const adjustment = keySignatureAdjustmentFromTonic(pitch)
    const keyLetter = NOMINAL_TO_KEY_LETTER.get(key) ?? key
    for (const nominal of KEY_LETTER_TO_NOMINALS.get(keyLetter) ?? [keyLetter]) {
      result.set(nominal, { ...adjustment, accidentals: [...adjustment.accidentals] })
    }
  }

  return result
}

export function keySignatureAccidentals(tonic: KeyTonicType, mode: KeyModeType): KeySignature {
  const key = tonic.nominal.toUpperCase()
  if (!NOMINAL_MONZOS.has(key)) {
    throw new Error(`Undefined key signature tonic '${tonic.nominal}'.`)
  }

  const keyLetter = NOMINAL_TO_KEY_LETTER.get(key) ?? key
  const fifths = (MAJOR_KEY_FIFTHS.get(keyLetter) ?? 0) + (KEY_MODE_FIFTH_OFFSETS.get(mode) ?? 0)
  const pitches: KeyTonicType[] = []

  const tonicAdjustment = keySignatureAdjustmentFromTonic(tonic)
  if (
    tonicAdjustment.ups !== 0 ||
    tonicAdjustment.lifts !== 0 ||
    tonicAdjustment.accidentals.length ||
    tonicAdjustment.inflections.length
  ) {
    for (const nominal of ALL_KEY_LETTERS) {
      pitches.push({ ...tonic, nominal, nominalType: 'latin' })
    }
  }

  const order = fifths >= 0 ? SHARP_KEY_ORDER : FLAT_KEY_ORDER
  const accidental: AccidentalType = fifths >= 0 ? '♯' : '♭'

  for (let index = 0; index < Math.abs(fifths); index++) {
    const nominal = order[index % order.length]!
    let current = pitches.find((pitch) => pitch.nominal === nominal)
    if (!current) {
      current = {
        ups: 0,
        lifts: 0,
        nominal,
        nominalType: 'latin',
        accidentals: [],
        inflections: [],
      }
      pitches.push(current)
    }
    current.accidentals = [...current.accidentals, accidental]
  }

  return keySignatureFromPitches(pitches)
}

export function normalizeNominal(nominal: string) {
  const key = nominal.toLowerCase()
  if (GREEK_TO_SCRIPT.has(key)) {
    const script = GREEK_TO_SCRIPT.get(key)!
    if (nominal !== key) {
      // Greek is a strange script indeed
      if (script === 'ς') return 'Fsi'

      return script.toUpperCase()
    }
  }
  return nominal
}

export function normalizeAccidentals(accidentals: AccidentalType[]) {
  const monzo = [0, 0, 0]
  let poqu = 0
  for (const accidental of accidentals) {
    // Don't try to figure out po or qu
    if (accidental === 'p') {
      poqu++
      continue
    } else if (accidental === 'q') {
      poqu--
      continue
    }
    accumulate(monzo, ACCIDENTAL_MONZOS.get(accidental) as unknown as Monzo)
  }
  const result: AccidentalType[] = []
  while (monzo[2]! > 0) {
    if (monzo[1]! > 0) {
      result.push('𝄱')
    } else if (monzo[1]! < -4) {
      result.push('𝄭')
    } else {
      result.push('𝄯')
    }
    decumulate(monzo, ACCIDENTAL_MONZOS.get(result.slice(-1)[0]!) as unknown as Monzo)
  }
  while (monzo[2]! < 0) {
    if (monzo[1]! < 0) {
      result.push('𝄬')
    } else if (monzo[1]! > 4) {
      result.push('𝄰')
    } else {
      result.push('𝄮')
    }
    decumulate(monzo, ACCIDENTAL_MONZOS.get(result.slice(-1)[0]!) as unknown as Monzo)
  }
  while (monzo[1]! >= 14) {
    result.push('𝄪')
    decumulate(monzo, [-22, 14, 0])
  }
  while (monzo[1]! <= -14) {
    result.push('𝄫')
    decumulate(monzo, [22, -14, 0])
  }
  if (monzo[1]! >= 7) {
    result.push('♯')
    decumulate(monzo, [-11, 7, 0])
  }
  if (monzo[1]! <= -7) {
    result.push('♭')
    decumulate(monzo, [11, -7, 0])
  }
  if (monzo[1]! > 0) {
    result.push('‡')
  } else if (monzo[1]! < 0) {
    result.push('d')
  }
  if (!result.length) {
    result.push('♮')
  }
  for (let i = 0; i < poqu; ++i) {
    result.push('p')
  }
  for (let i = 0; i < -poqu; ++i) {
    result.push('q')
  }
  return result
}
