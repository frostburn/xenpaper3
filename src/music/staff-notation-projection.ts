import { Fraction } from 'xen-dev-utils/fraction'
import {
  constructStaffNotation,
  type AbsolutePitchValue,
  type BarlineStyle,
  type DynamicMark,
  type EvaluatedLiteral,
  type MonomialGrid,
  type PitchOffsetValue,
  type StaffNotationShape,
} from '../../xenpaper-lang'
import { Value, type GridPitch } from '../../xenpaper-lang/core'
import { monomialToCents } from './pitch-projection'

const projectedValue = (pitch: GridPitch['sounding']) =>
  Value.real(monomialToCents(pitch), { pitch: 1 })

const asEvaluatedPitch = (pitch: GridPitch): EvaluatedLiteral => {
  // Engraving geometry is deliberately a downstream real-valued projection. In
  // particular, do not round-trip an arbitrary temperament through exact cents.
  const value = projectedValue(pitch.sounding)
  if (pitch.kind === 'absolute' && pitch.spelling) {
    return {
      kind: 'absolutePitch',
      rootOffset: value,
      formula: pitch.formula ?? pitch.sounding,
      spelling: pitch.spelling,
      origins: [],
    } as AbsolutePitchValue
  }
  return {
    kind: 'pitchOffset',
    value,
    ...(pitch.notation ? { notationValue: projectedValue(pitch.notation) } : {}),
    ...(pitch.formula ? { formula: pitch.formula } : {}),
    ...(pitch.spelling ? { spelling: pitch.spelling } : {}),
    ...(pitch.scaleDegree === undefined ? {} : { scaleDegree: pitch.scaleDegree }),
    ...(pitch.justIntonation ? { justIntonation: true } : {}),
    origins: [],
  } as PitchOffsetValue
}

const rest = (duration: Fraction): StaffNotationShape => ({
  kind: 'rest',
  duration,
  generated: true,
})

const projectPitchToStaff = (pitch: GridPitch, rootPitch?: GridPitch) =>
  constructStaffNotation(
    asEvaluatedPitch(pitch),
    rootPitch ? { rootPitch: asEvaluatedPitch(rootPitch) as AbsolutePitchValue } : {},
  )

const projectEvent = (event: MonomialGrid['events'][number]): StaffNotationShape => {
  if (event.kind === 'note') {
    return {
      kind: 'note',
      duration: event.duration,
      ...(event.notatedDuration ? { notatedDuration: event.notatedDuration } : {}),
      pitch: projectPitchToStaff(event.pitch, event.rootPitch),
      ...(event.label ? { displayLabel: event.label } : {}),
      ...(event.pitch.justIntonation ? { justIntonation: true } : {}),
      ...(event.automation
        ? {
            glissandi: (
              event.automation.segments ?? [
                {
                  ...event.automation,
                  start: new Fraction(0),
                },
              ]
            ).map((segment) => ({
              start: segment.start,
              duration: segment.duration,
              from: projectPitchToStaff(segment.from, segment.fromRootPitch ?? event.rootPitch),
              to: projectPitchToStaff(segment.to, segment.toRootPitch ?? event.rootPitch),
            })),
          }
        : {}),
    }
  }
  if (event.marker === 'barline') {
    return {
      kind: 'barline',
      style: event.label as BarlineStyle,
      duration: new Fraction(0),
    }
  }
  if (event.marker === 'dynamic') {
    return {
      kind: 'dynamic',
      mark: event.label as DynamicMark,
      duration: new Fraction(0),
    }
  }
  return { kind: 'annotation', text: event.label, duration: new Fraction(0) }
}

/** Project an exact score grid into renderer-ready staff notation. */
export function projectGridToStaffNotation(grid: MonomialGrid): StaffNotationShape {
  const groups = new Map<string, MonomialGrid['events']>()
  for (const event of grid.events) {
    const key = `${event.start.s * event.start.n}/${event.start.d}`
    groups.set(key, [...(groups.get(key) ?? []), event])
  }

  const children: StaffNotationShape[] = []
  let cursor = new Fraction(0)
  for (const events of groups.values()) {
    const start = events[0]!.start
    if (start.compare(cursor) > 0) children.push(rest(start.sub(cursor)))
    const items = events.map(projectEvent)
    const duration = items.reduce(
      (longest, item) => (item.duration.compare(longest) > 0 ? item.duration : longest),
      new Fraction(0),
    )
    children.push(items.length === 1 ? items[0]! : { kind: 'parallel', duration, branches: items })
    const end = start.add(duration)
    if (end.compare(cursor) > 0) cursor = end
  }
  if (grid.span.compare(cursor) > 0) children.push(rest(grid.span.sub(cursor)))
  if (!children.length) return rest(grid.span)
  return { kind: 'sequence', duration: grid.span, children }
}
