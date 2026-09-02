import type { Node, Program } from '../xenpaper-lang/parser.generated'

export type XenpaperHighlightKind =
  | 'comment'
  | 'directive'
  | 'keyword'
  | 'pitch'
  | 'pitch-latin'
  | 'pitch-greek'
  | 'pitch-mos'
  | 'ratio'
  | 'rest'
  | 'mos-declaration'
  | 'mos-pattern'
  | 'mos-udp'
  | 'mos-hardness'
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
  id: number
}

type HighlightClassification = Pick<XenpaperHighlightToken, 'kind' | 'nodeType'>

const precedence = (range: HighlightRange) =>
  range.kind === 'comment' ? Number.MAX_SAFE_INTEGER : range.depth

function wins(left: HighlightRange, right: HighlightRange): boolean {
  return (
    precedence(left) > precedence(right) ||
    (precedence(left) === precedence(right) && left.id > right.id)
  )
}

function heapPush(heap: HighlightRange[], range: HighlightRange): void {
  heap.push(range)
  let index = heap.length - 1
  while (index) {
    const parent = Math.floor((index - 1) / 2)
    if (!wins(heap[index]!, heap[parent]!)) break
    ;[heap[index], heap[parent]] = [heap[parent]!, heap[index]!]
    index = parent
  }
}

function heapPop(heap: HighlightRange[]): void {
  const last = heap.pop()
  if (!heap.length || !last) return
  heap[0] = last
  let index = 0
  while (true) {
    const left = index * 2 + 1
    const right = left + 1
    let winner = index
    if (left < heap.length && wins(heap[left]!, heap[winner]!)) winner = left
    if (right < heap.length && wins(heap[right]!, heap[winner]!)) winner = right
    if (winner === index) return
    ;[heap[index], heap[winner]] = [heap[winner]!, heap[index]!]
    index = winner
  }
}

const kindsByNodeType: Partial<Record<string, XenpaperHighlightKind>> = {
  Comment: 'comment',
  Directive: 'directive',
  PitchContextChange: 'keyword',
  MosDeclaration: 'mos-declaration',
  MosAbstractPattern: 'mos-pattern',
  MosIntegerPattern: 'mos-pattern',
  MosPatternCounts: 'mos-pattern',
  MosUdp: 'mos-udp',
  MosHardness: 'mos-hardness',
  SignatureDeclaration: 'keyword',
  ContextAssignment: 'keyword',
  ContextPreset: 'keyword',
  IntervalLiteral: 'pitch',
  MosIntervalLiteral: 'pitch',
  DegreeLiteral: 'pitch',
  DecimalLiteral: 'number',
  RealLiteral: 'number',
  IntegerLiteral: 'number',
  RatioLiteral: 'ratio',
  QuantityLiteral: 'number',
  EqualDivisionLiteral: 'number',
  MonzoLiteral: 'number',
  MappingLiteral: 'number',
  DrumSampleLiteral: 'identifier',
  Identifier: 'identifier',
  CallExpression: 'identifier',
  BinaryExpression: 'operator',
  UnaryExpression: 'operator',
  PitchModifier: 'operator',
  PostfixExpression: 'operator',
  TailElimination: 'operator',
  DetachedContinue: 'operator',
  Barline: 'punctuation',
  HardBoundary: 'punctuation',
  Group: 'punctuation',
  NormalizeToSlot: 'punctuation',
  Repeat: 'punctuation',
  EnumeratedChord: 'punctuation',
  Rest: 'rest',
}

function kindForNode(node: Node, ratioInteger = false): XenpaperHighlightKind | undefined {
  if (ratioInteger && node.type === 'IntegerLiteral') return 'ratio'
  if (node.type !== 'PitchLiteral') return kindsByNodeType[node.type]
  const system = (node as Node & { nominal?: { system?: string } }).nominal?.system
  if (system === 'latin') return 'pitch-latin'
  if (system === 'greek') return 'pitch-greek'
  if (system === 'mos') return 'pitch-mos'
  return 'pitch'
}

