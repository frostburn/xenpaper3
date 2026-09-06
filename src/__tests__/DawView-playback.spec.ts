import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DawView from '../views/DawView.vue'
import { deferred } from './deferred'

const controls = vi.hoisted(() => ({
  resume: vi.fn<() => Promise<void>>(),
  play: vi.fn<() => Promise<void>>(),
}))

vi.mock('../daw/audio-engine', () => ({
  DawAudioEngine: class extends EventTarget {
    context = { state: 'suspended', resume: controls.resume }
    play = controls.play
    stop = vi.fn<() => void>()
    dispose = vi.fn<() => void>()
    positionBeats = 0
  },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  controls.resume.mockReset()
  controls.play.mockReset()
})

describe('DAW asynchronous playback controls', () => {
  it.each(['stop', 'unmount'])('cancels context resume after %s', async (action) => {
    vi.stubGlobal('AudioContext', class {})
    const resumed = deferred()
    controls.resume.mockReturnValue(resumed.promise)
    controls.play.mockResolvedValue(undefined)
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Play"]').trigger('click')
    expect(controls.resume).toHaveBeenCalledOnce()

    if (action === 'stop') await wrapper.get('[aria-label="Stop"]').trigger('click')
    else wrapper.unmount()
    resumed.resolve()
    await flushPromises()

    expect(controls.play).not.toHaveBeenCalled()
    if (action === 'stop') {
      wrapper.unmount()
    }
  })

  it('does not restart the playhead timer when a stopped play request finishes', async () => {
    vi.stubGlobal('AudioContext', class {})
    controls.resume.mockResolvedValue(undefined)
    const prepared = deferred()
    controls.play.mockReturnValue(prepared.promise)
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Play"]').trigger('click')
    await flushPromises()
    expect(controls.play).toHaveBeenCalledOnce()

    await wrapper.get('[aria-label="Stop"]').trigger('click')
    prepared.resolve()
    await flushPromises()

    expect(wrapper.get('[aria-label="Play"]').attributes('aria-pressed')).toBe('false')
    wrapper.unmount()
  })

  it('ignores an error from a cancelled play request', async () => {
    vi.stubGlobal('AudioContext', class {})
    const resumed = deferred()
    controls.resume.mockReturnValue(resumed.promise)
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Play"]').trigger('click')
    await wrapper.get('[aria-label="Stop"]').trigger('click')

    resumed.reject(new Error('Obsolete resume failure'))
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
