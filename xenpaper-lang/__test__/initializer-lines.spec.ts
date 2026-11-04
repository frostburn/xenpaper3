import { describe, expect, it } from 'vitest'
import { parse, expandToBeatEvents } from '../index'

function notes(source: string) {
  const result = expandToBeatEvents(parse(source))
  expect(result.diagnostics).toEqual([])
  if (!result.score) throw new Error('Expected a score')
  return result.score.events
    .filter((event) => event.kind === 'note')
    .map((event) => [
      event.start.toFraction(),
      event.duration.toFraction(),
      event.pitch.value.valueOf(),
    ])
}

describe('line-terminated let initializers', () => {
  it.each(['\n', '\r\n', '\r'])('ends the initializer at %j', (newline) => {
    expect(notes(`let licc <- @4 D E F G E= C D==${newline}licc`)).toEqual(
      notes('(@4 D E F G E= C D==)'),
    )
  })

  it('includes the whole same-line sequence in the binding', () => {
    const program = parse('let note <- D note E=')
    expect(program.body[0]).toMatchObject({
      type: 'VariableDeclaration',
      value: {
        type: 'Sequence',
        items: [
          { type: 'PitchLiteral' },
          { type: 'Identifier', name: 'note' },
          { type: 'PostfixExpression' },
        ],
      },
    })
    expect(notes('let note <- D\nnote E=')).toEqual(notes('D E='))
  })

  it('allows multiline parenthesized initializers and nested bindings', () => {
    expect(notes('let phrase <- (\n let note <- D\n note\n E=\n)\nphrase')).toEqual(notes('(D E=)'))
    expect(notes('let phrase <- [C\nD]\nphrase')).toEqual(notes('[C D]'))
  })

  it('keeps newlines insignificant in ordinary music and nested arithmetic', () => {
    expect(notes('C\nD')).toEqual(notes('C D'))
    expect(notes('let interval <- (3/2 +\n 1/2)\ninterval')).toEqual(notes('3/2 + 1/2'))
    expect(notes('let interval <- sqrt(\n4/1\n)\ninterval')).toEqual(notes('2/1'))
  })

  it('does not consume an operator on the following line', () => {
    expect(notes('let note <- 2d\n+3d note')).toEqual(notes('+3d 2d'))
    expect(() => parse('let interval <- 3/2 +\n1/2')).toThrow(/Expected/)
    expect(() => parse('let interval <-\n3/2')).toThrow(/Expected/)
  })

  it('handles comments and preserves double-bar boundaries', () => {
    expect(notes('let note <- C# # a note\nnote')).toEqual(notes('C#'))
    expect(notes('let note <- C || note')).toEqual(notes('C'))
    expect(notes('let phrase <- (C # comment with ) [\nD)\nphrase')).toEqual(notes('(C D)'))
  })

  it('keeps declarations and ret as same-line statement boundaries', () => {
    expect(notes('fn phrase() { let note <- D ret note E= } phrase()')).toEqual(notes('D E='))
    expect(notes('let first <- D let second <- E\nfirst second')).toEqual(notes('D E'))
  })
})
