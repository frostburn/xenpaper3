import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import SnippetView from '../views/SnippetView.vue'
import { createDefaultSnippet, decodeSnippet, encodeSnippet } from '../snippet'
import { deferred } from './deferred'

const audio = vi.hoisted(() => ({
  resume: vi.fn<() => Promise<void>>(),
  play: vi.fn<(...args: unknown[]) => Promise<void>>(),
  stop: vi.fn<() => void>(),
  dispose: vi.fn<() => void>(),
}))
vi.mock('../daw/audio-engine', () => ({
  DawAudioEngine: class extends EventTarget {
    context = { state: 'suspended', resume: audio.resume }
    play = audio.play
    stop = audio.stop
    dispose = audio.dispose
    positionBeats = 1
  },
}))

const open = async (hash = '') => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/snippet', component: SnippetView },
      { path: '/daw', component: { template: '<span />' } },
    ],
  })
  await router.push('/snippet' + hash)
  await router.isReady()
  return {
    router,
    wrapper: mount(SnippetView, { global: { plugins: [router], stubs: { PianoRoll: true } } }),
  }
}
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('snippet view', () => {
  it('restores and edits the single clip and lane, then copies the plain URL', async () => {
    const snippet = createDefaultSnippet()
    snippet.source = '@tempo(80bpm) 0 4 7'
    const { wrapper, router } = await open(encodeSnippet(snippet))
    expect(
      (wrapper.get('[aria-label="Xenpaper snippet source"]').element as HTMLTextAreaElement).value,
    ).toBe(snippet.source)
    expect(wrapper.find('[aria-label="Duplicate clip"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Delete clip"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Instrument lane source"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/daw"]').exists()).toBe(false)
    expect(wrapper.get('h2').text()).toBe('Clip source')
    expect(wrapper.text()).toContain('Instrument config')
    await wrapper.get('[aria-label="Instrument gain"]').setValue('0.4')
    await wrapper.get('[aria-label="Waveform"]').setValue('triangle')
    await flushPromises()
    const restored = decodeSnippet(router.currentRoute.value.hash)
    expect(restored.lane.gain).toBe(0.4)
    expect(restored.lane.instrument).toMatchObject({ oscillatorType: 'triangle' })
    const clipboard = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } })
    expect(wrapper.find('[aria-label="Share format"]').exists()).toBe(false)
    const shareUrl = (wrapper.get('[aria-label="Shareable snippet link"]').element as HTMLInputElement)
      .value
    expect(shareUrl).toMatch(/^http.*#v1\.[A-Za-z0-9_-]+$/)
    expect(new URL(shareUrl).hash).toBe(router.currentRoute.value.hash)
    await wrapper.get('.share button').trigger('click')
    await flushPromises()
    expect(clipboard).toHaveBeenCalledWith(shareUrl)
    expect(wrapper.get('[role="status"]').text()).toBe('Copied!')
    wrapper.unmount()
  })

  it('shows malformed link errors and recovers when the user edits', async () => {
    const { wrapper } = await open('#broken')
    expect(wrapper.get('[role="alert"]').text()).toContain('Invalid or unsupported snippet URL')
    await wrapper.get('[aria-label="Instrument gain"]').setValue('0.3')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('clears link errors when navigating back to the current valid snippet', async () => {
    const { wrapper, router } = await open('#broken')
    await router.push('/snippet' + encodeSnippet(createDefaultSnippet()))
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not begin playback if stopped while audio is resuming', async () => {
    const resumed = deferred()
    audio.resume.mockReturnValueOnce(resumed.promise)
    const { wrapper } = await open()
    await wrapper.get('[aria-label="Play"]').trigger('click')
    await wrapper.get('[aria-label="Stop"]').trigger('click')
    resumed.resolve()
    await flushPromises()
    expect(audio.play).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(audio.dispose).toHaveBeenCalledOnce()
  })

  it('plays through the snippet tempo path and restarts and stops', async () => {
    audio.resume.mockResolvedValue(undefined)
    audio.play.mockResolvedValue(undefined)
    const { wrapper } = await open()
    await wrapper.get('[aria-label="Play"]').trigger('click')
    await flushPromises()
    expect(audio.play.mock.calls[0]![2]).toEqual({
      allowClipTempoDirective: true,
      inheritProjectTimeSignature: false,
    })
    expect(wrapper.get('[aria-label="Play"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[aria-label="Play"]').trigger('click')
    await flushPromises()
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(audio.play.mock.calls[1]![1]).toBe(0)
    expect(wrapper.get('[aria-label="Play"]').text()).toBe('Play')
    await wrapper.get('[aria-label="Stop"]').trigger('click')
    expect(wrapper.get('[aria-label="Play"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('.transport output').text()).toBe('Beat 0.00')
    wrapper.unmount()
  })
})
