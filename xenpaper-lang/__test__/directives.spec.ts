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

  it('scales gliss automation with a continued normalized slot', () => {
    const events = notes('@gliss [C D E]= [D E F]')

    expect(events.map((event) => event.duration.valueOf())).toEqual([1, 1, 1])
    expect(events.map((event) => event.automation?.duration.valueOf())).toEqual([1, 1, 1])
  })

  it('holds a duration-bearing gliss target and rejects mismatched trees', () => {
    const held = notes('@gliss F= C')
    expect(held).toHaveLength(1)
    expect(held[0]!.duration.valueOf()).toBe(3)
    const mismatch = compile('@gliss (F C)= [E, D]?')
    expect(mismatch.diagnostics).toContainEqual(expect.objectContaining({ code: 'XP_GLISS_SHAPE' }))
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
