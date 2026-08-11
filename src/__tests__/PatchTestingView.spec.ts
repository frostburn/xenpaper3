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

class MockAnalyserNodeConstructor {
  fftSize = 2048
  connect = vi.fn<(to: AudioNode) => MockAnalyserNodeConstructor>(() => this)
  getFloatTimeDomainData = vi.fn<(buffer: Float32Array<ArrayBuffer>) => void>((buffer) =>
    buffer.fill(0),
  )
}

const { createPatch, effectConnect, registerMathWorklets, synthDisposes, synthOn } = vi.hoisted(
  () => ({
    createPatch: vi.fn<(source: string, ...args: unknown[]) => unknown>(),
    effectConnect: vi.fn<(to: AudioNode) => void>(),
    registerMathWorklets: vi.fn<() => Promise<void>>(),
    synthDisposes: [] as Array<ReturnType<typeof vi.fn>>,
    synthOn: vi.fn<(...arguments_: unknown[]) => NoteOff>(),
  }),
)

vi.mock('../../sw-patch', () => ({
  createPatch,
  registerMathWorklets,
}))

import PatchTestingView from '../views/PatchTestingView.vue'

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
  synthDisposes.length = 0
  synthOn.mockReset()
  effectConnect.mockReset()
  createPatch.mockReset()
  createPatch.mockImplementation((source) => {
    if (source.includes('delayTime')) return { connect: effectConnect }
    const dispose = vi.fn<() => void>()
    synthDisposes.push(dispose)
    return { dispose, on: synthOn }
  })
  registerMathWorklets.mockReset()
  registerMathWorklets.mockResolvedValue(undefined)
  synthOn.mockReturnValue(vi.fn<NoteOff>(() => 2))
  vi.stubGlobal('AudioContext', MockAudioContext)
  vi.stubGlobal('GainNode', MockGainNodeConstructor)
  vi.stubGlobal('AnalyserNode', MockAnalyserNodeConstructor)
  vi.stubGlobal('ConstantSourceNode', MockConstantSourceNode)
})

describe('PatchTestingView', () => {
  it('mounts and renders properly', () => {
    const wrapper = mount(PatchTestingView)
    expect(wrapper.text()).toContain('sw-patch testing')
    wrapper.unmount()
  })

  it('initializes patches only after math worklets are registered', async () => {
    let finishRegistration!: () => void
    registerMathWorklets.mockReturnValue(
      new Promise((resolve) => {
        finishRegistration = resolve
      }),
    )

    const wrapper = mount(PatchTestingView)
    expect(createPatch).not.toHaveBeenCalled()

    finishRegistration()
    await flushPromises()

    expect(createPatch).toHaveBeenCalledTimes(2)
    expect(effectConnect).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('resumes a suspended context before starting a note', async () => {
    const wrapper = mount(PatchTestingView)

    dispatchKey('keydown', 65)
    await flushPromises()
    const context = contexts[0]!
    const source = sources[4]!
    expect(context.resume).toHaveBeenCalledOnce()
    expect(source.start).toHaveBeenCalledOnce()
    expect(synthOn).toHaveBeenCalledOnce()
    expect(synthOn.mock.calls[0]?.slice(4)).toEqual([0.01, 0.5, 0.1, sources[3]])
    expect(context.resume.mock.invocationCallOrder[0]!).toBeLessThan(
      source.start.mock.invocationCallOrder[0]!,
    )
    wrapper.unmount()
  })

  it('releases active notes when the window loses focus', async () => {
    const off = vi.fn<NoteOff>(() => 2)
    synthOn.mockReturnValue(off)
    const wrapper = mount(PatchTestingView)
    dispatchKey('keydown', 65)
    await flushPromises()

    window.dispatchEvent(new Event('blur'))

    expect(off).toHaveBeenCalledWith(1.01)
    expect(sources[4]!.stop).toHaveBeenCalledWith(2)
    wrapper.unmount()
  })

  it('routes the filter Q slider as a decibel signal', async () => {
    const wrapper = mount(PatchTestingView)

    await wrapper.get('#filter-q').setValue('15')

    expect(sources[3]!.offset.setTargetAtTime).toHaveBeenLastCalledWith(15, 1.01, 0.01)
    wrapper.unmount()
  })

  it('switches between the bass and default synth patches', async () => {
    const bassOff = vi.fn<NoteOff>(() => 2)
    synthOn.mockReturnValueOnce(bassOff).mockReturnValue(vi.fn<NoteOff>(() => 2))
    const wrapper = mount(PatchTestingView)
    await flushPromises()

    dispatchKey('keydown', 65)
    await flushPromises()
    expect(synthOn.mock.calls[0]?.slice(4)).toEqual([0.01, 0.5, 0.1, sources[3]])

    await wrapper.get('#synth-patch').setValue('default')
    await flushPromises()
    expect(bassOff).toHaveBeenCalledOnce()
    expect(createPatch).toHaveBeenCalledTimes(3)
    expect(synthDisposes[0]).not.toHaveBeenCalled()

    dispatchKey('keydown', 66)
    await flushPromises()
    expect(synthOn.mock.calls[1]?.slice(4)).toEqual([0.01, 0.5, 0.7, 0.1])
    wrapper.unmount()
    expect(synthDisposes[0]).toHaveBeenCalledOnce()
  })

  it('selects softsaw with the standard ADSR arguments', async () => {
    const wrapper = mount(PatchTestingView)
    await flushPromises()

    await wrapper.get('#synth-patch').setValue('softsaw')
    await flushPromises()
    dispatchKey('keydown', 65)
    await flushPromises()

    expect(synthOn.mock.calls[0]?.slice(4)).toEqual([0.01, 0.5, 0.7, 0.1])
    wrapper.unmount()
  })

  it('recreates and disposes the synth when its oscillator config changes', async () => {
    const wrapper = mount(PatchTestingView)
    await flushPromises()

    expect(createPatch.mock.calls[1]?.[2]).toEqual({ config: { oscillatorType: 'sawtooth' } })
    await wrapper.get('#oscillator-type').setValue('square')
    await flushPromises()

    expect(synthDisposes[0]).toHaveBeenCalledOnce()
    expect(createPatch.mock.calls[2]?.[2]).toEqual({ config: { oscillatorType: 'square' } })
    wrapper.unmount()
  })

  it('shows oscillator types supported by the selected synth patch', async () => {
    const wrapper = mount(PatchTestingView)
    await flushPromises()
    const optionValues = () =>
      wrapper.findAll('#oscillator-type option').map((option) => option.attributes('value'))

    expect(optionValues()).toEqual(['sine', 'square', 'sawtooth', 'triangle'])
    await wrapper.get('#oscillator-type').setValue('sine')
    await wrapper.get('#synth-patch').setValue('soft')
    await flushPromises()

    expect(optionValues()).toEqual(['triangle', 'sawtooth', 'square', 'parabolic'])
    expect((wrapper.get('#oscillator-type').element as HTMLSelectElement).value).toBe('triangle')
    expect(createPatch.mock.lastCall?.[2]).toEqual({ config: { oscillatorType: 'triangle' } })
    wrapper.unmount()
  })

  it('removes listeners, releases notes, and closes its context on unmount', async () => {
    const off = vi.fn<NoteOff>(() => 2)
    synthOn.mockReturnValue(off)
    const wrapper = mount(PatchTestingView)
    dispatchKey('keydown', 65)
    await flushPromises()

    wrapper.unmount()
    dispatchKey('keydown', 66)

    expect(off).toHaveBeenCalledOnce()
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
    expect(synthOn).toHaveBeenCalledOnce()
  })
})
