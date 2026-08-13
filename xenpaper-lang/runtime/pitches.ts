import { Fraction, mmod } from 'xen-dev-utils/fraction'
import type { IntervalLiteral, PitchContextChange, PitchLiteral } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import { applyFjsInflections, fjsPrimeComma, groupFjsInflections } from './fjs'
import { evaluateExpression } from './expressions'
import type {
  AbsolutePitchValue,
  IntervalSpelling,
  PitchSpelling,
  PitchOffsetValue,
  PrimeMapping,
  PrimeMonzo,
  PitchContext,
  SourceOrigin,
} from './types'
import { parseVal, valMapping } from './val'

export const DEFAULT_MAPPING: PrimeMapping = {
  id: 'untempered',
  mapPrime: (prime) => Value.pitch(new Value(BigInt(prime))),
}

/** Equal-temperament patent-val mapping (prime 2 is exactly the equave). */
export function edoMapping(divisions: number): PrimeMapping {
  if (!Number.isSafeInteger(divisions) || divisions <= 0)
    throw new RangeError('EDO divisions must be a positive integer.')
  const mapping = valMapping(divisions, 2)
  return { ...mapping, id: `${divisions}edo` }
}

function formula(entries: readonly (readonly [number, number])[]): Map<number, Fraction> {
  return new Map(
    entries
      .filter(([, exponent]) => exponent)
      .map(([prime, exponent]) => [prime, new Fraction(exponent)]),
  )
}

function addExponent(target: Map<number, Fraction>, prime: number, amount: Fraction | number) {
  const combined = (target.get(prime) ?? new Fraction(0)).add(amount)
  if (combined.n) target.set(prime, combined)
  else target.delete(prime)
}

const NOMINALS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  C: [],
  D: [
    [2, -3],
    [3, 2],
  ],
  E: [
    [2, -6],
    [3, 4],
  ],
  F: [
    [2, 2],
    [3, -1],
  ],
  G: [
    [2, -1],
    [3, 1],
  ],
  A: [
    [2, -4],
    [3, 3],
  ],
  B: [
    [2, -7],
    [3, 5],
  ],
}

// Greek nominals interleave the diatonic chain at half-octave positions.
const GREEK_NOMINALS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  ALP: [
    [2, -4.5],
    [3, 3],
  ],
  BET: [
    [2, -7.5],
    [3, 5],
  ],
  GAM: [[2, 0.5]],
  DEL: [
    [2, -2.5],
    [3, 2],
  ],
  EPS: [
    [2, -5.5],
    [3, 4],
  ],
  ZET: [
    [2, 2.5],
    [3, -1],
  ],
  ETA: [
    [2, -1.5],
    [3, 1],
  ],
}

const GREEK_SCRIPT: Readonly<Record<string, string>> = {
  Α: 'ALP',
  Β: 'BET',
  Γ: 'GAM',
  Δ: 'DEL',
  Ε: 'EPS',
  Ζ: 'ZET',
  Η: 'ETA',
}

const SEMIOCTAVE_INTERVALS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [2, -1.5],
    [3, 1],
  ],
  [
    [2, 1],
    [3, -0.5],
  ],
  [
    [2, -2],
    [3, 1.5],
  ],
  [[2, 0.5]],
  [
    [2, 3],
    [3, -1.5],
  ],
  [[3, 0.5]],
  [
    [2, 2.5],
    [3, -1],
  ],
]

const NOMINAL_RANK: Readonly<Record<string, number>> = {
  C: 1,
  D: 2,
  E: 3,
  F: 4,
  G: 5,
  A: 6,
  B: 7,
  ETA: 1.5,
  ALP: 2.5,
  BET: 3.5,
  GAM: 4.5,
  DEL: 5.5,
  EPS: 6.5,
  ZET: 7.5,
}

export function mapFormula(monzo: PrimeMonzo, mapping: PrimeMapping): Value {
  let result = Value.cents(0)
  for (const [prime, exponent] of monzo)
    result = result.add(mapping.mapPrime(prime).mul(new Value(exponent)))
  return result
}

