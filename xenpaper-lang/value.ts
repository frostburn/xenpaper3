import { Fraction, type FractionValue } from 'xen-dev-utils/fraction'

type FractionInput = FractionValue

const ZERO = new Fraction(0)

export type DimensionInput = Readonly<Record<string, FractionInput>>

function cleanMap(map: Map<string, Fraction>): Map<string, Fraction> {
  for (const [key, value] of map) {
    if (value.isZero) map.delete(key)
  }
  return map
}

export class Dimensions {
  readonly powers: ReadonlyMap<string, Fraction>

  constructor(input: DimensionInput | ReadonlyMap<string, Fraction> = {}) {
    const powers = new Map<string, Fraction>()
    if (input instanceof Map) {
      for (const [key, value] of input) powers.set(key, new Fraction(value))
    } else {
      for (const [key, value] of Object.entries(input)) powers.set(key, new Fraction(value))
    }
    this.powers = cleanMap(powers)
  }

  add(other: Dimensions): Dimensions {
    const result = new Map(this.powers)
    for (const [key, value] of other.powers) {
      result.set(key, (result.get(key) ?? Fraction.ZERO).add(value))
    }
    return new Dimensions(cleanMap(result))
  }

  sub(other: Dimensions): Dimensions {
    const result = new Map(this.powers)
    for (const [key, value] of other.powers) {
      result.set(key, (result.get(key) ?? Fraction.ZERO).sub(value))
    }
    return new Dimensions(cleanMap(result))
  }

  scale(factor: FractionInput): Dimensions {
    const scalar = new Fraction(factor)
    const result = new Map<string, Fraction>()
    for (const [key, value] of this.powers) result.set(key, value.mul(scalar))
    return new Dimensions(result)
  }

  equals(other: Dimensions | DimensionInput): boolean {
    const rhs = other instanceof Dimensions ? other : new Dimensions(other)
    if (this.powers.size !== rhs.powers.size) return false
    for (const [key, value] of this.powers) {
      if (!value.equals(rhs.powers.get(key) ?? Fraction.ZERO)) return false
    }
    return true
  }

  get isDimensionless(): boolean {
    return this.powers.size === 0
  }

  toString(): string {
    if (this.isDimensionless) return '1'
    return [...this.powers.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => value.equals(1) ? key : `${key}^${value}`)
      .join(' ')
  }
}

type PrimeMap = ReadonlyMap<bigint, Fraction>

function factorInteger(value: bigint): Map<bigint, bigint> {
  const factors = new Map<bigint, bigint>()
  let remaining = value < 0n ? -value : value
  let factor = 2n
  while (factor * factor <= remaining) {
    while (remaining % factor === 0n) {
      factors.set(factor, (factors.get(factor) ?? 0n) + 1n)
      remaining /= factor
    }
    factor = factor === 2n ? 3n : factor + 2n
  }
  if (remaining > 1n) factors.set(remaining, (factors.get(remaining) ?? 0n) + 1n)
  return factors
}

function normalizePrimeMap(input: Map<number, Fraction>): Map<number, Fraction> {
  for (const [prime, exponent] of input) {
    if (exponent === 0) input.delete(prime)
  }
  return input
}

class ExactMonomial {
  readonly sign: -1 | 0 | 1
  readonly exponents: PrimeMap

  constructor(sign: -1 | 0 | 1, exponents: PrimeMap = new Map()) {
    this.sign = sign
    this.exponents = normalizePrimeMap(new Map(exponents))
  }

  static fromFraction(value: FractionInput): ExactMonomial {
    const fraction = new Fraction(value)
    if (fraction.isZero) return new ExactMonomial(0)
    const exponents = new Map<number, Fraction>()
    for (const [prime, exponent] of factorInteger(BigInt(fraction.n))) {
      exponents.set(Number(prime), new Fraction(Number(exponent)))
    }
    for (const [prime, exponent] of factorInteger(BigInt(fraction.d))) {
      exponents.set(Number(prime), (exponents.get(prime) ?? new Fraction(0)).sub(new Fraction(Number(exponent))))
    }
    return new ExactMonomial(fraction.s, exponents)
  }

