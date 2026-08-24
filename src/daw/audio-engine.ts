import { expandToBeatEvents, parse } from '../../xenpaper-lang'
import { createPatch, type SynthPatch } from '../../sw-patch'
import { Transport } from '../../sw-seq'
import DEFAULT_PATCH_SOURCE from '../patches/default.swpatch?raw'
import { beatToNumber, type DawProject } from './project'

type PatchSynth = SynthPatch & {
  on(destination: AudioNode, start: number, pitch: AudioNode, velocity: number): (end: number) => number
}

export interface ScheduledLaneNote {
  readonly beat: number
  readonly duration: number
  readonly cents: number
  readonly velocity: number
}

/** Parse every clip in a lane and place its Xenpaper events on the project timeline. */
export const parseProjectNotes = (project: DawProject): ScheduledLaneNote[] => {
  const notes: ScheduledLaneNote[] = []
  for (const lane of project.instrumentLanes) {
    for (const clip of lane.clips) {
      const result = expandToBeatEvents(parse(clip.source))
      const errors = result.diagnostics.filter(({ severity }) => severity === 'error')
      if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))
      if (!('score' in result)) continue
      const clipStart = beatToNumber(clip.start)
      const clipEnd = clipStart + beatToNumber(clip.length)
      for (const event of result.score.events) {
        if (event.kind !== 'note') continue
        const beat = clipStart + event.start.valueOf()
        if (beat >= clipEnd) continue
        notes.push({
          beat,
          duration: Math.min(event.duration.valueOf(), clipEnd - beat),
          cents: event.pitch.value.valueOf(),
          velocity: event.dynamic.valueOf(),
        })
      }
    }
  }
  return notes.sort((left, right) => left.beat - right.beat)
}

const secondsPerBeat = (project: DawProject) =>
  60 / (project.globalTrack.tempoChanges[0]?.bpm ?? 120)

/** One disposable Web Audio playback session backed by sw-seq and default.swpatch. */
export class DawAudioEngine extends EventTarget {
  readonly context: AudioContext
  private readonly transport: Transport
  private readonly output: GainNode
  private readonly synths: PatchSynth[] = []
  private pitchSignals: ConstantSourceNode[] = []
  private beatSeconds = 0.5

  constructor(context = new AudioContext({ latencyHint: 'interactive' })) {
    super()
    this.context = context
    this.transport = new Transport(context)
    this.output = new GainNode(context, { gain: 0.35 })
    this.output.connect(context.destination)
    this.transport.addEventListener('ended', () => this.dispatchEvent(new Event('ended')))
  }

  play(project: DawProject, fromBeat = 0): void {
    this.stop()
    const beatSeconds = secondsPerBeat(project)
    this.beatSeconds = beatSeconds
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
        this.transport.scheduleParametricNote({
          when: note.beat * beatSeconds,
          duration: note.duration * beatSeconds,
          noteOn: (time) => {
            const pitch = new ConstantSourceNode(this.context, { offset: note.cents })
            this.pitchSignals.push(pitch)
            pitch.start(time)
            const off = synth.on(this.output, time, pitch, note.velocity)
            return (end) => {
              const tail = off(end)
              pitch.stop(tail)
              return tail
            }
          },
        })
      }
    }
    this.transport.endTime = endBeat * beatSeconds
    this.transport.start(fromBeat * beatSeconds)
  }

  get positionBeats(): number {
    return this.transport.position / this.beatSeconds
  }

  stop(): void {
    this.transport.stop()
    this.transport.clearAll()
    for (const pitch of this.pitchSignals) pitch.disconnect()
    this.pitchSignals = []
    for (const synth of this.synths) synth.dispose()
    this.synths.length = 0
  }

  dispose(): void {
    this.stop()
    this.output.disconnect()
  }
}