/** Normalize a Xenpaper accidental token for use by staff renderers. */
export function normalizeStaffAccidental(token: string): string {
  if (token === 'b' || token === '♭') return 'flat'
  if (token === '#' || token === '♯') return 'sharp'
  if (token === 'x' || token === '𝄪') return 'double-sharp'
  if (token === '𝄫') return 'double-flat'
  if (token === 't' || token === '𝄲' || token === '‡') return 'half-sharp'
  if (token === 'd' || token === '𝄳') return 'half-flat'
  if (token === '_' || token === '♮') return 'natural'
  return token
}

export function createPitchContext(mapping: PrimeMapping = DEFAULT_MAPPING): PitchContext {
  const rootPitch: AbsolutePitchValue = {
    kind: 'absolutePitch',
    rootOffset: Value.cents(0),
    formula: new Map(),
    spelling: { nominal: 'C', raw: 'C', system: 'latin', accidentals: [] },
    origins: [],
  }
  return {
    mapping,
    degrees: Array.from({ length: 12 }, (_, index) =>
      Value.equalDivision(index + 1, 12, new Value(2)),
    ),
    degreeEquave: Value.cents(1200),
    rootDisplacement: Value.cents(0),
    // 12-EDO middle C, nine semitones below A4 = 440 Hz.
    rootFrequency: Value.hertz(new Value(440).div(new Value(2).pow(new Fraction(3, 4)))),
    rootPitch,
    up: mapFormula(
      new Map([
        [2, new Fraction(-1, 2)],
        [3, new Fraction(5, 2)],
        [11, new Fraction(-1)],
      ]),
      mapping,
    ),
    lift: mapFormula(
      new Map([
        [2, new Fraction(1, 2)],
        [5, new Fraction(1)],
        [7, new Fraction(-1)],
      ]),
      mapping,
    ),
  }
}

export const DEFAULT_PITCH_CONTEXT = createPitchContext()

function asContext(input: PrimeMapping | PitchContext): PitchContext {
  return 'rootPitch' in input ? input : createPitchContext(input)
}

