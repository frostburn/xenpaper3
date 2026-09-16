import { enableAutoUnmount, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Fraction } from 'xen-dev-utils'
import DawView from '../views/DawView.vue'
import PitchedLane from '../components/daw/PitchedLane.vue'
import InstrumentLane from '../components/daw/InstrumentLane.vue'
import XenpaperSourceEditor from '../components/daw/XenpaperSourceEditor.vue'
import ArrangementTimeline from '../components/daw/ArrangementTimeline.vue'
import { beat, beatToNumber, createClip, createDefaultProject } from '../daw/project'

enableAutoUnmount(afterEach)
beforeEach(() => {
  // Transport interactions are covered without requiring a sound device in jsdom.
  vi.stubGlobal('AudioContext', undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const mountDaw = () => mount(DawView, { attachTo: document.body })

describe('DAW workspace', () => {
  it('resizes the clip inspector with pointer and keyboard controls', async () => {
    const wrapper = mountDaw()
    const workspace = wrapper.get('.workspace')
    const inspector = wrapper.get('.clip-inspector')
    let workspaceWidth = 1200
    vi.spyOn(workspace.element, 'getBoundingClientRect').mockImplementation(
      () => ({ width: workspaceWidth }) as DOMRect,
    )
    vi.spyOn(inspector.element, 'getBoundingClientRect').mockReturnValue({
      width: 360,
    } as DOMRect)

    const divider = wrapper.get('[role="separator"][aria-label="Resize clip editor"]')
    divider.element.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 840 }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 780 }))
    window.dispatchEvent(new PointerEvent('pointerup'))
    await nextTick()
    expect(workspace.attributes('style')).toContain('--clip-inspector-width: 420px')

    await divider.trigger('keydown', { key: 'ArrowRight' })
    expect(workspace.attributes('style')).toContain('--clip-inspector-width: 396px')
    expect(divider.attributes('aria-valuenow')).toBe('396')
    expect(divider.attributes('aria-valuemax')).toBe('872')

    workspaceWidth = 700
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(workspace.attributes('style')).toContain('--clip-inspector-width: 372px')
    expect(divider.attributes('aria-valuemax')).toBe('372')
  })

  it('uses the responsive inspector minimum when resizing the medium layout', async () => {
    vi.stubGlobal('innerWidth', 900)
    const wrapper = mountDaw()
    const workspace = wrapper.get('.workspace')
    const inspector = wrapper.get('.clip-inspector')
    vi.spyOn(workspace.element, 'getBoundingClientRect').mockReturnValue({ width: 900 } as DOMRect)
    vi.spyOn(inspector.element, 'getBoundingClientRect').mockReturnValue({ width: 288 } as DOMRect)

    window.dispatchEvent(new Event('resize'))
    await wrapper.get('[role="separator"]').trigger('keydown', { key: 'ArrowRight' })

    expect(workspace.attributes('style')).toContain('--clip-inspector-width: 288px')
    expect(wrapper.get('[role="separator"]').attributes('aria-valuemin')).toBe('288')
  })

  it('adds a clip without a double-click and keeps the editor in its own dock', async () => {
    const wrapper = mountDaw()
    expect(wrapper.find('.lane-settings').exists()).toBe(false)
    await wrapper.get('[aria-label="Add clip to Instrument 1"]').trigger('click')
    expect(wrapper.findAll('button.clip')).toHaveLength(1)
    const editor = wrapper.get('.clip-inspector textarea')
    expect(document.activeElement).toBe(editor.element)
    expect(wrapper.get('[aria-label="Undo"]').attributes('disabled')).toBeUndefined()
  })

  it('uses the inspector dock for lane sound and source settings', async () => {
    const wrapper = mountDaw()

    await wrapper.get('[aria-label="Edit sound and source for Instrument 1"]').trigger('click')

    const inspector = wrapper.get('[aria-label="Lane editor"]')
    expect(inspector.get('h2').text()).toBe('Sound & source')
    expect(inspector.get('[aria-label="Instrument lane source"]').attributes('rows')).toBe('10')
    expect(wrapper.find('[aria-label="Xenpaper clip source"]').exists()).toBe(false)

    await wrapper.get('[aria-label="Add clip to Instrument 1"]').trigger('click')
    expect(wrapper.get('.clip-inspector').attributes('aria-label')).toBe('Clip editor')
    expect(wrapper.find('.lane-settings').exists()).toBe(false)
  })

  it('uses the chosen rational snap grid when inserting clips', async () => {
    const wrapper = mountDaw()
    await wrapper.get('[aria-label="Clip snap grid"]').setValue('3')
    await wrapper.getComponent(PitchedLane).trigger('dblclick', { clientX: 23 })
    const start = wrapper.getComponent(PitchedLane).props('lane').clips[0]!.start
    expect(start).toBeInstanceOf(Fraction)
    expect(beatToNumber(start)).toBeCloseTo(1 / 3)
  })

  it('duplicates after the selected clip and undoes deletion without losing fractions', async () => {
    const wrapper = mountDaw()
    await wrapper.get('[aria-label="Add clip to Instrument 1"]').trigger('click')
    await wrapper.get('[aria-label="Duplicate clip"]').trigger('click')
    let clips = wrapper.getComponent(PitchedLane).props('lane').clips
    expect(clips).toHaveLength(2)
    expect(clips[0]!.id).not.toBe(clips[1]!.id)
    expect(clips[1]!.source).toBe(clips[0]!.source)
    expect(beatToNumber(clips[1]!.start)).toBe(beatToNumber(clips[0]!.start.add(clips[0]!.length)))
    await wrapper.get('[aria-label="Delete clip"]').trigger('click')
    expect(wrapper.findAll('button.clip')).toHaveLength(1)
    await wrapper.get('[aria-label="Undo"]').trigger('click')
    clips = wrapper.getComponent(PitchedLane).props('lane').clips
    expect(clips).toHaveLength(2)
    expect(clips[1]!.start).toBeInstanceOf(Fraction)
    expect(beatToNumber(clips[1]!.start.add(beat(1)))).toBe(5)
    await wrapper.get('[aria-label="Redo"]').trigger('click')
    expect(wrapper.findAll('button.clip')).toHaveLength(1)
  })

  it('treats repeated keyboard button activations as separate edits', async () => {
    const wrapper = mountDaw()
    const add = wrapper.get('button.add-lane')
    await add.trigger('click')
    await add.trigger('click')
    expect(wrapper.findAllComponents(PitchedLane)).toHaveLength(3)
    await wrapper.get('[aria-label="Undo"]').trigger('click')
    expect(wrapper.findAllComponents(PitchedLane)).toHaveLength(2)
    await wrapper.get('[aria-label="Undo"]').trigger('click')
    expect(wrapper.findAllComponents(PitchedLane)).toHaveLength(1)
  })

  it('does not rewind a running transport when selecting a clip', async () => {
    vi.useFakeTimers()
    const wrapper = mountDaw()
    await wrapper.get('[aria-label="Add clip to Instrument 1"]').trigger('click')
    await wrapper.get('[aria-label="Play"]').trigger('click')
    await vi.advanceTimersByTimeAsync(500)
    const before = wrapper.get('.transport output').text()
    expect(before).not.toBe('Beat 0.00')
    await wrapper.get('button.clip').trigger('click')
    expect(wrapper.get('.transport output').text()).toBe(before)
    await wrapper.get('button.clip').trigger('keydown', { key: ' ' })
    expect(wrapper.get('[aria-label="Play"]').attributes('aria-pressed')).toBe('false')
  })

  it('selects a focused clip before opening its editor with Enter', async () => {
    const wrapper = mountDaw()
    await wrapper.get('[aria-label="Add clip to Instrument 1"]').trigger('click')
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').setValue('C D E')
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').trigger('blur')
    await wrapper.get('[aria-label="Add clip to Instrument 1"]').trigger('click')
    const clips = wrapper.findAll('button.clip')
    const firstClip = clips[0]!
    const firstClipElement = firstClip.element as HTMLElement
    firstClipElement.focus()

    await firstClip.trigger('keydown', { key: 'Enter' })

    expect(firstClip.classes()).toContain('selected')
    const editor = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Xenpaper clip source"]')
    expect(editor.element.value).toBe('C D E')
    expect(document.activeElement).toBe(editor.element)
    wrapper.unmount()
  })

  it('does not move the playhead when Enter edits the already-selected clip', async () => {
    const wrapper = mountDaw()
    await wrapper.get('[aria-label="Add clip to Instrument 1"]').trigger('click')
    await wrapper.get('[aria-label="Add clip to Instrument 1"]').trigger('click')
    const selectedClip = wrapper.findAll('button.clip')[1]!
    const selectedClipElement = selectedClip.element as HTMLElement
    selectedClipElement.focus()
    await selectedClip.trigger('keydown', { key: 'Home' })
    expect(wrapper.get('.transport output').text()).toBe('Beat 0.00')

    await selectedClip.trigger('keydown', { key: 'Enter' })

    expect(selectedClip.classes()).toContain('selected')
    expect(wrapper.get('.transport output').text()).toBe('Beat 0.00')
    expect(document.activeElement).toBe(
      wrapper.get('textarea[aria-label="Xenpaper clip source"]').element,
    )
    wrapper.unmount()
  })

  it('leaves text editing keys and native text undo alone', async () => {
    const wrapper = mountDaw()
    await wrapper.get('[aria-label="Add clip to Instrument 1"]').trigger('click')
    const editor = wrapper.get('textarea[aria-label="Xenpaper clip source"]')
    for (const init of [{ key: ' ' }, { key: 'Delete' }, { key: 'z', ctrlKey: true }]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
      editor.element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    await nextTick()
    expect(wrapper.findAll('button.clip')).toHaveLength(1)
    expect(wrapper.get('[aria-label="Play"]').attributes('aria-pressed')).toBe('false')
  })

  it('flushes pending source before an export shortcut reaches the workspace', async () => {
    vi.useFakeTimers()
    const wrapper = mountDaw()
    await wrapper.get('[aria-label="Add clip to Instrument 1"]').trigger('click')
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-project')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').setValue('C D E')
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').trigger('keydown', {
      key: 's',
      ctrlKey: true,
    })
    expect(createURL).toHaveBeenCalledOnce()
    expect(wrapper.getComponent(PitchedLane).props('lane').clips[0]!.source).toBe('C D E')
  })

  it('flushes an equal-source clip switch using the old clip key', async () => {
    vi.useFakeTimers()
    const wrapper = mount(XenpaperSourceEditor, {
      props: { source: 'C D', sourceKey: 'one', editorLabel: 'Test source' },
    })
    await wrapper.get('textarea').setValue('C D E')
    await wrapper.setProps({ source: 'C D', sourceKey: 'two' })
    expect(wrapper.emitted('update:source')).toEqual([['C D E', 'one']])
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('C D')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.emitted('update:source')).toHaveLength(1)
  })

  it('allows deleting collapsed tracks and restores them with Undo', async () => {
    const wrapper = mountDaw()
    await wrapper.get('[aria-label="Collapse Instrument 1"]').trigger('click')
    await wrapper.get('[aria-label="Delete Instrument 1"]').trigger('click')
    expect(wrapper.findAllComponents(PitchedLane)).toHaveLength(0)
    await wrapper.get('[aria-label="Undo"]').trigger('click')
    expect(wrapper.findAllComponents(PitchedLane)).toHaveLength(1)
  })

  it('does not drag until the pointer passes the threshold or with a secondary button', async () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    const clip = createClip(lane, beat(0))
    lane.clips.push(clip)
    const wrapper = mount(InstrumentLane, {
      props: {
        lane,
        pixelsPerBeat: 64,
        scrollLeft: 0,
        displayMode: 'source',
        laneLabel: 'Instrument lane',
        timelineLabel: 'Test timeline',
        editorLabel: 'Lane source',
      },
    })
    const clipElement = wrapper.get('button.clip').element
    const track = wrapper.get('.lane').element
    const pointer = (element: Element, type: string, clientX: number, button = 0) =>
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button }))
    pointer(clipElement, 'pointerdown', 20, 2)
    pointer(track, 'pointermove', 90)
    expect(wrapper.emitted('move')).toBeUndefined()
    pointer(clipElement, 'pointerdown', 20)
    pointer(track, 'pointermove', 22)
    expect(wrapper.emitted('move')).toBeUndefined()
    pointer(track, 'pointermove', 84)
    expect(wrapper.emitted('move')).toEqual([[expect.objectContaining({ id: clip.id }), 1]])
    pointer(track, 'pointerup', 84)
    pointer(track, 'pointermove', 148)
    expect(wrapper.emitted('move')).toHaveLength(1)
  })
})

