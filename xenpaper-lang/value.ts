import { Fraction, type FractionValue } from 'xen-dev-utils/fraction'
import {
  fractionalAdd,
  fractionalMonzosEqual,
  fractionalScale,
  fractionalSub,
  monzoToFraction,
  toMonzo,
  type ProtoFractionalMonzo,
} from 'xen-dev-utils/monzo'
import { PRIMES } from 'xen-dev-utils/primes'

type FractionInput = FractionValue

/** Dimension exponents are deliberately numbers: they are hot, mundane state. */
export type DimensionInput = Readonly<Record<string, number>>

export class Dimensions {
  readonly powers: ReadonlyMap<string, number>

  constructor(input: DimensionInput | ReadonlyMap<string, number> = {}) {
    const powers = new Map(input instanceof Map ? input : Object.entries(input))
    for (const [key, power] of powers) {
      if (!Number.isFinite(power)) throw new RangeError(`Invalid power for dimension ${key}.`)
      if (power === 0) powers.delete(key)
    }
    this.powers = powers
  }

  add(other: Dimensions): Dimensions {
    const result = new Map(this.powers)
    for (const [key, power] of other.powers) result.set(key, (result.get(key) ?? 0) + power)
    return new Dimensions(result)
  }

  sub(other: Dimensions): Dimensions {
    const result = new Map(this.powers)
    for (const [key, power] of other.powers) result.set(key, (result.get(key) ?? 0) - power)
    return new Dimensions(result)
  }

  scale(factor: FractionInput): Dimensions {
    const scalar = new Fraction(factor).valueOf()
    return new Dimensions(new Map([...this.powers].map(([key, power]) => [key, power * scalar])))
  }

  equals(other: Dimensions | DimensionInput): boolean {
    const rhs = other instanceof Dimensions ? other : new Dimensions(other)
    if (this.powers.size !== rhs.powers.size) return false
    for (const [key, power] of this.powers) if (power !== rhs.powers.get(key)) return false
    return true
  }

  get isDimensionless(): boolean {
    return this.powers.size === 0
  }

  toString(): string {
    if (this.isDimensionless) return '1'
    return [...this.powers]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, power]) => (power === 1 ? key : `${key}^${power}`))
      .join(' ')
  }
}

class ExactMonomial {
  constructor(
    readonly sign: -1 | 0 | 1,
    readonly exponents: ProtoFractionalMonzo = [],
  ) {}

  static fromFraction(input: FractionInput): ExactMonomial {
    const value = new Fraction(input)
    if (!value.n) return ExactMonomial.ZERO
    return new ExactMonomial(value.s as -1 | 1, toMonzo(value))
  }

  mul(other: ExactMonomial): ExactMonomial {
    if (!this.sign || !other.sign) return ExactMonomial.ZERO
    return new ExactMonomial(
      (this.sign * other.sign) as -1 | 1,
      fractionalAdd(this.exponents, other.exponents),
    )
  }

  div(other: ExactMonomial): ExactMonomial {
    if (!other.sign) throw new RangeError('Division by zero.')
    if (!this.sign) return ExactMonomial.ZERO
    return new ExactMonomial(
      (this.sign * other.sign) as -1 | 1,
      fractionalSub(this.exponents, other.exponents),
    )
  }

  pow(exponent: Fraction): ExactMonomial | null {
    if (!exponent.n) return ExactMonomial.ONE
    if (!this.sign) {
      if (exponent.compare(0) < 0)
        throw new RangeError('Zero cannot be raised to a negative power.')
      return ExactMonomial.ZERO
    }
    if (this.sign < 0 && exponent.d % 2 === 0) return null
    const sign = this.sign < 0 && exponent.n % 2 ? -1 : 1
    return new ExactMonomial(sign, fractionalScale(this.exponents, exponent))
  }

  addIfClosed(other: ExactMonomial): ExactMonomial | null {
    const left = this.toFraction()
    const right = other.toFraction()
    if (left && right) return ExactMonomial.fromFraction(left.add(right))
    if (!this.sign) return other
    if (!other.sign) return this
    if (this.equals(other)) return this.mul(ExactMonomial.fromFraction(2))
    return null
  }

  toFraction(): Fraction | null {
    if (!this.sign) return new Fraction(0)
    const integral = this.exponents.map((component) => {
      const fraction = new Fraction(component)
      return fraction.d === 1 ? fraction.s * fraction.n : NaN
    })
    if (integral.some(Number.isNaN)) return null
    const result = monzoToFraction(integral)
    return this.sign < 0 ? result.neg() : result
  }

  equals(other: ExactMonomial): boolean {
    return this.sign === other.sign && fractionalMonzosEqual(this.exponents, other.exponents)
  }

