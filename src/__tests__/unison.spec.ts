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
      expect(() => serializeDawProject(project)).toThrow()
    }
    lane.instrument = {
      type: 'patch',
      patchPreset: 'unison',
      oscillatorType: 'piano',
      numberOfVoices: 5,
    }
    expect(() => serializeDawProject(project)).toThrow()
  })

  it('plans timed cent ramps and resumes inside an interrupted ramp', () => {
    const project = projectWithUnison('@spread(0c) ; @spread(40c, 4s) ; @spread(10c, 2s) ;')
    const plan = createPlaybackPlan(project)
    const lane = plan.lanes[0]!
    if (lane.kind !== 'instrument') throw new Error('Expected pitched lane')
    expect(lane.spread).toEqual({
      initialValue: 0,
      changes: [
        { when: 2, value: 40, duration: 4 },
        { when: 4, value: 10, duration: 2 },
      ],
    })
    const resumed = createPlaybackPlan(project, 10).lanes[0]!
    if (resumed.kind !== 'instrument') throw new Error('Expected pitched lane')
    expect(resumed.spread).toEqual({
      initialValue: 15,
      changes: [{ when: 5, value: 10, duration: 1 }],
    })
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

  it('schedules ramps with no pitch reference offset and holds interrupted ramps', () => {
    const target = {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    }
    applySpreadAutomation(
      target,
      {
        initialValue: 0,
        changes: [
          { when: 2, value: 40, duration: 4 },
          { when: 4, value: 10, duration: 2 },
        ],
      },
      10,
      0,
    )
    expect(target.setValueAtTime.mock.calls).toEqual([
      [0, 10],
      [0, 12],
      [20, 14],
    ])
    expect(target.cancelScheduledValues).toHaveBeenCalledWith(16)
    expect(target.linearRampToValueAtTime.mock.calls).toEqual([
      [40, 16],
      [20, 14],
      [10, 16],
    ])
  })
})
