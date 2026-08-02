import { Fraction, Value } from '../src/index.js'

let passed = 0

function test(name: string, body: () => void): void {
  try {
    body()
    passed += 1
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    throw error
  }
}

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message)
}

function equal(actual: Value, expected: Value): void {
  assert(actual.equals(expected), `Expected ${actual} to equal ${expected}.`)
}

function close(actual: number, expected: number, tolerance = 1e-10): void {
  assert(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}.`)
}

function throws(body: () => void, pattern: RegExp): void {
  try {
    body()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assert(pattern.test(message), `Expected error ${JSON.stringify(message)} to match ${pattern}.`)
    return
  }
  throw new Error('Expected operation to throw.')
}

test('adds integers exactly', () => {
  equal(new Value(5).add(new Value(7)), new Value(new Fraction(12)))
})

test('divides fractions exactly', () => {
  const majorThird = new Value(new Fraction(81, 64))
  const syntonicComma = new Value(new Fraction(81, 80))
  equal(majorThird.div(syntonicComma), new Value(new Fraction(5, 4)))
})

test('cancels huge exact interval stacks', () => {
  const archytas = new Value(new Fraction(64, 63))
  const unity = archytas
    .pow(new Value(100))
    .div(new Value(2).pow(600))
    .mul(new Value(7).pow(100))
    .mul(new Value(3).pow(200))
  equal(unity, new Value(1))
})

test('adds exact beat fractions to a whole beat', () => {
  const triplet = Value.beats(new Fraction(1, 3))
  equal(triplet.add(triplet).add(triplet), Value.beats(1))
})

test('keeps long groove grids exact at bar boundaries', () => {
  const grooveCell = Value.beats(new Fraction(1, 12))
  equal(grooveCell.mul(48), Value.beats(4))
})

test('converts beats through tempo with exact dimensions', () => {
  const tempo = Value.beats(2).div(Value.seconds(1))
  const beatTime = Value.beats(3)
  equal(beatTime.div(tempo), Value.seconds(new Fraction(3, 2)))
})

test('rejects direct addition of beats and seconds', () => {
  throws(() => Value.beats(1).add(Value.seconds(1)), /incompatible dimensions/i)
})

test('requires dimensionless exponents', () => {
  throws(() => new Value(2).pow(Value.cents(100)), /dimensionless/i)
})

test('falls back to an approximate real for sqrt(2) + sqrt(3)', () => {
  const sqrtTwo = new Value(2).pow(new Fraction(1, 2))
  const sqrtThree = new Value(3).pow(new Fraction(1, 2))
  const sum = sqrtTwo.add(sqrtThree)
  assert(!sum.isExact())
  close(sum.valueOf(), Math.sqrt(2) + Math.sqrt(3))
})

test('keeps equal radicals exact when addition remains monomial', () => {
  const sqrtTwo = new Value(2).pow(new Fraction(1, 2))
  const doubled = sqrtTwo.add(sqrtTwo)
  assert(doubled.isExact())
  equal(doubled.pow(2), new Value(8))
})

test('represents cents as an exact additive pitch quantity', () => {
  const semioctave = Value.cents(600)
  equal(semioctave.add(semioctave), Value.cents(1200))
})

test('converts one fifth of an octave to an exact ratio', () => {
  const oneOfFive = Value.ratio(Value.cents(240))
  equal(oneOfFive.pow(5), new Value(2))
})

test('normalizes pitch(2) to exactly 1200 cents', () => {
  equal(Value.pitch(2), Value.cents(1200))
})

test('normalizes 7\\12 to exactly 700 cents', () => {
  equal(Value.equalDivision(7, 12), Value.cents(700))
})

test('keeps one step of 13-EDT exact in additive pitch space', () => {
  const step = Value.equalDivision(1, 13, 3)
  equal(step.mul(13), Value.pitch(3))
})

test('converts one step of 13-EDT to an exact monomial ratio', () => {
  const stepRatio = Value.ratio(Value.equalDivision(1, 13, 3))
  equal(stepRatio.pow(13), new Value(3))
})

test('does not accumulate error in a huge 13-EDT stack', () => {
  const stack = Value.equalDivision(1, 13, 3).mul(13_000)
  equal(Value.ratio(stack), new Value(3).pow(1000))
})

test('mixes exact cents and non-octave equal divisions', () => {
  const mixed = Value.cents(700).add(Value.equalDivision(1, 13, 3))
  const expected = new Value(2)
    .pow(new Fraction(7, 12))
    .mul(new Value(3).pow(new Fraction(1, 13)))
  equal(Value.ratio(mixed), expected)
})

test('round-trips an exact positive ratio through pitch space', () => {
  const ratio = new Value(new Fraction(45, 32))
  equal(Value.ratio(Value.pitch(ratio)), ratio)
})

test('subtracts exact pitch displacements predictably', () => {
  const fifthMinusThird = Value.pitch(new Value(new Fraction(3, 2)))
    .sub(Value.pitch(new Value(new Fraction(5, 4))))
  equal(Value.ratio(fifthMinusThird), new Value(new Fraction(6, 5)))
})

test('keeps a 12-EDO fifth error exact', () => {
  const error = Value.pitch(new Value(new Fraction(3, 2))).sub(Value.cents(700))
  assert(error.isExact())
  close(error.valueOf(), 1.955000865387433)
})

test('rejects pitch conversion of a frequency', () => {
  throws(() => Value.pitch(Value.hertz(440)), /dimensionless positive ratio/i)
})

test('rejects ratio conversion of decibels', () => {
  throws(() => Value.ratio(Value.decibels(6)), /pitch displacement/i)
})

test('applies a pitch displacement explicitly to frequency', () => {
  const a4 = Value.hertz(440)
  const fifth = Value.pitch(new Value(new Fraction(3, 2)))
  equal(a4.mul(Value.ratio(fifth)), Value.hertz(660))
})

test('represents decibels as an ordinary exact quantity', () => {
  equal(Value.decibels(1).add(Value.decibels(2)), Value.decibels(3))
})

test('converts decibels only through an explicit formula', () => {
  const amplitude = new Value(10).pow(Value.decibels(2).div(Value.decibels(20)))
  close(amplitude.valueOf(), 1.2589254117941673)
})

test('does not use epsilon equality', () => {
  const exact = Value.cents(700)
  const approximate = Value.real(700.0000000001, { pitch: 1 })
  assert(!exact.equals(approximate))
  assert(exact.approximatelyEquals(approximate, Value.cents(new Fraction(1, 1_000_000))))
})

console.log(`\n${passed} smoke tests passed.`)
