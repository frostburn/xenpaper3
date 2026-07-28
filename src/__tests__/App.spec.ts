import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

type NoteOff = (stop?: number) => number

const { synthOn } = vi.hoisted(() => ({ synthOn: vi.fn<() => NoteOff>() }))

vi.mock('../../sw-patch', () => ({
  createPatch: () => ({ on: synthOn }),
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
    const node = { connect: vi.fn<(to: AudioNode) => AudioNode>(() => node), gain: {} }
    return node
  }
}

class MockConstantSourceNode {
  start = vi.fn<() => void>()
  stop = vi.fn<(when?: number) => void>()

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
  synthOn.mockReturnValue(vi.fn<NoteOff>(() => 2))
  vi.stubGlobal('AudioContext', MockAudioContext)
  vi.stubGlobal('ConstantSourceNode', MockConstantSourceNode)
})

describe('App', () => {
  it('mounts and renders properly', () => {
    const wrapper = mount(App)
    expect(wrapper.text()).toContain('You did it!')
    wrapper.unmount()
  })

  it('resumes a suspended context before starting a note', () => {
    const wrapper = mount(App)

    dispatchKey('keydown', 65)
    const context = contexts[0]!
    const source = sources[0]!
    expect(context.resume).toHaveBeenCalledOnce()
    expect(source.start).toHaveBeenCalledOnce()
    expect(synthOn).toHaveBeenCalledOnce()
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
    expect(sources[0]!.stop).toHaveBeenCalledWith(2)
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
