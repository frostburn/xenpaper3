import { describe, expect, it } from 'vitest'
import { parseDrums } from '..'
import { parse } from '../parser.generated.js'

describe('grammar boundary roles', () => {
  it('shares rhythm while interpreting bare drum words as sample leaves', () => {
    expect(parse('bd').body[0]).toMatchObject({
      type: 'PitchLiteral',
      nominal: { system: 'latin', value: 'b' },
      accidentals: [{ value: 'd' }],
    })
    expect(parseDrums('|:@x2 [bd sd] :|, hh?').body[0]).toMatchObject({
      type: 'Parallel',
      branches: [
        {
          type: 'Repeat',
          body: [
            {
              type: 'NormalizeToSlot',
              expression: {
                type: 'Sequence',
                items: [
                  { type: 'DrumSampleLiteral', sample: 'bd' },
                  { type: 'DrumSampleLiteral', sample: 'sd' },
                ],
              },
            },
          ],
        },
        {
          type: 'PostfixExpression',
          expression: { type: 'DrumSampleLiteral', sample: 'hh' },
        },
      ],
    })
  })

  it('keeps signed degrees as sequence items while allowing explicit scalar arithmetic', () => {
    expect(parse('-1 -2 0 +1').body[0]).toMatchObject({
      type: 'Sequence',
      items: [
        { type: 'DegreeLiteral', degree: '-1' },
        { type: 'DegreeLiteral', degree: '-2' },
        { type: 'DegreeLiteral', degree: '0' },
        { type: 'DegreeLiteral', degree: '1' },
      ],
    })
    expect(parse('-1/1 - 2/1').body[0]).toMatchObject({ type: 'BinaryExpression', operator: '-' })
    expect(parse('2 * M2').body[0]).toMatchObject({ type: 'BinaryExpression', operator: '*' })
  })

  it('distinguishes attached pitch arithmetic, signed items, and slash roles', () => {
    expect(parse('G-n3').body[0]).toMatchObject({ type: 'BinaryExpression', operator: '-' })
    expect(parse('D -n3').body[0]).toMatchObject({ type: 'Sequence' })
    expect(parse('D - n3').body[0]).toMatchObject({ type: 'BinaryExpression', operator: '-' })
    expect(parse('m7 / 2').body[0]).toMatchObject({ type: 'BinaryExpression', operator: '/' })
    expect(parse('/2 /cb').body[0]).toMatchObject({ type: 'Sequence' })
    expect(parse('3/2').body[0]).toMatchObject({ type: 'RatioLiteral' })
  })

  it('supports interordinals and adjacent self-delimiting sequence items', () => {
    expect(parse('P4½ P4h').body[0]).toMatchObject({
      type: 'Sequence',
      items: [
        { type: 'IntervalLiteral', number: '4.5' },
        { type: 'IntervalLiteral', number: '4.5' },
      ],
    })
    expect(parse('P4.5').body[0]).toMatchObject({
      type: 'Sequence',
      items: [{ type: 'IntervalLiteral', number: '4' }, { type: 'Rest' }, { degree: '5' }],
    })
    for (const source of ['0.2.3...3=2=0==.', 'C[D E]F', '{13edo}[0,4,7]']) {
      expect(() => parse(source)).not.toThrow()
    }
  })
})

