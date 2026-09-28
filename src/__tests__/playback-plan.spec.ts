import { describe, expect, it } from 'vitest'
import { createPlaybackPlan } from '../daw/playback-plan'
import { beat, createDefaultProject } from '../daw/project'
import {
  compileEffectSettings,
  compileEffectSettingsTimeline,
  parseClipNotes,
  parseProjectScoreNotes,
} from '../daw/score'
import { globalTempoChanges, TempoMap } from '../daw/timeline'
import {
  applyPitchAutomation,
  glissandoCurveDuration,
  xenpaperPitchToPatchDetune,
} from '../daw/web-audio-automation'

describe('DAW playback planning', () => {
  it('compiles ping-pong delay directives into effect config signals', () => {
    expect(compileEffectSettings('@delay(375ms) @feedback(62%) @wet(40%)')).toEqual({
      delayTime: 0.375,
      feedback: 0.62,
      wet: 0.4,
    })
    expect(() => compileEffectSettings('@feedback(120%)')).toThrow('between 0% and 100%')
    expect(() => compileEffectSettings('@delay(4beats)')).toThrow('requires a time value')
  })

  it('allows timed effect directives using the global source meter', () => {
    const source = `# Ping-pong delay configuration
@delay(250ms)
@feedback(55%)
@wet(10%)
;;@wet(70%)`

    const settings = compileEffectSettings(source, { numerator: 3, denominator: 4 })
    expect(settings).toMatchObject({
      delayTime: 0.25,
      feedback: 0.55,
    })
    expect(settings.wet).toBeCloseTo(0.7)
    const timeline = compileEffectSettingsTimeline(source, { numerator: 3, denominator: 4 })
    expect(timeline.map(({ beat, settings }) => ({ beat, wet: settings.wet }))).toEqual([
      { beat: 0, wet: 0.35 },
      { beat: 0, wet: 0.1 },
      { beat: 6, wet: 0.7000000000000001 },
    ])
  })

  it('snapshots effect buses and lane routing in the playback plan', () => {
    const project = createDefaultProject()
    project.effectLanes.push({
      id: 'delay',
      kind: 'effect',
      name: 'Delay',
      patchPreset: 'ping-pong-delay',
      gain: 0.75,
      source: '@delay(500ms) @feedback(50%) @wet(25%)',
    })
    project.instrumentLanes[0]!.effectBusId = 'delay'
    project.instrumentLanes[0]!.clips.push({
      id: 'note',
      start: beat(0),
      length: beat(1),
      source: 'C',
    })

    const plan = createPlaybackPlan(project)
    expect(plan.lanes[0]!.effectBusId).toBe('delay')
    expect(plan.effects).toEqual([
      expect.objectContaining({
        id: 'delay',
        patchPreset: 'ping-pong-delay',
        gain: 0.75,
        config: { delayTime: 0.5, feedback: 0.5, wet: 0.25 },
      }),
    ])
  })

  it('derives tempo changes from the duration-bearing global source', () => {
    const project = createDefaultProject()
    project.globalTrack.source = ';;;;@tempo(200bpm);;;;@tempo(120bpm)'

    expect(
      globalTempoChanges(project.globalTrack.source, project.globalTrack.tempoChanges),
    ).toEqual([
      expect.objectContaining({ beat: beat(0), bpm: 120 }),
      expect.objectContaining({ beat: beat(16), bpm: 200 }),
      expect.objectContaining({ beat: beat(32), bpm: 120 }),
    ])
    expect(TempoMap.fromProject(project).points.map(({ beat, bpm }) => ({ beat, bpm }))).toEqual([
      { beat: 0, bpm: 120 },
      { beat: 16, bpm: 200 },
      { beat: 32, bpm: 120 },
    ])
  })

  it('preserves fractional BPM values emitted as exact fraction labels', () => {
    const project = createDefaultProject()
    project.globalTrack.source = ';@tempo(123.5bpm)'

    expect(TempoMap.fromProject(project).points.map(({ beat, bpm }) => ({ beat, bpm }))).toEqual([
      { beat: 0, bpm: 120 },
      { beat: 4, bpm: 123.5 },
    ])
  })

  it('converts general beats-over-time tempo expressions for playback', () => {
    const project = createDefaultProject()
    project.globalTrack.source = ';@tempo(1beat/100ms)'

    expect(TempoMap.fromProject(project).points.map(({ beat, bpm }) => ({ beat, bpm }))).toEqual([
      { beat: 0, bpm: 120 },
      { beat: 4, bpm: 600 },
    ])
  })

  it('keeps score data C-relative and converts pitch only at the SW Patch boundary', () => {
    const project = createDefaultProject()
    project.instrumentLanes[0]!.clips.push({
      id: 'middle-c',
      start: beat(0),
      length: beat(1),
      source: 'C',
    })

    const scoreNote = parseProjectScoreNotes(project)[0]!
    const playbackNote = createPlaybackPlan(project).lanes[0]!.notes[0]!

    expect(scoreNote.cents).toBe(0)
    expect(playbackNote.pitch.initialValue).toBe(0)
    expect(xenpaperPitchToPatchDetune(playbackNote.pitch.initialValue)).toBe(-900)
  })

  it('snapshots and pre-integrates tempo changes, with the last change at a beat winning', () => {
    const project = createDefaultProject()
    project.globalTrack.tempoChanges = [
      { id: 'slow', beat: beat(0), bpm: 60 },
      { id: 'fast', beat: beat(2), bpm: 120 },
      { id: 'faster', beat: beat(2), bpm: 240 },
    ]
    const tempoMap = TempoMap.fromProject(project)

    expect(tempoMap.beatToSeconds(3)).toBeCloseTo(2.25)
    expect(tempoMap.secondsToBeat(2.25)).toBeCloseTo(3)

    project.globalTrack.tempoChanges[0]!.bpm = 30
    expect(tempoMap.beatToSeconds(3)).toBeCloseTo(2.25)
  })

  it('resumes a held note from its pitch at the playhead without replaying completed glides', () => {
    const project = createDefaultProject()
    project.instrumentLanes[0]!.clips.push({
      id: 'glissando',
      start: beat(0),
      length: beat(2),
      source: '@gliss C G',
    })
    const sourceNote = parseClipNotes('@gliss C G')[0]!
    const plan = createPlaybackPlan(project, 1.5)
    const note = plan.lanes[0]!.notes[0]!

    expect(note.startBeat).toBe(1.5)
    expect(note.endBeat).toBe(2)
    expect(note.pitch.initialValue).toBe(sourceNote.glissando![0]!.to)
    expect(note.pitch.curves).toHaveLength(0)
  })

  it('clips pitch curves at the audible note end', () => {
    const project = createDefaultProject()
    project.instrumentLanes[0]!.clips.push({
      id: 'clipped-glissando',
      start: beat(0),
      length: beat(1, 2),
      source: '@gliss C G',
    })

    const curve = createPlaybackPlan(project).lanes[0]!.notes[0]!.pitch.curves[0]!
    const segment = parseClipNotes('@gliss C G')[0]!.glissando![0]!

    expect(curve.duration).toBeCloseTo(0.25)
    expect(curve.values[curve.values.length - 1]).toBeCloseTo(
      segment.from + (segment.to - segment.from) / 2,
    )
    expect(curve.values[curve.values.length - 1]).toBeLessThan(700)
    expect(Object.isFrozen(curve.values)).toBe(true)
  })

  it('confines detune conversion and inclusive-endpoint workarounds to the audio adapter', () => {
    const values: Array<{ value: number; time: number }> = []
    const curves: Array<{ values: Float32Array; time: number; duration: number }> = []
    applyPitchAutomation(
      {
        setValueAtTime(value, time) {
          values.push({ value, time })
        },
        setValueCurveAtTime(curve, time, duration) {
          curves.push({ values: curve, time, duration })
        },
      },
      {
        initialValue: 0,
        curves: [
          {
            offset: 1,
            duration: 0.72,
            startValue: 100,
            values: [100, 200],
          },
        ],
      },
      10,
    )

    expect(values).toEqual([
      { value: -900, time: 10 },
      { value: -800, time: 11 },
    ])
    expect([...curves[0]!.values]).toEqual([-800, -700])
    expect(curves[0]!.time).toBe(11)
    expect(curves[0]!.duration).toBe(glissandoCurveDuration(0.72))
    expect(curves[0]!.duration).toBeLessThan(0.72)
  })
})
