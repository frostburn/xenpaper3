import type { DawProject } from './project'
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
    const sampledDrumkits = new Map<string, SampledDrumkit>()
    const sampledInstruments = new Map<string, SampledInstrument>()
    try {
      await Promise.all([
        ...plan.lanes.map(async (lane) => {
          if (lane.kind !== 'drum' || lane.drumkit.type !== 'samples') return
          sampledDrumkits.set(
            lane.id,
            await loadSampledDrumkit(this.context, lane.drumkit.strudelJson, {
              baseUrl: lane.drumkit.url
                ? githubRawUrl(lane.drumkit.url, globalThis.location.href)
                : globalThis.location.href,
            }),
          )
        }),
        ...plan.lanes.map(async (lane) => {
          if (lane.kind !== 'instrument' || !lane.sampledInstrument) return
          const source = lane.sampledInstrument
          sampledInstruments.set(
            lane.id,
            await loadSampledInstrument(this.context, source.doughJson, source.instrument, {
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
    if (requestId !== this.playRequestId) {
      for (const drumkit of sampledDrumkits.values()) drumkit.dispose()
      for (const instrument of sampledInstruments.values()) instrument.dispose()
      return
    }
    // Drum voices instantiate RandomNode worklets when their scheduled hit begins.
    // Finish module registration before creating or starting the playback session.
    if (plan.lanes.some((lane) => lane.kind === 'drum' && lane.drumkit.type === 'patch'))
      await registerMathWorklets(this.context)
    if (requestId !== this.playRequestId) {
      for (const drumkit of sampledDrumkits.values()) drumkit.dispose()
      for (const instrument of sampledInstruments.values()) instrument.dispose()
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
