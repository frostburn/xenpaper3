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
  /** Tears down implicit nodes and connections owned by this patch. */
  dispose(): void
}

/** A patch whose top-level `input` and `output` bindings make it audio-connectable. */
export type EffectPatch = SynthPatch & AudioNode

export interface RuntimeOptions {
  /** Values for declarations marked `config`. */
  config?: Record<string, unknown>
  /** Additional, explicitly whitelisted values/functions available to the patch. */
  globals?: Record<string, unknown>
}

type Scope = Map<string, unknown>
type Dimensions = Readonly<Record<string, number>>
type Connectable = {
  connect(target: unknown, output?: number, input?: number): unknown
  disconnect(target?: unknown, output?: number, input?: number): unknown
}
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
      case 'st':
      case 'semitone':
      case 'semitones': return new Quantity(value * 100, { cent: 1 })
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

    if ((operator === '==' || operator === '!=')
      && ((left instanceof Quantity
        && !(right instanceof Quantity) && typeof right !== 'number')
        || (right instanceof Quantity
          && !(left instanceof Quantity) && typeof left !== 'number'))) {
      return operator === '!='
    }

    const leftQuantity = Quantity.from(left)
    const rightQuantity = Quantity.from(right)
    if (left instanceof Quantity && right instanceof Quantity
      && ['<', '>', '<=', '>=', '==', '!='].includes(operator)) {
      leftQuantity.assertCompatible(rightQuantity, 'compare')
    }
    switch (operator) {
      case '+': return leftQuantity.add(rightQuantity)
      case '-': return leftQuantity.add(rightQuantity, true)
      case '*': return leftQuantity.multiply(rightQuantity)
      case '/': return leftQuantity.multiply(rightQuantity, true)
      case '%': return leftQuantity.modulo(rightQuantity)
      case '**': return leftQuantity.power(rightQuantity)
      case '<': return leftQuantity.value < rightQuantity.value
      case '>': return leftQuantity.value > rightQuantity.value
      case '<=': return leftQuantity.value <= rightQuantity.value
      case '>=': return leftQuantity.value >= rightQuantity.value
      case '==': return leftQuantity.value === rightQuantity.value
      case '!=': return leftQuantity.value !== rightQuantity.value
      default: throw new Error(`Unsupported operator: ${operator}`)
    }
  }

  valueOf(): number { return this.value }

  negate(): Quantity { return new Quantity(-this.value, this.dimensions) }

  add(value: unknown, subtract = false): Quantity {
    let resultDimensions = this.dimensions
    let right = Quantity.from(value)

    if (this.isUnitless && !right.isUnitless) {
      resultDimensions = right.dimensions
    }

    if (!this.isUnitless && right.isUnitless) {
      right = new Quantity(right.value, this.dimensions)
    }

    const left = new Quantity(this.value, resultDimensions)
    left.assertCompatible(right)

    return new Quantity(
      left.value + (subtract ? -right.value : right.value),
      resultDimensions,
    )
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
    const remainder = ((this.value % right.value) + right.value) % right.value
    return new Quantity(Object.is(remainder, -0) ? 0 : remainder, this.dimensions)
  }

  power(value: unknown): Quantity {
    const exponent = Quantity.from(value)
    if (!exponent.isUnitless) throw new Error('A power must have a unitless exponent')
    return new Quantity(
      this.value ** exponent.value,
      Object.fromEntries(Object.entries(this.dimensions).map(([name, power]) => [
        name, power * exponent.value,
      ])),
    )
  }

  private get isUnitless(): boolean {
    return Object.keys(this.dimensions).length === 0
  }

  private assertCompatible(other: Quantity, operation = 'add'): void {
    const names = new Set([...Object.keys(this.dimensions), ...Object.keys(other.dimensions)])
    if ([...names].some((name) => this.dimensions[name] !== other.dimensions[name])) {
      throw new Error(`Cannot ${operation} quantities with incompatible units`)
    }
  }
}

interface AudioSignalGraph {
  gain(value?: Quantity): Connectable & { gain: unknown }
  constant(value: unknown): Connectable & { stop?: () => void }
  invert(): Connectable
  convert(name: MathWorkletName, inputs?: number): Connectable
  cleanup(cleanup: () => void): void
}

