import luckyDebugger from './lucky-debugger.xenpaper.json'
import minuet from './minuet.xenpaper.json'
import cosmicWavelength from './cosmic-wavelength.xenpaper.json'
import negativeCarry from './negative-carry.xenpaper.json'
import bachAugmentationCanon from './bach-augmentation-canon.xenpaper.json'

/** Built-in projects keyed by IDs that remain stable if their source files move or are renamed. */
export const demoProjects: Readonly<Record<string, string>> = Object.freeze({
  'bach-augmentation-canon': JSON.stringify(bachAugmentationCanon),
  'cosmic-wavelength': JSON.stringify(cosmicWavelength),
  'lucky-debugger': JSON.stringify(luckyDebugger),
  minuet: JSON.stringify(minuet),
  'negative-carry': JSON.stringify(negativeCarry),
})
