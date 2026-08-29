import { sum } from 'xen-dev-utils/core'
import { centsToValue, valueToCents } from 'xen-dev-utils/conversion'
import { AperiodicWave } from 'aperiodic-oscillator'

import TIMBRES from './timbres.json'

const BASIC_OSCILLATOR_TYPES = ['sawtooth', 'square', 'sine', 'triangle'] as const

const PARTIALS_RANGE = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32,
] as const

const JSON_HARMONIC_TIMBRES = Object.keys(TIMBRES.harmonics) as Array<
  keyof typeof TIMBRES.harmonics
>

const GENERATED_PERIODIC_TIMBRES = [
  'semisine',
  'rich',
  'slender',
  'didacus',
  'bohlen',
  'glass',
  'boethius',
  'gold',
  'parabolic',
  'rich-classic',
  'slender-classic',
  'didacus-classic',
  'bohlen-classic',
  'glass-classic',
  'boethius-classic',
] as const

const LEGACY_CUSTOM_TIMBRES = ['amsine', 'amtriangle', 'fmsine', 'fmtriangle'] as const

const CUSTOM_TIMBRES = [
  ...JSON_HARMONIC_TIMBRES,
  ...GENERATED_PERIODIC_TIMBRES,
  ...LEGACY_CUSTOM_TIMBRES,
] as const

const GENERATED_APERIODIC_TIMBRES = [
  'tin',
  'bronze',
  'steel',
  'silver',
  'platinum',
  'gender',
  '12-tet',
  'harmonium',
] as const

export type BasicOscillatorType = (typeof BASIC_OSCILLATOR_TYPES)[number]

export type PartialsRange = (typeof PARTIALS_RANGE)[number]

export type BasicOscillatorWithPartials = `${BasicOscillatorType}${PartialsRange}`

export type JsonHarmonicTimbre = (typeof JSON_HARMONIC_TIMBRES)[number]

export type GeneratedPeriodicTimbre = (typeof GENERATED_PERIODIC_TIMBRES)[number]

export type LegacyCustomTimbre = (typeof LEGACY_CUSTOM_TIMBRES)[number]

export type CustomTimbre = (typeof CUSTOM_TIMBRES)[number]

export type JsonTimbre = keyof typeof TIMBRES.timbres

export type PlainSpectrumTimbre = keyof typeof TIMBRES.plainSpectra

export type GeneratedAperiodicTimbre = (typeof GENERATED_APERIODIC_TIMBRES)[number]

export type AperiodicTimbre = JsonTimbre | PlainSpectrumTimbre | GeneratedAperiodicTimbre

const APERIODIC_TIMBRES = [
  ...Object.keys(TIMBRES.timbres),
  ...Object.keys(TIMBRES.plainSpectra),
  ...GENERATED_APERIODIC_TIMBRES,
] as AperiodicTimbre[]

export type FatOscillatorType =
  `fat${BasicOscillatorType | BasicOscillatorWithPartials | CustomTimbre}`

export type SWOscillatorType =
  | BasicOscillatorType
  | BasicOscillatorWithPartials
  | CustomTimbre
  | AperiodicTimbre
  | FatOscillatorType

export type Periodicity = 'harmonic' | 'unison' | 'aperiodic'

export type SynthType =
  | {
      type: BasicOscillatorType
      periodicity: 'harmonic' | 'unison'
      periodicWave: null
      aperiodicWave: null
    }
  | {
      type: 'custom'
      periodicity: 'harmonic' | 'unison'
      periodicWave: PeriodicWave
      aperiodicWave: null
    }
  | {
      type: 'custom'
      periodicity: 'aperiodic'
      periodicWave: null
      aperiodicWave: AperiodicWave
    }
type Spectrum = number[]
type Timbre = { spectrum: Spectrum; amplitudes: number[]; source?: string }
type Timbres = {
  plainSpectra: Record<string, Spectrum>
  harmonics: Record<string, Spectrum>
  timbres: Record<string, Timbre>
}

const TIMBRE_DATA = TIMBRES as Timbres