  mul(other: ExactMonomial): ExactMonomial {
    if (this.sign === 0 || other.sign === 0) return ExactMonomial.ZERO
    const result = new Map(this.exponents)
    for (const [prime, exponent] of other.exponents) {
      result.set(prime, (result.get(prime) ?? Fraction.ZERO).add(exponent))
    }
    return new ExactMonomial((this.sign * other.sign) as -1 | 1, result)
  }

  div(other: ExactMonomial): ExactMonomial {
    if (other.sign === 0) throw new RangeError('Division by zero.')
    if (this.sign === 0) return ExactMonomial.ZERO
    const result = new Map(this.exponents)
    for (const [prime, exponent] of other.exponents) {
      result.set(prime, (result.get(prime) ?? ZERO).sub(exponent))
    }
    return new ExactMonomial((this.sign * other.sign) as -1 | 1, result)
  }

  pow(exponent: Fraction): ExactMonomial | null {
    if (exponent.isZero) return ExactMonomial.ONE
    if (this.sign === 0) {
      if (exponent.compare(0) < 0) throw new RangeError('Zero cannot be raised to a negative power.')
      return ExactMonomial.ZERO
    }

    let sign: -1 | 1 = 1
    if (this.sign < 0) {
      // A negative base has a real rational power only when the root degree is odd.
      if (exponent.denominator % 2n === 0n) return null
      sign = exponent.numerator % 2n === 0n ? 1 : -1
    }

    const result = new Map<bigint, Fraction>()
    for (const [prime, power] of this.exponents) result.set(prime, power.mul(exponent))
    return new ExactMonomial(sign, result)
  }

  addIfClosed(other: ExactMonomial): ExactMonomial | null {
    const left = this.toFraction()
    const right = other.toFraction()
    if (left && right) return ExactMonomial.fromFraction(left.add(right))
    if (this.equals(other)) return this.mul(ExactMonomial.fromFraction(2))
    if (this.sign === 0) return other
    if (other.sign === 0) return this
    return null
  }

  toFraction(): Fraction | null {
    if (this.sign === 0) return ZERO
    let numerator = 1
    let denominator = 1
    for (const [prime, exponent] of this.exponents) {
      if (exponent.d !== 1) return null
      if (exponent.n >= 0) numerator *= prime ** exponent.n
      else denominator *= prime ** (-exponent.n)
    }
    return new Fraction({s: this.sign, n: numerator, d: denominator})
  }

  equals(other: ExactMonomial): boolean {
    if (this.sign !== other.sign || this.exponents.size !== other.exponents.size) return false
    for (const [prime, exponent] of this.exponents) {
      if (!exponent.equals(other.exponents.get(prime) ?? ZERO)) return false
    }
    return true
  }

  valueOf(): number {
    if (this.sign === 0) return 0
    let result = this.sign
    for (const [prime, exponent] of this.exponents) {
      result *= Math.pow(Number(prime), exponent.valueOf())
    }
    return result
  }

  get isPositive(): boolean {
    return this.sign > 0
  }

  static readonly ZERO = new ExactMonomial(0)
  static readonly ONE = new ExactMonomial(1)
}

class ExactPitch {
  readonly cents: Fraction
  readonly logPrimes: ReadonlyMap<bigint, Fraction>

  constructor(cents: FractionInput = 0, logPrimes: PrimeMap = new Map()) {
    this.cents = Fraction.from(cents)
    const terms = new Map(logPrimes)
    // pitch(2^x) is exactly 1200x cents, so prime 2 has a canonical cents form.
    const octaveExponent = terms.get(2n)
    if (octaveExponent) {
      this.cents = this.cents.add(octaveExponent.mul(1200))
      terms.delete(2n)
    }
    this.logPrimes = normalizePrimeMap(terms)
  }

  static fromRatio(ratio: ExactMonomial): ExactPitch {
    if (!ratio.isPositive) throw new RangeError('Pitch conversion requires a positive dimensionless ratio.')
    return new ExactPitch(0, ratio.exponents)
  }