  valueOf(): number {
    if (!this.sign) return 0
    let result = this.sign
    for (let i = 0; i < this.exponents.length; ++i) {
      result *= Math.pow(PRIMES[i], new Fraction(this.exponents[i]).valueOf())
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
  readonly logPrimes: ProtoFractionalMonzo

  constructor(logPrimes: ProtoFractionalMonzo = []) {
    this.logPrimes = logPrimes.map((value) => new Fraction(value))
  }

  static fromCents(cents: FractionInput): ExactPitch {
    return new ExactPitch([new Fraction(cents).div(1200)])
  }

  static fromRatio(ratio: ExactMonomial): ExactPitch {
    if (!ratio.isPositive)
      throw new RangeError('Pitch conversion requires a positive dimensionless ratio.')
    return new ExactPitch(ratio.exponents)
  }

  add(other: ExactPitch): ExactPitch {
    return new ExactPitch(fractionalAdd(this.logPrimes, other.logPrimes))
  }
  sub(other: ExactPitch): ExactPitch {
    return new ExactPitch(fractionalSub(this.logPrimes, other.logPrimes))
  }
  scale(factor: FractionInput): ExactPitch {
    return new ExactPitch(fractionalScale(this.logPrimes, factor))
  }

  toRatio(): ExactMonomial {
    return new ExactMonomial(1, this.logPrimes)
  }

  equals(other: ExactPitch): boolean {
    return fractionalMonzosEqual(this.logPrimes, other.logPrimes)
  }

  valueOf(): number {
    return 1200 * Math.log2(this.toRatio().valueOf())
  }
}

type Magnitude =
  | { readonly kind: 'exact'; readonly value: ExactMonomial }
  | { readonly kind: 'pitch'; readonly value: ExactPitch }
  | { readonly kind: 'real'; readonly value: number }

export type ValueInput = Value | FractionInput
const coerceValue = (value: ValueInput): Value =>
  value instanceof Value ? value : new Value(value)

export class Value {
  readonly magnitude: Magnitude
  readonly dimensions: Dimensions

  constructor(value: FractionInput = 0, dimensions: DimensionInput = {}) {
    this.magnitude = { kind: 'exact', value: ExactMonomial.fromFraction(value) }
    this.dimensions = new Dimensions(dimensions)
  }

  private static fromMagnitude(magnitude: Magnitude, dimensions: Dimensions): Value {
    const value = Object.create(Value.prototype) as Value
    Object.defineProperties(value, {
      magnitude: { value: magnitude, enumerable: true },
      dimensions: { value: dimensions, enumerable: true },
    })
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
      { kind: 'pitch', value: ExactPitch.fromCents(value) },
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

  static pitch(input: ValueInput): Value {
    const ratio = coerceValue(input)
    if (!ratio.dimensions.isDimensionless)
      throw new TypeError('Pitch conversion requires a dimensionless positive ratio.')
    if (ratio.magnitude.kind === 'exact')
      return Value.fromMagnitude(
        { kind: 'pitch', value: ExactPitch.fromRatio(ratio.magnitude.value) },
        new Dimensions({ pitch: 1 }),
      )
    if (!(ratio.valueOf() > 0)) throw new RangeError('Pitch conversion requires a positive ratio.')
    return Value.real(1200 * Math.log2(ratio.valueOf()), { pitch: 1 })
  }

  static ratio(offset: Value): Value {
    if (!offset.dimensions.equals({ pitch: 1 }))
      throw new TypeError('Ratio conversion requires a pitch displacement.')
    if (offset.magnitude.kind === 'pitch')
      return Value.fromMagnitude(
        { kind: 'exact', value: offset.magnitude.value.toRatio() },
        new Dimensions(),
      )
    return Value.real(Math.pow(2, offset.valueOf() / 1200))
  }

  static equalDivision(
    steps: FractionInput,
    divisions: FractionInput,
    equave: ValueInput = 2,
  ): Value {
    const count = new Fraction(divisions)
    if (!count.n) throw new RangeError('Equal division count cannot be zero.')
    return Value.pitch(equave).mul(new Fraction(steps).div(count))
  }

  add(input: ValueInput): Value {
    const other = coerceValue(input)
    this.assertCompatible(other, 'add')
    if (this.magnitude.kind === 'pitch' && other.magnitude.kind === 'pitch')
      return Value.fromMagnitude(
        { kind: 'pitch', value: this.magnitude.value.add(other.magnitude.value) },
        this.dimensions,
      )
    if (this.magnitude.kind === 'exact' && other.magnitude.kind === 'exact') {
      const exact = this.magnitude.value.addIfClosed(other.magnitude.value)
      if (exact) return Value.fromMagnitude({ kind: 'exact', value: exact }, this.dimensions)
    }
    return Value.real(this.valueOf() + other.valueOf(), this.dimensions)
  }

  sub(input: ValueInput): Value {
    const other = coerceValue(input)
    this.assertCompatible(other, 'subtract')
    if (this.magnitude.kind === 'pitch' && other.magnitude.kind === 'pitch')
      return Value.fromMagnitude(
        { kind: 'pitch', value: this.magnitude.value.sub(other.magnitude.value) },
        this.dimensions,
      )
    return this.add(other.neg())
  }

  neg(): Value {
    if (this.magnitude.kind === 'pitch')
      return Value.fromMagnitude(
        { kind: 'pitch', value: this.magnitude.value.scale(-1) },
        this.dimensions,
      )
    if (this.magnitude.kind === 'exact')
      return Value.fromMagnitude(
        {
          kind: 'exact',
          value: new ExactMonomial(
            this.magnitude.value.sign ? (-this.magnitude.value.sign as -1 | 1) : 0,
            this.magnitude.value.exponents,
          ),
        },
        this.dimensions,
      )
    return Value.real(-this.magnitude.value, this.dimensions)
  }

  mul(input: ValueInput): Value {
    const other = coerceValue(input)
    const dimensions = this.dimensions.add(other.dimensions)
    const scaled = this.scalePitch(other) ?? other.scalePitch(this)
    if (scaled) return scaled
    if (this.magnitude.kind === 'exact' && other.magnitude.kind === 'exact')
      return Value.fromMagnitude(
        { kind: 'exact', value: this.magnitude.value.mul(other.magnitude.value) },
        dimensions,
      )
    return Value.real(this.valueOf() * other.valueOf(), dimensions)
  }

  div(input: ValueInput): Value {
    const other = coerceValue(input)
    const dimensions = this.dimensions.sub(other.dimensions)
    if (this.magnitude.kind === 'pitch' && other.dimensions.isDimensionless) {
      const scalar = other.exactRational()
      if (scalar)
        return Value.fromMagnitude(
          { kind: 'pitch', value: this.magnitude.value.scale(scalar.inverse()) },
          dimensions,
        )
    }
    if (this.magnitude.kind === 'exact' && other.magnitude.kind === 'exact')
      return Value.fromMagnitude(
        { kind: 'exact', value: this.magnitude.value.div(other.magnitude.value) },
        dimensions,
      )
    return Value.real(this.valueOf() / other.valueOf(), dimensions)
  }

  pow(input: ValueInput): Value {
    const exponentValue = coerceValue(input)
    if (!exponentValue.dimensions.isDimensionless)
      throw new TypeError('Exponent must be dimensionless.')
    const exponent = exponentValue.exactRational()
    if (!exponent && !this.dimensions.isDimensionless)
      throw new TypeError('A unitful base requires an exact rational exponent.')
    const dimensions = exponent ? this.dimensions.scale(exponent) : new Dimensions()
    if (this.magnitude.kind === 'exact' && exponent) {
      const exact = this.magnitude.value.pow(exponent)
      if (exact) return Value.fromMagnitude({ kind: 'exact', value: exact }, dimensions)
    }
    return Value.real(Math.pow(this.valueOf(), exponentValue.valueOf()), dimensions)
  }

  private scalePitch(candidate: Value): Value | null {
    if (this.magnitude.kind !== 'pitch' || !candidate.dimensions.isDimensionless) return null
    const scalar = candidate.exactRational()
    return scalar
      ? Value.fromMagnitude(
          { kind: 'pitch', value: this.magnitude.value.scale(scalar) },
          this.dimensions,
        )
      : null
  }

  private assertCompatible(other: Value, verb: string): void {
    if (!this.dimensions.equals(other.dimensions))
      throw new TypeError(
        `Cannot ${verb} incompatible dimensions ${this.dimensions} and ${other.dimensions}.`,
      )
  }

  exactRational(): Fraction | null {
    return this.magnitude.kind === 'exact' && this.dimensions.isDimensionless
      ? this.magnitude.value.toFraction()
      : null
  }

  equals(input: ValueInput): boolean {
    const other = coerceValue(input)
    if (!this.dimensions.equals(other.dimensions) || this.magnitude.kind !== other.magnitude.kind)
      return false
    if (this.magnitude.kind === 'exact' && other.magnitude.kind === 'exact')
      return this.magnitude.value.equals(other.magnitude.value)
    if (this.magnitude.kind === 'pitch' && other.magnitude.kind === 'pitch')
      return this.magnitude.value.equals(other.magnitude.value)
    return (
      this.magnitude.kind === 'real' &&
      other.magnitude.kind === 'real' &&
      Object.is(this.magnitude.value, other.magnitude.value)
    )
  }

  approximatelyEquals(input: ValueInput, tolerance: Value): boolean {
    const other = coerceValue(input)
    return (
      this.dimensions.equals(other.dimensions) &&
      this.dimensions.equals(tolerance.dimensions) &&
      Math.abs(this.valueOf() - other.valueOf()) <= Math.abs(tolerance.valueOf())
    )
  }

  compare(input: ValueInput): number {
    const other = coerceValue(input)
    this.assertCompatible(other, 'compare')
    const difference = this.valueOf() - other.valueOf()
    return difference < 0 ? -1 : difference > 0 ? 1 : 0
  }

  isExact(): boolean {
    return this.magnitude.kind !== 'real'
  }
  valueOf(): number {
    return this.magnitude.value.valueOf()
  }
  toString(): string {
    return `${this.valueOf()} [${this.dimensions}]`
  }
}
