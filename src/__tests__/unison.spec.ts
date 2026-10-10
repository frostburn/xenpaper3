import { describe, expect, it, vi } from 'vitest'
import {
  beat,
  createDefaultProject,
  parseDawProject,
  serializeDawProject,
  type PitchedInstrumentLane,
} from '../daw/project'
import { createPlaybackPlan } from '../daw/playback-plan'
import { compileLaneSourceInitialization } from '../daw/score'
import type { AudioParamAutomationTarget } from '../daw/web-audio-automation'
import { applySpreadAutomation } from '../daw/spread-automation'

function projectWithUnison(source = '') {
  const project = createDefaultProject()
  project.globalTrack.source = ''
  const lane = project.instrumentLanes[0]! as PitchedInstrumentLane
  lane.instrument = {
    type: 'patch',
    patchPreset: 'unison',
    oscillatorType: 'rich',
    numberOfVoices: 7,
  }
  lane.source = source
  lane.clips = [{ id: 'test', start: beat(0), length: beat(16), source: 'C '.repeat(16) }]
  return project
}

describe('Unison lane automation', () => {
  it('round trips fixed voices and rejects invalid voices and aperiodic waves', () => {
    const project = projectWithUnison()
    expect(parseDawProject(serializeDawProject(project))).toEqual(project)
    const lane = project.instrumentLanes[0]! as PitchedInstrumentLane
    for (const numberOfVoices of [0, -1, 1.5, 33, Infinity]) {
      lane.instrument = {
        type: 'patch',
        patchPreset: 'unison',
        oscillatorType: 'rich',
        numberOfVoices,
      }
      expect(() => serializeDawProject(project)).toThrow('Invalid Xenpaper project file')
    }
    lane.instrument = {
      type: 'patch',
      patchPreset: 'unison',
      oscillatorType: 'piano',
      numberOfVoices: 5,
    }
    expect(() => serializeDawProject(project)).toThrow('Invalid Xenpaper project file')
  })

  it.each(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'])(
    'plans %s cent ramps and resumes inside a chained ramp',
    (easing) => {
      const project = projectWithUnison(
        `@ramp(${easing}) @spread(0c) ; @ramp @spread(40c) ; @spread(10c) ;`,
      )
      const lane = createPlaybackPlan(project).lanes[0]!
      if (lane.kind !== 'instrument') throw new Error('Expected pitched lane')
      expect(lane.spread!.initialValue).toBe(0)
      expect(lane.spread!.curves).toHaveLength(2)
      expect(lane.spread!.curves[0]).toMatchObject({ offset: 0, duration: 2, startValue: 0 })
      expect(lane.spread!.curves[0]!.values.slice(-1)[0]).toBe(40)
      const resumed = createPlaybackPlan(project, 6).lanes[0]!
      if (resumed.kind !== 'instrument') throw new Error('Expected pitched lane')
      expect(resumed.spread!.initialValue).toBe(25)
      expect(resumed.spread!.curves[0]).toMatchObject({ offset: 0, duration: 1, startValue: 25 })
      expect(resumed.spread!.curves[0]!.values.slice(-1)[0]).toBe(10)
    },
  )

  it('follows project tempo changes and resumes with the prevailing cent value', () => {
    const project = projectWithUnison('@ramp @spread(0c) ;; @spread(40c) ;')
    project.globalTrack.source = '; @tempo(60bpm)'
    const lane = createPlaybackPlan(project, 2).lanes[0]!
    if (lane.kind !== 'instrument') throw new Error('Expected pitched lane')
    expect(lane.spread!.initialValue).toBe(10)
    expect(lane.spread!.curves[0]!.duration).toBe(5)
    expect(lane.spread!.curves[0]!.values.slice(-1)[0]).toBe(40)
  })

  it('rejects overlapping ramps for the shared lane signal', () => {
    const project = projectWithUnison(
      '(@ramp @spread(0c) ; @spread(40c), @ramp @spread(10c) ; @spread(20c))',
    )
    expect(() => createPlaybackPlan(project)).toThrow('Overlapping @ramp segments for @spread')
  })

  it('rejects wrong units, negative values and unsupported argument shapes', () => {
    for (const source of [
      '@spread(20)',
      '@spread(20Hz)',
      '@spread(-2c)',
      '@spread(2c, -1s)',
      '@spread(2c, 3c)',
      '@spread()',
      '@spread(voice: 5)',
    ])
      expect(() => compileLaneSourceInitialization(source)).toThrow('@spread')
  })

  it('schedules cent curves without pitch conversion or steps inside a curve', () => {
    const target = {
      setValueAtTime: vi.fn<AudioParamAutomationTarget['setValueAtTime']>(),
      setValueCurveAtTime: vi.fn<AudioParamAutomationTarget['setValueCurveAtTime']>(),
    }
    applySpreadAutomation(
      target,
      {
        initialValue: 0,
        curves: [{ offset: 0, duration: 2, startValue: 0, values: [0, 20, 40] }],
        changes: [
          { when: 1, value: 0 },
          { when: 2, value: 40 },
        ],
      },
      10,
      0,
    )
    expect(target.setValueAtTime.mock.calls).toEqual([
      [40, 12],
      [0, 10],
      [0, 10],
    ])
    expect([...target.setValueCurveAtTime.mock.calls[0]![0]]).toEqual([0, 20, 40])
    expect(target.setValueCurveAtTime.mock.calls[0]![2]).toBeLessThan(2)
  })
})
