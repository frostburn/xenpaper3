import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

type NoteOff = (stop?: number) => number
type MockGainNode = {
  connect: (to: AudioNode) => MockGainNode
  gain: object
}

class MockGainNodeConstructor {
  gain = {}
  connect = vi.fn<(to: AudioNode) => MockGainNodeConstructor>(() => this)
}

const { effectConnect, synthOn } = vi.hoisted(() => ({
  effectConnect: vi.fn<(to: AudioNode) => void>(),
  synthOn: vi.fn<(...arguments_: unknown[]) => NoteOff>(),
}))

vi.mock('../../sw-patch', () => ({
  createPatch: (source: string) =>
    source.includes('delayTime') ? { connect: effectConnect } : { on: synthOn },
  registerMathWorklets: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

import App from '../App.vue'

const contexts: MockAudioContext[] = []
const sources: MockConstantSourceNode[] = []

class MockAudioContext {
  state: AudioContextState = 'suspended'
  currentTime = 1
  destination = {} as AudioDestinationNode
  resume = vi.fn<() => Promise<void>>(async () => {
    this.state = 'running'
  })
  close = vi.fn<() => Promise<void>>(async () => {
    this.state = 'closed'
  })

  constructor() {
    contexts.push(this)
  }

  createGain() {
    const node: MockGainNode = {
      connect: vi.fn<(to: AudioNode) => MockGainNode>(() => node),
      gain: {},
    }
    return node
  }
}

class MockConstantSourceNode {
  start = vi.fn<() => void>()
  stop = vi.fn<(when?: number) => void>()
  offset = {
    setTargetAtTime: vi.fn<(value: number, startTime: number, timeConstant: number) => void>(),
  }

  constructor() {
    sources.push(this)
  }
}

const dispatchKey = (type: 'keydown' | 'keyup', keyCode: number) =>
  window.dispatchEvent(new KeyboardEvent(type, { keyCode }))

beforeEach(() => {
  contexts.length = 0
  sources.length = 0
  synthOn.mockReset()
  effectConnect.mockReset()
  synthOn.mockReturnValue(vi.fn<NoteOff>(() => 2))
  vi.stubGlobal('AudioContext', MockAudioContext)
  vi.stubGlobal('GainNode', MockGainNodeConstructor)
  vi.stubGlobal('ConstantSourceNode', MockConstantSourceNode)
})

describe('App', () => {
  it('mounts and renders properly', () => {
    const wrapper = mount(App)
    expect(wrapper.text()).toContain('You did it!')
    wrapper.unmount()
  })

  it('resumes a suspended context before starting a note', async () => {
    const wrapper = mount(App)

    dispatchKey('keydown', 65)
    await flushPromises()
    const context = contexts[0]!
    const source = sources[5]!
    expect(context.resume).toHaveBeenCalledOnce()
    expect(source.start).toHaveBeenCalledOnce()
    expect(synthOn).toHaveBeenCalledOnce()
    expect(synthOn.mock.calls[0]?.slice(4)).toEqual([
      0.01,
      0.5,
      0.1,
      sources[3],
      sources[4],
    ])
    expect(context.resume.mock.invocationCallOrder[0]!).toBeLessThan(
      source.start.mock.invocationCallOrder[0]!,
    )
    wrapper.unmount()
  })

  it('releases active notes when the window loses focus', async () => {
    const off = vi.fn<NoteOff>(() => 2)
    synthOn.mockReturnValue(off)
    const wrapper = mount(App)
    dispatchKey('keydown', 65)
    await flushPromises()

    window.dispatchEvent(new Event('blur'))

    expect(off).toHaveBeenCalledWith(1.01)
    expect(sources[5]!.stop).toHaveBeenCalledWith(2)
    wrapper.unmount()
  })

  it('converts the filter Q slider from decibels to a level signal', async () => {
    const wrapper = mount(App)

    await wrapper.get('#filter-q').setValue('15')

    expect(sources[3]!.offset.setTargetAtTime).toHaveBeenLastCalledWith(
      10 ** (15 / 20),
      1.01,
      0.01,
    )
    expect(sources[4]!.offset.setTargetAtTime).toHaveBeenLastCalledWith(
      10 ** ((10 + -15) / 20),
      1.01,
      0.01,
    )
    wrapper.unmount()
  })

  it('removes listeners, releases notes, and closes its context on unmount', async () => {
    const off = vi.fn<NoteOff>(() => 2)
    synthOn.mockReturnValue(off)
    const wrapper = mount(App)
    dispatchKey('keydown', 65)
    await flushPromises()

    wrapper.unmount()
    dispatchKey('keydown', 66)

    expect(off).toHaveBeenCalledOnce()
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
    expect(synthOn).toHaveBeenCalledOnce()
  })
})
