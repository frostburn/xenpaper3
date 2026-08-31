import { describe, expect, it } from 'vitest'
import { Visitor, type VisitorEvaluation } from '../runtime/visitor'

describe('Visitor', () => {
  it('derives immutable child scopes from partial overrides', () => {
    type Scope = { prefix: string; depth: number }
    const evaluate: VisitorEvaluation<string, Scope, string> = (node, visitor) =>
      `${visitor.scope.prefix}${node}:${visitor.scope.depth}`
    const visitor = new Visitor(evaluate, { prefix: 'root/', depth: 0 })

    expect(visitor.visit('node', { depth: 1 })).toBe('root/node:1')
    expect(visitor.scope).toEqual({ prefix: 'root/', depth: 0 })
  })
})
