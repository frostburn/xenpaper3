import { kCombinations } from 'xen-dev-utils'
import type { CoercionAnnotation, Expression } from '../parser.js'
import { Value } from '../value'
import type { ExpressionEvaluationResult } from './expressions'
import { evaluateLiteral } from './literals'
import type { EvaluatedLiteral, LexicalEnvironment } from './types'
import { extendLexicalEnvironment } from './types'

export type ExpressionEvaluator = (
  node: Expression,
  environment?: LexicalEnvironment,
) => ExpressionEvaluationResult

type BuiltinCoercion = 'ratio' | 'pitch' | 'integer' | 'container' | undefined

type Coercion = BuiltinCoercion | CoercionAnnotation | null

const coercionName = (coercion: Coercion): string | undefined =>
  typeof coercion === 'string' ? coercion : coercion?.name

const elementCoercion = (coercion: Coercion): Coercion =>
  coercion && typeof coercion === 'object' && coercion.name === 'container' && coercion.element
    ? coercion.element
    : coercion

export function requireInteger(value: EvaluatedLiteral, name: string): number {
  if (value.kind !== 'scalar') throw new TypeError(`${name} must be an integer.`)
  const exact = value.value.exactRational()
  if (!exact || exact.d !== 1) throw new TypeError(`${name} must be an integer.`)
  return Number(exact.s * exact.n)
}

/** Evaluate an argument using Xenpaper's container syntax and parameter coercion rules. */
export function evaluateBuiltinArgument(
  node: Expression,
  coercion: Coercion,
  environment: LexicalEnvironment,
  evaluate: ExpressionEvaluator,
): ExpressionEvaluationResult {
  if (
    node.type === 'DegreeLiteral' &&
    (coercionName(coercion) === 'ratio' ||
      coercionName(coercion) === 'integer' ||
      coercionName(coercion) === 'boolean')
  )
    return evaluateLiteral({
      type: 'IntegerLiteral',
      value: node.degree,
      raw: node.raw,
      location: node.location,
    })
  if (node.type === 'Group')
    return evaluateBuiltinArgument(node.expression, coercion, environment, evaluate)
  if (node.type === 'NormalizeToSlot') {
    if (!node.expression)
      return {
        value: { kind: 'container', values: [], value: new Value(0), origins: [] },
        diagnostics: [],
      }
    const element = elementCoercion(coercion)
    if (node.expression.type === 'Sequence' || node.expression.type === 'Parallel')
      return evaluateBuiltinArgument(node.expression, element, environment, evaluate)
    const item = evaluateBuiltinArgument(node.expression, element, environment, evaluate)
    if (!('value' in item)) return item
    return {
      value: {
        kind: 'container',
        values: [item.value],
        value: new Value(0),
        origins: [{ location: node.location, role: 'literal' }],
      },
      diagnostics: item.diagnostics,
    }
  }
  if (node.type === 'Sequence' || node.type === 'Parallel') {
    const nodes = node.type === 'Sequence' ? node.items : node.branches
    const results = nodes.map((item) =>
      evaluateBuiltinArgument(item, coercion, environment, evaluate),
    )
    const diagnostics = results.flatMap((item) => item.diagnostics)
    if (!results.every((item) => 'value' in item)) return { diagnostics }
    return {
      value: {
        kind: 'container',
        values: results.map((item) => (item as { value: EvaluatedLiteral }).value),
        value: new Value(0),
        origins: [{ location: node.location, role: 'literal' }],
      },
      diagnostics,
    }
  }
  return evaluate(node, environment)
}

/** One callable built-in, including its signature, coercions, and implementation. */
abstract class Builtin {
  protected constructor(
    readonly name: string,
    private readonly minimumArguments: number,
    private readonly maximumArguments: number,
    private readonly coercions: readonly BuiltinCoercion[],
  ) {}

  evaluate(
    node: Extract<Expression, { type: 'CallExpression' }>,
    environment: LexicalEnvironment,
    evaluate: ExpressionEvaluator,
  ): ExpressionEvaluationResult {
    if (
      node.arguments.length < this.minimumArguments ||
      node.arguments.length > this.maximumArguments
    )
      throw new TypeError(this.arityMessage(node.arguments.length))
    const evaluated = node.arguments.map((argument, index) =>
      evaluateBuiltinArgument(argument, this.coercions[index], environment, evaluate),
    )
    const diagnostics = evaluated.flatMap((argument) => argument.diagnostics)
    if (!evaluated.every((argument) => 'value' in argument)) return { diagnostics }
    const arguments_ = evaluated.map((argument) => (argument as { value: EvaluatedLiteral }).value)
    return { value: this.call(arguments_, evaluate), diagnostics }
  }

  protected abstract call(
    arguments_: readonly EvaluatedLiteral[],
    evaluate: ExpressionEvaluator,
  ): EvaluatedLiteral

  protected requireContainer(arguments_: readonly EvaluatedLiteral[], index = 0) {
    const argument = arguments_[index]
    if (!argument || argument.kind !== 'container')
      throw new TypeError(`${this.name}() expects a container.`)
    return argument.values
  }

  protected origins(arguments_: readonly EvaluatedLiteral[]) {
    return arguments_.flatMap((argument) => argument.origins)
  }

  private arityMessage(received: number): string {
    const expected =
      this.minimumArguments === this.maximumArguments
        ? `${this.minimumArguments} argument${this.minimumArguments === 1 ? '' : 's'}`
        : `${this.minimumArguments} to ${this.maximumArguments} arguments`
    return `${this.name}() expects ${expected}, but received ${received}.`
  }
}

class PitchBuiltin extends Builtin {
  constructor() {
    super('pitch', 1, 1, ['ratio'])
  }

