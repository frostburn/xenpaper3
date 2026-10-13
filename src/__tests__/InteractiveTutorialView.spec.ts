import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InteractiveTutorialView from '../views/InteractiveTutorialView.vue'
import SnippetEditor from '../components/SnippetEditor.vue'
import type { DawProject, PitchedInstrumentLane } from '../daw/project'
import { createMemoryHistory, createRouter } from 'vue-router'
import { deferred } from './deferred'
import basics from '../tutorial/basics.json'
import { tutorialChapters } from '../tutorial'
import { compileSnippet, SNIPPET_PLAYBACK_OPTIONS } from '../snippet'
import { createPlaybackPlan } from '../daw/playback-plan'
import {
  interactiveTutorialChapters,
  interactiveTutorialPages,
  type InteractiveTutorialDemo,
} from '../tutorial/interactive'

const playablePages = interactiveTutorialPages.map((page) =>
  page.filter(
    (
      demo,
    ): demo is InteractiveTutorialDemo & { props: NonNullable<InteractiveTutorialDemo['props']> } =>
      demo.props !== undefined,
  ),
)

const audio = vi.hoisted(() => ({
  positionBeats: 1,
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
    get positionBeats() {
      return audio.positionBeats
    }
  },
}))
afterEach(() => {
  vi.clearAllMocks()
  audio.positionBeats = 1
  vi.useRealTimers()
})

async function openTutorial(url = '/tutorial') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/tutorial', component: InteractiveTutorialView }],
  })
  await router.push(url)
  await router.isReady()
  return mount(InteractiveTutorialView, { attachTo: document.body, global: { plugins: [router] } })
}