describe('enumerated chords', () => {
  it('preserves chords in the syntax tree with chord-tight arithmetic precedence', () => {
    expect(parse('3/2 * 4:5:6').body[0]).toMatchObject({
      type: 'BinaryExpression',
      operator: '*',
      right: {
        type: 'EnumeratedChord',
        enumerands: [{ value: '4' }, { value: '5' }, { value: '6' }],
      },
    })
    expect(parse('4:(4 + 1):6').body[0]).toMatchObject({
      type: 'EnumeratedChord',
      enumerands: [
        { value: '4' },
        { type: 'Group', expression: { operator: '+' } },
        { value: '6' },
      ],
    })
  })

  it('enumerates inclusive integer ranges and inverts before normalization', () => {
    expect(parse('4::7').body[0]).toMatchObject({
      type: 'EnumeratedChord',
      first: { value: '4' },
      rangeEnd: { value: '7' },
    })
    expect(parse('/6::4').body[0]).toMatchObject({
      type: 'EnumeratedChord',
      inverted: true,
      first: { value: '6' },
      rangeEnd: { value: '4' },
    })
  })

  it('preserves exact integers beyond the safe Number range', () => {
    expect(parse('9007199254740993::9007199254740994').body[0]).toMatchObject({
      type: 'EnumeratedChord',
      first: { value: '9007199254740993' },
      rangeEnd: { value: '9007199254740994' },
    })
  })

  it('does not expand ranges while parsing', () => {
    expect(parse('1::1000000000').body[0]).toMatchObject({ type: 'EnumeratedChord' })
  })

  it('preserves an enumerated chord used as a scale', () => {
    expect(parse('{/6::3}').body[0]).toMatchObject({
      type: 'PitchContextChange',
      statements: [
        {
          type: 'ContextDegreeMapping',
          values: [{ type: 'EnumeratedChord', inverted: true, rangeEnd: { value: '3' } }],
        },
      ],
    })
  })

  it('parses integer scale entries as degrees', () => {
    expect(parse('{3 6 8}').body[0]).toMatchObject({
      type: 'PitchContextChange',
      statements: [
        {
          type: 'ContextDegreeMapping',
          values: [
            {
              type: 'Sequence',
              items: [
                { type: 'DegreeLiteral', degree: '3' },
                { type: 'DegreeLiteral', degree: '6' },
                { type: 'DegreeLiteral', degree: '8' },
              ],
            },
          ],
        },
      ],
    })
  })

  it('parses degree mappings with the ordinary sequence and parallel grammar', () => {
    expect(parse('{3/2 5/4, 7/4}').body[0]).toMatchObject({
      statements: [
        {
          type: 'ContextDegreeMapping',
          values: [
            {
              type: 'Parallel',
              branches: [{ type: 'Sequence' }, { type: 'RatioLiteral' }],
            },
          ],
        },
      ],
    })
  })

  it('keeps a single bare integer as a degree mapping rather than a preset', () => {
    expect(parse('{2}').body[0]).toMatchObject({
      statements: [
        {
          type: 'ContextDegreeMapping',
          values: [{ type: 'DegreeLiteral', degree: '2' }],
        },
      ],
    })
  })

  it('parses a root integer assignment as a scale degree', () => {
    expect(parse('{root = 3}').body[0]).toMatchObject({
      statements: [{ target: { name: 'root' }, value: { type: 'DegreeLiteral', degree: '3' } }],
    })
  })

  it('parses an equave-shifted root degree', () => {
    expect(parse("{root = '0}").body[0]).toMatchObject({
      statements: [
        {
          target: { name: 'root' },
          value: {
            type: 'PitchModifierExpression',
            modifier: { kind: 'equaveUp' },
            operand: { degree: '0' },
          },
        },
      ],
    })
  })

  it('accepts generic expressions in root assignments', () => {
    expect(parse('{root = C#}').body[0]).toMatchObject({
      statements: [
        {
          type: 'ContextAssignment',
          target: { name: 'root' },
          value: { type: 'PitchLiteral', raw: 'C#' },
        },
      ],
    })
    expect(parse('{root = C# + M3}').body[0]).toMatchObject({
      statements: [
        {
          type: 'ContextAssignment',
          target: { name: 'root' },
          value: {
            type: 'BinaryExpression',
            operator: '+',
            left: { type: 'PitchLiteral', raw: 'C#' },
            right: { type: 'IntervalLiteral', raw: 'M3' },
          },
        },
      ],
    })
  })

  it('parses root associations in both directions and rejects assignment syntax', () => {
    for (const source of ['{root as D}', '{D as root}', "{root as 'A}", "{'A as root}"]) {
      expect(parse(source).body[0]).toMatchObject({
        type: 'PitchContextChange',
        statements: [
          {
            type: 'ContextAssignment',
            target: { type: 'ContextPitchTarget' },
            value: { type: 'Identifier', name: 'root' },
          },
        ],
      })
    }
    expect(parse("{root as 'A}").body[0]).toMatchObject({
      statements: [
        {
          target: {
            pitch: { nominal: { value: 'A' }, modifiers: [{ kind: 'equaveUp', raw: "'" }] },
          },
        },
      ],
    })
    expect(() => parse('{D = root}')).toThrow(/Expected/)
  })
})