const PERIODIC_WAVE_CACHE = new Map<BasicOscillatorWithPartials | CustomTimbre, PeriodicWave>()
const APERIODIC_WAVE_CACHE = new Map<AperiodicTimbre, AperiodicWave>()

const isBasicOscillatorType = (value: unknown): value is BasicOscillatorType =>
  typeof value === 'string' && BASIC_OSCILLATOR_TYPES.includes(value as BasicOscillatorType)

const isCustomTimbre = (value: unknown): value is CustomTimbre =>
  typeof value === 'string' && CUSTOM_TIMBRES.includes(value as (typeof CUSTOM_TIMBRES)[number])

const isAperiodicTimbre = (value: unknown): value is AperiodicTimbre =>
  typeof value === 'string' && APERIODIC_TIMBRES.includes(value as AperiodicTimbre)

// XXX: The check is valid only for SWOscillatorType
const isFatOscillatorType = (value: unknown): value is FatOscillatorType =>
  typeof value === 'string' && value.startsWith('fat')

const getPartialsCount = (value: string): number | null => {
  const digits = value.match(/\d+$/)?.[0]
  if (digits === undefined) return null

  const baseType = value.slice(0, value.length - digits.length)
  if (!isBasicOscillatorType(baseType)) return null

  const count = parseInt(digits, 10)
  return PARTIALS_RANGE.includes(count as PartialsRange) ? count : null
}

const isHarmonicSWOscillatorType = (value: unknown) =>
  isBasicOscillatorType(value) ||
  isCustomTimbre(value) ||
  (typeof value === 'string' && getPartialsCount(value) !== null)

export function isSWOscillatorType(value: unknown): value is SWOscillatorType {
  if (isFatOscillatorType(value)) return isHarmonicSWOscillatorType(value.slice(3))

  return isHarmonicSWOscillatorType(value) || isAperiodicTimbre(value)
}

function ceilPow2(x: number) {
  return 1 << (32 - Math.clz32(x - 1))
}

const createWave = (context: BaseAudioContext, real: number[], imag: number[]) =>
  context.createPeriodicWave(new Float32Array(real), new Float32Array(imag))

const createLegacyCustomPeriodicWave = (
  name: LegacyCustomTimbre,
  context: BaseAudioContext,
): PeriodicWave => {
  const real: number[] = []
  const imag: number[] = []
  if (name === 'amsine') {
    real.push(2 / Math.PI)
    imag.push(0)

    real.push(0)
    imag.push(1)
    for (let n = 2; n < 128; ++n) {
      real.push(n & 1 ? 0 : -4 / (Math.PI * (n * n - 1)))
      imag.push(0)
    }
  } else if (name === 'amtriangle') {
    real.push(0.25)
    imag.push(0)
    for (let n = 1; n < 128; ++n) {
      switch (n % 4) {
        case 0:
          real.push(0)
          imag.push(0)
          break
        case 1:
          real.push(0)
          imag.push(-2 / (Math.PI * Math.PI * n * n))
          break
        case 2:
          real.push(-4 / (Math.PI * Math.PI * n * n))
          imag.push(0)
          break
        case 3:
          real.push(0)
          imag.push(2 / (Math.PI * Math.PI * n * n))
          break
      }
    }
  } else if (name === 'fmsine') {
    real.push(0)
    imag.push(0)

    real.push(-0.5)
    imag.push(0)

    real.push(0)
    imag.push(-32 / (Math.PI * 15))

    real.push(-0.5)
    imag.push(0)

    for (let n = 4; n < 128; ++n) {
      real.push(0)
      imag.push(n & 1 ? 0 : (16 * n) / (Math.PI * (n * n - 1) * (n * n - 9)))
    }
  } else {
    real.push(0)
    imag.push(0)
    for (let n = 1; n < 128; ++n) {
      switch (n % 6) {
        case 1:
        case 5:
          real.push(1 / (n * n))
          imag.push(0)
          break
        case 2:
          real.push(0)
          imag.push((3 * Math.sqrt(3)) / (n * n))
          break
        case 3:
          real.push(10 / (n * n))
          imag.push(0)
          break
        case 4:
          real.push(0)
          imag.push((-3 * Math.sqrt(3)) / (n * n))
          break
      }
    }
  }
  return createWave(context, real, imag)
}