/** Apply the stateful subset of a pitch-context block to an immutable context. */
export function applyPitchContextChange(
  node: PitchContextChange,
  input: PitchContext = DEFAULT_PITCH_CONTEXT,
): PitchContext {
  let context = input
  for (const statement of node.statements) {
    if (statement.type === 'ContextPreset') {
      const edo = /^(\d+)edo$/i.exec(statement.raw)
      const parsed = edo
        ? { mapping: edoMapping(Number(edo[1])), divisions: Number(edo[1]), equave: 2 }
        : parseVal(statement.raw)
      const { mapping } = parsed
      const equave = Value.pitch(new Value(parsed.equave))
      const degrees = Array.from({ length: parsed.divisions }, (_, index) =>
        Value.equalDivision(index + 1, parsed.divisions, new Value(parsed.equave)),
      )
      context = {
        ...createPitchContext(mapping),
        degrees,
        degreeEquave: equave,
        rootDisplacement: context.rootDisplacement,
        rootFrequency: context.rootFrequency,
        rootPitch: {
          ...context.rootPitch,
          rootOffset: mapFormula(context.rootPitch.formula, mapping),
        },
      }
      continue
    }
    if (statement.type === 'ContextDegreeMapping') {
      let values = statement.values
      const enumerated = values.length === 1 ? values[0] : undefined
      if (enumerated?.type === 'EnumeratedChord') {
        let enumerands = enumerated.enumerands
        if (!enumerands) {
          const endpoints = [enumerated.first, enumerated.rangeEnd!].map((endpoint) => {
            const evaluated = evaluateExpression(endpoint, context)
            if (!('value' in evaluated) || evaluated.value.kind !== 'scalar') return undefined
            const exact = evaluated.value.value.exactRational()
            return exact?.d === 1 ? BigInt(exact.s * exact.n) : undefined
          })
          if (endpoints.some((endpoint) => endpoint === undefined))
            throw new TypeError('Enumerated scale range endpoints must be exact integers.')
          const [start, end] = endpoints as [bigint, bigint]
          const distance = start <= end ? end - start : start - end
          if (distance > 10_000n)
            throw new RangeError('Enumerated scale exceeds the 10000-member expansion limit.')
          const step = start <= end ? 1n : -1n
          enumerands = []
          for (let value = start; ; value += step) {
            enumerands.push({
              type: 'IntegerLiteral',
              value: String(value),
              raw: String(value),
              location: enumerated.location,
            })
            if (value === end) break
          }
        }
        // Unlike a chord used as notes, a scale already has an implicit unison.
        // Drop the first enumerand rather than storing a redundant 1/1 degree.
        values = enumerands.slice(1).map((enumerand) => ({
          type: 'BinaryExpression',
          operator: '/',
          left: enumerated.inverted ? enumerated.first : enumerand,
          right: enumerated.inverted ? enumerand : enumerated.first,
          location: enumerated.location,
        }))
      }
      const degrees = values.map((value) => {
        const evaluated = evaluateExpression(value, context)
        if (!('value' in evaluated) || evaluated.value.kind === 'absolutePitch')
          throw new TypeError('Degree assignments require pitch intervals.')
        return evaluated.value.kind === 'pitchOffset'
          ? evaluated.value.value
          : Value.pitch(evaluated.value.value)
      })
      if (!degrees.length) throw new TypeError('A degree assignment cannot be empty.')
      context = { ...context, degrees, degreeEquave: degrees[degrees.length - 1]! }
      continue
    }
    if (statement.type !== 'ContextAssignment')
      throw new TypeError('Unsupported pitch-context statement.')
    if (statement.target.type === 'ContextPitchTarget') {
      const evaluated = evaluateExpression(statement.value, context)
      if ('value' in evaluated && evaluated.value.kind === 'scalar') {
        const frequency = evaluated.value.value
        if (!frequency.dimensions.equals({ seconds: -1 }) || frequency.valueOf() <= 0)
          throw new TypeError(
            'A pitch frequency assignment requires a positive frequency quantity.',
          )
        const ratio = frequency.div(context.rootFrequency)
        context = {
          ...context,
          rootDisplacement: context.rootDisplacement.add(Value.pitch(ratio)),
          rootFrequency: frequency,
        }
        const target = evaluatePitchLiteral(statement.target.pitch, {
          ...context,
          rootPitch: createPitchContext(context.mapping).rootPitch,
        })
        context = { ...context, rootPitch: target }
        continue
      }
    }
    if (
      statement.target.type === 'ContextNameTarget' &&
      statement.target.name === 'root' &&
      statement.value.type === 'PitchLiteral'
    ) {
      const target = evaluatePitchLiteral(statement.value, context)
      context = {
        ...context,
        rootDisplacement: context.rootDisplacement.add(target.rootOffset),
        rootFrequency: context.rootFrequency.mul(Value.ratio(target.rootOffset)),
      }
      continue
    }
    if (statement.target.type === 'ContextNameTarget' && statement.target.name === 'root') {
      const evaluated = evaluateExpression(statement.value, context)
      if (!('value' in evaluated) || evaluated.value.kind !== 'scalar')
        throw new TypeError('A root frequency assignment requires a frequency quantity.')
      const frequency = evaluated.value.value
      if (!frequency.dimensions.equals({ seconds: -1 }) || frequency.valueOf() <= 0)
        throw new TypeError('A root frequency assignment requires a positive frequency quantity.')
      const ratio = frequency.div(context.rootFrequency)
      context = {
        ...context,
        rootDisplacement: context.rootDisplacement.add(Value.pitch(ratio)),
        rootFrequency: frequency,
      }
      continue
    }
    if (statement.target.type === 'ContextNameTarget' && statement.target.name === 'equave') {
      const evaluated = evaluateExpression(statement.value, context)
      if (!('value' in evaluated) || evaluated.value.kind === 'absolutePitch')
        throw new TypeError('An equave assignment requires a pitch interval.')
      const degreeEquave =
        evaluated.value.kind === 'pitchOffset'
          ? evaluated.value.value
          : Value.pitch(evaluated.value.value)
      context = { ...context, degreeEquave }
      continue
    }
    if (statement.target.type === 'ContextNameTarget' && statement.target.name === 'mode') {
      const evaluated = evaluateExpression(statement.value, context)
      if (
        !('value' in evaluated) ||
        evaluated.value.kind !== 'scalar' ||
        !evaluated.value.value.dimensions.isDimensionless
      )
        throw new TypeError('A mode assignment requires a dimensionless integer.')
      const exact = evaluated.value.value.exactRational()
      if (!exact || exact.d !== 1)
        throw new TypeError('A mode assignment requires a dimensionless integer.')

      const degreeCount = context.degrees.length
      const rotation = mmod(Number(exact.s * exact.n), degreeCount)
      if (!rotation) continue
      const unison = Value.cents(0)
      const pivot = context.degrees[rotation - 1]!
      const degrees = Array.from({ length: degreeCount }, (_, index) => {
        const unwrappedIndex = rotation + index + 1
        const degree =
          unwrappedIndex % degreeCount === 0
            ? unison
            : context.degrees[(unwrappedIndex % degreeCount) - 1]!
        return degree
          .add(context.degreeEquave.mul(new Value(Math.floor(unwrappedIndex / degreeCount))))
          .sub(pivot)
      })
      context = { ...context, degrees }
      continue
    }
    if (
      statement.target.type === 'ContextPitchTarget' &&
      statement.value.type === 'Identifier' &&
      statement.value.name === 'root'
    ) {
      const target = evaluatePitchLiteral(statement.target.pitch, {
        ...context,
        rootPitch: createPitchContext(context.mapping).rootPitch,
      })
      context = {
        ...context,
        rootPitch: target,
      }
      continue
    }
    if (statement.target.type === 'ContextOperatorTarget') {
      const evaluated =
        statement.value.type === 'IntervalLiteral'
          ? evaluateIntervalLiteral(statement.value, context)
          : undefined
      if (!evaluated) throw new TypeError('Pitch operator assignment requires an interval literal.')
      if (statement.target.operator === '^') context = { ...context, up: evaluated.value }
      else if (statement.target.operator === 'v')
        context = { ...context, up: evaluated.value.neg() }
      else if (statement.target.operator === '/') context = { ...context, lift: evaluated.value }
      else context = { ...context, lift: evaluated.value.neg() }
      continue
    }
    throw new TypeError('Unsupported pitch-context assignment.')
  }
  return context
}

