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
  })

  it('falls back to the closest 12-EDO staff pitch', () => {
    expect(notation('610c')).toMatchObject({ nominal: 'F', accidental: 'sharp', octave: 4 })
  })
})
