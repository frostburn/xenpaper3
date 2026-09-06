import { mmod } from 'xen-dev-utils/fraction'

export interface StrudelSampleMap {
  readonly _base?: string
  readonly [name: string]: string | readonly string[] | undefined
}

export interface SampledDrumkitOptions {
  /** Fetch implementation, primarily useful outside the browser and in tests. */
  readonly fetch?: typeof fetch
  /** Base URL used to resolve `_base` when the manifest is supplied as an object. */
  readonly baseUrl?: string | URL
}

export interface SampleHitOptions {
  /** Zero-based variant within the named bank. Indices wrap like Strudel's `n`. */
  readonly index?: number
  readonly gain?: number
}

type SampleManifestSource = string | URL | StrudelSampleMap

/** Convert a GitHub `blob` page to its equivalent raw-content URL without requesting it. */
export const githubRawUrl = (source: string | URL, baseUrl?: string | URL): URL => {
  const url = new URL(source.toString(), baseUrl)
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return url
  const [owner, repository, marker, ref, ...path] = url.pathname.split('/').filter(Boolean)
  if (!owner || !repository || marker !== 'blob' || !ref || !path.length) return url
  return new URL(
    `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${path.join('/')}`,
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

const resolveBase = (manifest: StrudelSampleMap, fallback: URL): URL =>
  manifest._base ? new URL(manifest._base, fallback) : fallback

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
    if (!Number.isFinite(gainValue) || gainValue < 0)
      throw new RangeError('Sample gain must be finite and non-negative')

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
  const fetcher = options.fetch ?? globalThis.fetch
  if (!fetcher) throw new Error('A fetch implementation is required to load a sampled drumkit')

  let manifest: StrudelSampleMap
  let manifestBase: URL
  if (typeof source === 'string' || source instanceof URL) {
    const url = githubRawUrl(
      source.toString(),
      options.baseUrl ?? globalThis.location?.href ?? 'http://localhost/',
    )
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`Unable to load sample manifest ${url}: ${response.status}`)
    manifest = parseStrudelSampleMap(await response.json())
    manifestBase = new URL('.', url)
  } else {
    manifest = parseStrudelSampleMap(source)
    manifestBase = new URL(options.baseUrl ?? globalThis.location?.href ?? 'http://localhost/')
  }

  const base = resolveBase(manifest, manifestBase)
  const loadedBanks = await Promise.all(
    manifestBanks(manifest).map(async ([name, files]) => {
      const bank = await Promise.all(
        files.map(async (file) => {
          const url = new URL(file, base)
          const response = await fetcher(url)
          if (!response.ok) throw new Error(`Unable to load drum sample ${url}: ${response.status}`)
          return context.decodeAudioData(await response.arrayBuffer())
        }),
      )
      return [name, bank] as const
    }),
  )
  return new SampledDrumkit(context, new Map(loadedBanks))
}