const createSubgroupComponents = () => {
  const components = {
    rich: new Float32Array(101),
    richClassic: new Float32Array(101),
    slender: new Float32Array(101),
    slenderClassic: new Float32Array(101),
    didacus: new Float32Array(101),
    didacusClassic: new Float32Array(101),
    bohlen: new Float32Array(101),
    bohlenClassic: new Float32Array(101),
    glass: new Float32Array(101),
    glassClassic: new Float32Array(101),
    boethius: new Float32Array(101),
    boethiusClassic: new Float32Array(101),
  }

  const lowPrimeHarmonics = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 18, 19, 20, 21, 22, 24, 25, 27, 28, 30, 32,
    33, 35, 36, 38, 40, 42, 44, 45, 48, 49, 50, 54, 55, 56, 57, 60, 63, 64, 66, 70, 72, 75, 76, 77,
    80, 81, 84, 88, 90, 95, 96, 98, 99, 100,
  ]

  lowPrimeHarmonics.forEach((n) => {
    const m = 1 / n
    const p = n ** -1.5
    if (n % 11 && n % 19) {
      if (n % 7) {
        components.richClassic[n] = m
        components.rich[n] = p
      }
      if (n % 5) {
        components.slenderClassic[n] = m
        components.slender[n] = p
      }
      if (n % 3) {
        components.didacusClassic[n] = m
        components.didacus[n] = p
      }
      if (n % 2) {
        components.bohlenClassic[n] = m
        components.bohlen[n] = p
      }
    }
    if (n % 3 && n % 5 && n % 19) {
      if (n % 7 && n % 11) {
        components.glassClassic[n] = m
        components.glass[n] = p
      } else {
        components.glassClassic[n] = 2 * m
        components.glass[n] = 2 * p
      }
    }
    if (n % 5 && n % 7 && n % 11) {
      if (n % 19) {
        components.boethiusClassic[n] = m
        components.boethius[n] = p
      } else {
        components.boethiusClassic[n] = 2 * m
        components.boethius[n] = 2 * p
      }
    }
  })

  return components
}

const SUBGROUP_COMPONENTS = createSubgroupComponents()

const createGeneratedPeriodicWave = (
  name: GeneratedPeriodicTimbre,
  context: BaseAudioContext,
): PeriodicWave => {
  if (name === 'semisine') {
    const real = Array.from({ length: 64 }, () => 0)
    const imag = Array.from({ length: 64 }, () => 0)
    for (let n = 1; n < 64; ++n) real[n] = 1 / (1 - 4 * n * n)
    return createWave(context, real, imag)
  }

  if (name === 'parabolic') {
    const real = Array.from({ length: 64 }, () => 0)
    const imag = Array.from({ length: 64 }, () => 0)
    for (let n = 1; n < 64; ++n) real[n] = 1 / (n * n)
    return createWave(context, real, imag)
  }

  if (name === 'gold') {
    const real = Array.from({ length: 101 }, () => 0)
    const imag = Array.from({ length: 101 }, () => 0)
    for (let n = 1; n <= 10; ++n) imag[n * n] = n ** -0.75
    return createWave(context, real, imag)
  }

  const real = Array.from({ length: 101 }, () => 0)
  const componentName = name.replace('-classic', 'Classic') as keyof typeof SUBGROUP_COMPONENTS
  return createWave(context, real, Array.from(SUBGROUP_COMPONENTS[componentName]))
}

const createCustomPeriodicWave = (name: CustomTimbre, context: BaseAudioContext): PeriodicWave => {
  if (JSON_HARMONIC_TIMBRES.includes(name as JsonHarmonicTimbre)) {
    const real = TIMBRE_DATA.harmonics[name]!
    return createWave(
      context,
      real,
      Array.from({ length: real.length }, () => 0),
    )
  }
  if (GENERATED_PERIODIC_TIMBRES.includes(name as GeneratedPeriodicTimbre)) {
    return createGeneratedPeriodicWave(name as GeneratedPeriodicTimbre, context)
  }
  return createLegacyCustomPeriodicWave(name as LegacyCustomTimbre, context)
}

