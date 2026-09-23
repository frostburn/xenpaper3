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
  let iterations = 0

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
      const replayPrefix = (node.replayPrefix as SyntaxNode[]) ?? []
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
        if (++iterations > limit) {
          diagnostics.push({
            code: 'XP_REPEAT_EXPANSION_LIMIT',
            severity: 'error',
            message: `Repeat expansion exceeded the ${limit}-iteration limit.`,
            locations: [node.location],
          })
          throw new ExpansionLimitError()
        }
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
        if (iteration > 0n) appendChildren(children, replayPrefix, iterationPath)
        appendChildren(children, body, iterationPath)
        const endingStart = children.length
        appendChildren(children, endingsByIteration.get(iteration) ?? [], iterationPath)
        const emptyEndingFree = !endings.length && !children.length
        // An empty, ending-free repeat has no playback occurrences. Preserve
        // mode emits its authored boundaries once for semantic validation,
        // then takes the same fast path rather than expanding every iteration.
        if (!options.preserveBarlines && emptyEndingFree) return result
        if (options.preserveBarlines) {
          const marker = (location: LocationRange): ExpandedNode => {
            const marker = { type: 'Barline', raw: '|', location, expansionPath: iterationPath }
            countEmission(marker)
            return marker
          }
          const repeatStart = node.location.start
          const repeatEnd = node.location.end
          const endingIndex = endings.findIndex(
            (ending) => BigInt(String(ending.number.value)) === iteration + 1n,
          )
          if (endingIndex >= 0) {
            const ending = endings[endingIndex]! as (typeof endings)[number] & {
              markerLocation: LocationRange
            }
            children.splice(endingStart, 0, marker(ending.markerLocation))
          }
          children.unshift(
            marker({
              ...node.location,
              end: {
                ...repeatStart,
                offset: repeatStart.offset + 2,
                column: repeatStart.column + 2,
              },
            }),
          )
          const nextEnding = endings[endingIndex + 1] as
            | ((typeof endings)[number] & { markerLocation: LocationRange })
            | undefined
          const width = String(node.terminal ?? '').length
          if (nextEnding && endingIndex >= 0) children.push(marker(nextEnding.markerLocation))
          else if (width)
            children.push(
              marker({
                ...node.location,
                start: {
                  ...repeatEnd,
                  offset: repeatEnd.offset - width,
                  column: repeatEnd.column - width,
                },
              }),
            )
        }
        result.push(...children)
        if (emptyEndingFree) return result
      }
      return result
    }

    countEmission(node)
    const clone: Record<string, unknown> = { ...node, expansionPath: path }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'location' || key === 'type') continue
      if (Array.isArray(value)) {
        if (key === 'items' || key === 'body') {
          clone[key] = value
            .flatMap((item) => (isNode(item) ? cloneNode(item, path) : [item]))
            .flatMap((item) => (isNode(item) && item.type === 'Sequence' ? item.items : [item]))
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
