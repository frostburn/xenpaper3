import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InteractiveTutorialView from '../views/InteractiveTutorialView.vue'
import SnippetEditor from '../components/SnippetEditor.vue'
import type { DawProject, PitchedInstrumentLane } from '../daw/project'
import { deferred } from './deferred'
import basics from '../tutorial/basics.json'
import { compileSnippet } from '../snippet'

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
  it('uses six shared editors with only transport, gain, and sound-specific controls', () => {
    const wrapper = mount(InteractiveTutorialView)
    const editors = wrapper.findAllComponents(SnippetEditor)
    expect(editors).toHaveLength(6)
    expect(wrapper.findAll('textarea')).toHaveLength(6)
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Play',
      'Stop',
      'Play',
      'Stop',
      'Play',
      'Stop',
      'Play',
      'Stop',
      'Play',
      'Stop',
      'Play',
      'Stop',
    ])
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(6)
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(0)
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Instrument lane source"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Share snippet"]').exists()).toBe(false)
    expect(wrapper.find('.transport output').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('SW Patch')
    expect(editors[1]!.find('[aria-label="Unison voices"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('plays each parent-configured sound with its hidden defaults and keeps edits independent', async () => {
    audio.resume.mockResolvedValue(undefined)
    audio.play.mockResolvedValue(undefined)
    const wrapper = mount(InteractiveTutorialView)
    const editors = wrapper.findAllComponents(SnippetEditor)
    await editors[0]!.get('[aria-label="Waveform"]').setValue('square')
    await editors[0]!.get('[aria-label="Instrument gain"]').setValue('0.25')
    await editors[0]!.get('[aria-label="Play"]').trigger('click')
    await flushPromises()
    const melody = audio.play.mock.calls[0]![0].instrumentLanes[0]! as PitchedInstrumentLane
    expect(melody.instrument).toMatchObject({ patchPreset: 'default', oscillatorType: 'square' })
    expect(melody.gain).toBe(0.25)
    expect(melody.source).toContain('@adsr(10ms')
    expect(melody.clips[0]!.source).toBe('0 2 4 5 7')
    await editors[1]!.get('[aria-label="Play"]').trigger('click')
    await flushPromises()
    const chord = audio.play.mock.calls[1]![0].instrumentLanes[0]! as PitchedInstrumentLane
    expect(chord.instrument).toMatchObject({
      patchPreset: 'unison',
      numberOfVoices: 5,
      oscillatorType: 'sawtooth',
    })
    expect(chord.gain).toBe(0.35)
    expect(chord.source).toContain('@spread(12c)')
    await editors[2]!.get('[aria-label="Play"]').trigger('click')
    await flushPromises()
    expect(
      (audio.play.mock.calls[2]![0].instrumentLanes[0]! as PitchedInstrumentLane).instrument,
    ).toMatchObject({ oscillatorType: 'sine' })
    for (let index = 3; index < editors.length; index++) {
      const editor = editors[index]!
      await editor.get('[aria-label="Play"]').trigger('click')
      await flushPromises()
      const lane = audio.play.mock.calls[index]![0].instrumentLanes[0]! as PitchedInstrumentLane
      expect(lane.clips[0]!.source).toBe(editor.props('source'))
      expect(lane.instrument).toMatchObject({ oscillatorType: 'triangle' })
      expect(lane.gain).toBe(0.5)
    }
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(0)
    const originalSources = editors.map((editor) => editor.props('source'))
    await editors[3]!.get('textarea').setValue('0== . 7')
    await vi.waitFor(() => expect(editors[3]!.props('source')).toBe('0== . 7'))
    await editors[3]!.get('[aria-label="Waveform"]').setValue('sine')
    await editors[3]!.get('[aria-label="Instrument gain"]').setValue('0.2')
    for (const index of [0, 1, 2, 4, 5]) {
      expect(editors[index]!.props('source')).toBe(originalSources[index])
    }
    expect(editors[4]!.props('instrument')).toMatchObject({ oscillatorType: 'triangle' })
    expect(editors[4]!.props('gain')).toBe(0.5)
    await editors[3]!.get('[aria-label="Play"]').trigger('click')
    await flushPromises()
    const edited = audio.play.mock.calls[6]![0].instrumentLanes[0]! as PitchedInstrumentLane
    expect(edited.clips[0]!.source).toBe('0== . 7')
    expect(edited.instrument).toMatchObject({ oscillatorType: 'sine' })
    expect(edited.gain).toBe(0.2)
    wrapper.unmount()
    expect(audio.dispose).toHaveBeenCalledTimes(6)
  })

  it('reuses Basics material and compiles all six snippets', () => {
    const wrapper = mount(InteractiveTutorialView)
    const editors = wrapper.findAllComponents(SnippetEditor)
    const selections = [
      ['Notes, rests, and duration', 1],
      ['Scales', 0],
      ['Timing', 0],
    ] as const
    selections.forEach(([title, demo], index) => {
      const example = basics.find((section) => section.title === title)!.demos[demo]!
      expect(editors[index + 3]!.props('source')).toBe(example.tune)
      expect(wrapper.text()).toContain(example.description)
    })
    for (const editor of editors) {
      const result = compileSnippet({
        source: editor.props('source'),
        lane: {
          source: editor.props('laneSource') ?? '',
          instrument: editor.props('instrument'),
          gain: editor.props('gain'),
        },
      })
      expect(result.score.duration.valueOf()).toBeGreaterThan(0)
      expect(editor.get('[aria-label="Play"]').attributes('disabled')).toBeUndefined()
    }
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
