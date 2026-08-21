import { Fraction, gcd, mmod } from 'xen-dev-utils/fraction'
import { PRIMES } from 'xen-dev-utils/primes'
import { stepString } from 'moment-of-symmetry/core'
import { generateNotation, type MosMonzo } from 'moment-of-symmetry/notation'
import type {
  Expression,
  IntervalLiteral,
  PitchContextChange,
  PitchLiteral,
  MosIntervalLiteral,
  MosDeclaration,
  SignatureDeclaration,
} from '../parser.generated.js'
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
  MosContext,
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
  const equalDivision = mapping.equalDivision
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
    // In an EDO, up/down and lift/drop are sensible inflections of one and
    // five steps respectively. Mapping their default commas prime-by-prime
    // can instead produce zero, a fractional step, or even a displacement in
    // the wrong direction (as the up/down comma does in 16-EDO).
    up: equalDivision
      ? Value.equalDivision(1, equalDivision.divisions, equalDivision.equave)
      : mapFormula(
          new Map([
            [2, new Fraction(-1, 2)],
            [3, new Fraction(5, 2)],
            [11, new Fraction(-1)],
          ]),
          mapping,
        ),
    lift: equalDivision
      ? Value.equalDivision(5, equalDivision.divisions, equalDivision.equave)
      : mapFormula(
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
    if (statement.type === 'SignatureDeclaration') {
      context = applySignatureDeclaration(statement, context)
      continue
    }
    if (statement.type === 'MosDeclaration') {
      context = applyMosDeclaration(statement, context)
      continue
    }
    if (statement.type === 'ContextPreset') {
      const untempered = /^(?:Pythagorean|JustIntonation|JI|Untempered)$/i.test(statement.raw)
      const edo = /^(\d+)edo$/i.exec(statement.raw)
      const parsed = untempered
        ? { mapping: DEFAULT_MAPPING, divisions: 12, equave: 2 }
        : edo
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
      const expandDegreeExpression = (expression: Expression): Expression[] => {
        if (expression.type === 'Sequence') return expression.items.flatMap(expandDegreeExpression)
        if (expression.type === 'Parallel')
          return expression.branches.flatMap(expandDegreeExpression)
        if (expression.type !== 'EnumeratedChord') return [expression]

        const enumerated = expression
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
        return enumerands.slice(1).map((enumerand) => ({
          type: 'BinaryExpression',
          operator: '/',
          left: enumerated.inverted ? enumerated.first : enumerand,
          right: enumerated.inverted ? enumerand : enumerated.first,
          location: enumerated.location,
        }))
      }
      const values = statement.values.flatMap(expandDegreeExpression)
      const degrees = values.map((value) => {
        const evaluated = evaluateExpression(value, context)
        if (!('value' in evaluated))
          throw new TypeError('Degree assignments require pitch intervals.')
        if (evaluated.value.kind === 'absolutePitch') return evaluated.value.rootOffset
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
    if (
      statement.target.type === 'ContextNameTarget' &&
      statement.target.name === 'map' &&
      statement.value.type === 'MappingLiteral'
    ) {
      const literal = statement.value
      const mappedPrimes = new Map<number, Value>()
      literal.values.forEach((expression, index) => {
        const prime = PRIMES[index]
        if (prime === undefined) throw new RangeError('Prime mapping exceeds the supported primes.')
        const evaluated = evaluateExpression(expression, context)
        if (!('value' in evaluated) || evaluated.value.kind === 'absolutePitch')
          throw new TypeError('Prime mapping entries require pitch intervals.')
        const value =
          evaluated.value.kind === 'pitchOffset'
            ? evaluated.value.value
            : evaluated.value.value.dimensions.isDimensionless
              ? Value.pitch(evaluated.value.value)
              : undefined
        if (!value) throw new TypeError('Prime mapping entries require pitch intervals.')
        mappedPrimes.set(prime, value)
      })

      const mapping: PrimeMapping = {
        id: 'custom',
        mapPrime: (prime) =>
          mappedPrimes.get(prime) ??
          (literal.closingDelimiter === ']' ? DEFAULT_MAPPING.mapPrime(prime) : Value.cents(0)),
      }
      context = {
        ...context,
        mapping,
        rootPitch: {
          ...context.rootPitch,
          rootOffset: mapFormula(context.rootPitch.formula, mapping),
        },
      }
      continue
    }
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
    if (statement.target.type === 'ContextNameTarget' && statement.target.name === 'root') {
      const evaluated = evaluateExpression(statement.value, context)
      if ('value' in evaluated && evaluated.value.kind === 'absolutePitch') {
        context = {
          ...context,
          rootDisplacement: context.rootDisplacement.add(evaluated.value.rootOffset),
          rootFrequency: context.rootFrequency.mul(Value.ratio(evaluated.value.rootOffset)),
        }
        continue
      }
      if ('value' in evaluated && evaluated.value.kind === 'pitchOffset') {
        context = {
          ...context,
          rootDisplacement: context.rootDisplacement.add(evaluated.value.value),
          rootFrequency: context.rootFrequency.mul(Value.ratio(evaluated.value.value)),
        }
        continue
      }
      if (!('value' in evaluated) || evaluated.value.kind !== 'scalar')
        throw new TypeError(
          'A root assignment requires a scale degree, frequency quantity, or ratio.',
        )
      const argument = evaluated.value.value
      const frequency = argument.dimensions.isDimensionless
        ? context.rootFrequency.mul(argument)
        : argument
      if (!frequency.dimensions.equals({ seconds: -1 }) || frequency.valueOf() <= 0)
        throw new TypeError(
          'A root frequency assignment requires a positive frequency quantity or ratio.',
        )
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
      const evaluated = evaluateExpression(statement.value, context)
      if (!('value' in evaluated) || evaluated.value.kind === 'absolutePitch')
        throw new TypeError('Pitch operator assignment requires a pitch interval.')
      const value =
        evaluated.value.kind === 'pitchOffset'
          ? evaluated.value.value
          : evaluated.value.value.dimensions.isDimensionless
            ? Value.pitch(evaluated.value.value)
            : undefined
      if (!value) throw new TypeError('Pitch operator assignment requires a pitch interval.')
      if (statement.target.operator === '^') context = { ...context, up: value }
      else if (statement.target.operator === 'v') context = { ...context, up: value.neg() }
      else if (statement.target.operator === '/') context = { ...context, lift: value }
      else context = { ...context, lift: value.neg() }
      continue
    }
    throw new TypeError('Unsupported pitch-context assignment.')
  }
  return context
}

function mosSetterValue(expression: Expression, context: PitchContext): Value {
  const evaluated = evaluateExpression(expression, context)
  if (!('value' in evaluated) || evaluated.value.kind === 'absolutePitch')
    throw new TypeError('A MOS step assignment requires a pitch interval.')
  return evaluated.value.kind === 'pitchOffset'
    ? evaluated.value.value
    : Value.pitch(evaluated.value.value)
}

function mosOperatorInteger(expression: Expression, context: PitchContext): number | undefined {
  if (expression.type !== 'IntegerLiteral') return undefined
  const evaluated = evaluateExpression(expression, context)
  if (!('value' in evaluated) || evaluated.value.kind !== 'scalar') return undefined
  const exact = evaluated.value.value.exactRational()
  if (!exact || exact.d !== 1) return undefined
  return exact.s * exact.n
}

function accidentalSteps(pitch: PitchLiteral, mos: boolean): number {
  let steps = 0
  for (const accidental of pitch.accidentals) {
    if (mos) {
      if (accidental.value === '&') steps += 1
      else if (accidental.value === '@') steps -= 1
      else if (accidental.value === 'e') steps += 0.5
      else if (accidental.value === 'a') steps -= 0.5
    } else if (accidental.value === '#' || accidental.value === '♯') steps += 1
    else if (accidental.value === 'b' || accidental.value === '♭') steps -= 1
    else if (accidental.value === 'x' || accidental.value === '𝄪') steps += 2
    else if (accidental.value === '𝄫') steps -= 2
    else if (accidental.value === 't' || accidental.value === '𝄲' || accidental.value === '‡')
      steps += 0.5
    else if (accidental.value === 'd' || accidental.value === '𝄳') steps -= 0.5
  }
  return steps
}

function signaturePitch(
  nominal: string,
  source: PitchLiteral,
  steps: number,
  mos: boolean,
): PitchLiteral {
  const positive = mos ? '&' : '#'
  const negative = mos ? '@' : 'b'
  const halfPositive = mos ? 'e' : 't'
  const halfNegative = mos ? 'a' : 'd'
  const whole = Math.trunc(Math.abs(steps))
  const values: string[] = Array.from({ length: whole }, () => (steps > 0 ? positive : negative))
  if (Math.abs(steps) % 1) values.push(steps > 0 ? halfPositive : halfNegative)
  return {
    ...source,
    nominal: { ...source.nominal, value: nominal },
    accidentals: values.map((value) => ({ type: 'Accidental', value, location: source.location })),
    raw: nominal,
  }
}

function applySignatureDeclaration(
  declaration: SignatureDeclaration,
  context: PitchContext,
  modeNominals?: ReadonlyMap<string, Value>,
): PitchContext {
  if (declaration.kind === 'sig') {
    const signature = new Map<string, PitchLiteral>()
    for (const pitch of declaration.pitches)
      for (const nominal of tiedNominals(pitch.nominal.value)) signature.set(nominal, pitch)
    return { ...context, signature }
  }
  if (declaration.pitches.length !== 1)
    throw new TypeError('A key signature requires exactly one tonic pitch.')
  const tonic = declaration.pitches[0]!
  const mos = tonic.nominal.system === 'mos'
  if (mos) {
    if (!context.mos) throw new TypeError('A MOS key signature requires a MOS declaration.')
    const names = [...context.mos.nominals.keys()]
    const tonicName = tonic.nominal.value.toUpperCase()
    const rotation = names.indexOf(tonicName)
    if (rotation < 0) throw new TypeError(`Undefined MOS key nominal ${tonic.nominal.value}.`)
    const tonicNatural = context.mos.nominals.get(tonicName)!
    const chroma = context.mos.large.sub(context.mos.small).valueOf()
    const tonicOffset = tonicNatural.valueOf() + accidentalSteps(tonic, true) * chroma
    const signature = new Map<string, PitchLiteral>()
    for (let index = 0; index < names.length; index++) {
      const scaleIndex = mmod(index - rotation, names.length)
      let desired =
        tonicOffset + (modeNominals ?? context.mos.nominals).get(names[scaleIndex]!)!.valueOf()
      while (desired >= context.mos.equave.valueOf()) desired -= context.mos.equave.valueOf()
      while (desired < 0) desired += context.mos.equave.valueOf()
      const natural = context.mos.nominals.get(names[index]!)!.valueOf()
      let difference = desired - natural
      while (difference > context.mos.equave.valueOf() / 2)
        difference -= context.mos.equave.valueOf()
      while (difference < -context.mos.equave.valueOf() / 2)
        difference += context.mos.equave.valueOf()
      const steps = Math.round((difference / chroma) * 2) / 2
      const entry = signaturePitch(names[index]!, tonic, steps, true)
      signature.set(names[index]!, entry)
    }
    return { ...context, signature }
  }
  if (tonic.nominal.system !== 'latin' && tonic.nominal.system !== 'greek')
    throw new TypeError('Key signatures require a Latin or MOS tonic.')
  const fifths: Record<string, number> = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, F: -1 }
  const modeFifths = {
    lydian: 1,
    ionian: 0,
    major: 0,
    mixolydian: -1,
    dorian: -2,
    aeolian: -3,
    minor: -3,
    phrygian: -4,
    locrian: -5,
  } as const
  const tonicName = tiedNominals(tonic.nominal.value)[0]!
  const signature = new Map<string, PitchLiteral>()
  for (const name of ['C', 'D', 'E', 'F', 'G', 'A', 'B']) {
    const baseCount = fifths[tonicName]! + modeFifths[declaration.mode ?? 'ionian']
    const position = (
      baseCount >= 0 ? ['F', 'C', 'G', 'D', 'A', 'E', 'B'] : ['B', 'E', 'A', 'D', 'G', 'C', 'F']
    ).indexOf(name)
    const baseSteps = position < Math.abs(baseCount) ? Math.sign(baseCount) : 0
    const steps = baseSteps + accidentalSteps(tonic, false)
    const entry = signaturePitch(name, tonic, steps, false)
    for (const nominal of tiedNominals(name)) signature.set(nominal, entry)
  }
  return { ...context, signature }
}

const TIED_NOMINALS = [
  ['C', 'GAM', 'Γ'],
  ['D', 'DEL', 'Δ'],
  ['E', 'EPS', 'Ε'],
  ['F', 'ZET', 'Ζ'],
  ['G', 'ETA', 'Η'],
  ['A', 'ALP', 'Α'],
  ['B', 'BET', 'Β'],
] as const

function tiedNominals(nominal: string): readonly string[] {
  const upper = nominal.toUpperCase()
  return TIED_NOMINALS.find((group) => group.includes(upper as never)) ?? [upper]
}

function applyMosDeclaration(declaration: MosDeclaration, context: PitchContext): PitchContext {
  let equave = Value.pitch(new Value(2))
  let equaveGiven = false
  let pattern: string | undefined
  let counts: { large: number; small: number } | undefined
  let udp: { up: number; down: number; period?: number } | undefined
  let hardnessNumerator = 2
  let hardnessDenominator = 1
  let hardnessGiven = false
  const assignments = new Map<string, Value>()
  const integerOperatorAssignments = new Map<string, number>()
  let signatureDeclaration: SignatureDeclaration | undefined

  for (const element of declaration.elements) {
    if (element.type === 'SignatureDeclaration') {
      if (signatureDeclaration)
        throw new TypeError('A MOS declaration may only contain one signature.')
      signatureDeclaration = element
      if (element.udp) {
        if (udp) throw new TypeError('A MOS declaration may only contain one UD(P) selection.')
        udp = {
          up: Number(element.udp.up),
          down: Number(element.udp.down),
          ...(element.udp.period ? { period: Number(element.udp.period) } : {}),
        }
      }
    } else if (element.type === 'MosPatternCounts') {
      if (pattern || counts) throw new TypeError('A MOS declaration may only contain one mode.')
      counts = { large: Number(element.large), small: Number(element.small) }
    } else if (element.type === 'MosAbstractPattern') {
      if (pattern || counts) throw new TypeError('A MOS declaration may only contain one mode.')
      pattern = element.pattern
    } else if (element.type === 'MosIntegerPattern') {
      if (pattern || counts) throw new TypeError('A MOS declaration may only contain one mode.')
      const parts = element.values.map(Number)
      const low = Math.min(...parts)
      const high = Math.max(...parts)
      if (low === high) throw new TypeError('A MOS pattern requires two step sizes.')
      pattern = parts.map((part) => (part === high ? 'L' : part === low ? 's' : '?')).join('')
      if (pattern.includes('?'))
        throw new TypeError('A MOS pattern requires exactly two step sizes.')
      hardnessNumerator = high
      hardnessDenominator = low
      hardnessGiven = true
    } else if (element.type === 'MosHardness') {
      if (hardnessGiven) throw new TypeError('A MOS declaration may only contain one hardness.')
      hardnessNumerator = Number(element.numerator)
      hardnessDenominator = Number(element.denominator)
      hardnessGiven = true
    } else if (element.type === 'MosUdp') {
      if (udp) throw new TypeError('A MOS declaration may only contain one UD(P) selection.')
      udp = {
        up: Number(element.up),
        down: Number(element.down),
        ...(element.period ? { period: Number(element.period) } : {}),
      }
    } else if (element.type === 'MosEquave') {
      if (equaveGiven) throw new TypeError('A MOS declaration may only contain one equave.')
      equaveGiven = true
      equave = mosSetterValue(element.value, context)
    } else if (element.type === 'MosStepAssignment') {
      if (assignments.has(element.target) || integerOperatorAssignments.has(element.target))
        throw new TypeError(`MOS step ${element.target} may only be assigned once.`)
      const integer =
        element.target === '^' || element.target === '/'
          ? mosOperatorInteger(element.value, context)
          : undefined
      if (integer === undefined)
        assignments.set(element.target, mosSetterValue(element.value, context))
      else integerOperatorAssignments.set(element.target, integer)
    }
  }

  const selectsModeFromCurrentCounts = !counts && !pattern && !!udp
  const preserveOperators =
    !counts && !pattern && !hardnessGiven && !equaveGiven && (!udp || selectsModeFromCurrentCounts)

  if (
    !counts &&
    !pattern &&
    !hardnessGiven &&
    !equaveGiven &&
    !udp &&
    !assignments.has('L') &&
    !assignments.has('s')
  ) {
    if (!context.mos) throw new TypeError('A MOS step setter requires an active MOS declaration.')
    const result: PitchContext = {
      ...context,
      mos: {
        ...context.mos,
        up:
          assignments.get('^') ??
          (integerOperatorAssignments.has('^') && context.mos.hostStep
            ? context.mos.hostStep.mul(new Value(integerOperatorAssignments.get('^')!))
            : integerOperatorAssignments.has('^')
              ? undefined
              : context.mos.up),
        lift:
          assignments.get('/') ??
          (integerOperatorAssignments.has('/') && context.mos.hostStep
            ? context.mos.hostStep.mul(new Value(integerOperatorAssignments.get('/')!))
            : integerOperatorAssignments.has('/')
              ? undefined
              : context.mos.lift),
      },
    }
    return signatureDeclaration ? applySignatureDeclaration(signatureDeclaration, result) : result
  }

  if (selectsModeFromCurrentCounts) {
    if (!context.mos) throw new TypeError('UD(P) selection requires a large/small count pattern.')
    counts = {
      large: [...context.mos.pattern].filter((step) => step === 'L').length,
      small: [...context.mos.pattern].filter((step) => step === 's').length,
    }
    if (!equaveGiven) equave = context.mos.equave
    if (!assignments.has('L')) assignments.set('L', context.mos.large)
    if (!assignments.has('s')) assignments.set('s', context.mos.small)
  }

  if (counts) {
    if (udp?.period !== undefined && udp.period !== gcd(counts.large, counts.small))
      throw new TypeError('MOS period must be consistent with the step counts.')
    pattern = stepString(counts.large, counts.small, udp)
  } else if (udp) {
    throw new TypeError('UD(P) selection requires a large/small count pattern.')
  }
  if (!pattern) {
    if (!context.mos) throw new TypeError('A MOS declaration requires a mode.')
    pattern = context.mos.pattern
    if (!equaveGiven) equave = context.mos.equave
  }
  const countL = [...pattern].filter((x) => x === 'L').length
  const countS = pattern.length - countL
  let large = assignments.get('L')
  let small = assignments.get('s')
  if (!large && !small) {
    const host = countL * hardnessNumerator + countS * hardnessDenominator
    large = Value.equalDivision(hardnessNumerator, host, Value.ratio(equave))
    small = Value.equalDivision(hardnessDenominator, host, Value.ratio(equave))
  } else if (large && !small)
    small = equave.sub(large.mul(new Value(countL))).div(new Value(countS))
  else if (small && !large) large = equave.sub(small.mul(new Value(countS))).div(new Value(countL))
  const accumulated = large!.mul(new Value(countL)).add(small!.mul(new Value(countS)))
  if (Math.abs(accumulated.valueOf() - equave.valueOf()) > 1e-8)
    throw new TypeError('The MOS large and small steps must accumulate to the MOS equave.')
  const largeUnit = large!.div(new Value(hardnessNumerator))
  const smallUnit = small!.div(new Value(hardnessDenominator))
  const hostStep =
    Math.abs(largeUnit.valueOf() - smallUnit.valueOf()) <= 1e-8 ? largeUnit : undefined

  const realize = (monzo: MosMonzo): Value =>
    large!.mul(new Value(monzo[0])).add(small!.mul(new Value(monzo[1])))
  const realizeNotation = (notationPattern: string) => {
    const notation = generateNotation(notationPattern)
    const nominals = new Map<string, Value>()
    for (const [nominal, monzo] of notation.scale) nominals.set(nominal, realize(monzo))
    const degrees = notation.degrees.map((degree) => ({
      center: realize(degree.center),
      imperfect: !degree.perfect,
      ...(degree.mid ? { mid: realize(degree.mid) } : {}),
    }))
    return { nominals, degrees, period: realize(notation.period) }
  }
  const notation = realizeNotation(pattern)
  const offsets = [...notation.nominals.values()]
  const mos: MosContext = {
    pattern,
    equave,
    period: notation.period,
    large: large!,
    small: small!,
    ...(hostStep ? { hostStep } : {}),
    up: assignments.has('^')
      ? assignments.get('^')!
      : integerOperatorAssignments.has('^') && hostStep
        ? hostStep.mul(new Value(integerOperatorAssignments.get('^')!))
        : preserveOperators
          ? context.mos?.up
          : hostStep,
    lift: assignments.has('/')
      ? assignments.get('/')!
      : integerOperatorAssignments.has('/') && hostStep
        ? hostStep.mul(new Value(integerOperatorAssignments.get('/')!))
        : preserveOperators
          ? context.mos?.lift
          : hostStep?.mul(new Value(5)),
    nominals: notation.nominals,
    degrees: notation.degrees,
  }
  const result: PitchContext = {
    ...context,
    mos,
    degrees: [...offsets.slice(1), equave],
    degreeEquave: equave,
  }
  if (!signatureDeclaration) return result
  if (selectsModeFromCurrentCounts) {
    const activeNotation = realizeNotation(context.mos!.pattern)
    const activeResult: PitchContext = {
      ...result,
      mos: {
        ...mos,
        pattern: context.mos!.pattern,
        period: activeNotation.period,
        nominals: activeNotation.nominals,
        degrees: activeNotation.degrees,
      },
      degrees: [...activeNotation.nominals.values()].slice(1).concat(equave),
    }
    return applySignatureDeclaration(signatureDeclaration, activeResult, mos.nominals)
  }
  return applySignatureDeclaration(signatureDeclaration, result)
}

export function requirePitchOperator(context: PitchContext, operator: 'up' | 'lift'): Value {
  const value = context.mos ? context.mos[operator] : context[operator]
  if (!value)
    throw new TypeError(
      `Cannot derive the MOS ${operator} interval because the scale has no equal-temperament host.`,
    )
  return value
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
  if (left.mos && right.mos && left.mos.context === right.mos.context) {
    const signedDistance = left.mos.rank - right.mos.rank
    const distance = Math.abs(signedDistance)
    const mos = left.mos.context
    const simple = mmod(distance, mos.degrees.length)
    const periods = Math.floor(distance / mos.degrees.length)
    const degree = mos.degrees[simple]!
    const center = degree.center.add(mos.period.mul(new Value(periods)))
    let sounding = left.rootOffset.sub(right.rootOffset)
    if (signedDistance < 0) sounding = sounding.neg()
    const chroma = mos.large.sub(mos.small).valueOf()
    const alteration = Math.round(((sounding.valueOf() - center.valueOf()) / chroma) * 2) / 2
    let quality: string
    if (degree.imperfect) {
      if (alteration === 0.5) quality = 'M'
      else if (alteration === -0.5) quality = 'm'
      else if (alteration === 0) quality = 'n'
      else if (alteration > 0.5) quality = 'A'.repeat(Math.round(alteration - 0.5))
      else quality = 'd'.repeat(Math.round(-alteration - 0.5))
    } else if (
      degree.mid &&
      Math.abs(sounding.valueOf() - degree.mid.add(mos.period.mul(new Value(periods))).valueOf()) <
        1e-8
    ) {
      quality = 'n'
    } else if (alteration === 0) quality = 'P'
    else if (alteration > 0) quality = 'A'.repeat(Math.round(alteration))
    else quality = 'd'.repeat(Math.round(-alteration))
    return {
      quality,
      number: BigInt(distance),
      raw: `${quality}${distance}ms`,
      ...(signedDistance < 0 ? { direction: 'descending' as const } : {}),
    }
  }

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
  let fromSignature = false
  const explicitlyNatural = node.accidentals.some(
    (accidental) => accidental.value === '_' || accidental.value === '♮',
  )
  const defaultSpelling = context.signature?.get(node.nominal.value.toUpperCase())
  if (
    defaultSpelling &&
    !explicitlyNatural &&
    !node.accidentals.length &&
    !node.modifiers.length &&
    !node.inflections.length
  ) {
    fromSignature = true
    node = {
      ...node,
      modifiers: defaultSpelling.modifiers,
      accidentals: defaultSpelling.accidentals,
      inflections: defaultSpelling.inflections,
    }
  }
  if (node.nominal.system === 'mos') {
    if (!context.mos) throw new TypeError('Diamond-MOS pitches require a MOS declaration.')
    const nominal = node.nominal.value.toUpperCase()
    let rootOffset = context.mos.nominals.get(nominal)
    if (!rootOffset) throw new TypeError(`Undefined MOS nominal ${node.nominal.value}.`)
    const registers =
      (node.nominal.value === node.nominal.value.toLowerCase() ? 1 : 0) + shifts(node.modifiers)
    const nominalRank = [...context.mos.nominals.keys()].indexOf(nominal)
    rootOffset = rootOffset.add(context.mos.equave.mul(new Value(registers)))
    const chroma = context.mos.large.sub(context.mos.small)
    for (const accidental of node.accidentals) {
      if (accidental.value === '&') rootOffset = rootOffset.add(chroma)
      else if (accidental.value === '@') rootOffset = rootOffset.sub(chroma)
      else if (accidental.value === 'e') rootOffset = rootOffset.add(chroma.div(new Value(2)))
      else if (accidental.value === 'a') rootOffset = rootOffset.sub(chroma.div(new Value(2)))
      else throw new TypeError(`Unsupported Diamond-MOS accidental ${accidental.value}.`)
    }
    if (context.rootPitch.mos?.context === context.mos) {
      rootOffset = rootOffset.sub(context.rootPitch.rootOffset)
    }
    for (const modifier of node.modifiers) {
      if (modifier.kind === 'up') rootOffset = rootOffset.add(requirePitchOperator(context, 'up'))
      else if (modifier.kind === 'down')
        rootOffset = rootOffset.sub(requirePitchOperator(context, 'up'))
      else if (modifier.kind === 'lift')
        rootOffset = rootOffset.add(requirePitchOperator(context, 'lift'))
      else if (modifier.kind === 'drop')
        rootOffset = rootOffset.sub(requirePitchOperator(context, 'lift'))
    }
    return {
      kind: 'absolutePitch',
      rootOffset,
      formula: new Map(),
      spelling: {
        nominal: node.nominal.value,
        raw: node.raw,
        system: 'mos',
        accidentals: node.accidentals.map((a) => a.value),
        modifiers: node.modifiers.map((m) => m.kind),
        ...(fromSignature ? { signature: true } : {}),
      },
      mos: { rank: nominalRank + registers * context.mos.nominals.size, context: context.mos },
      origins: origin(node),
    }
  }
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
    if (modifier.kind === 'up') rootOffset = rootOffset.add(requirePitchOperator(context, 'up'))
    else if (modifier.kind === 'down')
      rootOffset = rootOffset.sub(requirePitchOperator(context, 'up'))
    else if (modifier.kind === 'lift')
      rootOffset = rootOffset.add(requirePitchOperator(context, 'lift'))
    else if (modifier.kind === 'drop')
      rootOffset = rootOffset.sub(requirePitchOperator(context, 'lift'))
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
      ...(fromSignature ? { signature: true } : {}),
    },
    origins: origin(node),
  }
}

