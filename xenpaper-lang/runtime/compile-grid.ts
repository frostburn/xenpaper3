import type { LocationRange } from 'peggy'
import { Fraction } from 'xen-dev-utils/fraction'
import type { Program } from '../parser.generated.js'
import { parse } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import {
  ScoreGrid,
  type GridEvent,
  type GridPitch,
  type GridPitchAutomation,
  type GridPitchAutomationSegment,
  type MonomialGrid,
} from '../grid'
import { Monomial } from '../monomial'
import type { Value } from '../value'
import { expandToBeatEvents, type BeatEventExpansionOptions } from './beat-events'
import type {
  AbsolutePitchValue,
  PitchAutomation,
  PitchAutomationSegment,
  PitchOffsetValue,
  SourceOrigin,
} from './types'

const copyFraction = (value: Fraction): Fraction => new Fraction(value.s * value.n, value.d)

export type GridCompileOptions = BeatEventExpansionOptions

export type GridCompilationResult =
  | { readonly grid: MonomialGrid; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] }

const pitchMonomial = (value: Value): Monomial | undefined => {
  if (!value.dimensions.equals({ pitch: 1 })) return undefined
  const exponents = value.primeExponents()
  return exponents ? new Monomial(exponents) : undefined
}

const locationsOf = (origins: readonly SourceOrigin[]): readonly LocationRange[] =>
  origins.map(({ location }) => location)

const inexactPitchDiagnostic = (origins: readonly SourceOrigin[]): Diagnostic => ({
  code: 'XP_INEXACT_GRID_PITCH',
  severity: 'error',
  message:
    'Exact-grid compilation requires a monomial sounding pitch. ' +
    'Keep real-valued tuning, calibration, and device conversion in a downstream projection.',
  locations: locationsOf(origins),
})

const convertPitch = (
  pitch: PitchOffsetValue | AbsolutePitchValue,
  diagnostics: Diagnostic[],
  origins: readonly SourceOrigin[],
): GridPitch | undefined => {
  // Played absolute pitches carry their sounding coordinate in `value`, while
  // root-pitch metadata only has the notation/root coordinate.
  const value =
    pitch.kind === 'absolutePitch'
      ? 'value' in pitch
        ? (pitch as AbsolutePitchValue & { readonly value: Value }).value
        : pitch.rootOffset
      : pitch.value
  const sounding = pitchMonomial(value)
  if (!sounding) {
    diagnostics.push(inexactPitchDiagnostic(origins))
    return undefined
  }

  if (pitch.kind === 'absolutePitch') {
    return Object.freeze({
      kind: 'absolute' as const,
      sounding,
      formula: new Monomial(pitch.formula),
      spelling: pitch.spelling,
    })
  }

  const notation = pitch.notationValue ? pitchMonomial(pitch.notationValue) : undefined
  return Object.freeze({
    kind: 'offset' as const,
    sounding,
    ...(notation ? { notation } : {}),
    ...(pitch.formula ? { formula: new Monomial(pitch.formula) } : {}),
    ...(pitch.spelling ? { spelling: pitch.spelling } : {}),
    ...(pitch.scaleDegree === undefined ? {} : { scaleDegree: pitch.scaleDegree }),
    ...(pitch.justIntonation ? { justIntonation: true } : {}),
  })
}

const convertRootPitch = (
  pitch: AbsolutePitchValue | undefined,
  diagnostics: Diagnostic[],
  origins: readonly SourceOrigin[],
): GridPitch | undefined => (pitch ? convertPitch(pitch, diagnostics, origins) : undefined)

const convertAutomationBase = (
  automation: PitchAutomation | PitchAutomationSegment,
  diagnostics: Diagnostic[],
  origins: readonly SourceOrigin[],
): Omit<GridPitchAutomation, 'segments'> | undefined => {
  const from = convertPitch(automation.from, diagnostics, origins)
  const to = convertPitch(automation.to, diagnostics, origins)
  if (!from || !to) return undefined
  const fromRootPitch = convertRootPitch(automation.fromRootPitch, diagnostics, origins)
  const toRootPitch = convertRootPitch(automation.toRootPitch, diagnostics, origins)
  return Object.freeze({
    curve: automation.curve,
    from,
    to,
    ...(fromRootPitch ? { fromRootPitch } : {}),
    ...(toRootPitch ? { toRootPitch } : {}),
    duration: copyFraction(automation.duration),
  })
}

const convertAutomationSegment = (
  segment: PitchAutomationSegment,
  diagnostics: Diagnostic[],
  origins: readonly SourceOrigin[],
): GridPitchAutomationSegment | undefined => {
  const automation = convertAutomationBase(segment, diagnostics, origins)
  return automation && Object.freeze({ ...automation, start: copyFraction(segment.start) })
}

const convertAutomation = (
  automation: PitchAutomation | undefined,
  diagnostics: Diagnostic[],
  origins: readonly SourceOrigin[],
): GridPitchAutomation | undefined => {
  if (!automation) return undefined
  const converted = convertAutomationBase(automation, diagnostics, origins)
  if (!converted) return undefined
  const segments = automation.segments?.flatMap((segment) => {
    const converted = convertAutomationSegment(segment, diagnostics, origins)
    return converted ? [converted] : []
  })

  return Object.freeze({
    ...converted,
    ...(segments ? { segments: Object.freeze(segments) } : {}),
  })
}

/** Compile an already parsed program into the exact monomial/beat grid. */
export function compileProgram(
  program: Program,
  options: GridCompileOptions = {},
): GridCompilationResult {
  const expanded = expandToBeatEvents(program, options)
  if (!('score' in expanded)) return { diagnostics: expanded.diagnostics }

  const diagnostics = [...expanded.diagnostics]
  const events = expanded.score.events.flatMap((event): GridEvent[] => {
    if (event.kind === 'marker') return [{ ...event }]
    const pitch = convertPitch(event.pitch, diagnostics, event.origins)
    const rootPitch = convertRootPitch(event.rootPitch, diagnostics, event.origins)
    const automation = convertAutomation(event.automation, diagnostics, event.origins)
    return pitch
      ? [
          {
            kind: 'note',
            start: copyFraction(event.start),
            duration: copyFraction(event.duration),
            pitch,
            ...(rootPitch ? { rootPitch } : {}),
            dynamic: copyFraction(event.dynamic),
            extensions: Object.freeze({ ...event.directiveState }),
            ...(automation ? { automation } : {}),
            ...(event.label === undefined ? {} : { label: event.label }),
            origins: event.origins,
          },
        ]
      : []
  })

  if (diagnostics.some(({ severity }) => severity === 'error')) return { diagnostics }
  return {
    grid: new ScoreGrid(copyFraction(expanded.score.duration), events),
    diagnostics,
  }
}

const syntaxDiagnostic = (error: unknown): Diagnostic => {
  const candidate = error as { readonly message?: unknown; readonly location?: LocationRange }
  return {
    code: 'XP_SYNTAX',
    severity: 'error',
    message: candidate.message === undefined ? String(error) : String(candidate.message),
    locations: candidate.location ? [candidate.location] : [],
  }
}

/** Parse and compile source directly into Xenpaper's exact core representation. */
export function compile(source: string, options: GridCompileOptions = {}): GridCompilationResult {
  let program: Program
  try {
    program = parse(source)
  } catch (error) {
    return { diagnostics: [syntaxDiagnostic(error)] }
  }
  return compileProgram(program, options)
}
