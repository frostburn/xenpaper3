import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import {
  evaluateInitialization,
  evaluateTimeline,
  expandToBeatEvents,
  gridMeasureBoundaries,
  parse,
} from '..'
import type { ScoreInitialization } from '..'

function initialize(source: string, parent?: ScoreInitialization) {
  const result = evaluateInitialization(parse(source), {
    initialization: parent,
    allowDuration: !parent,
    allowTempoDirective: !parent,
    timeSignature: { numerator: 4, denominator: 4 },
  })
  expect(result.diagnostics).toEqual([])
  expect(result.initialization).toBeDefined()
  return result.initialization!
}

function score(source: string, initialization: ScoreInitialization, offset = new Fraction(0)) {
  const result = expandToBeatEvents(parse(source), { initialization, beatOffset: offset })
  expect(result.diagnostics).toEqual([])
  if (!('score' in result)) throw new Error('Expected a score')
  return result.score
}

function notes(source: string, initialization: ScoreInitialization, offset?: Fraction) {
  return score(source, initialization, offset).events.filter((event) => event.kind === 'note')
}

describe('global grid context', () => {
  it('applies subdivision changes while advancing the grid, including score length', () => {
    const initialization = initialize('. @2')
    const result = score('C D E F', initialization)
    expect(result.duration.toFraction()).toBe('5/2')
    expect(
      notes('C D E F', initialization).map(({ start, duration }) => [
        start.toFraction(),
        duration.toFraction(),
      ]),
    ).toEqual([
      ['0', '1'],
      ['1', '1/2'],
      ['3/2', '1/2'],
      ['2', '1/2'],
    ])
  })

  it('evaluates the actual expression when a global function changes its score shape', () => {
    const initialization = initialize('fn phrase() { ret C } . fn phrase() { ret D E }')
    expect(
      notes('phrase() phrase()', initialization).map(({ label, start }) => [
        label,
        start.toFraction(),
      ]),
    ).toEqual([
      ['C', '0'],
      ['D', '1'],
      ['E', '2'],
    ])
  })

  it('initializes a child from the complete set of declarations at beat zero', () => {
    const global = initialize('let division = 2 fn phrase() { ret C D } . {5edo}')
    const lane = initialize('@subdivision(division) fn local() { ret phrase() }', global)
    expect(notes('local()', lane).map(({ start }) => start.toFraction())).toEqual(['0', '1/2'])
  })

  it('keeps the initial state before the first switch and the final state after the last', () => {
    const initialization = initialize('. {5edo}')
    const baseline = notes('D', initialize(''))[0]!.pitch.value.valueOf()
    const changed = notes('D', initialize('{5edo}'))[0]!.pitch.value.valueOf()
    expect(notes('D', initialization)[0]!.pitch.value.valueOf()).toBe(baseline)
    expect(notes('D', initialization, new Fraction(100))[0]!.pitch.value.valueOf()).toBe(changed)
  })

  it('uses fractional absolute positions without rounding to nearby grid points', () => {
    const initialization = initialize('@3 . {5edo}')
    const before = notes('D', initialization, new Fraction(1, 3).sub(new Fraction(1, 1000000)))[0]!
    const after = notes('D', initialization, new Fraction(1, 3))[0]!
    expect(before.pitch.value.equals(after.pitch.value)).toBe(false)
  })

  it('resolves meter changes and bar rests without a DAW-supplied meter timeline', () => {
    const initialization = initialize('; @time(3/4)')
    expect(score('C ; | D ; |', initialization).duration.toFraction()).toBe('7')
    expect(notes('C ; | D ; |', initialization).map(({ start }) => start.toFraction())).toEqual([
      '0',
      '4',
    ])
  })

  it('restores context after an explicit global scope', () => {
    const initialization = initialize('({5edo} .) .')
    const result = notes('D D', initialization)
    expect(result[0]!.pitch.value.equals(result[1]!.pitch.value)).toBe(false)
    expect(result[1]!.pitch.value.equals(notes('D', initialize(''))[0]!.pitch.value)).toBe(true)
  })

  it('preserves local context changes across global switches and isolates groups', () => {
    const initialization = initialize('{5edo} . {12edo}')
    const result = notes('({root = D} 0 0) 0', initialization)
    const expected = notes('{5edo} ({root = D} 0) {12edo} ({root = D} 0) 0', initialize(''))
    expect(result.map(({ pitch }) => pitch.value.valueOf())).toEqual(
      expected.map(({ pitch }) => pitch.value.valueOf()),
    )
  })

  it('applies context at the normalized positions inside a slot', () => {
    const initialization = initialize('[. {5edo} .]')
    const result = notes('[D D]', initialization)
    expect(result.map(({ start }) => start.toFraction())).toEqual(['0', '1/2'])
    expect(result[0]!.pitch.value.equals(result[1]!.pitch.value)).toBe(false)
  })

  it('applies context at the stretched positions of a continued normalized slot', () => {
    const initialization = initialize('. {5edo}')
    const result = notes('[D D]=', initialization)
    expect(result.map(({ start }) => start.toFraction())).toEqual(['0', '1'])
    expect(result[0]!.pitch.value.equals(result[1]!.pitch.value)).toBe(false)
  })

  it('settles normalized timing when a global function changes its length', () => {
    const global = initialize('fn phrase() { ret C } [. fn phrase() { ret D E } ..]')
    const result = notes('[phrase() phrase()]', global)
    expect(result.map(({ start }) => start.toFraction())).toEqual(['0', '1/3', '2/3'])
  })

  it('diagnoses a normalized rhythm with no consistent placement of a global switch', () => {
    const global = initialize('fn phrase() { ret C } [. fn phrase() { ret D E } .]')
    const result = expandToBeatEvents(parse('[phrase() phrase()]'), { initialization: global })
    expect(result).not.toHaveProperty('score')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'XP_TIMELINE_LAYOUT' }),
    )
  })

  it('rejects sounding initialization notes in parallel branches', () => {
    expect(
      evaluateInitialization(parse('(C, D)'), { allowDuration: true }).diagnostics,
    ).toContainEqual(expect.objectContaining({ code: 'XP_INITIALIZATION', severity: 'error' }))
  })
})

