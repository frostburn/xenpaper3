import { generateNotation, stepString, type MosMonzo } from 'moment-of-symmetry'
import { valueToCents } from 'xen-dev-utils/conversion'
import { gcd } from 'xen-dev-utils/fraction'

import type { AccidentalType, MosExpressionType, MosExpressionValueType } from './grammar.generated'

type MosMode = { up: number; down: number; period: number | null }

export type MosKeySignatureAdjustment = {
  ups: number
  lifts: number
  accidentals: AccidentalType[]
}

export type MosKeySignature = Map<string, MosKeySignatureAdjustment>

export type MosConfig = {
  pattern: string
  equaveSize: number
  sizeOfLargeStep: number
  sizeOfSmallStep: number
  stepSize: number
  up: number
  lift: number
  chromaSteps: number
  nominalSteps: Map<string, number>
  nominalMonzos: Map<string, MosMonzo>
  nominalOrder: string[]
  expressions: MosExpressionValueType[]
  equaveSteps: number
  equaveMonzo: MosMonzo
  keySignature: MosKeySignature
}

export const mosExpressionPrecedence = (expression: MosExpressionValueType): number => {
  switch (expression.type) {
    case 'MosRationalEquave':
    case 'MosHardness':
    case 'MosMode':
      return 1
    default:
      return 0
  }
}

export const mosStepPattern = (
  countLarge: number,
  countSmall: number,
  mode: MosMode | null,
): string => {
  if (countLarge + countSmall <= 0) throw new Error('MOS size must be positive.')
  return stepString(countLarge, countSmall, mode ? { up: mode.up, down: mode.down } : undefined)
}

export const createMosConfig = (expressions: MosExpressionValueType[]): MosConfig => {
  let pattern: string | null = null
  let countLarge: number | null = null
  let countSmall: number | null = null
  let integerPattern: number[] | null = null
  let equaveSize = 2
  let sizeOfLargeStep: number | null = null
  let sizeOfSmallStep: number | null = null
  let hardness: { numerator: number; denominator: number } | null = null
  let mode: MosMode | null = null
  let up = 1
  let lift = 5

  for (const expression of [...expressions].sort(
    (a, b) => mosExpressionPrecedence(a) - mosExpressionPrecedence(b),
  )) {
    switch (expression.type) {
      case 'MosAbstractStepPattern':
        pattern = expression.pattern
        break
      case 'MosIntegerPattern':
        integerPattern = expression.pattern
        pattern = expression.pattern
          .map((step) => (step === Math.max(...expression.pattern) ? 'L' : 's'))
          .join('')
        sizeOfSmallStep = Math.min(...expression.pattern)
        sizeOfLargeStep = Math.max(...expression.pattern)
        break
      case 'MosCountLarge':
        countLarge = expression.count
        break
      case 'MosCountSmall':
        countSmall = expression.count
        break
      case 'MosMode':
        mode = { up: expression.up, down: expression.down, period: expression.period }
        break
      case 'MosRationalEquave':
        if (expression.denominator <= 0) throw new Error('MOS equave denominator must be positive.')
        equaveSize = expression.numerator / expression.denominator
        break
      case 'MosHardness':
        if (expression.denominator <= 0)
          throw new Error('MOS hardness denominator must be positive.')
        hardness = { numerator: expression.numerator, denominator: expression.denominator }
        break
      case 'MosUp':
        up = expression.up
        break
      case 'MosLift':
        lift = expression.lift
        break
    }
  }

  if (!pattern && countLarge !== null && countSmall !== null) {
    pattern = mosStepPattern(countLarge, countSmall, mode)
  }
  if (!pattern) throw new Error('MOS declaration requires a pattern.')

  const actualCountLarge = (pattern.match(/L/g) ?? []).length
  const actualCountSmall = pattern.length - actualCountLarge
  const periodCount = gcd(actualCountLarge, actualCountSmall)
  if (mode?.period != null && mode.period !== periodCount) {
    throw new Error(
      `MOS mode period must be ${periodCount} for ${actualCountLarge}L ${actualCountSmall}s.`,
    )
  }
  if (sizeOfLargeStep === null || sizeOfSmallStep === null) {
    if (hardness === null) {
      hardness = integerPattern
        ? { numerator: Math.max(...integerPattern), denominator: Math.min(...integerPattern) }
        : { numerator: 2, denominator: 1 }
    }
    if (sizeOfLargeStep !== null) {
      sizeOfSmallStep = (sizeOfLargeStep * hardness.denominator) / hardness.numerator
    } else if (sizeOfSmallStep !== null) {
      sizeOfLargeStep = (sizeOfSmallStep * hardness.numerator) / hardness.denominator
    } else {
      sizeOfLargeStep = hardness.numerator
      sizeOfSmallStep = hardness.denominator
    }
  }

  const equaveSteps = actualCountLarge * sizeOfLargeStep + actualCountSmall * sizeOfSmallStep
  if (equaveSteps <= 0) throw new Error('MOS equave steps must be positive.')
  const stepSize = valueToCents(equaveSize) / equaveSteps
  const notation = generateNotation(pattern) as { scale: Map<string, MosMonzo>; equave: MosMonzo }
  const nominalSteps = new Map<string, number>()
  const nominalMonzos = new Map<string, MosMonzo>()
  const nominalOrder: string[] = []
  for (const [nominal, mosMonzo] of notation.scale) {
    nominalOrder.push(nominal)
    nominalMonzos.set(nominal, mosMonzo)
    nominalSteps.set(nominal, mosMonzo[0] * sizeOfLargeStep + mosMonzo[1] * sizeOfSmallStep)
  }

  return {
    pattern,
    equaveSize,
    sizeOfLargeStep,
    sizeOfSmallStep,
    stepSize,
    up,
    lift,
    chromaSteps: sizeOfLargeStep - sizeOfSmallStep,
    nominalSteps,
    nominalMonzos,
    nominalOrder,
    expressions,
    equaveSteps,
    equaveMonzo: notation.equave,
    keySignature: new Map(),
  }
}

