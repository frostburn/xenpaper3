import { valueToCents } from 'xen-dev-utils/conversion'
import { Monomial } from '../../xenpaper-lang/core'

/** A downstream interpretation of an exact Xenpaper pitch coordinate. */
export interface PitchProjection<Result> {
  readonly project: (pitch: Monomial) => Result
}

/** Conventional cents are a display/audio projection, not a Xenpaper core coordinate. */
export const monomialToCents = (pitch: Monomial): number => pitch.project(valueToCents)

export const centsProjection: PitchProjection<number> = Object.freeze({
  project: monomialToCents,
})

/** Attach a real-world frequency calibration to one exact grid coordinate. */
export function createFrequencyProjection(
  referencePitch: Monomial,
  referenceFrequency: number,
): PitchProjection<number> {
  if (!Number.isFinite(referenceFrequency) || referenceFrequency <= 0)
    throw new RangeError('Reference frequency must be finite and positive.')
  return Object.freeze({
    project: (pitch: Monomial) => referenceFrequency * pitch.sub(referencePitch).ratioValue(),
  })
}
