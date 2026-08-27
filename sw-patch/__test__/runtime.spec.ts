import { describe, expect, it, vi } from 'vitest'
import {
  PatchRuntime,
  Quantity,
  atodb,
  createPatch,
  dbtoa,
  registerMathWorklets,
  type PatchFunction,
} from '../runtime.js'
import type { Program } from '../parser.generated.js'

function location() {
  const point = { offset: 0, line: 1, column: 1 }
  return { source: undefined, start: point, end: point }
}

describe('SW Patch runtime', () => {
  it('evaluates augmented assignments and not expressions with Python-style precedence', () => {
    const patch = createPatch(
      'fn calculate():\n' +
        '    value = 5\n' +
        '    value += 3\n' +
        '    value *= 2\n' +
        '    value -= 4\n' +
        '    value /= 3\n' +
        '    value **= 2\n' +
        '    value %= 5\n' +
        '    ret value\n' +
        'fn divisible(value: Number):\n' +
        '    ret not value%3\n',
      {} as BaseAudioContext,
    )

    expect(Number((patch.calculate as PatchFunction)())).toBe(1)
    expect((patch.divisible as PatchFunction)(6)).toBe(true)
    expect((patch.divisible as PatchFunction)(7)).toBe(false)
  })

  it('evaluates an augmented member receiver only once', () => {
    const first = { value: 1 }
    const second = { value: 10 }
    const getTarget = vi.fn<() => typeof first>().mockReturnValueOnce(first).mockReturnValue(second)
    const patch = createPatch(
      'fn increment():\n    getTarget().value += 1\n',
      {} as BaseAudioContext,
      { globals: { getTarget } },
    )

    ;(patch.increment as PatchFunction)()

    expect(getTarget).toHaveBeenCalledOnce()
    expect(Number(first.value)).toBe(2)
    expect(second.value).toBe(10)
  })

  it('reads AudioParam.value for scheduled augmented assignments', () => {
    const parameter = {
      value: 2,
      setValueAtTime: vi.fn<(value: number, time: number) => void>(),
    }
    const patch = createPatch(
      'fn increase(start: Instant):\n    @start parameter += 0.5\n',
      {} as BaseAudioContext,
      { globals: { parameter } },
    )

    ;(patch.increase as PatchFunction)(3)

    expect(parameter.setValueAtTime).toHaveBeenCalledWith(2.5, 3)
  })

  it('executes for and while loops and propagates returns from their suites', () => {
    const patch = createPatch(
      'fn total(values: List<Number>):\n' +
        '    result = 0\n' +
        '    for value in values:\n' +
        '        result = result + value\n' +
        '    remaining = 3\n' +
        '    while remaining > 0:\n' +
        '        result = result + 10\n' +
        '        remaining = remaining - 1\n' +
        '    ret result\n' +
        'fn first(values: List<Number>):\n' +
        '    for value in values:\n' +
        '        ret value\n' +
        '    ret null\n',
      {} as BaseAudioContext,
    )

    expect(Number((patch.total as PatchFunction)([1, 2, 3]))).toBe(36)
    expect(Number((patch.first as PatchFunction)([7, 8]))).toBe(7)
    expect((patch.first as PatchFunction)([])).toBeNull()
  })

  it('rejects non-iterable for loop values', () => {
    const patch = createPatch(
      'fn invalid():\n    for value in 3:\n        print(value)\n',
      {} as BaseAudioContext,
    )

    expect(() => (patch.invalid as PatchFunction)()).toThrow('requires an iterable')
  })

  it('provides range and supports break, continue, and pass', () => {
    const patch = createPatch(
      'fn loops():\n' +
        '    total = 0\n' +
        '    for value in range(1, 10):\n' +
        '        if value == 3:\n' +
        '            continue\n' +
        '        if value == 7:\n' +
        '            break\n' +
        '        total = total + value\n' +
        '    while true:\n' +
        '        pass\n' +
        '        break\n' +
        '    for value in range(5, 0, -2):\n' +
        '        total = total + value\n' +
        '    ret total\n',
      {} as BaseAudioContext,
    )

    expect(Number((patch.loops as PatchFunction)())).toBe(27)
  })

  it('validates range arguments and loop-control placement', () => {
    const context = {} as BaseAudioContext
    expect(() => createPatch('for value in range(0, 3, 0):\n    pass\n', context)).toThrow(
      'step must not be zero',
    )
    expect(() => createPatch('break\n', context)).toThrow('outside a loop')
    expect(() => createPatch('continue\n', context)).toThrow('outside a loop')
  })

  it('provides classic amplitude and decibel conversion utilities', () => {
    expect(dbtoa(20)).toBe(10)
    expect(atodb(10)).toBe(20)
    expect(atodb(dbtoa(-6))).toBeCloseTo(-6)
  })

  it('provides Math constants and random scalar values', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25)
    const patch = createPatch(
      'fn constants():\n' +
        '    ret E + LN10 + LN2 + LOG10E + LOG2E + PI + SQRT1_2 + SQRT2\n' +
        'fn randomValue():\n' +
        '    ret random()\n',
      {} as BaseAudioContext,
    )

    expect(Number((patch.constants as PatchFunction)())).toBeCloseTo(
      Math.E +
        Math.LN10 +
        Math.LN2 +
        Math.LOG10E +
        Math.LOG2E +
        Math.PI +
        Math.SQRT1_2 +
        Math.SQRT2,
    )
    expect((patch.randomValue as PatchFunction)()).toEqual(Quantity.scalar(0.25))
    expect(random).toHaveBeenCalledOnce()
    random.mockRestore()
  })

  it('registers inline math worklets once per audio context', async () => {
    const addModule = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined)
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:math-worklets')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const context = { audioWorklet: { addModule } } as unknown as BaseAudioContext

    await Promise.all([registerMathWorklets(context), registerMathWorklets(context)])

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(addModule).toHaveBeenCalledOnce()
    expect(addModule).toHaveBeenCalledWith('blob:math-worklets')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:math-worklets')
  })

  it('provides native-style utility signal sources', () => {
    const worklets: MockAudioWorkletNode[] = []
    class MockAudioWorkletNode extends EventTarget {
      port = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        postMessage: vi.fn<(message: unknown) => void>(),
      }
      parameters = new Map<string, { value: number }>([
        ['frequency', { value: 440 }],
        ['detune', { value: 0 }],
      ])
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
      constructor(
        _context: BaseAudioContext,
        readonly name: string,
        readonly options: { numberOfInputs: number },
      ) {
        super()
        worklets.push(this)
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)
    const context = { currentTime: 4 } as BaseAudioContext
    const patch = createPatch(
      'fn sources(start: time):\n' +
        '    t = TimeNode()\n' +
        '    phase = PhaserNode(frequency = 2Hz, detune = 100c)\n' +
        '    noise = RandomNode()\n' +
        '    t.start(start)\n' +
        '    phase.start(start)\n' +
        '    noise.start()\n' +
        '    ret phase\n',
      context,
    )

    const phase = (patch.sources as PatchFunction)(Quantity.unit(6, 's')) as MockAudioWorkletNode
    expect(worklets.map(({ name }) => name).slice(-3)).toEqual([
      'sw-patch-time',
      'sw-patch-phaser',
      'sw-patch-random',
    ])
    expect(phase.options).toEqual({ numberOfInputs: 0 })
    expect(phase.parameters.get('frequency')?.value).toBe(2)
    expect(phase.parameters.get('detune')?.value).toBe(100)
    expect(worklets.at(-3)?.port.postMessage).toHaveBeenCalledWith({ type: 'start', when: 6 })
    expect(worklets.at(-1)?.port.postMessage).toHaveBeenCalledWith({ type: 'start', when: 4 })

    const ended = vi.fn<() => void>()
    worklets.at(-3)?.addEventListener('ended', ended)
    worklets.at(-3)?.port.onmessage?.({ data: 'ended' } as MessageEvent)
    expect(ended).toHaveBeenCalledOnce()
    expect(worklets.at(-3)?.port.onmessage).toBeNull()
    const completedSourceMessages = worklets.at(-3)?.port.postMessage.mock.calls.length

    patch.dispose()
    expect(worklets.at(-3)?.port.postMessage).toHaveBeenCalledTimes(completedSourceMessages!)
  })

  it('provides every native soft oscillator with an automatable bite', () => {
    const worklets: MockAudioWorkletNode[] = []
    class MockAudioWorkletNode extends EventTarget {
      port = { onmessage: null, postMessage: vi.fn<(message: unknown) => void>() }
      parameters = new Map<string, { value: number }>([
        ['frequency', { value: 440 }],
        ['detune', { value: 0 }],
        ['bite', { value: 0.5 }],
      ])
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
      constructor(
        _context: BaseAudioContext,
        readonly name: string,
      ) {
        super()
        worklets.push(this)
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)
    const patch = createPatch(
      'fn sources():\n' +
        '    triangle = SoftTriangleNode(bite = 10%)\n' +
        '    sawtooth = SoftSawtoothNode(bite = 20%)\n' +
        '    square = SoftSquareNode(bite = 30%)\n' +
        '    parabolic = SoftParabolicNode(bite = 40%)\n',
      { currentTime: 0 } as BaseAudioContext,
    )

    ;(patch.sources as PatchFunction)()

    expect(worklets.map(({ name }) => name)).toEqual([
      'sw-patch-soft-triangle',
      'sw-patch-soft-sawtooth',
      'sw-patch-soft-square',
      'sw-patch-soft-parabolic',
    ])
    expect(worklets.map((node) => node.parameters.get('bite')?.value)).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(worklets.every((node) => 'bite' in node)).toBe(true)
  })

  it('uses worklets for signal comparisons, Python modulo, and where()', () => {
    const worklets: MockAudioWorkletNode[] = []
    class MockAudioWorkletNode {
      port = { postMessage: vi.fn<(message: unknown) => void>() }
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
      constructor(
        _context: BaseAudioContext,
        readonly name: string,
        readonly options: { numberOfInputs: number },
      ) {
        worklets.push(this)
      }
    }
    class MockConstantSourceNode {
      connect = vi.fn<(target: unknown, output?: number, input?: number) => void>()
      disconnect = vi.fn<(target?: unknown, output?: number, input?: number) => void>()
      start = vi.fn<() => void>()
      stop = vi.fn<() => void>()
      constructor(
        _context: BaseAudioContext,
        readonly options: { offset: number },
      ) {}
    }
    vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)
    vi.stubGlobal('ConstantSourceNode', MockConstantSourceNode)
    const signal = {
      connect: vi.fn<(target: unknown, output?: number, input?: number) => void>(),
      disconnect: vi.fn<(target?: unknown, output?: number, input?: number) => void>(),
    }
    const patch = createPatch(
      'fn choose():\n    ret where(signal < 0, signal % 3, -1)\n' +
        'fn modulo():\n    ret -5 % 3\n',
      {} as BaseAudioContext,
      { globals: { signal } },
    )

    ;(patch.choose as PatchFunction)()
    expect(worklets.map(({ name }) => name).slice(-3)).toEqual([
      'sw-patch-less-than',
      'sw-patch-modulo',
      'sw-patch-where',
    ])
    expect(worklets.at(-1)?.options).toEqual({ numberOfInputs: 3 })
    expect(Number((patch.modulo as PatchFunction)())).toBe(1)
  })

  it('supports right-associative scalar and audio-signal exponentiation', () => {
    const worklets: MockAudioWorkletNode[] = []
    class MockAudioWorkletNode {
      port = { postMessage: vi.fn<(message: unknown) => void>() }
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
      constructor(
        _context: BaseAudioContext,
        readonly name: string,
        readonly options: { numberOfInputs: number },
      ) {
        worklets.push(this)
      }
    }
    class MockConstantSourceNode {
      connect = vi.fn<(target: unknown, output?: number, input?: number) => void>()
      disconnect = vi.fn<(target?: unknown, output?: number, input?: number) => void>()
      start = vi.fn<() => void>()
      stop = vi.fn<() => void>()
      constructor(
        _context: BaseAudioContext,
        readonly options: { offset: number },
      ) {}
    }
    vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)
    vi.stubGlobal('ConstantSourceNode', MockConstantSourceNode)
    const signal = {
      connect: vi.fn<(target: unknown, output?: number, input?: number) => void>(),
      disconnect: vi.fn<(target?: unknown, output?: number, input?: number) => void>(),
    }
    const patch = createPatch(
      'fn signalPower():\n    ret signal ** 2\n' +
        'fn scalarPower():\n    ret 2 ** 3 ** 2\n' +
        'fn unaryPrecedence():\n    ret -2 ** 2\n',
      {} as BaseAudioContext,
      { globals: { signal } },
    )

    ;(patch.signalPower as PatchFunction)()
    expect(worklets.at(-1)?.name).toBe('sw-patch-pow')
    expect(worklets.at(-1)?.options).toEqual({ numberOfInputs: 2 })
    expect(Number((patch.scalarPower as PatchFunction)())).toBe(512)
    expect(Number((patch.unaryPrecedence as PatchFunction)())).toBe(-4)
  })

  it('uses worklets for signal division and explicit decibel conversions', async () => {
    const context = {
      audioWorklet: { addModule: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    } as unknown as BaseAudioContext
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:math-worklets-2')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const worklets: MockAudioWorkletNode[] = []
    class MockAudioWorkletNode {
      port = { postMessage: vi.fn<(message: string) => void>() }
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
      constructor(
        _context: BaseAudioContext,
        readonly name: string,
      ) {
        worklets.push(this)
      }
    }
    class MockConstantSourceNode {
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
      start = vi.fn<() => void>()
      stop = vi.fn<() => void>()
      constructor(
        _context: BaseAudioContext,
        readonly options: { offset: number },
      ) {}
    }
    class MockGainNode {
      gain = {}
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
    }
    vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)
    vi.stubGlobal('ConstantSourceNode', MockConstantSourceNode)
    vi.stubGlobal('GainNode', MockGainNode)
    await registerMathWorklets(context)
    const numerator = {
      connect: vi.fn<(target: unknown) => void>(),
      disconnect: vi.fn<(target?: unknown) => void>(),
    }
    const denominator = {
      connect: vi.fn<(target: unknown) => void>(),
      disconnect: vi.fn<(target?: unknown) => void>(),
    }
    const patch = createPatch(
      'fn divide():\n    ret numerator / denominator\n' +
        'fn conversions():\n    decibels = AudioSignal(+10dB)\n' +
        '    level = dbtoa(decibels)\n' +
        '    ret atodb(level)\n',
      context,
      { globals: { denominator, numerator } },
    )

    ;(patch.divide as PatchFunction)()
    const inverter = worklets.find(({ name }) => name === 'sw-patch-invert')
    expect(denominator.connect).toHaveBeenCalledWith(inverter)
    ;(patch.conversions as PatchFunction)()
    expect(worklets.some(({ name }) => name === 'sw-patch-dbtoa')).toBe(true)
    expect(worklets.some(({ name }) => name === 'sw-patch-atodb')).toBe(true)
    patch.dispose()
    for (const worklet of worklets) expect(worklet.port.postMessage).toHaveBeenCalledWith('stop')
  })

  it('supports unary Math functions for scalars and explicit signal transforms', () => {
    const worklets: MockAudioWorkletNode[] = []
    class MockAudioWorkletNode {
      port = { postMessage: vi.fn<(message: string) => void>() }
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
      constructor(
        _context: BaseAudioContext,
        readonly name: string,
      ) {
        worklets.push(this)
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)
    const oscillator = {
      connect: vi.fn<(target: unknown) => void>(),
      disconnect: vi.fn<(target?: unknown) => void>(),
    }
    const destination = {}

    const patch = createPatch(
      'tanh(oscillator) -> destination\n' + 'fn scalar():\n    ret sqrt(9) + cos(0)\n',
      {} as BaseAudioContext,
      { globals: { destination, oscillator } },
    )

    expect(worklets[0]?.name).toBe('sw-patch-tanh')
    expect(oscillator.connect).toHaveBeenCalledWith(worklets[0])
    expect(worklets[0]?.connect).toHaveBeenCalledWith(destination)
    expect(Number((patch.scalar as PatchFunction)())).toBe(4)

    patch.dispose()
    expect(oscillator.disconnect).toHaveBeenCalledWith(worklets[0])
    expect(worklets[0]?.disconnect).toHaveBeenCalledWith(destination)
    expect(worklets[0]?.port.postMessage).toHaveBeenCalledWith('stop')
  })

  it('supports multi-argument Math functions for scalars and audio signals', () => {
    const worklets: MockAudioWorkletNode[] = []
    class MockAudioWorkletNode {
      port = { postMessage: vi.fn<(message: string) => void>() }
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown, output?: number, input?: number) => void>()
      constructor(
        _context: BaseAudioContext,
        readonly name: string,
        readonly options: { numberOfInputs: number },
      ) {
        worklets.push(this)
      }
    }
    vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)
    const signalA = {
      connect: vi.fn<(target: unknown, output?: number, input?: number) => void>(),
      disconnect: vi.fn<(target?: unknown, output?: number, input?: number) => void>(),
    }
    const signalB = {
      connect: vi.fn<(target: unknown, output?: number, input?: number) => void>(),
      disconnect: vi.fn<(target?: unknown, output?: number, input?: number) => void>(),
    }
    const patch = createPatch(
      'fn positional():\n    ret atan2(signalA, signalB)\n' +
        'fn named():\n    ret atan2(x = signalA, y = signalB)\n' +
        'fn atanSignature():\n' +
        '    ret atan2(0, 1) + atan2(x = 1, y = 0)\n' +
        'fn scalar():\n    ret pow(2, 3) + max(1, 7, 4) + clz32(1)\n',
      {} as BaseAudioContext,
      { globals: { signalA, signalB } },
    )

    ;(patch.positional as PatchFunction)()
    ;(patch.named as PatchFunction)()
    expect(worklets.map(({ name }) => name).slice(0, 2)).toEqual([
      'sw-patch-atan2',
      'sw-patch-atan2',
    ])
    expect(worklets[0]?.options).toEqual({ numberOfInputs: 2 })
    expect(signalA.connect).toHaveBeenCalledWith(worklets[0], 0, 0)
    expect(signalB.connect).toHaveBeenCalledWith(worklets[0], 0, 1)
    expect(signalB.connect).toHaveBeenCalledWith(worklets[1], 0, 0)
    expect(signalA.connect).toHaveBeenCalledWith(worklets[1], 0, 1)
    expect(Number((patch.atanSignature as PatchFunction)())).toBe(0)
    expect(Number((patch.scalar as PatchFunction)())).toBe(46)
  })

  it('builds Web Audio graphs for signal arithmetic', () => {
    const created: MockGainNode[] = []
    class MockGainNode {
      gain = {}
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()

      constructor(
        _context: BaseAudioContext,
        readonly options: { gain?: number } = {},
      ) {
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
      'fn negative():\n    ret -signalA\n' +
        'fn positive():\n    ret +signalA\n' +
        'fn sum():\n    ret signalA + signalB\n' +
        'fn difference():\n    ret signalA - signalB\n' +
        'fn product():\n    ret signalA * signalB\n',
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
      constructor(
        _context: BaseAudioContext,
        readonly options: { gain?: number } = {},
      ) {
        gains.push(this)
      }
    }
    class MockConstantSourceNode {
      connect = vi.fn<(target: unknown) => void>()
      disconnect = vi.fn<(target?: unknown) => void>()
      start = vi.fn<() => void>()
      stop = vi.fn<() => void>()
      constructor(
        _context: BaseAudioContext,
        readonly options: { offset: number },
      ) {
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
      'fn scaledLeft():\n    ret 2 * signal\n' +
        'fn scaledRight():\n    ret signal * 3\n' +
        'fn divided():\n    ret signal / 4\n' +
        'fn offset():\n    ret signal + 5\n' +
        'fn reverseDifference():\n    ret 6 - signal\n' +
        'until emitter:ended:\n' +
        '    sum = signal + 7\n' +
        '    sum -> destination\n',
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
    const inputDisconnect = vi.fn<(target?: unknown) => void>()
    const outputConnect = vi.fn<(target: unknown) => void>()
    const outputDisconnect = vi.fn<(target?: unknown) => void>()
    const input = { connect: inputConnect, disconnect: inputDisconnect }
    const output = { connect: outputConnect, disconnect: outputDisconnect }
    const nodes = [input, output]
    const GainNode = vi.fn<() => typeof input | undefined>(function () {
      return nodes.shift()
    })
    vi.stubGlobal('GainNode', GainNode)
    const context = {} as BaseAudioContext

    const effect = createPatch(
      'input = GainNode()\n' + 'output = GainNode()\n' + 'input -> output\n',
      context,
    ) as unknown as AudioNode
    const destination = {} as AudioNode

    expect(effect).toBe(input)
    expect(inputConnect).toHaveBeenCalledWith(output)
    effect.connect(destination)
    effect.disconnect(destination)
    expect(outputConnect).toHaveBeenCalledWith(destination)
    expect(outputDisconnect).toHaveBeenCalledWith(destination)

    ;(effect as unknown as { dispose(): void }).dispose()
    expect(inputDisconnect).toHaveBeenCalledWith(output)
    expect(outputDisconnect).not.toHaveBeenCalledWith(output)
  })

  it('passes normalized options to Web Audio constructors', () => {
    const DelayNode = vi.fn<() => void>(function () {})
    const ChannelMergerNode = vi.fn<() => void>(function () {})
    vi.stubGlobal('DelayNode', DelayNode)
    vi.stubGlobal('ChannelMergerNode', ChannelMergerNode)
    const context = {} as BaseAudioContext

    createPatch(
      'delay = DelayNode(maxDelayTime = 2s, delayTime = 250ms)\n' +
        'merger = ChannelMergerNode(numberOfInputs = 2)\n',
      context,
    )

    expect(DelayNode).toHaveBeenCalledWith(context, { maxDelayTime: 2, delayTime: 0.25 })
    expect(ChannelMergerNode).toHaveBeenCalledWith(context, { numberOfInputs: 2 })
  })

  it('turns array literals into periodic waves and wave-shaper curves', () => {
    const periodicWave = {}
    const createPeriodicWave = vi.fn<(real: Float32Array, imaginary: Float32Array) => object>(
      () => periodicWave,
    )
    const OscillatorNode = vi.fn<() => void>(function () {})
    const WaveShaperNode = vi.fn<() => void>(function () {})
    vi.stubGlobal('OscillatorNode', OscillatorNode)
    vi.stubGlobal('WaveShaperNode', WaveShaperNode)
    const context = { createPeriodicWave } as unknown as BaseAudioContext

    createPatch(
      'osc = OscillatorNode(periodicWave = [[0, 0, 0], [0, 1, 0.5]])\n' +
        "shaper = WaveShaperNode(curve = [-1, -50%, 0, 50%, 1], oversample = '4x')\n",
      context,
    )

    expect(createPeriodicWave).toHaveBeenCalledOnce()
    expect(createPeriodicWave.mock.calls[0]?.[0]).toEqual(new Float32Array([0, 0, 0]))
    expect(createPeriodicWave.mock.calls[0]?.[1]).toEqual(new Float32Array([0, 1, 0.5]))
    expect(OscillatorNode).toHaveBeenCalledWith(context, { periodicWave })
    expect(WaveShaperNode).toHaveBeenCalledWith(context, {
      curve: new Float32Array([-1, -0.5, 0, 0.5, 1]),
      oversample: '4x',
    })
  })

  it('rejects malformed periodic-wave arrays', () => {
    const OscillatorNode = vi.fn<() => void>(function () {})
    vi.stubGlobal('OscillatorNode', OscillatorNode)

    expect(() =>
      createPatch('osc = OscillatorNode(periodicWave = [0, 1])\n', {
        createPeriodicWave: vi.fn<() => void>(),
      } as unknown as BaseAudioContext),
    ).toThrow('periodicWave expects [real, imaginary] arrays')
  })

  it('constructs PeriodicWave values with an implicit context and options', () => {
    const periodicWave = {}
    const createPeriodicWave = vi.fn<
      (real: Float32Array, imaginary: Float32Array, options?: PeriodicWaveConstraints) => object
    >(() => periodicWave)
    const OscillatorNode = vi.fn<() => void>(function () {})
    vi.stubGlobal('OscillatorNode', OscillatorNode)
    const context = { createPeriodicWave } as unknown as BaseAudioContext

    createPatch(
      'wave = PeriodicWave([0, 0], [0, 1], {disableNormalization: true})\n' +
        'osc = OscillatorNode(periodicWave = wave)\n',
      context,
    )

    expect(createPeriodicWave).toHaveBeenCalledWith(
      new Float32Array([0, 0]),
      new Float32Array([0, 1]),
      { disableNormalization: true },
    )
    expect(OscillatorNode).toHaveBeenCalledWith(context, { periodicWave })
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
    const source = {
      connect: vi.fn<(target: unknown, output?: number, input?: number) => void>(),
      disconnect: vi.fn<(target?: unknown, output?: number, input?: number) => void>(),
    }
    const destination = {
      connect: vi.fn<(target: unknown) => void>(),
      disconnect: vi.fn<() => void>(),
    }
    createPatch(
      'until emitter:ended:\n' + '    source:2 -> destination:3\n',
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
          type: 'IfStatement',
          location: location(),
          test: { type: 'BooleanLiteral', value: false, location: location() },
          body: [],
        },
        {
          type: 'ElseStatement',
          location: location(),
          body: [
            {
              type: 'ExpressionStatement',
              location: location(),
              expression: {
                type: 'CallExpression',
                location: location(),
                callee: { type: 'Identifier', name: 'mark', location: location() },
                arguments: [],
              },
            },
          ],
        },
      ],
    })

    expect(mark).toHaveBeenCalledOnce()
  })

  it('passes a scheduled timestamp as the first Web Audio method argument', () => {
    const start = vi.fn<(when: number) => void>()
    const runtime = new PatchRuntime({} as BaseAudioContext, { globals: { osc: { start } } })
    const expression = {
      type: 'CallExpression' as const,
      location: location(),
      callee: {
        type: 'MemberExpression' as const,
        location: location(),
        object: { type: 'Identifier' as const, name: 'osc', location: location() },
        property: 'start',
      },
      arguments: [],
    }
    const program: Program = {
      type: 'Program',
      location: location(),
      body: [
        {
          type: 'ScheduledStatement',
          location: location(),
          automation: null,
          at: { type: 'NumberLiteral', value: '12.5', location: location() },
          statement: { type: 'ExpressionStatement', location: location(), expression },
        },
      ],
    }

    runtime.evaluate(program)
    expect(start).toHaveBeenCalledWith(12.5)
  })

  it('runs nested branches in until suites and disconnects their connections', () => {
    const emitter = new EventTarget()
    const source = {
      connect: vi.fn<(node: AudioNode) => AudioNode>(),
      disconnect: vi.fn<(node: AudioNode) => void>(),
    }
    const target = {
      connect: vi.fn<(node: AudioNode) => AudioNode>(),
      disconnect: vi.fn<(node: AudioNode) => void>(),
    }
    const runtime = new PatchRuntime({} as BaseAudioContext, {
      globals: { emitter, source, target },
    })

    runtime.evaluate({
      type: 'Program',
      location: location(),
      body: [
        {
          type: 'UntilStatement',
          location: location(),
          emitter: { type: 'Identifier', name: 'emitter', location: location() },
          event: 'ended',
          body: [
            {
              type: 'IfStatement',
              location: location(),
              test: { type: 'BooleanLiteral', value: true, location: location() },
              body: [
                {
                  type: 'ConnectionStatement',
                  location: location(),
                  first: { type: 'Identifier', name: 'source', location: location() },
                  links: [
                    {
                      operator: 'connect',
                      target: { type: 'Identifier', name: 'target', location: location() },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
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

  it('does not implicitly convert decibel values based on AudioParam context', () => {
    const filter = { Q: { value: 0 }, gain: { value: 0 } }
    const gain = { gain: { value: 0 } }
    const context = {} as BaseAudioContext
    vi.stubGlobal(
      'BiquadFilterNode',
      vi.fn(function (_context: BaseAudioContext, options: { Q: number; gain: number }) {
        filter.Q.value = options.Q
        filter.gain.value = options.gain
        return filter
      }),
    )
    vi.stubGlobal(
      'GainNode',
      vi.fn(function (_context: BaseAudioContext, options: { gain: number }) {
        gain.gain.value = options.gain
        return gain
      }),
    )
    const patch = createPatch(
      'fn values(Q: Gain = +10dB):\n' +
        '    filter = BiquadFilterNode(Q = Q, gain = Q)\n' +
        '    output = GainNode(gain = -Q)\n',
      context,
    )

    const values = patch.values as PatchFunction
    values()

    expect(filter.Q.value).toBe(10)
    expect(filter.gain.value).toBe(10)
    expect(gain.gain.value).toBe(-10)
  })

  it('exposes the remaining standard Web Audio node constructors', () => {
    const kinds = [
      'Analyser',
      'AudioBufferSource',
      'Convolver',
      'DynamicsCompressor',
      'IIRFilter',
      'Panner',
      'StereoPanner',
    ]
    for (const kind of kinds) {
      vi.stubGlobal(
        `${kind}Node`,
        vi.fn(function (_context: BaseAudioContext, options: Record<string, unknown>) {
          return { kind, options }
        }),
      )
    }
    const patch = createPatch(
      'fn nodes():\n' +
        '    ret [AnalyserNode(), AudioBufferSourceNode(loop = true), ConvolverNode(), DynamicsCompressorNode(), IIRFilterNode(feedforward = [1], feedback = [1]), PannerNode(), StereoPannerNode(pan = 0.25)]\n',
      {} as BaseAudioContext,
    )

    const nodes = (patch.nodes as PatchFunction)() as Array<{
      kind: string
      options: Record<string, unknown>
    }>
    expect(nodes.map(({ kind }) => kind)).toEqual(kinds)
    expect(nodes[1]?.options.loop).toBe(true)
    expect(nodes.at(-1)?.options.pan).toBe(0.25)
  })

  it('falls back to AudioContext factory methods when node constructors are unavailable', () => {
    vi.stubGlobal('GainNode', undefined)
    vi.stubGlobal('OscillatorNode', undefined)
    vi.stubGlobal('AudioBufferSourceNode', undefined)
    vi.stubGlobal('ConvolverNode', undefined)
    const gain = { gain: { value: 1 } }
    const oscillator = {
      frequency: { value: 440 },
      setPeriodicWave: vi.fn<(wave: PeriodicWave) => void>(),
    }
    const bufferSource = { loop: false }
    const convolver = { normalize: true }
    const wave = {} as PeriodicWave
    const context = {
      createGain: vi.fn<() => typeof gain>(() => gain),
      createOscillator: vi.fn<() => typeof oscillator>(() => oscillator),
      createBufferSource: vi.fn<() => typeof bufferSource>(() => bufferSource),
      createConvolver: vi.fn<() => typeof convolver>(() => convolver),
      createPeriodicWave: vi.fn<() => PeriodicWave>(() => wave),
    } as unknown as BaseAudioContext
    const patch = createPatch(
      'fn nodes():\n' +
        '    gain = GainNode(gain = 0.5)\n' +
        '    osc = OscillatorNode(frequency = 220Hz, periodicWave = [[0, 0], [0, 1]])\n' +
        '    source = AudioBufferSourceNode(loop = true)\n' +
        '    convolver = ConvolverNode(disableNormalization = true)\n' +
        '    ret [gain, osc]\n',
      context,
    )

    ;(patch.nodes as PatchFunction)()

    expect(context.createGain).toHaveBeenCalledOnce()
    expect(gain.gain.value).toBe(0.5)
    expect(context.createOscillator).toHaveBeenCalledOnce()
    expect(oscillator.frequency.value).toBe(220)
    expect(oscillator.setPeriodicWave).toHaveBeenCalledWith(wave)
    expect(context.createBufferSource).toHaveBeenCalledOnce()
    expect(bufferSource.loop).toBe(true)
    expect(context.createConvolver).toHaveBeenCalledOnce()
    expect(convolver.normalize).toBe(false)
  })

  it('keeps decibels literal for scheduled gain assignments', () => {
    const gain = {
      setValueAtTime: vi.fn<(value: number, time: number) => void>(),
    }
    const node = new (class GainNode {
      readonly gain = gain
    })()
    const patch = createPatch(
      'fn setGain():\n' + '    @(0) node.gain = -6dB\n',
      {} as BaseAudioContext,
      { globals: { node } },
    )

    const setGain = patch.setGain as PatchFunction
    setGain()

    expect(gain.setValueAtTime).toHaveBeenCalledWith(-6, 0)
  })

  it('keeps decibels literal for scheduled BiquadFilter gain assignments', () => {
    const gain = {
      setValueAtTime: vi.fn<(value: number, time: number) => void>(),
    }
    const node = new (class BiquadFilterNode {
      readonly gain = gain
    })()
    const patch = createPatch(
      'fn setGain():\n' + '    @(0) node.gain = -6dB\n',
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
    vi.stubGlobal(
      'GainNode',
      vi.fn(function (_context: BaseAudioContext, options: { gain: number }) {
        gain.gain.value = options.gain
        return gain
      }),
    )
    const patch = createPatch(
      'fn values():\n' + '    output = GainNode(gain = -6dB * 2)\n',
      context,
    )

    const values = patch.values as PatchFunction
    values()

    expect(gain.gain.value).toBe(-12)
  })

  it('derives units through quantity arithmetic', () => {
    const patch = createPatch(
      'fn period():\n' + '    ret 1 / (1Hz)\n' + '\n' + 'fn scalar():\n' + '    ret 2 * 3\n',
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

  it('stores semitone quantities as cents', () => {
    const semitone = Quantity.unit(1.5, 'semitones')

    expect(semitone).toMatchObject({ value: 150, dimensions: { cent: 1 } })
    expect(Quantity.binary('==', semitone, Quantity.unit(150, 'c'))).toBe(true)
    expect(Quantity.unit(1, 'st').value).toBe(100)
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
      expect(() => Quantity.binary(operator, second, hertz)).toThrow(
        'Cannot compare quantities with incompatible units',
      )
    }
  })
})
