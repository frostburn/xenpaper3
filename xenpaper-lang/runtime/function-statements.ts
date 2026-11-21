import type { Expression } from '../parser.js'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import { evaluateDeclaration, evaluateExpression, isTruthy } from './expressions'
import { extendLexicalEnvironment } from './types'
import type { EvaluatedLiteral, LexicalEnvironment, PitchContext, PrimeMapping } from './types'

export type FunctionBindings = WeakMap<LexicalEnvironment, Map<string, EvaluatedLiteral>>

type Jump = 'break' | 'continue'

/** Execute value-producing statements before the function's final score or value expression. */
export function executeFunctionStatements(
  statements: readonly Expression[],
  mapping: PrimeMapping | PitchContext,
  environment: LexicalEnvironment,
  bindings: FunctionBindings,
  budget: { remaining: number },
): { environment?: LexicalEnvironment; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const abort = Symbol('function statement error')
  const fail = (node: Expression, code: string, message: string): never => {
    diagnostics.push({ code, severity: 'error', message, locations: [node.location] })
    throw abort
  }
  const spend = (node: Expression) => {
    if (--budget.remaining < 0)
      fail(node, 'XP_EXPANSION_LIMIT', 'Function execution exceeded the statement expansion limit.')
  }
  const evaluate = (node: Expression, scope: LexicalEnvironment): EvaluatedLiteral => {
    const evaluated = evaluateExpression(node, mapping, scope)
    diagnostics.push(...evaluated.diagnostics)
    if (!('value' in evaluated)) throw abort
    return evaluated.value
  }

  const run = (
    items: readonly Expression[],
    scope: LexicalEnvironment,
    inLoop: boolean,
  ): { scope: LexicalEnvironment; jump?: Jump } => {
    for (const statement of items) {
      spend(statement)
      switch (statement.type) {
        case 'Sequence': {
          const nested = run(statement.items, scope, inLoop)
          if (nested.jump) return nested
          scope = nested.scope
          break
        }
        case 'VariableDeclaration':
        case 'FunctionDeclaration': {
          const declared = evaluateDeclaration(statement, mapping, scope)
          diagnostics.push(...declared.diagnostics)
          if (declared.diagnostics.some(({ severity }) => severity === 'error')) throw abort
          scope = declared.environment
          if (statement.type === 'VariableDeclaration') {
            const variables = new Map(scope.variables)
            scope = { ...scope, variables }
            bindings.set(scope, variables)
          }
          break
        }
        case 'BindingAssignment': {
          const { name } = statement.name
          let target: LexicalEnvironment | undefined = scope
          while (target && !target.variables.has(name) && !target.functions.has(name))
            target = target.parent
          const variables = target && bindings.get(target)
          if (!variables?.has(name))
            return fail(
              statement.name,
              'XP_ASSIGNMENT',
              `Assignment requires a local variable or parameter named ${name}.`,
            )
          variables.set(name, evaluate(statement.value, scope))
          break
        }
        case 'ThrowStatement':
          return fail(statement, 'XP_THROW', statement.message)
        case 'LoopJump':
          if (!inLoop)
            fail(
              statement,
              'XP_LOOP_JUMP',
              `${statement.action} requires an enclosing loop body in the same function.`,
            )
          return { scope, jump: statement.action }
        case 'IfBlock': {
          const branch = isTruthy(evaluate(statement.condition, scope))
            ? statement.consequent
            : statement.alternate
          const jump = branch && run([branch], scope, inLoop).jump
          if (jump) return { scope, jump }
          break
        }
        case 'ForBlock':
        case 'WhileBlock': {
          let broke = false
          if (statement.type === 'ForBlock') {
            const iterable = evaluate(statement.iterable, scope)
            if (iterable.kind !== 'container')
              return fail(
                statement.iterable,
                'XP_NOT_ITERABLE',
                `for ${statement.mode} requires a container.`,
              )
            for (const [index, item] of iterable.values.entries()) {
              spend(statement)
              const value: EvaluatedLiteral =
                statement.mode === 'in'
                  ? { kind: 'scalar', value: new Value(index), origins: [] }
                  : item
              const variables = new Map([[statement.name.name, value]])
              const inner = extendLexicalEnvironment(scope, { variables })
              bindings.set(inner, variables)
              if (run(statement.body.items, inner, true).jump === 'break') {
                broke = true
                break
              }
            }
          } else {
            let inner = scope
            for (;;) {
              spend(statement)
              if (!isTruthy(evaluate(statement.condition, inner))) break
              const iteration = run(statement.body.items, inner, true)
              inner = iteration.scope
              if (iteration.jump === 'break') {
                broke = true
                break
              }
            }
          }
          const jump =
            !broke && statement.alternate && run(statement.alternate.items, scope, inLoop).jump
          if (jump) return { scope, jump }
          break
        }
        default:
          fail(
            statement,
            'XP_FUNCTION_STATEMENT',
            `${statement.type} cannot be executed before ret in a function.`,
          )
      }
    }
    return { scope }
  }

  try {
    return { environment: run(statements, environment, false).scope, diagnostics }
  } catch (error) {
    if (error !== abort) throw error
    return { diagnostics }
  }
}
