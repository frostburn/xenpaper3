import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { parse } from '../parser'
import { expandToBeatEvents } from '../runtime/beat-events'
import { evaluateInitialization } from '../runtime/initialization'
import { evaluateProgramShape } from '../runtime/score-shape'
import { constructStaffNotationShape } from '../runtime/staff-notation'
import type { StaffNotationShape } from '../runtime/types'

function score(source: string, options: Parameters<typeof expandToBeatEvents>[1] = {}) {
  const result = expandToBeatEvents(parse(source), options)
  expect(result.diagnostics).toEqual([])
  if (!('score' in result)) throw new Error('Expected a beat-timed score.')
  return result.score
}

function timing(source: string) {
  const result = score(source)
  return {
    duration: result.duration.toFraction(),
    notes: result.events
      .filter((event) => event.kind === 'note')
      .map((note) => [note.start.toFraction(), note.duration.toFraction()]),
  }
}

describe('binary ties', () => {
  it.each(['C->C', 'C -> C', '0->0', '3/2->3/2', '1\\12->1\\12'])(
    'parses compact and spaced operands: %s',
    (source) => {
      expect(parse(source).body[0]).toMatchObject({ type: 'BinaryExpression', operator: '->' })
      expect(timing(source)).toEqual({ duration: '2', notes: [['0', '2']] })
    },
  )

  it('binds below arithmetic and postfixes, above sequencing and parallelism', () => {
    expect(parse('C + M3 -> E= F, G').body[0]).toMatchObject({
      type: 'Parallel',
      branches: [
        {
          type: 'Sequence',
          items: [
            {
              operator: '->',
              left: { operator: '+' },
              right: { type: 'PostfixExpression', marks: [{ type: 'DetachedContinue' }] },
            },
            { type: 'PitchLiteral', nominal: { value: 'F' } },
          ],
        },
        { type: 'PitchLiteral', nominal: { value: 'G' } },
      ],
    })
    expect(parse('C -> C -> C').body[0]).toMatchObject({
      operator: '->',
      left: { operator: '->' },
      right: { type: 'PitchLiteral' },
    })
    expect(() => parse('C ->')).toThrow(/Expected/)
    expect(parse('~3/2').body[0]).toMatchObject({ operator: '~' })
  })

  it('ties matching chord tones while retaining unmatched notes', () => {
    expect(timing('(C, E, G) -> (C, F, A)')).toEqual({
      duration: '2',
      notes: [
        ['0', '2'],
        ['0', '1'],
        ['0', '1'],
        ['1', '1'],
        ['1', '1'],
      ],
    })
  })

  it('matches earlier notes in both tuplets without moving unmatched attacks', () => {
    expect(timing('[C D E] -> [C F E]')).toEqual({
      duration: '2',
      notes: [
        ['0', '4/3'],
        ['1/3', '1/3'],
        ['2/3', '4/3'],
        ['4/3', '1/3'],
      ],
    })
  })

  it('can reach a matching note past intervening right-hand notes', () => {
    expect(timing('[C D E] -> (F E)')).toEqual({
      duration: '3',
      notes: [
        ['0', '1/3'],
        ['1/3', '1/3'],
        ['2/3', '7/3'],
        ['1', '1'],
      ],
    })
  })

  it('uses the latest matching endpoint and deletes every matched right attack', () => {
    expect(timing('C -> (D C C)')).toEqual({
      duration: '4',
      notes: [
        ['0', '4'],
        ['1', '1'],
      ],
    })
  })

  it('replaces each matching left endpoint independently', () => {
    expect(timing('(C C) -> C')).toEqual({
      duration: '3',
      notes: [
        ['0', '3'],
        ['1', '2'],
      ],
    })
  })

  it.each([
    ['C -> C -> C', '3', [['0', '3']]],
    ['C= -> C=', '4', [['0', '4']]],
    [
      '[C D E]= -> E',
      '3',
      [
        ['0', '2/3'],
        ['2/3', '2/3'],
        ['4/3', '5/3'],
      ],
    ],
    [
      'C -> [C D E]=',
      '3',
      [
        ['0', '5/3'],
        ['5/3', '2/3'],
        ['7/3', '2/3'],
      ],
    ],
    [
      '[C -> C D]',
      '1',
      [
        ['0', '2/3'],
        ['2/3', '1/3'],
      ],
    ],
    ['(C -> C) + M2', '2', [['0', '2']]],
    [
      '(C, E)! -> (C, F)',
      '2',
      [
        ['0', '2'],
        ['0', '1'],
        ['1', '1'],
      ],
    ],
    [
      'C -> D',
      '2',
      [
        ['0', '1'],
        ['1', '1'],
      ],
    ],
    ['C -> .', '2', [['0', '1']]],
    ['. -> C', '2', [['1', '1']]],
  ])(
    'retains rhythm through holds, normalization, and composition: %s',
    (source, duration, notes) => {
      expect(timing(source)).toEqual({ duration, notes })
    },
  )

  it('matches sounding pitches rather than spelling or pitch value kind', () => {
    expect(timing('{12edo} C# -> Db')).toEqual({ duration: '2', notes: [['0', '2']] })
    expect(timing('C# -> Db')).toEqual({
      duration: '2',
      notes: [
        ['0', '1'],
        ['1', '1'],
      ],
    })
    expect(timing('C -> 0')).toEqual({ duration: '2', notes: [['0', '2']] })
    expect(timing('C -> ({root = D} C)')).toEqual({
      duration: '2',
      notes: [
        ['0', '1'],
        ['1', '1'],
      ],
    })
  })

  it('evaluates the right operand at its absolute timeline position', () => {
    const initialization = evaluateInitialization(parse('{12edo} . {19edo}'), {
      allowDuration: true,
    })
    expect(initialization.diagnostics).toEqual([])
    const result = score('1 -> 1', { initialization: initialization.initialization })
    expect(result.events.filter((event) => event.kind === 'note')).toHaveLength(2)
  })

  it('resolves right-hand bar rests from the operand offset', () => {
    expect(timing('@time(4/4) C -> (C;)|')).toEqual({ duration: '4', notes: [['0', '2']] })
  })

  it('retains zero-duration right-hand markers and their positions', () => {
    const result = score('C -> (C | D)')
    expect(result.events.filter((event) => event.kind === 'marker')).toMatchObject([
      { marker: 'barline', start: new Fraction(2) },
    ])
    expect(result.duration.toFraction()).toBe('3')
  })

  it.each([
    ['C -> @drone(D) E', 'C @drone(D) E'],
    ['@drone(D) -> C E', '@drone(D) C E'],
    ['C -> @groove([C= C]) @2 D E', 'C @groove([C= C]) @2 D E'],
    ['@groove([C= C]) -> C @2 D E', '@groove([C= C]) C @2 D E'],
  ])('preserves sequential directive state and explicit group scopes: %s', (actual, expected) => {
    const notes = (source: string) =>
      score(source)
        .events.filter((event) => event.kind === 'note')
        .map((note) => [
          note.pitch.value.toString(),
          note.start.toFraction(),
          note.duration.toFraction(),
        ])
    expect(notes(actual)).toEqual(notes(expected))
  })

  it('keeps drone changes inside explicitly grouped operands', () => {
    expect(timing('C -> (@drone(D) C) E')).toEqual({
      duration: '3',
      notes: [
        ['0', '2'],
        ['1', '1'],
        ['2', '1'],
      ],
    })
  })

  it('works in function returns, stored operands, and repeats', () => {
    expect(timing('fn sustain() { ret C -> C } sustain()')).toEqual({
      duration: '2',
      notes: [['0', '2']],
    })
    expect(timing('let motif = [C D E] motif -> E')).toEqual({
      duration: '2',
      notes: [
        ['0', '1/3'],
        ['1/3', '1/3'],
        ['2/3', '4/3'],
      ],
    })
    expect(timing('|: C -> C :|')).toEqual({
      duration: '4',
      notes: [
        ['0', '2'],
        ['2', '2'],
      ],
    })
  })

  it('retains source and removed-target provenance on the surviving note', () => {
    const notes = score('C -> C').events.filter((event) => event.kind === 'note')
    expect(notes[0]!.origins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'operator' }),
        expect.objectContaining({
          location: expect.objectContaining({ start: expect.objectContaining({ offset: 5 }) }),
        }),
      ]),
    )
  })

  it('projects the same surviving notes and endpoints into staff notation', () => {
    const result = evaluateProgramShape(parse('[C D E] -> [C F E]'))
    expect(result.diagnostics).toEqual([])
    if (!('shape' in result)) throw new Error('Expected a score shape.')
    const notes = (shape: StaffNotationShape): StaffNotationShape[] => {
      if (shape.kind === 'note') return [shape]
      if (shape.kind === 'sequence') return shape.children.flatMap(notes)
      if (shape.kind === 'parallel') return shape.branches.flatMap(notes)
      return []
    }
    expect(
      notes(constructStaffNotationShape(result.shape)).map((note) => note.duration.toFraction()),
    ).toEqual(['4/3', '1/3', '4/3', '1/3'])
  })
})
