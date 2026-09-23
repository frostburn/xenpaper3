import { Fraction, type FractionValue } from 'xen-dev-utils/fraction'
import type { Program } from '../parser.generated.js'
import { evaluateInitialization } from './initialization'
import type { ScoreShapeOptions } from './types'

export interface GridTempoChange {
  readonly beat: Fraction
  readonly bpm: Fraction
}

export interface GridTimeSignatureChange {
  readonly beat: Fraction
  readonly numerator: number
  readonly denominator: number
}

/** Resolve global directives on the nominal grid; tempo never changes these positions. */
export function evaluateTimeline(program: Program, options: ScoreShapeOptions = {}) {
  const result = evaluateInitialization(program, {
    ...options,
    allowDuration: true,
    allowTempoDirective: true,
  })
  const tempoChanges: GridTempoChange[] = []
  const timeSignatureChanges: GridTimeSignatureChange[] = []
  const { initialization } = result
  if (initialization) {
    const contexts = [
      ...(initialization.context
        ? [{ start: new Fraction(0), context: initialization.context }]
        : []),
      ...(initialization.changes ?? []),
    ]
    let previousTempo = initialization.timelineShape ? initialization.context?.tempo : undefined
    let previousSignature = initialization.timelineShape
      ? initialization.context?.timeSignature
      : undefined
    for (const { start, context } of contexts) {
      if (context.tempo && context.tempo !== previousTempo)
        tempoChanges.push({ beat: start, bpm: context.tempo })
      if (context.timeSignature && context.timeSignature !== previousSignature)
        timeSignatureChanges.push({ beat: start, ...context.timeSignature })
      previousTempo = context.tempo
      previousSignature = context.timeSignature
    }
  }
  return { ...result, tempoChanges, timeSignatureChanges }
}

/** Enumerate measure boundaries with exact arithmetic, including meter transitions. */
export function gridMeasureBoundaries(
  changes: readonly GridTimeSignatureChange[],
  endBeat: FractionValue,
): Fraction[] {
  const result = new Map<string, Fraction>()
  const limit = new Fraction(endBeat)
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]!
    const next = changes[index + 1]?.beat
    const end = next && next.compare(limit) < 0 ? next : limit
    const length = new Fraction(change.numerator * 4, change.denominator)
    if (length.compare(0) <= 0) continue
    for (let beat = change.beat; beat.compare(end) <= 0; beat = beat.add(length))
      result.set(beat.toFraction(), beat)
  }
  return [...result.values()].sort((left, right) => left.compare(right))
}
