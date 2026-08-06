import { describe, expect, it } from 'vitest'
import { parse, type Expression } from '../parser.generated.js'
import { evaluateExpression } from '../runtime/expressions'
import { constructStaffNotation } from '../runtime/staff-notation'

function notation(source: string) {
  const directive = parse(`@test(${source})`).body[0]
  if (directive.type !== 'Directive') throw new Error('Expected directive.')
  const evaluated = evaluateExpression(directive.arguments[0] as Expression)
  if (!('value' in evaluated)) throw new Error('Expected value.')
  return constructStaffNotation(evaluated.value)
}

describe('staff notation construction', () => {
  it('places just ratios relative to middle C and retains FJS inflections', () => {
    expect(notation('1/1')).toMatchObject({ nominal: 'C', octave: 4, staffPosition: 0 })
    expect(notation('3/2')).toMatchObject({ nominal: 'G', octave: 4, staffPosition: 4 })
    expect(notation('5/3')).toMatchObject({ nominal: 'A', octave: 4, inflections: [{ direction: 'numerator', prime: 5n }] })
  })

  it('converts relative intervals into absolute staff positions', () => {
    expect(notation('M3')).toMatchObject({ nominal: 'E', octave: 4, staffPosition: 2 })
    expect(notation('Eb')).toMatchObject({ nominal: 'E', accidental: 'flat', staffPosition: 2 })
  })

  it('uses directed triangular noteheads for Greek nominals', () => {
    expect(notation('Gam')).toMatchObject({ nominal: 'G', octave: 4, staffPosition: 4, notehead: 'triangle-down' })
    expect(notation("'Gam")).toMatchObject({ nominal: 'G', octave: 5, staffPosition: 11, notehead: 'triangle-down' })
    expect(notation('Gam#^5c')).toMatchObject({
      accidental: 'sharp',
      accidentals: ['#'],
      inflections: [{ direction: 'numerator', prime: 5n, flavor: 'c' }],
    })
  })

  it('retains named interval spelling, FJS flavor, and exact accidentals', () => {
    expect(notation('m2')).toMatchObject({ nominal: 'D', accidental: 'flat', staffPosition: 1 })
    expect(notation('P1^5c')).toMatchObject({ inflections: [{ prime: 5n, flavor: 'c' }] })
    expect(notation('b')).toMatchObject({ nominal: 'B', octave: 5 })
    expect(notation('b')).not.toHaveProperty('accidental')
    expect(notation('Ct')).toMatchObject({ nominal: 'C', accidental: 'half-sharp', accidentals: ['t'] })
    expect(notation('Cx')).toMatchObject({ nominal: 'C', accidental: 'double-sharp', accidentals: ['x'] })
  })

  it('falls back to the closest 12-EDO staff pitch', () => {
    expect(notation('610c')).toMatchObject({ nominal: 'F', accidental: 'sharp', octave: 4 })
  })
})
