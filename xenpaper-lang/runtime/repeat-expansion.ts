import type { LocationRange } from 'peggy'
import type { Program } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import type {
  ExpandedNode,
  ExpansionPath,
  RepeatExpansionOptions,
  RepeatExpansionResult,
} from './types'

const DEFAULT_EXPANSION_LIMIT = 100_000

type SyntaxNode = {
  readonly type: string
  readonly location: LocationRange
  readonly [key: string]: unknown
}

class ExpansionLimitError extends Error {}

function isNode(value: unknown): value is SyntaxNode {
  return (
    typeof value === 'object' && value !== null && typeof (value as SyntaxNode).type === 'string'
  )
}

/** Expand repeat macros while retaining a distinct provenance path on every occurrence. */
export function expandRepeats(
  program: Program,
  options: RepeatExpansionOptions = {},
): RepeatExpansionResult {
  const diagnostics: Diagnostic[] = []
  const limit = options.expansionLimit ?? DEFAULT_EXPANSION_LIMIT
  let emitted = 0

  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('expansionLimit must be a non-negative safe integer.')
  }

  const countEmission = (node: SyntaxNode) => {
    emitted += 1
    if (emitted > limit) {
      diagnostics.push({
        code: 'XP_REPEAT_EXPANSION_LIMIT',
        severity: 'error',
        message: `Repeat expansion exceeded the ${limit}-node limit.`,
        locations: [node.location],
      })
      throw new ExpansionLimitError()
    }
  }

  const cloneNode = (node: SyntaxNode, path: ExpansionPath): ExpandedNode[] => {
    if (node.type === 'Repeat') {
      if (node.incompleteEndings) {
        diagnostics.push({
          code: 'XP_INCOMPLETE_REPEAT_ENDINGS',
          severity: 'warning',
          message: 'Alternate endings ended without a subsequent numbered ending.',
          locations: [node.location],
        })
      }
      const countNode = node.count as (SyntaxNode & { value?: unknown }) | undefined
      let count: bigint
      try {
        count = countNode ? BigInt(String(countNode.value)) : 2n
      } catch {
        diagnostics.push({
          code: 'XP_REPEAT_COUNT',
          severity: 'error',
          message: 'Repeat count must be an exact non-negative integer.',
          locations: [countNode?.location ?? node.location],
        })
        return []
      }
      if (count < 0n) {
        diagnostics.push({
          code: 'XP_REPEAT_COUNT',
          severity: 'error',
          message: 'Repeat count must be an exact non-negative integer.',
          locations: [countNode?.location ?? node.location],
        })
        return []
      }

      const result: ExpandedNode[] = []
      const endings =
        (node.endings as { number: SyntaxNode & { value?: unknown }; body: SyntaxNode[] }[]) ?? []
      const endingsByIteration = new Map<bigint, SyntaxNode[]>()
      for (const ending of endings) {
        const iteration = BigInt(String(ending.number.value)) - 1n
        // Duplicate ending numbers select the first ending, matching Array.find's behavior.
        if (!endingsByIteration.has(iteration)) endingsByIteration.set(iteration, ending.body)
      }
      const body = (node.body as SyntaxNode[]) ?? []
      const appendChildren = (
        target: ExpandedNode[],
        source: readonly SyntaxNode[],
        iterationPath: ExpansionPath,
      ) => {
        for (const child of source) {
          for (const clone of cloneNode(child, iterationPath)) {
            // A repeat is an AST splice, not an evaluation boundary. The grammar
            // represents a run of score items as a Sequence, so retaining that
            // wrapper per iteration would incorrectly isolate stateful directives.
            if (clone.type === 'Sequence') {
              for (const item of (clone.items as ExpandedNode[]) ?? []) target.push(item)
            } else target.push(clone)
          }
        }
      }
      for (let iteration = 0n; iteration < count; iteration += 1n) {
        if (iteration > BigInt(Number.MAX_SAFE_INTEGER)) {
          // The normal node limit makes this unreachable with default options,
          // but paths deliberately use ordinary, interoperable numbers.
          diagnostics.push({
            code: 'XP_REPEAT_COUNT',
            severity: 'error',
            message: 'Repeat count is too large to identify every occurrence.',
            locations: [countNode?.location ?? node.location],
          })
          return result
        }
        const iterationPath = [
          ...path,
          { repeatOffset: node.location.start.offset, iteration: Number(iteration) },
        ]
        const children: ExpandedNode[] = []
        appendChildren(children, body, iterationPath)
        appendChildren(children, endingsByIteration.get(iteration) ?? [], iterationPath)
        // An empty, ending-free repeat has no observable occurrences. Stop
        // after the first expansion instead of iterating a potentially huge
        // authored count (this also covers bodies made empty by nested x0
        // repeats). Alternate endings are excluded because a later iteration
        // may still select a non-empty ending.
        if (!endings.length && !children.length) return result
        if (endings.length && children.length) {
          result.push(makeSequence(children, node.location, iterationPath))
        } else {
          result.push(...children)
        }
      }
      return result
    }

    countEmission(node)
    const clone: Record<string, unknown> = { ...node, expansionPath: path }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'location' || key === 'type') continue
      if (Array.isArray(value)) {
        if (key === 'items' || key === 'body') {
          clone[key] = value.flatMap((item) => (isNode(item) ? cloneNode(item, path) : [item]))
        } else {
          clone[key] = value.map((item) => {
            if (!isNode(item)) return item
            const children = cloneNode(item, path)
            return children.length === 1 ? children[0] : makeSequence(children, item.location, path)
          })
        }
      } else if (isNode(value)) {
        const children = cloneNode(value, path)
        clone[key] =
          children.length === 1 ? children[0] : makeSequence(children, value.location, path)
      }
    }
    return [clone as ExpandedNode]
  }

  const makeSequence = (
    items: readonly ExpandedNode[],
    location: LocationRange,
    path: ExpansionPath,
  ): ExpandedNode => {
    const node = { type: 'Sequence', items, location, expansionPath: path }
    countEmission(node)
    return node
  }

  try {
    const body = program.body
      .flatMap((node) => cloneNode(node as unknown as SyntaxNode, []))
      .flatMap((node) =>
        node.type === 'Sequence' ? ((node.items as ExpandedNode[]) ?? []) : [node],
      )
    return {
      program: { ...program, body, expansionPath: [] },
      diagnostics,
    }
  } catch (error) {
    if (!(error instanceof ExpansionLimitError)) throw error
    return { diagnostics }
  }
}
