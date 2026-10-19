import {
  compileSignalCurves,
  signalRampValue,
  type SignalAutomationPlan,
} from './signal-automation'
import { DEFAULT_SPREAD, type SourceInitialization, type SpreadSettings } from './score'
import type { TempoMap } from './timeline'
import { applyPitchAutomation, type AudioParamAutomationTarget } from './web-audio-automation'

export interface SpreadAutomationPlan extends SignalAutomationPlan {
  readonly changes: readonly { readonly when: number; readonly value: number }[]
}

/** Compile the lane's shared cent signal using the same beat sampling as other signals. */
export function compileSpreadAutomation(
  initialization: SourceInitialization,
  tempoMap: TempoMap,
  fromBeat: number,
): SpreadAutomationPlan {
  const settings = (state: unknown) => (state as SpreadSettings | undefined) ?? DEFAULT_SPREAD
  const events = [
    { beat: 0, value: settings(initialization.context?.directiveState.spread).value },
    ...(initialization.changes ?? []).map(({ start, context }) => ({
      beat: Number(start),
      value: settings(context.directiveState.spread).value,
    })),
  ]
  const ramps = (initialization.directiveRamps ?? [])
    .filter(({ stateKey }) => stateKey === 'spread')
    .sort((a, b) => a.start.compare(b.start))
  let end = -Infinity
  for (const ramp of ramps) {
    if (Number(ramp.start) < end)
      throw new Error('Overlapping @ramp segments for @spread are not supported.')
    end = Number(ramp.start.add(ramp.duration))
  }
  const preceding = events.filter(({ beat }) => beat <= fromBeat)
  let initialValue = preceding[preceding.length - 1]!.value
  const segments = ramps.map((ramp) => ({
    start: Number(ramp.start),
    duration: Number(ramp.duration),
    from: settings(ramp.from).value,
    to: settings(ramp.to).value,
    easing: ramp.curve,
  }))
  for (const segment of segments)
    if (fromBeat >= segment.start && fromBeat < segment.start + segment.duration)
      initialValue = signalRampValue(segment, fromBeat)
  return Object.freeze({
    initialValue,
    curves: compileSignalCurves(segments, tempoMap, fromBeat),
    changes: Object.freeze(
      events
        .filter(({ beat }) => beat > fromBeat)
        .map(({ beat, value }) => Object.freeze({ when: tempoMap.beatToSeconds(beat), value })),
    ),
  })
}

/** Apply cent curves without the note pitch reference offset or steps inside curves. */
export function applySpreadAutomation(
  target: AudioParamAutomationTarget,
  automation: SpreadAutomationPlan,
  contextStart: number,
  projectStart: number,
): void {
  let previous = automation.initialValue
  for (const { when, value } of automation.changes) {
    const offset = when - projectStart
    const inCurve = automation.curves.some(
      (curve) => offset >= curve.offset && offset < curve.offset + curve.duration,
    )
    if (!inCurve && value !== previous) target.setValueAtTime(value, contextStart + offset)
    previous = value
  }
  applyPitchAutomation(target, automation, contextStart, 0)
}
