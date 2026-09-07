import { describe, expect, it, vi } from 'vitest'
import { doughNoteNumber, loadSampledInstrument } from '../sampled-instrument'

const fn = <T extends (...args: never[]) => unknown>() => vi.fn<T>()

const response = (body: unknown) =>
  ({ ok: true, json: async () => body, arrayBuffer: async () => new ArrayBuffer(1) }) as Response

describe('sampled instruments', () => {
  it('understands Dough note names', () => {
    expect(doughNoteNumber('A0')).toBe(21)
    expect(doughNoteNumber('Ds4')).toBe(63)
    expect(doughNoteNumber('Bb3')).toBe(58)
  })

  it('loads a named bank and resolves its base URL', async () => {
    const context = {
      decodeAudioData: fn<(_: ArrayBuffer) => Promise<AudioBuffer>>().mockResolvedValue(
        {} as AudioBuffer,
      ),
    } as unknown as BaseAudioContext
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(null))
    const instrument = await loadSampledInstrument(
      context,
      { _base: 'https://samples.example/piano/', piano: { A0: 'A0.mp3', C4: 'C4.mp3' } },
      'piano',
      { fetch: fetcher },
    )
    expect(instrument.name).toBe('piano')
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://samples.example/piano/A0.mp3',
      'https://samples.example/piano/C4.mp3',
    ])
  })

  it('uses the nearest sample, applies velocity, and returns the release cutoff', async () => {
    const rate = { setValueAtTime: fn<(value: number, time: number) => void>() }
    const detune = {} as AudioParam
    const gain = {
      setValueAtTime: fn<(value: number, time: number) => void>(),
      linearRampToValueAtTime: fn<(value: number, time: number) => void>(),
    }
    const source = {
      buffer: undefined,
      playbackRate: rate,
      detune,
      connect: fn<() => AudioNode>().mockReturnThis(),
      disconnect: fn<() => void>(),
      start: fn<(time: number) => void>(),
      stop: fn<(time: number) => void>(),
      addEventListener: fn<() => void>(),
    }
    const context = {
      decodeAudioData: fn<(_: ArrayBuffer) => Promise<AudioBuffer>>().mockResolvedValue(
        {} as AudioBuffer,
      ),
      createBufferSource: () => source,
      createGain: () => ({
        gain,
        connect: fn<() => AudioNode>().mockReturnThis(),
        disconnect: fn<() => void>(),
      }),
    } as unknown as BaseAudioContext
    const instrument = await loadSampledInstrument(context, { piano: { C4: 'C4.mp3' } }, 'piano', {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response(null)),
      release: 0.4,
    })

    const configureDetune = fn<(parameter: AudioParam) => void>()
    const off = instrument.note(72, {} as AudioNode, 2, {
      velocity: 0.25,
      configureDetune,
    })
    expect(rate.setValueAtTime).toHaveBeenCalledWith(2, 2)
    expect(gain.setValueAtTime).toHaveBeenCalledWith(0.25, 2)
    expect(configureDetune).toHaveBeenCalledWith(detune)
    expect(off(3)).toBe(3.4)
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 3.4)
    expect(source.stop).toHaveBeenCalledWith(3.4)
  })
})
