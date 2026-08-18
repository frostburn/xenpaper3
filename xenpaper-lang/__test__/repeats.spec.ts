import { describe, expect, it } from 'vitest'
import { parse } from '../parser.generated.js'
import { expandRepeats } from '../runtime/repeat-expansion'
import type { ExpandedNode } from '../runtime/types'

function body(source: string, expansionLimit?: number): readonly ExpandedNode[] {
  const result = expandRepeats(parse(source), { expansionLimit })
  expect(result.diagnostics).toEqual([])
  expect(result.program).toBeDefined()
  return result.program!.body
}

describe('repeat expansion', () => {
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
})
