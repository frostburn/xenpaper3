import { easeGlissando } from './easing'
import type { PitchAutomationPlan } from './playback-plan'
import {
  DEFAULT_SPREAD,
  type ScheduledLaneNote,
  type SourceInitialization,
  type SpreadSettings,
} from './score'
import type { TempoMap } from './timeline'
import { applyPitchAutomation, type AudioParamAutomationTarget } from './web-audio-automation'

export interface SpreadAutomationPlan extends PitchAutomationPlan {
  readonly changes: readonly { readonly when: number; readonly value: number }[]
}

/** Compile the lane's shared cent signal using the same beat sampling as other signals. */
export function compileSpreadAutomation(
  initialization: SourceInitialization,
  tempoMap: TempoMap,
  fromBeat: number,
  compileCurves: (
    note: ScheduledLaneNote,
    tempoMap: TempoMap,
    fromBeat: number,
    toBeat: number,
  ) => PitchAutomationPlan,
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
  for (const ramp of ramps) {
    const progress = (fromBeat - Number(ramp.start)) / Number(ramp.duration)
    if (progress < 0 || progress >= 1) continue
    const from = settings(ramp.from).value
    initialValue = from + (settings(ramp.to).value - from) * easeGlissando(ramp.curve, progress)
  }
  const curves = ramps.flatMap((ramp) => {
    const from = settings(ramp.from).value
    const note: ScheduledLaneNote = {
      beat: 0,
      duration: Number(ramp.start.add(ramp.duration)),
      cents: from,
      velocity: 0,
      envelope: { attack: 0, decay: 0, sustain: 0, release: 0 },
      sourceRanges: [],
      glissando: [
        {
          start: Number(ramp.start),
          duration: Number(ramp.duration),
          from,
          to: settings(ramp.to).value,
          easing: ramp.curve,
        },
      ],
    }
    return compileCurves(note, tempoMap, fromBeat, note.duration).curves
  })
  return Object.freeze({
    initialValue,
    curves: Object.freeze(curves),
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
