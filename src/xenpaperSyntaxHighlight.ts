import type { Node, Program } from '../xenpaper-lang/parser.generated'

export type XenpaperHighlightKind =
  | 'comment'
  | 'directive'
  | 'keyword'
  | 'pitch'
  | 'number'
  | 'operator'
  | 'punctuation'
  | 'identifier'
  | 'whitespace'
  | 'unparsed'

export interface XenpaperHighlightToken {
  kind: XenpaperHighlightKind
  text: string
  start: number
  end: number
  nodeType?: string
}

interface HighlightRange {
  kind: XenpaperHighlightKind
  nodeType: string
  start: number
  end: number
  depth: number
}

type HighlightClassification = Pick<XenpaperHighlightToken, 'kind' | 'nodeType'>

const kindsByNodeType: Partial<Record<string, XenpaperHighlightKind>> = {
  Comment: 'comment',
  Directive: 'directive',
  PitchContextChange: 'keyword',
  MosDeclaration: 'keyword',
  SignatureDeclaration: 'keyword',
  ContextAssignment: 'keyword',
  ContextPreset: 'keyword',
  PitchLiteral: 'pitch',
  IntervalLiteral: 'pitch',
  MosIntervalLiteral: 'pitch',
  DegreeLiteral: 'pitch',
  DecimalLiteral: 'number',
  RealLiteral: 'number',
  IntegerLiteral: 'number',
  RatioLiteral: 'number',
  QuantityLiteral: 'number',
  EqualDivisionLiteral: 'number',
  MonzoLiteral: 'number',
  MappingLiteral: 'number',
  Identifier: 'identifier',
  CallExpression: 'identifier',
  BinaryExpression: 'operator',
  UnaryExpression: 'operator',
  PostfixExpression: 'operator',
  TailElimination: 'operator',
  DetachedContinue: 'operator',
  Barline: 'punctuation',
  HardBoundary: 'punctuation',
  Group: 'punctuation',
  NormalizeToSlot: 'punctuation',
  Repeat: 'punctuation',
  EnumeratedChord: 'punctuation',
}

function isNode(value: unknown): value is Node {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Node>
  return (
    typeof candidate.type === 'string' &&
    Boolean(candidate.location?.start && candidate.location.end)
  )
}

function collectRanges(node: Node, ranges: HighlightRange[], depth = 0): void {
  const kind = kindsByNodeType[node.type]
  if (kind) {
    ranges.push({
      kind,
      nodeType: node.type,
      start: node.location.start.offset,
      end: node.location.end.offset,
      depth,
    })
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'location') continue
    if (isNode(value)) collectRanges(value, ranges, depth + 1)
    else if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) collectRanges(item, ranges, depth + 1)
    }
  }
}

/** Build a lossless highlight stream from the parser's located syntax tree. */
export function highlightXenpaper(program: Program): XenpaperHighlightToken[] {
  const { source } = program
  if (!source) return []

  const ranges: HighlightRange[] = []
  collectRanges(program, ranges)

  const classification: HighlightClassification[] = Array.from({ length: source.length }).map(
    () => ({ kind: 'punctuation' }),
  )
  const winningDepth = new Int32Array(source.length).fill(-1)

  for (const range of ranges) {
    for (let offset = range.start; offset < Math.min(range.end, source.length); offset += 1) {
      if (range.depth < winningDepth[offset]!) continue
      classification[offset] = { kind: range.kind, nodeType: range.nodeType }
      winningDepth[offset] = range.depth
    }
  }

  for (let offset = 0; offset < source.length; offset += 1) {
    if (!source[offset]!.trim()) classification[offset] = { kind: 'whitespace' }
  }

  const tokens: XenpaperHighlightToken[] = []
  let start = 0
  while (start < source.length) {
    const current = classification[start]!
    let end = start + 1
    while (
      end < source.length &&
      classification[end]!.kind === current.kind &&
      classification[end]!.nodeType === current.nodeType
    ) {
      end += 1
    }
    tokens.push({ ...current, text: source.slice(start, end), start, end })
    start = end
  }
  return tokens
}
