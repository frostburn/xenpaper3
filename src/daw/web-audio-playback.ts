import {
  createDrumkit,
  createPatch,
  isAperiodicTimbre,
  type PlayableDrumkitPatch,
  type PlayableSynthPatch,
  type SynthPatch,
} from '../../sw-patch'
import { Transport } from '../../sw-seq'
import { isAppleWebKit } from '../browser'
import DEFAULT_PATCH_SOURCE from '../patches/default.swpatch?raw'
import DRUMKIT_PATCH_SOURCE from '../patches/drumkit.swpatch?raw'
import type { PlaybackLane, PlaybackPlan } from './playback-plan'
import { applyPitchAutomation } from './web-audio-automation'

const DEFAULT_OUTPUT_GAIN = 0.35

type PlaybackState = 'ready' | 'playing' | 'tail' | 'stopped' | 'ended'

type PatchFactory = (
  source: string,
  context: BaseAudioContext,
  options: {
    config: { oscillatorType: PlaybackLane['oscillatorType']; aperiodic: boolean }
  },
) => SynthPatch
type DrumkitFactory = typeof createDrumkit

export interface WebAudioPlaybackOptions {
  readonly outputGain?: number
  readonly patchFactory?: PatchFactory
  readonly drumkitFactory?: DrumkitFactory
  readonly resolvePatchSource?: (source: string) => string
  readonly onEnded?: () => void
}

const defaultPatchSource = (source: string): string =>
  source === 'default' ? DEFAULT_PATCH_SOURCE : source === 'drumkit' ? DRUMKIT_PATCH_SOURCE : source

const requirePlayableSynth = (patch: SynthPatch, lane: PlaybackLane): PlayableSynthPatch => {
  if (typeof (patch as Partial<PlayableSynthPatch>).on === 'function')
    return patch as PlayableSynthPatch
  patch.dispose()
  throw new TypeError(`Patch for lane "${lane.name}" must export an on() function`)
}

/** One disposable translation of a pure playback plan into Web Audio nodes and events. */
export class WebAudioPlaybackSession {
  readonly context: AudioContext
  readonly plan: PlaybackPlan
  readonly transport: Transport

  private readonly output: GainNode
  private readonly patchFactory: PatchFactory
  private readonly drumkitFactory: DrumkitFactory
  private readonly resolvePatchSource: (source: string) => string
  private readonly onEnded?: () => void
  private readonly synths: PlayableSynthPatch[] = []
  private readonly drumkits: PlayableDrumkitPatch[] = []
  private readonly pitchSignals: ConstantSourceNode[] = []
  private completionTimer: ReturnType<typeof setTimeout> | undefined
  private latestCutoff = 0
  private state: PlaybackState = 'ready'

  constructor(context: AudioContext, plan: PlaybackPlan, options: WebAudioPlaybackOptions = {}) {
    this.context = context
    this.plan = plan
    this.transport = new Transport(context, { useSetTimeoutFallback: isAppleWebKit() })
    this.patchFactory = options.patchFactory ?? createPatch
    this.drumkitFactory = options.drumkitFactory ?? createDrumkit
    this.resolvePatchSource = options.resolvePatchSource ?? defaultPatchSource
    this.onEnded = options.onEnded
    this.output = new GainNode(context, { gain: options.outputGain ?? DEFAULT_OUTPUT_GAIN })
    this.output.connect(context.destination)
  }

  get positionTime(): number {
    return this.transport.position
  }

  start(): void {
    if (this.state !== 'ready') throw new Error('A Web Audio playback session is one-shot')
    try {
      this.schedulePlan()
      this.state = 'playing'
      this.transport.addEventListener('ended', this.handleTransportEnded, { once: true })
      this.transport.endTime = this.plan.endTime
      this.transport.start(this.plan.startTime)
    } catch (error) {
      this.stop()
      throw error
    }
  }

  stop(): void {
    if (this.state === 'stopped' || this.state === 'ended') return
    this.transport.removeEventListener('ended', this.handleTransportEnded)
    this.transport.stop()
    this.transport.clearAll()
    if (this.completionTimer !== undefined) clearTimeout(this.completionTimer)
    this.completionTimer = undefined
    this.muteAndRelease()
    this.state = 'stopped'
  }

