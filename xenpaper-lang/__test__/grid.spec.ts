import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { compile, Monomial, ScoreGrid } from '../core'

interface TestEvent {
  readonly start: Fraction
  readonly label: string
}

const event = (start: number, label: string): TestEvent => ({ start: new Fraction(start), label })

describe('Transactional score grids', () => {
  it('sequences local fragments by committing each span once', () => {
    const left = new ScoreGrid<TestEvent>(2, [event(0, 'left')])
    const right = new ScoreGrid<TestEvent>(3, [event(1, 'right')])
    const combined = left.append(right)

    expect(combined.span.equals(5)).toBe(true)
    expect(combined.events.map(({ start }) => start.valueOf())).toEqual([0, 3])
    expect(left.events[0]!.start.valueOf()).toBe(0)
    expect(right.events[0]!.start.valueOf()).toBe(1)
  })

  it('overlays without cursor leakage and tiles already-evaluated events', () => {
    const pulse = new ScoreGrid<TestEvent>(new Fraction(1, 2), [event(0, 'pulse')])
    const sustained = new ScoreGrid<TestEvent>(2, [event(0, 'sustain')])
    const overlay = pulse.overlay(sustained)
    const repeated = pulse.repeat(4)

    expect(overlay.span.equals(2)).toBe(true)
    expect(overlay.events).toHaveLength(2)
    expect(repeated.span.equals(2)).toBe(true)
    expect(repeated.events.map(({ start }) => start.valueOf())).toEqual([0, 0.5, 1, 1.5])
  })
})

describe('Xenpaper exact-grid compilation', () => {
  it('compiles source directly to exact beat and monomial coordinates', () => {
    const result = compile('C D E')
    expect('grid' in result).toBe(true)
    if (!('grid' in result)) return

    const notes = result.grid.events.filter((entry) => entry.kind === 'note')
    expect(result.grid.span.equals(3)).toBe(true)
    expect(notes.map(({ start }) => start.valueOf())).toEqual([0, 1, 2])
    expect(notes.every(({ pitch }) => pitch.sounding instanceof Monomial)).toBe(true)
  })

  it('keeps source identity separate from an exact temperament projection', () => {
    const result = compile('{31edo} E')
    expect('grid' in result).toBe(true)
    if (!('grid' in result)) return

    const note = result.grid.events.find((entry) => entry.kind === 'note')
    expect(note?.kind).toBe('note')
    if (!note || note.kind !== 'note') return

    expect([...note.pitch.sounding.keys()]).toEqual([2])
    expect(note.pitch.formula?.has(3)).toBe(true)
  })

  it('turns parser failures into ordinary diagnostics', () => {
    const result = compile('(')

    expect('grid' in result).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('XP_SYNTAX')
  })
})
