import { describe, it, expect } from 'vitest'
import { parse, type Node } from '../parser.generated.js'

function stripLocation<T extends Node>(node: T): Omit<T, 'location'> {
  const result: Partial<T> = { ...node }
  delete result.location
  return result as Omit<T, 'location'>
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
    const [comment, topLevelExpression, conditional, finalExpression] = ast.body

    expect(comment).toMatchObject({
      type: 'CommentStatement',
      value: ' First line'
    })
    expect(comment?.location).toEqual({
      source: undefined,
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 12, line: 1, column: 13 }
    })

    expect(topLevelExpression?.type).toBe('ExpressionStatement')
    if (topLevelExpression?.type !== 'ExpressionStatement') {
      throw new Error('Expected expression')
    }
    expect(stripLocation(topLevelExpression.expression)).toEqual({
      type: 'StringLiteral',
      value: 'top level string'
    })

    expect(conditional?.type).toBe('IfStatement')
    if (conditional?.type !== 'IfStatement') throw new Error('Expected if statement')
    expect(conditional.body).toHaveLength(1)
    const nestedExpression = conditional.body[0]
    expect(nestedExpression?.type).toBe('ExpressionStatement')
    if (nestedExpression?.type !== 'ExpressionStatement') {
      throw new Error('Expected expression')
    }
    expect(stripLocation(nestedExpression.expression)).toEqual({
      type: 'StringLiteral',
      value: 'second level string'
    })

    expect(finalExpression?.type).toBe('ExpressionStatement')
    if (finalExpression?.type !== 'ExpressionStatement') {
      throw new Error('Expected expression')
    }
    expect(stripLocation(finalExpression.expression)).toEqual({
      type: 'StringLiteral',
      value: 'back to top level'
    })
  })
})