describe('interactive tutorial snippets', () => {
  it('covers every chapter, including explanations without tunes, while preserving the first two pages', () => {
    expect(
      interactiveTutorialChapters.slice(0, tutorialChapters.length).map((chapter) => chapter.title),
    ).toEqual(tutorialChapters.map((chapter) => chapter.title))
    expect(interactiveTutorialPages.slice(0, 2).map((page) => page.length)).toEqual([10, 10])
    const demos = interactiveTutorialPages.flat()
    expect(new Set(demos.map((demo) => demo.id)).size).toBe(demos.length)
    for (const [index, chapter] of tutorialChapters.entries()) {
      const entries = interactiveTutorialChapters[index]!.pages.flatMap((page) => page.demos)
      const material = chapter.sections.flatMap((section) => section.demos)
      expect(entries).toHaveLength(material.length)
      expect(entries.map((demo) => demo.props?.source)).toEqual(material.map((demo) => demo.tune))
      expect(entries.every((demo) => demo.title?.length > 0)).toBe(true)
      // The original first demo removes sidebar-only "Click to load" instructions.
      const newEntries = entries.slice(index === 0 ? 20 : 0)
      const newMaterial = material.slice(index === 0 ? 20 : 0)
      expect(newEntries.map((demo) => demo.description)).toEqual(
        newMaterial.map((demo) => demo.description),
      )
      expect(newEntries.map((demo) => demo.html)).toEqual(newMaterial.map((demo) => demo.html))
    }
    expect(interactiveTutorialPages.every((page) => page.length > 0 && page.length <= 10)).toBe(
      true,
    )
    const material = basics
      .flatMap((section) => section.demos)
      .filter((demo) => demo.tune)
      .slice(0, 20)
    expect(demos.slice(0, 20).map((demo) => demo.props!.source)).toEqual(
      material.map((demo) => demo.tune),
    )
  })

  it('compiles every playable example with the tutorial defaults and builds its playback plan', () => {
    for (const demo of playablePages.flat()) {
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
      expect(result.diagnostics).toEqual([])
      const plan = createPlaybackPlan(result.project, 0, SNIPPET_PLAYBACK_OPTIONS)
      expect(plan.tempoMap.beatToSeconds(1)).toBe(0.25)
      expect(plan.lanes[0]?.notes.length).toBeGreaterThan(0)
    }
  })

  it('renders JSON content and editor props on each page with bounded navigation', async () => {
    const wrapper = await openTutorial()
    const previous = () => wrapper.get('.pagination button:first-child')
    const next = () => wrapper.get('.pagination button:last-child')
    expect(previous().attributes('disabled')).toBeDefined()
    expect(next().attributes('disabled')).toBeUndefined()
    for (let page = 0; page < interactiveTutorialPages.length; page++) {
      const editors = wrapper.findAllComponents(SnippetEditor)
      expect(editors).toHaveLength(playablePages[page]!.length)
      expect(wrapper.findAll('textarea')).toHaveLength(playablePages[page]!.length)
      expect(wrapper.get('[aria-label="Permalink to this tutorial page"]').text()).toBe(
        `Page ${page + 1} of ${interactiveTutorialPages.length}`,
      )
      interactiveTutorialPages[page]!.forEach((demo) => {
        expect(wrapper.get(`#${demo.id}-heading`).text()).toBe(demo.title)
      })
      playablePages[page]!.forEach((demo, index) => {
        expect(editors[index]!.props()).toEqual(demo.props)
        expect(editors[index]!.get('[aria-label="Play"]').attributes('disabled')).toBeUndefined()
      })
      for (const demo of interactiveTutorialPages[page]!.filter((demo) => demo.description)) {
        expect(wrapper.text()).toContain(demo.description)
      }
      for (const demo of interactiveTutorialPages[page]!.filter((demo) => demo.html)) {
        const expected = document.createElement('div')
        expected.innerHTML = demo.html!
        expect(
          wrapper.get(`section[aria-labelledby="${demo.id}-heading"] .html-description`).element
            .innerHTML,
        ).toBe(expected.innerHTML)
      }
      expect(wrapper.findAll('[role="alert"]')).toHaveLength(0)
      expect(wrapper.findAll('.syntax-warning')).toHaveLength(0)
      expect(wrapper.find('input[type="radio"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="Instrument lane source"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="Share snippet"]').exists()).toBe(false)
      if (page < interactiveTutorialPages.length - 1)
        await next().trigger('click').then(flushPromises)
    }
    expect(next().attributes('disabled')).toBeDefined()
    expect(previous().attributes('disabled')).toBeUndefined()
    await previous().trigger('click').then(flushPromises)
    expect(wrapper.get('[aria-label="Permalink to this tutorial page"]').text()).toBe(
      `Page ${interactiveTutorialPages.length - 1} of ${interactiveTutorialPages.length}`,
    )
    wrapper.unmount()
  }, 30000)

  it('plays the documented unison spread ramps at the tutorial tempo', () => {
    const demo = playablePages.flat().find(({ id }) => id === 'features-signal-ramps')!
    const result = compileSnippet({
      source: demo.props.source,
      lane: {
        source: demo.props.laneSource,
        instrument: demo.props.instrument,
        gain: demo.props.gain,
      },
    })
    const lane = createPlaybackPlan(result.project, 0, SNIPPET_PLAYBACK_OPTIONS).lanes[0]!
    expect(lane.kind).toBe('instrument')
    if (lane.kind !== 'instrument') throw new Error('Expected a pitched instrument')
    expect(lane.spread?.initialValue).toBe(0)
    expect(
      lane.spread?.curves.map(({ offset, duration, values }) => [
        offset,
        duration,
        values[values.length - 1],
      ]),
    ).toEqual([
      [0, 2, 40],
      [2, 1, 5],
    ])
  })

  it('plays every JSON-configured demo and disposes playback on page changes', async () => {
    audio.resume.mockResolvedValue(undefined)
    audio.play.mockResolvedValue(undefined)
    const wrapper = await openTutorial()
    let played = 0
    for (let page = 0; page < interactiveTutorialPages.length; page++) {
      expect(audio.dispose).toHaveBeenCalledTimes(played)
      const editors = wrapper.findAllComponents(SnippetEditor)
      for (let index = 0; index < editors.length; index++) {
        await editors[index]!.get('[aria-label="Play"]').trigger('click')
        await flushPromises()
        const lane = audio.play.mock.calls[played + index]![0]
          .instrumentLanes[0]! as PitchedInstrumentLane
        const props = playablePages[page]![index]!.props
        expect(lane.clips[0]!.source).toBe(props.source)
        expect(lane.instrument).toEqual(props.instrument)
        expect(lane.gain).toBe(props.gain)
        expect(lane.source).toBe(props.laneSource)
      }
      played += editors.length
      if (page < interactiveTutorialPages.length - 1) {
        await wrapper.get('.pagination button:last-child').trigger('click').then(flushPromises)
      }
    }
    wrapper.unmount()
    expect(audio.dispose).toHaveBeenCalledTimes(playablePages.flat().length)
  }, 30000)

  it('retains pending source, instrument, and gain edits across pages without changing other demos or JSON defaults', async () => {
    const wrapper = await openTutorial()
    const first = wrapper.findAllComponents(SnippetEditor)[0]!
    await first.get('[aria-label="Waveform"]').setValue('square')
    await first.get('[aria-label="Instrument gain"]').setValue('0.25')
    await first.get('textarea').setValue('0== . 7')
    // Navigating immediately must flush the source editor debounce on unmount.
    await wrapper.get('.pagination button:last-child').trigger('click').then(flushPromises)
    const secondPage = wrapper.findAllComponents(SnippetEditor)
    expect(secondPage[0]!.props()).toEqual(interactiveTutorialPages[1]![0]!.props)
    await secondPage[0]!.get('[aria-label="Waveform"]').setValue('sine')
    await wrapper.get('.pagination button:first-child').trigger('click').then(flushPromises)
    const firstPage = wrapper.findAllComponents(SnippetEditor)
    expect(firstPage[0]!.props('source')).toBe('0== . 7')
    expect(firstPage[0]!.props('instrument')).toMatchObject({ oscillatorType: 'square' })
    expect(firstPage[0]!.props('gain')).toBe(0.25)
    expect(firstPage[1]!.props()).toEqual(interactiveTutorialPages[0]![1]!.props)
    await wrapper.get('.pagination button:last-child').trigger('click').then(flushPromises)
    expect(wrapper.findAllComponents(SnippetEditor)[0]!.props('instrument')).toMatchObject({
      oscillatorType: 'sine',
    })
    wrapper.unmount()
    const fresh = await openTutorial()
    expect(fresh.findAllComponents(SnippetEditor)[0]!.props()).toEqual(
      interactiveTutorialPages[0]![0]!.props,
    )
    fresh.unmount()
  })

  it('opens permalinks and follows browser history with a safe fallback for invalid pages', async () => {
    const wrapper = await openTutorial('/tutorial?page=2')
    const firstTitle = () => wrapper.get('.tutorial > section h2').text()
    expect(firstTitle()).toBe('Other equaves')
    expect(wrapper.get('[aria-label="Permalink to this tutorial page"]').attributes('href')).toBe(
      '/tutorial?page=2',
    )
    await wrapper.get('.pagination button:first-child').trigger('click').then(flushPromises)
    expect(wrapper.vm.$route.query.page).toBe('1')
    wrapper.vm.$router.back()
    await vi.waitFor(() => expect(firstTitle()).toBe('Other equaves'))
    await wrapper.vm.$router.push('/tutorial?page=999')
    expect(firstTitle()).toBe('Notes')
    wrapper.unmount()
  })

  it('links every entry in the contents and jumps between chapters while retaining edits', async () => {
    const wrapper = await openTutorial('/tutorial?setting=kept')
    const contents = wrapper.get('details').element as HTMLDetailsElement
    const links = wrapper.findAll('.contents a')
    expect(links).toHaveLength(
      interactiveTutorialPages.length + interactiveTutorialPages.flat().length,
    )
    expect(wrapper.get('.contents [aria-current="page"]').text()).toContain('Page 1:')
    await wrapper.findAllComponents(SnippetEditor)[0]!.get('textarea').setValue('0== . 7')
    const mosPages = interactiveTutorialChapters.find(
      (chapter) => chapter.id === 'diamond-mos',
    )!.pages
    const lastPage = mosPages[mosPages.length - 1]!.index + 1
    const lastDemo =
      interactiveTutorialPages[lastPage - 1]![interactiveTutorialPages[lastPage - 1]!.length - 1]!
    contents.open = true
    expect(wrapper.get(`.contents a[href$="#${lastDemo.id}-heading"]`).attributes('href')).toBe(
      `/tutorial?setting=kept&page=${lastPage}#${lastDemo.id}-heading`,
    )
    await wrapper
      .get(`.contents a[href$="#${lastDemo.id}-heading"]`)
      .trigger('click')
      .then(flushPromises)
    expect(contents.open).toBe(false)
    expect(wrapper.vm.$route.query).toEqual({ setting: 'kept', page: String(lastPage) })
    expect(document.activeElement).toBe(wrapper.get(`#${lastDemo.id}-heading`).element)
    expect(wrapper.get('.contents [aria-current="location"]').text()).toBe(lastDemo.title)
    expect(wrapper.get('.chapter-heading').text()).toContain('Diamond-mos notation')
    expect(wrapper.findAllComponents(SnippetEditor).pop()!.props('source')).toBe(
      lastDemo.props!.source,
    )
    await wrapper
      .get('.contents a[href$="#basics-01-heading"]')
      .trigger('click')
      .then(flushPromises)
    expect(wrapper.findAllComponents(SnippetEditor)[0]!.props('source')).toBe('0== . 7')
    expect(document.activeElement).toBe(wrapper.get('#basics-01-heading').element)
    contents.open = true
    await wrapper
      .get('.contents a[href$="#basics-01-heading"]')
      .trigger('click')
      .then(flushPromises)
    expect(contents.open).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('#basics-01-heading').element)
    wrapper.unmount()
  })

  it('opens example permalinks directly and safely handles unknown anchors and invalid page queries', async () => {
    const wrapper = await openTutorial('/tutorial?page=3#basics-22-heading')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('#basics-22-heading').element)
    expect(wrapper.get('#basics-22-heading').text()).toBe('Tuplets')
    await wrapper.vm.$router.push('/tutorial?page=6#unknown-heading')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('h1').element)
    expect(wrapper.get('.chapter-heading').text()).toContain('Advanced score construction')
    for (const query of ['0', '-1', '1.5', 'abc', '1&page=2']) {
      await wrapper.vm.$router.push(`/tutorial?page=${query}`)
      expect(wrapper.get('.tutorial > section h2').text()).toBe('Notes')
    }
    wrapper.unmount()
  })

  it('cancels pending audio initialization when navigating away', async () => {
    const resumed = deferred()
    audio.resume.mockReturnValueOnce(resumed.promise)
    const wrapper = await openTutorial()
    await wrapper.findAllComponents(SnippetEditor)[0]!.get('[aria-label="Play"]').trigger('click')
    await wrapper.get('.pagination button:last-child').trigger('click').then(flushPromises)
    resumed.resolve()
    await flushPromises()
    expect(audio.play).not.toHaveBeenCalled()
    expect(audio.dispose).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('highlights the currently playing note and clears highlights on stop', async () => {
    vi.useFakeTimers()
    audio.resume.mockResolvedValue(undefined)
    audio.play.mockResolvedValue(undefined)
    audio.positionBeats = 0
    const wrapper = mount(SnippetEditor, {
      props: {
        source: '0 2 . 4',
        gain: 0.5,
        instrument: { type: 'patch', patchPreset: 'default', oscillatorType: 'semisine' },
        laneSource: '@tempo(240bpm)',
        simplified: true,
      },
    })
    await wrapper.get('[aria-label="Play"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.source-playing').text()).toBe('0')
    audio.positionBeats = 1
    await vi.advanceTimersByTimeAsync(25)
    expect(wrapper.get('.source-playing').text()).toBe('2')
    audio.positionBeats = 2
    await vi.advanceTimersByTimeAsync(25)
    expect(wrapper.find('.source-playing').exists()).toBe(false)
    await wrapper.get('[aria-label="Stop"]').trigger('click')
    expect(wrapper.find('.source-playing').exists()).toBe(false)
    wrapper.unmount()
  })

  it('highlights misplaced barlines only when the snippet explicitly supplies a meter', async () => {
    const wrapper = mount(SnippetEditor, {
      props: {
        source: '0 4 7 | 12',
        gain: 0.5,
        instrument: { type: 'patch', patchPreset: 'default', oscillatorType: 'triangle' },
        simplified: true,
      },
    })
    expect(wrapper.findAll('.syntax-warning')).toHaveLength(0)
    await wrapper.setProps({ source: '@time(4/4) 0 4 7 | 12' })
    expect(wrapper.get('.syntax-warning').text()).toBe('|')
    await wrapper.setProps({ source: '0 4 7 | 12' })
    expect(wrapper.findAll('.syntax-warning')).toHaveLength(0)
    wrapper.unmount()
  })

  it('fades the pending status without replacing its reserved space', async () => {
    const resumed = deferred()
    audio.resume.mockReturnValueOnce(resumed.promise)
    audio.play.mockResolvedValue(undefined)
    const wrapper = mount(SnippetEditor, {
      props: {
        source: '0',
        gain: 0.5,
        instrument: { type: 'patch', patchPreset: 'default', oscillatorType: 'triangle' },
        simplified: true,
      },
    })
    const status = wrapper.get('.preparing').element
    await wrapper.get('[aria-label="Play"]').trigger('click')
    expect(wrapper.get('.preparing').classes()).toContain('pending')
    expect(wrapper.get('.preparing').attributes('aria-hidden')).toBe('false')
    resumed.resolve()
    await flushPromises()
    expect(wrapper.get('.preparing').element).toBe(status)
    expect(wrapper.get('.preparing').classes()).not.toContain('pending')
    expect(wrapper.get('.preparing').attributes('aria-hidden')).toBe('true')
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