describe('abstract tempo and meter', () => {
  it('anchors normalized meter changes and barlines to their scaled grid positions', () => {
    const global = initialize('[. @time(3/4) .]')
    expect(score(';', global, new Fraction(1, 2)).duration.toFraction()).toBe('3')
    const checked = expandToBeatEvents(parse('@time(4/4) [C C C C | D]'))
    expect(checked.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'XP_BARLINE_OFF_CYCLE' }),
    )
  })
  it('restores the enclosing tempo after an explicit scope', () => {
    const result = evaluateTimeline(parse('(@tempo(180bpm) .) .'), { tempo: 120 })
    expect(
      result.tempoChanges.map(({ beat, bpm }) => [beat.toFraction(), bpm.toFraction()]),
    ).toEqual([
      ['0', '180'],
      ['1', '120'],
    ])
  })
  it('expands tempo changes onto exact grid positions without stretching the abstract score', () => {
    const result = evaluateTimeline(parse('|: @3 . @tempo(123.5bpm) . @tempo(240bpm) . :|'))
    expect(result.diagnostics).toEqual([])
    expect(
      result.tempoChanges.map(({ beat, bpm }) => [beat.toFraction(), bpm.toFraction()]),
    ).toEqual([
      ['1/3', '247/2'],
      ['2/3', '240'],
      ['4/3', '247/2'],
      ['5/3', '240'],
    ])
    expect(result.initialization!.timelineShape!.duration.toFraction()).toBe('2')
  })

  it('enumerates measure boundaries on the exact grid', () => {
    const result = gridMeasureBoundaries(
      [{ beat: new Fraction(0), numerator: 1, denominator: 12 }],
      3,
    )
    expect(result.map((beat) => beat.toFraction())).toEqual([
      '0',
      '1/3',
      '2/3',
      '1',
      '4/3',
      '5/3',
      '2',
      '7/3',
      '8/3',
      '3',
    ])
  })
})