/** Builds the implicit Web Audio graph for arithmetic involving audio signals. */
class AudioSignal {
  private constructor(
    readonly node: Connectable,
    private readonly graph: AudioSignalGraph,
  ) {}

  static from(value: unknown, graph: AudioSignalGraph): AudioSignal | undefined {
    return AudioSignal.is(value) ? new AudioSignal(value, graph) : undefined
  }

  static is(value: unknown): value is Connectable {
    return typeof value === 'object' && value !== null
      && typeof (value as Partial<Connectable>).connect === 'function'
  }

  static binary(
    operator: string,
    left: unknown,
    right: unknown,
    graph: AudioSignalGraph,
  ): unknown | undefined {
    const leftSignal = AudioSignal.from(left, graph)
    const rightSignal = AudioSignal.from(right, graph)
    if (!leftSignal && !rightSignal) return undefined

    if (operator === '+' || operator === '-') {
      const leftOperand = leftSignal ?? AudioSignal.constant(left, graph)
      const rightOperand = rightSignal ?? AudioSignal.constant(right, graph)
      return leftOperand.add(operator === '-' ? rightOperand.negate() : rightOperand)
    }
    if (operator === '*' && leftSignal && rightSignal) return leftSignal.modulate(rightSignal)
    if (operator === '*') return (leftSignal ?? rightSignal!).scale(leftSignal ? right : left)
    if (operator === '/' && leftSignal && !rightSignal) {
      return leftSignal.scale(Quantity.scalar(1).multiply(right, true))
    }
    if (operator === '/') {
      const numerator = leftSignal ?? AudioSignal.constant(left, graph)
      return numerator.modulate(rightSignal!.routeThrough(graph.invert()))
    }
    return undefined
  }

  negate(): AudioSignal {
    return this.routeThrough(this.graph.gain(Quantity.scalar(-1)))
  }

  private add(right: AudioSignal): Connectable {
    const sum = this.graph.gain()
    this.connect(sum)
    right.connect(sum)
    return sum
  }

  private modulate(right: AudioSignal): Connectable {
    const gain = this.graph.gain(Quantity.scalar(0))
    this.connect(gain)
    right.connect(gain.gain)
    return gain
  }

  private scale(value: unknown): Connectable {
    return this.routeThrough(this.graph.gain(Quantity.from(value))).node
  }

  private routeThrough(target: Connectable): AudioSignal {
    this.connect(target)
    return new AudioSignal(target, this.graph)
  }

  private connect(target: unknown): void {
    this.node.connect(target)
    this.graph.cleanup(() => this.node.disconnect(target))
  }

  private static constant(value: unknown, graph: AudioSignalGraph): AudioSignal {
    const node = graph.constant(value)
    graph.cleanup(() => node.stop?.())
    return new AudioSignal(node, graph)
  }
}

const UNARY_MATH_FUNCTIONS = [
  'abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'cbrt', 'ceil', 'cos', 'cosh',
  'clz32', 'exp', 'expm1', 'floor', 'fround', 'log', 'log10', 'log1p', 'log2', 'round', 'sign', 'sin',
  'sinh', 'sqrt', 'tan', 'tanh', 'trunc',
] as const
const MULTI_MATH_FUNCTIONS = ['atan2', 'hypot', 'imul', 'max', 'min', 'pow'] as const
const MATH_FUNCTIONS = [...UNARY_MATH_FUNCTIONS, ...MULTI_MATH_FUNCTIONS] as const
const MATH_CONSTANTS = [
  'E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'PI', 'SQRT1_2', 'SQRT2',
] as const
type MathFunctionName = typeof MATH_FUNCTIONS[number]
type MathWorkletName = `sw-patch-${MathFunctionName}` | 'sw-patch-invert'
  | 'sw-patch-atodb' | 'sw-patch-dbtoa' | 'sw-patch-modulo'
  | 'sw-patch-less-than' | 'sw-patch-greater-than'
  | 'sw-patch-less-than-or-equal' | 'sw-patch-greater-than-or-equal'
  | 'sw-patch-equal' | 'sw-patch-not-equal' | 'sw-patch-where'

