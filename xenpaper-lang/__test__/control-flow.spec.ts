import { describe, expect, it } from 'vitest'
import { parse } from '../parser.js'
import { expandToBeatEvents } from '../runtime/beat-events'
import { evaluateExpression } from '../runtime/expressions'
import { evaluateProgramShape } from '../runtime/score-shape'

function score(source: string) {
  const evaluated = expandToBeatEvents(parse(source))
  expect(evaluated.diagnostics).toEqual([])
  if (!('score' in evaluated)) throw new Error('Expected a beat-timed score.')
  return evaluated.score.events.flatMap((event) =>
    event.kind === 'note'
      ? [[event.start.toFraction(), event.duration.toFraction(), event.pitch.value.valueOf()]]
      : [],
  )
}

describe('comparison expressions', () => {
  it('keeps ordinary pitch spellings and the MOS accidental beside comparison operators', () => {
    expect(parse('eq @eq e').body[0]).toMatchObject({
      type: 'BinaryExpression',
      operator: '@eq',
      left: { type: 'PitchLiteral', raw: 'eq', accidentals: [{ value: 'q' }] },
      right: { type: 'PitchLiteral', raw: 'e' },
    })
    expect(parse('J@@eq J@').body[0]).toMatchObject({
      operator: '@eq',
      left: { type: 'PitchLiteral', raw: 'J@' },
      right: { type: 'PitchLiteral', raw: 'J@' },
    })
  })

  it.each([
    ['1 + 2 @eq 3', 1],
    ['1 @ne 1', 0],
    ['1 @lt 2', 1],
    ['2 @le 2', 1],
    ['1 @gt 2', 0],
    ['-2 @ge -3', 1],
    ['1s @eq 1000ms', 1],
    ['12d @eq 2/1', 1],
    ['E# @eq F', 0],
  ])('evaluates %s in the shared expression grammar', (source, expected) => {
    const result = evaluateExpression(parse(source).body[0]!)
    expect(result.diagnostics).toEqual([])
    expect('value' in result && result.value.value.valueOf()).toBe(expected)
  })

  it('reports incompatible dimensions and rejects unconsumed Booleans in a score', () => {
    expect(evaluateExpression(parse('1s @lt 1Hz').body[0]!).diagnostics[0]?.code).toBe(
      'XP_DIMENSION_MISMATCH',
    )
    expect(expandToBeatEvents(parse('1 @eq 1')).diagnostics[0]?.message).toMatch(
      /comparison result cannot be played/,
    )
  })
})

describe('score control flow', () => {
  it('evaluates comparisons in declarations and only visits the selected branch', () => {
    const source = `
let chosen <- 1 + 2 @eq 3
@if(false) |: @x1000000 C :|
@elif(chosen) @2 D E
@elif(missingName) G
@else missingName
@end
F
`
    expect(score(source)).toEqual(score('@2 D E F'))
    expect(evaluateProgramShape(parse(source)).diagnostics).toEqual([])
  })

  it('plays nested loop results in order and restores shadowed variables', () => {
    const source = `
let index <- 9/1
@for(index, 3, -1, -1)
  @if(index @eq 2)
    let pass <- 0/1
    @while(pass @lt 2)
      E
      let pass <- pass + 1
    @end
  @else
    D
  @end
@end
@if(index @eq 9) F @end
`
    expect(score(source)).toEqual(score('D E E D D F'))
    const notation = evaluateProgramShape(parse(source))
    expect(notation.diagnostics).toEqual([])
    expect('shape' in notation && notation.shape.duration.toFraction()).toBe('6')
  })

  it('expands ordinary repeats only in a selected body during playback', () => {
    expect(score('@if(true) |: C D :| @end E')).toEqual(score('C D C D E'))
  })

  it('compares the sounding pitches in the active tuning', () => {
    expect(score('{12edo} @if(E# @eq F) D @else C @end')).toEqual(score('{12edo} D'))
  })

  it('carries while bindings between iterations and restores them on exit', () => {
    const source = `
let cursor <- 0/1
@while(cursor @lt 3)
  C
  let cursor <- cursor + 1
@end
@if(cursor @eq 0) D @end
`
    expect(score(source)).toEqual(score('C C C D'))
  })

  it('carries prevailing context out of a while with no local declarations', () => {
    expect(score('{19edo} @while(C# - C @lt 90c) @2 {12edo} C @end D')).toEqual(
      score('@2 {12edo} C D'),
    )
  })

  it('does not evaluate empty ranges or an initially false while body', () => {
    expect(score('@while(false) missingName @end @for(index, 0, 0) missingName @end D')).toEqual(
      score('D'),
    )
  })

  it('rejects invalid bounds and uses one expansion budget across nested loops', () => {
    for (const source of ['@for(index, 0, 1, 0) C @end', '@for(index, 0, 3/2) C @end']) {
      expect(expandToBeatEvents(parse(source)).diagnostics[0]?.code).toBe('XP_LOOP_BOUNDS')
    }
    for (const source of [
      '@while(true) @end',
      '@for(i, 0, 4) @for(innerIndex, 0, 4) C @end @end',
    ]) {
      expect(expandToBeatEvents(parse(source), { expansionLimit: 8 }).diagnostics[0]?.code).toBe(
        'XP_EXPANSION_LIMIT',
      )
    }
  })
})
