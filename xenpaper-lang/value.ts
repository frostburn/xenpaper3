import { Fraction, gcd, type FractionValue } from 'xen-dev-utils/fraction'
import { bigAbs, primeFactorize } from 'xen-dev-utils/monzo'
import { BIG_INT_PRIMES, PRIMES } from 'xen-dev-utils/primes'

export function primeFactorizeX(value: bigint, denominator?: bigint): Map<number, number>
export function primeFactorizeX(value: FractionValue, denominator?: number): Map<number, number>
export function primeFactorizeX(
  value: FractionValue | bigint,
  denominator?: number | bigint,
): Map<number, number> {
  if (typeof value === 'bigint' || typeof denominator === 'bigint') {
    if (typeof value !== 'bigint' || typeof denominator === 'number') {
      throw new TypeError('BigInt numerator and denominator must both be BigInts.')
    }
    let numerator = value
    let divisor = denominator ?? 1n
    if (divisor === 0n) throw new RangeError('Division by zero.')

    const commonFactor = bigAbs(gcd(numerator, divisor))
    numerator /= commonFactor
    divisor /= commonFactor
    const result = new Map<number, number>()
    if (numerator === 0n) {
      result.set(0, 1)
      return result
    }
    if (numerator < 0n !== divisor < 0n) result.set(-1, 1)
    numerator = bigAbs(numerator)
    divisor = bigAbs(divisor)

    for (let i = 0; i < BIG_INT_PRIMES.length; ++i) {
      const prime = BIG_INT_PRIMES[i]
      let exponent = 0
      while (numerator % prime === 0n) {
        numerator /= prime
        ++exponent
      }
      while (divisor % prime === 0n) {
        divisor /= prime
        --exponent
      }
      if (exponent) result.set(PRIMES[i], exponent)
      if (
        numerator <= BigInt(Number.MAX_SAFE_INTEGER) &&
        divisor <= BigInt(Number.MAX_SAFE_INTEGER)
      )
        break
    }

    if (numerator > BigInt(Number.MAX_SAFE_INTEGER) || divisor > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error(
        `Factorization not implemented for residuals above ${Number.MAX_SAFE_INTEGER}.`,
      )

    for (const [prime, exponent] of primeFactorize(Number(numerator))) {
      result.set(prime, (result.get(prime) ?? 0) + exponent)
    }
    for (const [prime, exponent] of primeFactorize(Number(divisor))) {
      const combined = (result.get(prime) ?? 0) - exponent
      if (combined) result.set(prime, combined)
      else result.delete(prime)
    }
    return result
  }
  return primeFactorize(denominator === undefined ? value : new Fraction(value, denominator))
}

type SparseMonzo = ReadonlyMap<number, FractionValue>

function addMonzos(left: SparseMonzo, right: SparseMonzo, subtract = false): Map<number, Fraction> {
  const result = new Map<number, Fraction>()
  for (const [prime, exponent] of left) result.set(prime, new Fraction(exponent))
  for (const [prime, exponent] of right) {
    const current = result.get(prime) ?? new Fraction(0)
    const combined = subtract ? current.sub(exponent) : current.add(exponent)
    if (combined.n) result.set(prime, combined)
    else result.delete(prime)
  }
  return result
}

function scaleMonzo(monzo: SparseMonzo, factor: FractionValue): Map<number, Fraction> {
  const result = new Map<number, Fraction>()
  for (const [prime, exponent] of monzo) {
    const scaled = new Fraction(exponent).mul(factor)
    if (scaled.n) result.set(prime, scaled)
  }
  return result
}

function monzosEqual(left: SparseMonzo, right: SparseMonzo): boolean {
  if (left.size !== right.size) return false
  for (const [prime, exponent] of left) {
    const other = right.get(prime)
    if (other === undefined || !new Fraction(exponent).equals(other)) return false
  }
  return true
}

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

  scale(factor: FractionValue): Dimensions {
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
    readonly exponents: SparseMonzo = new Map(),
  ) {}

  static fromFraction(input: FractionValue | bigint, denominator?: bigint): ExactMonomial {
    const factors =
      typeof input === 'bigint' ? primeFactorizeX(input, denominator) : primeFactorizeX(input)
    if (factors.has(0)) return ExactMonomial.ZERO
    const sign = factors.delete(-1) ? -1 : 1
    return new ExactMonomial(sign, factors)
  }

  mul(other: ExactMonomial): ExactMonomial {
    if (!this.sign || !other.sign) return ExactMonomial.ZERO
    return new ExactMonomial(
      (this.sign * other.sign) as -1 | 1,
      addMonzos(this.exponents, other.exponents),
    )
  }

  div(other: ExactMonomial): ExactMonomial {
    if (!other.sign) throw new RangeError('Division by zero.')
    if (!this.sign) return ExactMonomial.ZERO
    return new ExactMonomial(
      (this.sign * other.sign) as -1 | 1,
      addMonzos(this.exponents, other.exponents, true),
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
    return new ExactMonomial(sign, scaleMonzo(this.exponents, exponent))
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
    let result = new Fraction(1)
    for (const [prime, component] of this.exponents) {
      const exponent = new Fraction(component)
      if (exponent.d !== 1) return null
      const factor = new Fraction(prime).pow(exponent)
      if (!factor) return null
      result = result.mul(factor)
    }
    return this.sign < 0 ? result.neg() : result
  }

  equals(other: ExactMonomial): boolean {
    return this.sign === other.sign && monzosEqual(this.exponents, other.exponents)
  }

  valueOf(): number {
    if (!this.sign) return 0
    let result = this.sign
    for (const [prime, exponent] of this.exponents) {
      result *= Math.pow(prime, new Fraction(exponent).valueOf())
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
  readonly logPrimes: SparseMonzo

  constructor(logPrimes: SparseMonzo = new Map()) {
    this.logPrimes = new Map(logPrimes)
  }

  static fromCents(cents: FractionValue): ExactPitch {
    return new ExactPitch(new Map([[2, new Fraction(cents).div(1200)]]))
  }

  static fromRatio(ratio: ExactMonomial): ExactPitch {
    if (!ratio.isPositive)
      throw new RangeError('Pitch conversion requires a positive dimensionless ratio.')
    return new ExactPitch(ratio.exponents)
  }

  add(other: ExactPitch): ExactPitch {
    return new ExactPitch(addMonzos(this.logPrimes, other.logPrimes))
  }
  sub(other: ExactPitch): ExactPitch {
    return new ExactPitch(addMonzos(this.logPrimes, other.logPrimes, true))
  }
  scale(factor: FractionValue): ExactPitch {
    return new ExactPitch(scaleMonzo(this.logPrimes, factor))
  }

  toRatio(): ExactMonomial {
    return new ExactMonomial(1, this.logPrimes)
  }

  equals(other: ExactPitch): boolean {
    return monzosEqual(this.logPrimes, other.logPrimes)
  }

  valueOf(): number {
    return 1200 * Math.log2(this.toRatio().valueOf())
  }
}

type Magnitude =
  | { readonly kind: 'exact'; readonly value: ExactMonomial }
  | { readonly kind: 'pitch'; readonly value: ExactPitch }
  | { readonly kind: 'real'; readonly value: number }

export type ValueInput = Value | FractionValue | bigint
const coerceValue = (value: ValueInput): Value =>
  value instanceof Value ? value : new Value(value)

export class Value {
  readonly magnitude: Magnitude
  readonly dimensions: Dimensions

  constructor(value?: FractionValue | bigint, dimensions?: DimensionInput)
  constructor(numerator: bigint, denominator: bigint, dimensions?: DimensionInput)
  constructor(
    value: FractionValue | bigint = 0,
    denominatorOrDimensions: bigint | DimensionInput = {},
    dimensions: DimensionInput = {},
  ) {
    const denominator =
      typeof denominatorOrDimensions === 'bigint' ? denominatorOrDimensions : undefined
    const dimensionInput =
      typeof denominatorOrDimensions === 'bigint' ? dimensions : denominatorOrDimensions
    this.magnitude = { kind: 'exact', value: ExactMonomial.fromFraction(value, denominator) }
    this.dimensions = new Dimensions(dimensionInput)
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
  static cents(value: FractionValue): Value {
    return Value.fromMagnitude(
      { kind: 'pitch', value: ExactPitch.fromCents(value) },
      new Dimensions({ pitch: 1 }),
    )
  }
  static decibels(value: FractionValue): Value {
    return new Value(value, { level: 1 })
  }
  static beats(value: FractionValue): Value {
    return new Value(value, { beats: 1 })
  }
  static seconds(value: FractionValue): Value {
    return new Value(value, { seconds: 1 })
  }
  static hertz(value: FractionValue): Value {
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
    steps: FractionValue,
    divisions: FractionValue,
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
    if (this.magnitude.kind === 'pitch' && other.magnitude.kind === 'pitch') {
      throw new TypeError('Pitch displacements cannot be multiplied together.')
    }
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
    if (this.magnitude.kind === 'pitch') {
      throw new TypeError('Pitch displacements cannot be exponentiated.')
    }
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
    if (this.strictEquals(other)) return true
    if (this.magnitude.kind === 'pitch' && other.magnitude.kind === 'exact') {
      return (
        other.dimensions.isDimensionless &&
        other.magnitude.value.sign === 1 &&
        monzosEqual(this.magnitude.value.logPrimes, other.magnitude.value.exponents)
      )
    }
    if (this.magnitude.kind === 'exact' && other.magnitude.kind === 'pitch') {
      return (
        this.dimensions.isDimensionless &&
        this.magnitude.value.sign === 1 &&
        monzosEqual(this.magnitude.value.exponents, other.magnitude.value.logPrimes)
      )
    }
    return false
  }

  strictEquals(input: ValueInput): boolean {
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