  dispose(): void {
    this.stop()
  }

  private schedulePlan(): void {
    for (const lane of this.plan.lanes) {
      if (lane.kind === 'drum') {
        const kit = this.drumkitFactory(this.resolvePatchSource(lane.patchSource), this.context)
        this.drumkits.push(kit)
        for (const note of lane.notes) {
          if (!note.sample) throw new TypeError(`Drum lane "${lane.name}" contains a pitched note`)
          this.transport.scheduleParametricNote({
            when: note.when,
            duration: note.duration,
            noteOn: (time) => {
              const { attack, decay, sustain, release } = note.envelope
              const off = kit.hit(
                note.sample!,
                this.output,
                time,
                note.velocity * lane.gain,
                attack,
                decay,
                sustain,
                release,
              )
              return (end) => {
                const cutoff = Number(off(end))
                if (!Number.isFinite(cutoff) || cutoff < end) {
                  throw new RangeError(
                    'A drum patch note-off must return a finite cutoff at or after note end',
                  )
                }
                this.latestCutoff = Math.max(this.latestCutoff, cutoff)
                return cutoff
              }
            },
          })
        }
        continue
      }
      const patch = this.patchFactory(this.resolvePatchSource(lane.patchSource), this.context, {
        config: {
          oscillatorType: lane.oscillatorType,
          aperiodic: isAperiodicTimbre(lane.oscillatorType),
        },
      })
      const synth = requirePlayableSynth(patch, lane)
      this.synths.push(synth)

      for (const note of lane.notes) {
        this.transport.scheduleParametricNote({
          when: note.when,
          duration: note.duration,
          noteOn: (time) => {
            const pitch = this.context.createConstantSource()
            applyPitchAutomation(pitch.offset, note.pitch, time)
            pitch.start(time)
            this.pitchSignals.push(pitch)
            const { attack, decay, sustain, release } = note.envelope
            let off: ReturnType<PlayableSynthPatch['on']>
            try {
              off = synth.on(
                this.output,
                time,
                pitch,
                note.velocity * lane.gain,
                attack,
                decay,
                sustain,
                release,
              )
            } catch (error) {
              pitch.stop(time)
              throw error
            }
            return (end) => {
              let cutoff: number
              try {
                // SW Patch represents unit-bearing return values as number-coercible
                // quantities. Normalize the Instant at this JavaScript/Web Audio boundary.
                cutoff = Number(off(end))
              } catch (error) {
                pitch.stop(end)
                throw error
              }
              if (!Number.isFinite(cutoff) || cutoff < end) {
                pitch.stop(end)
                throw new RangeError(
                  'A patch note-off must return a finite cutoff at or after note end',
                )
              }
              this.latestCutoff = Math.max(this.latestCutoff, cutoff)
              pitch.stop(cutoff)
              return cutoff
            }
          },
        })
      }
    }
  }

  private readonly handleTransportEnded = (): void => {
    if (this.state !== 'playing') return
    this.state = 'tail'
    // A fractional millisecond timeout is rounded down by some hosts. Rounding up keeps
    // teardown from racing the scheduled release cutoff.
    const delay = Math.max(0, Math.ceil((this.latestCutoff - this.context.currentTime) * 1000))
    this.completionTimer = setTimeout(() => {
      this.completionTimer = undefined
      if (this.state !== 'tail') return
      this.muteAndRelease()
      this.state = 'ended'
      this.onEnded?.()
    }, delay)
  }

  private muteAndRelease(): void {
    this.output.gain.cancelScheduledValues(this.context.currentTime)
    this.output.gain.setValueAtTime(0, this.context.currentTime)
    this.output.disconnect()
    // Patches own the targeted pitch -> AudioParam connections. Dispose them before
    // disconnecting the sources wholesale: disconnecting a source first makes the
    // patch's later targeted disconnect throw in browsers.
    for (const synth of this.synths) synth.dispose()
    this.synths.length = 0
    for (const drumkit of this.drumkits) drumkit.dispose()
    this.drumkits.length = 0
    for (const pitch of this.pitchSignals) {
      pitch.stop(this.context.currentTime)
      pitch.disconnect()
    }
    this.pitchSignals.length = 0
    this.latestCutoff = 0
  }
}
