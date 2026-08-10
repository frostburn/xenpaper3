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
    expect(notation('5/3')).toMatchObject({
      staffPosition: 5,
      inflections: [{ direction: 'numerator', prime: 5n }],
    })
    expect(notation('6/5')).toMatchObject({
      staffPosition: 2,
      accidentals: ['flat'],
      inflections: [{ direction: 'denominator', prime: 5n }],
    })
    expect(notation('250047/262144')).toMatchObject({
      staffPosition: 0,
      accidentals: [],
      inflections: [
        { direction: 'numerator', prime: 49n },
        { direction: 'numerator', prime: 7n },
      ],
    })
  })

  it('constructs notation for positive irrational scalar ratios', () => {
    expect(notation('sqrt(2)')).toMatchObject({ cents: 600, notehead: 'normal' })
  })

  it('converts relative intervals into absolute staff positions', () => {
    expect(notation('M3')).toMatchObject({ staffPosition: 2 })
    expect(notation('n3')).toMatchObject({ staffPosition: 2, accidentals: ['half-flat'] })
    expect(notation('-n3')).toMatchObject({ staffPosition: -2, accidentals: ['half-flat'] })
    expect(notation('SA4')).toMatchObject({ staffPosition: 3, accidentals: ['half-sharp'] })
    expect(notation('sd5')).toMatchObject({ staffPosition: 4, accidentals: ['half-flat'] })
    expect(notation('19 * n3 - 5 * P8')).toMatchObject({
      staffPosition: 3,
      accidentals: ['sharp', 'half-sharp'],
    })
    expect(notation('F#t')).toMatchObject({
      staffPosition: 3,
      accidentals: ['sharp', 'half-sharp'],
    })
    expect(notation('AAA1')).toMatchObject({
      staffPosition: 0,
      accidentals: ['double-sharp', 'sharp'],
    })
    expect(notation('AAAA1')).toMatchObject({
      staffPosition: 0,
      accidentals: ['double-sharp', 'double-sharp'],
    })
    expect(notation('ddd1')).toMatchObject({
      staffPosition: 0,
      accidentals: ['double-flat', 'flat'],
    })
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

  it('labels degrees and raw cent values below the staff', () => {
    const node = parse(String.raw`3 123c 4\17 5\13<3> C`).body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'sequence') throw new Error('Expected a sequence.')

    expect(staff.children).toMatchObject([
      { kind: 'note', displayLabel: '3' },
      { kind: 'note', displayLabel: '123c' },
      { kind: 'note', displayLabel: String.raw`4\17` },
      { kind: 'note', displayLabel: String.raw`5\13<3>` },
      { kind: 'note' },
    ])
    expect(staff.children[4]).not.toHaveProperty('displayLabel')
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

  it('carries zero-duration barlines from score construction', () => {
    const node = parse('C | D').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    expect(evaluated.diagnostics).toEqual([])
    expect(constructStaffNotationShape(evaluated.shape)).toMatchObject({
      kind: 'sequence',
      duration: { n: 2, d: 1 },
      children: [
        { kind: 'note' },
        { kind: 'barline', style: 'single', duration: { n: 0, d: 1 } },
        { kind: 'note' },
      ],
    })
  })

  it('carries double barlines and repeat markers', () => {
    const nodes = parse('C || |: D E :|').body as Expression[]
    const staff = nodes.map((node) => {
      const evaluated = evaluateScoreShape(node)
      if (!('shape' in evaluated)) throw new Error('Expected shape.')
      expect(evaluated.diagnostics).toEqual([])
      return constructStaffNotationShape(evaluated.shape)
    })
    expect(staff).toMatchObject([
      { kind: 'note' },
      { kind: 'barline', style: 'double' },
      {
        kind: 'sequence',
        children: [
          { kind: 'barline', style: 'repeat-start' },
          { kind: 'sequence', children: [{ kind: 'note' }, { kind: 'note' }] },
          { kind: 'barline', style: 'repeat-end' },
        ],
      },
    ])
  })

  it('keeps root-frequency changes out of repeated staff appearances', () => {
    const node = parse('C |: 1/1 D E {root = D} :| 1/1 C').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    const staff = constructStaffNotationShape(evaluated.shape)
    const notes: StaffNotationShape[] = []
    const annotations: string[] = []
    const collect = (shape: StaffNotationShape) => {
      if (shape.kind === 'note') notes.push(shape)
      else if (shape.kind === 'annotation') annotations.push(shape.text)
      else if (shape.kind === 'sequence') shape.children.forEach(collect)
      else if (shape.kind === 'parallel') shape.branches.forEach(collect)
    }
    collect(staff)

    expect(evaluated.diagnostics).toEqual([])
    expect(annotations).toEqual(['root = D'])
    expect(
      notes.map((note) => note.kind === 'note' && [note.pitch.staffPosition, note.pitch.notehead]),
    ).toEqual([
      [0, 'normal'],
      [0, 'normal'],
      [1, 'normal'],
      [2, 'normal'],
      [0, 'normal'],
      [0, 'normal'],
    ])
    expect(notes[1]).not.toHaveProperty('displayLabel')
  })

  it('spells ratios relative to a high-prime root-frequency shift', () => {
    const node = parse('{root = Ev5} 1/1').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    const staff = constructStaffNotationShape(evaluated.shape)
    expect(staff).toMatchObject({
      kind: 'sequence',
      children: [
        { kind: 'annotation', text: 'root = Ev5' },
        {
          kind: 'note',
          pitch: { staffPosition: 0, accidentals: [], notehead: 'normal' },
        },
      ],
    })
    if (staff.kind !== 'sequence' || staff.children[1]?.kind !== 'note')
      throw new Error('Expected a note after the root-frequency annotation.')
    expect(staff.children[1].pitch).not.toHaveProperty('inflections')
  })

  it('engraves a root-frequency shift relative to the moved root', () => {
    const node = parse('C D 1/1 {root = D} C D 1/1').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'sequence') throw new Error('Expected a sequence.')
    const notes = staff.children.filter((child) => child.kind === 'note')
    expect(notes.map((note) => [note.pitch.staffPosition, note.pitch.accidentals])).toEqual([
      [0, []],
      [1, []],
      [0, []],
      [0, []],
      [1, []],
      [0, []],
    ])
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

  it('retains Latin spelling and staff position when an EDO preset maps its sound', () => {
    const node = parse("{13edo} E B c 'C").body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'sequence') throw new Error('Expected a sequence.')
    const notes = staff.children.filter((child) => child.kind === 'note')
    expect(notes.map((note) => [note.pitch.staffPosition, note.pitch.accidentals])).toEqual([
      [2, []],
      [6, []],
      [7, []],
      [7, []],
    ])
    expect(notes.map((note) => note.pitch.cents)).toEqual([
      553.8461538461539, 1292.3076923076922, 1200, 1200,
    ])
  })

  it('places a unison ratio on the active staff root', () => {
    const node = parse('{D = root} 1/1').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    expect(staff).toMatchObject({
      kind: 'sequence',
      children: [
        { kind: 'annotation', text: 'D = root' },
        { kind: 'note', pitch: { staffPosition: 1 } },
      ],
    })
  })

  it('restores the active root when engraving a spelled nominal', () => {
    const node = parse('{A = root} A').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    expect(constructStaffNotationShape(evaluated.shape)).toMatchObject({
      kind: 'sequence',
      children: [
        { kind: 'annotation', text: 'A = root' },
        { kind: 'note', pitch: { staffPosition: 5, accidentals: [], notehead: 'normal' } },
      ],
    })
  })
})
