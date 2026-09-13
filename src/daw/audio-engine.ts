import type { DawProject } from './project'
import audioBufferToWav from 'audiobuffer-to-wav'
import { createPlaybackPlan, type PlaybackPlan } from './playback-plan'
import { parseProjectScoreNotes, type PitchGlideSegment, type ScheduledLaneNote } from './score'
import { xenpaperPitchToPatchDetune } from './web-audio-automation'
import { WebAudioPlaybackSession } from './web-audio-playback'
import { registerMathWorklets } from '../../sw-patch'
import {
  githubRawUrl,
  loadSampledDrumkit,
  loadSampledInstrument,
  type SampledDrumkit,
  type SampledInstrument,
} from '../../sw-seq'

// Compatibility exports for non-UI consumers. Pure musical operations live in
// score/playback-plan/timeline; browser-specific operations live in web-audio-*.
export {
  createPlaybackPlan,
  glissandoPitchAtBeat,
  glissandoPitchAtElapsedTime,
  notePlaybackWindow,
} from './playback-plan'
export type {
  NotePlaybackWindow,
  PitchAutomationPlan,
  PitchCurvePlan,
  PlaybackLane,
  PlaybackNote,
  PlaybackPlan,
} from './playback-plan'
export {
  parseClipNotes,
  parseDrumClipNotes,
  parseLaneNotes,
  parseProjectScoreNotes,
  sourceClipLength,
} from './score'
export type { EnvelopeSettings, PitchGlideSegment, ScheduledLaneNote } from './score'
export { createTempoMap, projectBeatToSeconds, projectSecondsToBeat, TempoMap } from './timeline'
export { easeGlissando, type GlissandoEasing } from './easing'
export {
  applyPitchAutomation,
  glissandoCurveDuration,
  XENPAPER_C_TO_SW_PATCH_DETUNE,
  xenpaperPitchToPatchDetune,
} from './web-audio-automation'

const convertGlissando = (segments: readonly PitchGlideSegment[] | undefined) =>
  segments?.map((segment) => ({
    ...segment,
    from: xenpaperPitchToPatchDetune(segment.from),
    to: xenpaperPitchToPatchDetune(segment.to),
  }))

/**
 * Legacy projection used by the original audio engine: notes expressed as SW Patch detune.
 * Prefer `parseProjectScoreNotes` or `createPlaybackPlan` in new code.
 */
export const parseProjectPatchNotes = (project: DawProject): ScheduledLaneNote[] =>
  parseProjectScoreNotes(project).map((note) => ({
    ...note,
    cents: xenpaperPitchToPatchDetune(note.cents),
    glissando: convertGlissando(note.glissando),
  }))

/** @deprecated Use `parseProjectScoreNotes` for musical data or `createPlaybackPlan` for audio. */
export const parseProjectNotes = parseProjectPatchNotes

const prepareSamples = async (context: BaseAudioContext, plan: PlaybackPlan) => {
  const sampledDrumkits = new Map<string, SampledDrumkit>()
  const sampledInstruments = new Map<string, SampledInstrument>()
  try {
    await Promise.all([
      ...plan.lanes.map(async (lane) => {
        if (lane.kind !== 'drum' || lane.drumkit.type !== 'samples') return
        sampledDrumkits.set(
          lane.id,
          await loadSampledDrumkit(context, lane.drumkit.strudelJson, {
            baseUrl: lane.drumkit.url
              ? githubRawUrl(lane.drumkit.url, globalThis.location.href)
              : globalThis.location.href,
          }),
        )
      }),
      ...plan.lanes.map(async (lane) => {
        if (lane.kind !== 'instrument' || lane.instrument.type !== 'samples') return
        const source = lane.instrument
        sampledInstruments.set(
          lane.id,
          await loadSampledInstrument(context, source.doughJson, source.instrument, {
            baseUrl: source.url
              ? githubRawUrl(source.url, globalThis.location.href)
              : globalThis.location.href,
          }),
        )
      }),
    ])
  } catch (error) {
    for (const drumkit of sampledDrumkits.values()) drumkit.dispose()
    for (const instrument of sampledInstruments.values()) instrument.dispose()
    throw error
  }
  return { sampledDrumkits, sampledInstruments }
}

const disposeSamples = (
  sampledDrumkits: ReadonlyMap<string, SampledDrumkit>,
  sampledInstruments: ReadonlyMap<string, SampledInstrument>,
) => {
  for (const drumkit of sampledDrumkits.values()) drumkit.dispose()
  for (const instrument of sampledInstruments.values()) instrument.dispose()
}

