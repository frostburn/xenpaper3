import { Fraction, type FractionValue } from 'xen-dev-utils/fraction'
import { primeFactorize } from 'xen-dev-utils/monzo'
import { centsToValue, valueToCents } from 'xen-dev-utils/conversion'

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

export type DimensionInput = Readonly<Record<string, FractionValue>>

export class Dimensions {
  readonly powers: ReadonlyMap<string, Fraction>

  constructor(input: DimensionInput | ReadonlyMap<string, FractionValue> = {}) {
    const powers = new Map(
      [...(input instanceof Map ? input : Object.entries(input))].map(([key, power]) => [
        key,
        new Fraction(power),
      ]),
    )
    for (const [key, power] of powers) {
      if (!power.n) powers.delete(key)
    }
    this.powers = powers
  }

  add(other: Dimensions): Dimensions {
    const result = new Map(this.powers)
    for (const [key, power] of other.powers)
      result.set(key, (result.get(key) ?? new Fraction(0)).add(power))
    return new Dimensions(result)
  }

  sub(other: Dimensions): Dimensions {
    const result = new Map(this.powers)
    for (const [key, power] of other.powers)
      result.set(key, (result.get(key) ?? new Fraction(0)).sub(power))
    return new Dimensions(result)
  }

  scale(factor: FractionValue): Dimensions {
    return new Dimensions(new Map([...this.powers].map(([key, power]) => [key, power.mul(factor)])))
  }

  equals(other: Dimensions | DimensionInput): boolean {
    const rhs = other instanceof Dimensions ? other : new Dimensions(other)
    if (this.powers.size !== rhs.powers.size) return false
    for (const [key, power] of this.powers) {
      const otherPower = rhs.powers.get(key)
      if (!otherPower || !power.equals(otherPower)) return false
    }
    return true
  }

  get isDimensionless(): boolean {
    return this.powers.size === 0
  }

  toString(): string {
    if (this.isDimensionless) return '1'
    return [...this.powers]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, power]) => {
        if (power.equals(1)) return key
        const exponent =
          power.d === 1 ? String(power.s * power.n) : `${power.s * power.n}/${power.d}`
        return `${key}^${exponent}`
      })
      .join(' ')
  }
}

class ExactMonomial {
  constructor(readonly exponents: SparseMonzo = new Map()) {}

  static fromFraction(input: FractionValue | bigint, denominator?: bigint): ExactMonomial {
    const factors =
      typeof input === 'bigint' ? primeFactorize(input, denominator) : primeFactorize(input)
    return new ExactMonomial(factors)
  }

  mul(other: ExactMonomial): ExactMonomial {
    if (!this.sign || !other.sign) return ExactMonomial.ZERO
    return new ExactMonomial(addMonzos(this.exponents, other.exponents))
  }

  div(other: ExactMonomial): ExactMonomial {
    if (!other.sign) throw new RangeError('Division by zero.')
    if (!this.sign) return ExactMonomial.ZERO
    return new ExactMonomial(addMonzos(this.exponents, other.exponents, true))
  }

  neg(): ExactMonomial {
    if (!this.sign) return ExactMonomial.ZERO
    const exponents = new Map(this.exponents)
    if (this.sign < 0) exponents.delete(-1)
    else exponents.set(-1, new Fraction(1))
    return new ExactMonomial(exponents)
  }

  pow(exponent: Fraction): ExactMonomial | null {
    if (!exponent.n) return ExactMonomial.ONE
    if (!this.sign) {
      if (exponent.compare(0) < 0)
        throw new RangeError('Zero cannot be raised to a negative power.')
      return ExactMonomial.ZERO
    }
    if (this.sign < 0 && exponent.d % 2 === 0) return null
    const exponents = new Map<number, Fraction>()
    for (const [prime, component] of this.exponents) {
      if (prime <= 0) continue
      const scaled = new Fraction(component).mul(exponent)
      if (scaled.n) exponents.set(prime, scaled)
    }
    // A negative base with an odd-denominator exponent stays negative exactly
    // when the exponent's numerator is odd. The sign is not itself a prime
    // factor and must therefore never be scaled to a fractional exponent.
    if (this.sign < 0 && exponent.n % 2) exponents.set(-1, new Fraction(1))
    return new ExactMonomial(exponents)
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
    let result = new Fraction(this.sign)
    for (const [prime, component] of this.exponents) {
      if (prime <= 0) continue
      const exponent = new Fraction(component)
      if (exponent.d !== 1) return null
      const factor = new Fraction(prime).pow(exponent)
      if (!factor) return null
      result = result.mul(factor)
    }
    return result
  }

