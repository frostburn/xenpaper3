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
    'let note <- D\nnote E=',
    '(C=, E G)',
    '~4::6',
    '~4:5:6',
    "'(4::6)",
  ])('evaluates %s uniformly inline, in a binding, and in a return', (phrase) => {
    const expected = music(`(${phrase})`)
    expect(music(`let phrase <- (${phrase})\nphrase`)).toEqual(expected)
    expect(music(`fn phrase() { ret (${phrase}) } phrase()`)).toEqual(expected)
    expect(music(`fn identity(value) { ret value } identity((${phrase}))`)).toEqual(expected)
    expect(music(`fn make() { ret (${phrase}) } let phrase <- make()\nphrase`)).toEqual(expected)
  })

  it('keeps timing local to a stored group and uses the playback pulse otherwise', () => {
    expect(music('let phrase <- (@4 C D=)\n@2 phrase E')).toEqual(music('@2 (@4 C D=) E'))
    expect(music('let phrase <- (C D=)\n@2 phrase @4 phrase')).toEqual(music('@2 (C D=) @4 (C D=)'))
  })

  it('captures the declaration pitch context and lexical bindings', () => {
    expect(
      music('let note <- D let phrase <- (note E=) let note <- F\n{root <- G} phrase'),
    ).toEqual(music('{root <- G} (D E=)'))
  })

  it.each(['phrase + 2d', '2d + phrase', 'phrase - 2d'])(
    'broadcasts arithmetic over %s',
    (operation) => {
      const expression = operation.replace('phrase', '(C D=)')
      expect(music(`let phrase <- (C D=)\n${operation}`)).toEqual(music(expression))
    },
  )

  it('returns a phrase selected by a conditional', () => {
    expect(music('let phrase <- ((C D=) if true else (E F=))\nphrase')).toEqual(music('(C D=)'))
  })

  it('retains semantic errors instead of swallowing them when a phrase is played', () => {
    const result = expandToBeatEvents(parse('let phrase <- (missing C=)\nphrase'))
    expect(result).not.toHaveProperty('score')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'XP_UNDEFINED_NAME' }),
    )
  })
  it.each(['3/2', '[C D]', '(C D=)'])(
    'short-circuits a defined %s before its fallback',
    (chosen) => {
      expect(music(`let chosen <- ${chosen} al [C D]\nchosen`)).toEqual(music(chosen))
      expect(music(`let chosen <- ${chosen} al (@unsupported C)\nchosen`)).toEqual(music(chosen))
      expect(music(`let chosen <- ${chosen} al 1::100000\nchosen`)).toEqual(music(chosen))
    },
  )

  it('uses a coalescing fallback only when the left value is missing', () => {
    expect(music('let chosen <- niente al [C D]\nchosen')).toEqual(music('[C D]'))
    expect(music('let chosen <- niente al (@4 C D=)\nchosen')).toEqual(music('(@4 C D=)'))
  })

  it.each(["'", '-'])('applies %s to a stored musical operand', (operator) => {
    expect(music(`let phrase <- (1d 2d=)\n${operator}phrase`)).toEqual(music(`${operator}(1d 2d=)`))
  })

  it('diagnoses an unsupported unary musical operand without recursing', () => {
    const result = expandToBeatEvents(parse('fn invalid() { ret ~(.) } invalid()'))
    expect(result).not.toHaveProperty('score')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'XP_TYPE_MISMATCH',
        message: 'The operand does not support musical arithmetic.',
      }),
    )
  })

  it('projects a tempered enumerated chord returned without parentheses', () => {
    const result = music('fn chord() { ret ~4::6 } chord()')
    expect(result.notes).toHaveLength(3)
    expect(result.duration).toBe('1')
    expect(result).toEqual(music('~4::6'))
  })
})