const origin = (node: PitchLiteral | IntervalLiteral): readonly SourceOrigin[] => [
  { location: node.location, role: 'literal' },
]

function shifts(modifiers: readonly { kind: string }[]): number {
  return modifiers.reduce(
    (sum, modifier) =>
      sum +
      (modifier.kind === 'equaveUp'
        ? 1
        : modifier.kind === 'doubleEquaveUp'
          ? 2
          : modifier.kind === 'equaveDown'
            ? -1
            : 0),
    0,
  )
}

/** Preserve the diatonic meaning of subtracting two naturally spelled pitches. */
export function spellPitchDifference(left: AbsolutePitchValue, right: AbsolutePitchValue) {
  const rank = (spelling: PitchSpelling) => {
    const upper = spelling.nominal.toUpperCase()
    const key = GREEK_SCRIPT[upper] ?? upper
    const base = NOMINAL_RANK[key]
    if (base === undefined) return undefined
    const equaves = (spelling.modifiers ?? []).reduce(
      (sum, modifier) =>
        sum +
        (modifier === 'equaveUp'
          ? 1
          : modifier === 'doubleEquaveUp'
            ? 2
            : modifier === 'equaveDown'
              ? -1
              : 0),
      spelling.nominal === spelling.nominal.toLowerCase() ? 1 : 0,
    )
    return base + equaves * 7
  }
  const leftStep = rank(left.spelling)
  const rightStep = rank(right.spelling)
  if (leftStep === undefined || rightStep === undefined) return undefined
  const signedDistance = leftStep - rightStep
  const distance = Math.abs(signedDistance)
  const numericNumber = distance + 1
  const simple = (distance % 7) + 1
  const number = Number.isInteger(numericNumber)
    ? BigInt(numericNumber)
    : new Fraction(numericNumber)

  // The nominal distance supplies the interval number, while the sounding
  // formula supplies its quality. This distinction is essential for ordinary
  // spellings such as Eb - C (a minor third, not a major third) and C - D (a
  // descending major second, not an enharmonic augmented unison).
  const difference = new Map<number, Fraction>()
  for (const [prime, exponent] of left.formula) addExponent(difference, prime, exponent)
  for (const [prime, exponent] of right.formula) addExponent(difference, prime, exponent.neg())
  if (signedDistance < 0)
    for (const [prime, exponent] of difference) difference.set(prime, exponent.neg())
  const formulaSpelling = spellIntervalFormula(difference)
  const compatibleSpelling =
    formulaSpelling && Number(formulaSpelling.number.valueOf()) === numericNumber
      ? formulaSpelling
      : undefined
  const quality = compatibleSpelling
    ? compatibleSpelling.quality
    : [1, 4, 5, 1.5, 4.5, 7.5].includes(simple)
      ? 'P'
      : 'M'
  const inflections = compatibleSpelling?.inflections
  return {
    quality,
    number,
    raw: `${quality}${numericNumber}`,
    ...(signedDistance < 0 ? { direction: 'descending' as const } : {}),
    ...(inflections?.length ? { inflections } : {}),
  }
}

