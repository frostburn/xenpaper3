import { describe, expect, it } from 'vitest'
import { highlightXenpaper } from '../xenpaperSyntaxHighlight'
import { parse } from '../../xenpaper-lang'

describe('highlightXenpaper', () => {
  it('returns lossless, contiguous source ranges', () => {
    const source = 'MOS {5L 2s} || # comment\n@tempo(120) C D^ 3/2'
    const tokens = highlightXenpaper(parse(source))

    expect(tokens.map(({ text }) => text).join('')).toBe(source)
    expect(tokens[0]).toMatchObject({ kind: 'keyword', text: 'MOS', start: 0, end: 3 })
    expect(tokens.every((token, index) => !index || token.start === tokens[index - 1]!.end)).toBe(
      true,
    )
    expect(tokens).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'comment' })]))
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'keyword', nodeType: 'MosDeclaration' }),
      ]),
    )
  })
})
