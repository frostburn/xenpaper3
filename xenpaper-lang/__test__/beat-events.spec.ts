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
  it('scales every note when a normalized slot is continued', () => {
    const result = score('[0 2 7] [0 2 7]= [0 2 7]===')
    const notes = result.events.filter((event) => event.kind === 'note')

    expect(result.duration.valueOf()).toBe(7)
    expect(notes.map((note) => note.start.valueOf())).toEqual([
      0,
      1 / 3,
      2 / 3,
      1,
      5 / 3,
      7 / 3,
      3,
      13 / 3,
      17 / 3,
    ])
    expect(notes.map((note) => note.duration.valueOf())).toEqual([
      1 / 3,
      1 / 3,
      1 / 3,
      2 / 3,
      2 / 3,
      2 / 3,
      4 / 3,
      4 / 3,
      4 / 3,
    ])
    expect(notes.map((note) => note.start.add(note.duration).valueOf())).toEqual([
      1 / 3,
      2 / 3,
      1,
      5 / 3,
      7 / 3,
      3,
      13 / 3,
      17 / 3,
      7,
    ])
  })

  it('distributes a continuation over every note of an uneven parallel', () => {
    const result = score('(C, D E) =')
    const notes = result.events.filter((event) => event.kind === 'note')

    expect(notes.map((note) => note.duration.valueOf())).toEqual([2, 2, 2])
  })

  it('retains authored ratio labels for static renderers', () => {
    const result = score('3/2')
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ kind: 'note', label: '3/2' })
  })

  it('retains exact offsets through tuplets and extends attached continuations', () => {
    const result = score('[C D E] F=')
    const notes = result.events.filter((event) => event.kind === 'note')

    expect(notes.map((note) => note.start.toFraction())).toEqual(['0', '1/3', '2/3', '1'])
    expect(notes.map((note) => note.duration.toFraction())).toEqual(['1/3', '1/3', '1/3', '2'])
    expect(result.duration.equals(3)).toBe(true)
    expect(notes[3]!.origins.map((origin) => origin.role)).toEqual(['literal', 'duration'])
  })

  it('rejects a continuation without an active note', () => {
    const result = expandToBeatEvents(parse('= C'))

    expect(result.diagnostics).toMatchObject([
      {
        code: 'XP_CONTINUE_WITHOUT_ATTACK',
        severity: 'error',
        locations: [{ start: { offset: 0 }, end: { offset: 1 } }],
      },
    ])
    expect('score' in result).toBe(false)
  })

  it('clears the active note at a rest before resolving continuations', () => {
    const result = expandToBeatEvents(parse('C . = D'))

    expect(result.diagnostics).toMatchObject([{ code: 'XP_CONTINUE_WITHOUT_ATTACK' }])
    expect('score' in result).toBe(false)
  })

  it('expands repeats and preserves simultaneous branch timing', () => {
    const result = score('|:(x2) C, E G :|')
    const notes = result.events.filter((event) => event.kind === 'note')

    expect(notes.map((note) => note.start.toFraction())).toEqual(['0', '0', '1', '2', '2', '3'])
    expect(result.duration.equals(new Fraction(4))).toBe(true)
  })

  it('incorporates prevailing dynamics into a single effective dynamic field', () => {
    const notes = score('C @ff D E').events.filter((event) => event.kind === 'note')

    expect(notes.map(({ dynamic }) => dynamic.toFraction())).toEqual(['1/2', '41/50', '41/50'])
  })

  it('incorporates a one-shot velocity into the same effective dynamic field', () => {
    const notes = score('@p C @velocity(4/5) D E').events.filter((event) => event.kind === 'note')

    expect(notes.map(({ dynamic }) => dynamic.toFraction())).toEqual(['3/10', '4/5', '3/10'])
  })
})
