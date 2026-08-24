import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import router from '../router'
import DawView from '../views/DawView.vue'
import InstrumentPianoRollLane from '../components/daw/InstrumentPianoRollLane.vue'
import { beat, beatToNumber, createDefaultProject, pointerXToBeat, snapBeat } from '../daw/project'
import {
  parseProjectNotes,
  projectBeatToSeconds,
  projectSecondsToBeat,
} from '../daw/audio-engine'

describe('DAW project model', () => {
  it('creates the production-ready project defaults', () => {
    const project = createDefaultProject()

    expect(project.globalTrack.tempoChanges).toEqual([{ id: 'tempo-1', beat: beat(0), bpm: 120 }])
    expect(project.globalTrack.timeSignatureChanges[0]).toMatchObject({
      id: 'time-signature-1',
      beat: beat(0),
      numerator: 4,
      denominator: 4,
    })
    expect(project.instrumentLanes[0]).toMatchObject({
      id: 'instrument-1',
      patchSource: 'default',
      oscillatorType: 'sawtooth',
      clips: [],
    })
    expect(JSON.parse(JSON.stringify(project))).toEqual(project)
  })

  it('converts scrolled, zoomed pointer coordinates and snaps exactly', () => {
    expect(pointerXToBeat(96, 32, 64)).toBe(2)
    expect(snapBeat(2.13, beat(1, 4))).toEqual(beat(9, 4))
  })

  it('parses Xenpaper clip notes and offsets them onto the project timeline', () => {
    const project = createDefaultProject()
    project.instrumentLanes[0]!.clips.push({
      id: 'melody',
      start: beat(2),
      length: beat(4),
      source: 'C D E',
    })

    const notes = parseProjectNotes(project)
    expect(notes).toHaveLength(3)
    expect(notes.map(({ beat: start }) => start)).toEqual([2, 3, 4])
    expect(notes.every(({ duration }) => duration === 1)).toBe(true)
    expect(notes[0]!.cents).not.toBe(notes[1]!.cents)
  })

  it('integrates every tempo segment and converts audio time back to beats', () => {
    const project = createDefaultProject()
    project.globalTrack.tempoChanges.push({ id: 'slow', beat: beat(4), bpm: 60 })
    project.globalTrack.tempoChanges.push({ id: 'fast', beat: beat(6), bpm: 240 })

    expect(projectBeatToSeconds(project, 4)).toBe(2)
    expect(projectBeatToSeconds(project, 6)).toBe(4)
    expect(projectBeatToSeconds(project, 8)).toBe(4.5)
    expect(projectSecondsToBeat(project, 4.5)).toBe(8)
  })
})

describe('DAW routing', () => {
  it('provides the DAW without replacing either development route', () => {
    const paths = router.getRoutes().map(({ path }) => path)
    expect(paths).toContain('/daw')
    expect(paths).toContain('/patch-testing')
    expect(paths).toContain('/xenpaper-lang-testing')
  })
})

describe('DawView', () => {
  it('double-clicks the empty lane to create, select, and edit a snapped clip', async () => {
    const wrapper = mount(DawView, { attachTo: document.body })
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    vi.spyOn(lane.element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 144,
      width: 800,
      height: 144,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    await lane.trigger('dblclick', { clientX: 70 })

    const clip = wrapper.get('button.clip')
    expect(clip.classes()).toContain('selected')
    expect(clip.attributes('style')).toContain('left: 64px')
    const source = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Xenpaper clip source"]')
    expect(source.element.value).toContain('[0,4,7]')
    expect(document.activeElement).toBe(source.element)
    wrapper.unmount()
  })

  it('uses a single click for playhead placement and an existing clip click for selection', async () => {
    const wrapper = mount(DawView)
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    await lane.trigger('click', { clientX: 128 })
    expect(wrapper.get('output').text()).toBe('Beat 2.00')

    await lane.trigger('dblclick', { clientX: 64 })
    await wrapper.get('button.clip').trigger('click')
    expect(wrapper.get('button.clip').classes()).toContain('selected')
    expect(beatToNumber(beat(1, 4))).toBe(0.25)
  })

  it('does not create overlapping clips when an existing clip is double-clicked', async () => {
    const wrapper = mount(DawView)
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    await lane.trigger('dblclick', { clientX: 64 })
    await wrapper.get('button.clip').trigger('dblclick', { clientX: 64 })

    expect(wrapper.findAll('button.clip')).toHaveLength(1)
  })

  it('keeps the visual grid aligned with zoom and scroll', async () => {
    const wrapper = mount(DawView)
    const controls = wrapper.findAll<HTMLInputElement>('.timeline-controls input')
    await controls[0]!.setValue('96')
    await controls[1]!.setValue('32')

    const style = wrapper.get('[aria-label="Instrument piano roll"]').attributes('style')
    expect(style).toContain('--beat-width: 96px')
    expect(style).toContain('--grid-offset: -32px')
  })

  it('edits global controls, waveform, and the clip preview mode', async () => {
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Tempo in BPM"]').setValue('144')
    await wrapper.get('[aria-label="Time signature numerator"]').setValue('7')
    await wrapper.get('[aria-label="Time signature denominator"]').setValue('8')
    await wrapper.get('[aria-label="Waveform"]').setValue('triangle')

    expect((wrapper.get('[aria-label="Tempo in BPM"]').element as HTMLInputElement).value).toBe(
      '144',
    )
    expect((wrapper.get('[aria-label="Waveform"]').element as HTMLSelectElement).value).toBe(
      'triangle',
    )

    await wrapper.getComponent(InstrumentPianoRollLane).trigger('dblclick', { clientX: 64 })
    expect(wrapper.find('[aria-label="Piano roll preview"]').exists()).toBe(true)
    await wrapper.get('[aria-label="Clip display"]').setValue('source')
    expect(wrapper.get('button.clip pre').text()).toContain('[0,4,7]===')
  })

  it('moves clips on the snapped grid and wires play and stop', async () => {
    const wrapper = mount(DawView)
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    await lane.trigger('dblclick', { clientX: 64 })
    const clip = wrapper.get('button.clip')
    clip.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 70 }))
    lane.element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 139 }))
    lane.element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(clip.attributes('style')).toContain('left: 128px')

    await wrapper.get('[aria-label="Play"]').trigger('click')
    expect(wrapper.get('[aria-label="Play"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[aria-label="Stop"]').trigger('click')
    expect(wrapper.get('output').text()).toBe('Beat 0.00')
    wrapper.unmount()
  })
})