const createPartialsPeriodicWave = (
  name: BasicOscillatorWithPartials,
  context: BaseAudioContext,
): PeriodicWave => {
  const count = getPartialsCount(name)
  if (count === null) throw new Error(`Invalid oscillator type '${name}'`)

  const oscillatorType = name.replace(/\d+$/, '') as BasicOscillatorType
  const harmonics = [0]
  for (let n = 1; n <= count; ++n) {
    if (oscillatorType === 'sawtooth') {
      harmonics.push(1 / n)
    } else if (oscillatorType === 'square') {
      harmonics.push((n & 1) / n)
    } else if (oscillatorType === 'sine') {
      harmonics.push(n === 1 ? 1 : 0)
    } else if (oscillatorType === 'triangle') {
      harmonics.push((n & 1) / (n * n))
    }
  }
  return createWave(
    context,
    harmonics.map(() => 0),
    harmonics,
  )
}

const createMetallicWave = (
  context: BaseAudioContext,
  exponent: number,
  maxPartials = 128,
): AperiodicWave => {
  const ns = Array.from({ length: maxPartials }, (_, i) => i + 1)
  return new AperiodicWave(
    context,
    ns.map((n) => n ** exponent),
    ns.map((n) => 0.3 * n ** -1.5),
    7,
    0.1,
  )
}

const createGeneratedAperiodicWave = (
  name: GeneratedAperiodicTimbre,
  context: BaseAudioContext,
): AperiodicWave => {
  if (name === 'tin') return createMetallicWave(context, 8 / 9)
  if (name === 'bronze') return createMetallicWave(context, 4 / 3)
  if (name === 'steel') return createMetallicWave(context, 1.5)
  if (name === 'silver') return createMetallicWave(context, 5 / 3)
  if (name === 'platinum') return createMetallicWave(context, 2.5, 32)

  if (name === 'gender') {
    const baseSpectrum = [1, 2.26, 3.358, 3.973, 7.365, 13, 29, 31, 37]
    const baseAmplitudes = [1, 0.6, 0.3, 0.4, 0.2, 0.05, 0.04, 0.01, 0.006].map((a) => 0.4 * a)
    const spectrum: number[] = []
    const amplitudes: number[] = []
    for (let i = 0; i < baseSpectrum.length; ++i) {
      spectrum.push(baseSpectrum[i]! * 1.004)
      spectrum.push(baseSpectrum[i]! / 1.004)
      amplitudes.push(baseAmplitudes[i]!)
      amplitudes.push(0.6 * baseAmplitudes[i]!)
    }
    return new AperiodicWave(context, spectrum, amplitudes, 7, 0.1)
  }

  if (name === '12-tet') {
    const spectrumCents: number[] = []
    const amplitudes: number[] = []
    for (let h = 1; h <= 128; ++h) {
      const cents = valueToCents(h)
      const closest = Math.round(cents / 100) * 100
      if (Math.abs(cents - closest) < 15) {
        spectrumCents.push((3 * closest + cents) / 4)
        amplitudes.push(h === ceilPow2(h) ? 0.3 * h ** -2 : 0.6 * h ** -1.5)
      }
    }
    return new AperiodicWave(context, spectrumCents.map(centsToValue), amplitudes, 7, 0.1)
  }

  const harmonics = 60
  const dutyCycle = 0.43
  const targetFundamentalHz = 330
  const shimmerOffsets = [0, 0.18, -0.18, 0.55, -0.55, 1.1, -1.1]
  const shimmerWeights = [1, 0.3, 0.3, 0.7, 0.7, 0.4, 0.4]
  const spectrum: number[] = []
  const amplitudes: number[] = []

  for (let n = 1; n <= harmonics; ++n) {
    const pwm = Math.abs((2 / (n * Math.PI)) * Math.sin(n * Math.PI * dutyCycle))
    const lowpass = Math.exp(-Math.max(0, n - 3) / 28)
    const brightnessTrim = 1 / (1 + 0.009 * n ** 1.32)
    const oddBias = n % 2 ? 1.15 : 0.9
    const fundamentalBoost = n === 1 ? 3.4 : n === 2 ? 1.8 : n === 3 ? 1.4 : 1
    const baseAmplitude = pwm * lowpass * brightnessTrim * oddBias * fundamentalBoost

    shimmerOffsets.forEach((offsetHz, i) => {
      const ratio = n * (1 + offsetHz / (targetFundamentalHz * n))
      spectrum.push(ratio)
      amplitudes.push(baseAmplitude * shimmerWeights[i]!)
    })

    if (n <= 8) {
      shimmerOffsets.forEach((offsetHz, i) => {
        const ratio = 2 * n * (1 + offsetHz / (targetFundamentalHz * 2 * n))
        spectrum.push(ratio)
        amplitudes.push(baseAmplitude * 0.18 * shimmerWeights[i]!)
      })
    }
  }

  const normalization = 1.4 / sum(amplitudes)
  return new AperiodicWave(
    context,
    spectrum,
    amplitudes.map((amplitude) => amplitude * normalization),
    7,
    0.1,
  )
}