describe('Diamond-MOS tokens', () => {
  it('requires semicolons around MOS assignments and accepts a key UDP selector', () => {
    expect(() => parse('MOS{5L2s key=K L=2\\12}')).toThrow(/semicolon/)
    expect(parse('MOS{5L2s; key=K 2|4; L=2\\12}').body[0]).toMatchObject({
      statements: [
        {
          elements: [
            { type: 'MosPatternCounts' },
            { type: 'SignatureDeclaration', kind: 'key', udp: { up: '2', down: '4' } },
            { type: 'MosStepAssignment', target: 'L' },
          ],
        },
      ],
    })
    expect(() => parse('{sig=C# key=G}')).toThrow(/Expected/)
    expect(parse('{sig=C#; key=G}').body[0]).toMatchObject({ statements: [{}, {}] })
    expect(parse('{key=D minor}').body[0]).toMatchObject({
      statements: [{ type: 'SignatureDeclaration', kind: 'key', mode: 'minor' }],
    })
    expect(parse('{key=F LYDIAN}').body[0]).toMatchObject({
      statements: [{ type: 'SignatureDeclaration', kind: 'key', mode: 'lydian' }],
    })
    expect(() => parse('{key=D melodic}')).toThrow(/Expected/)
  })

  it('parses the MOS sub-language structurally in any element order', () => {
    const elements = (source: string) =>
      (parse(source).body[0] as { statements: { elements: { type: string }[] }[] }).statements[0]!
        .elements

    expect(elements('MOS{5L2s 3:2 2|4}').map((element) => element.type)).toEqual([
      'MosPatternCounts',
      'MosHardness',
      'MosUdp',
    ])
    expect(elements('MOS{2|4 5L2s 3:2}').map((element) => element.type)).toEqual([
      'MosUdp',
      'MosPatternCounts',
      'MosHardness',
    ])
    expect(elements('MOS{4L5s<3>}').map((element) => element.type)).toEqual([
      'MosPatternCounts',
      'MosEquave',
    ])
  })

  it('does not consume ordinary identifiers as multi-letter MOS pitches', () => {
    expect(parse('@test(sqrt(2))').body[0]).toMatchObject({
      type: 'Directive',
      arguments: [{ type: 'CallExpression', callee: 'sqrt' }],
    })
    expect(parse('{root = 220Hz}').body[0]).toMatchObject({
      type: 'PitchContextChange',
      statements: [{ target: { type: 'ContextNameTarget', name: 'root' } }],
    })
  })

  it('parses extended MOS nominals through ZZ', () => {
    expect(parse('JJ KZ ZZ').body).toMatchObject([
      {
        type: 'Sequence',
        items: [
          { type: 'PitchLiteral', nominal: { system: 'mos', value: 'JJ' } },
          { type: 'PitchLiteral', nominal: { system: 'mos', value: 'KZ' } },
          { type: 'PitchLiteral', nominal: { system: 'mos', value: 'ZZ' } },
        ],
      },
    ])
  })

  it('parses down-shifted MOS pitches as unary expressions', () => {
    expect(parse('vK vZZ').body[0]).toMatchObject({
      type: 'Sequence',
      items: [
        {
          type: 'PitchModifierExpression',
          modifier: { kind: 'down' },
          operand: { type: 'PitchLiteral', nominal: { system: 'mos', value: 'K' } },
        },
        {
          type: 'PitchModifierExpression',
          modifier: { kind: 'down' },
          operand: { type: 'PitchLiteral', nominal: { system: 'mos', value: 'ZZ' } },
        },
      ],
    })
  })

  it('parses MOS pitches as context-assignment targets and rejects FJS suffixes', () => {
    expect(parse('MOS{5L2s} {K as root}').body[0]).toMatchObject({
      type: 'Sequence',
      items: [
        { type: 'PitchContextChange', statements: [{ type: 'MosDeclaration' }] },
        {
          type: 'PitchContextChange',
          statements: [
            { target: { type: 'ContextPitchTarget', pitch: { nominal: { value: 'K' } } } },
          ],
        },
      ],
    })
    expect(() => parse('MOS{5L2s} J^5')).toThrow(/Expected/)
    expect(() => parse('MOS{5L2s} JJ^5')).toThrow(/Expected/)
    expect(() => parse('MOS{5L2s} KZ^5')).toThrow(/Expected/)
    expect(() => parse('MOS{5L2s} ZZ^5')).toThrow(/Expected/)
  })
})

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
{${'`'}A as root}
{41edo}
|:@x10
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
  it('parses monzo vectors and optional subgroups', () => {
    expect(parse('[-4 4 -1>@').body[0]).toMatchObject({
      type: 'MonzoLiteral',
      components: ['-4', '4', '-1'],
      subgroup: [],
      continuation: true,
    })
    expect(parse('[1 -2 0 -2>@101.2..').body[0]).toMatchObject({
      type: 'MonzoLiteral',
      subgroup: ['101', '2'],
      continuation: true,
    })
    expect(parse('[2, -1>@').body[0]).toMatchObject({
      type: 'MonzoLiteral',
      components: ['2', '-1'],
    })
  })

  it('accepts optional commas between mapping components', () => {
    const change = parse('{map = <1222c, 1999c]}').body[0] as SyntaxNode
    const mapping = (change.statements as SyntaxNode[])[0]!.value as SyntaxNode

    expect(mapping).toMatchObject({
      type: 'MappingLiteral',
      values: [
        { type: 'QuantityLiteral', magnitude: '1222', unit: 'c' },
        { type: 'QuantityLiteral', magnitude: '1999', unit: 'c' },
      ],
      closingDelimiter: ']',
    })
  })
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

  it('starts new notes immediately after attached continues', () => {
    const compact = parse('0.2.3...3=2=0==.').body[0] as SyntaxNode
    const spaced = parse('0 . 2 . 3 ... 3= 2= 0== .').body[0] as SyntaxNode
    const summarize = (sequence: SyntaxNode) =>
      (sequence.items as SyntaxNode[]).map((item) => ({
        type: item.type,
        raw: item.raw,
        degree: item.degree,
        expression: (item.expression as SyntaxNode | undefined)?.degree,
        continues: (item.marks as SyntaxNode[] | undefined)?.length,
      }))

    expect(summarize(compact)).toEqual(summarize(spaced))
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
    ['{Pythagorean}C', ['PitchContextChange', 'PitchLiteral']],
    ['{JustIntonation}C', ['PitchContextChange', 'PitchLiteral']],
    ['{JI}C', ['PitchContextChange', 'PitchLiteral']],
    ['{Untempered}C', ['PitchContextChange', 'PitchLiteral']],
    ['[C D]E', ['NormalizeToSlot', 'PitchLiteral']],
    ['(C D)E', ['Group', 'PitchLiteral']],
    ['C[D E]F', ['PitchLiteral', 'NormalizeToSlot', 'PitchLiteral']],
    ['C{13edo}D', ['PitchLiteral', 'PitchContextChange', 'PitchLiteral']],
  ])('does not require whitespace around structural notation in %s', (source, types) => {
    const items = (parse(source).body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual(types)
  })

  it('distinguishes attached FJS inflections and unary pitch operators', () => {
    const program = parse("E^5 Ebv5 P1v5 Cv5 E_ /'C '/C vDb C#")
    const items = (program.body as SyntaxNode[])[0].items as SyntaxNode[]

    expect(items.map((item) => item.type)).toEqual([
      'PitchLiteral',
      'PitchLiteral',
      'IntervalLiteral',
      'PitchLiteral',
      'PitchLiteral',
      'PitchModifierExpression',
      'PitchModifierExpression',
      'PitchModifierExpression',
      'PitchLiteral',
    ])
    expect(items.slice(0, 5).map((item) => item.raw)).toEqual(['E^5', 'Ebv5', 'P1v5', 'Cv5', 'E_'])
    expect(items.slice(5, 8).map((item) => item.type)).toEqual([
      'PitchModifierExpression',
      'PitchModifierExpression',
      'PitchModifierExpression',
    ])
    expect((items[4].accidentals as SyntaxNode[]).map((accidental) => accidental.value)).toEqual([
      '_',
    ])
    expect(parse('E_5').body[0]).toMatchObject({ type: 'Identifier', name: 'E_5' })
  })

  it('parses ASCII and Unicode naturals on Diamond-MOS pitches', () => {
    const program = parse('MOS{5L2s} J_ K♮')
    const items = ((program.body as SyntaxNode[])[0].items as SyntaxNode[]).slice(1)

    expect(items.map((item) => item.raw)).toEqual(['J_', 'K♮'])
    expect(
      items.map((item) => (item.accidentals as SyntaxNode[]).map((accidental) => accidental.value)),
    ).toEqual([['_'], ['♮']])
  })

  it('keeps parallel branches and repeats as syntax-tree nodes', () => {
    const program = parse('C D,\nE F G,\nA B . ||\n|:@x10 [C, E, G] :|')
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

    expect(expression.type).toBe('PitchModifierExpression')
    expect(expression.modifier).toMatchObject({ kind: 'doubleEquaveUp', raw: '"' })
    expect((expression.operand as SyntaxNode).type).toBe('DegreeLiteral')
    expect((expression.operand as SyntaxNode).degree).toBe('-2')
  })

  it('admits equave shifts with ratios', () => {
    const expression = parse('"3/2').body[0]

    expect(expression.type).toBe('PitchModifierExpression')
    expect(expression.modifier).toMatchObject({ kind: 'doubleEquaveUp', raw: '"' })
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

  it('parses a hold within a pitch modifier expression', () => {
    expect(parse("'a=").body[0]).toMatchObject({
      type: 'PitchModifierExpression',
      modifier: { kind: 'equaveUp' },
      operand: {
        type: 'PostfixExpression',
        expression: { type: 'PitchLiteral', nominal: { value: 'a' } },
        marks: [{ type: 'DetachedContinue', raw: '=' }],
      },
    })
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

  it('represents pitch syntax as structured modifier expressions', () => {
    const program = parse("^M2 'P4")
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items).toMatchObject([
      {
        type: 'PitchModifierExpression',
        modifier: { kind: 'up' },
        operand: { type: 'IntervalLiteral', quality: 'M' },
      },
      {
        type: 'PitchModifierExpression',
        modifier: { kind: 'equaveUp' },
        operand: { type: 'IntervalLiteral', quality: 'P' },
      },
    ])
  })

  it('preserves identifiers beginning with v', () => {
    expect(parse('@test(value, vfoo)').body[0]).toMatchObject({
      arguments: [
        { type: 'Identifier', name: 'value' },
        { type: 'Identifier', name: 'vfoo' },
      ],
    })
    expect(parse('vC').body[0]).toMatchObject({
      type: 'PitchModifierExpression',
      modifier: { kind: 'down' },
      operand: { type: 'PitchLiteral', raw: 'C' },
    })
  })

  it('reserves v followed by digits for down-shifted scale degrees', () => {
    expect(parse('v2').body[0]).toMatchObject({
      type: 'PitchModifierExpression',
      modifier: { kind: 'down' },
      operand: { type: 'DegreeLiteral', degree: '2' },
    })
  })

  it('prioritizes attached musical inflections over spaced division', () => {
    const program = parse(String.raw`{^ = 1\24; / = 5\25}
0 ^0 1 v2 2 /0`)
    const items = (program.body[0] as SyntaxNode).items as SyntaxNode[]

    expect(items.slice(1).map((item) => item.type)).toEqual([
      'DegreeLiteral',
      'PitchModifierExpression',
      'DegreeLiteral',
      'PitchModifierExpression',
      'DegreeLiteral',
      'PitchModifierExpression',
    ])
    expect(items.slice(2).filter((item) => item.type === 'PitchModifierExpression')).toMatchObject([
      { modifier: { kind: 'up' }, operand: { type: 'DegreeLiteral', degree: '0' } },
      { modifier: { kind: 'down' }, operand: { type: 'DegreeLiteral', degree: '2' } },
      { modifier: { kind: 'lift' }, operand: { type: 'DegreeLiteral', degree: '0' } },
    ])
  })

  it('sequences a pitch with an attached up modifier instead of treating it as power', () => {
    const expression = parse('C ^D').body[0]
    const items = expression.items as SyntaxNode[]

    expect(expression.type).toBe('Sequence')
    expect(items).toMatchObject([
      { type: 'PitchLiteral' },
      {
        type: 'PitchModifierExpression',
        modifier: { kind: 'up' },
        operand: { type: 'PitchLiteral', raw: 'D' },
      },
    ])
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