/** Transpose a written Latin pitch by the diatonic span of a named interval. */
export function transposePitchSpelling(
  pitch: PitchSpelling,
  interval: IntervalSpelling | undefined,
  subtract: boolean,
): PitchSpelling | undefined {
  if (!interval || pitch.system !== 'latin') return undefined
  const base = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(pitch.nominal.toUpperCase())
  if (base < 0) return undefined
  const octave =
    (pitch.nominal === pitch.nominal.toLowerCase() ? 1 : 0) +
    (pitch.modifiers ?? []).reduce(
      (sum, modifier) =>
        sum +
        (modifier === 'equaveUp'
          ? 1
          : modifier === 'doubleEquaveUp'
            ? 2
            : modifier === 'equaveDown'
              ? -1
              : 0),
      0,
    )
  const number = Number(interval.number.valueOf())
  const intervalOctaves = (interval.modifiers ?? []).reduce(
    (sum, modifier) =>
      sum +
      (modifier === 'equaveUp'
        ? 7
        : modifier === 'doubleEquaveUp'
          ? 14
          : modifier === 'equaveDown'
            ? -7
            : 0),
    0,
  )
  let steps = Math.ceil(number - 1) + intervalOctaves
  if (interval.direction === 'descending') steps = -steps
  if (subtract) steps = -steps
  const rank = base + octave * 7 + steps
  const nominal = ['C', 'D', 'E', 'F', 'G', 'A', 'B'][mmod(rank, 7)]!
  const targetOctave = Math.floor(rank / 7)
  const modifiers = targetOctave
    ? Array.from({ length: Math.abs(targetOctave) }, () =>
        targetOctave > 0 ? 'equaveUp' : 'equaveDown',
      )
    : undefined
  return {
    nominal,
    raw: nominal,
    system: 'latin',
    derived: true,
    ...(modifiers ? { modifiers } : {}),
  }
}

