import { parse } from './parser.generated.js'
import type {
  Argument,
  Automation,
  Expression,
  FunctionDeclaration,
  Program,
  Statement,
} from './parser.generated.js'

export type PatchFunction = (...arguments_: unknown[]) => unknown

export interface SynthPatch {
  [name: string]: unknown
}

export interface RuntimeOptions {
  /** Values for declarations marked `config`. */
  config?: Record<string, unknown>
  /** Additional, explicitly whitelisted values/functions available to the patch. */
  globals?: Record<string, unknown>
}

type Scope = Map<string, unknown>
type Connectable = { connect(target: unknown): unknown; disconnect(target?: unknown): unknown }
type AudioParameter = {
  value?: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  exponentialRampToValueAtTime(value: number, time: number): unknown
  setTargetAtTime(value: number, time: number, constant: number): unknown
  cancelScheduledValues(time: number): unknown
  cancelAndHoldAtTime(time: number): unknown
}

const RETURN = Symbol('sw-patch return')
interface Returned { [RETURN]: true; value: unknown }

/**
 * Parses and evaluates SW Patch source against one Web Audio context.
 *
 * The returned object contains the patch's public functions and configuration,
 * so `patch.on(...)` has the same call shape as `Synth.on(...)` in App.vue.
 */
export function createPatch(
  source: string,
  context: BaseAudioContext,
  options: RuntimeOptions = {},
): SynthPatch {
  return new PatchRuntime(context, options).evaluate(parse(source))
}

/** Alias emphasizing that source is compiled into a callable patch object. */
export const compilePatch = createPatch

export class PatchRuntime {
  readonly context: BaseAudioContext
  readonly options: RuntimeOptions
  private readonly root: Scope

  constructor(context: BaseAudioContext, options: RuntimeOptions = {}) {
    this.context = context
    this.options = options
    this.root = new Map(Object.entries(options.globals ?? {}))
    this.installBuiltins()
  }

  evaluate(program: Program): SynthPatch {
    const patch: SynthPatch = {}

    for (const statement of program.body) {
      if (statement.type === 'ConfigDeclaration') {
        const value = Object.hasOwn(this.options.config ?? {}, statement.name)
          ? this.options.config?.[statement.name]
          : this.expression(statement.value, this.root)
        this.root.set(statement.name, value)
        Object.defineProperty(patch, statement.name, {
          enumerable: true,
          get: () => this.root.get(statement.name),
          set: (next) => this.root.set(statement.name, next),
        })
      } else if (statement.type === 'FunctionDeclaration') {
        const fn = this.function(statement, this.root)
        this.root.set(statement.name, fn)
        patch[statement.name] = fn
      } else if (!this.isMetadata(statement)) {
        this.statements([statement], this.root)
      }
    }

    return patch
  }

  private installBuiltins(): void {
    this.root.set('OscillatorNode', (...args: unknown[]) => this.makeNode('Oscillator', args))
    this.root.set('GainNode', (...args: unknown[]) => this.makeNode('Gain', args))
    this.root.set('context', this.context)
  }

  private makeNode(kind: 'Oscillator' | 'Gain', args: unknown[]): unknown {
    const options = (args[0] ?? {}) as Record<string, unknown>
    const factory = this.context[`create${kind}` as keyof BaseAudioContext]
    if (typeof factory !== 'function') throw new Error(`Audio context cannot create a ${kind}Node`)
    const node = (factory as () => Record<string, unknown>).call(this.context)
    for (const [key, value] of Object.entries(options)) {
      const property = node[key] as { value?: unknown } | undefined
      if (property && typeof property === 'object' && 'value' in property) property.value = value
      else node[key] = value
    }
    return node
  }

  private function(declaration: FunctionDeclaration, closure: Scope): PatchFunction {
    let called = false
    return (...provided: unknown[]) => {
      if (declaration.once && called) throw new Error('Multiple calls to a `once fn`.')
      called = true
      const scope = new Map(closure)
      declaration.parameters.forEach((parameter, index) => {
        const value = index < provided.length
          ? provided[index]
          : parameter.defaultValue === null
            ? undefined
            : this.expression(parameter.defaultValue, scope)
        scope.set(parameter.name, value)
      })
      const result = this.statements(declaration.body, scope)
      return result && RETURN in result ? result.value : undefined
    }
  }

