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

const audibleResult = (source: string) => {
  const result = score(source)
  return {
    duration: result.duration.toFraction(),
    events: result.events
      .filter((event) => event.kind !== 'marker')
      .map((event) => ({
        kind: event.kind,
        start: event.start.toFraction(),
        duration: event.duration.toFraction(),
        pitch: [event.pitch.kind, event.pitch.value.valueOf()],
        ...('label' in event ? { label: event.label } : {}),
        ...('dynamic' in event ? { dynamic: event.dynamic.toFraction() } : {}),
      })),
  }
}

describe('beat event expansion', () => {
  it('compares the sounding value of root-relative absolute pitches', () => {
    expect(audibleResult('C')).not.toEqual(audibleResult('{root = D} C'))
  })

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
    const result = score('|:@x2 C, E G :|')
    const notes = result.events.filter((event) => event.kind === 'note')

    expect(notes.map((note) => note.start.toFraction())).toEqual(['0', '0', '1', '2', '2', '3'])
    expect(result.duration.equals(new Fraction(4))).toBe(true)
  })

  it.each([
    ['@2', '1/2'],
    ['@.', '1/2'],
  ])('expands repeated %s directives exactly like authored copies', (directive, duration) => {
    const repeated = score(`|: C D E F ${directive} G :|`)
    const expanded = score(`C D E F ${directive} G C D E F ${directive} G`)
    const timing = (result: ReturnType<typeof score>) =>
      result.events
        .filter((event) => event.kind === 'note')
        .map((event) => [event.start.toFraction(), event.duration.toFraction()])

    expect(timing(repeated)).toEqual(timing(expanded))
    expect(timing(repeated).at(-1)?.[1]).toBe(duration)
  })

  it.each([
    ['plain notes', '', 'C D E', 'F'],
    ['rests and continuations', 'A', 'C= . D', 'E'],
    ['normalized slots', '', '[C D] E', 'F'],
    ['explicit groups', 'A', '(C D) E', 'F'],
    ['parallel groups', '', '(C, E G) D', 'F'],
    ['subdivision changes', '@3', 'C @2 D E', 'F'],
    ['articulation shorthand', '', 'C D E F @. G', 'A'],
    ['dynamics', '@p', 'C @ff D', 'E'],
    ['pitch-context changes', '', '{root = D} C E', 'G'],
    ['hard boundaries', 'A', 'C || D E', 'F'],
    ['nested repeats', '', 'C |:@x2 D :| E', 'F'],
  ])('matches authored copies for %s', (_description, prefix, repeatedBody, suffix) => {
    const repeated = `${prefix} |: ${repeatedBody} :| ${suffix}`
    const authored = `${prefix} ${repeatedBody} ${repeatedBody} ${suffix}`

    expect(audibleResult(repeated)).toEqual(audibleResult(authored))
  })

  it('matches authored copies across repeat counts and surrounding state', () => {
    const bodies = [
      'C D',
      'C= . D',
      '[C D] E',
      '(C, E G) D',
      'C @2 D',
      'C D E F @. G',
      '@p C @ff D',
      '{root = D} C E',
      'C || D',
      'C |:@x2 D :| E',
    ]
    const surroundings = [
      ['', ''],
      ['A', 'F'],
      ['@3 A', 'F'],
      ['@p A', '@ff F'],
      ['{root = E} A', 'F'],
    ]

    for (const body of bodies) {
      for (const [prefix, suffix] of surroundings) {
        for (const count of [1, 2, 3]) {
          const repeated = `${prefix} |:@x${count} ${body} :| ${suffix}`
          const copies = Array.from({ length: count }, () => body).join(' ')
          const authored = `${prefix} ${copies} ${suffix}`

          expect(audibleResult(repeated)).toEqual(audibleResult(authored))
        }
      }
    }
  })

  it.each([
    ['alternate endings', '|: C @2 D |¹ E :|² F ||', 'C @2 D E C @2 D F ||'],
    ['stateful endings', '|: @p C |¹ @ff D :|² E ||', '@p C @ff D @p C E ||'],
    ['nested ending body', '|: C |¹ |: D :| :|² E ||', 'C D D C E ||'],
    ['implicit repeat', 'C @2 D :| E', '|: C @2 D :| E'],
    ['chained implicit repeats', 'C :| D :|', 'C C D C C D'],
  ])('matches the authored expansion for %s', (_description, repeated, authored) => {
    expect(audibleResult(repeated)).toEqual(audibleResult(authored))
  })

  it('carries directives from a common repeat body into alternate endings', () => {
    const result = score('|: @p C |@^1 D :|@^2 E ||')

    expect(
      result.events
        .filter((event) => event.kind === 'note')
        .map((event) => event.dynamic.toFraction()),
    ).toEqual(['3/10', '3/10', '3/10', '3/10'])
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
