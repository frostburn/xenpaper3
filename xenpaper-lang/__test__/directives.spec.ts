import { describe, expect, it } from 'vitest'
import { parse } from '../parser.generated.js'
import { expandToBeatEvents } from '../runtime/beat-events'
import type { BeatTimedNoteEvent } from '../runtime/types'

const compile = (source: string) => expandToBeatEvents(parse(source))
const notes = (source: string) => {
  const result = compile(source)
  expect(result.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([])
  if (!('score' in result)) throw new Error('Expected score.')
  return result.score.events.filter((event): event is BeatTimedNoteEvent => event.kind === 'note')
}

describe('directive runtime', () => {
  it('shortens sounding notes without changing their rhythmic spacing', () => {
    const result = compile('@art(50%) 0 1 2 3')
    if (!('score' in result)) throw new Error('Expected score.')
    const events = result.score.events.filter(
      (event): event is BeatTimedNoteEvent => event.kind === 'note',
    )
    expect(events.map(({ start }) => start.valueOf())).toEqual([0, 1, 2, 3])
    expect(events.map(({ duration }) => duration.valueOf())).toEqual([0.5, 0.5, 0.5, 0.5])
    expect(result.score.duration.valueOf()).toBe(4)
  })

  it.each([
    ["@'", 0.25],
    ['@staccatissimo', 0.25],
    ['@.', 0.5],
    ['@staccato', 0.5],
    ['@:', 0.85],
    ['@portato', 0.85],
    ['@-', 1],
    ['@tenuto', 1],
    ['@_', 1.1],
    ['@legato', 1.1],
  ])('resolves articulation %s', (directive, duration) => {
    expect(notes(`${directive} C`)[0]!.duration.valueOf()).toBe(duration)
  })

  it.each([
    ['M2 + [@. P1 M2 P5]', ['1/3', '1/3', '1/3']],
    ['(@. M2) + [P1 M2 P5]', ['1/3', '1/3', '1/3']],
    ['(@art(50%) M2) + [P1 M2 P5]', ['1/3', '1/3', '1/3']],
    ['(@_ M2) + [P1 M2 P5]', ['11/30', '11/30', '11/30']],
  ])('max-coalesces articulation while broadcasting: %s', (source, durations) => {
    expect(notes(source).map((note) => note.duration.toFraction())).toEqual(durations)
  })

  it('broadcasts a continued scalar using maximum note duration', () => {
    const events = notes('(M2=) + [P1 M2 P5]')
    const explicit = notes('M2 + ([P1 M2 P5]=)')
    expect(events.map((note) => [note.start.toFraction(), note.duration.toFraction()])).toEqual(
      explicit.map((note) => [note.start.toFraction(), note.duration.toFraction()]),
    )
  })

  it('max-coalesces continuations on both sides of broadcasting', () => {
    const events = notes('(M2=) + [P1= M2== P5]')
    expect(events.map((note) => note.duration.toFraction())).toEqual(['2/3', '1', '1/3'])
  })

  it('steals time for a grace cluster', () => {
    const events = notes('@4?? B c# c=')
    expect(events.map((event) => event.duration.valueOf())).toEqual([0.25, 0.25, 1.5])
  })

  it('can resize a zero-duration grace attack without division', () => {
    expect(notes('@4? C? D').map((event) => event.duration.valueOf())).toEqual([0.25, 0.75])
  })

  it('resolves dynamics and consumes velocity once', () => {
    const events = notes('@p C @velocity(80%) D E')
    expect(events.map(({ dynamic }) => dynamic.valueOf())).toEqual([0.3, 0.8, 0.3])
  })

  it('keeps dynamics as zero-duration events at their authored offsets', () => {
    const result = compile('@ff . C')
    if (!('score' in result)) throw new Error('Expected score.')
    expect(result.score.events).toContainEqual(
      expect.objectContaining({ kind: 'marker', marker: 'dynamic', label: 'ff' }),
    )
    const dynamic = result.score.events.find(
      (event) => event.kind === 'marker' && event.marker === 'dynamic',
    )
    expect(dynamic?.start.valueOf()).toBe(0)
  })

  it('isolates dynamic state in lexical groups', () => {
    expect(notes('@p C (@f D) E').map(({ dynamic }) => dynamic.toFraction())).toEqual([
      '3/10',
      '13/20',
      '3/10',
    ])
  })

  it('matches scalar and parallel gliss shapes after tail elimination', () => {
    const scalar = notes('@gliss(linear) F= C?')
    expect(scalar).toHaveLength(1)
    expect(scalar[0]!.automation?.curve).toBe('linear')
    expect(scalar[0]!.automation?.duration.valueOf()).toBe(2)
    const parallel = notes('@gliss [F, C]= [E, D]?')
    expect(parallel).toHaveLength(2)
    expect(parallel.every(({ automation }) => automation?.curve === 'linear')).toBe(true)
  })

  it('keeps gliss automation separate from a continued normalized target', () => {
    const events = notes('@gliss [C D E]= [D E F]')

    expect(events.map((event) => event.duration.valueOf())).toEqual([1, 1, 1])
    expect(events.map((event) => event.automation?.duration.toFraction())).toEqual([
      '2/3',
      '2/3',
      '2/3',
    ])
  })

  it('holds a duration-bearing gliss target and rejects mismatched trees', () => {
    const held = notes('@gliss F= C')
    expect(held).toHaveLength(1)
    expect(held[0]!.duration.valueOf()).toBe(3)
    const mismatch = compile('@gliss (F C)= [E, D]?')
    expect(mismatch.diagnostics).toContainEqual(expect.objectContaining({ code: 'XP_GLISS_SHAPE' }))
  })

  it('keeps the glide duration separate from a held target', () => {
    const targetHold = notes('@gliss C G')
    const continuedTargetHold = notes('@gliss C G =')
    const extendedGlide = notes('@gliss C= G?')

    expect(targetHold[0]!.duration.valueOf()).toBe(2)
    expect(targetHold[0]!.automation?.duration.valueOf()).toBe(1)
    expect(continuedTargetHold[0]!.duration.valueOf()).toBe(3)
    expect(continuedTargetHold[0]!.automation?.duration.valueOf()).toBe(1)
    expect(extendedGlide[0]!.duration.valueOf()).toBe(2)
    expect(extendedGlide[0]!.automation?.duration.valueOf()).toBe(2)
  })

  it('trims composite tails without rescaling earlier notes', () => {
    expect(notes('(C D)?').map((event) => event.duration.valueOf())).toEqual([1, 0])
  })

  it('warns and preserves unknown directives', () => {
    const result = compile('@mystery C')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'XP_UNKNOWN_DIRECTIVE', severity: 'warning' }),
    )
    expect(
      'score' in result &&
        result.score.events.some((event) => event.kind === 'marker' && event.label === '@mystery'),
    ).toBe(true)
  })
})
