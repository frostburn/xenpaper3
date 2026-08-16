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
  it('installs Diamond-MOS absolute pitches and relative mossteps', () => {
    const score = shape('MOS{5L2s} J K L M N O P') as SequenceShape
    const cents = score.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => attack.pitch.value.valueOf())
    expect(cents).toHaveLength(7)
    expect(cents.map((value) => Math.round(value))).toEqual([0, 200, 400, 600, 700, 900, 1100])

    const relative = shape('MOS{5L2s} P0ms m1ms M1ms') as SequenceShape
    const offsets = relative.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => Math.round(attack.pitch.value.valueOf()))
    expect(offsets).toEqual([0, 100, 200])

    const perfect = shape('MOS{5L2s} P3ms P4ms') as SequenceShape
    const perfectOffsets = perfect.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => Math.round(attack.pitch.value.valueOf()))
    expect(perfectOffsets).toEqual([500, 700])
  })

  it('associates and transposes Diamond-MOS pitches by their written rank', () => {
    const associated = shape('MOS{5L2s} {K = root} K') as SequenceShape
    expect(associated.children.find((child) => child.kind === 'attack')).toMatchObject({
      pitch: { value: expect.any(Value) },
    })

    const transposed = shape("MOS{5L2s} J + M1ms J + 'M1ms J + A1ms J& + M1ms") as SequenceShape
    const attacks = transposed.children.filter((child) => child.kind === 'attack')
    expect(attacks.map((attack) => attack.pitch.mos?.rank)).toEqual([1, 8, 1, 1])
    expect(attacks.map((attack) => attack.pitch.spelling)).toMatchObject([
      { nominal: 'K', system: 'mos', derived: true, accidentals: [] },
      { nominal: 'K', system: 'mos', derived: true, modifiers: ['equaveUp'], accidentals: [] },
      { nominal: 'K', system: 'mos', derived: true, accidentals: ['&'] },
      { nominal: 'K', system: 'mos', derived: true, accidentals: ['&'] },
    ])

    const reassociated = shape('MOS{5L2s} {K = root} J + M1ms') as SequenceShape
    const reassociatedAttack = reassociated.children.find((child) => child.kind === 'attack')
    expect(reassociatedAttack?.pitch.spelling).toMatchObject({
      nominal: 'K',
      accidentals: [],
    })
  })

  it('aligns MOS and conventional nominal groups through root associations', () => {
    const score = shape(`MOS{5L2s 5|1 L=9/8} {K = root} J K L M
{D = root} C D E F`) as SequenceShape
    const cents = score.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => attack.pitch.value.valueOf())
    expect(cents.slice(0, 4)).toEqual(cents.slice(4))
  })

  it('supports explicit MOS modes, hardness, equaves, and step setters', () => {
    const ordered = shape('MOS{5L2s 3:2 2|4} J K') as SequenceShape
    const reordered = shape('MOS{2|4 3:2 5L2s} J K') as SequenceShape
    const attackCents = (score: SequenceShape) =>
      score.children
        .filter((child) => child.kind === 'attack')
        .map((attack) => attack.pitch.value.valueOf())
    expect(attackCents(reordered)).toEqual(attackCents(ordered))

    const hard = shape('MOS{5L 2s 3:1} J K') as SequenceShape
    const attacks = hard.children.filter((child) => child.kind === 'attack')
    expect(Math.round(attacks[1]!.pitch.value.valueOf())).toBe(212)

    const tritave = shape('MOS{4L5s<3>} J j') as SequenceShape
    const tritaveAttacks = tritave.children.filter((child) => child.kind === 'attack')
    expect(tritaveAttacks[1]!.pitch.value.equals(Value.pitch(new Value(3)))).toBe(true)

    const set = shape('MOS{5L2s} MOS{^ = 1\\24} ^J') as SequenceShape
    const setAttack = set.children.find((child) => child.kind === 'attack')
    expect(setAttack?.pitch.value.equals(Value.equalDivision(1, 24, new Value(2)))).toBe(true)

    const multiperiod = shape('MOS{4L2s} P3ms') as SequenceShape
    const periodAttack = multiperiod.children.find((child) => child.kind === 'attack')
    expect(Math.round(periodAttack!.pitch.value.valueOf())).toBe(600)

    const inconsistent = evaluateScoreShape(
      parse('MOS{5L2s L = 300c s = 100c} J').body[0] as Expression,
    )
    expect(inconsistent.diagnostics[0]?.message).toContain('accumulate to the MOS equave')

    const centsEquave = shape('MOS{5L2s L = 300c s = 100c <1700c>} J j') as SequenceShape
    const centsEquaveAttacks = centsEquave.children.filter((child) => child.kind === 'attack')
    expect(Math.round(centsEquaveAttacks[1]!.pitch.value.valueOf())).toBe(1700)
  })

  it('broadcasts unary pitch operators over score constructions', () => {
    const pitches = (source: string) =>
      (shape(source) as SequenceShape).children
        .filter((child) => child.kind === 'attack')
        .map((attack) => attack.pitch.value.valueOf())
    expect(pitches("'[C D E]")).toEqual(pitches("['C 'D 'E]"))
  })
  it('tempers enumerated major and minor chords through the active mapping', () => {
    const pitches = (source: string) => {
      const result = shape(source)
      const collect = (score: ScoreShape): number[] => {
        if (score.kind === 'attack') return [score.pitch.value.valueOf()]
        if (score.kind === 'sequence') return score.children.flatMap(collect)
        if (score.kind === 'parallel') return score.branches.flatMap(collect)
        return []
      }
      return collect(result)
    }

    expect(pitches('{12edo}~4::6')).toEqual([0, 400, 700])
    expect(pitches('{12edo}~/6:5:4')).toEqual([0, 300, 700])
  })

  it('converts untempered enumerated chords to pitches before arithmetic', () => {
    const result = shape('3/2 + ~4::7') as ParallelShape
    const pitches = result.branches.map((branch) => branch.pitch.value.valueOf())
    ;[
      1200 * Math.log2(3 / 2),
      1200 * Math.log2(15 / 8),
      1200 * Math.log2(9 / 4),
      1200 * Math.log2(21 / 8),
    ].forEach((expected, index) => expect(pitches[index]).toBeCloseTo(expected))
  })

  it('uses middle C below A4 = 440 Hz as the default frequency root', () => {
    const result = shape('440Hz')
    if (result.kind !== 'attack') throw new Error('Expected an attack.')

    expect(result.pitch.notationValue?.valueOf()).toBeCloseTo(900)
    expect(result.pitch.value.valueOf()).toBeCloseTo(900)
  })

  it('treats frequency quantities as notes relative to the current root frequency', () => {
    const result = shape('{root = 220Hz} 220Hz 0.44kHz (1 / 0.001s)') as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')

    const notationCents = attacks.map((attack) => attack.pitch.notationValue?.valueOf())
    const soundingCents = attacks.map((attack) => attack.pitch.value.valueOf())
    ;[0, 1200, 1200 * Math.log2(1000 / 220)].forEach((expected, index) =>
      expect(notationCents[index]).toBeCloseTo(expected),
    )
    const middleC = 440 / 2 ** (3 / 4)
    ;[
      1200 * Math.log2(220 / middleC),
      1200 * Math.log2(440 / middleC),
      1200 * Math.log2(1000 / middleC),
    ].forEach((expected, index) => expect(soundingCents[index]).toBeCloseTo(expected))
  })

  it('applies equave shifts to frequency quantities', () => {
    const result = shape("{root = 220Hz} '220Hz `220Hz") as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')

    expect(attacks.map((attack) => attack.pitch.notationValue?.valueOf())).toEqual([1200, -1200])
  })

  it('keeps playback dynamics and velocity out of abstract notation attacks', () => {
    const result = shape('@p C @velocity(4/5) D') as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')

    expect(attacks).toHaveLength(2)
    expect(attacks.every((attack) => !('dynamic' in attack) && !('velocity' in attack))).toBe(true)
    expect(result.children).toContainEqual(expect.objectContaining({ kind: 'dynamic', mark: 'p' }))
  })

  it('assigns explicit equal-division intervals to degrees and loops at the equave', () => {
    const result = shape(String.raw`{3\12 5\12 7\12 10\12 12\12} 0 1 2 3 4 5 6 -1`) as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')
    expect(attacks.map((attack) => attack.pitch.value.valueOf())).toEqual([
      0, 300, 500, 700, 1000, 1200, 1500, -200,
    ])
  })

  it('flattens sequence and parallel expressions into degree mappings', () => {
    const result = shape('{3/2 5/4, 2/1} 0 1 2 3') as SequenceShape
    const pitches = result.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => attack.pitch.value.valueOf())

    ;[1, 3 / 2, 5 / 4, 2].forEach((ratio, index) =>
      expect(pitches[index]).toBeCloseTo(1200 * Math.log2(ratio)),
    )
  })

  it('rejects non-pitches inside degree mapping expressions at runtime', () => {
    const node = parse('{3/2 @p 2/1} 0').body[0] as Expression
    const result = evaluateScoreShape(node)

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ message: 'Degree assignments require pitch intervals.' }),
    ])
    expect(result).not.toHaveProperty('shape')
  })

  it('evaluates a single integer as a degree in the current mapping', () => {
    const result = shape('{19edo}{2} 0 1 2') as SequenceShape
    const pitches = result.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => attack.pitch.value.valueOf())

    ;[0, 2, 4].forEach((degree, index) => expect(pitches[index]).toBeCloseTo((degree * 1200) / 19))
  })

  it('defines future scales with degrees from the current scale', () => {
    const result = shape(`{19edo}{3 6 8 11 14 17 19}
0 1 2 3 4 5 6 7=`) as SequenceShape
    const collectPitches = (score: ScoreShape): number[] => {
      if (score.kind === 'attack') return [score.pitch.value.valueOf()]
      if (score.kind === 'sequence') return score.children.flatMap(collectPitches)
      if (score.kind === 'parallel') return score.branches.flatMap(collectPitches)
      return []
    }
    const pitches = collectPitches(result)
    const expected = [
      0,
      (3 * 1200) / 19,
      (6 * 1200) / 19,
      (8 * 1200) / 19,
      (11 * 1200) / 19,
      (14 * 1200) / 19,
      (17 * 1200) / 19,
      1200,
    ]

    expect(pitches).toHaveLength(expected.length)
    expected.forEach((pitch, index) => expect(pitches[index]).toBeCloseTo(pitch))
  })

  it('defines scales with absolute Latin pitches', () => {
    const result = shape('{D E F♯ G A B C♯ 2/1} 0 1 2 3 4 5 6 7 8') as SequenceShape
    const pitches = result.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => attack.pitch.value.valueOf())

    ;[1, 9 / 8, 81 / 64, 729 / 512, 3 / 2, 27 / 16, 243 / 128, 2187 / 2048, 2].forEach(
      (ratio, index) => expect(pitches[index]).toBeCloseTo(1200 * Math.log2(ratio)),
    )
  })

  it('moves the root to a scale degree', () => {
    const result = shape('{200c 400c 700c 1200c}{root = 3} 0 1') as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')

    expect(attacks[0]?.pitch.value.valueOf()).toBeCloseTo(700)
    expect(attacks[1]?.pitch.value.valueOf()).toBeCloseTo(900)
  })

  it('moves the root to an equave-shifted scale degree expression', () => {
    const result = shape("{root = '0} 0 1") as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')

    expect(attacks[0]?.pitch.value.valueOf()).toBeCloseTo(1200)
    expect(attacks[1]?.pitch.value.valueOf()).toBeCloseTo(1300)
  })

  it('rotates scale modes while preserving the equave', () => {
    const attacksIn = (score: ScoreShape): Extract<ScoreShape, { kind: 'attack' }>[] =>
      score.kind === 'attack'
        ? [score]
        : score.kind === 'sequence'
          ? score.children.flatMap(attacksIn)
          : score.kind === 'parallel'
            ? score.branches.flatMap(attacksIn)
            : []
    const pitches = attacksIn(shape('{4/3 3/2 2/1}{mode = 1} 0 1 2 3') as SequenceShape).map(
      (attack) => attack.pitch.value,
    )

    ;[1, 9 / 8, 3 / 2, 2].forEach((ratio, index) =>
      expect(pitches[index]!.equals(Value.pitch(new Value(ratio)))).toBe(true),
    )
  })

  it('supports zero, negative, and wrapping mode rotations', () => {
    const pitchRatios = (source: string) => {
      const result = shape(source) as SequenceShape
      return result.children
        .filter((child) => child.kind === 'attack')
        .map((attack) => 2 ** (attack.pitch.value.valueOf() / 1200))
    }

    ;[0, 3].forEach((mode) => {
      const unrotated = pitchRatios(`{4/3 3/2 2/1}{mode = ${mode}} 0 1 2 3`)
      ;[1, 4 / 3, 3 / 2, 2].forEach((ratio, index) => expect(unrotated[index]).toBeCloseTo(ratio))
    })
    const negative = pitchRatios('{4/3 3/2 2/1}{mode = -1} 0 1 2 3')
    ;[1, 4 / 3, 16 / 9, 2].forEach((ratio, index) => expect(negative[index]).toBeCloseTo(ratio))
  })

  it('assigns an equave independently of the scale degrees', () => {
    const result = shape('{4/3 3/2 2/1}{equave = 3/1} 0 1 2 3 4') as SequenceShape
    const pitches = result.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => attack.pitch.value)

    ;[1, 4 / 3, 3 / 2, 2, 4].forEach((ratio, index) =>
      expect(pitches[index]!.valueOf()).toBeCloseTo(1200 * Math.log2(ratio)),
    )
  })

  it('rotates non-monotonic scales without changing their equave', () => {
    const result = shape('{3/2 4/3 2/1}{equave = 3/1}{mode = 1} 0 1 2 3') as SequenceShape
    const pitches = result.children
      .filter((child) => child.kind === 'attack')
      .map((attack) => attack.pitch.value)

    ;[
      [1n, 1n],
      [8n, 9n],
      [2n, 1n],
      [3n, 1n],
    ].forEach(([numerator, denominator], index) =>
      expect(pitches[index]!.equals(Value.pitch(new Value(numerator!, denominator!)))).toBe(true),
    )
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

  it.each([
    [
      '{12:14:16:18:21:24}\n0 1 2 3 4 5 6 7=',
      [1, 14 / 12, 16 / 12, 18 / 12, 21 / 12, 2, 28 / 12, 32 / 12],
    ],
    ['{4::8}\n0 1 2 3 4==', [1, 5 / 4, 6 / 4, 7 / 4, 2]],
    ['{/6::3}\n0 1 2 3==', [1, 6 / 5, 6 / 4, 2]],
  ])('uses enumerated chords as scales without a redundant unison degree: %s', (source, ratios) => {
    const result = shape(source) as SequenceShape
    const collectPitches = (score: ScoreShape): number[] => {
      if (score.kind === 'attack') return [score.pitch.value.valueOf()]
      if (score.kind === 'sequence') return score.children.flatMap(collectPitches)
      if (score.kind === 'parallel') return score.branches.flatMap(collectPitches)
      return []
    }
    const pitches = collectPitches(result)

    expect(pitches).toHaveLength(ratios.length)
    ratios.forEach((expected, index) =>
      expect(pitches[index]).toBeCloseTo(1200 * Math.log2(expected)),
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
    ).toEqual([0, (1200 * Math.log2(3)) / 13, 1200 * Math.log2(3)])

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

  it('plays enumerated and inverted range chords in parallel', () => {
    const harmonic = shape('4::7') as ParallelShape
    expect(harmonic.branches.map((branch) => branch.kind)).toEqual([
      'attack',
      'attack',
      'attack',
      'attack',
    ])

    const minor = shape('/6::4') as ParallelShape
    const pitches = minor.branches.map((branch) => {
      if (branch.kind !== 'attack') throw new Error('Expected an attack.')
      return branch.pitch.value
    })
    expect(pitches[0]!.equals(Value.pitch(new Value(1)))).toBe(true)
    expect(pitches[1]!.equals(Value.pitch(new Value(6n, 5n)))).toBe(true)
    expect(pitches[2]!.equals(Value.pitch(new Value(3n, 2n)))).toBe(true)

    const expressions = shape('3/2 * 4:(4+1):6') as ParallelShape
    const expressionPitches = expressions.branches.map((branch) => {
      if (branch.kind !== 'attack') throw new Error('Expected an attack.')
      return branch.pitch.value
    })
    expect(expressionPitches[0]!.equals(Value.pitch(new Value(3n, 2n)))).toBe(true)
    expect(expressionPitches[1]!.equals(Value.pitch(new Value(15n, 8n)))).toBe(true)
    expect(expressionPitches[2]!.equals(Value.pitch(new Value(9n, 4n)))).toBe(true)
  })

  it('reports enumerated ranges over the runtime expansion limit', () => {
    const result = evaluateScoreShape(parse('1::10001').body[0] as Expression)
    expect(result).toMatchObject({ diagnostics: [{ code: 'XP_EXPANSION_LIMIT' }] })
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

  it('broadcasts equave shifts over score constructions', () => {
    const result = shape("'[0 1]") as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')

    expect(attacks.map((attack) => attack.pitch.value.valueOf())).toEqual([1200, 1300])
  })

  it.each([
    ['2 * [3/2 4/3]', [3, 8 / 3]],
    ['[3/2 4/3] * 2', [3, 8 / 3]],
  ])('broadcasts scalar operations over slots from either side: %s', (source, ratios) => {
    const result = shape(source) as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')

    expect(result.duration.equals(1)).toBe(true)
    attacks.forEach((attack, index) =>
      expect(attack.pitch.notationValue?.valueOf()).toBeCloseTo(1200 * Math.log2(ratios[index]!)),
    )
  })

  it.each([
    ['3/1 / (2/1, 4/1)', [3 / 2, 3 / 4]],
    ['(2/1, 4/1) / 3/1', [2 / 3, 4 / 3]],
  ])(
    'broadcasts scalar operations over parenthesized parallels from either side: %s',
    (source, ratios) => {
      const result = shape(source) as ParallelShape
      const attacks = result.branches.filter((branch) => branch.kind === 'attack')

      attacks.forEach((attack, index) =>
        expect(attack.pitch.notationValue?.valueOf()).toBeCloseTo(1200 * Math.log2(ratios[index]!)),
      )
    },
  )

  it('preserves structural score items while broadcasting', () => {
    const result = shape('[3/2 . @ff 4/3] * 2') as SequenceShape

    expect(result.children.map((child) => child.kind)).toEqual([
      'attack',
      'rest',
      'dynamic',
      'attack',
    ])
    const attacks = result.children.filter((child) => child.kind === 'attack')
    ;[3, 8 / 3].forEach((ratio, index) =>
      expect(attacks[index]!.pitch.notationValue?.valueOf()).toBeCloseTo(1200 * Math.log2(ratio)),
    )
  })

  it('combines matching score constructions elementwise', () => {
    const result = shape('[3/2 4/3] * [5/4 6/5]') as SequenceShape
    const attacks = result.children.filter((child) => child.kind === 'attack')

    ;[15 / 8, 8 / 5].forEach((ratio, index) =>
      expect(attacks[index]!.pitch.notationValue?.valueOf()).toBeCloseTo(1200 * Math.log2(ratio)),
    )
  })

  it('rejects broadcasting between differently shaped score constructions', () => {
    const result = evaluateScoreShape(parse('[3/2 4/3] * (5/4, 6/5)').body[0] as Expression)

    expect(result.diagnostics).not.toHaveLength(0)
    expect(result.diagnostics.every((diagnostic) => diagnostic.code === 'XP_TYPE_MISMATCH')).toBe(
      true,
    )
  })

  it('broadcasts nested scalar arithmetic before transposing a construction', () => {
    const result = shape('G + [P1 M2, M3, P5] / 2') as ParallelShape

    expect(result.branches).toHaveLength(3)
    expect(result.branches.map((branch) => branch.kind)).toEqual([
      'sequence',
      'sequence',
      'sequence',
    ])
    expect(
      result.branches.map(
        (branch) =>
          (branch as SequenceShape).children.filter((child) => child.kind === 'attack').length,
      ),
    ).toEqual([2, 1, 1])
  })

  it.each([
    ['G + ([P1, P5] + [P4, M2])', 'parallel'],
    ['G + ([P1 P5] + [P4 M2])', 'sequence'],
  ])('broadcasts construction arithmetic nested in an explicit group: %s', (source, kind) => {
    const result = shape(source)

    expect(result.kind).toBe(kind)
    const branches =
      result.kind === 'parallel'
        ? result.branches
        : result.kind === 'sequence'
          ? result.children
          : []
    expect(branches.filter((branch) => branch.kind === 'attack')).toHaveLength(2)
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

  it.each(['|:@x100001 C :|', `|:@x${'1' + '0'.repeat(400)} C :|`])(
    'rejects an unsafe repeat without iterating it',
    (source) => {
      const node = parse(source).body[0] as Expression
      const result = evaluateScoreShape(node)

      expect(result).not.toHaveProperty('shape')
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: 'XP_REPEAT_COUNT', severity: 'error' }),
      ])
    },
  )

  it('normalizes attached continuation as part of the complete fragment', () => {
    const result = shape('[3/2= 4/3]') as SequenceShape

    expect(result.duration.equals(1)).toBe(true)
    expect(result.children[0]!.duration.equals(new Fraction(2, 3))).toBe(true)
    expect(result.children[1]!.duration.equals(new Fraction(1, 3))).toBe(true)
    expect(result.tuplet).toBe(3)
  })

  it('adds a complete pulse for every continuation on a normalized slot', () => {
    const result = shape('[0 2 7] [0 2 7]= [0 2 7]===') as SequenceShape
    const groups = result.children as SequenceShape[]

    expect(groups.map((group) => group.duration.valueOf())).toEqual([1, 2, 4])
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
