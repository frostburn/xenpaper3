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
type Dimensions = Readonly<Record<string, number>>
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
const FORBIDDEN_MEMBERS = new Set(['constructor', 'prototype', '__proto__'])
interface Returned { [RETURN]: true; value: unknown }

/** A scalar expressed in canonical units together with its physical dimensions. */
export class Quantity {
  readonly value: number
  readonly dimensions: Dimensions

  constructor(value: number, dimensions: Dimensions = {}) {
    this.value = value
    this.dimensions = Object.fromEntries(
      Object.entries(dimensions).filter(([, exponent]) => exponent !== 0),
    )
  }

  static unit(value: number, unit: string): Quantity {
    switch (unit.toLowerCase()) {
      case 'ns': return new Quantity(value / 1e9, { time: 1 })
      case 'us': return new Quantity(value / 1e6, { time: 1 })
      case 'ms': return new Quantity(value / 1e3, { time: 1 })
      case 's': return new Quantity(value, { time: 1 })
      case 'khz': return new Quantity(value * 1e3, { time: -1 })
      case 'hz': return new Quantity(value, { time: -1 })
      case 'beats':
      case 'beat': return new Quantity(value, { beat: 1 })
      case 'bpm': return new Quantity(value / 60, { beat: 1, time: -1 })
      case 'db': return new Quantity(value, { decibel: 1 })
      case 'c': return new Quantity(value, { cent: 1 })
      case '%': return new Quantity(value / 100)
      default: return new Quantity(value)
    }
  }

  static scalar(value: number): Quantity { return new Quantity(value) }

  static from(value: unknown): Quantity {
    return value instanceof Quantity ? value : Quantity.scalar(Number(value))
  }

  static truthy(value: unknown): boolean {
    return value instanceof Quantity ? Boolean(value.value) : Boolean(value)
  }

  static binary(operator: string, left: unknown, right: unknown): unknown {
    if ((operator === '==' || operator === '!=')
      && !(left instanceof Quantity) && !(right instanceof Quantity)) {
      return operator === '==' ? left === right : left !== right
    }

    const leftQuantity = Quantity.from(left)
    const rightQuantity = Quantity.from(right)
    switch (operator) {
      case '+': return leftQuantity.add(rightQuantity)
      case '-': return leftQuantity.add(rightQuantity, true)
      case '*': return leftQuantity.multiply(rightQuantity)
      case '/': return leftQuantity.multiply(rightQuantity, true)
      case '%': return leftQuantity.modulo(rightQuantity)
      case '<': return leftQuantity.value < rightQuantity.value
      case '>': return leftQuantity.value > rightQuantity.value
      case '<=': return leftQuantity.value <= rightQuantity.value
      case '>=': return leftQuantity.value >= rightQuantity.value
      case '==': return leftQuantity.value === rightQuantity.value
      case '!=': return leftQuantity.value !== rightQuantity.value
      default: throw new Error(`Unsupported operator: ${operator}`)
    }
  }

  get isDecibels(): boolean {
    return this.dimensions.decibel === 1 && Object.keys(this.dimensions).length === 1
  }

  valueOf(): number { return this.value }

  negate(): Quantity { return new Quantity(-this.value, this.dimensions) }

  add(value: unknown, subtract = false): Quantity {
    let left: Quantity = this
    let right = Quantity.from(value)
    if (left.isUnitless && !right.isUnitless) left = new Quantity(left.value, right.dimensions)
    if (!left.isUnitless && right.isUnitless) right = new Quantity(right.value, left.dimensions)
    left.assertCompatible(right)
    return new Quantity(left.value + (subtract ? -right.value : right.value), left.dimensions)
  }

  multiply(value: unknown, divide = false): Quantity {
    const right = Quantity.from(value)
    const dimensions = { ...this.dimensions }
    for (const [name, exponent] of Object.entries(right.dimensions)) {
      dimensions[name] = (dimensions[name] ?? 0) + (divide ? -exponent : exponent)
    }
    return new Quantity(divide ? this.value / right.value : this.value * right.value, dimensions)
  }

  modulo(value: unknown): Quantity {
    const right = Quantity.from(value)
    if (!right.isUnitless) this.assertCompatible(right)
    return new Quantity(this.value % right.value, this.dimensions)
  }

  private get isUnitless(): boolean {
    return Object.keys(this.dimensions).length === 0
  }

