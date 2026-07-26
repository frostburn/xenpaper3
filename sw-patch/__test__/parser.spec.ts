import { describe, it, expect } from 'vitest'
import {parse} from '../parser.generated.js'

function stripLocation(node) {
  const result = {...node}
  delete result.location
  return result
}

describe('SW Patch parser', () => {
  it('parses indents Python style', () => {
    const source = `# First line
"top level string"
if true:
    "second level string"
"back to top level"
`
    const ast = parse(source)

    expect(ast.type).toBe('Program')
    expect(ast.body).toHaveLength(4)

    // Comments are statements for syntax-highlighting purposes
    expect(ast.body[0].type).toBe('CommentStatement')
    expect(ast.body[0].value).toBe(' First line')
    expect(ast.body[0].location).toEqual({
      source: undefined,
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 12, line: 1, column: 13 }
    })

    expect(ast.body[1].type).toBe('ExpressionStatement')
    expect(stripLocation(ast.body[1].expression)).toEqual({
      type: 'StringLiteral',
      value: 'top level string'
    })

    expect(ast.body[2].body).toHaveLength(1)
    expect(ast.body[2].body[0].type).toBe('ExpressionStatement')
    expect(stripLocation(ast.body[2].body[0].expression)).toEqual({
      type: 'StringLiteral',
      value: 'second level string'
    })

    expect(ast.body[3].type).toBe('ExpressionStatement')
    expect(stripLocation(ast.body[3].expression)).toEqual({
      type: 'StringLiteral',
      value: 'back to top level'
    })
  })
})
