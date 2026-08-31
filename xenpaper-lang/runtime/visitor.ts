/** Evaluation callback for an immutable, scope-carrying visitor. */
export type VisitorEvaluation<Node, Scope extends object, Result> = (
  node: Node,
  visitor: Visitor<Node, Scope, Result>,
) => Result

/**
 * Small traversal helper that keeps contextual state beside the visit operation.
 * Child traversals can override only the scope values they change.
 */
export class Visitor<Node, Scope extends object, Result> {
  constructor(
    private readonly evaluate: VisitorEvaluation<Node, Scope, Result>,
    readonly scope: Scope,
  ) {}

  spawn(overrides: Partial<Scope> = {}): Visitor<Node, Scope, Result> {
    return new Visitor(this.evaluate, { ...this.scope, ...overrides })
  }

  visit(node: Node, overrides: Partial<Scope> = {}): Result {
    const visitor = Object.keys(overrides).length ? this.spawn(overrides) : this
    return this.evaluate(node, visitor)
  }
}