  add(other: ExactPitch): ExactPitch {
    const result = new Map(this.logPrimes)
    for (const [prime, coefficient] of other.logPrimes) {
      result.set(prime, (result.get(prime) ?? Fraction.ZERO).add(coefficient))
    }
    return new ExactPitch(this.cents.add(other.cents), result)
  }

  sub(other: ExactPitch): ExactPitch {
    const result = new Map(this.logPrimes)
    for (const [prime, coefficient] of other.logPrimes) {
      result.set(prime, (result.get(prime) ?? Fraction.ZERO).sub(coefficient))
    }
    return new ExactPitch(this.cents.sub(other.cents), result)
  }

  scale(factor: FractionInput): ExactPitch {
    const scalar = Fraction.from(factor)
    const result = new Map<bigint, Fraction>()
    for (const [prime, coefficient] of this.logPrimes) result.set(prime, coefficient.mul(scalar))
    return new ExactPitch(this.cents.mul(scalar), result)
  }

  toRatio(): ExactMonomial {
    const exponents = new Map(this.logPrimes)
    exponents.set(2n, (exponents.get(2n) ?? Fraction.ZERO).add(this.cents.div(1200)))
    return new ExactMonomial(1, exponents)
  }

  equals(other: ExactPitch): boolean {
    if (!this.cents.equals(other.cents) || this.logPrimes.size !== other.logPrimes.size) return false
    for (const [prime, coefficient] of this.logPrimes) {
      if (!coefficient.equals(other.logPrimes.get(prime) ?? Fraction.ZERO)) return false
    }
    return true
  }

  valueOf(): number {
    let cents = this.cents.valueOf()
    for (const [prime, coefficient] of this.logPrimes) {
      cents += 1200 * coefficient.valueOf() * Math.log2(Number(prime))
    }
    return cents
  }
}

type Magnitude =
  | { readonly kind: 'exact'; readonly value: ExactMonomial }
  | { readonly kind: 'pitch'; readonly value: ExactPitch }
  | { readonly kind: 'real'; readonly value: number }

export type ValueInput = Value | FractionInput

function coerceValue(value: ValueInput): Value {
  return value instanceof Value ? value : new Value(value)
}

function combineDimensions(left: Dimensions, right: Dimensions, operator: 'mul' | 'div'): Dimensions {
  return operator === 'mul' ? left.add(right) : left.sub(right)
}

export class Value {
  readonly magnitude: Magnitude
  readonly dimensions: Dimensions

  constructor(value: FractionInput = 0, dimensions: DimensionInput = {}) {
    this.magnitude = { kind: 'exact', value: ExactMonomial.fromFraction(value) }
    this.dimensions = new Dimensions(dimensions)
  }

  private static fromMagnitude(magnitude: Magnitude, dimensions: Dimensions): Value {
    const value = Object.create(Value.prototype) as Value
    Object.defineProperty(value, 'magnitude', { value: magnitude, enumerable: true })
    Object.defineProperty(value, 'dimensions', { value: dimensions, enumerable: true })
    return value
  }

  static real(value: number, dimensions: DimensionInput | Dimensions = {}): Value {
    if (!Number.isFinite(value)) throw new RangeError(`Expected a finite real value, got ${value}.`)
    return Value.fromMagnitude(
      { kind: 'real', value },
      dimensions instanceof Dimensions ? dimensions : new Dimensions(dimensions),
    )
  }

  static cents(value: FractionInput): Value {
    return Value.fromMagnitude(
      { kind: 'pitch', value: new ExactPitch(value) },
      new Dimensions({ pitch: 1 }),
    )
  }

  static decibels(value: FractionInput): Value {
    return new Value(value, { level: 1 })
  }

  static beats(value: FractionInput): Value {
    return new Value(value, { beats: 1 })
  }

  static seconds(value: FractionInput): Value {
    return new Value(value, { seconds: 1 })
  }

  static hertz(value: FractionInput): Value {
    return new Value(value, { seconds: -1 })
  }