  private statements(statements: Statement[], scope: Scope): Returned | undefined {
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]
      if (!statement) continue

      if (statement.type === 'IfStatement') {
        let matched = false
        if (this.expression(statement.test, scope)) {
          matched = true
          const result = this.statements(statement.body, scope)
          if (result) return result
        }
        while (true) {
          const next = statements[index + 1]
          if (next?.type !== 'ElifStatement' && next?.type !== 'ElseStatement') break
          index += 1
          const branch = next
          if (!matched && (branch.type === 'ElseStatement' || this.expression(branch.test, scope))) {
            matched = true
            const result = this.statements(branch.body, scope)
            if (result) return result
          }
        }
        continue
      }

      const result = this.statement(statement, scope)
      if (result) return result
    }
    return undefined
  }

  private statement(statement: Statement, scope: Scope): Returned | undefined {
    switch (statement.type) {
      case 'FunctionDeclaration': {
        const fn = this.function(statement, scope)
        scope.set(statement.name, fn)
        if (statement.returned) return { [RETURN]: true, value: fn }
        return undefined
      }
      case 'TypedBinding':
        scope.set(statement.name, this.expression(statement.value, scope)); return undefined
      case 'AssignmentStatement':
        this.assign(statement.target, this.expression(statement.value, scope), scope); return undefined
      case 'ExpressionStatement':
        this.expression(statement.expression, scope); return undefined
      case 'ConnectionStatement':
        this.connection(statement.first, statement.links, scope); return undefined
      case 'ScheduledStatement':
        this.scheduled(statement.at, statement.automation, statement.statement, scope); return undefined
      case 'UntilStatement':
        this.until(statement.event, statement.body, scope); return undefined
      case 'ReturnStatement':
        return { [RETURN]: true, value: this.expression(statement.value, scope) }
      case 'ElifStatement':
      case 'ElseStatement':
        throw new Error(`${statement.type} must immediately follow an if statement`)
      case 'ConfigDeclaration':
        scope.set(statement.name, this.expression(statement.value, scope)); return undefined
      case 'TypeAlias':
      case 'CommentStatement':
      case 'DocStringStatement':
        return undefined
    }
  }

  private scheduled(at: Expression, automation: Automation | null, statement: Statement, scope: Scope): void {
    const time = Number(this.expression(at, scope))
    if (statement.type !== 'AssignmentStatement') {
      if (statement.type === 'ExpressionStatement') {
        const target = this.expression(statement.expression, scope) as AudioParameter
        if (automation?.type === 'HoldAutomation') target.cancelAndHoldAtTime(time)
        else if (automation?.type === 'CancelAutomation') target.cancelScheduledValues(time)
        else if (automation) throw new Error(`${automation.type} requires an assignment`)
      }
      else if (statement.type === 'ConnectionStatement') this.connection(statement.first, statement.links, scope)
      return
    }
    const target = this.expression(statement.target, scope) as AudioParameter
    const value = Number(this.expression(statement.value, scope))
    switch (automation?.type) {
      case 'LinearAutomation': target.linearRampToValueAtTime(value, time); break
      case 'ExponentialAutomation': target.exponentialRampToValueAtTime(value, time); break
      case 'TargetAutomation':
        target.setTargetAtTime(value, time, Number(this.expression(automation.timeConstant, scope))); break
      case 'HoldAutomation': target.cancelAndHoldAtTime(time); break
      case 'CancelAutomation': target.cancelScheduledValues(time); break
      default: target.setValueAtTime(value, time)
    }
  }

  private until(event: Expression, body: Statement[], scope: Scope): void {
    // Connections in an `until` suite are established now and torn down by the event.
    const cleanups: Array<() => void> = []
    for (const statement of body) {
      if (statement.type === 'ConnectionStatement') {
        cleanups.push(...this.connection(statement.first, statement.links, scope))
      } else this.statement(statement, scope)
    }
    if (event.type !== 'MemberExpression') throw new Error('until expects an event member')
    const emitter = this.expression(event.object, scope) as EventTarget
    emitter.addEventListener(event.property, () => {
      for (const cleanup of cleanups.reverse()) cleanup()
    }, { once: true })
  }

  private connection(first: Expression, links: { operator: 'connect' | 'disconnect'; target: Expression }[], scope: Scope): Array<() => void> {
    let source = this.expression(first, scope) as Connectable
    const cleanups: Array<() => void> = []
    for (const link of links) {
      const target = this.expression(link.target, scope)
      source[link.operator](target)
      const connectedSource = source
      if (link.operator === 'connect') cleanups.push(() => connectedSource.disconnect(target))
      source = target as Connectable
    }
    return cleanups
  }

  private assign(target: Expression, value: unknown, scope: Scope): void {
    if (target.type === 'Identifier') scope.set(target.name, value)
    else if (target.type === 'MemberExpression') {
      const object = this.expression(target.object, scope) as Record<string, unknown>
      object[target.property] = value
    } else throw new Error('Invalid assignment target')
  }

  private expression(expression: Expression, scope: Scope): unknown {
    switch (expression.type) {
      case 'Identifier': {
        if (!scope.has(expression.name)) throw new Error(`Unknown patch identifier: ${expression.name}`)
        return scope.get(expression.name)
      }
      case 'NumberLiteral': return Number(expression.value)
      case 'UnitLiteral': return this.unit(Number(expression.value), expression.unit)
      case 'StringLiteral': return expression.value
      case 'BooleanLiteral': return expression.value
      case 'NullLiteral': return null
      case 'ListLiteral': return expression.elements.map((value) => this.expression(value, scope))
      case 'ObjectLiteral': return Object.fromEntries(expression.entries.map(({ key, value }) => [key, this.expression(value, scope)]))
      case 'MemberExpression': return (this.expression(expression.object, scope) as Record<string, unknown>)[expression.property]
      case 'UnaryExpression': return this.unary(expression.operator, this.expression(expression.argument, scope))
      case 'BinaryExpression': return this.binary(expression.operator, this.expression(expression.left, scope), () => this.expression(expression.right, scope))
      case 'CallExpression': return this.call(expression.callee, expression.arguments, scope)
    }
  }

  private call(callee: Expression, args: Argument[], scope: Scope): unknown {
    const positional: unknown[] = []
    const named: Record<string, unknown> = {}
    for (const argument of args) {
      if (argument.type === 'NamedArgument') named[argument.name] = this.expression(argument.value, scope)
      else positional.push(this.expression(argument.value, scope))
    }
    if (Object.keys(named).length) positional.push(named)
    if (callee.type === 'MemberExpression') {
      const receiver = this.expression(callee.object, scope) as Record<string, unknown>
      return (receiver[callee.property] as PatchFunction).apply(receiver, positional)
    }
    return (this.expression(callee, scope) as PatchFunction)(...positional)
  }

  private unary(operator: string, value: unknown): unknown {
    if (operator === '+') return Number(value)
    if (operator === '-') return -Number(value)
    return !value
  }

  private binary(operator: string, left: unknown, right: () => unknown): unknown {
    if (operator === 'and') return left && right()
    if (operator === 'or') return left || right()
    const value = right()
    switch (operator) {
      case '+': return Number(left) + Number(value)
      case '-': return Number(left) - Number(value)
      case '*': return Number(left) * Number(value)
      case '/': return Number(left) / Number(value)
      case '%': return Number(left) % Number(value)
      case '<': return (left as number) < (value as number)
      case '>': return (left as number) > (value as number)
      case '<=': return (left as number) <= (value as number)
      case '>=': return (left as number) >= (value as number)
      case '==': return left === value
      case '!=': return left !== value
      default: throw new Error(`Unsupported operator: ${operator}`)
    }
  }

  private unit(value: number, unit: string): number {
    switch (unit.toLowerCase()) {
      case 'ns': return value / 1e9
      case 'us': return value / 1e6
      case 'ms': return value / 1e3
      case 'khz': return value * 1e3
      case '%': return value / 100
      case 'db': return 10 ** (value / 20)
      default: return value
    }
  }

  private isMetadata(statement: Statement): boolean {
    return statement.type === 'TypeAlias' || statement.type === 'CommentStatement' || statement.type === 'DocStringStatement'
  }
}
