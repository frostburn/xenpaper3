import { describe, expect, it } from 'vitest'
import { parse } from '../parser.generated.js'

const score = String.raw`# FJS and prefix modifiers
E^5 Ebv5 P1v5 Cv5 E_
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

describe('Xenpaper surface grammar', () => {
  it('parses adjacent dots as a single cluster rest', () => {
    expect(parse('...').body[0]).toMatchObject({ type: 'Rest', raw: '...' })
  })

  it('parses rests attached to surrounding notes as sequence items', () => {
    const items = (parse('C. .D').body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual(['PitchLiteral', 'Rest', 'Rest', 'PitchLiteral'])
    expect(items.map((item) => item.raw)).toEqual(['C', '.', '.', 'D'])
  })

  it('preserves degrees and rest clusters when rests are attached to numbers', () => {
    const singleRest = (parse('1.C').body[0] as SyntaxNode).items as SyntaxNode[]
    const clusterRest = (parse('1...C').body[0] as SyntaxNode).items as SyntaxNode[]

    expect(singleRest.map((item) => [item.type, item.raw])).toEqual([
      ['DegreeLiteral', '1'],
      ['Rest', '.'],
      ['PitchLiteral', 'C'],
    ])
    expect(clusterRest.map((item) => [item.type, item.raw])).toEqual([
      ['DegreeLiteral', '1'],
      ['Rest', '...'],
      ['PitchLiteral', 'C'],
    ])
  })

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

  it.each([
    ['{13edo}C D E', ['PitchContextChange', 'PitchLiteral', 'PitchLiteral', 'PitchLiteral']],
    ['[C D]E', ['NormalizeToSlot', 'PitchLiteral']],
    ['(C D)E', ['Group', 'PitchLiteral']],
    ['C[D E]F', ['PitchLiteral', 'NormalizeToSlot', 'PitchLiteral']],
    ['C{13edo}D', ['PitchLiteral', 'PitchContextChange', 'PitchLiteral']],
  ])('does not require whitespace around structural notation in %s', (source, types) => {
    const items = (parse(source).body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual(types)
  })

  it('distinguishes attached FJS inflections and prefix pitch modifiers', () => {
    const program = parse("E^5 Ebv5 P1v5 Cv5 E_ /'C '/C vDb C#")
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
      'PitchLiteral',
    ])
    expect(items.map((item) => item.raw)).toEqual([
      'E^5',
      'Ebv5',
      'P1v5',
      'Cv5',
      'E_',
      "/'C",
      "'/C",
      'vDb',
      'C#',
    ])
    expect((items[4].accidentals as SyntaxNode[]).map((accidental) => accidental.value)).toEqual([
      '_',
    ])
    expect(parse('E_5').body[0]).toMatchObject({ type: 'Identifier', name: 'E_5' })
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

  it('admits equave shifts with negative degrees', () => {
    const expression = parse('"-2').body[0]

    expect(expression.type).toBe('UnaryExpression')
    expect(expression.operator).toBe('"')
    expect((expression.operand as SyntaxNode).type).toBe('DegreeLiteral')
    expect((expression.operand as SyntaxNode).degree).toBe('-2')
  })

  it('admits equave shifts with ratios', () => {
    const expression = parse('"3/2').body[0]

    expect(expression.type).toBe('UnaryExpression')
    expect(expression.operator).toBe('"')
    expect((expression.operand as SyntaxNode).type).toBe('RatioLiteral')
  })

  it('parses unary plus degrees like unary minus degrees', () => {
    const expression = parse('+5').body[0]

    expect(expression.type).toBe('DegreeLiteral')
    expect(expression.degree).toBe('5')
  })

  it('parses a sequence of degrees', () => {
    const program = parse('0 1 2 -3')
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual([
      'DegreeLiteral',
      'DegreeLiteral',
      'DegreeLiteral',
      'DegreeLiteral',
    ])
    expect(items.map((item) => item.degree)).toEqual(['0', '1', '2', '-3'])
  })

  it('preserves attached plus signs as degree signs after sequence gaps', () => {
    const program = parse('0 +5')
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual(['DegreeLiteral', 'DegreeLiteral'])
    expect(items.map((item) => item.degree)).toEqual(['0', '5'])
  })

  it('keeps spaced plus signs as binary addition', () => {
    const expression = parse('0 + 5').body[0]

    expect(expression.type).toBe('BinaryExpression')
    expect(expression.operator).toBe('+')
  })

  it('distinguishes attached negated intervals from spaced subtraction', () => {
    const sequence = parse('D -n3').body[0]
    const subtraction = parse('D - n3').body[0]
    const attachedSubtraction = parse('D-n3').body[0]

    expect(sequence).toMatchObject({
      type: 'Sequence',
      items: [
        { type: 'PitchLiteral', raw: 'D' },
        { type: 'UnaryExpression', operator: '-', operand: { type: 'IntervalLiteral', raw: 'n3' } },
      ],
    })
    expect(subtraction).toMatchObject({
      type: 'BinaryExpression',
      operator: '-',
      left: { type: 'PitchLiteral', raw: 'D' },
      right: { type: 'IntervalLiteral', raw: 'n3' },
    })
    expect(attachedSubtraction).toMatchObject({
      type: 'BinaryExpression',
      operator: '-',
      left: { type: 'PitchLiteral', raw: 'D' },
      right: { type: 'IntervalLiteral', raw: 'n3' },
    })
  })

  it('parses explicitly marked numeric literals as sequence items before degrees', () => {
    const program = parse(String.raw`3/2 1\12 3.5e 3.5r`)
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual([
      'RatioLiteral',
      'EqualDivisionLiteral',
      'DecimalLiteral',
      'RealLiteral',
    ])
  })

  it('treats an unmarked decimal-looking token as music', () => {
    const items = (parse('1.2').body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => [item.type, item.raw])).toEqual([
      ['DegreeLiteral', '1'],
      ['Rest', '.'],
      ['DegreeLiteral', '2'],
    ])
  })

  it('parses a sequence of degrees followed by binary operation of integers', () => {
    const program = parse('0 1 2 - 3')
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual([
      'DegreeLiteral',
      'DegreeLiteral',
      'BinaryExpression',
    ])
    expect(items[2].operator).toBe('-')
  })

  it('parses a parallel composition of degrees', () => {
    const program = parse('0, 1, 2, -3')
    const branches = (program.body[0] as SyntaxNode).branches as SyntaxNode[]

    expect(branches.map((branch) => branch.type)).toEqual([
      'DegreeLiteral',
      'DegreeLiteral',
      'DegreeLiteral',
      'DegreeLiteral',
    ])
    expect(branches.map((branch) => branch.degree)).toEqual(['0', '1', '2', '-3'])
  })

  it('parses a slotted triplet of degrees', () => {
    const program = parse('[1 -2 3]')
    const expression = (program.body[0] as SyntaxNode).expression as SyntaxNode
    const items = expression.items as SyntaxNode[]

    expect(expression.type).toBe('Sequence')
    expect(items.map((item) => item.degree)).toEqual(['1', '-2', '3'])
  })

  it('parses a slotted chord of degrees', () => {
    const program = parse('[1, -2, 3]')
    const expression = (program.body[0] as SyntaxNode).expression as SyntaxNode
    const branches = expression.branches as SyntaxNode[]

    expect(expression.type).toBe('Parallel')
    expect(branches.map((branch) => branch.degree)).toEqual(['1', '-2', '3'])
  })

  it('parses holds', () => {
    const program = parse('0= = | =')
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual([
      'PostfixExpression',
      'DetachedContinue',
      'Barline',
      'DetachedContinue',
    ])
    expect(((items[0].marks as SyntaxNode[])[0] as SyntaxNode).type).toBe('DetachedContinue')
  })

  it('parses double barlines as hard boundaries', () => {
    const items = parse('C || D').body as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual(['PitchLiteral', 'HardBoundary', 'PitchLiteral'])
  })

  it('uses barlines and repeat markers as sequence gaps', () => {
    const items = (parse('C|D| E|:F G:||').body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual([
      'PitchLiteral',
      'Barline',
      'PitchLiteral',
      'Barline',
      'PitchLiteral',
      'Repeat',
      'Barline',
    ])
    expect(((items[5].body as SyntaxNode[])[0] as SyntaxNode).type).toBe('Sequence')
  })

  it('supports prefixes with relative pitch offset literals', () => {
    const program = parse("^M2 'P4")
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual(['IntervalLiteral', 'IntervalLiteral'])
    expect(items.map((item) => item.quality)).toEqual(['M', 'P'])
    expect((items[0].modifiers as SyntaxNode[]).map((modifier) => modifier.raw)).toEqual(['^'])
    expect((items[1].modifiers as SyntaxNode[]).map((modifier) => modifier.raw)).toEqual(["'"])
  })

  it('sequences a pitch with an attached up modifier instead of treating it as power', () => {
    const expression = parse('C ^D').body[0]
    const items = expression.items as SyntaxNode[]

    expect(expression.type).toBe('Sequence')
    expect(items.map((item) => item.type)).toEqual(['PitchLiteral', 'PitchLiteral'])
    expect((items[1].modifiers as SyntaxNode[]).map((modifier) => modifier.raw)).toEqual(['^'])
  })

  it('supports multiple augmentation and diminution of pitch offsets', () => {
    const program = parse('AAA4 dd5')
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual(['IntervalLiteral', 'IntervalLiteral'])
    expect(items.map((item) => item.quality)).toEqual(['AAA', 'dd'])
    expect(items.map((item) => item.number)).toEqual(['4', '5'])
  })

  it('supports semi-augmented and semi-diminished pitch offsets', () => {
    const program = parse('SA4 SAA4 sd5 sdd5')
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.quality)).toEqual(['SA', 'SAA', 'sd', 'sdd'])
  })
})
