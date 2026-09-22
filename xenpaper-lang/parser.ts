import { parse as parseSyntax } from './parser.generated.js'
import type { Comment, Node, Program, XenpaperParserOptions } from './parser.generated.js'

export type * from './parser.generated.js'

const overlapsCommittedSyntax = (comment: Comment, value: unknown): boolean => {
  if (Array.isArray(value)) return value.some((child) => overlapsCommittedSyntax(comment, child))
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<Node> & Record<string, unknown>
  if (node.type && node.location) {
    const { start, end } = node.location
    if (
      start.offset < comment.location.end.offset &&
      end.offset > comment.location.start.offset &&
      !(start.offset < comment.location.start.offset && end.offset > comment.location.end.offset)
    )
      return true
  }
  return Object.entries(node).some(
    ([key, child]) =>
      key !== 'location' && key !== 'replayPrefix' && overlapsCommittedSyntax(comment, child),
  )
}

/** Collect comments only after parsing, when the committed syntax tree is known. */
const collectComments = (program: Program): Comment[] => {
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
    if (overlapsCommittedSyntax(comment, program.body)) {
      cursor = start + 1
    } else {
      comments.push(comment)
      cursor = end
    }
  }
  return comments
}

export const parse = (input: string, options?: XenpaperParserOptions): Program => {
  const program = parseSyntax(input, options)
  program.comments = collectComments(program)
  return program
}