export function evaluatePitchLiteral(
  node: PitchLiteral,
  input: PrimeMapping | PitchContext,
): AbsolutePitchValue {
  const context = asContext(input)
  const upper = node.nominal.value.toUpperCase()
  const greekKey = GREEK_SCRIPT[upper] ?? upper
  const entries = node.nominal.system === 'latin' ? NOMINALS[upper] : GREEK_NOMINALS[greekKey]
  if (!entries) throw new TypeError(`Undefined nominal ${node.nominal.value}.`)
  const result = formula(entries)
  const octave =
    (node.nominal.value === node.nominal.value.toLowerCase() ? 1 : 0) + shifts(node.modifiers)
  if (octave) result.set(2, (result.get(2) ?? new Fraction(0)).add(octave))
  let chromatic = 0
  for (const accidental of node.accidentals) {
    if (accidental.value === '#' || accidental.value === '♯') chromatic++
    else if (accidental.value === 'b' || accidental.value === '♭') chromatic--
    else if (accidental.value === 'x' || accidental.value === '𝄪') chromatic += 2
    else if (accidental.value === '𝄫') chromatic -= 2
    else if (accidental.value === '𝄲' || accidental.value === '‡' || accidental.value === 't')
      chromatic += 0.5
    else if (accidental.value === '𝄳' || accidental.value === 'd') chromatic -= 0.5
    else if (accidental.value === 'p') {
      result.set(2, (result.get(2) ?? new Fraction(0)).sub(19))
      result.set(3, (result.get(3) ?? new Fraction(0)).add(12))
    } else if (accidental.value === 'q') {
      result.set(2, (result.get(2) ?? new Fraction(0)).add(19))
      result.set(3, (result.get(3) ?? new Fraction(0)).sub(12))
    } else if (accidental.value === '𝄬') {
      result.set(2, (result.get(2) ?? new Fraction(0)).add(7))
      result.set(3, (result.get(3) ?? new Fraction(0)).sub(3))
      result.set(5, (result.get(5) ?? new Fraction(0)).sub(1))
    } else if (accidental.value === '𝄭') {
      result.set(2, (result.get(2) ?? new Fraction(0)).add(15))
      result.set(3, (result.get(3) ?? new Fraction(0)).sub(11))
      result.set(5, (result.get(5) ?? new Fraction(0)).add(1))
    } else if (accidental.value === '𝄮') {
      result.set(2, (result.get(2) ?? new Fraction(0)).sub(4))
      result.set(3, (result.get(3) ?? new Fraction(0)).add(4))
      result.set(5, (result.get(5) ?? new Fraction(0)).sub(1))
    } else if (accidental.value === '𝄯') {
      result.set(2, (result.get(2) ?? new Fraction(0)).add(4))
      result.set(3, (result.get(3) ?? new Fraction(0)).sub(4))
      result.set(5, (result.get(5) ?? new Fraction(0)).add(1))
    } else if (accidental.value === '𝄰') {
      result.set(2, (result.get(2) ?? new Fraction(0)).sub(15))
      result.set(3, (result.get(3) ?? new Fraction(0)).add(11))
      result.set(5, (result.get(5) ?? new Fraction(0)).sub(1))
    } else if (accidental.value === '𝄱') {
      result.set(2, (result.get(2) ?? new Fraction(0)).sub(7))
      result.set(3, (result.get(3) ?? new Fraction(0)).add(3))
      result.set(5, (result.get(5) ?? new Fraction(0)).add(1))
    } else if (accidental.value !== '♮' && accidental.value !== '_')
      throw new TypeError(`Unsupported accidental ${accidental.value}.`)
  }
  if (chromatic) {
    result.set(2, (result.get(2) ?? new Fraction(0)).sub(11 * chromatic))
    result.set(3, (result.get(3) ?? new Fraction(0)).add(7 * chromatic))
  }
  applyFjsInflections(result, node.inflections)
  let rootOffset = mapFormula(result, context.mapping)
  if (context.rootPitch.formula.size)
    rootOffset = rootOffset.sub(mapFormula(context.rootPitch.formula, context.mapping))
  for (const modifier of node.modifiers) {
    if (modifier.kind === 'up') rootOffset = rootOffset.add(context.up)
    else if (modifier.kind === 'down') rootOffset = rootOffset.sub(context.up)
    else if (modifier.kind === 'lift') rootOffset = rootOffset.add(context.lift)
    else if (modifier.kind === 'drop') rootOffset = rootOffset.sub(context.lift)
  }
  return {
    kind: 'absolutePitch',
    rootOffset,
    formula: result,
    spelling: {
      nominal: node.nominal.value,
      raw: node.raw,
      system: node.nominal.system,
      accidentals: node.accidentals.map((accidental) => accidental.value),
      inflections: node.inflections.map((inflection) => ({
        direction: inflection.direction,
        prime: BigInt(inflection.prime),
        flavor: inflection.flavor,
      })),
      modifiers: node.modifiers.map((modifier) => modifier.kind),
    },
    origins: origin(node),
  }
}

