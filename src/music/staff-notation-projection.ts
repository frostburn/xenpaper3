import { Fraction } from 'xen-dev-utils/fraction'
import {
  constructStaffNotation,
  type MonomialGrid,
  type StaffNotationShape,
} from '../../xenpaper-lang'
import { Value } from '../../xenpaper-lang/core'
import { monomialToCents } from './pitch-projection'
import type { GridPitch } from '../../xenpaper-lang/core'
import type { AbsolutePitchValue, EvaluatedLiteral, PitchOffsetValue } from '../../xenpaper-lang'

const asEvaluatedPitch = (pitch: GridPitch): EvaluatedLiteral => {
  const value = Value.cents(monomialToCents(pitch.sounding))
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
    ...(pitch.notation ? { notationValue: Value.cents(monomialToCents(pitch.notation)) } : {}),
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

/** Project an exact score grid into renderer-ready staff notation. */
export function projectGridToStaffNotation(grid: MonomialGrid): StaffNotationShape {
  const branches = grid.events.map((event): StaffNotationShape => {
    const item: StaffNotationShape =
      event.kind === 'note'
        ? {
            kind: 'note',
            duration: event.duration,
            pitch: constructStaffNotation(
              asEvaluatedPitch(event.pitch),
              event.rootPitch
                ? { rootPitch: asEvaluatedPitch(event.rootPitch) as AbsolutePitchValue }
                : {},
            ),
            ...(event.label ? { displayLabel: event.label } : {}),
            ...(event.pitch.justIntonation ? { justIntonation: true } : {}),
          }
        : {
            kind: 'annotation',
            text: event.label,
            duration: new Fraction(0),
          }
    if (!event.start.n) return item
    return {
      kind: 'sequence',
      duration: event.start.add(item.duration),
      children: [rest(event.start), item],
    }
  })

  if (!branches.length) return rest(grid.span)
  return { kind: 'parallel', duration: grid.span, branches }
}
