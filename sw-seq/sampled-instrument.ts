import {
  fetchAudioBuffer,
  finiteNonNegative,
  isRecord,
  loadSampleManifest,
  type SampleLoadingOptions,
} from './sampled-util'

export interface DoughSampleMap {
  readonly _base?: string
  readonly [instrument: string]: string | Readonly<Record<string, string>> | undefined
}

export interface SampledInstrumentOptions extends SampleLoadingOptions {
  /** Time, in seconds, used to fade a voice after note-off. */
  readonly release?: number
}

export interface SampledInstrumentNoteOptions {
  /** Linear amplitude. This is normally the note's velocity. */
  readonly velocity?: number
  /** Override the instrument's note-off fade time, in seconds. */
  readonly release?: number
  /** Schedule cent offsets relative to `midi` on this voice's detune parameter. */
  readonly configureDetune?: (detune: AudioParam) => void
}

type ManifestSource = string | URL | DoughSampleMap

interface InstrumentSample {
  readonly midi: number
  readonly buffer: AudioBuffer
}

const NOTE = /^([A-Ga-g])([#sSbB]?)(-?\d+)$/
const SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

/** Convert Dough/Strudel note labels such as `C4`, `Ds4`, and `Bb3` to MIDI notes. */
export const doughNoteNumber = (note: string): number => {
  const match = NOTE.exec(note)
  if (!match) throw new TypeError(`Invalid Dough sample note "${note}"`)
  let semitone = SEMITONES[match[1]!.toUpperCase()]!
  const accidental = match[2]!.toLowerCase()
  if (accidental === '#' || accidental === 's') semitone += 1
  else if (accidental === 'b') semitone -= 1
  return (Number(match[3]) + 1) * 12 + semitone
}

export const parseDoughSampleMap = (value: unknown): DoughSampleMap => {
  if (!isRecord(value)) throw new TypeError('A Dough sample manifest must be an object')
  if (value._base !== undefined && typeof value._base !== 'string')
    throw new TypeError('The Dough sample manifest `_base` must be a string')
  for (const [instrument, notes] of Object.entries(value)) {
    if (instrument === '_base') continue
    if (!instrument || !isRecord(notes) || !Object.keys(notes).length)
      throw new TypeError(`Invalid Dough sampled instrument "${instrument}"`)
    for (const [note, file] of Object.entries(notes)) {
      doughNoteNumber(note)
      if (typeof file !== 'string' || !file)
        throw new TypeError(`Dough sample "${instrument}.${note}" must be a file name`)
    }
  }
  return value as DoughSampleMap
}

/** A preloaded, chromatically playable Strudel/Dough sampled instrument. */
export class SampledInstrument {
  private readonly activeSources = new Set<AudioBufferSourceNode>()

  constructor(
    readonly context: BaseAudioContext,
    readonly name: string,
    private readonly samples: readonly InstrumentSample[],
    readonly release = 0.1,
  ) {
    finiteNonNegative(release, 'Release time')
  }

  /** Schedule a MIDI note, choosing the nearest sample and pitch-shifting it as needed. */
  note(
    midi: number,
    destination: AudioNode,
    time: number,
    options: SampledInstrumentNoteOptions = {},
  ): (end: number) => number {
    if (!Number.isFinite(midi)) throw new RangeError('MIDI note must be finite')
    const velocity = finiteNonNegative(options.velocity ?? 1, 'Velocity')
    const release = finiteNonNegative(options.release ?? this.release, 'Release time')
    const sample = this.samples.reduce((nearest, candidate) =>
      Math.abs(candidate.midi - midi) < Math.abs(nearest.midi - midi) ? candidate : nearest,
    )
    const source = this.context.createBufferSource()
    const envelope = this.context.createGain()
    source.buffer = sample.buffer
    source.playbackRate.setValueAtTime(2 ** ((midi - sample.midi) / 12), time)
    options.configureDetune?.(source.detune)
    envelope.gain.setValueAtTime(velocity, time)
    source.connect(envelope).connect(destination)
    source.start(time)
    this.activeSources.add(source)
    source.addEventListener(
      'ended',
      () => {
        this.activeSources.delete(source)
        source.disconnect()
        envelope.disconnect()
      },
      { once: true },
    )

    let stopped = false
    return (end) => {
      if (!Number.isFinite(end)) throw new RangeError('Sample end time must be finite')
      const cutoff = end + release
      if (!stopped) {
        stopped = true
        envelope.gain.setValueAtTime(velocity, end)
        envelope.gain.linearRampToValueAtTime(0, cutoff)
        source.stop(cutoff)
      }
      return cutoff
    }
  }

  dispose(): void {
    for (const source of this.activeSources) {
      try {
        source.stop(this.context.currentTime)
      } catch {
        /* The source has already ended. */
      }
      source.disconnect()
    }
    this.activeSources.clear()
  }
}

/** Load and decode one named instrument from a Strudel/Dough sample manifest. */
export const loadSampledInstrument = async (
  context: BaseAudioContext,
  source: ManifestSource,
  instrument: string,
  options: SampledInstrumentOptions = {},
): Promise<SampledInstrument> => {
  const { manifest, base, fetcher } = await loadSampleManifest(source, parseDoughSampleMap, options)
  const notes = manifest[instrument]
  if (!isRecord(notes)) throw new RangeError(`Unknown sampled instrument "${instrument}"`)
  const samples = await Promise.all(
    Object.entries(notes).map(async ([note, file]) => {
      const url = new URL(file as string, base)
      return {
        midi: doughNoteNumber(note),
        buffer: await fetchAudioBuffer(context, fetcher, url, 'instrument sample'),
      }
    }),
  )
  samples.sort((a, b) => a.midi - b.midi)
  return new SampledInstrument(context, instrument, samples, options.release)
}
