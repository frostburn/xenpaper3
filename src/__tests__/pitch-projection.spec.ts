import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { Monomial } from '../../xenpaper-lang/core'
import { createFrequencyProjection, monomialToCents } from '../music/pitch-projection'

describe('Pitch projections', () => {
  it('keeps cents outside the exact monomial type', () => {
    expect(monomialToCents(Monomial.fromRatio(new Fraction(3, 2)))).toBeCloseTo(701.955000865)
  })

  it('attaches a frequency calibration explicitly', () => {
    const project = createFrequencyProjection(Monomial.ZERO, 440)

    expect(project.project(Monomial.fromRatio(new Fraction(3, 2)))).toBeCloseTo(660)
  })

  it('rejects invalid physical calibration', () => {
    expect(() => createFrequencyProjection(Monomial.ZERO, 0)).toThrow('finite and positive')
  })
})
