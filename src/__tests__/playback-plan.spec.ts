import { describe, expect, it } from 'vitest'
import { createPlaybackPlan } from '../daw/playback-plan'
import { beat, createDefaultProject } from '../daw/project'
import { parseClipNotes, parseProjectScoreNotes } from '../daw/score'
import { TempoMap } from '../daw/timeline'
import {
  applyPitchAutomation,
  glissandoCurveDuration,
  xenpaperPitchToPatchDetune,
} from '../daw/web-audio-automation'

describe('DAW playback planning', () => {
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
