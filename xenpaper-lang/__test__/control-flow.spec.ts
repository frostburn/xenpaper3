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
@if(false) { |: @x1000000 C :| }
@elif(chosen) { @2 D E }
@elif(missingName) { G }
@else { missingName }
F
`
    expect(score(source)).toEqual(score('@2 D E F'))
    expect(evaluateProgramShape(parse(source)).diagnostics).toEqual([])
  })

  it('plays nested loop results in order and restores shadowed variables', () => {
    const source = `
let index <- 9/1
@for(index in [C D E F]) {
  @if(index @eq 1) {
    let pass <- 0/1
    @while(pass @lt 2) {
      E
      let pass <- pass + 1
    }
  } @else {
    D
  }
}
@if(index @eq 9) { F }
`
    expect(score(source)).toEqual(score('D E E D D F'))
    const notation = evaluateProgramShape(parse(source))
    expect(notation.diagnostics).toEqual([])
    expect('shape' in notation && notation.shape.duration.toFraction()).toBe('6')
  })

  it('nests a control block and a tuning change inside a function body', () => {
    expect(
      score('fn phrase() { ret @if(true) { {19edo} 1d } @else { missingName } } phrase()'),
    ).toEqual(score('{19edo} 1d'))
  })

  it('expands ordinary repeats only in a selected body during playback', () => {
    expect(score('@if(true) { |: C D :| } E')).toEqual(score('C D C D E'))
  })

  it('compares the sounding pitches in the active tuning', () => {
    expect(score('{12edo} @if(E# @eq F) { D } @else { C }')).toEqual(score('{12edo} D'))
  })

  it('carries while bindings between iterations and restores them on exit', () => {
    const source = `
let cursor <- 0/1
@while(cursor @lt 3) {
  C
  let cursor <- cursor + 1
}
@if(cursor @eq 0) { D }
`
    expect(score(source)).toEqual(score('C C C D'))
  })

  it('carries prevailing context out of a while with no local declarations', () => {
    expect(score('{19edo} @while(C# - C @lt 90c) { @2 {12edo} C } D')).toEqual(
      score('@2 {12edo} C D'),
    )
  })

  it('uses indices to look up container entries and values to play them directly', () => {
    const source = 'let melody <- [D F C] '
    const indexed = '@for(index in melody) { melody[index] }'
    const each = '@for(note of melody) { note }'
    expect(score(source + indexed)).toEqual(score('D F C'))
    expect(score(source + each)).toEqual(score('D F C'))
  })

  it('evaluates the collection once in the enclosing pitch context', () => {
    expect(score('{12edo} @for(note of [1d 2d]) { {19edo} note }')).toEqual(
      score('{12edo} let melody <- [1d 2d] {19edo} melody[0] melody[1]'),
    )
  })

  it('does not evaluate empty containers or an initially false while body', () => {
    expect(
      score(
        '@while(false) { missingName } @for(index in []) { missingName } @for(note of []) { missingName } D',
      ),
    ).toEqual(score('D'))
  })

  it('rejects counted loops and diagnoses non-container operands', () => {
    expect(() => parse('@for(index, 0, 2) { C }')).toThrow('but "," found')
    for (const mode of ['in', 'of']) {
      const source = `@for(index ${mode} 3/2) { C }`
      const result = expandToBeatEvents(parse(source))
      expect(result.diagnostics[0]).toMatchObject({
        code: 'XP_NOT_ITERABLE',
        locations: [{ start: { offset: source.indexOf('3/2') } }],
      })
    }
  })

  it('uses one expansion budget across nested loops', () => {
    for (const source of [
      '@while(true) {}',
      '@for(i in [C D E F]) { @for(note of [C D E F]) { note } }',
    ]) {
      expect(expandToBeatEvents(parse(source), { expansionLimit: 8 }).diagnostics[0]?.code).toBe(
        'XP_EXPANSION_LIMIT',
      )
    }
  })
})

describe('loop jumps and completion', () => {
  it.each(['@for(index in [C D])', '@for(note of [C D])', '@while(true)'])(
    'preserves the music before a break and skips the else for %s',
    (header) => {
      const source = `${header} { @2 C @if(true) { @break } missingName } @else { missingName } D`
      expect(score(source)).toEqual(score('@2 C D'))
      const notation = evaluateProgramShape(parse(source))
      expect(notation.diagnostics).toEqual([])
      expect('shape' in notation && notation.shape.duration.toFraction()).toBe('1')
    },
  )

  it.each(['@for(index in [])', '@for(note of [])', '@while(false)'])(
    'runs the else after zero iterations for %s',
    (header) => {
      expect(score(`${header} { missingName } @else { C } D`)).toEqual(score('C D'))
    },
  )

  it.each(['@for(index in [C D])', '@for(note of [C D])'])(
    'runs the else after continuing the final iteration for %s',
    (header) => {
      expect(score(`${header} { C @continue missingName } @else { E } F`)).toEqual(score('C C E F'))
    },
  )

  it('carries while bindings through continue and restores the outer scope before else', () => {
    const source = `
let index <- 0/1
@while(index @lt 2) {
  let index <- index + 1
  C @continue missingName
} @else {
  @if(index @eq 0) { D }
}
E
`
    expect(score(source)).toEqual(score('C C D E'))
  })

  it('targets the innermost body and treats an inner else as part of the outer body', () => {
    const source = `
@for(note of [C D]) {
  note
  @while(true) { E @break } @else { missingName }
  @while(false) { missingName } @else { @continue }
  missingName
} @else { F }
G
`
    expect(score(source)).toEqual(score('C E D E F G'))
  })

  it('stops a sequential group and skips repeat expansion after the jump', () => {
    const source = '@while(true) { (C @break missingName) |: @x1000000 E :| } D'
    expect(score(source)).toEqual(score('C D'))
    expect(evaluateProgramShape(parse(source)).diagnostics).toEqual([])
  })

  it('keeps a jump inside ordinary repeat notation bound to the enclosing loop', () => {
    const source = '@while(true) { |: C @break missingName :| } @else { missingName } D'
    expect(score(source)).toEqual(score('C D'))
    expect(evaluateProgramShape(parse(source)).diagnostics).toEqual([])
  })

  it.each([
    '@break',
    '@continue',
    '@while(false) { C } @else { @break }',
    'fn phrase() { ret @break } @while(true) { phrase() }',
    '@while(true) { (C, @continue) }',
    '@while(true) { [C @break] }',
  ])('diagnoses an evaluated jump outside its loop body in %s', (source) => {
    expect(expandToBeatEvents(parse(source)).diagnostics[0]?.code).toBe('XP_LOOP_JUMP')
  })
})
