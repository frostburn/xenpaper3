import { describe, expect, it, vi } from 'vitest'
import { loadSampledDrumkit } from '../sampled-drumkit'

const fn = <T extends (...args: never[]) => unknown>() => vi.fn<T>()

const response = (body: unknown) =>
  ({
    ok: true,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(1),
  }) as Response

describe('sampled drumkits', () => {
  it('loads a Strudel manifest, resolves _base, and decodes every variant', async () => {
    const decoded = [{ duration: 1 }, { duration: 2 }] as AudioBuffer[]
    const context = {
      decodeAudioData: fn<(_: ArrayBuffer) => Promise<AudioBuffer>>()
        .mockResolvedValueOnce(decoded[0]!)
        .mockResolvedValueOnce(decoded[1]!),
    } as unknown as BaseAudioContext
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ _base: '../audio/', bd: ['one.wav', 'two.wav'] }))
      .mockResolvedValue(response(null))

    const kit = await loadSampledDrumkit(context, 'https://example.com/kits/uzu.json', {
      fetch: fetcher,
    })

    expect(kit.drumNames).toEqual(['bd'])
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://example.com/kits/uzu.json',
      'https://example.com/audio/one.wav',
      'https://example.com/audio/two.wav',
    ])
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2)
  })

  it('schedules wrapped variants and returns a Transport-compatible note off', async () => {
    const sources: Record<string, ReturnType<typeof vi.fn> | unknown>[] = []
    const context = {
      currentTime: 3,
      decodeAudioData: fn<(_: ArrayBuffer) => Promise<AudioBuffer>>().mockResolvedValue(
        {} as AudioBuffer,
      ),
      createBufferSource: () => {
        const source = {
          buffer: undefined,
          connect: fn<() => AudioNode>().mockReturnThis(),
          disconnect: fn<() => void>(),
          start: fn<(time: number) => void>(),
          stop: fn<(time: number) => void>(),
          addEventListener: fn<() => void>(),
        }
        sources.push(source)
        return source
      },
      createGain: () => ({
        gain: { setValueAtTime: fn<(value: number, time: number) => void>() },
        connect: fn<() => AudioNode>().mockReturnThis(),
        disconnect: fn<() => void>(),
      }),
    } as unknown as BaseAudioContext
    const kit = await loadSampledDrumkit(
      context,
      { _base: 'https://example.com/', bd: ['one.wav', 'two.wav'] },
      { fetch: vi.fn<typeof fetch>().mockResolvedValue(response(null)) },
    )

    const off = kit.hit('bd', {} as AudioNode, 4, { index: -1, gain: 0.5 })
    expect(sources[0]!.start).toHaveBeenCalledWith(4)
    expect(off(5)).toBe(5)
    expect(sources[0]!.stop).toHaveBeenCalledWith(5)
    off(6)
    expect(sources[0]!.stop).toHaveBeenCalledOnce()
  })

  it('rejects malformed and unknown banks', async () => {
    const context = {
      decodeAudioData: fn<(_: ArrayBuffer) => Promise<AudioBuffer>>(),
    } as unknown as BaseAudioContext
    await expect(
      loadSampledDrumkit(context, { bd: [] }, { fetch: vi.fn<typeof fetch>() }),
    ).rejects.toThrow('must contain file names')
  })
})
