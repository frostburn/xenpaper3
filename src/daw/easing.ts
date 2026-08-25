export type GlissandoEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'

/** Apply one of Xenpaper's glissando curves to a normalized progress value. */
export const easeGlissando = (easing: string, t: number): number => {
  switch (easing) {
    case 'ease-in':
      return t ** 2
    case 'ease-out':
      return 1 - (1 - t) ** 2
    case 'ease-in-out':
      return (3 - 2 * t) * t ** 2
    case 'ease':
      return 0.25 * t * (3 + 6 * t - 5 * t * t)
    default:
      return t
  }
}
