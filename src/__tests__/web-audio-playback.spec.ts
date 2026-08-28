import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayableDrumkitPatch, PlayableSynthPatch } from '../../sw-patch'
import { DawAudioEngine } from '../daw/audio-engine'
import type { PlaybackPlan } from '../daw/playback-plan'
import { TempoMap } from '../daw/timeline'
import { WebAudioPlaybackSession } from '../daw/web-audio-playback'

class MockAudioParam {
  value = 0
  readonly values: Array<{ value: number; time: number }> = []
  readonly curves: Array<{ values: number[]; time: number; duration: number }> = []
  readonly cancellations: number[] = []

  setValueAtTime(value: number, time: number): MockAudioParam {
    this.value = value
    this.values.push({ value, time })
    return this
  }

  setValueCurveAtTime(values: Float32Array, time: number, duration: number): MockAudioParam {
    this.curves.push({ values: [...values], time, duration })
    return this
  }

  cancelScheduledValues(time: number): MockAudioParam {
    this.cancellations.push(time)
    return this
  }
}

class MockGainNode {
  static readonly instances: MockGainNode[] = []
  readonly gain = new MockAudioParam()
  readonly connections: unknown[] = []
  disconnected = false

  constructor(
    readonly context: BaseAudioContext,
    options: GainOptions = {},
  ) {
    this.gain.value = options.gain ?? 1
    MockGainNode.instances.push(this)
  }

  connect(target: unknown): unknown {
    this.connections.push(target)
    return target
  }

  disconnect(): void {
    this.disconnected = true
  }
}

class MockConstantSource extends EventTarget {
  readonly offset = new MockAudioParam()
  readonly starts: number[] = []
  readonly stops: number[] = []
  disconnected = false
  targetedConnectionActive = false

  start(time = 0): void {
    this.starts.push(time)
  }

  stop(time = 0): void {
    this.stops.push(time)
  }

  disconnect(): void {
    this.disconnected = true
  }
}

class MockAudioContext {
  currentTime = 0
  readonly sampleRate = 10
  readonly destination = {} as AudioDestinationNode
  readonly sources: MockConstantSource[] = []
  readonly close = vi.fn<() => Promise<void>>(() => Promise.resolve())

  createConstantSource(): ConstantSourceNode {
    const source = new MockConstantSource()
    this.sources.push(source)
    return source as unknown as ConstantSourceNode
  }
}

const createPlan = (): PlaybackPlan => ({
  startBeat: 0,
  startTime: 0,
  endBeat: 1,
  endTime: 1,
  tempoMap: new TempoMap([]),
  lanes: [
    {
      id: 'lead',
      name: 'Lead',
      patchSource: 'custom patch',
      oscillatorType: 'triangle',
      gain: 0.5,
      notes: [
        {
          startBeat: 0,
          endBeat: 1,
          when: 0,
          duration: 1,
          velocity: 0.8,
          envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.3 },
          pitch: {
            initialValue: 0,
            curves: [
              {
                offset: 0.5,
                duration: 0.5,
                startValue: 100,
                values: [100, 200],
              },
            ],
          },
        },
      ],
    },
  ],
})

