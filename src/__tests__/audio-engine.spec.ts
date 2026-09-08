import { afterEach, describe, expect, it, vi } from 'vitest'
import * as swPatch from '../../sw-patch'
import * as swSeq from '../../sw-seq'
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
  it('loads sampled drumkits and passes them to the playback session', async () => {
    const project = drumProject()
    const lane = project.instrumentLanes[0]!
    if (lane.kind !== 'drum') throw new Error('Expected drum lane')
    lane.drumkit = {
      type: 'samples',
      url: 'https://github.com/example/drums/blob/main/strudel.json',
      strudelJson: { bd: ['bd.wav'] },
    }
    const sampledKit = { dispose: vi.fn<() => void>() } as unknown as swSeq.SampledDrumkit
    const load = vi.spyOn(swSeq, 'loadSampledDrumkit').mockResolvedValue(sampledKit)
    const register = vi.spyOn(swPatch, 'registerMathWorklets')
    const context = {} as AudioContext
    const engine = new DawAudioEngine(context)

    await engine.play(project)

    expect(load).toHaveBeenCalledWith(
      context,
      { bd: ['bd.wav'] },
      { baseUrl: new URL('https://raw.githubusercontent.com/example/drums/main/strudel.json') },
    )
    expect(register).not.toHaveBeenCalled()
    const options = vi.mocked(WebAudioPlaybackSession).mock.calls[0]![2]!
    expect(options.sampledDrumkits?.get('drum-1')).toBe(sampledKit)
    engine.dispose()
  })

  it('loads sampled instruments and passes them to the playback session', async () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    if (lane.kind !== 'instrument') throw new Error('Expected instrument lane')
    lane.clips.push({ id: 'note', start: beat(0), length: beat(1), source: '0' })
    lane.sampledInstrument = {
      url: 'https://github.com/example/piano/blob/main/samples.json',
      doughJson: { _base: './audio/', piano: { C4: 'C4.mp3' } },
      instrument: 'piano',
    }
    const sampled = { dispose: vi.fn<() => void>() } as unknown as swSeq.SampledInstrument
    const load = vi.spyOn(swSeq, 'loadSampledInstrument').mockResolvedValue(sampled)
    const engine = new DawAudioEngine({} as AudioContext)

    await engine.play(project)

    expect(load).toHaveBeenCalledWith(engine.context, lane.sampledInstrument.doughJson, 'piano', {
      baseUrl: new URL('https://raw.githubusercontent.com/example/piano/main/samples.json'),
    })
    const options = vi.mocked(WebAudioPlaybackSession).mock.calls[0]![2]!
    expect(options.sampledInstruments?.get(lane.id)).toBe(sampled)
    engine.dispose()
  })

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

  it('cancels pending preparation when a newer playback plan is invalid', async () => {
    const registration = deferred()
    vi.spyOn(swPatch, 'registerMathWorklets').mockReturnValue(registration.promise)
    const engine = new DawAudioEngine({} as AudioContext)
    const older = engine.play(drumProject())
    const invalidProject = createDefaultProject()
    invalidProject.globalTrack.source = '{'

    await expect(engine.play(invalidProject)).rejects.toThrow(/end of input/)
    registration.resolve()
    await older

    expect(WebAudioPlaybackSession).not.toHaveBeenCalled()
    engine.dispose()
  })

  it('keeps the audible session when replacement compilation fails', async () => {
    const engine = new DawAudioEngine({} as AudioContext)
    await engine.play(createDefaultProject())
    const session = vi.mocked(WebAudioPlaybackSession).mock.results[0]!.value
    const invalidProject = createDefaultProject()
    invalidProject.globalTrack.source = '{'

    await expect(engine.play(invalidProject)).rejects.toThrow(/end of input/)

    expect(session.stop).not.toHaveBeenCalled()
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
