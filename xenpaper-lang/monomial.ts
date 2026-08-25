import { Fraction, type FractionValue } from 'xen-dev-utils/fraction'
import { primeFactorize } from 'xen-dev-utils/monzo'
import { isPrime } from 'xen-dev-utils/primes'

export type MonomialEntry = readonly [prime: number, exponent: FractionValue]
export type MonomialInput = Iterable<MonomialEntry> | ReadonlyMap<number, FractionValue>

const assertPrime = (prime: number): void => {
  if (!Number.isSafeInteger(prime) || prime < 2 || !isPrime(prime)) {
    throw new RangeError(`Monomial axes must be positive primes; received ${prime}.`)
  }
}

/**
 * An immutable sparse coordinate in the rational prime-exponent lattice.
 *
 * Addition combines musical intervals multiplicatively; subtraction divides them.
 * The zero vector is therefore the unison ratio. No cents, frequency reference,
 * temperament, notation system, or device convention is built into this type.
 */
export class Monomial implements ReadonlyMap<number, Fraction> {
  private readonly components: ReadonlyMap<number, Fraction>

  constructor(input: MonomialInput = []) {
    const components = new Map<number, Fraction>()
    for (const [prime, rawExponent] of input) {
      assertPrime(prime)
      const exponent = (components.get(prime) ?? new Fraction(0)).add(rawExponent)
      if (exponent.n) components.set(prime, exponent)
      else components.delete(prime)
    }
    this.components = components
  }

  /** The lattice origin, representing a multiplicative ratio of 1. */
  static readonly ZERO = new Monomial()
  static readonly UNISON = Monomial.ZERO

  /** Factor a positive exact rational into the prime lattice. */
  static fromRatio(input: FractionValue | bigint, denominator?: bigint): Monomial {
    const factors =
      typeof input === 'bigint' ? primeFactorize(input, denominator) : primeFactorize(input)
    if (factors.has(0)) throw new RangeError('A monomial ratio must be non-zero.')
    if (factors.has(-1)) throw new RangeError('A monomial ratio must be positive.')
    return new Monomial([...factors].filter(([prime]) => prime > 1))
  }

  /** An exact rational-cent displacement, represented as a rational power of 2. */
  static fromCents(cents: FractionValue): Monomial {
    return new Monomial([[2, new Fraction(cents).div(1200)]])
  }

  /** Construct an exact equal division of an arbitrary exact equave. */
  static equalDivision(
    steps: FractionValue,
    divisions: FractionValue,
    equave: Monomial = Monomial.fromRatio(2),
  ): Monomial {
    const count = new Fraction(divisions)
    if (!count.n) throw new RangeError('Equal division count cannot be zero.')
    return equave.scale(new Fraction(steps).div(count))
  }

  get size(): number {
    return this.components.size
  }

  get [Symbol.toStringTag](): string {
    return 'Monomial'
  }

  get(prime: number): Fraction | undefined {
    const exponent = this.components.get(prime)
    return exponent ? new Fraction(exponent) : undefined
  }

  has(prime: number): boolean {
    return this.components.has(prime)
  }

  entries(): MapIterator<[number, Fraction]> {
    return new Map(
      [...this.components].map(([prime, exponent]) => [prime, new Fraction(exponent)]),
    ).entries()
  }

  keys(): MapIterator<number> {
    return this.components.keys()
  }

  values(): MapIterator<Fraction> {
    return new Map(
      [...this.components].map(([prime, exponent]) => [prime, new Fraction(exponent)]),
    ).values()
  }

  [Symbol.iterator](): MapIterator<[number, Fraction]> {
    return this.entries()
  }

  forEach(
    callbackfn: (value: Fraction, key: number, map: ReadonlyMap<number, Fraction>) => void,
    thisArg?: unknown,
  ): void {
    for (const [prime, exponent] of this.components) {
      callbackfn.call(thisArg, new Fraction(exponent), prime, this)
    }
  }

  add(input: MonomialInput | Monomial): Monomial {
    const other = input instanceof Monomial ? input : new Monomial(input)
    const result = new Map<number, Fraction>(this.components)
    for (const [prime, exponent] of other) {
      const combined = (result.get(prime) ?? new Fraction(0)).add(exponent)
      if (combined.n) result.set(prime, combined)
      else result.delete(prime)
    }
    return new Monomial(result)
  }

  sub(input: MonomialInput | Monomial): Monomial {
    const other = input instanceof Monomial ? input : new Monomial(input)
    const result = new Map<number, Fraction>(this.components)
    for (const [prime, exponent] of other) {
      const combined = (result.get(prime) ?? new Fraction(0)).sub(exponent)
      if (combined.n) result.set(prime, combined)
      else result.delete(prime)
    }
    return new Monomial(result)
  }

  scale(factor: FractionValue): Monomial {
    const scalar = new Fraction(factor)
    return new Monomial(
      [...this.components].map(([prime, exponent]) => [prime, exponent.mul(scalar)] as const),
    )
  }

  equals(input: MonomialInput | Monomial): boolean {
    const other = input instanceof Monomial ? input : new Monomial(input)
    if (this.size !== other.size) return false
    for (const [prime, exponent] of this) {
      const candidate = other.get(prime)
      if (!candidate || !exponent.equals(candidate)) return false
    }
    return true
  }

  /** Apply an exact prime mapping while remaining in the monomial lattice. */
  remap(mapPrime: (prime: number) => Monomial): Monomial {
    let result = Monomial.ZERO
    for (const [prime, exponent] of this) {
      result = result.add(mapPrime(prime).scale(exponent))
    }
    return result
  }

  /** Apply any additive logarithmic prime mapping to this exact coordinate. */
  project(mapPrime: (prime: number) => number): number {
    let result = 0
    for (const [prime, exponent] of this) result += mapPrime(prime) * exponent.valueOf()
    return result
  }

  /** Floating-point value of the represented ratio; intended for downstream adapters. */
  ratioValue(): number {
    return Math.exp(this.project(Math.log))
  }

  /** Recover a rational exactly when every prime exponent is an integer. */
  toFraction(): Fraction | undefined {
    let result = new Fraction(1)
    for (const [prime, exponent] of this) {
      if (exponent.d !== 1) return undefined
      const factor = new Fraction(prime).pow(exponent)
      if (!factor) return undefined
      result = result.mul(factor)
    }
    return result
  }

  toMap(): ReadonlyMap<number, Fraction> {
    return new Map([...this.components].map(([prime, exponent]) => [prime, new Fraction(exponent)]))
  }

  toJSON(): readonly { readonly prime: number; readonly exponent: string }[] {
    return [...this]
      .sort(([left], [right]) => left - right)
      .map(([prime, exponent]) => ({ prime, exponent: exponent.toFraction() }))
  }

  toString(): string {
    if (!this.size) return '<1>'
    return `<${[...this]
      .sort(([left], [right]) => left - right)
      .map(([prime, exponent]) => `${prime}:${exponent.toFraction()}`)
      .join(' ')}>`
  }
}