  static pitch(ratioInput: ValueInput): Value {
    const ratio = coerceValue(ratioInput)
    if (!ratio.dimensions.isDimensionless) {
      throw new TypeError('Pitch conversion requires a dimensionless positive ratio.')
    }
    if (ratio.magnitude.kind === 'exact') {
      return Value.fromMagnitude(
        { kind: 'pitch', value: ExactPitch.fromRatio(ratio.magnitude.value) },
        new Dimensions({ pitch: 1 }),
      )
    }
    const numeric = ratio.valueOf()
    if (!(numeric > 0)) throw new RangeError('Pitch conversion requires a positive ratio.')
    return Value.real(1200 * Math.log2(numeric), { pitch: 1 })
  }

  static ratio(offset: Value): Value {
    if (!offset.dimensions.equals({ pitch: 1 })) {
      throw new TypeError('Ratio conversion requires a pitch displacement.')
    }
    if (offset.magnitude.kind === 'pitch') {
      return Value.fromMagnitude(
        { kind: 'exact', value: offset.magnitude.value.toRatio() },
        new Dimensions(),
      )
    }
    return Value.real(Math.pow(2, offset.valueOf() / 1200))
  }

  static equalDivision(
    steps: FractionInput,
    divisions: FractionInput,
    equave: ValueInput = new Value(2),
  ): Value {
    const divisionCount = Fraction.from(divisions)
    if (divisionCount.isZero) throw new RangeError('Equal division count cannot be zero.')
    return Value.pitch(coerceValue(equave)).mul(Fraction.from(steps).div(divisionCount))
  }

  add(otherInput: ValueInput): Value {
    const other = coerceValue(otherInput)
    if (!this.dimensions.equals(other.dimensions)) {
      throw new TypeError(`Cannot add incompatible dimensions ${this.dimensions} and ${other.dimensions}.`)
    }

    if (this.magnitude.kind === 'pitch' && other.magnitude.kind === 'pitch') {
      return Value.fromMagnitude(
        { kind: 'pitch', value: this.magnitude.value.add(other.magnitude.value) },
        this.dimensions,
      )
    }

    if (this.magnitude.kind === 'exact' && other.magnitude.kind === 'exact') {
      const exact = this.magnitude.value.addIfClosed(other.magnitude.value)
      if (exact) return Value.fromMagnitude({ kind: 'exact', value: exact }, this.dimensions)
    }

    return Value.real(this.valueOf() + other.valueOf(), this.dimensions)
  }

  sub(otherInput: ValueInput): Value {
    const other = coerceValue(otherInput)
    if (!this.dimensions.equals(other.dimensions)) {
      throw new TypeError(`Cannot subtract incompatible dimensions ${this.dimensions} and ${other.dimensions}.`)
    }

    if (this.magnitude.kind === 'pitch' && other.magnitude.kind === 'pitch') {
      return Value.fromMagnitude(
        { kind: 'pitch', value: this.magnitude.value.sub(other.magnitude.value) },
        this.dimensions,
      )
    }

    return this.add(other.neg())
  }

  neg(): Value {
    if (this.magnitude.kind === 'pitch') {
      return Value.fromMagnitude(
        { kind: 'pitch', value: this.magnitude.value.scale(-1) },
        this.dimensions,
      )
    }
    if (this.magnitude.kind === 'exact') {
      const sign = this.magnitude.value.sign === 0 ? 0 : -this.magnitude.value.sign
      return Value.fromMagnitude(
        { kind: 'exact', value: new ExactMonomial(sign as -1 | 0 | 1, this.magnitude.value.exponents) },
        this.dimensions,
      )
    }
    return Value.real(-this.magnitude.value, this.dimensions)
  }

  mul(otherInput: ValueInput): Value {
    const other = coerceValue(otherInput)
    const dimensions = combineDimensions(this.dimensions, other.dimensions, 'mul')

    const scaledPitch = this.scalePitchIfPossible(other)
    if (scaledPitch) return scaledPitch
    const reverseScaledPitch = other.scalePitchIfPossible(this)
    if (reverseScaledPitch) return reverseScaledPitch

    if (this.magnitude.kind === 'exact' && other.magnitude.kind === 'exact') {
      return Value.fromMagnitude(
        { kind: 'exact', value: this.magnitude.value.mul(other.magnitude.value) },
        dimensions,
      )
    }

    return Value.real(this.valueOf() * other.valueOf(), dimensions)
  }