export function evaluateIntervalLiteral(
  node: IntervalLiteral,
  input: PrimeMapping | PitchContext,
): PitchOffsetValue {
  const context = asContext(input)
  const number = new Fraction(node.number.replace('½', '.5'))
  if (number.compare(1) < 0) throw new TypeError('Interval number must be positive.')
  if (number.mul(2).d !== 1)
    throw new TypeError('Interval number must be an integer or half-integer.')
  const zeroBased = number.sub(1)
  const octaves = Math.floor(zeroBased.div(7).valueOf()) + shifts(node.modifiers)
  const simple = zeroBased.mmod(7).add(1).valueOf()
  const interordinal = !Number.isInteger(simple)
  const perfect = [1, 4, 5, 1.5, 4.5, 7.5].includes(simple)
  let chromatic: number
  if (/^SA+$/.test(node.quality)) chromatic = node.quality.length - 1.5
  else if (/^sd+$/.test(node.quality)) chromatic = -(node.quality.length - 1.5 + (perfect ? 0 : 1))
  else if (node.quality.startsWith('A'))
    chromatic = node.quality.length + (interordinal && !perfect ? 0.5 : 0)
  else if (node.quality.startsWith('d'))
    chromatic = -(node.quality.length + (perfect ? 0 : interordinal ? 0.5 : 1))
  else if (node.quality === 'P' && perfect) chromatic = 0
  else if (node.quality === 'M' && !perfect) chromatic = interordinal ? 0.5 : 0
  else if (node.quality === 'm' && !perfect) chromatic = interordinal ? -0.5 : -1
  else if (node.quality === 'n' && !perfect) chromatic = interordinal ? 0 : -0.5
  else if (node.quality === 'n' && simple === 4) chromatic = 0.5
  else if (node.quality === 'n' && simple === 5) chromatic = -0.5
  else throw new TypeError(`Quality ${node.quality} is invalid for interval ${node.number}.`)
  const result = interordinal
    ? formula(SEMIOCTAVE_INTERVALS[simple - 1.5]!)
    : formula(NOMINALS[['C', 'D', 'E', 'F', 'G', 'A', 'B'][simple - 1]!]!)
  if (octaves) result.set(2, (result.get(2) ?? new Fraction(0)).add(octaves))
  if (chromatic) {
    result.set(2, (result.get(2) ?? new Fraction(0)).sub(11 * chromatic))
    result.set(3, (result.get(3) ?? new Fraction(0)).add(7 * chromatic))
  }
  applyFjsInflections(result, node.inflections)
  const spellingNumber = number.d === 1 ? BigInt(number.n) : number
  let value = mapFormula(result, context.mapping)
  for (const modifier of node.modifiers) {
    if (modifier.kind === 'up') value = value.add(context.up)
    else if (modifier.kind === 'down') value = value.sub(context.up)
    else if (modifier.kind === 'lift') value = value.add(context.lift)
    else if (modifier.kind === 'drop') value = value.sub(context.lift)
  }
  return {
    kind: 'pitchOffset',
    value,
    formula: result,
    spelling: {
      quality: node.quality,
      number: spellingNumber,
      raw: node.raw,
      inflections: node.inflections.map((inflection) => ({
        direction: inflection.direction,
        prime: BigInt(inflection.prime),
        flavor: inflection.flavor,
      })),
      modifiers: node.modifiers.map((modifier) => modifier.kind),
    },
    origins: origin(node),
  }
}

