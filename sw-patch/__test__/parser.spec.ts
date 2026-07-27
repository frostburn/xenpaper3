import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse, type Node } from '../parser.generated.js'

function stripLocation<T extends Node>(node: T): Omit<T, 'location'> {
  const result: Partial<T> = { ...node }
  delete result.location
  return result as Omit<T, 'location'>
}

describe('SW Patch parser', () => {
  it('parses the default v3 patch', () => {
    const source = readFileSync(new URL('../../default-v3.swpatch', import.meta.url), 'utf8')
    const ast = parse(source)

    expect(ast.body.map(({ type }) => type)).toEqual([
      'ConfigDeclaration',
      'FunctionDeclaration'
    ])

    const on = ast.body[1]
    expect(on).toMatchObject({
      type: 'FunctionDeclaration',
      name: 'on',
      once: false,
      returned: false,
      parameters: [
        { name: 'destination', defaultValue: null },
        { name: 'start', defaultValue: null },
        { name: 'pitch', defaultValue: null },
        { name: 'velocity', defaultValue: null },
        { name: 'attack', defaultValue: { type: 'UnitLiteral', value: '100', unit: 'ms' } },
        { name: 'decay', defaultValue: { type: 'UnitLiteral', value: '200', unit: 'ms' } },
        { name: 'sustain', defaultValue: { type: 'UnitLiteral', value: '70', unit: '%' } },
        { name: 'release', defaultValue: { type: 'UnitLiteral', value: '300', unit: 'ms' } }
      ]
    })

    if (on?.type !== 'FunctionDeclaration') throw new Error('Expected function declaration')
    expect(on.body.some(({ type }) => type === 'UntilStatement')).toBe(true)
    expect(on.body.at(-1)).toMatchObject({
      type: 'FunctionDeclaration',
      name: 'off',
      once: true,
      returned: true
    })
  })

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
