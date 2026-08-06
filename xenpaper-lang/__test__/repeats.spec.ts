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
    const expanded = body('|: C :|')

    expect(expanded.map((node) => node.type)).toEqual(['PitchLiteral', 'PitchLiteral'])
    expect(expanded.map((node) => node.expansionPath)).toEqual([
      [{ repeatOffset: 0, iteration: 0 }],
      [{ repeatOffset: 0, iteration: 1 }],
    ])
  })

  it('expands nested repeats and composes occurrence paths', () => {
    const expanded = body('|:(x2) C |:(x2) D :| :|')

    const occurrences = expanded.flatMap((node) => node.items as ExpandedNode[])

    expect(occurrences.map((node) => node.type)).toEqual([
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
    ])
    expect(occurrences[2]!.expansionPath).toEqual([
      { repeatOffset: 0, iteration: 0 },
      { repeatOffset: 9, iteration: 1 },
    ])
    expect(occurrences[5]!.expansionPath).toEqual([
      { repeatOffset: 0, iteration: 1 },
      { repeatOffset: 9, iteration: 1 },
    ])
  })

  it('does not mutate the parser tree', () => {
    const program = parse('|:(x2) C :|')
    expandRepeats(program)

    expect(program.body[0]!.type).toBe('Repeat')
    expect(program.body[0]).not.toHaveProperty('expansionPath')
  })

  it('supports an empty zero-count repeat', () => {
    expect(body('|:(x0) C :|')).toEqual([])
  })

  it('returns a diagnostic and no partial program at the expansion limit', () => {
    const result = expandRepeats(parse('|:(x3) C D :|'), { expansionLimit: 5 })

    expect(result.program).toBeUndefined()
    expect(result.diagnostics).toMatchObject([
      {
        code: 'XP_REPEAT_EXPANSION_LIMIT',
        severity: 'error',
        locations: [{ start: { offset: 7 } }],
      },
    ])
  })

  it('keeps a repeated parallel branch grouped as one branch', () => {
    const [parallel] = body('C, |:(x2) D :|')
    const branches = parallel!.branches as ExpandedNode[]

    expect(branches.map((branch) => branch.type)).toEqual(['PitchLiteral', 'Sequence'])
    expect((branches[1]!.items as ExpandedNode[]).map((item) => item.type)).toEqual([
      'PitchLiteral',
      'PitchLiteral',
    ])
  })

  it('retains the same source location across expanded occurrences', () => {
    const expanded = body('|:(x3) C :|')

    expect(expanded.map((node) => node.location)).toEqual([
      expanded[0]!.location,
      expanded[0]!.location,
      expanded[0]!.location,
    ])
  })
})