const planUsesPatches = (plan: PlaybackPlan): boolean =>
  plan.lanes.some((lane) =>
    lane.kind === 'drum' ? lane.drumkit.type === 'patch' : lane.instrument.type === 'patch',
  )

export const WAV_MIME_TYPE = 'audio/wav'
export const DEFAULT_RENDER_SAMPLE_RATE = 48_000
export const RENDER_CHANNEL_COUNT = 2

/** Render a complete project, plus an optional effect/release tail, into a WAV file. */
export const renderProjectToWavBlob = async (
  project: DawProject,
  tailSeconds: number,
  sampleRate = DEFAULT_RENDER_SAMPLE_RATE,
): Promise<Blob> => {
  if (!Number.isFinite(tailSeconds) || tailSeconds < 0)
    throw new RangeError('Render tail must be a finite, non-negative number of seconds')
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    throw new RangeError('Render sample rate must be finite and positive')

  const plan = createPlaybackPlan(project)
  const duration = plan.endTime + tailSeconds
  const frameCount = Math.max(1, Math.ceil(duration * sampleRate))
  const renderDuration = frameCount / sampleRate
  const context = new OfflineAudioContext(RENDER_CHANNEL_COUNT, frameCount, sampleRate)
  const samples = await prepareSamples(context, plan)
  let session: WebAudioPlaybackSession | undefined
  try {
    if (planUsesPatches(plan)) await registerMathWorklets(context)
    session = new WebAudioPlaybackSession(context, plan, {
      ...samples,
      transportOptions: { interval: renderDuration, lookAhead: 0 },
      // Native scheduled sources remain dormant until their start time. Worklet-based
      // noise processes every preceding render quantum for every future drum voice.
      nativePatchNoise: true,
    })
    session.start()
    const renderedBuffer = await context.startRendering()
    return new Blob([audioBufferToWav(renderedBuffer)], { type: WAV_MIME_TYPE })
  } catch (error) {
    if (!session) disposeSamples(samples.sampledDrumkits, samples.sampledInstruments)
    throw error
  } finally {
    session?.dispose()
  }
}

/** Small owner/facade around immutable playback plans and disposable Web Audio sessions. */
export class DawAudioEngine extends EventTarget {
  readonly context: AudioContext
  private readonly ownsContext: boolean
  private session: WebAudioPlaybackSession | undefined
  private activePlan: PlaybackPlan | undefined
  private disposed = false
  private playRequestId = 0

  constructor(context?: AudioContext) {
    super()
    this.ownsContext = context === undefined
    this.context = context ?? new AudioContext({ latencyHint: 'interactive' })
  }

  async play(project: DawProject, fromBeat = 0): Promise<void> {
    if (this.disposed) throw new Error('Cannot play a disposed audio engine.')

    const requestId = ++this.playRequestId
    // Invalidate pending preparation before compiling, while delaying stop() so invalid
    // edits still do not tear down a currently audible session.
    const plan = createPlaybackPlan(project, fromBeat)
    const { sampledDrumkits, sampledInstruments } = await prepareSamples(this.context, plan)
    if (requestId !== this.playRequestId) {
      disposeSamples(sampledDrumkits, sampledInstruments)
      return
    }
    // Patch voices can instantiate math/noise worklets when their scheduled note begins.
    // Finish module registration before creating or starting the playback session.
    if (planUsesPatches(plan)) await registerMathWorklets(this.context)
    if (requestId !== this.playRequestId) {
      disposeSamples(sampledDrumkits, sampledInstruments)
      return
    }
    this.stop()

    const session = new WebAudioPlaybackSession(this.context, plan, {
      sampledDrumkits,
      sampledInstruments,
      onEnded: () => {
        if (this.session !== session) return
        this.session = undefined
        this.activePlan = undefined
        this.dispatchEvent(new Event('ended'))
      },
    })
    this.session = session
    this.activePlan = plan
    try {
      session.start()
    } catch (error) {
      if (this.session === session) {
        this.session = undefined
        this.activePlan = undefined
      }
      throw error
    }
  }

  get positionBeats(): number {
    if (!this.session || !this.activePlan) return 0
    return this.activePlan.tempoMap.secondsToBeat(this.session.positionTime)
  }

  stop(): void {
    this.playRequestId += 1
    const session = this.session
    this.session = undefined
    this.activePlan = undefined
    session?.stop()
  }

  dispose(): void {
    if (this.disposed) return
    this.stop()
    this.disposed = true
    if (this.ownsContext) void this.context.close()
  }
}
