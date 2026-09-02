import { describe, expect, it } from 'vitest'
import { highlightXenpaper } from '../xenpaperSyntaxHighlight'
import { parse } from '../../xenpaper-lang'

describe('highlightXenpaper', () => {
  it('highlights every configured drum sample consistently', () => {
    const tokens = highlightXenpaper(parse('[bd,hh hh]', { drumSamples: ['bd', 'hh'] }))

    expect(tokens.filter(({ kind }) => kind === 'identifier').map(({ text }) => text)).toEqual([
      'bd',
      'hh',
      'hh',
    ])
    expect(tokens.some(({ kind }) => kind.startsWith('pitch'))).toBe(false)
  })

  it('returns lossless, contiguous source ranges', () => {
    const source = 'MOS {5L 2s} || # comment\n@tempo(120) C D^ 3/2'
    const tokens = highlightXenpaper(parse(source))

    expect(tokens.map(({ text }) => text).join('')).toBe(source)
    expect(tokens[0]).toMatchObject({ kind: 'mos-declaration', text: 'MOS', start: 0, end: 3 })
    expect(tokens.every((token, index) => !index || token.start === tokens[index - 1]!.end)).toBe(
      true,
    )
    expect(tokens).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'comment' })]))
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'mos-declaration', nodeType: 'MosDeclaration' }),
      ]),
    )
  })

  it('uses semantic kinds for rests, ratios, pitch systems, and repeat ending contents', () => {
    const source = '|: 0 . |¹ 3/2 A Α :|² 7 ||'
    const tokens = highlightXenpaper(parse(source))

    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'rest', text: '.' }),
        expect.objectContaining({ kind: 'ratio', text: '3/2' }),
        expect.objectContaining({ kind: 'pitch-latin', text: 'A' }),
        expect.objectContaining({ kind: 'pitch-greek', text: 'Α' }),
        expect.objectContaining({ kind: 'pitch', text: '7' }),
      ]),
    )
  })

  it('distinguishes a MOS declaration, its patterns, and UDP modes', () => {
    const tokens = highlightXenpaper(parse('MOS {5L 2s 1|3}'))

    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'mos-declaration', text: 'MOS' }),
        expect.objectContaining({ kind: 'mos-pattern', nodeType: 'MosPatternCounts' }),
        expect.objectContaining({ kind: 'mos-udp', nodeType: 'MosUdp' }),
      ]),
    )
  })

  it('highlights integer ratios according to their parsed expression context', () => {
    const tokens = highlightXenpaper(parse('4::7 5\\13<3> 5\\13<3/2>'))

    expect(tokens.filter(({ kind }) => kind === 'ratio').map(({ text }) => text)).toEqual([
      '4',
      '7',
      '3',
      '3/2',
    ])
  })

  it('gives MOS hardness a dedicated highlight kind', () => {
    const tokens = highlightXenpaper(parse('MOS{2L 5s 3:2}'))

    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'mos-hardness', text: '3:2', nodeType: 'MosHardness' }),
      ]),
    )
  })

  it('gives comments precedence over enclosing expressions', () => {
    const tokens = highlightXenpaper(parse('@foo(1 + # note\n2)'))

    expect(tokens).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'comment', text: '# note' })]),
    )
  })

  it('highlights structured pitch modifiers as operators', () => {
    const tokens = highlightXenpaper(parse("'C vK /2"))

    expect(
      tokens
        .filter(({ nodeType }) => nodeType === 'PitchModifier')
        .map(({ kind, text }) => ({ kind, text })),
    ).toEqual([
      { kind: 'operator', text: "'" },
      { kind: 'operator', text: 'v' },
      { kind: 'operator', text: '/' },
    ])
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'pitch-latin', text: 'C' }),
        expect.objectContaining({ kind: 'pitch-mos', text: 'K' }),
        expect.objectContaining({ kind: 'pitch', text: '2' }),
      ]),
    )
  })
})