/** Scale both the sounding displacement and its exact FJS formula. */
export function scalePitchOffset(offset: PitchOffsetValue, factor: Fraction): PitchOffsetValue {
  const scaledFormula = offset.formula
    ? new Map(
        [...offset.formula].map(([prime, exponent]) => [prime, new Fraction(exponent).mul(factor)]),
      )
    : undefined
  return {
    ...offset,
    value: offset.value.mul(new Value(factor)),
    formula: scaledFormula,
    spelling: scaledFormula ? spellIntervalFormula(scaledFormula) : undefined,
  }
}

export function spellIntervalFormula(input: PrimeMonzo): IntervalSpelling | undefined {
  const base = new Map([...input].map(([prime, exponent]) => [prime, new Fraction(exponent)]))
  const inflections: { direction: 'numerator' | 'denominator'; prime: bigint }[] = []
  for (const [prime, exponent] of input) {
    if (prime < 5) continue
    if (exponent.d !== 1) return undefined
    const direction = exponent.compare(0) > 0 ? 'numerator' : 'denominator'
    const count = Math.abs(exponent.n)
    const sign = direction === 'numerator' ? 1 : -1
    for (let index = 0; index < count; index++) {
      inflections.push({ direction, prime: BigInt(prime) })
      for (const [componentPrime, component] of fjsPrimeComma(prime))
        addExponent(base, componentPrime, new Fraction(component).mul(-sign))
    }
  }
  const twos = base.get(2) ?? new Fraction(0)
  const threes = base.get(3) ?? new Fraction(0)
  if ([...base].some(([prime, exponent]) => prime > 3 && exponent.n)) return undefined
  const stepspan = twos.mul(7).add(threes.mul(11))
  if (stepspan.d !== 1 || stepspan.compare(0) < 0) return undefined
  const span = stepspan.n
  const simple = (span % 7) + 1
  const number = BigInt(simple + 7 * Math.floor(span / 7))
  const natural = formula(NOMINALS[['C', 'D', 'E', 'F', 'G', 'A', 'B'][simple - 1]!]!)
  addExponent(natural, 2, Math.floor(span / 7))
  const chromatic = threes.sub(natural.get(3) ?? 0).div(7)
  if (chromatic.d !== 1 && chromatic.d !== 2) return undefined
  const chromaticSteps = chromatic.valueOf()
  const perfect = simple === 1 || simple === 4 || simple === 5
  let quality: string
  if (perfect)
    quality =
      chromaticSteps === 0
        ? 'P'
        : !Number.isInteger(chromaticSteps) && chromaticSteps > 0
          ? `S${'A'.repeat(chromaticSteps + 0.5)}`
          : !Number.isInteger(chromaticSteps) && chromaticSteps < 0
            ? `s${'d'.repeat(-chromaticSteps + 0.5)}`
            : chromaticSteps > 0
              ? 'A'.repeat(chromaticSteps)
              : 'd'.repeat(-chromaticSteps)
  else if (chromaticSteps === 0) quality = 'M'
  else if (chromaticSteps === -0.5) quality = 'n'
  else if (!Number.isInteger(chromaticSteps) && chromaticSteps > 0)
    quality = `S${'A'.repeat(chromaticSteps + 0.5)}`
  else if (chromaticSteps === -1) quality = 'm'
  else if (chromaticSteps < -1 && !Number.isInteger(chromaticSteps))
    quality = `s${'d'.repeat(-chromaticSteps - 0.5)}`
  else if (chromaticSteps > 0) quality = 'A'.repeat(chromaticSteps)
  else quality = 'd'.repeat(-chromaticSteps - 1)
  const groupedInflections = groupFjsInflections(inflections)
  const suffix = groupedInflections
    .map(({ direction, prime }) => `${direction === 'numerator' ? '^' : 'v'}${prime}`)
    .join('')
  return { quality, number, inflections: groupedInflections, raw: `${quality}${number}${suffix}` }
}

export type PitchEvaluationResult = {
  readonly value: AbsolutePitchValue | PitchOffsetValue
  readonly diagnostics: readonly Diagnostic[]
}