const applyMosAccidentalsToMonzo = (
  monzo: MosMonzo,
  accidentals: AccidentalType[],
): [number, number] => {
  const result: [number, number] = [monzo[0]!, monzo[1]!]
  for (const accidental of accidentals) {
    switch (accidental) {
      case '&':
        result[0] += 1
        result[1] -= 1
        break
      case '@':
        result[0] -= 1
        result[1] += 1
        break
      case 'e':
        result[0] += 0.5
        result[1] -= 0.5
        break
      case 'a':
        result[0] -= 0.5
        result[1] += 0.5
        break
      case '♮':
      case '_':
        break
      default:
        throw new Error(`Accidental ${accidental} is not a MOS accidental.`)
    }
  }
  return result
}

const mosAccidentalsFromChroma = (chromaCount: number): AccidentalType[] => {
  const accidentals: AccidentalType[] = []
  const accidental = chromaCount > 0 ? '&' : '@'
  let remaining = Math.abs(chromaCount)
  while (remaining >= 1) {
    accidentals.push(accidental)
    remaining -= 1
  }
  if (remaining === 0.5) accidentals.push(chromaCount > 0 ? 'e' : 'a')
  return accidentals
}

export const mosKeySignatureFromPitches = (
  pitches: Array<{ ups: number; lifts: number; nominal: string; accidentals: AccidentalType[] }>,
  config: MosConfig,
): MosKeySignature => {
  const result: MosKeySignature = new Map()

  for (const pitch of pitches) {
    const { key } = normalizeMosNominal(pitch.nominal, config)
    if (!config.nominalMonzos.has(key)) throw new Error(`Undefined MOS nominal '${pitch.nominal}'.`)
    result.set(key, {
      ups: pitch.ups,
      lifts: pitch.lifts,
      accidentals: [...pitch.accidentals],
    })
  }

  return result
}

export const mosKeySignatureAccidentals = (
  tonic: { ups: number; lifts: number; nominal: string; accidentals: AccidentalType[] },
  expressions: MosExpressionType[],
  config: MosConfig,
): MosKeySignature => {
  const { key: tonicKey } = normalizeMosNominal(tonic.nominal, config)
  const tonicIndex = config.nominalOrder.indexOf(tonicKey)
  if (tonicIndex < 0) throw new Error(`Undefined MOS nominal '${tonic.nominal}'.`)

  const keyedMos =
    expressions.length === 0
      ? createMosConfig(config.expressions)
      : createMosConfig([
          ...config.expressions.filter(
            ({ type }) =>
              type !== 'MosAbstractStepPattern' &&
              type !== 'MosIntegerPattern' &&
              type !== 'MosCountLarge' &&
              type !== 'MosCountSmall' &&
              type !== 'MosMode',
          ),
          { type: 'MosCountLarge', count: (config.pattern.match(/L/g) ?? []).length },
          { type: 'MosCountSmall', count: (config.pattern.match(/s/g) ?? []).length },
          expressions.map((expression) => expression.value).find(({ type }) => type === 'MosMode')!,
        ])
  const tonicMonzo = applyMosAccidentalsToMonzo(
    config.nominalMonzos.get(tonicKey)!,
    tonic.accidentals,
  )
  const result: MosKeySignature = new Map()
  for (let index = 0; index < config.nominalOrder.length; index++) {
    const nominal = config.nominalOrder[index]!
    const keyedNominal =
      keyedMos.nominalOrder[
        (index - tonicIndex + config.nominalOrder.length) % config.nominalOrder.length
      ]
    if (!keyedNominal) continue

    const actualMonzo = config.nominalMonzos.get(nominal)!
    const keyedMonzo = keyedMos.nominalMonzos.get(keyedNominal)!
    const desiredMonzo: [number, number] = [
      tonicMonzo[0]! + keyedMonzo[0]!,
      tonicMonzo[1]! + keyedMonzo[1]!,
    ]

    let accidentalCount: number | null = null
    for (let equaves = -2; equaves <= 2; equaves++) {
      const deltaLarge = desiredMonzo[0] - actualMonzo[0]! + equaves * keyedMos.equaveMonzo[0]!
      const deltaSmall = desiredMonzo[1] - actualMonzo[1]! + equaves * keyedMos.equaveMonzo[1]!
      if (deltaLarge === -deltaSmall) {
        accidentalCount = deltaLarge
        break
      }
    }
    if (accidentalCount === null) continue
    const accidentals = accidentalCount === 0 ? [] : mosAccidentalsFromChroma(accidentalCount)
    if (tonic.ups === 0 && tonic.lifts === 0 && accidentals.length === 0) continue
    result.set(nominal, { ups: tonic.ups, lifts: tonic.lifts, accidentals })
  }
  return result
}

export const normalizeMosNominal = (
  nominal: string,
  config: MosConfig,
): { key: string; equaves: number } => {
  const key = nominal.toUpperCase()
  if (!config.nominalSteps.has(key)) {
    throw new Error(`Undefined MOS nominal '${nominal}'.`)
  }
  return {
    key,
    equaves: nominal[0] === key[0] ? 0 : 1,
  }
}
