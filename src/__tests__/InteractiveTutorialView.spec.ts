import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InteractiveTutorialView from '../views/InteractiveTutorialView.vue'
import SnippetEditor from '../components/SnippetEditor.vue'
import type { DawProject, PitchedInstrumentLane } from '../daw/project'
import { deferred } from './deferred'
import basics from '../tutorial/basics.json'
import { compileSnippet } from '../snippet'
import { createPlaybackPlan } from '../daw/playback-plan'
import { interactiveTutorialPages } from '../tutorial/interactive'

const audio = vi.hoisted(() => ({
  resume: vi.fn<() => Promise<void>>(),
  play: vi.fn<(project: DawProject) => Promise<void>>(),
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
afterEach(() => {
  vi.clearAllMocks()
})

describe('interactive tutorial snippets', () => {
  it('contains the first 20 Basics demos in order, split into two pages of ten', () => {
    expect(interactiveTutorialPages.map((page) => page.length)).toEqual([10, 10])
    const demos = interactiveTutorialPages.flat()
    expect(new Set(demos.map((demo) => demo.id)).size).toBe(20)
    const material = basics
      .flatMap((section) => section.demos)
      .filter((demo) => demo.tune)
      .slice(0, 20)
    expect(demos.map((demo) => demo.props.source)).toEqual(material.map((demo) => demo.tune))
    for (const demo of demos) {
      const result = compileSnippet({
        source: demo.props.source,
        lane: {
          source: demo.props.laneSource,
          instrument: demo.props.instrument,
          gain: demo.props.gain,
        },
      })
      expect(result.score.duration.valueOf()).toBeGreaterThan(0)
      expect(result.project.globalTrack.tempoChanges[0]!.bpm).toBe(240)
      expect(demo.props.instrument).toMatchObject({ type: 'patch', patchPreset: 'default' })
      const plan = createPlaybackPlan(result.project, 0, { allowClipTempoDirective: true })
      expect(plan.tempoMap.beatToSeconds(1)).toBe(0.25)
    }
  })

  it('renders JSON content and editor props on each page with bounded navigation', async () => {
    const wrapper = mount(InteractiveTutorialView)
    const previous = () => wrapper.get('.pagination button:first-child')
    const next = () => wrapper.get('.pagination button:last-child')
    expect(previous().attributes('disabled')).toBeDefined()
    expect(next().attributes('disabled')).toBeUndefined()
    for (let page = 0; page < 2; page++) {
      const editors = wrapper.findAllComponents(SnippetEditor)
      expect(editors).toHaveLength(10)
      expect(wrapper.findAll('textarea')).toHaveLength(10)
      expect(wrapper.get('[role="status"]').text()).toBe(`Page ${page + 1} of 2`)
      interactiveTutorialPages[page]!.forEach((demo, index) => {
        expect(wrapper.get(`#${demo.id}-heading`).text()).toBe(demo.title)
        expect(editors[index]!.props()).toEqual(demo.props)
        expect(editors[index]!.get('[aria-label="Play"]').attributes('disabled')).toBeUndefined()
      })
      for (const demo of interactiveTutorialPages[page]!.filter((demo) => demo.description)) {
        expect(wrapper.text()).toContain(demo.description)
      }
      for (const demo of interactiveTutorialPages[page]!.filter((demo) => demo.html)) {
        expect(wrapper.get(`#${demo.id}-heading`).element.parentElement!.innerHTML).toContain(
          demo.html,
        )
      }
      expect(wrapper.findAll('[role="alert"]')).toHaveLength(0)
      expect(wrapper.find('input[type="radio"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="Instrument lane source"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="Share snippet"]').exists()).toBe(false)
      if (page === 0) await next().trigger('click')
    }
    expect(next().attributes('disabled')).toBeDefined()
    expect(previous().attributes('disabled')).toBeUndefined()
    await previous().trigger('click')
    expect(wrapper.get('[role="status"]').text()).toBe('Page 1 of 2')
    wrapper.unmount()
  })

  it('plays every JSON-configured demo and disposes playback on page changes', async () => {
    audio.resume.mockResolvedValue(undefined)
    audio.play.mockResolvedValue(undefined)
    const wrapper = mount(InteractiveTutorialView)
    for (let page = 0; page < 2; page++) {
      expect(audio.dispose).toHaveBeenCalledTimes(page * 10)
      const editors = wrapper.findAllComponents(SnippetEditor)
      for (let index = 0; index < editors.length; index++) {
        await editors[index]!.get('[aria-label="Play"]').trigger('click')
        await flushPromises()
        const lane = audio.play.mock.calls[page * 10 + index]![0]
          .instrumentLanes[0]! as PitchedInstrumentLane
        const props = interactiveTutorialPages[page]![index]!.props
        expect(lane.clips[0]!.source).toBe(props.source)
        expect(lane.instrument).toEqual(props.instrument)
        expect(lane.gain).toBe(props.gain)
        expect(lane.source).toBe(props.laneSource)
      }
      if (page === 0) {
        await wrapper.get('.pagination button:last-child').trigger('click')
      }
    }
    wrapper.unmount()
    expect(audio.dispose).toHaveBeenCalledTimes(20)
  })

  it('retains pending source, instrument, and gain edits across pages without changing other demos or JSON defaults', async () => {
    const wrapper = mount(InteractiveTutorialView)
    const first = wrapper.findAllComponents(SnippetEditor)[0]!
    await first.get('[aria-label="Waveform"]').setValue('square')
    await first.get('[aria-label="Instrument gain"]').setValue('0.25')
    await first.get('textarea').setValue('0== . 7')
    // Navigating immediately must flush the source editor debounce on unmount.
    await wrapper.get('.pagination button:last-child').trigger('click')
    const secondPage = wrapper.findAllComponents(SnippetEditor)
    expect(secondPage[0]!.props()).toEqual(interactiveTutorialPages[1]![0]!.props)
    await secondPage[0]!.get('[aria-label="Waveform"]').setValue('sine')
    await wrapper.get('.pagination button:first-child').trigger('click')
    const firstPage = wrapper.findAllComponents(SnippetEditor)
    expect(firstPage[0]!.props('source')).toBe('0== . 7')
    expect(firstPage[0]!.props('instrument')).toMatchObject({ oscillatorType: 'square' })
    expect(firstPage[0]!.props('gain')).toBe(0.25)
    expect(firstPage[1]!.props()).toEqual(interactiveTutorialPages[0]![1]!.props)
    await wrapper.get('.pagination button:last-child').trigger('click')
    expect(wrapper.findAllComponents(SnippetEditor)[0]!.props('instrument')).toMatchObject({
      oscillatorType: 'sine',
    })
    wrapper.unmount()
    const fresh = mount(InteractiveTutorialView)
    expect(fresh.findAllComponents(SnippetEditor)[0]!.props()).toEqual(
      interactiveTutorialPages[0]![0]!.props,
    )
    fresh.unmount()
  })

  it('cancels pending audio initialization when navigating away', async () => {
    const resumed = deferred()
    audio.resume.mockReturnValueOnce(resumed.promise)
    const wrapper = mount(InteractiveTutorialView)
    await wrapper.findAllComponents(SnippetEditor)[0]!.get('[aria-label="Play"]').trigger('click')
    await wrapper.get('.pagination button:last-child').trigger('click')
    resumed.resolve()
    await flushPromises()
    expect(audio.play).not.toHaveBeenCalled()
    expect(audio.dispose).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('cancels pending playback when parent configuration changes', async () => {
    const resumed = deferred()
    audio.resume.mockReturnValueOnce(resumed.promise)
    const wrapper = mount(SnippetEditor, {
      props: {
        source: '0',
        gain: 0.5,
        instrument: { type: 'patch', patchPreset: 'default', oscillatorType: 'sine' },
        laneSource: '{12edo}',
        simplified: true,
      },
    })
    await wrapper.get('[aria-label="Play"]').trigger('click')
    await wrapper.setProps({ laneSource: '{19edo}' })
    resumed.resolve()
    await flushPromises()
    expect(audio.play).not.toHaveBeenCalled()
    expect(wrapper.get('[aria-label="Play"]').attributes('aria-pressed')).toBe('false')
    wrapper.unmount()
  })

  it('shows only controls for a parent-configured noise instrument', () => {
    const wrapper = mount(SnippetEditor, {
      props: {
        source: '0',
        gain: 0.5,
        instrument: { type: 'patch', patchPreset: 'driven-noise', oscillatorType: 'triangle' },
        simplified: true,
      },
    })
    expect(wrapper.findAll('select').map((select) => select.attributes('aria-label'))).toEqual([
      'Noise waveform',
      'Noise color',
      'Noise interpolation',
    ])
    expect(wrapper.find('input[type="radio"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