  equals(other: ExactMonomial): boolean {
    return this.sign === other.sign && monzosEqual(this.exponents, other.exponents)
  }

  valueOf(): number {
    if (!this.sign) return 0
    let result = this.sign
    for (const [prime, exponent] of this.exponents) {
      if (prime <= 0) continue
      result *= Math.pow(prime, new Fraction(exponent).valueOf())
    }
    return result
  }

  get sign(): -1 | 1 | 0 {
    if (this.exponents.has(0)) {
      return 0
    }
    const signExponent = this.exponents.get(-1)
    if (signExponent !== undefined && new Fraction(signExponent).n % 2) {
      return -1
    }
    return 1
  }

  get isPositive(): boolean {
    return this.sign > 0
  }
  static readonly ZERO = new ExactMonomial(new Map([[0, new Fraction(1)]]))
  static readonly ONE = new ExactMonomial(new Map())
}

class ExactPitch {
  readonly logPrimes: SparseMonzo

  constructor(logPrimes: SparseMonzo = new Map()) {
    const normalized = new Map(logPrimes)
    for (const [prime, exponent] of normalized) {
      if (!new Fraction(exponent).n) normalized.delete(prime)
    }
    this.logPrimes = normalized
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
    return new ExactMonomial(this.logPrimes)
  }

  equals(other: ExactPitch): boolean {
    return monzosEqual(this.logPrimes, other.logPrimes)
  }

