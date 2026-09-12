import luckyDebugger from './lucky-debugger.xenpaper.json'
import minuet from './minuet.xenpaper.json'

/** Built-in projects keyed by IDs that remain stable if their source files move or are renamed. */
export const demoProjects: Readonly<Record<string, string>> = Object.freeze({
  'lucky-debugger': JSON.stringify(luckyDebugger),
  minuet: JSON.stringify(minuet),
})