const MATH_WORKLET_SOURCE = `
/** Base class for stoppable, sample-by-sample SW Patch worklets. */
class SwPatchWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.stopped = false
    this.port.onmessage = ({ data }) => { if (data === 'stop') this.stopped = true }
  }
  process(inputs, outputs) {
    if (this.stopped) return false
    const output = outputs[0] || []
    for (let channel = 0; channel < output.length; channel++) {
      for (let sample = 0; sample < output[channel].length; sample++) {
        const values = inputs.map(input => {
          const source = input[channel] || input[0]
          return source ? source[sample] : 0
        })
        output[channel][sample] = this.transform(...values)
      }
    }
    return true
  }
}
class SwPatchInvertProcessor extends SwPatchWorkletProcessor {
  transform(value) { return 1 / value }
}
class SwPatchAtodbProcessor extends SwPatchWorkletProcessor {
  transform(value) { return 20 * Math.log10(Math.abs(value)) }
}
class SwPatchDbtoaProcessor extends SwPatchWorkletProcessor {
  transform(value) { return 10 ** (value / 20) }
}
class SwPatchModuloProcessor extends SwPatchWorkletProcessor {
  transform(left, right) {
    const remainder = ((left % right) + right) % right
    return Object.is(remainder, -0) ? 0 : remainder
  }
}
class SwPatchLessThanProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a < b) } }
class SwPatchGreaterThanProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a > b) } }
class SwPatchLessThanOrEqualProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a <= b) } }
class SwPatchGreaterThanOrEqualProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a >= b) } }
class SwPatchEqualProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a === b) } }
class SwPatchNotEqualProcessor extends SwPatchWorkletProcessor { transform(a, b) { return +(a !== b) } }
class SwPatchWhereProcessor extends SwPatchWorkletProcessor { transform(test, yes, no) { return test ? yes : no } }
registerProcessor('sw-patch-invert', SwPatchInvertProcessor)
registerProcessor('sw-patch-atodb', SwPatchAtodbProcessor)
registerProcessor('sw-patch-dbtoa', SwPatchDbtoaProcessor)
registerProcessor('sw-patch-modulo', SwPatchModuloProcessor)
registerProcessor('sw-patch-less-than', SwPatchLessThanProcessor)
registerProcessor('sw-patch-greater-than', SwPatchGreaterThanProcessor)
registerProcessor('sw-patch-less-than-or-equal', SwPatchLessThanOrEqualProcessor)
registerProcessor('sw-patch-greater-than-or-equal', SwPatchGreaterThanOrEqualProcessor)
registerProcessor('sw-patch-equal', SwPatchEqualProcessor)
registerProcessor('sw-patch-not-equal', SwPatchNotEqualProcessor)
registerProcessor('sw-patch-where', SwPatchWhereProcessor)
${UNARY_MATH_FUNCTIONS.map((name) => `
class SwPatchMath${name}Processor extends SwPatchWorkletProcessor {
  transform(value) { return Math.${name}(value) }
}
registerProcessor('sw-patch-${name}', SwPatchMath${name}Processor)`).join('')}
${MULTI_MATH_FUNCTIONS.map((name) => `
class SwPatchMath${name}Processor extends SwPatchWorkletProcessor {
  transform(...values) { return Math.${name}(...values) }
}
registerProcessor('sw-patch-${name}', SwPatchMath${name}Processor)`).join('')}
class SwPatchScheduledSourceProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.startedAt = Infinity
    this.stoppedAt = Infinity
    this.ended = false
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') this.startedAt = data.when
      if (data.type === 'stop') this.stoppedAt = data.when
    }
  }
  valueAt() { return 0 }
  process(_inputs, outputs, parameters) {
    if (currentTime >= this.stoppedAt) {
      if (!this.ended) {
        this.ended = true
        this.port.postMessage('ended')
      }
      return false
    }
    const output = outputs[0] || []
    for (const channel of output) for (let sample = 0; sample < channel.length; sample++) {
      const time = currentTime + sample / sampleRate
      channel[sample] = time >= this.startedAt && time < this.stoppedAt
        ? this.valueAt(time, sample, parameters) : 0
    }
    return true
  }
}
class SwPatchTimeProcessor extends SwPatchScheduledSourceProcessor {
  valueAt(time) { return time - this.startedAt }
}
class SwPatchPhaserProcessor extends SwPatchScheduledSourceProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 440 },
      { name: 'detune', defaultValue: 0 },
    ]
  }
  constructor() { super(); this.phase = 0 }
  valueAt(_time, sample, parameters) {
    const frequency = parameters.frequency.length === 1 ? parameters.frequency[0] : parameters.frequency[sample]
    const detune = parameters.detune.length === 1 ? parameters.detune[0] : parameters.detune[sample]
    const value = this.phase
    const computedFrequency = frequency * 2 ** (detune / 1200)
    this.phase = ((this.phase + computedFrequency / sampleRate) % 1 + 1) % 1
    return value
  }
}
class SwPatchRandomProcessor extends SwPatchScheduledSourceProcessor {
  valueAt() { return Math.random() }
}
registerProcessor('sw-patch-time', SwPatchTimeProcessor)
registerProcessor('sw-patch-phaser', SwPatchPhaserProcessor)
registerProcessor('sw-patch-random', SwPatchRandomProcessor)
`

