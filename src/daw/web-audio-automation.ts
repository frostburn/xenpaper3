import type { PitchAutomationPlan } from './playback-plan'

/** Xenpaper's C reference is 900 cents below the A4 base frequency used by SW Patch. */
export const XENPAPER_C_TO_SW_PATCH_DETUNE = -900

export const xenpaperPitchToPatchDetune = (cents: number): number =>
  cents + XENPAPER_C_TO_SW_PATCH_DETUNE

/** Shorten a curve enough that a command at its nominal end cannot overlap it. */
export const glissandoCurveDuration = (duration: number): number =>
  duration - Math.min(1e-6, duration / 2)

export interface AudioParamAutomationTarget {
  setValueAtTime(value: number, startTime: number): unknown
  setValueCurveAtTime(values: Float32Array, startTime: number, duration: number): unknown
}

/**
 * Translate one C-relative pitch plan into SW Patch detune automation.
 *
 * This is deliberately the only place that knows both pitch-reference conversion and
 * Chromium's inclusive `setValueCurveAtTime` endpoint behaviour.
 */
export const applyPitchAutomation = (
  target: AudioParamAutomationTarget,
  automation: PitchAutomationPlan,
  startTime: number,
): void => {
  target.setValueAtTime(xenpaperPitchToPatchDetune(automation.initialValue), startTime)
  for (const curve of automation.curves) {
    const when = startTime + curve.offset
    target.setValueAtTime(xenpaperPitchToPatchDetune(curve.startValue), when)
    target.setValueCurveAtTime(
      Float32Array.from(curve.values, xenpaperPitchToPatchDetune),
      when,
      glissandoCurveDuration(curve.duration),
    )
  }
}
