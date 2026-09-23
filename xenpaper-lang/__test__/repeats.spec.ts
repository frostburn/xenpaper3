import { describe, expect, it } from 'vitest'
import { parse } from '../parser.js'
import { expandRepeats } from '../runtime/repeat-expansion'
import type { ExpandedNode } from '../runtime/types'

function body(source: string, expansionLimit?: number): readonly ExpandedNode[] {
  const result = expandRepeats(parse(source), { expansionLimit })
  expect(result.diagnostics).toEqual([])
  expect(result.program).toBeDefined()
  return result.program!.body
}

describe('repeat expansion', () => {
  it('defaults an unmatched repeat end to the start of its scope', () => {
    const implicit = body('C D E :|')
    const explicit = body('|: C D E :|')

    expect(implicit.map((node) => node.type)).toEqual([
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
    ])
    expect(implicit.map((node) => node.type)).toEqual(explicit.map((node) => node.type))
  })

  it('repeats every branch of the current parallel scope', () => {
    const implicit = parse('0 1, 2 3 :|').body[0]
    const explicit = parse('|: 0 1, 2 3 :|').body[0]

    expect(implicit).toMatchObject({
      type: 'Repeat',
      body: [{ type: 'Parallel', branches: [{ type: 'Sequence' }, { type: 'Sequence' }] }],
    })
    expect(implicit).toMatchObject({
      type: explicit.type,
      body: [{ type: explicit.body[0]!.type }],
      terminal: explicit.terminal,
    })
    expect(body('0 1, 2 3 :|').map((node) => node.type)).toEqual(
      body('|: 0 1, 2 3 :|').map((node) => node.type),
    )
  })

  it.each(['C :|, D', '(C :|, D)'])('preserves a branch-local implicit repeat in %s', (source) => {
    const expression = parse(source).body[0]
    const parallel = expression.type === 'Group' ? expression.expression : expression

    expect(parallel).toMatchObject({
      type: 'Parallel',
      branches: [{ type: 'Repeat', body: [{ type: 'PitchLiteral', raw: 'C' }] }, { raw: 'D' }],
    })
  })

  it('limits a parallel implicit repeat to its containing group', () => {
    const program = parse('(0 1, 2 3 :|) 4')

    expect(program.body[0]).toMatchObject({
      type: 'Sequence',
      items: [
        {
          type: 'Group',
          expression: { type: 'Repeat', body: [{ type: 'Parallel' }] },
        },
        { type: 'DegreeLiteral', degree: '4' },
      ],
    })
  })

  it('applies implicit alternate endings to every parallel branch', () => {
    const source = '0 1, 2 3 |¹ 4, 5 :|² 6, 7 ||'

    expect(parse(source).body[0]).toMatchObject({
      type: 'Repeat',
      body: [{ type: 'Parallel' }],
      endings: [
        { number: { value: '1' }, body: [{ type: 'Parallel' }] },
        { number: { value: '2' }, body: [{ type: 'Parallel' }] },
      ],
    })
    expect(body(source).map((node) => node.type)).toEqual([
      'Parallel',
      'Parallel',
      'Parallel',
      'Parallel',
    ])
  })

  it('does not include material following a parallel repeat end in its body', () => {
    expect(parse('0 1, 2 3 :| 4 5').body[0]).toMatchObject({
      type: 'Sequence',
      items: [
        { type: 'Repeat', body: [{ type: 'Parallel' }] },
        { type: 'Sequence', items: [{ degree: '4' }, { degree: '5' }] },
      ],
    })
  })

  it('keeps multiple implicit parallel repeats separated by barlines', () => {
    const program = parse('0 1, 2 3 :| | 4 5, 6 7 :|')

    expect(program.body[0]).toMatchObject({
      type: 'Sequence',
      items: [
        { type: 'Repeat', body: [{ type: 'Parallel' }] },
        { type: 'Repeat', body: [{ type: 'Parallel' }] },
      ],
    })
  })

  it('uses the containing group and parallel branch as implicit repeat scopes', () => {
    const expanded = body('(C D :|) E, F G :|')

    expect(expanded[0]).toMatchObject({
      type: 'Parallel',
      branches: [
        { type: 'Sequence', items: [{ type: 'Group' }, { type: 'PitchLiteral', raw: 'E' }] },
        { type: 'Sequence' },
      ],
    })
  })

  it.each(['groove', 'drone'])('keeps implicit repeats inside @%s arguments', (name) => {
    const directive = parse(`@${name}(C D :|) E`).body[0] as {
      type: string
      items: Array<{ type: string; arguments?: Array<{ type: string }> }>
    }

    expect(directive).toMatchObject({
      type: 'Sequence',
      items: [
        { type: 'Directive', arguments: [{ type: 'Repeat' }] },
        { type: 'PitchLiteral', raw: 'E' },
      ],
    })
  })

  it('uses two iterations when the source omits a count', () => {
    const program = parse('|: C :|')

    expect(program.body[0]).toMatchObject({ count: null })

    const expanded = body('|: C :|')

    expect(expanded.map((node) => node.type)).toEqual(['PitchLiteral', 'PitchLiteral'])
    expect(expanded.map((node) => node.expansionPath)).toEqual([
      [{ repeatOffset: 0, iteration: 0 }],
      [{ repeatOffset: 0, iteration: 1 }],
    ])
  })

  it('retains Peggy values for omitted repeat fields', () => {
    expect(parse('|: :|').body[0]).toMatchObject({ count: null, body: [] })
  })

  it('expands nested repeats and composes occurrence paths', () => {
    const expanded = body('|:@x2 C |:@x2 D :| :|')

    expect(expanded.map((node) => node.type)).toEqual([
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
    ])
    expect(expanded[2]!.expansionPath).toEqual([
      { repeatOffset: 0, iteration: 0 },
      { repeatOffset: 8, iteration: 1 },
    ])
    expect(expanded[5]!.expansionPath).toEqual([
      { repeatOffset: 0, iteration: 1 },
      { repeatOffset: 8, iteration: 1 },
    ])
  })

  it('splices repeats into the surrounding AST like explicitly authored copies', () => {
    const repeated = body('|: C D E F @. G :|')
    const authored = body('C D E F @. G C D E F @. G')

    expect(repeated.map((node) => node.type)).toEqual(authored.map((node) => node.type))
    expect(repeated.some((node) => node.type === 'Repeat' || node.type === 'Sequence')).toBe(false)
  })

  it('does not mutate the parser tree', () => {
    const program = parse('|:@x2 C :|')
    expandRepeats(program)

    expect(program.body[0]!.type).toBe('Repeat')
    expect(program.body[0]).not.toHaveProperty('expansionPath')
  })

  it('supports an empty zero-count repeat', () => {
    expect(body('|:@x0 C :|')).toEqual([])
  })

  it('does not iterate enormous repeats whose expansion is empty', () => {
    expect(body('|:@x999999999999999999999999 :|')).toEqual([])
    expect(body('|:@x999999999999999999999999 |:@x0 C :| :|')).toEqual([])
  })

  it('returns a diagnostic and no partial program at the expansion limit', () => {
    const result = expandRepeats(parse('|:@x3 C D :|'), { expansionLimit: 5 })

    expect(result.program).toBeUndefined()
    expect(result.diagnostics).toMatchObject([
      {
        code: 'XP_REPEAT_EXPANSION_LIMIT',
        severity: 'error',
        locations: [{ start: { offset: 6 } }],
      },
    ])
  })

  it('keeps a repeated parallel branch grouped as one branch', () => {
    const [parallel] = body('C, |:@x2 D :|')
    const branches = parallel!.branches as ExpandedNode[]

    expect(branches.map((branch) => branch.type)).toEqual(['PitchLiteral', 'Sequence'])
    expect((branches[1]!.items as ExpandedNode[]).map((item) => item.type)).toEqual([
      'PitchLiteral',
      'PitchLiteral',
    ])
  })

  it('retains the same source location across expanded occurrences', () => {
    const expanded = body('|:@x3 C :|')

    expect(expanded.map((node) => node.location)).toEqual([
      expanded[0]!.location,
      expanded[0]!.location,
      expanded[0]!.location,
    ])
  })

  it.each([
    ['|: 1 2 |@^1 3 4 :|@^2 5 6 ||', ['1', '2', '3', '4', '1', '2', '5', '6']],
    [
      '|:ˣ³ 1 2 |¹ 3 4 :|² 5 6 :|³ 7 8 ||',
      ['1', '2', '3', '4', '1', '2', '5', '6', '1', '2', '7', '8'],
    ],
  ])('expands numbered alternate endings in %s', (source, expected) => {
    const degrees = (nodes: readonly ExpandedNode[]): string[] =>
      nodes.flatMap((node) =>
        node.type === 'DegreeLiteral'
          ? [node.degree as string]
          : degrees((node.items as ExpandedNode[] | undefined) ?? []),
      )

    expect(degrees(body(source))).toEqual(expected)
  })

  it('ends alternate endings at a single barline and continues the document', () => {
    const program = parse(`|: 0 2 4 5 |¹ 7 5 4 2 :|² 7 11 12= |
12 11 9 7 | 5 4 2 -1 | 0=== ||`)

    expect(program.body[0]).toMatchObject({ type: 'Sequence' })
    const repeat = (program.body[0] as { items: Array<{ type: string }> }).items[0]
    expect(repeat).toMatchObject({ type: 'Repeat', terminal: '|' })
  })

  it('preserves attached barlines inside alternate endings', () => {
    const program = parse('|: C |¹ D|E :|² F')
    const repeat = program.body[0] as {
      endings: Array<{ body: Array<{ type: string; items: Array<{ type: string; raw: string }> }> }>
    }

    expect(repeat.endings[0]!.body[0]).toMatchObject({
      type: 'Sequence',
      items: [
        { type: 'PitchLiteral', raw: 'D' },
        { type: 'Barline', raw: '|' },
        { type: 'PitchLiteral', raw: 'E' },
      ],
    })
  })

  it('preserves detached barlines before a subsequent alternate ending', () => {
    const source = 'C D |¹ E F | G :|² A B'
    const program = parse(source)
    const repeat = program.body[0] as {
      endings: Array<{ body: Array<{ type: string; items: Array<{ type: string; raw: string }> }> }>
    }

    expect(repeat.endings[0]!.body[0]).toMatchObject({
      type: 'Sequence',
      items: [
        { type: 'PitchLiteral', raw: 'E' },
        { type: 'PitchLiteral', raw: 'F' },
        { type: 'Barline', raw: '|' },
        { type: 'PitchLiteral', raw: 'G' },
      ],
    })
    expect(
      body(source)
        .filter((node) => node.type === 'PitchLiteral')
        .map((node) => node.raw),
    ).toEqual(['C', 'D', 'E', 'F', 'G', 'C', 'D', 'A', 'B'])
  })

  it('does not scan past a detached terminal into a later implicit repeat', () => {
    const source = 'C |¹ D :|² E | F |¹ G :|² A |'
    const pitches = (nodes: readonly ExpandedNode[]): string[] =>
      nodes.flatMap((node) =>
        node.type === 'PitchLiteral'
          ? [node.raw as string]
          : pitches((node.items as ExpandedNode[] | undefined) ?? []),
      )

    expect(pitches(body(source))).toEqual([
      'C',
      'D',
      'C',
      'E',
      'F',
      'G',
      'C',
      'D',
      'C',
      'E',
      'F',
      'A',
    ])
  })

  it('accepts the end of the document as an alternate-ending terminal', () => {
    const source = '|: 1 2 |¹ 3 4 :|² 5 6'
    const repeat = parse(source).body[0]

    expect(repeat).toMatchObject({ type: 'Repeat', terminal: null })
    expect(body(source).map((node) => node.degree as string)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '1',
      '2',
      '5',
      '6',
    ])
  })

  it('allows an omitted initial repeat marker', () => {
    const source = '0 1 |¹ 2 3 :|² 4 5 ||'

    expect(body(source).map((node) => node.degree as string)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '0',
      '1',
      '4',
      '5',
    ])
  })

  it('continues after implicit-start alternate endings', () => {
    const program = parse('0 1 |¹ 2 3 :|² 4 5 | 6 7')

    expect(program.body[0]).toMatchObject({
      type: 'Sequence',
      items: [{ type: 'Repeat', terminal: '|' }, { type: 'Sequence' }],
    })
  })

  it('populates incompleteEndings on unmatched repeat ends', () => {
    expect(parse('0 1 :|').body[0]).toMatchObject({
      type: 'Repeat',
      incompleteEndings: false,
    })
  })

  it('allows a partial alternate-ending score at end of input', () => {
    expect(parse('0 1 |¹ 2 3').body[0]).toMatchObject({
      type: 'Repeat',
      terminal: null,
      endings: [{ number: { value: '1' } }],
    })
  })

  it('warns when a subsequent alternate-ending marker is omitted', () => {
    const result = expandRepeats(parse('|: 0 1 |¹ 2 3 :| 4 5 ||'))

    expect(result.program).toBeDefined()
    expect(result.diagnostics).toMatchObject([
      { code: 'XP_INCOMPLETE_REPEAT_ENDINGS', severity: 'warning' },
    ])
  })

  it('allows alternate-ending markers on aligned plain barlines', () => {
    const source = `0 1 |¹ 2 3 :|
        |² 4 5 ||`

    expect(body(source).map((node) => node.degree as string)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '0',
      '1',
      '4',
      '5',
    ])
  })
})
