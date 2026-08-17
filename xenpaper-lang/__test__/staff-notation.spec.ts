import { describe, expect, it } from 'vitest'
import { parse, type Expression } from '../parser.generated.js'
import { evaluateExpression } from '../runtime/expressions'
import { constructStaffNotation } from '../runtime/staff-notation'
import { constructStaffNotationShape } from '../runtime/staff-notation'
import { evaluateProgramShape, evaluateScoreShape } from '../runtime/score-shape'

function notation(source: string) {
  const directive = parse(`@test(${source})`).body[0]
  if (directive.type !== 'Directive') throw new Error('Expected directive.')
  const evaluated = evaluateExpression(directive.arguments[0] as Expression)
  if (!('value' in evaluated)) throw new Error('Expected value.')
  return constructStaffNotation(evaluated.value)
}

describe('staff notation construction', () => {
  it('emits key-signature events and suppresses repeated note accidentals', () => {
    const evaluated = evaluateScoreShape(parse('{key = G} F F_').body[0] as Expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'sequence') throw new Error('Expected a staff sequence.')
    expect(staff.children[0]).toMatchObject({
      kind: 'key-signature',
      pitches: [{ staffPosition: 3, accidentals: ['sharp'] }],
    })
    expect(staff.children.filter((child) => child.kind === 'note')).toMatchObject([
      { pitch: { accidentals: [] } },
      { pitch: { accidentals: ['natural'] } },
    ])
  })

  it('projects MOS declarations to explicit clef events', () => {
    const evaluated = evaluateScoreShape(parse('MOS{3L4s} J').body[0] as Expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'sequence') throw new Error('Expected a staff sequence.')
    expect(staff.children[0]).toMatchObject({
      kind: 'clef',
      clef: { kind: 'diamond-mos', pattern: 'LsLsLss' },
    })

    const diatonic = evaluateScoreShape(parse('MOS{5L2s} J').body[0] as Expression)
    if (!('shape' in diatonic)) throw new Error('Expected a score shape.')
    const diatonicStaff = constructStaffNotationShape(diatonic.shape)
    if (diatonicStaff.kind !== 'sequence') throw new Error('Expected a staff sequence.')
    expect(diatonicStaff.children[0]).toMatchObject({ kind: 'clef', clef: { kind: 'treble' } })
  })

  it('restores a treble clef when a preset leaves Diamond-MOS context', () => {
    const evaluated = evaluateScoreShape(parse('MOS{3L4s} J {12edo} C').body[0] as Expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'sequence') throw new Error('Expected a staff sequence.')
    expect(
      staff.children.filter((child) => child.kind === 'clef').map((child) => child.clef),
    ).toEqual([{ kind: 'diamond-mos', pattern: 'LsLsLss' }, { kind: 'treble' }])
  })

  it('engraves alterations produced by Diamond-MOS transposition', () => {
    const evaluated = evaluateScoreShape(
      parse('MOS{5L2s} J + A1ms J& + M1ms').body[0] as Expression,
    )
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'sequence') throw new Error('Expected a staff sequence.')
    expect(
      staff.children
        .filter((child) => child.kind === 'note')
        .map((child) => [child.pitch.staffPosition, child.pitch.accidentals]),
    ).toEqual([
      [1, ['&']],
      [1, ['&']],
    ])
  })

  it('projects @clef directives to conventional clef events', () => {
    const evaluated = evaluateScoreShape(
      parse('@clef(bass) C D E @clef(treble) F G').body[0] as Expression,
    )
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'sequence') throw new Error('Expected a staff sequence.')
    expect(staff.children.map((child) => child.kind)).toEqual([
      'clef',
      'note',
      'note',
      'note',
      'clef',
      'note',
      'note',
    ])
    expect(
      staff.children.filter((child) => child.kind === 'clef').map((child) => child.clef),
    ).toEqual([{ kind: 'bass' }, { kind: 'treble' }])
  })

  it('identifies pure ratios only when an active prime mapping distinguishes them', () => {
    const collect = (source: string) => {
      const evaluated = evaluateScoreShape(parse(source).body[0] as Expression)
      if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
      const staff = constructStaffNotationShape(evaluated.shape)
      if (staff.kind !== 'sequence') throw new Error('Expected a staff sequence.')
      return staff.children.filter((item) => item.kind === 'note')
    }

    expect(collect('C D E ~9/8 9/8 5/4 pitch(9/8)').map((note) => note.justIntonation)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(
      collect('{12edo}C D E ~9/8 9/8 5/4 pitch(9/8)').map((note) => note.justIntonation),
    ).toEqual([undefined, undefined, undefined, undefined, true, true, true])
  })

  it('retains shorthand articulation marks until a named articulation resets them', () => {
    const node = parse("@. C D @' E @staccato F @. G @- A").body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'sequence') throw new Error('Expected a staff sequence.')
    const notes = staff.children.filter((item) => item.kind === 'note')
    expect(notes.map((note) => note.articulationMarks)).toEqual([
      ['.'],
      ['.'],
      ['.', "'"],
      undefined,
      ['.'],
      undefined,
    ])
  })

  it('carries shorthand articulation from a repeat body into alternate endings', () => {
    const node = parse('|: @. C |@^1 D :|@^2 E ||').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const staff = constructStaffNotationShape(evaluated.shape)
    const collect = (shape: typeof staff): readonly (readonly string[] | undefined)[] => {
      if (shape.kind === 'note') return [shape.articulationMarks]
      if (shape.kind === 'sequence') return shape.children.flatMap(collect)
      if (shape.kind === 'parallel') return shape.branches.flatMap(collect)
      return []
    }
    expect(collect(staff)).toEqual([['.'], ['.'], ['.']])
  })

  it('only infers FJS accidentals from rational frequency ratios', () => {
    const node = parse('300Hz').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated) || evaluated.shape.kind !== 'attack')
      throw new Error('Expected an attack.')

    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'note') throw new Error('Expected a staff note.')
    expect(staff.pitch.inflections).toBeUndefined()

    const rationalNode = parse('{root = 100Hz} 500Hz').body[0] as Expression
    const rational = evaluateScoreShape(rationalNode)
    if (!('shape' in rational)) throw new Error('Expected a score shape.')
    const rationalStaff = constructStaffNotationShape(rational.shape)
    if (rationalStaff.kind !== 'sequence' || rationalStaff.children[1]?.kind !== 'note')
      throw new Error('Expected a frequency note after the root assignment.')
    expect(rationalStaff.children[1].pitch.inflections).toEqual([
      { direction: 'numerator', prime: 5n },
    ])
  })

  it('places just ratios relative to middle C and retains FJS inflections', () => {
    expect(notation('1/1')).toMatchObject({ staffPosition: 0 })
    expect(notation('256/243')).toMatchObject({ staffPosition: 1, accidentals: ['flat'] })
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
    expect(notation('d2')).toMatchObject({ staffPosition: 1, accidentals: ['double-flat'] })
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

  it('engraves the spelled result of pitch and interval arithmetic', () => {
    expect(notation('G - n3')).toMatchObject({ staffPosition: 2, accidentals: ['half-flat'] })
    expect(notation('G-n3')).toMatchObject({ staffPosition: 2, accidentals: ['half-flat'] })
    expect(notation('C - D')).toMatchObject({ staffPosition: -1, accidentals: ['flat'] })
    expect(notation('Eb - C')).toMatchObject({ staffPosition: 2, accidentals: ['flat'] })
    expect(notation('A + M3')).toMatchObject({ staffPosition: 7, accidentals: ['sharp'] })
    expect(notation("C - 'D")).toMatchObject({ staffPosition: -8, accidentals: ['flat'] })
    expect(notation('C - `D')).toMatchObject({ staffPosition: 6, accidentals: ['flat'] })
  })

  it('derives transposition accidentals independently of a reassociated root', () => {
    const node = parse('{A = root} A + M3').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    expect(constructStaffNotationShape(evaluated.shape)).toMatchObject({
      kind: 'sequence',
      children: [
        { kind: 'annotation', text: 'A = root' },
        { kind: 'note', pitch: { staffPosition: 7, accidentals: ['sharp'] } },
      ],
    })
  })

  it('derives named interval accidentals from the root and 3-limit formula', () => {
    const node = parse('{A = root} -M3 -m3').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    expect(constructStaffNotationShape(evaluated.shape)).toMatchObject({
      kind: 'sequence',
      children: [
        { kind: 'annotation', text: 'A = root' },
        { kind: 'note', pitch: { staffPosition: 3, accidentals: [] } },
        { kind: 'note', pitch: { staffPosition: 3, accidentals: ['sharp'] } },
      ],
    })
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

  it('retains scale context across hard boundaries and parallel degrees', () => {
    const evaluated = evaluateProgramShape(parse('{5 7 12}\n0 1 2 3 4 5 6 ||\n0,1,2,3,4,5,6 ||'))
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    const staff = constructStaffNotationShape(evaluated.shape)
    if (staff.kind !== 'sequence') throw new Error('Expected a sequence.')
    const parallel = staff.children.find((child) => child.kind === 'parallel')
    if (!parallel) throw new Error('Expected a parallel chord.')
    expect(parallel.branches.map((branch) => branch.kind === 'note' && branch.pitch.cents)).toEqual(
      [0, 500, 700, 1200, 1700, 1900, 2400],
    )
    expect(
      parallel.branches.map((branch) => branch.kind === 'note' && branch.pitch.staffPosition),
    ).toEqual([0, 3, 4, 7, 10, 11, 14])
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

  it.each([
    ['D#', 'D♯', 1, 'sharp'],
    ['Cb', 'C♭', 0, 'flat'],
    ['Cx', 'C𝄪', 0, 'double-sharp'],
  ])(
    'retains the accidental of a reassociated %s staff root',
    (root, annotation, staffPosition, accidental) => {
      const node = parse(`1/1 {${root} = root} 1/1`).body[0] as Expression
      const evaluated = evaluateScoreShape(node)
      if (!('shape' in evaluated)) throw new Error('Expected shape.')

      expect(constructStaffNotationShape(evaluated.shape)).toMatchObject({
        kind: 'sequence',
        children: [
          { kind: 'note', pitch: { staffPosition: 0, accidentals: [] } },
          { kind: 'annotation', text: `${annotation} = root` },
          { kind: 'note', pitch: { staffPosition, accidentals: [accidental] } },
        ],
      })
    },
  )

  it('uses the complete absolute pitch as the reassociated staff root', () => {
    const node = parse('{C^5 = root} 1/1').body[0] as Expression
    const evaluated = evaluateScoreShape(node)
    if (!('shape' in evaluated)) throw new Error('Expected shape.')

    expect(constructStaffNotationShape(evaluated.shape)).toMatchObject({
      kind: 'sequence',
      children: [
        { kind: 'annotation', text: 'C^5 = root' },
        {
          kind: 'note',
          pitch: {
            staffPosition: 0,
            accidentals: [],
            inflections: [{ direction: 'numerator', prime: 5n }],
          },
        },
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