  div(otherInput: ValueInput): Value {
    const other = coerceValue(otherInput)
    const dimensions = combineDimensions(this.dimensions, other.dimensions, 'div')

    if (this.magnitude.kind === 'pitch' && other.dimensions.isDimensionless) {
      const scalar = other.exactRational()
      if (scalar) {
        return Value.fromMagnitude(
          { kind: 'pitch', value: this.magnitude.value.scale(Fraction.ONE.div(scalar)) },
          dimensions,
        )
      }
    }

    if (this.magnitude.kind === 'exact' && other.magnitude.kind === 'exact') {
      return Value.fromMagnitude(
        { kind: 'exact', value: this.magnitude.value.div(other.magnitude.value) },
        dimensions,
      )
    }

    return Value.real(this.valueOf() / other.valueOf(), dimensions)
  }

  pow(exponentInput: ValueInput): Value {
    const exponentValue = coerceValue(exponentInput)
    if (!exponentValue.dimensions.isDimensionless) {
      throw new TypeError('Exponent must be dimensionless.')
    }
    const exponent = exponentValue.exactRational()

    if (!exponent && !this.dimensions.isDimensionless) {
      throw new TypeError('A unitful base requires an exact rational exponent.')
    }

    const dimensions = exponent ? this.dimensions.scale(exponent) : new Dimensions()
    if (this.magnitude.kind === 'exact' && exponent) {
      const exact = this.magnitude.value.pow(exponent)
      if (exact) return Value.fromMagnitude({ kind: 'exact', value: exact }, dimensions)
    }

    return Value.real(Math.pow(this.valueOf(), exponentValue.valueOf()), dimensions)
  }

  private scalePitchIfPossible(scalarCandidate: Value): Value | null {
    if (this.magnitude.kind !== 'pitch' || !scalarCandidate.dimensions.isDimensionless) return null
    const scalar = scalarCandidate.exactRational()
    if (!scalar) return null
    return Value.fromMagnitude(
      { kind: 'pitch', value: this.magnitude.value.scale(scalar) },
      this.dimensions,
    )
  }

  exactRational(): Fraction | null {
    if (this.magnitude.kind !== 'exact' || !this.dimensions.isDimensionless) return null
    return this.magnitude.value.toFraction()
  }

  equals(otherInput: ValueInput): boolean {
    const other = coerceValue(otherInput)
    if (!this.dimensions.equals(other.dimensions)) return false
    if (this.magnitude.kind !== other.magnitude.kind) return false
    switch (this.magnitude.kind) {
      case 'exact':
        return other.magnitude.kind === 'exact' && this.magnitude.value.equals(other.magnitude.value)
      case 'pitch':
        return other.magnitude.kind === 'pitch' && this.magnitude.value.equals(other.magnitude.value)
      case 'real':
        return other.magnitude.kind === 'real' && Object.is(this.magnitude.value, other.magnitude.value)
    }
  }

  approximatelyEquals(otherInput: ValueInput, tolerance: Value): boolean {
    const other = coerceValue(otherInput)
    if (!this.dimensions.equals(other.dimensions) || !this.dimensions.equals(tolerance.dimensions)) return false
    return Math.abs(this.valueOf() - other.valueOf()) <= Math.abs(tolerance.valueOf())
  }

  compare(otherInput: ValueInput): number {
    const other = coerceValue(otherInput)
    if (!this.dimensions.equals(other.dimensions)) {
      throw new TypeError(`Cannot compare incompatible dimensions ${this.dimensions} and ${other.dimensions}.`)
    }
    const difference = this.valueOf() - other.valueOf()
    return difference < 0 ? -1 : difference > 0 ? 1 : 0
  }

  isExact(): boolean {
    return this.magnitude.kind !== 'real'
  }

  valueOf(): number {
    switch (this.magnitude.kind) {
      case 'exact': return this.magnitude.value.valueOf()
      case 'pitch': return this.magnitude.value.valueOf()
      case 'real': return this.magnitude.value
    }
  }

  toString(): string {
    return `${this.valueOf()} [${this.dimensions}]`
  }
}
