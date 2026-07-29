import { describe, expect, it, vi } from 'vitest'
import { PatchRuntime, Quantity, createPatch, type PatchFunction } from '../runtime.js'
import type { Program } from '../parser.generated.js'

function location() {
  const point = { offset: 0, line: 1, column: 1 }
  return { source: undefined, start: point, end: point }
}

describe('SW Patch runtime', () => {
  it('builds Web Audio graphs for signal arithmetic', () => {
    const created: MockGainNode[] = []
    class MockGainNode {
      gain = {}
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()

      constructor(_context: BaseAudioContext, readonly options: { gain?: number } = {}) {
        created.push(this)
      }
    }
    vi.stubGlobal('GainNode', MockGainNode)
    const signalA = {
      connect: vi.fn<(target: unknown) => void>(),
      disconnect: vi.fn<(target?: unknown) => void>(),
    }
    const signalB = {
      connect: vi.fn<(target: unknown) => void>(),
      disconnect: vi.fn<(target?: unknown) => void>(),
    }

    const patch = createPatch(
      'fn negative():\n    ret -signalA\n'
      + 'fn positive():\n    ret +signalA\n'
      + 'fn sum():\n    ret signalA + signalB\n'
      + 'fn difference():\n    ret signalA - signalB\n'
      + 'fn product():\n    ret signalA * signalB\n',
      {} as BaseAudioContext,
      { globals: { signalA, signalB } },
    )

    const negative = (patch.negative as PatchFunction)()
    expect(created[0]?.options).toEqual({ gain: -1 })
    expect(signalA.connect).toHaveBeenCalledWith(negative)
    expect((patch.positive as PatchFunction)()).toBe(signalA)

    signalA.connect.mockClear()
    signalB.connect.mockClear()
    const sum = (patch.sum as PatchFunction)()
    expect(signalA.connect).toHaveBeenCalledWith(sum)
    expect(signalB.connect).toHaveBeenCalledWith(sum)

    signalA.connect.mockClear()
    signalB.connect.mockClear()
    const difference = (patch.difference as PatchFunction)()
    const inverter = created.at(-2)
    expect(inverter?.options).toEqual({ gain: -1 })
    expect(signalB.connect).toHaveBeenCalledWith(inverter)
    expect(signalA.connect).toHaveBeenCalledWith(difference)
    expect(inverter?.connect).toHaveBeenCalledWith(difference)

    signalA.connect.mockClear()
    signalB.connect.mockClear()
    const product = (patch.product as PatchFunction)() as MockGainNode
    expect(product.options).toEqual({ gain: 0 })
    expect(signalA.connect).toHaveBeenCalledWith(product)
    expect(signalB.connect).toHaveBeenCalledWith(product.gain)
  })

  it('combines signals with scalars and cleans up implicit until connections', () => {
    const gains: MockGainNode[] = []
    const constants: MockConstantSourceNode[] = []
    class MockGainNode {
      gain = {}
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
      constructor(_context: BaseAudioContext, readonly options: { gain?: number } = {}) {
        gains.push(this)
      }
    }
    class MockConstantSourceNode {
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
      start = vi.fn<() => void>()
      stop = vi.fn<() => void>()
      constructor(_context: BaseAudioContext, readonly options: { offset: number }) {
        constants.push(this)
      }
    }
    vi.stubGlobal('GainNode', MockGainNode)
    vi.stubGlobal('ConstantSourceNode', MockConstantSourceNode)
    const emitter = new EventTarget()
    const signal = {
      connect: vi.fn<(target: unknown) => void>(),
      disconnect: vi.fn<(target?: unknown) => void>(),
    }
    const destination = {
      connect: vi.fn<(target: unknown) => void>(),
      disconnect: vi.fn<(target?: unknown) => void>(),
    }
    const patch = createPatch(
      'fn scaledLeft():\n    ret 2 * signal\n'
      + 'fn scaledRight():\n    ret signal * 3\n'
      + 'fn divided():\n    ret signal / 4\n'
      + 'fn offset():\n    ret signal + 5\n'
      + 'fn reverseDifference():\n    ret 6 - signal\n'
      + 'until emitter.ended:\n'
      + '    sum = signal + 7\n'
      + '    sum -> destination\n',
      {} as BaseAudioContext,
      { globals: { destination, emitter, signal } },
    )

    expect(((patch.scaledLeft as PatchFunction)() as MockGainNode).options).toEqual({ gain: 2 })
    expect(((patch.scaledRight as PatchFunction)() as MockGainNode).options).toEqual({ gain: 3 })
    expect(((patch.divided as PatchFunction)() as MockGainNode).options).toEqual({ gain: 0.25 })
    const offset = (patch.offset as PatchFunction)()
    expect(constants[1]?.options).toEqual({ offset: 5 })
    expect(constants[1]?.start).toHaveBeenCalledOnce()
    expect(constants[1]?.connect).toHaveBeenCalledWith(offset)
    const reverseDifference = (patch.reverseDifference as PatchFunction)()
    expect(constants[2]?.options).toEqual({ offset: 6 })
    expect(constants[2]?.connect).toHaveBeenCalledWith(reverseDifference)

    const untilSum = gains[0]
    emitter.dispatchEvent(new Event('ended'))
    expect(signal.disconnect).toHaveBeenCalledWith(untilSum)
    expect(constants[0]?.disconnect).toHaveBeenCalledWith(untilSum)
    expect(constants[0]?.stop).toHaveBeenCalledOnce()
    expect(untilSum?.disconnect).toHaveBeenCalledWith(destination)

    patch.dispose()
    expect(constants[1]?.disconnect).toHaveBeenCalledWith(offset)
    expect(constants[1]?.stop).toHaveBeenCalledOnce()
    expect(constants[2]?.disconnect).toHaveBeenCalledWith(reverseDifference)
    expect(constants[2]?.stop).toHaveBeenCalledOnce()
  })

  it('returns effect patches as input nodes whose output can connect onward', () => {
    const inputConnect = vi.fn<(target: unknown) => void>()
    const outputConnect = vi.fn<(target: unknown) => void>()
    const outputDisconnect = vi.fn<(target?: unknown) => void>()
    const input = { connect: inputConnect, disconnect: vi.fn<(target?: unknown) => void>() }
    const output = { connect: outputConnect, disconnect: outputDisconnect }
    const nodes = [input, output]
    const GainNode = vi.fn<() => typeof input | undefined>(function () { return nodes.shift() })
    vi.stubGlobal('GainNode', GainNode)
    const context = {} as BaseAudioContext

    const effect = createPatch(
      'input = GainNode()\n'
      + 'output = GainNode()\n'
      + 'input -> output\n',
      context,
    ) as unknown as AudioNode
    const destination = {} as AudioNode

    expect(effect).toBe(input)
    expect(inputConnect).toHaveBeenCalledWith(output)
    effect.connect(destination)
    effect.disconnect(destination)
    expect(outputConnect).toHaveBeenCalledWith(destination)
    expect(outputDisconnect).toHaveBeenCalledWith(destination)
  })

  it('passes normalized options to Web Audio constructors', () => {
    const DelayNode = vi.fn<() => void>(function () {})
    const ChannelMergerNode = vi.fn<() => void>(function () {})
    vi.stubGlobal('DelayNode', DelayNode)
    vi.stubGlobal('ChannelMergerNode', ChannelMergerNode)
    const context = {} as BaseAudioContext

    createPatch(
      'delay = DelayNode(maxDelayTime = 2s, delayTime = 250ms)\n'
      + 'merger = ChannelMergerNode(numberOfInputs = 2)\n',
      context,
    )

    expect(DelayNode).toHaveBeenCalledWith(context, { maxDelayTime: 2, delayTime: 0.25 })
    expect(ChannelMergerNode).toHaveBeenCalledWith(context, { numberOfInputs: 2 })
  })

  it('does not treat inherited global endpoints as patch declarations', () => {
    const input = { connect: vi.fn<(target: unknown) => void>(), disconnect: vi.fn<() => void>() }
    const output = { connect: vi.fn<(target: unknown) => void>(), disconnect: vi.fn<() => void>() }
    const patch = createPatch('fn noop():\n    ret null\n', {} as BaseAudioContext, {
      globals: { input, output },
    })

    expect(patch).not.toBe(input)
    expect(patch.noop).toBeTypeOf('function')
  })

  it('connects and cleans up explicitly selected node ports', () => {
    const emitter = new EventTarget()
    const source = { connect: vi.fn<(target: unknown, output?: number, input?: number) => void>(), disconnect: vi.fn<(target?: unknown, output?: number, input?: number) => void>() }
    const destination = { connect: vi.fn<(target: unknown) => void>(), disconnect: vi.fn<() => void>() }
    createPatch(
      'until emitter.ended:\n'
      + '    source:2 -> destination:3\n',
      {} as BaseAudioContext,
      { globals: { destination, emitter, source } },
    )

    expect(source.connect).toHaveBeenCalledWith(destination, 2, 3)
    emitter.dispatchEvent(new Event('ended'))
    expect(source.disconnect).toHaveBeenCalledWith(destination, 2, 3)
  })

  it('keeps top-level if/elif/else nodes together', () => {
    const mark = vi.fn<() => void>()
    const runtime = new PatchRuntime({} as BaseAudioContext, { globals: { mark } })

    runtime.evaluate({
      type: 'Program',
      location: location(),
      body: [
        {
          type: 'IfStatement', location: location(),
          test: { type: 'BooleanLiteral', value: false, location: location() },
          body: [],
        },
        {
          type: 'ElseStatement', location: location(),
          body: [{
            type: 'ExpressionStatement', location: location(),
            expression: {
              type: 'CallExpression', location: location(),
              callee: { type: 'Identifier', name: 'mark', location: location() },
              arguments: [],
            },
          }],
        },
      ],
    })

    expect(mark).toHaveBeenCalledOnce()
  })

  it('passes a scheduled timestamp as the first Web Audio method argument', () => {
    const start = vi.fn<(when: number) => void>()
    const runtime = new PatchRuntime({} as BaseAudioContext, { globals: { osc: { start } } })
    const expression = {
      type: 'CallExpression' as const, location: location(),
      callee: {
        type: 'MemberExpression' as const, location: location(),
        object: { type: 'Identifier' as const, name: 'osc', location: location() },
        property: 'start',
      },
      arguments: [],
    }
    const program: Program = {
      type: 'Program', location: location(),
      body: [{
        type: 'ScheduledStatement', location: location(), automation: null,
        at: { type: 'NumberLiteral', value: '12.5', location: location() },
        statement: { type: 'ExpressionStatement', location: location(), expression },
      }],
    }

    runtime.evaluate(program)
    expect(start).toHaveBeenCalledWith(12.5)
  })

  it('runs nested branches in until suites and disconnects their connections', () => {
    const emitter = new EventTarget()
    const source = { connect: vi.fn<(node: AudioNode) => AudioNode>(), disconnect: vi.fn<(node: AudioNode) => void>() }
    const target = { connect: vi.fn<(node: AudioNode) => AudioNode>(), disconnect: vi.fn<(node: AudioNode) => void>() }
    const runtime = new PatchRuntime({} as BaseAudioContext, {
      globals: { emitter, source, target },
    })

    runtime.evaluate({
      type: 'Program', location: location(), body: [{
        type: 'UntilStatement', location: location(),
        event: {
          type: 'MemberExpression', location: location(),
          object: { type: 'Identifier', name: 'emitter', location: location() },
          property: 'ended',
        },
        body: [{
          type: 'IfStatement', location: location(),
          test: { type: 'BooleanLiteral', value: true, location: location() },
          body: [{
            type: 'ConnectionStatement', location: location(),
            first: { type: 'Identifier', name: 'source', location: location() },
            links: [{
              operator: 'connect',
              target: { type: 'Identifier', name: 'target', location: location() },
            }],
          }],
        }],
      }],
    })

    expect(source.connect).toHaveBeenCalledWith(target)
    emitter.dispatchEvent(new Event('ended'))
    expect(source.disconnect).toHaveBeenCalledWith(target)
  })

  it('blocks constructor-based escapes from the patch sandbox', () => {
    const patch = createPatch(
      "fn escape():\n    ret OscillatorNode.constructor('return globalThis')()\n",
      {} as BaseAudioContext,
    )
    expect(() => (patch.escape as PatchFunction)()).toThrow('forbidden')
  })

  it('interprets decibel values according to their AudioParam context', () => {
    const filter = { Q: { value: 0 }, gain: { value: 0 } }
    const gain = { gain: { value: 0 } }
    const context = {} as BaseAudioContext
    vi.stubGlobal('BiquadFilterNode', vi.fn(function (
      _context: BaseAudioContext,
      options: { Q: number; gain: number },
    ) {
      filter.Q.value = options.Q
      filter.gain.value = options.gain
      return filter
    }))
    vi.stubGlobal('GainNode', vi.fn(function (
      _context: BaseAudioContext,
      options: { gain: number },
    ) {
      gain.gain.value = options.gain
      return gain
    }))
    const patch = createPatch(
      'fn values(Q: Gain = +10dB):\n'
      + "    filter = BiquadFilterNode(Q = Q, gain = Q)\n"
      + '    output = GainNode(gain = -Q)\n',
      context,
    )

    const values = patch.values as PatchFunction
    values()

    expect(filter.Q.value).toBe(10)
    expect(filter.gain.value).toBe(10)
    expect(gain.gain.value).toBeCloseTo(0.316227766)
  })

  it('converts decibels for scheduled gain assignments on global nodes', () => {
    const gain = {
      setValueAtTime: vi.fn<(value: number, time: number) => void>(),
    }
    const node = new (class GainNode { readonly gain = gain })()
    const patch = createPatch(
      'fn setGain():\n'
      + '    @(0) node.gain = -6dB\n',
      {} as BaseAudioContext,
      { globals: { node } },
    )

    const setGain = patch.setGain as PatchFunction
    setGain()

    expect(gain.setValueAtTime).toHaveBeenCalledWith(10 ** (-6 / 20), 0)
  })

  it('keeps decibels literal for scheduled BiquadFilter gain assignments', () => {
    const gain = {
      setValueAtTime: vi.fn<(value: number, time: number) => void>(),
    }
    const node = new (class BiquadFilterNode { readonly gain = gain })()
    const patch = createPatch(
      'fn setGain():\n'
      + '    @(0) node.gain = -6dB\n',
      {} as BaseAudioContext,
      { globals: { node } },
    )

    const setGain = patch.setGain as PatchFunction
    setGain()

    expect(gain.setValueAtTime).toHaveBeenCalledWith(-6, 0)
  })

  it('preserves decibel values through binary arithmetic', () => {
    const gain = { gain: { value: 0 } }
    const context = {} as BaseAudioContext
    vi.stubGlobal('GainNode', vi.fn(function (
      _context: BaseAudioContext,
      options: { gain: number },
    ) {
      gain.gain.value = options.gain
      return gain
    }))
    const patch = createPatch(
      'fn values():\n'
      + '    output = GainNode(gain = -6dB * 2)\n',
      context,
    )

    const values = patch.values as PatchFunction
    values()

    expect(gain.gain.value).toBeCloseTo(10 ** (-12 / 20))
  })

  it('derives units through quantity arithmetic', () => {
    const patch = createPatch(
      'fn period():\n'
      + '    ret 1 / (1Hz)\n'
      + '\n'
      + 'fn scalar():\n'
      + '    ret 2 * 3\n',
      {} as BaseAudioContext,
    )

    const period = (patch.period as PatchFunction)()

    expect(period).toBeInstanceOf(Quantity)
    expect(period).toMatchObject({ value: 1, dimensions: { time: 1 } })
    expect(Number(period)).toBe(1)
    expect((patch.scalar as PatchFunction)()).toMatchObject({
      value: 6,
      dimensions: {},
    })
  })

  it('uses strict equality when only one operand is a quantity', () => {
    const one = Quantity.scalar(1)
    const zero = Quantity.scalar(0)

    expect(Quantity.binary('==', one, true)).toBe(false)
    expect(Quantity.binary('==', zero, null)).toBe(false)
    expect(Quantity.binary('==', one, '1')).toBe(false)
    expect(Quantity.binary('!=', one, true)).toBe(true)
    expect(Quantity.binary('==', one, 1)).toBe(true)
    expect(Quantity.binary('==', 1, one)).toBe(true)
  })

  it('rejects comparisons between quantities with incompatible dimensions', () => {
    const second = Quantity.unit(1, 's')
    const hertz = Quantity.unit(1, 'Hz')

    for (const operator of ['<', '>', '<=', '>=', '==', '!=']) {
      expect(() => Quantity.binary(operator, second, hertz))
        .toThrow('Cannot compare quantities with incompatible units')
    }
  })
})
