import { describe, expect, it } from 'vitest'
import { highlightXenpaper } from '../xenpaperSyntaxHighlight'
import { parse } from '../../xenpaper-lang'

describe('highlightXenpaper', () => {
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

  it('gives comments precedence over enclosing expressions', () => {
    const tokens = highlightXenpaper(parse('@foo(1 + # note\n2)'))

    expect(tokens).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'comment', text: '# note' })]),
    )
  })
})
