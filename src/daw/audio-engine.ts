import type { DawProject } from './project'
import { createPlaybackPlan, type PlaybackPlan } from './playback-plan'
import { WebAudioPlaybackSession } from './web-audio-playback'

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