  private assertCompatible(other: Quantity): void {
    const names = new Set([...Object.keys(this.dimensions), ...Object.keys(other.dimensions)])
    if ([...names].some((name) => this.dimensions[name] !== other.dimensions[name])) {
      throw new Error('Cannot add quantities with incompatible units')
    }
  }
}

/**
 * Parses and evaluates SW Patch source against one Web Audio context.
 *
 * The returned object contains the patch's public functions and configuration.
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
  private readonly gainNodes = new WeakSet<object>()

  constructor(context: BaseAudioContext, options: RuntimeOptions = {}) {
    this.context = context
    this.options = options
    this.root = new Map(Object.entries(options.globals ?? {}))
    this.installBuiltins()
  }

  evaluate(program: Program): SynthPatch {
    const patch: SynthPatch = {}
    this.statements(program.body, this.root, undefined, patch)
    return patch
  }

  private installBuiltins(): void {
    this.root.set('BiquadFilterNode', (...args: unknown[]) => this.makeNode('BiquadFilter', args))
    this.root.set('GainNode', (...args: unknown[]) => this.makeNode('Gain', args))
    this.root.set('OscillatorNode', (...args: unknown[]) => this.makeNode('Oscillator', args))
    this.root.set('context', this.context)
  }

  private makeNode(kind: 'BiquadFilter' | 'Gain' | 'Oscillator', args: unknown[]): unknown {
    const options = (args[0] ?? {}) as Record<string, unknown>
    const factory = this.context[`create${kind}` as keyof BaseAudioContext]
    if (typeof factory !== 'function') throw new Error(`Audio context cannot create a ${kind}Node`)
    const node = (factory as () => Record<string, unknown>).call(this.context)
    if (kind === 'Gain') this.gainNodes.add(node)
    for (const [key, value] of Object.entries(options)) {
      const property = node[key] as { value?: unknown } | undefined
      if (property && typeof property === 'object' && 'value' in property) {
        property.value = this.audioParameterValue(kind === 'Gain' && key === 'gain', value)
      }
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

  private statements(
    statements: Statement[],
    scope: Scope,
    connectionCleanups?: Array<() => void>,
    exports?: SynthPatch,
  ): Returned | undefined {
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]
      if (!statement) continue

      if (statement.type === 'IfStatement') {
        let matched = false
        if (Quantity.truthy(this.expression(statement.test, scope))) {
          matched = true
          const result = this.statements(statement.body, scope, connectionCleanups, exports)
          if (result) return result
        }
        while (true) {
          const next = statements[index + 1]
          if (next?.type !== 'ElifStatement' && next?.type !== 'ElseStatement') break
          index += 1
          const branch = next
          if (!matched && (branch.type === 'ElseStatement'
            || Quantity.truthy(this.expression(branch.test, scope)))) {
            matched = true
            const result = this.statements(branch.body, scope, connectionCleanups, exports)
            if (result) return result
          }
        }
        continue
      }

      const result = this.statement(statement, scope, connectionCleanups, exports)
      if (result) return result
    }
    return undefined
  }

  private statement(
    statement: Statement,
    scope: Scope,
    connectionCleanups?: Array<() => void>,
    exports?: SynthPatch,
  ): Returned | undefined {
    switch (statement.type) {
      case 'FunctionDeclaration': {
        const fn = this.function(statement, scope)
        scope.set(statement.name, fn)
        if (exports) exports[statement.name] = fn
        if (statement.returned) return { [RETURN]: true, value: fn }
        return undefined
      }
      case 'TypedBinding':
        scope.set(statement.name, this.expression(statement.value, scope)); return undefined
      case 'AssignmentStatement':
        this.assign(statement.target, this.expression(statement.value, scope), scope); return undefined
      case 'ExpressionStatement':
        this.expression(statement.expression, scope); return undefined
      case 'ConnectionStatement': {
        const cleanups = this.connection(statement.first, statement.links, scope)
        connectionCleanups?.push(...cleanups)
        return undefined
      }
      case 'ScheduledStatement':
        this.scheduled(statement.at, statement.automation, statement.statement, scope); return undefined
      case 'UntilStatement':
        this.until(statement.event, statement.body, scope); return undefined
      case 'ReturnStatement':
        return { [RETURN]: true, value: this.expression(statement.value, scope) }
      case 'ElifStatement':
      case 'ElseStatement':
        throw new Error(`${statement.type} must immediately follow an if statement`)
      case 'ConfigDeclaration': {
        const config = this.options.config ?? {}
        const value = Object.prototype.hasOwnProperty.call(config, statement.name)
          ? config[statement.name]
          : this.expression(statement.value, scope)
        scope.set(statement.name, value)
        if (exports) Object.defineProperty(exports, statement.name, {
          enumerable: true,
          get: () => scope.get(statement.name),
          set: (next) => scope.set(statement.name, next),
        })
        return undefined
      }
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
        if (automation?.type === 'HoldAutomation' || automation?.type === 'CancelAutomation') {
          const target = this.expression(statement.expression, scope) as AudioParameter
          if (automation.type === 'HoldAutomation') target.cancelAndHoldAtTime(time)
          else target.cancelScheduledValues(time)
        } else {
          if (automation) throw new Error(`${automation.type} requires an assignment`)
          if (statement.expression.type !== 'CallExpression') {
            throw new Error('A scheduled expression must be a method call')
          }
          this.call(statement.expression.callee, statement.expression.arguments, scope, time)
        }
      } else if (statement.type === 'ConnectionStatement') {
        throw new Error('Connections cannot be scheduled at an AudioContext timestamp')
      }
      return
    }
    const target = this.expression(statement.target, scope) as AudioParameter
    const amplitude = statement.target.type === 'MemberExpression'
      && statement.target.property === 'gain'
      && this.isGainNode(this.expression(statement.target.object, scope))
    const value = this.audioParameterValue(amplitude, this.expression(statement.value, scope))
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
    this.statements(body, scope, cleanups)
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
      this.assertSafeMember(target.property)
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
      case 'NumberLiteral': return Quantity.scalar(Number(expression.value))
      case 'UnitLiteral': return Quantity.unit(Number(expression.value), expression.unit)
      case 'StringLiteral': return expression.value
      case 'BooleanLiteral': return expression.value
      case 'NullLiteral': return null
      case 'ListLiteral': return expression.elements.map((value) => this.expression(value, scope))
      case 'ObjectLiteral': return Object.fromEntries(expression.entries.map(({ key, value }) => [key, this.expression(value, scope)]))
      case 'MemberExpression':
        this.assertSafeMember(expression.property)
        return (this.expression(expression.object, scope) as Record<string, unknown>)[expression.property]
      case 'UnaryExpression': return this.unary(expression.operator, this.expression(expression.argument, scope))
      case 'BinaryExpression': return this.binary(expression.operator, this.expression(expression.left, scope), () => this.expression(expression.right, scope))
      case 'CallExpression': return this.call(expression.callee, expression.arguments, scope)
    }
  }

  private call(callee: Expression, args: Argument[], scope: Scope, scheduledAt?: number): unknown {
    const positional: unknown[] = []
    const named: Record<string, unknown> = {}
    for (const argument of args) {
      if (argument.type === 'NamedArgument') named[argument.name] = this.expression(argument.value, scope)
      else positional.push(this.expression(argument.value, scope))
    }
    if (Object.keys(named).length) positional.push(named)
    if (scheduledAt !== undefined) positional.unshift(scheduledAt)
    if (callee.type === 'MemberExpression') {
      this.assertSafeMember(callee.property)
      const receiver = this.expression(callee.object, scope) as Record<string, unknown>
      return (receiver[callee.property] as PatchFunction).apply(receiver, positional)
    }
    return (this.expression(callee, scope) as PatchFunction)(...positional)
  }

  private unary(operator: string, value: unknown): unknown {
    if (operator === '+') return Quantity.from(value)
    if (operator === '-') return Quantity.from(value).negate()
    return !Quantity.truthy(value)
  }

  private binary(operator: string, left: unknown, right: () => unknown): unknown {
    if (operator === 'and') return Quantity.truthy(left) ? right() : left
    if (operator === 'or') return Quantity.truthy(left) ? left : right()
    return Quantity.binary(operator, left, right())
  }

  private audioParameterValue(amplitude: boolean, value: unknown): number {
    if (amplitude && value instanceof Quantity && value.isDecibels) {
      return 10 ** (value.value / 20)
    }
    return Number(value)
  }

  private isGainNode(value: unknown): boolean {
    return typeof value === 'object' && value !== null
      && (this.gainNodes.has(value) || value.constructor?.name === 'GainNode')
  }

  private assertSafeMember(property: string): void {
    if (FORBIDDEN_MEMBERS.has(property)) {
      throw new Error(`Patch access to member \`${property}\` is forbidden`)
    }
  }
}
