import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { parse, type Expression } from '../parser.generated.js'
import { evaluateScoreShape } from '../runtime/score-shape'
import type { ParallelShape, ScoreShape, SequenceShape } from '../runtime/types'
import { Value } from '../value'
import { parseVal } from '../runtime/val'

function shape(source: string, pulse: Fraction | number = 1): ScoreShape {
  const node = parse(source).body[0] as Expression
  const result = evaluateScoreShape(node, { pulse })
  expect(result.diagnostics).toEqual([])
  if (!('shape' in result)) throw new Error('Expected a score shape.')
  return result.shape
}

describe('score-shape timing', () => {
  it('assigns explicit equal-division intervals to degrees and loops at the equave', () => {
    const result = shape(String.raw`{3\12 5\12 7\12 10\12 12\12} 0 1 2 3 4 5 6 -1`) as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')
    expect(attacks.map((attack) => attack.pitch.value.valueOf())).toEqual([
      0, 300, 500, 700, 1000, 1200, 1500, -200,
    ])
  })

  it('accepts every numeric interval literal and respects explicit degree equaves', () => {
    const mixed = shape(String.raw`{123c 3/2 1201c} 0 1 2 3 4`) as SequenceShape
    const mixedPitches = mixed.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => attack.pitch.value.valueOf())
    ;[0, 123, 1200 * Math.log2(3 / 2), 1201, 1324].forEach((expected, index) =>
      expect(mixedPitches[index]).toBeCloseTo(expected),
    )

    const tritave = shape(String.raw`{1\12<3> 12\12<3>} 0 1 2`) as SequenceShape
    const tritavePitches = tritave.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => attack.pitch.value.valueOf())
    ;[0, (1200 * Math.log2(3)) / 12, 1200 * Math.log2(3)].forEach((expected, index) =>
      expect(tritavePitches[index]).toBeCloseTo(expected),
    )
  })

  it('supports patent vals, arbitrary warts, and non-octave equal divisions', () => {
    expect(parseVal('17c').mapping.mapPrime(5).valueOf()).not.toBe(
      parseVal('17cc').mapping.mapPrime(5).valueOf(),
    )
    const wartDegrees = shape('{17c} 0 1 2') as SequenceShape
    expect(
      wartDegrees.children
        .filter((child) => child.kind === 'attack')
        .map((attack) => attack.pitch.value.valueOf()),
    ).toEqual([0, 1200 / 17, 2400 / 17])

    const tritave = shape('{b13} 0 1 13') as SequenceShape
    expect(
      tritave.children
        .filter((child) => child.kind === 'attack')
        .map((attack) => attack.pitch.value.valueOf()),
    ).toEqual([0, 1200 * Math.log2(3) / 13, 1200 * Math.log2(3)])

    expect(() => shape('{13ed3} C')).not.toThrow()
    expect(() => shape('{7ed3/2} C')).not.toThrow()
    expect(() => shape('{17oooooooooooo} C')).not.toThrow()
  })

  it('treats decimal cent temperaments as single-entry scales and integer c as a wart', () => {
    const cents = shape('{88.0c} 0 1 14') as SequenceShape
    expect(
      cents.children
        .filter((child) => child.kind === 'attack')
        .map((attack) => attack.pitch.value.valueOf()),
    ).toEqual([0, 88, 1232])
    const centsPitch = shape('{88.0c} E') as SequenceShape
    const e = centsPitch.children.find((child) => child.kind === 'attack')
    expect(e?.kind === 'attack' ? e.pitch.value.valueOf() : undefined).toBeCloseTo(
      1200 * Math.log2(81 / 64),
    )

    const wart = shape('{88c} 0 1 88') as SequenceShape
    expect(
      wart.children
        .filter((child) => child.kind === 'attack')
        .map((attack) => attack.pitch.value.valueOf()),
    ).toEqual([0, 1200 / 88, 1200])
  })
  it('uses 12-EDO degrees by default and updates their division with EDO presets', () => {
    const defaults = shape("0 1 2 11 '0 `0") as SequenceShape
    const attacksIn = (score: ScoreShape): Extract<ScoreShape, { kind: 'attack' }>[] =>
      score.kind === 'attack'
        ? [score]
        : score.kind === 'sequence'
          ? score.children.flatMap(attacksIn)
          : score.kind === 'parallel'
            ? score.branches.flatMap(attacksIn)
            : []
    const defaultAttacks = attacksIn(defaults)
    expect(defaultAttacks.map((attack) => attack.pitch.value.valueOf())).toEqual([
      0, 100, 200, 1100, 1200, -1200,
    ])

    const tenEdo = shape('{10edo} 0= 1 2 3 4 5 6 7 9 9 10=') as SequenceShape
    const attacks = attacksIn(tenEdo)
    expect(attacks.map((attack) => attack.pitch.value.valueOf())).toEqual([
      0, 120, 240, 360, 480, 600, 720, 840, 1080, 1080, 1200,
    ])
    expect(tenEdo.children.filter((child) => child.kind === 'sequence')).toHaveLength(2)
  })
  it('flows root reassociation through an ordinary sequence', () => {
    const result = shape('{A = root} A B') as SequenceShape
    expect(result.children).toHaveLength(3)
    expect(result.children[0]).toMatchObject({ kind: 'annotation', text: 'A = root' })
    expect(result.children[1]).toMatchObject({ kind: 'attack' })
    expect(result.children[2]).toMatchObject({ kind: 'attack' })
    if (result.children[1]?.kind !== 'attack' || result.children[2]?.kind !== 'attack')
      throw new Error('Expected attacks.')
    expect(result.children[1].pitch.value.equals(Value.cents(0))).toBe(true)
    expect(result.children[2].pitch.value.equals(Value.pitch(new Value(9n, 8n)))).toBe(true)
  })
  it('moves the root frequency without reassociating its pitch spelling', () => {
    const result = shape('{root = D} C 1/1 D') as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')

    expect(attacks).toHaveLength(3)
    expect(attacks[0]!.pitch.value.equals(Value.pitch(new Value(9n, 8n)))).toBe(true)
    expect(attacks[1]!.pitch.value.equals(Value.pitch(new Value(9n, 8n)))).toBe(true)
    expect(attacks[2]!.pitch.value.equals(Value.pitch(new Value(81n, 64n)))).toBe(true)
  })
  it('sequences atoms in exact pulse-sized beats', () => {
    const result = shape('3/2 4/3 5/4', new Fraction(1, 4)) as SequenceShape

    expect(result.duration.equals(new Fraction(3, 4))).toBe(true)
    expect(result.children.every((child) => child.duration.equals(new Fraction(1, 4)))).toBe(true)
  })

  it('treats positive irrational scalar expressions as playable ratios', () => {
    const result = shape('sqrt(2)')

    expect(result).toMatchObject({ kind: 'attack' })
    if (result.kind !== 'attack') throw new Error('Expected an attack.')
    expect(result.pitch.value.equals(Value.pitch(new Value(2).pow(new Value(1n, 2n))))).toBe(true)
  })

  it('normalizes a square-bracketed sequence to one slot', () => {
    const result = shape('[3/2 4/3 5/4]') as SequenceShape

    expect(result.duration.equals(1)).toBe(true)
    expect(result.children.every((child) => child.duration.equals(new Fraction(1, 3)))).toBe(true)
  })

  it('applies subdivision directives to following notes', () => {
    const result = shape('C @2 D E @1 F G') as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')

    expect(attacks.map((attack) => attack.duration.valueOf())).toEqual([1, 0.5, 0.5, 1, 1])
    expect(result.duration.equals(4)).toBe(true)
  })

  it('propagates subdivision state through and beyond repeats', () => {
    const result = shape('|: C @2 D :| E') as SequenceShape
    const repeat = result.children[0] as SequenceShape
    const repeatedSequence = repeat.children[1] as SequenceShape
    const repeatedAttacks = repeatedSequence.children.filter((child) => child.kind === 'attack')
    const following = result.children[1]

    expect(repeatedAttacks.map((attack) => attack.duration.valueOf())).toEqual([1, 0.5])
    expect(following).toMatchObject({ kind: 'attack' })
    expect(following!.duration.valueOf()).toBe(0.5)
  })

  it('normalizes attached continuation as part of the complete fragment', () => {
    const result = shape('[3/2= 4/3]') as SequenceShape

    expect(result.duration.equals(1)).toBe(true)
    expect(result.children[0]!.duration.equals(new Fraction(2, 3))).toBe(true)
    expect(result.children[1]!.duration.equals(new Fraction(1, 3))).toBe(true)
    expect(result.tuplet).toBe(3)
  })

  it('makes an empty slot one authored pulse of rest', () => {
    expect(shape('[]')).toMatchObject({ kind: 'rest', generated: false })
    expect(shape('[]').duration.equals(1)).toBe(true)
  })

  it('uses the cluster length as the authored rest duration', () => {
    expect(shape('..')).toMatchObject({ kind: 'rest', generated: false })
    expect(shape('..').duration.equals(2)).toBe(true)
    expect(shape('...').duration.equals(3)).toBe(true)
  })

  it('uses the maximum branch duration and pads shorter branches', () => {
    const result = shape('3/2 4/3, 5/4 6/5 7/6') as ParallelShape
    const shortBranch = result.branches[0] as SequenceShape

    expect(result.duration.equals(3)).toBe(true)
    expect(result.branches.every((branch) => branch.duration.equals(3))).toBe(true)
    expect(shortBranch.children.at(-1)).toMatchObject({
      kind: 'rest',
      duration: new Fraction(1),
      generated: true,
      origins: [],
    })
  })

  it('normalizes a parallel chord without changing simultaneity', () => {
    const result = shape('[3/2, 5/4]') as ParallelShape

    expect(result.duration.equals(1)).toBe(true)
    expect(result.branches.every((branch) => branch.duration.equals(1))).toBe(true)
  })

  it('retains exact nested slot scaling', () => {
    const result = shape('3/2 [4/3 [5/4 6/5]]') as SequenceShape
    const outerSlot = result.children[1] as SequenceShape
    const innerSlot = outerSlot.children[1] as SequenceShape

    expect(result.duration.equals(2)).toBe(true)
    expect(outerSlot.children.every((child) => child.duration.equals(new Fraction(1, 2)))).toBe(
      true,
    )
    expect(innerSlot.children.every((child) => child.duration.equals(new Fraction(1, 4)))).toBe(
      true,
    )
  })
})
