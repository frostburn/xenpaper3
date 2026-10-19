import { clamp } from 'xen-dev-utils/core'
import { easeGlissando } from './easing'
import type { TempoMap } from './timeline'

const SAMPLES_PER_SECOND = 120

export interface SignalRamp {
  /** Absolute project beat at the start of this ramp. */
  readonly start: number
  readonly duration: number
  readonly from: number
  readonly to: number
  readonly easing: string
}

export interface SignalCurvePlan {
  /** Seconds after playback starts for this signal. */
  readonly offset: number
  /** Nominal duration; the Web Audio adapter may shorten the endpoint slightly. */
  readonly duration: number
  readonly startValue: number
  readonly values: readonly number[]
}

export interface SignalAutomationPlan {
  readonly initialValue: number
  readonly curves: readonly SignalCurvePlan[]
}

export const signalRampValue = (ramp: SignalRamp, beat: number): number =>
  ramp.from +
  (ramp.to - ramp.from) *
    easeGlissando(ramp.easing, clamp(0, 1, (beat - ramp.start) / ramp.duration))

/** Sample beat-defined ramps uniformly in audio time, clipping to the audible window. */
export function compileSignalCurves(
  ramps: readonly SignalRamp[],
  tempoMap: TempoMap,
  playbackStartBeat: number,
  playbackEndBeat = Infinity,
): readonly SignalCurvePlan[] {
  const curves: SignalCurvePlan[] = []
  const playbackStartSeconds = tempoMap.beatToSeconds(playbackStartBeat)
  for (const ramp of ramps) {
    if (ramp.duration <= 0) continue
    const start = Math.max(ramp.start, playbackStartBeat)
    const end = Math.min(ramp.start + ramp.duration, playbackEndBeat)
    if (end <= start) continue
    const startSeconds = tempoMap.beatToSeconds(start)
    const duration = tempoMap.beatToSeconds(end) - startSeconds
    if (duration <= 0) continue
    const sampleCount = Math.max(2, Math.ceil(duration * SAMPLES_PER_SECOND))
    const values = Object.freeze(
      Array.from({ length: sampleCount }, (_, index) => {
        // Keep endpoints at their exact authored beats rather than round-tripping
        // them through seconds, especially at adjacent ramps or tempo changes.
        const beat =
          index === 0
            ? start
            : index === sampleCount - 1
              ? end
              : tempoMap.secondsToBeat(startSeconds + (duration * index) / (sampleCount - 1))
        return signalRampValue(ramp, beat)
      }),
    )
    curves.push(
      Object.freeze({
        offset: startSeconds - playbackStartSeconds,
        duration,
        startValue: values[0]!,
        values,
      }),
    )
  }
  return Object.freeze(curves)
}