describe('Arrangement timeline', () => {
  const props = {
    endBeat: 32,
    playhead: 0,
    playing: false,
    pixelsPerBeat: 64,
    scrollLeft: 0,
    follow: true,
  }

  it('maps native scroll and ruler coordinates to the same beat', async () => {
    const wrapper = mount(ArrangementTimeline, { props })
    const scrollbar = wrapper.get<HTMLElement>('[aria-label="Timeline scroll"]')
    scrollbar.element.scrollLeft = 128
    await scrollbar.trigger('scroll')
    expect(wrapper.emitted('update:scrollLeft')).toEqual([[128]])
    expect(wrapper.emitted('update:follow')).toEqual([[false]])
    await wrapper.setProps({ scrollLeft: 128 })
    wrapper
      .get('.ruler')
      .element.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 64 }),
      )
    await nextTick()
    expect(wrapper.emitted('seek')).toEqual([[3]])
    await wrapper.get('.ruler').trigger('keydown', { key: 'End' })
    const seekEvents = wrapper.emitted('seek') ?? []
    expect(seekEvents[seekEvents.length - 1]).toEqual([32])
  })

  it('anchors zoom to the left-edge beat and clamps when the viewport is larger than the project', async () => {
    const wrapper = mount(ArrangementTimeline, { props: { ...props, scrollLeft: 128 } })
    await wrapper.setProps({ pixelsPerBeat: 96 })
    let scrollEvents = wrapper.emitted('update:scrollLeft') ?? []
    expect(scrollEvents[scrollEvents.length - 1]).toEqual([192])
    await wrapper.setProps({ endBeat: 0, pixelsPerBeat: 8, scrollLeft: 192 })
    scrollEvents = wrapper.emitted('update:scrollLeft') ?? []
    expect(scrollEvents[scrollEvents.length - 1]).toEqual([0])
  })

  it('fits long scores even when that requires a zoom below eight pixels per beat', async () => {
    const wrapper = mount(ArrangementTimeline, { props: { ...props, endBeat: 1000 } })
    await wrapper.vm.fit()
    const zoom = wrapper.emitted('update:pixelsPerBeat')?.[0]?.[0] as number
    expect(zoom).toBeGreaterThan(0)
    expect(zoom * 1002).toBeLessThanOrEqual(640)
  })

  it('bounds the ruler tick count even for clips far down the timeline', () => {
    const wrapper = mount(ArrangementTimeline, {
      props: { ...props, endBeat: 1_000_000, scrollLeft: 63_900_000 },
    })
    expect(wrapper.findAll('.ruler-mark').length).toBeLessThan(20)
  })

  it('keeps ordinary wheel scrolling vertical and uses Shift-wheel for panning', () => {
    const wrapper = mount(ArrangementTimeline, { props })
    const ruler = wrapper.get('.ruler').element
    const vertical = new WheelEvent('wheel', { deltaY: 64, bubbles: true, cancelable: true })
    ruler.dispatchEvent(vertical)
    expect(vertical.defaultPrevented).toBe(false)
    const horizontal = new WheelEvent('wheel', {
      deltaY: 64,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    ruler.dispatchEvent(horizontal)
    expect(horizontal.defaultPrevented).toBe(true)
    expect(wrapper.emitted('update:scrollLeft')).toEqual([[64]])
  })
})
