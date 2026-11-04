import { describe, expect, it } from 'vitest'
import { parse, expandToBeatEvents } from '../index'

function music(source: string) {
  const result = expandToBeatEvents(parse(source))
  expect(result.diagnostics).toEqual([])
  if (!result.score) throw new Error('Expected a score')
  return {
    duration: result.score.duration.toFraction(),
    notes: result.score.events
      .filter((event) => event.kind === 'note')
      .map((event) => ({
        start: event.start.toFraction(),
        duration: event.duration.toFraction(),
        pitch: event.pitch.value.valueOf(),
        velocity: event.dynamic.toFraction(),
      })),
  }
}

describe('first-class musical values', () => {
  it.each([
    '@4 D E F G E= C D==',
    'C . D==',
    '[C D E]==',
    'C -> C=',
    '|: C D= :|',
    '@p C @f D',
    '{root <- D} C E',
    'let note <- D note E=',
    '(C=, E G)',
  ])('evaluates %s uniformly inline, in a binding, and in a return', (phrase) => {
    const expected = music(`(${phrase})`)
    expect(music(`let phrase <- (${phrase}) phrase`)).toEqual(expected)
    expect(music(`fn phrase() { ret (${phrase}) } phrase()`)).toEqual(expected)
    expect(music(`fn identity(value) { ret value } identity((${phrase}))`)).toEqual(expected)
    expect(music(`fn make() { ret (${phrase}) } let phrase <- make() phrase`)).toEqual(expected)
  })

  it('keeps timing local to a stored group and uses the playback pulse otherwise', () => {
    expect(music('let phrase <- (@4 C D=) @2 phrase E')).toEqual(music('@2 (@4 C D=) E'))
    expect(music('let phrase <- (C D=) @2 phrase @4 phrase')).toEqual(music('@2 (C D=) @4 (C D=)'))
  })

  it('captures the declaration pitch context and lexical bindings', () => {
    expect(music('let note <- D let phrase <- (note E=) let note <- F {root <- G} phrase')).toEqual(
      music('{root <- G} (D E=)'),
    )
  })

  it.each(['phrase + 2d', '2d + phrase', 'phrase - 2d'])(
    'broadcasts arithmetic over %s',
    (operation) => {
      const expression = operation.replace('phrase', '(C D=)')
      expect(music(`let phrase <- (C D=) ${operation}`)).toEqual(music(expression))
    },
  )

  it('returns a phrase selected by a conditional', () => {
    expect(music('let phrase <- ((C D=) if true else (E F=)) phrase')).toEqual(music('(C D=)'))
  })

  it('retains semantic errors instead of swallowing them when a phrase is played', () => {
    const result = expandToBeatEvents(parse('let phrase <- (missing C=) phrase'))
    expect(result).not.toHaveProperty('score')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'XP_UNDEFINED_NAME' }),
    )
  })
})
