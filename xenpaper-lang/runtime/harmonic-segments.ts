import type { Expression } from '../parser.js'
import type { Diagnostic } from '../diagnostics'
import type { ExpressionEvaluator } from './builtins'

const MAX_ENUMERATED_CHORD_SIZE = 10_000n

/** Lower a chord or harmonic segment to its ratios in written order. */
export function expandHarmonicSegment(
  node: Extract<Expression, { type: 'EnumeratedChord' }>,
  evaluate: ExpressionEvaluator,
): { readonly expressions: readonly Expression[]; readonly diagnostics: readonly Diagnostic[] } {
  let enumerands = node.enumerands
  if (!enumerands) {
    const endpoint = node.rangeEnd!
    const evaluated = [evaluate(node.first), evaluate(endpoint)]
    const diagnostics = evaluated.flatMap((result) => result.diagnostics)
    const integers = evaluated.map((result) => {
      if (!('value' in result) || result.value.kind !== 'scalar') return undefined
      const exact = result.value.value.exactRational()
      return exact?.d === 1 ? BigInt(exact.s * exact.n) : undefined
    })
    if (integers.some((value) => value === undefined)) {
      return {
        expressions: [],
        diagnostics: [
          ...diagnostics,
          {
            code: 'XP_TYPE_MISMATCH',
            severity: 'error',
            message: 'Enumerated chord range endpoints must be exact integers.',
            locations: [node.location],
          },
        ],
      }
    }
    const [start, end] = integers as [bigint, bigint]
    const distance = start <= end ? end - start : start - end
    if (distance + 1n > MAX_ENUMERATED_CHORD_SIZE) {
      return {
        expressions: [],
        diagnostics: [
          ...diagnostics,
          {
            code: 'XP_EXPANSION_LIMIT',
            severity: 'error',
            message: `Enumerated chord exceeds the ${MAX_ENUMERATED_CHORD_SIZE}-member expansion limit.`,
            locations: [node.location],
          },
        ],
      }
    }
    const step = start <= end ? 1n : -1n
    enumerands = []
    for (let value = start; ; value += step) {
      enumerands.push({
        type: 'IntegerLiteral',
        value: String(value),
        raw: String(value),
        location: node.location,
      })
      if (value === end) break
    }
  }
  return {
    expressions: enumerands.map((enumerand) => ({
      type: 'BinaryExpression',
      operator: '/',
      left: node.inverted ? node.first : enumerand,
      right: node.inverted ? enumerand : node.first,
      location: node.location,
    })),
    diagnostics: [],
  }
}
