export interface SampleManifest {
  readonly _base?: string
}

export interface SampleLoadingOptions {
  /** Fetch implementation, primarily useful outside the browser and in tests. */
  readonly fetch?: typeof fetch
  /** Base URL used to resolve `_base` when the manifest is supplied as an object. */
  readonly baseUrl?: string | URL
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const finiteNonNegative = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${label} must be finite and non-negative`)
  return value
}

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

/** Fetch or accept a parsed sample manifest and return it with its resolved sample base URL. */
export const loadSampleManifest = async <T extends SampleManifest>(
  source: string | URL | T,
  parse: (value: unknown) => T,
  options: SampleLoadingOptions,
): Promise<{ manifest: T; base: URL; fetcher: typeof fetch }> => {
  const fetcher = options.fetch ?? globalThis.fetch
  if (!fetcher) throw new Error('A fetch implementation is required to load samples')
  let manifest: T
  let manifestBase: URL
  if (typeof source === 'string' || source instanceof URL) {
    const url = githubRawUrl(
      source,
      options.baseUrl ?? globalThis.location?.href ?? 'http://localhost/',
    )
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`Unable to load sample manifest ${url}: ${response.status}`)
    manifest = parse(await response.json())
    manifestBase = new URL('.', url)
  } else {
    manifest = parse(source)
    manifestBase = new URL(options.baseUrl ?? globalThis.location?.href ?? 'http://localhost/')
  }
  return {
    manifest,
    base: manifest._base ? new URL(manifest._base, manifestBase) : manifestBase,
    fetcher,
  }
}

export const fetchAudioBuffer = async (
  context: BaseAudioContext,
  fetcher: typeof fetch,
  url: URL,
  description: string,
): Promise<AudioBuffer> => {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`Unable to load ${description} ${url}: ${response.status}`)
  return context.decodeAudioData(await response.arrayBuffer())
}