  valueOf(): number {
    let octaves = 0
    for (const [prime, exponent] of this.logPrimes) {
      octaves += (valueToCents(prime) / 1200) * new Fraction(exponent).valueOf()
    }
    return 1200 * octaves
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
  private static quantity(value: ValueInput, dimensions: DimensionInput): Value {
    const magnitude = coerceValue(value)
    if (!magnitude.dimensions.isDimensionless)
      throw new TypeError('A quantity magnitude must be dimensionless.')
    return Value.fromMagnitude(magnitude.magnitude, new Dimensions(dimensions))
  }
  static cents(value: FractionValue): Value {
    return Value.fromMagnitude(
      { kind: 'pitch', value: ExactPitch.fromCents(value) },
      new Dimensions({ pitch: 1 }),
    )
  }
  static decibels(value: ValueInput): Value {
    return Value.quantity(value, { level: 1 })
  }
  static beats(value: ValueInput): Value {
    return Value.quantity(value, { beats: 1 })
  }
  static seconds(value: ValueInput): Value {
    return Value.quantity(value, { seconds: 1 })
  }
  static hertz(value: ValueInput): Value {
    return Value.quantity(value, { seconds: -1 })
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
    return Value.real(valueToCents(ratio.valueOf()), { pitch: 1 })
  }

  static ratio(offset: Value): Value {
    if (!offset.dimensions.equals({ pitch: 1 }))
      throw new TypeError('Ratio conversion requires a pitch displacement.')
    if (offset.magnitude.kind === 'pitch')
      return Value.fromMagnitude(
        { kind: 'exact', value: offset.magnitude.value.toRatio() },
        new Dimensions(),
      )
    return Value.real(centsToValue(offset.valueOf()))
  }

  static equalDivision(
    steps: FractionValue,
    divisions: FractionValue,
    equave: ValueInput = 2,
  ): Value {
    const count = new Fraction(divisions)
    if (!count.n) throw new RangeError('Equal division count cannot be zero.')
    const pitch = Value.pitch(equave)
    if (pitch.magnitude.kind !== 'pitch') throw new TypeError('Expected a pitch displacement.')
    return Value.fromMagnitude(
      { kind: 'pitch', value: pitch.magnitude.value.scale(new Fraction(steps).div(count)) },
      pitch.dimensions,
    )
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

  /** Mathematical modulo for any pair of values that can be compared and subtracted. */
  mmod(input: ValueInput): Value {
    const other = coerceValue(input)
    const leftRational = this.exactRational()
    const rightRational = other.exactRational()
    if (leftRational && rightRational) {
      if (!rightRational.n) throw new RangeError('Division by zero.')
      return new Value(leftRational.mmod(rightRational))
    }

    const zero = other.sub(other)
    const divisor = other.compare(zero) < 0 ? zero.sub(other) : other
    if (!divisor.compare(zero)) throw new RangeError('Division by zero.')
    const negative = this.compare(zero) < 0
    let remainder = negative ? zero.sub(this) : this

    while (remainder.compare(divisor) >= 0) {
      let chunk = divisor
      while (true) {
        const doubled = chunk.sub(zero.sub(chunk))
        if (doubled.compare(chunk) <= 0 || doubled.compare(remainder) > 0) break
        chunk = doubled
      }
      const reduced = remainder.sub(chunk)
      if (reduced.compare(remainder) >= 0) {
        throw new RangeError('Unable to calculate modulo without losing precision.')
      }
      remainder = reduced
    }
    return negative && remainder.compare(zero) ? divisor.sub(remainder) : remainder
  }

  /** Geometrically reduce an exact ratio by another exact ratio. */
  reduce(input: ValueInput): Value {
    const left = this.exactRational()
    const right = coerceValue(input).exactRational()
    if (!left || !right) throw new TypeError('Geometric reduction requires exact rational values.')
    return new Value(left.geoMod(right))
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
          value: this.magnitude.value.neg(),
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

  /** Return the exponent which raises the given base to this ratio or pitch. */
  log(input: ValueInput): Value {
    const base = coerceValue(input)
    const bothRatios = this.dimensions.isDimensionless && base.dimensions.isDimensionless
    const bothPitches = this.dimensions.equals({ pitch: 1 }) && base.dimensions.equals({ pitch: 1 })
    if (!bothRatios && !bothPitches) {
      throw new TypeError('Logarithm requires two ratios or two pitch displacements.')
    }
    if (bothRatios && (!(this.valueOf() > 0) || !(base.valueOf() > 0))) {
      throw new RangeError('Logarithm requires positive ratios.')
    }

    const targetExponents = this.primeExponents()
    const baseExponents = base.primeExponents()
    if (targetExponents && baseExponents) {
      let solution: Fraction | undefined
      const primes = new Set([...targetExponents.keys(), ...baseExponents.keys()])
      for (const prime of primes) {
        const target = targetExponents.get(prime) ?? new Fraction(0)
        const divisor = baseExponents.get(prime) ?? new Fraction(0)
        if (!divisor.n) {
          if (target.n) {
            solution = undefined
            break
          }
          continue
        }
        const candidate = target.div(divisor)
        if (solution === undefined) solution = candidate
        else if (!solution.equals(candidate)) {
          solution = undefined
          break
        }
      }
      if (solution !== undefined) return new Value(solution)
      if (!targetExponents.size && baseExponents.size) return new Value(0)
    }

    const denominator = bothPitches ? base.valueOf() : Math.log(base.valueOf())
    const numerator = bothPitches ? this.valueOf() : Math.log(this.valueOf())
    if (!denominator) throw new RangeError("Logarithm doesn't exist.")
    return Value.real(numerator / denominator)
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
    if (
      this.magnitude.kind === 'pitch' &&
      other.magnitude.kind === 'exact' &&
      other.dimensions.isDimensionless &&
      other.magnitude.value.isPositive
    ) {
      if (monzosEqual(this.magnitude.value.logPrimes, other.magnitude.value.exponents)) return 0
      const difference = this.valueOf() - ExactPitch.fromRatio(other.magnitude.value).valueOf()
      return difference < 0 ? -1 : difference > 0 ? 1 : 0
    }
    if (
      this.magnitude.kind === 'exact' &&
      this.dimensions.isDimensionless &&
      this.magnitude.value.isPositive &&
      other.magnitude.kind === 'pitch'
    ) {
      if (monzosEqual(this.magnitude.value.exponents, other.magnitude.value.logPrimes)) return 0
      const difference = ExactPitch.fromRatio(this.magnitude.value).valueOf() - other.valueOf()
      return difference < 0 ? -1 : difference > 0 ? 1 : 0
    }
    this.assertCompatible(other, 'compare')
    const difference = this.valueOf() - other.valueOf()
    return difference < 0 ? -1 : difference > 0 ? 1 : 0
  }

  isExact(): boolean {
    return this.magnitude.kind !== 'real'
  }
  /** Whether this value is an exact, positive, dimensionless ratio. */
  isPositiveExactRatio(): boolean {
    return (
      this.dimensions.isDimensionless &&
      this.magnitude.kind === 'exact' &&
      this.magnitude.value.isPositive
    )
  }
  /** Exact prime exponents for a scalar monomial or logarithmic pitch. */
  primeExponents(): ReadonlyMap<number, Fraction> | undefined {
    if (this.magnitude.kind === 'real') return undefined
    const source =
      this.magnitude.kind === 'pitch'
        ? this.magnitude.value.logPrimes
        : this.magnitude.value.exponents
    return new Map(
      [...source]
        .filter(([prime]) => prime > 0)
        .map(([prime, exponent]) => [prime, new Fraction(exponent)]),
    )
  }
  valueOf(): number {
    return this.magnitude.value.valueOf()
  }
  toString(): string {
    return `${this.valueOf()} [${this.dimensions}]`
  }
}
