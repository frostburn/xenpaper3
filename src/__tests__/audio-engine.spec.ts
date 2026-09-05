import { afterEach, describe, expect, it, vi } from 'vitest'
import * as swPatch from '../../sw-patch'
import { DawAudioEngine } from '../daw/audio-engine'
import { beat, createDefaultProject, createDrumLane } from '../daw/project'
import { WebAudioPlaybackSession } from '../daw/web-audio-playback'
import { deferred } from './deferred'

vi.mock('../daw/web-audio-playback', () => {
  class MockSession {
    start = vi.fn<() => void>()
    stop = vi.fn<() => void>()
  }
  return { WebAudioPlaybackSession: vi.fn<typeof MockSession>(MockSession) }
})

const drumProject = () => {
  const project = createDefaultProject()
  const lane = createDrumLane(project)
  lane.clips.push({ id: 'beat', start: beat(0), length: beat(1), source: 'bd' })
  project.instrumentLanes = [lane]
  return project
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(WebAudioPlaybackSession).mockClear()
})

describe('DAW playback preparation', () => {
  it('cancels a pending play when stopped during worklet registration', async () => {
    const registration = deferred()
    vi.spyOn(swPatch, 'registerMathWorklets').mockReturnValue(registration.promise)
    const engine = new DawAudioEngine({} as AudioContext)
    const pending = engine.play(drumProject())

    engine.stop()
    registration.resolve()
    await pending

    expect(WebAudioPlaybackSession).not.toHaveBeenCalled()
  })

  it('does not let an older drum request replace a newer playback session', async () => {
    const registration = deferred()
    vi.spyOn(swPatch, 'registerMathWorklets').mockReturnValue(registration.promise)
    const engine = new DawAudioEngine({} as AudioContext)
    const older = engine.play(drumProject())
    await engine.play(createDefaultProject(), 4)

    registration.resolve()
    await older

    expect(WebAudioPlaybackSession).toHaveBeenCalledOnce()
    expect(vi.mocked(WebAudioPlaybackSession).mock.calls[0]![1].startBeat).toBe(4)
    engine.dispose()
  })

  it('does not create a session after disposal during preparation', async () => {
    const registration = deferred()
    vi.spyOn(swPatch, 'registerMathWorklets').mockReturnValue(registration.promise)
    const engine = new DawAudioEngine({} as AudioContext)
    const pending = engine.play(drumProject())

    engine.dispose()
    registration.resolve()
    await pending

    expect(WebAudioPlaybackSession).not.toHaveBeenCalled()
    await expect(engine.play(createDefaultProject())).rejects.toThrow('disposed')
  })
})