const createAperiodicWave = (name: AperiodicTimbre, context: BaseAudioContext): AperiodicWave => {
  if (name in TIMBRE_DATA.timbres) {
    const { spectrum, amplitudes } = TIMBRE_DATA.timbres[name]!
    return new AperiodicWave(context, spectrum, amplitudes, 7, 0.1)
  }

  if (name in TIMBRE_DATA.plainSpectra) {
    const spectrum = TIMBRE_DATA.plainSpectra[name]!
    const preamps = spectrum.map((_, i) => (i + 1) ** -1.5)
    const amplitudeCorrection = 0.730783 / sum(preamps)
    return new AperiodicWave(
      context,
      spectrum,
      preamps.map((amplitude) => amplitude * amplitudeCorrection),
      7,
      0.1,
    )
  }

  return createGeneratedAperiodicWave(name as GeneratedAperiodicTimbre, context)
}

export function parseSWOscillatorType(
  name: SWOscillatorType,
  context: BaseAudioContext,
): SynthType {
  let periodicity: Periodicity = 'harmonic'
  if (isFatOscillatorType(name)) {
    periodicity = 'unison'
    name = name.slice(3) as BasicOscillatorType | BasicOscillatorWithPartials | CustomTimbre
  }
  if (isBasicOscillatorType(name)) {
    return {
      type: name,
      periodicity,
      periodicWave: null,
      aperiodicWave: null,
    }
  }

  if (isAperiodicTimbre(name)) {
    if (periodicity === 'unison') throw new Error(`Invalid oscillator type 'fat${name}'`)
    if (!APERIODIC_WAVE_CACHE.has(name)) {
      APERIODIC_WAVE_CACHE.set(name, createAperiodicWave(name, context))
    }
    return {
      type: 'custom',
      periodicity: 'aperiodic',
      periodicWave: null,
      aperiodicWave: APERIODIC_WAVE_CACHE.get(name)!,
    }
  }

  if (isCustomTimbre(name)) {
    if (!PERIODIC_WAVE_CACHE.has(name)) {
      PERIODIC_WAVE_CACHE.set(name, createCustomPeriodicWave(name, context))
    }
    return {
      type: 'custom',
      periodicity,
      periodicWave: PERIODIC_WAVE_CACHE.get(name)!,
      aperiodicWave: null,
    }
  }

  const count = typeof name === 'string' ? getPartialsCount(name) : null
  if (count !== null) {
    const entry = name as BasicOscillatorWithPartials
    if (!PERIODIC_WAVE_CACHE.has(entry)) {
      PERIODIC_WAVE_CACHE.set(entry, createPartialsPeriodicWave(entry, context))
    }
    return {
      type: 'custom',
      periodicity,
      periodicWave: PERIODIC_WAVE_CACHE.get(entry)!,
      aperiodicWave: null,
    }
  }

  throw new Error(`Invalid oscillator type '${name}'`)
}
