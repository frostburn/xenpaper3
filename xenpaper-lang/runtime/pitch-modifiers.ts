const EQUAVE_SHIFTS: Readonly<Record<string, number>> = {
  equaveUp: 1,
  doubleEquaveUp: 2,
  equaveDown: -1,
}

export const equaveShift = (kind: string): number => EQUAVE_SHIFTS[kind] ?? 0

export const equaveShifts = (modifiers: readonly { readonly kind: string }[]): number =>
  modifiers.reduce((sum, modifier) => sum + equaveShift(modifier.kind), 0)
