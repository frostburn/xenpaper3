import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import router from '../router'
import DawView from '../views/DawView.vue'
import InstrumentPianoRollLane from '../components/daw/InstrumentPianoRollLane.vue'
import { beat, beatToNumber, createDefaultProject, pointerXToBeat, snapBeat } from '../daw/project'

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
})
