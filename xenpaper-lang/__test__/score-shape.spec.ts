import { describe, expect, it } from 'vitest'
import { Fraction } from 'xen-dev-utils/fraction'
import { parse, type Expression } from '../parser.generated.js'
import { evaluateScoreShape } from '../runtime/score-shape'
import type { ParallelShape, ScoreShape, SequenceShape } from '../runtime/types'
import { Value } from '../value'

function shape(source: string, pulse: Fraction | number = 1): ScoreShape {
  const node = parse(source).body[0] as Expression
  const result = evaluateScoreShape(node, { pulse })
  expect(result.diagnostics).toEqual([])
  if (!('shape' in result)) throw new Error('Expected a score shape.')
  return result.shape
}

describe('score-shape timing', () => {
  it('flows root reassociation through an ordinary sequence', () => {
    const result = shape('{A = root} A B') as SequenceShape
    expect(result.children).toHaveLength(3)
    expect(result.children[0]).toMatchObject({ kind: 'annotation', text: 'A = root' })
    expect(result.children[1]).toMatchObject({ kind: 'attack' })
    expect(result.children[2]).toMatchObject({ kind: 'attack' })
    if (result.children[1]?.kind !== 'attack' || result.children[2]?.kind !== 'attack') throw new Error('Expected attacks.')
    expect(result.children[1].pitch.value.equals(Value.cents(0))).toBe(true)
    expect(result.children[2].pitch.value.equals(Value.pitch(new Value(9n, 8n)))).toBe(true)
  })
  it('sequences atoms in exact pulse-sized beats', () => {
    const result = shape('3/2 4/3 5/4', new Fraction(1, 4)) as SequenceShape

    expect(result.duration.equals(new Fraction(3, 4))).toBe(true)
    expect(result.children.every((child) => child.duration.equals(new Fraction(1, 4)))).toBe(true)
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

  it('normalizes attached continuation as part of the complete fragment', () => {
    const result = shape('[3/2= 4/3]') as SequenceShape

    expect(result.duration.equals(1)).toBe(true)
    expect(result.children[0]!.duration.equals(new Fraction(2, 3))).toBe(true)
    expect(result.children[1]!.duration.equals(new Fraction(1, 3))).toBe(true)
  })

  it('makes an empty slot one authored pulse of rest', () => {
    expect(shape('[]')).toMatchObject({ kind: 'rest', generated: false })
    expect(shape('[]').duration.equals(1)).toBe(true)
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
    expect(outerSlot.children.every((child) => child.duration.equals(new Fraction(1, 2)))).toBe(true)
    expect(innerSlot.children.every((child) => child.duration.equals(new Fraction(1, 4)))).toBe(true)
  })
})
