import { createPatch, type PlayableSynthPatch } from '../../sw-patch'
import { Transport } from '../../sw-seq'
import DEFAULT_PATCH_SOURCE from '../patches/default.swpatch?raw'
import type { DawProject } from './project'
import { parseProjectNotes } from './score'
import { projectBeatToSeconds, projectSecondsToBeat } from './timeline'

// Compatibility exports for non-UI consumers; implementations live in their
// domain modules so rendering never depends on the Web Audio engine.
export { parseClipNotes, parseProjectNotes, sourceClipLength } from './score'
export type { EnvelopeSettings, ScheduledLaneNote } from './score'
export { projectBeatToSeconds, projectSecondsToBeat } from './timeline'

type PatchSynth = PlayableSynthPatch

export function notePlaybackWindow(
  noteBeat: number,
  noteDuration: number,
  fromBeat: number,
): { startBeat: number; endBeat: number } | undefined {
  const endBeat = noteBeat + noteDuration
  if (endBeat <= fromBeat) return undefined
  return { startBeat: Math.max(noteBeat, fromBeat), endBeat }
}

/** One disposable Web Audio playback session backed by sw-seq and default.swpatch. */
export class DawAudioEngine extends EventTarget {
  readonly context: AudioContext
  private transport: Transport | undefined
  private output: GainNode
  private readonly synths: PatchSynth[] = []
  private pitchSignals: ConstantSourceNode[] = []
  private activeProject: DawProject | undefined
  private completionTimer: ReturnType<typeof setTimeout> | undefined
  private latestCutoff = 0
  private disposed = false

  constructor(context = new AudioContext({ latencyHint: 'interactive' })) {
    super()
    this.context = context
    this.output = new GainNode(context, { gain: 0.35 })
    this.output.connect(context.destination)
  }

  play(project: DawProject, fromBeat = 0): void {
    this.stop()
    if (this.disposed) throw new Error('Cannot play a disposed audio engine.')
    this.activeProject = project
    const transport = new Transport(this.context)
    this.transport = transport
    transport.addEventListener(
      'ended',
      () => {
        // A stopped transport may still receive its already-scheduled ticker callback.
        if (this.transport === transport) this.completeAfterAudioTail()
      },
      { once: true },
    )
    let endBeat = fromBeat
    for (const lane of project.instrumentLanes) {
      // The project stores the patch identifier; the first production instrument is the
      // bundled default patch. Keeping compilation per lane also isolates patch config.
      const source = lane.patchSource === 'default' ? DEFAULT_PATCH_SOURCE : lane.patchSource
      const synth = createPatch(source, this.context, {
        config: { oscillatorType: lane.oscillatorType },
      }) as PatchSynth
      this.synths.push(synth)
      const laneProject = { ...project, instrumentLanes: [lane] }
      for (const note of parseProjectNotes(laneProject)) {
        const playbackWindow = notePlaybackWindow(note.beat, note.duration, fromBeat)
        if (!playbackWindow) continue
        endBeat = Math.max(endBeat, playbackWindow.endBeat)
        const start = projectBeatToSeconds(project, playbackWindow.startBeat)
        const end = projectBeatToSeconds(project, playbackWindow.endBeat)
        transport.scheduleParametricNote({
          when: start,
          duration: end - start,
          noteOn: (time) => {
            const pitch = new ConstantSourceNode(this.context, { offset: note.cents })
            this.pitchSignals.push(pitch)
            pitch.start(time)
            const { attack, decay, sustain, release } = note.envelope
            const off = synth.on(
              this.output,
              time,
              pitch,
              note.velocity * lane.gain,
              attack,
              decay,
              sustain,
              release,
            )
            return (end) => {
              const tail = off(end)
              this.latestCutoff = Math.max(this.latestCutoff, tail)
              pitch.stop(tail)
              return tail
            }
          },
        })
      }
    }
    transport.endTime = projectBeatToSeconds(project, endBeat)
    transport.start(projectBeatToSeconds(project, fromBeat))
  }

  get positionBeats(): number {
    if (!this.transport || !this.activeProject) return 0
    return projectSecondsToBeat(this.activeProject, this.transport.position)
  }

  private completeAfterAudioTail(): void {
    const delay = Math.max(0, (this.latestCutoff - this.context.currentTime) * 1000)
    this.completionTimer = setTimeout(() => {
      this.completionTimer = undefined
      this.releasePlaybackResources()
      this.dispatchEvent(new Event('ended'))
    }, delay)
  }

  private releasePlaybackResources(): void {
    for (const pitch of this.pitchSignals) pitch.disconnect()
    this.pitchSignals = []
    for (const synth of this.synths) synth.dispose()
    this.synths.length = 0
    this.latestCutoff = 0
  }

  stop(): void {
    this.transport?.stop()
    this.transport?.clearAll()
    this.transport = undefined
    this.activeProject = undefined
    if (this.completionTimer) clearTimeout(this.completionTimer)
    this.completionTimer = undefined
    // Parametric note-offs have already been committed by sw-seq and are deliberately
    // one-shot. Mute and retire the session bus instead of trying to release them twice.
    this.output.gain.cancelScheduledValues(this.context.currentTime)
    this.output.gain.setValueAtTime(0, this.context.currentTime)
    this.output.disconnect()
    this.releasePlaybackResources()
    this.output = new GainNode(this.context, { gain: 0.35 })
    this.output.connect(this.context.destination)
  }

  dispose(): void {
    this.stop()
    this.output.disconnect()
    this.disposed = true
    void this.context.close()
  }
}
