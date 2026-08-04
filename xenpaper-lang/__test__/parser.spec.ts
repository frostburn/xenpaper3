import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import peggy from 'peggy'
import { beforeAll, describe, expect, it } from 'vitest'

const score = String.raw`# FJS and prefix modifiers
E^5 Eb_5 P1_5 Cv5
/'C '/C vDb C#

# Context changes
{24edo}
{^ = 1\24}
{/ = 5\24}
{map = <24\24 38\24 56\24 67\24 83\24]}

# Parallel composition; duration checks happen after parsing
C D,
E F G,
A B . ||

# Repeat remains an AST macro
{root = 220Hz}
{${'`'}A = root}
{41edo}
|:(x10)
[${'`'}A, Cv5, E]
[Cv5, E, Gv5]
[${'`'}B, Dv5, Gv5]
[${'`'}Av5, Dv5, F#]
{root = ${'`'}Av5}
:|`

type SyntaxNode = {
  type: string
  [property: string]: unknown
}

let parse: (source: string) => SyntaxNode

beforeAll(() => {
  const grammar = readFileSync(resolve('xenpaper-lang/xenpaper.peggy'), 'utf8')
  parse = peggy.generate(grammar).parse
})

describe('Xenpaper surface grammar', () => {
  it('compiles and parses the representative score syntax', () => {
    const program = parse(score)

    expect(program.type).toBe('Program')
    expect(program.source).toBe(score)
    expect((program.comments as SyntaxNode[]).map((comment) => comment.value)).toEqual([
      ' FJS and prefix modifiers',
      ' Context changes',
      ' Parallel composition; duration checks happen after parsing',
      ' Repeat remains an AST macro',
    ])
  })

  it('distinguishes attached FJS inflections and prefix pitch modifiers', () => {
    const program = parse("E^5 Eb_5 P1_5 Cv5 /'C '/C vDb C#")
    const items = (program.body as SyntaxNode[])[0].items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual([
      'PitchLiteral',
      'PitchLiteral',
      'IntervalLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchLiteral',
    ])
    expect(items.map((item) => item.raw)).toEqual([
      'E^5',
      'Eb_5',
      'P1_5',
      'Cv5',
      "/'C",
      "'/C",
      'vDb',
      'C#',
    ])
  })

  it('keeps parallel branches and repeats as syntax-tree nodes', () => {
    const program = parse('C D,\nE F G,\nA B . ||\n|:(x10) [C, E, G] :|')
    const body = program.body as SyntaxNode[]

    expect(body.map((item) => item.type)).toEqual(['Parallel', 'HardBoundary', 'Repeat'])
    expect((body[0].branches as SyntaxNode[]).map((branch) => branch.type)).toEqual([
      'Sequence',
      'Sequence',
      'Sequence',
    ])
    expect((body[2].count as SyntaxNode).value).toBe('10')
  })
})
