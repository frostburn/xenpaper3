import { toMonzo, type Monzo } from 'xen-dev-utils/monzo'
import { PRIMES } from 'xen-dev-utils/primes'

const SYNTONIC_RASTMIC = new Map<string, Monzo>([
  ['1', [-1 / 2, 5 / 2, 0, 0, -1]],
  ['2', [-1, 5, 0, 0, -2]],
  ['4', [-2, 10, 0, 0, -4]],
  ['8', [-4, 20, 0, 0, -8]],
  ['3', [-2, 2, -1 / 2]],
  ['6', [-4, 4, -1]],
  ['9', [-6, 6, -3 / 2]],
])

const LUMIS_COMMAS = new Map<string, Monzo>([
  ['0', [-25 / 4, 17 / 4, 1, -1]],
  ['1', [3 / 4, 1 / 4, 1, 0, -1]],
  ['2', [-11 / 2, 7 / 2]],
  ['3', [1, -3 / 2, -1, 0, 0, 1]],
  ['4', [-9 / 2, 4, -2, 1]],
  ['5', [1 / 2, 0, 1, -1]],
  ['6', [1 / 3, -5 / 3, 1]],
  ['7', [5 / 3, -1 / 3, 1, 0, -1]],
  ['8', [5 / 2, -1, 0, 1, 0, -1]],
  ['9', [9 / 5, -13 / 5, 1]],
])

const HELMHOLTZ_ELLIS = new Map<number, string>([
  [5, '81/80'],
  [7, '64/63'],
  [11, '33/32'],
  [13, '27/26'],
  [17, '2187/2176'],
  [19, '513/512'],
  [23, '736/729'],
  [29, '261/256'],
  [31, '32/31'],
  [37, '37/36'],
  [41, '82/81'],
  [43, '129/128'],
  [47, '752/729'],
  [53, '54/53'],
  [59, '243/236'],
  [61, '244/243'],
  [67, '2187/2144'],
  [71, '72/71'],
  [73, '73/72'],
  [79, '81/79'],
  [83, '256/249'],
  [89, '729/712'],
])

const HEWM53 = new Map<number, string>([
  [5, '81/80'],
  [7, '64/63'],
  [11, '33/32'],
  [13, '27/26'],
  [17, '18/17'],
  [19, '19/18'],
  [23, '24/23'],
  [29, '261/256'],
  [31, '32/31'],
  [37, '37/36'],
  [41, '82/81'],
  [43, '129/128'],
  [47, '48/47'],
  [53, '54/53'],
])

const stackDigitCommas = (id: number, commas: Map<string, Monzo>): Monzo => {
  if (!Number.isSafeInteger(id) || id < 0) return []

  const result: Monzo = []
  for (const digit of id.toString()) {
    const comma = commas.get(digit)
    if (!comma) continue
    for (let index = 0; index < comma.length; index++) {
      result[index] = (result[index] ?? 0) + (comma[index] ?? 0)
    }
  }
  return result
}

export const getLumisComma = (id: number): Monzo => stackDigitCommas(id, LUMIS_COMMAS)

export const getSyntonicRastmicComma = (id: number): Monzo => stackDigitCommas(id, SYNTONIC_RASTMIC)

const getPrimeComma = (primeIndex: number, commas: Map<number, string>): Monzo => {
  const prime = PRIMES[primeIndex]
  if (prime === undefined) return []

  const fraction = commas.get(prime)
  return fraction === undefined ? [] : toMonzo(fraction)
}

export const getHelmholtzEllisComma = (primeIndex: number): Monzo =>
  getPrimeComma(primeIndex, HELMHOLTZ_ELLIS)

export const getHewm53Comma = (primeIndex: number): Monzo => getPrimeComma(primeIndex, HEWM53)
