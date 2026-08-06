import { describe, expect, it } from 'vitest'
import { parse, type Expression } from '../parser.generated.js'
import { evaluateExpression } from '../runtime/expressions'
import { constructStaffNotation } from '../runtime/staff-notation'
import { constructStaffNotationShape } from '../runtime/staff-notation'
import { evaluateScoreShape } from '../runtime/score-shape'

function notation(source: string) {
  const directive = parse(`@test(${source})`).body[0]
  if (directive.type !== 'Directive') throw new Error('Expected directive.')
  const evaluated = evaluateExpression(directive.arguments[0] as Expression)
  if (!('value' in evaluated)) throw new Error('Expected value.')
  return constructStaffNotation(evaluated.value)
}

describe('staff notation construction', () => {
  it('places just ratios relative to middle C and retains FJS inflections', () => {
    expect(notation('1/1')).toMatchObject({ staffPosition: 0 })
    expect(notation('3/2')).toMatchObject({ staffPosition: 4 })
    expect(notation('5/3')).toMatchObject({ staffPosition: 5, inflections: [{ direction: 'numerator', prime: 5n }] })
  })

  it('converts relative intervals into absolute staff positions', () => {
    expect(notation('M3')).toMatchObject({ staffPosition: 2 })
    expect(notation('Eb')).toMatchObject({ accidentals: ['flat'], staffPosition: 2 })
  })

  it('uses directed triangular noteheads for Greek nominals', () => {
    expect(notation('Gam')).toMatchObject({ staffPosition: 4, notehead: 'triangle-down' })
    expect(notation('Bet')).toMatchObject({ staffPosition: 3, notehead: 'triangle-up' })
    expect(notation('Β')).toMatchObject({ staffPosition: 3, notehead: 'triangle-up' })
    expect(notation("'Gam")).toMatchObject({ staffPosition: 11, notehead: 'triangle-down' })
    expect(notation('Gam#^5c')).toMatchObject({
      accidentals: ['sharp'],
      inflections: [{ direction: 'numerator', prime: 5n, flavor: 'c' }],
    })
  })

  it('retains named interval spelling, FJS flavor, and exact accidentals', () => {
    expect(notation('m2')).toMatchObject({ accidentals: ['flat'], staffPosition: 1 })
    expect(notation('P1^5c')).toMatchObject({ inflections: [{ prime: 5n, flavor: 'c' }] })
    expect(notation('b')).toMatchObject({ staffPosition: 13 })
    expect(notation('b')).toMatchObject({ accidentals: [] })
    expect(notation('Ct')).toMatchObject({ accidentals: ['half-sharp'] })
    expect(notation('Cx')).toMatchObject({ accidentals: ['double-sharp'] })
  })

  it('classifies ups, downs, lifts, and drops as staff inflections', () => {
    expect(notation('^C')).toMatchObject({ inflections: [{ kind: 'up' }] })
    expect(notation('vC')).toMatchObject({ inflections: [{ kind: 'down' }] })
    expect(notation('/M3')).toMatchObject({ inflections: [{ kind: 'lift' }] })
    expect(notation('\\M3')).toMatchObject({ inflections: [{ kind: 'drop' }] })
    expect(notation("'M3")).toMatchObject({ staffPosition: 9 })
  })

  it('falls back to the closest 12-EDO staff pitch', () => {
    expect(notation('610c')).toMatchObject({ staffPosition: 3, accidentals: ['sharp'] })
  })

  it('carries exact durations and rests from score construction', () => {
    const node = parse('1/1 []').body[0] as Expression
    const evaluated = evaluateScoreShape(node, { pulse: 2 })
    if (!('shape' in evaluated)) throw new Error('Expected shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    expect(staff).toMatchObject({
      kind: 'sequence',
      children: [
        { kind: 'note', duration: { n: 2 } },
        { kind: 'rest', duration: { n: 2 }, generated: false },
      ],
    })
  })

  it('retains source nominal spelling while constructing a score staff', () => {
    const node = parse('Eb Gam').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    expect(constructStaffNotationShape(evaluated.shape)).toMatchObject({
      kind: 'sequence',
      children: [
        { kind: 'note', pitch: { staffPosition: 2, accidentals: ['flat'], notehead: 'normal' } },
        { kind: 'note', pitch: { staffPosition: 4, accidentals: [], notehead: 'triangle-down' } },
      ],
    })
  })

  it('places a unison ratio on the active staff root', () => {
    const node = parse('{D = root} 1/1').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    expect(staff).toMatchObject({ kind: 'sequence', children: [{ kind: 'note', pitch: { staffPosition: 1 } }] })
  })

  it('restores the active root when engraving a spelled nominal', () => {
    const node = parse('{A = root} A').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    expect(constructStaffNotationShape(evaluated.shape)).toMatchObject({
      kind: 'sequence',
      children: [{ kind: 'note', pitch: { staffPosition: 5, accidentals: [], notehead: 'normal' } }],
    })
  })
})
