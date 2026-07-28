import { describe, expect, it, vi } from 'vitest'
import { PatchRuntime, Quantity, createPatch, type PatchFunction } from '../runtime.js'
import type { Program } from '../parser.generated.js'

function location() {
  const point = { offset: 0, line: 1, column: 1 }
  return { source: undefined, start: point, end: point }
}

describe('SW Patch runtime', () => {
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
    const context = {
      createBiquadFilter: () => filter,
      createGain: () => gain,
    } as unknown as BaseAudioContext
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
    const context = { createGain: () => gain } as unknown as BaseAudioContext
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
      + '    ret 1 / (1Hz)\n',
      {} as BaseAudioContext,
    )

    const period = (patch.period as PatchFunction)()

    expect(period).toBeInstanceOf(Quantity)
    expect(period).toMatchObject({ value: 1, dimensions: { time: 1 } })
    expect(Number(period)).toBe(1)
  })
})
