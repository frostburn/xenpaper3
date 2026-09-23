import { parse as parseSyntax } from './parser.generated.js'
import type { Comment, Node, Program, XenpaperParserOptions } from './parser.generated.js'

export type * from './parser.generated.js'

const collectSyntaxHashes = (value: unknown, source: string, hashes: Set<number>): boolean => {
  if (Array.isArray(value)) {
    let containsNode = false
    for (const child of value)
      containsNode = collectSyntaxHashes(child, source, hashes) || containsNode
    return containsNode
  }
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<Node> & Record<string, unknown>
  let containsChildNode = false
  for (const [key, child] of Object.entries(node)) {
    if (key === 'location' || key === 'replayPrefix') continue
    containsChildNode = collectSyntaxHashes(child, source, hashes) || containsChildNode
  }
  if (!node.type || !node.location) return containsChildNode
  if (!containsChildNode) {
    for (let offset = node.location.start.offset; offset < node.location.end.offset; offset += 1) {
      if (source[offset] === '#') hashes.add(offset)
    }
  }
  return true
}

/** Collect comments only after parsing, when the committed syntax tree is known. */
const collectComments = (program: Program): Comment[] => {
  const syntaxHashes = new Set<number>()
  collectSyntaxHashes(program.body, program.source, syntaxHashes)
  const positions = [{ offset: 0, line: 1, column: 1 }]
  for (let offset = 0, line = 1, column = 1; offset < program.source.length; offset += 1) {
    if (program.source[offset] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
    positions.push({ offset: offset + 1, line, column })
  }

  const comments: Comment[] = []
  let cursor = 0
  while (cursor < program.source.length) {
    const start = program.source.indexOf('#', cursor)
    if (start < 0) break
    if (syntaxHashes.has(start)) {
      cursor = start + 1
      continue
    }
    let end = start + 1
    while (end < program.source.length && !'\r\n'.includes(program.source[end]!)) end += 1
    const raw = program.source.slice(start, end)
    const comment: Comment = {
      type: 'Comment',
      value: raw.slice(1),
      raw,
      location: {
        source: program.location.source,
        start: positions[start]!,
        end: positions[end]!,
      },
    }
    comments.push(comment)
    cursor = end
  }
  return comments
}

export const parse = (input: string, options?: XenpaperParserOptions): Program => {
  const program = parseSyntax(input, options)
  program.comments = collectComments(program)
  return program
}
