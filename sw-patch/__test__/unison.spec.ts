import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPatch, type PlayableSynthPatch } from '../runtime'
import SOURCE from '../../src/patches/unison.swpatch?raw'

class Parameter {
  value = 0
  setValueAtTime = vi.fn<AudioParam['setValueAtTime']>()
  linearRampToValueAtTime = vi.fn<AudioParam['linearRampToValueAtTime']>()
  setTargetAtTime = vi.fn<AudioParam['setTargetAtTime']>()
  cancelAndHoldAtTime = vi.fn<AudioParam['cancelAndHoldAtTime']>()
}
class Node extends EventTarget {
  connect = vi.fn<(target: unknown) => unknown>((target) => target)
  disconnect = vi.fn<() => void>()
  start = vi.fn<() => void>()
  stop = vi.fn<(...args: unknown[]) => void>()
}
class Gain extends Node {
  static instances: Gain[] = []
  gain = new Parameter()
  constructor(_context: unknown, options: GainOptions = {}) {
    super()
    this.gain.value = options.gain ?? 1
    Gain.instances.push(this)
  }
}
class Constant extends Node {
  static instances: Constant[] = []
  offset = new Parameter()
  constructor(_context: unknown, options: ConstantSourceOptions = {}) {
    super()
    this.offset.value = options.offset ?? 1
    Constant.instances.push(this)
  }
}
class Oscillator extends Node {
  static instances: Oscillator[] = []
  frequency = new Parameter()
  detune = new Parameter()
  type = 'sine'
  setPeriodicWave = vi.fn<OscillatorNode['setPeriodicWave']>()
  constructor() {
    super()
    Oscillator.instances.push(this)
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Bundled unison patch', () => {
  it.each(['triangle', 'rich'])(
    'plays %s voices with audio-rate spread and ADSR cleanup',
    (waveform) => {
      Oscillator.instances = []
      Constant.instances = []
      Gain.instances = []
      vi.stubGlobal('GainNode', Gain)
      vi.stubGlobal('ConstantSourceNode', Constant)
      vi.stubGlobal('OscillatorNode', Oscillator)
      const wave = {}
      const context = {
        currentTime: 0,
        createGain: () => {
          const gain = new Gain(context)
          return gain
        },
        createPeriodicWave: vi.fn<() => typeof wave>(() => wave),
      } as unknown as BaseAudioContext
      const spread = new Constant(context, { offset: 30 })
      const pitch = new Constant(context)
      const destination = new Node()
      const patch = createPatch(SOURCE, context, {
        config: { oscillatorType: waveform, numberOfVoices: 3, spread },
      }) as PlayableSynthPatch
      const off = patch.on(
        destination as unknown as AudioNode,
        1,
        pitch as unknown as AudioNode,
        0.8,
        0.1,
        0.2,
        0.6,
        0.3,
      )
      expect(Oscillator.instances).toHaveLength(3)
      for (const oscillator of Oscillator.instances) {
        expect(oscillator.start).toHaveBeenCalledWith(1)
        expect(oscillator.type).toBe(waveform === 'triangle' ? 'triangle' : 'sine')
        expect(oscillator.setPeriodicWave.mock.calls).toEqual(
          waveform === 'triangle' ? [] : [[wave]],
        )
      }
      const attack = Gain.instances.at(-2)!.gain
      const decay = Gain.instances.at(-1)!.gain
      expect(attack.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 1.1)
      expect(decay.setTargetAtTime).toHaveBeenCalledWith(0.6, 1.1, 0.2)
      expect(spread.connect).toHaveBeenCalledOnce()
      expect(pitch.connect).toHaveBeenCalledOnce()
      const cutoff = Number(off(2))
      expect(cutoff).toBe(3.5)
      expect(attack.cancelAndHoldAtTime).toHaveBeenCalledWith(2)
      expect(decay.cancelAndHoldAtTime).toHaveBeenCalledWith(2)
      expect(decay.setTargetAtTime).toHaveBeenLastCalledWith(0, 2, 0.3)
      for (const oscillator of Oscillator.instances)
        expect(Number(oscillator.stop.mock.calls[0]![0])).toBe(cutoff)
      Oscillator.instances[0]!.dispatchEvent(new Event('ended'))
      expect(spread.disconnect).toHaveBeenCalledOnce()
      expect(pitch.disconnect).toHaveBeenCalledOnce()
      patch.dispose()
      // The library's extra spread source must also stop when disposal truncates a tail.
      expect(Constant.instances.at(-1)!.stop).toHaveBeenLastCalledWith(0)
    },
  )
})
