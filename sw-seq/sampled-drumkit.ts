import { mmod } from 'xen-dev-utils/fraction'
import {
  fetchAudioBuffer,
  finiteNonNegative,
  isRecord,
  loadSampleManifest,
  type SampleLoadingOptions,
} from './sampled-util'

export { githubRawUrl } from './sampled-util'

export interface StrudelSampleMap {
  readonly _base?: string
  readonly [name: string]: string | readonly string[] | undefined
}

export type SampledDrumkitOptions = SampleLoadingOptions

export interface SampleHitOptions {
  /** Zero-based variant within the named bank. Indices wrap like Strudel's `n`. */
  readonly index?: number
  readonly gain?: number
}

type SampleManifestSource = string | URL | StrudelSampleMap

export const parseStrudelSampleMap = (value: unknown): StrudelSampleMap => {
  if (!isRecord(value)) throw new TypeError('A Strudel sample manifest must be an object')
  if (value._base !== undefined && typeof value._base !== 'string')
    throw new TypeError('The Strudel sample manifest `_base` must be a string')

  for (const [name, files] of Object.entries(value)) {
    if (name === '_base') continue
    if (!name || (typeof files !== 'string' && !Array.isArray(files)))
      throw new TypeError(`Invalid Strudel sample bank "${name}"`)
    const entries = typeof files === 'string' ? [files] : files
    if (!entries.length || entries.some((file) => typeof file !== 'string' || !file))
      throw new TypeError(`Strudel sample bank "${name}" must contain file names`)
  }
  return value as StrudelSampleMap
}

export const strudelSampleNames = (manifest: StrudelSampleMap): readonly string[] =>
  Object.freeze(manifestBanks(parseStrudelSampleMap(manifest)).map(([name]) => name))

const manifestBanks = (manifest: StrudelSampleMap): [string, readonly string[]][] =>
  Object.entries(manifest)
    .filter(([name]) => name !== '_base')
    .map(([name, files]) => [name, typeof files === 'string' ? [files] : files!])

/**
 * A preloaded Strudel-compatible sample map.
 *
 * Construct kits with {@link loadSampledDrumkit}; loading every buffer up front keeps
 * transport callbacks synchronous and therefore safe for Web Audio look-ahead scheduling.
 */
export class SampledDrumkit {
  readonly drumNames: readonly string[]
  private readonly activeSources = new Set<AudioBufferSourceNode>()

  constructor(
    readonly context: BaseAudioContext,
    private readonly buffers: ReadonlyMap<string, readonly AudioBuffer[]>,
  ) {
    this.drumNames = Object.freeze([...buffers.keys()])
  }

  /** Schedule a sample and return a note-off callback compatible with `Transport`. */
  hit(
    name: string,
    destination: AudioNode,
    time: number,
    options: SampleHitOptions = {},
  ): (end: number) => number {
    const bank = this.buffers.get(name)
    if (!bank) throw new RangeError(`Unknown drum sample "${name}"`)
    const index = options.index ?? 0
    if (!Number.isInteger(index)) throw new RangeError('Sample index must be an integer')
    const buffer = bank[mmod(index, bank.length)]!
    const gainValue = options.gain ?? 1
    finiteNonNegative(gainValue, 'Sample gain')

    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    source.buffer = buffer
    gain.gain.setValueAtTime(gainValue, time)
    source.connect(gain).connect(destination)
    source.start(time)
    this.activeSources.add(source)
    source.addEventListener(
      'ended',
      () => {
        this.activeSources.delete(source)
        source.disconnect()
        gain.disconnect()
      },
      { once: true },
    )

    let stopped = false
    return (end) => {
      if (!Number.isFinite(end)) throw new RangeError('Sample end time must be finite')
      if (!stopped) {
        stopped = true
        source.stop(end)
      }
      return end
    }
  }

  dispose(): void {
    for (const source of this.activeSources) {
      try {
        source.stop(this.context.currentTime)
      } catch {
        // A source which ended between iteration and stop is already safely released.
      }
      source.disconnect()
    }
    this.activeSources.clear()
  }
}

/** Load a Strudel `samples.json` URL (or parsed manifest) and decode all its samples. */
export const loadSampledDrumkit = async (
  context: BaseAudioContext,
  source: SampleManifestSource,
  options: SampledDrumkitOptions = {},
): Promise<SampledDrumkit> => {
  const { manifest, base, fetcher } = await loadSampleManifest(
    source,
    parseStrudelSampleMap,
    options,
  )
  const loadedBanks = await Promise.all(
    manifestBanks(manifest).map(async ([name, files]) => {
      const bank = await Promise.all(
        files.map(async (file) => {
          const url = new URL(file, base)
          return fetchAudioBuffer(context, fetcher, url, 'drum sample')
        }),
      )
      return [name, bank] as const
    }),
  )
  return new SampledDrumkit(context, new Map(loadedBanks))
}