/** Converts a linear amplitude to decibels. */
export function atodb(value: unknown): number {
  return 20 * Math.log10(Math.abs(Number(value)))
}

/** Converts decibels to a linear amplitude. */
export function dbtoa(value: unknown): number {
  return 10 ** (Number(value) / 20)
}

const registeredMathWorklets = new WeakMap<object, Promise<void>>()

/** Registers the inline processors used by SW Patch signal arithmetic. */
export function registerMathWorklets(context: BaseAudioContext): Promise<void> {
  const key = context as object
  const existing = registeredMathWorklets.get(key)
  if (existing) return existing
  if (!context.audioWorklet) {
    const unsupported = Promise.reject(new Error('This AudioContext does not support AudioWorklet'))
    // Avoid an unhandled rejection when registration was started implicitly.
    unsupported.catch(() => {})
    return unsupported
  }
  const url = URL.createObjectURL(new Blob([MATH_WORKLET_SOURCE], { type: 'text/javascript' }))
  const registration = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
  registeredMathWorklets.set(key, registration)
  return registration
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
  private readonly internalConnections = new WeakMap<object, Connectable>()
  private readonly topLevelBindings = new Set<string>()
  private readonly audioSignalGraph: AudioSignalGraph
  private readonly patchCleanups: Array<() => void> = []
  private activeConnectionCleanups?: Array<() => void>
  private disposed = false
  readonly workletsReady: Promise<void>

  constructor(context: BaseAudioContext, options: RuntimeOptions = {}) {
    this.context = context
    this.options = options
    this.workletsReady = registerMathWorklets(context)
    this.workletsReady.catch(() => {})
    this.root = new Map(Object.entries(options.globals ?? {}))
    this.audioSignalGraph = {
      gain: (value) => this.makeNode('Gain', value ? [{ gain: value }] : []) as Connectable & {
        gain: unknown
      },
      constant: (value) => this.createAndStartAudioSignal(value),
      invert: () => this.createMathWorklet('sw-patch-invert'),
      convert: (name, inputs) => this.createMathWorklet(name, inputs),
      cleanup: (cleanup) => { this.registerCleanup(cleanup) },
    }
    this.installBuiltins()
  }

  evaluate(program: Program): SynthPatch {
    this.topLevelBindings.clear()
    const patch: SynthPatch = { dispose: () => { this.dispose() } }
    this.statements(program.body, this.root, undefined, patch)
    return this.effectNode(patch)
  }

  /** Convenience wrapper for a started `ConstantSourceNode`. */
  createAndStartAudioSignal(value: unknown) {
    const quantity = Quantity.from(value)
    const node = new ConstantSourceNode(this.context, { offset: quantity.value })
    node.start()
    return node
  }

  private createMathWorklet(name: string, numberOfInputs = 1): AudioWorkletNode {
    const node = new AudioWorkletNode(this.context, name, { numberOfInputs })
    this.registerCleanup(() => node.port.postMessage('stop'))
    return node
  }

  private registerCleanup(cleanup: () => void): void {
    let active = true
    const once = () => {
      if (!active) return
      active = false
      cleanup()
    }
    if (this.disposed) {
      once()
      return
    }
    this.patchCleanups.push(once)
    this.activeConnectionCleanups?.push(once)
  }

  private dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const cleanup of this.patchCleanups.splice(0).reverse()) cleanup()
  }

  private installBuiltins(): void {
    this.root.set('BiquadFilterNode', (...args: unknown[]) => this.makeNode('BiquadFilter', args))
    this.root.set('ChannelMergerNode', (...args: unknown[]) => this.makeNode('ChannelMerger', args))
    this.root.set('ChannelSplitterNode', (...args: unknown[]) => this.makeNode('ChannelSplitter', args))
    this.root.set('DelayNode', (...args: unknown[]) => this.makeNode('Delay', args))
    this.root.set('GainNode', (...args: unknown[]) => this.makeNode('Gain', args))
    this.root.set('OscillatorNode', (...args: unknown[]) => this.makeNode('Oscillator', args))
    this.root.set('ConstantSourceNode', (...args: unknown[]) => this.makeNode('ConstantSource', args))
    this.root.set('AudioSignal', this.createAndStartAudioSignal.bind(this))
    this.root.set('TimeNode', () => this.createUtilitySource('sw-patch-time'))
    this.root.set('PhaserNode', (...args: unknown[]) => this.createUtilitySource('sw-patch-phaser', args))
    this.root.set('RandomNode', () => this.createUtilitySource('sw-patch-random'))
    this.root.set('where', (...values: unknown[]) => this.where(values))
    this.root.set('atodb', (value: unknown) => this.convertMath('sw-patch-atodb', atodb, value))
    this.root.set('dbtoa', (value: unknown) => this.convertMath('sw-patch-dbtoa', dbtoa, value))
    for (const name of UNARY_MATH_FUNCTIONS) {
      const transform: PatchFunction = (value: unknown) => this.convertMath(
        `sw-patch-${name}`,
        (input) => Math[name](Number(input)),
        value,
      )
      this.root.set(name, transform)
    }
    for (const name of MULTI_MATH_FUNCTIONS) {
      this.root.set(name, (...provided: unknown[]) => this.convertMultiMath(name, provided))
    }
    for (const name of MATH_CONSTANTS) this.root.set(name, Quantity.scalar(Math[name]))
    this.root.set('random', () => Quantity.scalar(Math.random()))
    this.root.set('print', console.log)
    this.root.set('context', this.context)
  }

  private createUtilitySource(name: string, args: unknown[] = []): AudioWorkletNode {
    const node = new AudioWorkletNode(this.context, name, { numberOfInputs: 0 })
    const options = (args[0] ?? {}) as Record<string, unknown>
    const frequency = node.parameters?.get('frequency')
    const detune = node.parameters?.get('detune')
    if (frequency && options.frequency !== undefined) frequency.value = Number(options.frequency)
    if (detune && options.detune !== undefined) detune.value = Number(options.detune)
    node.port.onmessage = ({ data }) => {
      if (data === 'ended') node.dispatchEvent(new Event('ended'))
    }
    Object.defineProperties(node, {
      start: { value: (when = this.context.currentTime) => node.port.postMessage({ type: 'start', when: Number(when) }) },
      stop: { value: (when = this.context.currentTime) => node.port.postMessage({ type: 'stop', when: Number(when) }) },
      ...(frequency ? { frequency: { value: frequency } } : {}),
      ...(detune ? { detune: { value: detune } } : {}),
    })
    this.registerCleanup(() => {
      node.port.onmessage = null
      node.port.postMessage({ type: 'stop', when: this.context.currentTime })
    })
    return node
  }

  private where(values: unknown[]): unknown {
    if (values.length !== 3) throw new Error('where() expects three arguments')
    if (!values.some(AudioSignal.is)) return Quantity.truthy(values[0]) ? values[1] : values[2]
    return this.connectWorkletInputs('sw-patch-where', values)
  }

  private connectWorkletInputs(name: MathWorkletName, values: unknown[]): AudioWorkletNode {
    const converter = this.audioSignalGraph.convert(name, values.length) as AudioWorkletNode
    values.forEach((value, index) => {
      const signal = AudioSignal.from(value, this.audioSignalGraph)
      const node = signal?.node ?? this.createAndStartAudioSignal(value)
      node.connect(converter, 0, index)
      this.registerCleanup(() => node.disconnect(converter, 0, index))
      if (!signal) this.registerCleanup(() => (node as Connectable & { stop?: () => void }).stop?.())
    })
    return converter
  }

  private convertMath(
    processor: MathWorkletName,
    scalar: (value: unknown) => number,
    value: unknown,
  ): unknown {
    const signal = AudioSignal.from(value, this.audioSignalGraph)
    if (!signal) return Quantity.scalar(scalar(value))
    const converter = this.audioSignalGraph.convert(processor)
    signal.node.connect(converter)
    this.registerCleanup(() => signal.node.disconnect(converter))
    return converter
  }

  private convertMultiMath(name: typeof MULTI_MATH_FUNCTIONS[number], provided: unknown[]): unknown {
    const last = provided[provided.length - 1]
    let values = provided
    if (last && typeof last === 'object' && !AudioSignal.is(last)
      && !(last instanceof Quantity) && !Array.isArray(last)) {
      const named = last as Record<string, unknown>
      values = name === 'atan2'
        ? [named.y, named.x]
        : Object.values(named)
    }
    const maximumArguments = name === 'max' || name === 'min' || name === 'hypot' ? 5 : 2
    if (values.length < (name === 'hypot' || name === 'max' || name === 'min' ? 1 : 2)
      || values.length > maximumArguments) {
      throw new Error(`${name}() expects ${maximumArguments === 2 ? 'two' : 'one to five'} arguments`)
    }
    if (!values.some(AudioSignal.is)) {
      const scalar = Math[name] as (...arguments_: number[]) => number
      return Quantity.scalar(scalar(...values.map(Number)))
    }
    const converter = this.audioSignalGraph.convert(`sw-patch-${name}`, values.length)
    values.forEach((value, index) => {
      const signal = AudioSignal.from(value, this.audioSignalGraph)
      const node: Connectable & { stop?: () => void } = signal?.node
        ?? this.createAndStartAudioSignal(value)
      node.connect(converter, 0, index)
      this.registerCleanup(() => node.disconnect(converter, 0, index))
      if (!signal) this.registerCleanup(() => node.stop?.())
    })
    return converter
  }

  private makeNode(
    kind: 'BiquadFilter' | 'ChannelMerger' | 'ChannelSplitter' | 'Delay' | 'Gain' | 'Oscillator' | 'ConstantSource',
    args: unknown[],
  ): unknown {
    const values = (args[0] ?? {}) as Record<string, unknown>
    const options = Object.fromEntries(Object.entries(values).map(([key, value]) => [
      key,
      value instanceof Quantity ? Number(value) : value,
    ]))
    const constructorName = `${kind}Node`
    const NodeConstructor = (globalThis as unknown as Record<string, unknown>)[constructorName]
    if (typeof NodeConstructor !== 'function') {
      throw new Error(`Web Audio does not provide ${constructorName}`)
    }
    const node = new (NodeConstructor as new (
      context: BaseAudioContext,
      options: Record<string, unknown>,
    ) => Record<string, unknown>)(this.context, options)
    return node
  }

  private effectNode(patch: SynthPatch): SynthPatch {
    if (!this.topLevelBindings.has('input') || !this.topLevelBindings.has('output')) return patch
    const input = this.root.get('input') as Record<string, unknown> | undefined
    const output = this.root.get('output') as Record<string, unknown> | undefined
    if (!input || !output || typeof input.connect !== 'function'
      || typeof output.connect !== 'function' || typeof output.disconnect !== 'function') return patch

    // The actual input AudioNode is returned so native Web Audio nodes accept the
    // patch as a destination. Its outward methods are redirected to the patch's output.
    const connect = (output.connect as (...args: unknown[]) => unknown).bind(output)
    const disconnect = (output.disconnect as (...args: unknown[]) => unknown).bind(output)
    this.internalConnections.set(input, {
      connect: (input.connect as Connectable['connect']).bind(input),
      disconnect: (input.disconnect as Connectable['disconnect']).bind(input),
    })
    for (const key of Reflect.ownKeys(patch)) {
      Object.defineProperty(input, key, Object.getOwnPropertyDescriptor(patch, key)!)
    }
    Object.defineProperties(input, {
      connect: { configurable: true, value: (...args: unknown[]) => connect(...args) },
      disconnect: { configurable: true, value: (...args: unknown[]) => disconnect(...args) },
    })
    return input as SynthPatch
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
    const previousCleanups = this.activeConnectionCleanups
    this.activeConnectionCleanups = connectionCleanups ?? previousCleanups
    try {
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
    } finally {
      this.activeConnectionCleanups = previousCleanups
    }
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
        scope.set(statement.name, this.expression(statement.value, scope))
        if (exports) this.topLevelBindings.add(statement.name)
        return undefined
      case 'AssignmentStatement':
        this.assign(statement.target, this.expression(statement.value, scope), scope)
        if (exports && statement.target.type === 'Identifier') {
          this.topLevelBindings.add(statement.target.name)
        }
        return undefined
      case 'ExpressionStatement':
        this.expression(statement.expression, scope); return undefined
      case 'ConnectionStatement': {
        const cleanups = this.connection(statement.first, statement.links, scope)
        for (const cleanup of cleanups) this.registerCleanup(cleanup)
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
    this.statements(body, scope, cleanups)
    if (event.type !== 'MemberExpression') throw new Error('until expects an event member')
    const emitter = this.expression(event.object, scope) as EventTarget
    emitter.addEventListener(event.property, () => {
      for (const cleanup of cleanups.reverse()) cleanup()
    }, { once: true })
  }

  private connection(first: Expression, links: {
    operator: 'connect' | 'disconnect'
    target: Expression
    output?: number
    input?: number
  }[], scope: Scope): Array<() => void> {
    let source = this.expression(first, scope) as Connectable
    const cleanups: Array<() => void> = []
    for (const link of links) {
      const target = this.expression(link.target, scope)
      const connectedSource = this.internalConnections.get(source as object) ?? source
      if (link.output === undefined && link.input === undefined) connectedSource[link.operator](target)
      else connectedSource[link.operator](target, link.output ?? 0, link.input ?? 0)
      if (link.operator === 'connect') {
        const disconnect = connectedSource.disconnect.bind(connectedSource)
        cleanups.push(() => {
          if (link.output === undefined && link.input === undefined) disconnect(target)
          else disconnect(target, link.output ?? 0, link.input ?? 0)
        })
      }
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
    if (operator === '+') return AudioSignal.is(value) ? value : Quantity.from(value)
    if (operator === '-' && AudioSignal.is(value)) {
      return AudioSignal.from(value, this.audioSignalGraph)!.negate().node
    }
    if (operator === '-') return Quantity.from(value).negate()
    return !Quantity.truthy(value)
  }

  private binary(operator: string, left: unknown, right: () => unknown): unknown {
    if (operator === 'and') return Quantity.truthy(left) ? right() : left
    if (operator === 'or') return Quantity.truthy(left) ? left : right()
    const rightValue = right()
    if (AudioSignal.is(left) || AudioSignal.is(rightValue)) {
      const processors: Partial<Record<string, MathWorkletName>> = {
        '%': 'sw-patch-modulo',
        '**': 'sw-patch-pow',
        '<': 'sw-patch-less-than',
        '>': 'sw-patch-greater-than',
        '<=': 'sw-patch-less-than-or-equal',
        '>=': 'sw-patch-greater-than-or-equal',
        '==': 'sw-patch-equal',
        '!=': 'sw-patch-not-equal',
      }
      const processor = processors[operator]
      if (processor) return this.connectWorkletInputs(processor, [left, rightValue])
      const result = AudioSignal.binary(operator, left, rightValue, this.audioSignalGraph)
      if (result !== undefined) return result
    }
    return Quantity.binary(operator, left, rightValue)
  }

  private assertSafeMember(property: string): void {
    if (FORBIDDEN_MEMBERS.has(property)) {
      throw new Error(`Patch access to member \`${property}\` is forbidden`)
    }
  }
}