  protected call([value]: readonly EvaluatedLiteral[]): EvaluatedLiteral {
    return this.convert(value!)
  }

  private convert(value: EvaluatedLiteral): EvaluatedLiteral {
    if (value.kind === 'container')
      return { ...value, values: value.values.map((item) => this.convert(item)) }
    if (value.kind !== 'scalar') throw new TypeError('pitch() expects scalar ratios.')
    return {
      kind: 'pitchOffset',
      value: Value.pitch(value.value),
      origins: value.origins,
      ...(value.value.isPositiveExactRatio() ? { justIntonation: true } : {}),
    }
  }
}

class RatioBuiltin extends Builtin {
  constructor() {
    super('ratio', 1, 1, ['pitch'])
  }

  protected call([value]: readonly EvaluatedLiteral[]): EvaluatedLiteral {
    return this.convert(value!)
  }

  private convert(value: EvaluatedLiteral): EvaluatedLiteral {
    if (value.kind === 'container')
      return { ...value, values: value.values.map((item) => this.convert(item)) }
    if (value.kind === 'scalar') return value
    if (value.kind !== 'pitchOffset') throw new TypeError('ratio() expects pitch offsets.')
    return { kind: 'scalar', value: Value.ratio(value.value), origins: value.origins }
  }
}

class KCombinationsBuiltin extends Builtin {
  constructor() {
    super('kCombinations', 2, 2, ['container', 'integer'])
  }

  protected call(arguments_: readonly EvaluatedLiteral[]): EvaluatedLiteral {
    const origins = this.origins(arguments_)
    const count = requireInteger(arguments_[1]!, 'Combination size')
    return {
      kind: 'container',
      values: kCombinations(this.requireContainer(arguments_), count).map((values) => ({
        kind: 'container',
        values,
        value: new Value(0),
        origins,
      })),
      value: new Value(0),
      origins,
    }
  }
}

class ArrayReduceBuiltin extends Builtin {
  constructor() {
    super('arrayReduce', 2, 3, [undefined, 'container', undefined])
  }

  protected call(
    arguments_: readonly EvaluatedLiteral[],
    evaluate: ExpressionEvaluator,
  ): EvaluatedLiteral {
    const callback = arguments_[0]
    if (callback?.kind !== 'lambda' || callback.parameters.length !== 2)
      throw new TypeError('arrayReduce() expects a two-parameter lambda.')
    const items = this.requireContainer(arguments_, 1)
    const initial = arguments_[2]
    if (!items.length && !initial)
      throw new TypeError(
        'arrayReduce() cannot reduce an empty container without an initial value.',
      )
    let accumulator = initial ?? items[0]!
    for (const item of initial ? items : items.slice(1)) {
      const environment = extendLexicalEnvironment(callback.environment, {
        variables: new Map([
          [callback.parameters[0]!, accumulator],
          [callback.parameters[1]!, item],
        ]),
      })
      const reduced = evaluate(callback.body, environment)
      if (!('value' in reduced))
        throw new TypeError(reduced.diagnostics[0]?.message ?? 'arrayReduce() callback failed.')
      accumulator = reduced.value
    }
    return accumulator
  }
}

class ArrayMapBuiltin extends Builtin {
  constructor() {
    super('arrayMap', 2, 2, [undefined, 'container'])
  }

  protected call(
    arguments_: readonly EvaluatedLiteral[],
    evaluate: ExpressionEvaluator,
  ): EvaluatedLiteral {
    const callback = arguments_[0]
    if (callback?.kind !== 'lambda' || callback.parameters.length !== 1)
      throw new TypeError('arrayMap() expects a one-parameter lambda.')
    const origins = this.origins(arguments_)
    return {
      kind: 'container',
      values: this.requireContainer(arguments_, 1).map((item) => {
        const environment = extendLexicalEnvironment(callback.environment, {
          variables: new Map([[callback.parameters[0]!, item]]),
        })
        const mapped = evaluate(callback.body, environment)
        if (!('value' in mapped))
          throw new TypeError(mapped.diagnostics[0]?.message ?? 'arrayMap() callback failed.')
        return mapped.value
      }),
      value: new Value(0),
      origins,
    }
  }
}

class SortBuiltin extends Builtin {
  constructor() {
    super('sort', 1, 1, ['container'])
  }

  protected call(arguments_: readonly EvaluatedLiteral[]): EvaluatedLiteral {
    const values = this.requireContainer(arguments_)
    if (values.some((item) => item.kind !== 'scalar' && item.kind !== 'pitchOffset'))
      throw new TypeError('sort() expects numeric values.')
    const numeric = values as readonly Extract<
      EvaluatedLiteral,
      { kind: 'scalar' | 'pitchOffset' }
    >[]
    return {
      kind: 'container',
      values: [...numeric].sort((a, b) => a.value.valueOf() - b.value.valueOf()),
      value: new Value(0),
      origins: this.origins(arguments_),
    }
  }
}

const BUILTINS = new Map(
  [
    new PitchBuiltin(),
    new RatioBuiltin(),
    new KCombinationsBuiltin(),
    new ArrayReduceBuiltin(),
    new ArrayMapBuiltin(),
    new SortBuiltin(),
  ].map((builtin) => [builtin.name, builtin]),
)

export function evaluateBuiltinCall(
  node: Extract<Expression, { type: 'CallExpression' }>,
  environment: LexicalEnvironment,
  evaluate: ExpressionEvaluator,
): ExpressionEvaluationResult {
  const builtin = BUILTINS.get(node.callee)
  if (builtin) return builtin.evaluate(node, environment, evaluate)
  return {
    diagnostics: [
      {
        code: 'XP_UNDEFINED_NAME',
        severity: 'error',
        message: `Undefined function ${node.callee}().`,
        locations: [node.location],
      },
    ],
  }
}
