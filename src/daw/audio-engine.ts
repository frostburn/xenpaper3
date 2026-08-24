import {
  evaluateExpression,
  expandToBeatEvents,
  parse,
  type DirectiveExtension,
} from '../../xenpaper-lang'
import { createPatch, type SynthPatch } from '../../sw-patch'
import { Transport } from '../../sw-seq'
import DEFAULT_PATCH_SOURCE from '../patches/default.swpatch?raw'
import { beat, beatToNumber, type Beat, type DawProject } from './project'

type PatchSynth = SynthPatch & {
  on(
    destination: AudioNode,
    start: number,
    pitch: AudioNode,
    velocity: number,
    attack?: number,
    decay?: number,
    sustain?: number,
    release?: number,
  ): (end: number) => number
}

export interface ScheduledLaneNote {
  readonly beat: number
  readonly duration: number
  readonly cents: number
  readonly velocity: number
  readonly envelope: EnvelopeSettings
}

export interface EnvelopeSettings {
  readonly attack: number
  readonly decay: number
  readonly sustain: number
  readonly release: number
}

/** Parse the note events in one clip, keeping their positions relative to its start. */
export const parseClipNotes = (source: string, duration = Number.POSITIVE_INFINITY) => {
  const result = expandToBeatEvents(parse(source), { directiveExtensions: [envelopeExtension] })
  const errors = result.diagnostics.filter(({ severity }) => severity === 'error')
  if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))
  if (!('score' in result)) return []

  return result.score.events
    .filter((event) => event.kind === 'note')
    .filter((event) => event.start.valueOf() < duration)
    .map((event) => ({
      beat: event.start.valueOf(),
      duration: Math.min(event.duration.valueOf(), duration - event.start.valueOf()),
      cents: event.pitch.value.valueOf(),
      velocity: event.dynamic.valueOf(),
      envelope: (event.directiveState.patch as EnvelopeSettings | undefined) ?? DEFAULT_ENVELOPE,
    }))
}

const DEFAULT_ENVELOPE: EnvelopeSettings = Object.freeze({
  attack: 0.1,
  decay: 0.2,
  sustain: 0.7,
  release: 0.3,
})

const envelopeExtension: DirectiveExtension = {
  name: 'patch',
  initialState: DEFAULT_ENVELOPE,
  apply(directive, context, previousState) {
    const envelope = { ...(previousState as EnvelopeSettings) }
    const diagnostics = []
    for (const argument of directive.arguments) {
      if (argument.type !== 'NamedArgument' || !(argument.name in envelope))
        throw new Error('@patch accepts the named attack, decay, sustain, and release parameters.')
      const result = evaluateExpression(argument.value, context)
      diagnostics.push(...result.diagnostics)
      if (!('value' in result) || result.value.kind !== 'scalar')
        throw new Error(`Patch parameter ${argument.name} must be scalar.`)
      envelope[argument.name as keyof EnvelopeSettings] = result.value.value.valueOf()
    }
    return { state: Object.freeze(envelope), diagnostics }
  },
}

/** Derive a clip's visual span from its evaluated source, using one bar for empty scores. */
export const sourceClipLength = (source: string, defaultBar = beat(4)): Beat => {
  const result = expandToBeatEvents(parse(source), { directiveExtensions: [envelopeExtension] })
  if (!('score' in result) || result.diagnostics.some(({ severity }) => severity === 'error'))
    return defaultBar
  const duration = result.score.duration
  if (!duration.n) return defaultBar
  return beat(Number(duration.s * duration.n), duration.d)
}

/** Parse every clip in a lane and place its Xenpaper events on the project timeline. */
export const parseProjectNotes = (project: DawProject): ScheduledLaneNote[] => {
  const notes: ScheduledLaneNote[] = []
  for (const lane of project.instrumentLanes) {
    for (const clip of lane.clips) {
      const clipStart = beatToNumber(clip.start)
      for (const event of parseClipNotes(clip.source, beatToNumber(clip.length))) {
        notes.push({
          ...event,
          beat: clipStart + event.beat,
        })
      }
    }
  }
  return notes.sort((left, right) => left.beat - right.beat)
}

const tempoPoints = (project: DawProject) => {
  const points = project.globalTrack.tempoChanges
    .map(({ beat, bpm }) => ({ beat: beatToNumber(beat), bpm }))
    .filter(({ beat, bpm }) => beat >= 0 && bpm > 0)
    .sort((left, right) => left.beat - right.beat)
  if (!points.length || points[0]!.beat > 0) points.unshift({ beat: 0, bpm: 120 })
  return points
}

/** Integrate the piecewise-constant tempo map from beat zero. */
export const projectBeatToSeconds = (project: DawProject, beat: number): number => {
  const points = tempoPoints(project)
  let seconds = 0
  let cursor = 0
  let bpm = points[0]!.bpm
  for (const point of points) {
    if (point.beat <= cursor) {
      bpm = point.bpm
      continue
    }
    if (point.beat >= beat) break
    seconds += ((point.beat - cursor) * 60) / bpm
    cursor = point.beat
    bpm = point.bpm
  }
  return seconds + ((beat - cursor) * 60) / bpm
}

/** Invert the tempo map so the Web Audio clock can drive the beat playhead. */
export const projectSecondsToBeat = (project: DawProject, seconds: number): number => {
  const points = tempoPoints(project)
  let elapsed = 0
  let beat = 0
  let bpm = points[0]!.bpm
  for (const point of points) {
    if (point.beat <= beat) {
      bpm = point.bpm
      continue
    }
    const segment = ((point.beat - beat) * 60) / bpm
    if (elapsed + segment >= seconds) return beat + ((seconds - elapsed) * bpm) / 60
    elapsed += segment
    beat = point.beat
    bpm = point.bpm
  }
  return beat + ((seconds - elapsed) * bpm) / 60
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
        if (note.beat < fromBeat) continue
        endBeat = Math.max(endBeat, note.beat + note.duration)
        const start = projectBeatToSeconds(project, note.beat)
        const end = projectBeatToSeconds(project, note.beat + note.duration)
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
