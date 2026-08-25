import { describe, expect, it, vi } from 'vitest'

import { Transport } from '../transport'

class MockAudioContext {
  currentTime = 0
  sampleRate = 10
  destination = {} as AudioDestinationNode

  createConstantSource() {
    return {
      addEventListener: (
        _type: 'ended',
        _listener: () => void,
        _options?: AddEventListenerOptions,
      ) => undefined,
      start: (_time?: number) => undefined,
      stop: (_time?: number) => undefined,
    }
  }
}

const tick = (transport: Transport, times = 1) => {
  const inner = transport as unknown as { context: MockAudioContext; onInterval: () => void }
  for (let i = 0; i < times; i++) {
    inner.context.currentTime = i / inner.context.sampleRate
    inner.onInterval()
  }
}

function createTransport() {
  return new Transport(new MockAudioContext() as unknown as AudioContext)
}

describe('Sample-accurate look-ahead transport', () => {
  it('can schedule and fire a single event', () => {
    const calls: number[] = []
    const transport = createTransport()
    const id = transport.scheduleParametric((time: number) => calls.push(time), 0)

    transport.start(0)
    tick(transport, transport.context.sampleRate * 2)

    expect(id).toBeGreaterThan(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBeCloseTo(transport.lookAhead)
  })

  it('reports the audible clock position rather than the scheduling horizon', () => {
    const context = new MockAudioContext()
    const transport = new Transport(context as unknown as AudioContext)

    transport.start(2)
    expect(transport.position).toBeCloseTo(2)

    context.currentTime = 0.1
    expect(transport.position).toBeCloseTo(2)

    context.currentTime = 0.4
    expect(transport.position).toBeCloseTo(2.2)

    transport.stop()
    context.currentTime = 0.9
    expect(transport.position).toBeCloseTo(2.2)
  })

  it('ends notes that lead into a looped section', () => {
    const calls: { which: 'on' | 'off'; time: number }[] = []
    const transport = createTransport()
    const id = transport.scheduleParametricNote({
      noteOn: (time: number) => {
        calls.push({ which: 'on', time })
        return (end: number) => {
          calls.push({ which: 'off', time: end })
          return end + 0.5
        }
      },
      when: 0.5,
      duration: 1,
    })

    transport.loop = true
    transport.loopStart = 1
    transport.loopEnd = 2
    transport.start(0)
    tick(transport, transport.context.sampleRate * 5)

    expect(id).toBeGreaterThan(0)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.which).toBe('on')
    expect(calls[0]!.time).toBeCloseTo(0.5 + transport.lookAhead)
    expect(calls[1]!.which).toBe('off')
    expect(calls[1]!.time).toBeCloseTo(1.5 + transport.lookAhead)
  })

  it('uses setTimeout for one-shot events when the fallback is enabled', () => {
    vi.useFakeTimers()

    const calls: string[] = []
    const transport = new Transport(new MockAudioContext() as unknown as AudioContext, {
      useSetTimeoutFallback: true,
    })
    transport.scheduleEvent(() => calls.push('event'), 0)

    transport.start(0)
    vi.advanceTimersByTime(199)

    expect(calls).toHaveLength(0)

    vi.advanceTimersByTime(1)

    expect(calls).toEqual(['event'])
    transport.stop()
    vi.useRealTimers()
  })

  it('dispatches ended events exactly once when stopped', () => {
    const calls: string[] = []
    const transport = createTransport()
    transport.addEventListener('ended', () => calls.push('ended'))

    transport.start(0)
    transport.stop()
    const inner = transport as unknown as { onInterval: () => void }
    inner.onInterval()
    transport.stop()

    expect(calls).toEqual(['ended'])
  })

  it('wraps start offsets back into the active loop range', () => {
    const transport = createTransport()

    transport.loop = true
    transport.loopStart = 1
    transport.loopEnd = 2
    transport.start(2.5)

    expect(transport.position).toBeCloseTo(1.5)
  })

  it('repeats notes that lead out of a looped section', () => {
    const calls: { which: 'on' | 'off'; time: number }[] = []
    const transport = createTransport()
    const id = transport.scheduleParametricNote({
      noteOn: (time: number) => {
        calls.push({ which: 'on', time })
        return (end: number) => {
          calls.push({ which: 'off', time: end })
          return end + 0.5
        }
      },
      when: 1.5,
      duration: 1,
    })

    transport.loop = true
    transport.loopStart = 1
    transport.loopEnd = 2
    transport.start(0)
    tick(transport, transport.context.sampleRate * 3)

    expect(id).toBeGreaterThan(0)
    expect(calls).toHaveLength(4)
    expect(calls[0]!.which).toBe('on')
    expect(calls[0]!.time).toBeCloseTo(1.5 + transport.lookAhead)
    expect(calls[1]!.which).toBe('off')
    expect(calls[1]!.time).toBeCloseTo(2.5 + transport.lookAhead)
    expect(calls[2]!.which).toBe('on')
    expect(calls[2]!.time).toBeCloseTo(2.5 + transport.lookAhead)
    expect(calls[3]!.which).toBe('off')
    expect(calls[3]!.time).toBeCloseTo(3.5 + transport.lookAhead)
  })

  it('does not schedule events beyond a finite end time', () => {
    const calls: string[] = []
    const transport = new Transport(new MockAudioContext() as unknown as AudioContext, {
      interval: 2,
    })
    transport.endTime = 0.5
    transport.scheduleParametric(() => calls.push('inside'), 0.4)
    transport.scheduleParametric(() => calls.push('outside'), 0.5)
    transport.scheduleParametric(() => calls.push('far outside'), 1)

    transport.start(0)

    expect(calls).toEqual(['inside'])
  })

  it('reports natural completion after the last look-ahead event can fire', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const transport = new Transport(new MockAudioContext() as unknown as AudioContext, {
      interval: 2,
      useSetTimeoutFallback: true,
    })
    transport.endTime = 0.5
    transport.scheduleEvent(() => calls.push('event'), 0.4)
    transport.addEventListener('ended', () => calls.push('ended'))

    transport.start(0)
    vi.advanceTimersByTime(599)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual(['event'])
    vi.advanceTimersByTime(99)
    expect(calls).toEqual(['event'])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual(['event', 'ended'])

    vi.useRealTimers()
  })

  it('schedules notes chronologically within a look-ahead interval', () => {
    const calls: string[] = []
    const transport = new Transport(new MockAudioContext() as unknown as AudioContext, {
      interval: 2,
    })

    transport.scheduleParametricNote({
      noteOn: () => {
        calls.push('late on')
        return (end) => {
          calls.push('late off')
          return end
        }
      },
      when: 1,
      duration: 0.1,
    })
    transport.scheduleParametricNote({
      noteOn: () => {
        calls.push('early on')
        return (end) => {
          calls.push('early off')
          return end
        }
      },
      when: 0,
      duration: 0.1,
    })

    transport.start(0)

    expect(calls).toEqual(['early on', 'early off', 'late on', 'late off'])
  })
})
