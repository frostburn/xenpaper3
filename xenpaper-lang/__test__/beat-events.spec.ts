import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { parse } from '../parser.generated.js'
import { expandToBeatEvents } from '../runtime/beat-events'

const score = (source: string) => {
  const result = expandToBeatEvents(parse(source))
  expect(result.diagnostics).toEqual([])
  if (!('score' in result)) throw new Error('Expected a beat-timed score.')
  return result.score
}

describe('beat event expansion', () => {
  it('retains exact offsets through tuplets and extends attached continuations', () => {
    const result = score('[C D E] F=')
    const notes = result.events.filter((event) => event.kind === 'note')

    expect(notes.map((note) => note.start.toFraction())).toEqual(['0', '1/3', '2/3', '1'])
    expect(notes.map((note) => note.duration.toFraction())).toEqual(['1/3', '1/3', '1/3', '2'])
    expect(result.duration.equals(3)).toBe(true)
    expect(notes[3]!.origins.map((origin) => origin.role)).toEqual(['literal', 'duration'])
  })

  it('diagnoses a continuation without an active note while retaining exact timing', () => {
    const result = expandToBeatEvents(parse('= C'))

    expect(result.diagnostics).toMatchObject([
      {
        code: 'XP_CONTINUE_WITHOUT_ATTACK',
        severity: 'error',
        locations: [{ start: { offset: 0 }, end: { offset: 1 } }],
      },
    ])
    if (!('score' in result)) throw new Error('Expected a beat-timed score.')
    const note = result.score.events.find((event) => event.kind === 'note')
    expect(note?.start.equals(1)).toBe(true)
  })

  it('clears the active note at a rest before resolving continuations', () => {
    const result = expandToBeatEvents(parse('C . = D'))

    expect(result.diagnostics).toMatchObject([{ code: 'XP_CONTINUE_WITHOUT_ATTACK' }])
    if (!('score' in result)) throw new Error('Expected a beat-timed score.')
    const notes = result.score.events.filter((event) => event.kind === 'note')
    expect(notes.map((note) => note.start.toFraction())).toEqual(['0', '3'])
    expect(notes[0]!.duration.equals(1)).toBe(true)
  })

  it('expands repeats and preserves simultaneous branch timing', () => {
    const result = score('|:(x2) C, E G :|')
    const notes = result.events.filter((event) => event.kind === 'note')

    expect(notes.map((note) => note.start.toFraction())).toEqual(['0', '0', '1', '2', '2', '3'])
    expect(result.duration.equals(new Fraction(4))).toBe(true)
  })
})
