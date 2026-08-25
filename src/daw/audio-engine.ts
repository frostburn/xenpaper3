import type { DawProject } from './project'
import { createPlaybackPlan, type PlaybackPlan } from './playback-plan'
import { parseProjectScoreNotes, type PitchGlideSegment, type ScheduledLaneNote } from './score'
import { xenpaperPitchToPatchDetune } from './web-audio-automation'
import { WebAudioPlaybackSession } from './web-audio-playback'

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
export { parseClipNotes, parseLaneNotes, parseProjectScoreNotes, sourceClipLength } from './score'
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

  constructor(context?: AudioContext) {
    super()
    this.ownsContext = context === undefined
    this.context = context ?? new AudioContext({ latencyHint: 'interactive' })
  }

  play(project: DawProject, fromBeat = 0): void {
    if (this.disposed) throw new Error('Cannot play a disposed audio engine.')

    // Compile first: invalid edits do not tear down a currently audible session.
    const plan = createPlaybackPlan(project, fromBeat)
    this.stop()

    const session = new WebAudioPlaybackSession(this.context, plan, {
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