function isNode(value: unknown): value is Node {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Node>
  return (
    typeof candidate.type === 'string' &&
    Boolean(candidate.location?.start && candidate.location.end)
  )
}

function collectRanges(
  node: Node,
  ranges: HighlightRange[],
  depth = 0,
  ratioInteger = false,
): void {
  const kind = kindForNode(node, ratioInteger)
  if (kind) {
    ranges.push({
      kind,
      nodeType: node.type,
      start: node.location.start.offset,
      end: node.location.end.offset,
      depth,
      id: ranges.length,
    })
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'location') continue
    const childRatioInteger =
      ratioInteger ||
      node.type === 'EnumeratedChord' ||
      (node.type === 'EqualDivisionLiteral' && key === 'equave')
    collectNestedRanges(value, ranges, depth + 1, childRatioInteger)
  }
}

function collectNestedRanges(
  value: unknown,
  ranges: HighlightRange[],
  depth: number,
  ratioInteger: boolean,
): void {
  if (isNode(value)) {
    collectRanges(value, ranges, depth, ratioInteger)
  } else if (Array.isArray(value)) {
    for (const item of value) collectNestedRanges(item, ranges, depth, ratioInteger)
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value))
      collectNestedRanges(child, ranges, depth, ratioInteger)
  }
}

/** Build a lossless highlight stream from the parser's located syntax tree. */
export function highlightXenpaper(program: Program): XenpaperHighlightToken[] {
  const { source } = program
  if (!source) return []

  const ranges: HighlightRange[] = []
  collectRanges(program, ranges)

  const tokens: XenpaperHighlightToken[] = []
  const boundaries = new Map<number, { start: HighlightRange[]; end: HighlightRange[] }>()
  const boundaryAt = (offset: number) => {
    let boundary = boundaries.get(offset)
    if (!boundary) {
      boundary = { start: [], end: [] }
      boundaries.set(offset, boundary)
    }
    return boundary
  }
  boundaryAt(0)
  boundaryAt(source.length)
  for (const range of ranges) {
    boundaryAt(Math.max(0, range.start)).start.push(range)
    boundaryAt(Math.min(source.length, range.end)).end.push(range)
  }

  const active: HighlightRange[] = []
  const ended = new Set<number>()
  const offsets = [...boundaries.keys()].sort((left, right) => left - right)
  for (let index = 0; index < offsets.length - 1; index += 1) {
    const start = offsets[index]!
    const boundary = boundaries.get(start)!
    for (const range of boundary.end) ended.add(range.id)
    for (const range of boundary.start) heapPush(active, range)
    while (active[0] && ended.has(active[0].id)) heapPop(active)
    appendSegment(tokens, source, start, offsets[index + 1]!, active[0])
  }
  return tokens
}

function appendSegment(
  tokens: XenpaperHighlightToken[],
  source: string,
  start: number,
  end: number,
  range?: HighlightRange,
): void {
  let cursor = start
  while (cursor < end) {
    const whitespace = range?.kind !== 'comment' && !source[cursor]!.trim()
    let segmentEnd = cursor + 1
    while (
      segmentEnd < end &&
      (range?.kind === 'comment' || !source[segmentEnd]!.trim() === whitespace)
    ) {
      segmentEnd += 1
    }
    const classification: HighlightClassification = whitespace
      ? { kind: 'whitespace' }
      : { kind: range?.kind ?? 'punctuation', nodeType: range?.nodeType }
    const previous = tokens[tokens.length - 1]
    if (
      previous?.end === cursor &&
      previous.kind === classification.kind &&
      previous.nodeType === classification.nodeType
    ) {
      previous.text += source.slice(cursor, segmentEnd)
      previous.end = segmentEnd
    } else {
      tokens.push({
        ...classification,
        text: source.slice(cursor, segmentEnd),
        start: cursor,
        end: segmentEnd,
      })
    }
    cursor = segmentEnd
  }
}