beforeEach(() => {
  MockGainNode.instances.length = 0
  vi.stubGlobal('GainNode', MockGainNode)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Web Audio playback session', () => {
  it('uses timeout scheduling instead of Web Audio timing sources on Apple platforms', () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    const context = new MockAudioContext()
    const session = new WebAudioPlaybackSession(context as unknown as AudioContext, createPlan(), {
      patchFactory: () =>
        ({ on: () => (end: number) => end, dispose: () => {} }) as unknown as PlayableSynthPatch,
    })

    session.start()

    // The only source belongs to the synth voice; the transport itself uses timeouts.
    expect(context.sources).toHaveLength(1)
    session.stop()
  })

  it('dispatches named drum notes without creating pitch signals', () => {
    const context = new MockAudioContext()
    const hit = vi.fn<PlayableDrumkitPatch['hit']>(() => (end) => end + 0.1)
    const dispose = vi.fn<() => void>()
    const drumkitFactory = vi.fn(
      () => ({ drumNames: ['bd'], hit, dispose, ready: Promise.resolve() }) as PlayableDrumkitPatch,
    )
    const pitchedPlan = createPlan()
    const plan: PlaybackPlan = {
      ...pitchedPlan,
      lanes: [
        {
          ...pitchedPlan.lanes[0]!,
          kind: 'drum',
          patchSource: 'drumkit',
          notes: [{ ...pitchedPlan.lanes[0]!.notes[0]!, sample: 'bd' }],
        },
      ],
    }
    const session = new WebAudioPlaybackSession(context as unknown as AudioContext, plan, {
      drumkitFactory,
    })

    session.start()

    expect(drumkitFactory).toHaveBeenCalledOnce()
    expect(hit).toHaveBeenCalledWith('bd', MockGainNode.instances[0], 0.2, 0.4)
    // The transport owns one timing source; drum playback adds no pitch source.
    expect(context.sources).toHaveLength(1)
    session.stop()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('translates one pure plan into a disposable SW Patch voice', () => {
    const context = new MockAudioContext()
    const noteOff = vi.fn<(end: number) => number>((end) => end + 0.5)
    const on = vi.fn<PlayableSynthPatch['on']>(() => noteOff)
    const dispose = vi.fn<() => void>()
    const patchFactory = vi.fn<() => PlayableSynthPatch>(
      () => ({ on, dispose, ready: Promise.resolve() }) as PlayableSynthPatch,
    )
    const session = new WebAudioPlaybackSession(context as unknown as AudioContext, createPlan(), {
      patchFactory,
    })

    session.start()

    expect(patchFactory).toHaveBeenCalledWith('custom patch', context, {
      config: { oscillatorType: 'triangle' },
    })
    expect(on).toHaveBeenCalledOnce()
    const [destination, start, pitch, velocity, ...envelope] = on.mock.calls[0]!
    const pitchSource = pitch as unknown as MockConstantSource
    expect(destination).toBe(MockGainNode.instances[0])
    expect(start).toBeCloseTo(0.2)
    expect(velocity).toBeCloseTo(0.4)
    expect(envelope).toEqual([0.1, 0.2, 0.7, 0.3])
    expect(pitchSource.offset.values).toEqual([
      { value: -900, time: 0.2 },
      { value: -800, time: 0.7 },
    ])
    expect(pitchSource.offset.curves[0]!.values).toEqual([-800, -700])
    expect(noteOff).toHaveBeenCalledWith(1.2)
    expect(pitchSource.stops).toEqual([1.7])

    context.currentTime = 0.4
    expect(session.positionTime).toBeCloseTo(0.2)
    session.stop()

    expect(dispose).toHaveBeenCalledOnce()
    expect(pitchSource.disconnected).toBe(true)
    expect(MockGainNode.instances[0]!.disconnected).toBe(true)
    expect(() => session.start()).toThrow(/one-shot/)
  })

  it('tears down its pitch source when a patch violates the note-off contract', () => {
    const context = new MockAudioContext()
    const dispose = vi.fn<() => void>()
    const session = new WebAudioPlaybackSession(context as unknown as AudioContext, createPlan(), {
      patchFactory: () =>
        ({ on: () => () => Number.NaN, dispose }) as unknown as PlayableSynthPatch,
    })

    expect(() => session.start()).toThrow(/finite cutoff/)

    expect(context.sources[0]!.stops).toEqual([1.2])
    expect(context.sources[0]!.disconnected).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    expect(MockGainNode.instances[0]!.disconnected).toBe(true)
  })

  it('normalizes a unit-bearing patch cutoff before validating and scheduling it', () => {
    const context = new MockAudioContext()
    const cutoff = { valueOf: () => 1.7 }
    const session = new WebAudioPlaybackSession(context as unknown as AudioContext, createPlan(), {
      patchFactory: () =>
        ({ on: () => () => cutoff, dispose: () => {} }) as unknown as PlayableSynthPatch,
    })

    expect(() => session.start()).not.toThrow()
    expect(context.sources[0]!.stops).toEqual([1.7])
  })

  it('waits for the release tail before reporting natural completion', () => {
    vi.useFakeTimers()
    const context = new MockAudioContext()
    const dispose = vi.fn<() => void>()
    const onEnded = vi.fn<() => void>()
    const session = new WebAudioPlaybackSession(context as unknown as AudioContext, createPlan(), {
      patchFactory: () =>
        ({ on: () => (end: number) => end + 0.5, dispose }) as unknown as PlayableSynthPatch,
      onEnded,
    })
    session.start()

    context.currentTime = 1.6
    session.transport.stop()
    vi.advanceTimersByTime(99)
    expect(onEnded).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onEnded).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('lets patches remove targeted pitch connections before disconnecting the source', () => {
    const context = new MockAudioContext()
    const session = new WebAudioPlaybackSession(context as unknown as AudioContext, createPlan(), {
      patchFactory: () =>
        ({
          on: (_destination: AudioNode, _start: number, pitch: AudioNode) => {
            const source = pitch as unknown as MockConstantSource
            source.targetedConnectionActive = true
            return (end: number) => end
          },
          dispose: () => {
            const source = context.sources[0]!
            if (source.disconnected && source.targetedConnectionActive) {
              throw new DOMException('The given AudioParam is not connected.', 'InvalidAccessError')
            }
            source.targetedConnectionActive = false
          },
        }) as unknown as PlayableSynthPatch,
    })

    session.start()

    expect(() => session.stop()).not.toThrow()
    expect(context.sources[0]!.targetedConnectionActive).toBe(false)
    expect(context.sources[0]!.disconnected).toBe(true)
  })
})

describe('DAW audio context ownership', () => {
  it('does not close a context supplied by its caller', () => {
    const context = new MockAudioContext()
    const engine = new DawAudioEngine(context as unknown as AudioContext)

    engine.dispose()

    expect(context.close).not.toHaveBeenCalled()
  })

  it('closes the context it creates itself', () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    const engine = new DawAudioEngine()
    const context = engine.context as unknown as MockAudioContext

    engine.dispose()

    expect(context.close).toHaveBeenCalledOnce()
  })
})