export function evaluateMosIntervalLiteral(
  node: MosIntervalLiteral,
  input: PrimeMapping | PitchContext,
): PitchOffsetValue {
  const context = asContext(input)
  if (!context.mos) throw new TypeError('MOS-step intervals require a MOS declaration.')
  const degree = Number(node.degree)
  const size = context.mos.degrees.length
  const simple = mmod(degree, size)
  let value = context.mos.degrees[simple]!.center.add(
    context.mos.period.mul(new Value(Math.floor(degree / size))),
  )
  const imperfect = context.mos.degrees[simple]!.imperfect
  const chroma = context.mos.large.sub(context.mos.small)
  let alteration = 0
  if (node.quality === 'P') {
    if (imperfect) throw new TypeError(`P is invalid for MOS step ${degree}.`)
  } else if (node.quality === 'M') {
    if (!imperfect) throw new TypeError(`M is invalid for MOS step ${degree}.`)
    alteration = 0.5
  } else if (node.quality === 'm') {
    if (!imperfect) throw new TypeError(`m is invalid for MOS step ${degree}.`)
    alteration = -0.5
  } else if (node.quality === 'n') {
    if (!imperfect) {
      const mid = context.mos.degrees[simple]!.mid
      if (!mid) throw new TypeError(`n is invalid for MOS step ${degree}.`)
      value = mid.add(context.mos.period.mul(new Value(Math.floor(degree / size))))
    }
  } else if (node.quality.startsWith('A')) alteration = node.quality.length + (imperfect ? 0.5 : 0)
  else alteration = -(node.quality.length + (imperfect ? 0.5 : 0))
  value = value.add(chroma.mul(new Value(alteration)))
  return {
    kind: 'pitchOffset',
    value,
    spelling: { quality: node.quality, number: BigInt(degree), raw: node.raw, modifiers: [] },
    origins: [{ location: node.location, role: 'literal' }],
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
    if (modifier.kind === 'up') value = value.add(requirePitchOperator(context, 'up'))
    else if (modifier.kind === 'down') value = value.sub(requirePitchOperator(context, 'up'))
    else if (modifier.kind === 'lift') value = value.add(requirePitchOperator(context, 'lift'))
    else if (modifier.kind === 'drop') value = value.sub(requirePitchOperator(context, 'lift'))
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
  if (stepspan.mul(2).d !== 1 || stepspan.compare(0) < 0) return undefined
  const span = stepspan.valueOf()
  const simple = (span % 7) + 1
  const octave = Math.floor(span / 7)
  const number = stepspan.d === 1 ? BigInt(stepspan.n + 1) : stepspan.add(1)
  const natural = Number.isInteger(simple)
    ? formula(NOMINALS[['C', 'D', 'E', 'F', 'G', 'A', 'B'][simple - 1]!]!)
    : formula(SEMIOCTAVE_INTERVALS[simple - 1.5]!)
  addExponent(natural, 2, octave)
  const chromatic = threes.sub(natural.get(3) ?? 0).div(7)
  if (chromatic.d !== 1 && chromatic.d !== 2) return undefined
  const chromaticSteps = chromatic.valueOf()
  const perfect = [1, 4, 5, 1.5, 4.5, 7.5].includes(simple)
  const interordinal = !Number.isInteger(simple)
  // Imperfect interordinals use half-step alterations for major/minor and
  // augmented/diminished qualities. A non-zero integral alteration therefore
  // has no interval quality that can be parsed back to the same formula.
  if (interordinal && !perfect && Number.isInteger(chromaticSteps) && chromaticSteps !== 0)
    return undefined
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
  else if (chromaticSteps === (interordinal ? 0.5 : 0)) quality = 'M'
  else if (chromaticSteps === (interordinal ? 0 : -0.5)) quality = 'n'
  else if (!Number.isInteger(chromaticSteps) && chromaticSteps > 0)
    quality = `S${'A'.repeat(chromaticSteps + 0.5)}`
  else if (chromaticSteps === (interordinal ? -0.5 : -1)) quality = 'm'
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
