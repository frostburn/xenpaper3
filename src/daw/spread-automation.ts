import { DEFAULT_SPREAD, type SourceInitialization, type SpreadSettings } from './score'
import type { TempoMap } from './timeline'

export interface SpreadAutomationPlan {
  readonly initialValue: number
  readonly changes: readonly {
    readonly when: number
    readonly value: number
    readonly duration: number
  }[]
}

/** Resolve interrupted ramps and resume partway through a lane's continuous cent signal. */
export function compileSpreadAutomation(
  initialization: SourceInitialization,
  tempoMap: TempoMap,
  fromBeat: number,
): SpreadAutomationPlan {
  const events = [
    {
      when: 0,
      settings:
        (initialization.context?.directiveState.spread as SpreadSettings | undefined) ??
        DEFAULT_SPREAD,
    },
    ...(initialization.changes ?? []).map(({ start, context }) => ({
      when: tempoMap.beatToSeconds(Number(start)),
      settings: (context.directiveState.spread as SpreadSettings | undefined) ?? DEFAULT_SPREAD,
    })),
  ]
  let previous: SpreadSettings | undefined
  let ramp = { when: 0, from: DEFAULT_SPREAD.value, value: DEFAULT_SPREAD.value, duration: 0 }
  const valueAt = (time: number) =>
    ramp.duration === 0
      ? ramp.value
      : ramp.from +
        (ramp.value - ramp.from) * Math.min(1, Math.max(0, (time - ramp.when) / ramp.duration))
  const startTime = tempoMap.beatToSeconds(fromBeat)
  const changes: Array<{ when: number; value: number; duration: number }> = []
  for (const { when, settings } of events) {
    if (settings === previous) continue
    previous = settings
    if (when > startTime) {
      changes.push({ when, ...settings })
      continue
    }
    ramp = { when, from: valueAt(when), ...settings }
  }
  const initialValue = valueAt(startTime)
  const remaining = ramp.when + ramp.duration - startTime
  if (remaining > 0) changes.unshift({ when: startTime, value: ramp.value, duration: remaining })
  return Object.freeze({ initialValue, changes: Object.freeze(changes) })
}

/** Schedule linear spread ramps, holding the interpolated value when a ramp is interrupted. */
export function applySpreadAutomation(
  target: Pick<AudioParam, 'setValueAtTime' | 'linearRampToValueAtTime' | 'cancelScheduledValues'>,
  automation: SpreadAutomationPlan,
  contextStart: number,
  projectStart: number,
): void {
  target.setValueAtTime(automation.initialValue, contextStart)
  let ramp = {
    start: contextStart,
    end: contextStart,
    from: automation.initialValue,
    to: automation.initialValue,
  }
  for (const change of automation.changes) {
    const when = contextStart + change.when - projectStart
    const held =
      when < ramp.end
        ? ramp.from + ((ramp.to - ramp.from) * (when - ramp.start)) / (ramp.end - ramp.start)
        : ramp.to
    if (when < ramp.end) {
      target.cancelScheduledValues(ramp.end)
      target.linearRampToValueAtTime(held, when)
    }
    if (change.duration > 0) {
      target.setValueAtTime(held, when)
      target.linearRampToValueAtTime(change.value, when + change.duration)
    } else {
      target.setValueAtTime(change.value, when)
    }
    ramp = { start: when, end: when + change.duration, from: held, to: change.value }
  }
}
