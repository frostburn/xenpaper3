import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import XenpaperLangTestingView from '../views/XenpaperLangTestingView.vue'

const { constructStaffNotationShape, evaluateProgramShape, expandToBeatEvents, parse } = vi.hoisted(
  () => ({
    constructStaffNotationShape: vi.fn<(shape: object) => object>(() => ({
      kind: 'note',
      pitch: { staffPosition: 0, accidentals: [], notehead: 'normal', cents: 0 },
    })),
    evaluateProgramShape: vi.fn<(program: object) => object>(() => ({
      shape: { kind: 'attack' },
      diagnostics: [],
    })),
    expandToBeatEvents: vi.fn<() => object>(() => ({
      score: { duration: { valueOf: () => 1 }, events: [] },
      diagnostics: [],
    })),
    parse: vi.fn<(source: string) => object>((source) => ({
      type: 'Program',
      source,
      body: [{ type: 'Sequence' }],
      comments: [],
      location: { start: { offset: 0 }, end: { offset: source.length } },
    })),
  }),
)
vi.mock('../../xenpaper-lang', () => ({
  constructStaffNotationShape,
  evaluateProgramShape,
  expandToBeatEvents,
  parse,
}))

describe('XenpaperLangTestingView', () => {
  it('loads tutorial tunes into the editor and populates the visualisers', async () => {
    parse.mockClear()
    const wrapper = mount(XenpaperLangTestingView)
    const tune = wrapper.get('button.tune')
    const source = tune.get('pre').text()

    await tune.trigger('click')

    expect(wrapper.get('textarea').element.value).toBe(source)
    expect(wrapper.get('[aria-label="Syntax-highlighted Xenpaper source"]').text()).toBe(source)
    expect(parse).toHaveBeenCalledWith(source)
    expect(expandToBeatEvents).toHaveBeenCalled()
    expect(evaluateProgramShape).toHaveBeenCalled()
  })

  it('parses and logs the textarea contents', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('C E G')
    await wrapper.findAll('button')[0]!.trigger('click')

    expect(parse).toHaveBeenCalledWith('C E G')
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Program',
        source: 'C E G',
        body: [{ type: 'Sequence' }],
      }),
    )
    log.mockRestore()
  })

  it('renders a separate highlighted copy and exposes its token ranges for debugging', async () => {
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('@tempo(120) C# # fast')

    expect(wrapper.get('[aria-label="Syntax-highlighted Xenpaper source"]').text()).toBe('')
    await wrapper.findAll('button')[0]!.trigger('click')

    const highlighted = wrapper.get('[aria-label="Syntax-highlighted Xenpaper source"]')
    expect(highlighted.text()).toBe('@tempo(120) C# # fast')
    expect(highlighted.findAll('[data-highlight="punctuation"]').length).toBeGreaterThan(0)
    expect(wrapper.get('.highlight-debugger').text()).toContain('0–11')
    expect(wrapper.get('.highlight-debugger').text()).toContain('punctuation')
  })

  it('populates the staff from the parsed source', async () => {
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('C D E')
    await wrapper.findAll('button')[1]!.trigger('click')

    expect(parse).toHaveBeenCalledWith('C D E')
    expect(evaluateProgramShape).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Program',
        body: [{ type: 'Sequence' }],
      }),
    )
    expect(constructStaffNotationShape).toHaveBeenCalledWith({ kind: 'attack' })
    expect(expandToBeatEvents).toHaveBeenCalled()
    expect(wrapper.getComponent({ name: 'PianoRoll' }).props('score')).toMatchObject({ events: [] })
    expect(wrapper.getComponent({ name: 'MusicalStaff' }).props('notation')).toMatchObject({
      kind: 'note',
      pitch: { staffPosition: 0 },
    })
  })

  it('logs the current staff notation', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.findAll('button')[1]!.trigger('click')
    await wrapper.findAll('button')[2]!.trigger('click')

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'note',
        pitch: expect.objectContaining({ staffPosition: 0 }),
      }),
    )
    log.mockRestore()
  })

  it('does not populate either visualiser when beat expansion rejects the score', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    evaluateProgramShape.mockClear()
    expandToBeatEvents.mockReturnValueOnce({
      diagnostics: [{ code: 'XP_CONTINUE_WITHOUT_ATTACK', severity: 'error' }],
    })
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('= C D E F G')
    await wrapper.findAll('button')[1]!.trigger('click')

    expect(evaluateProgramShape).not.toHaveBeenCalled()
    expect(wrapper.getComponent({ name: 'PianoRoll' }).props('score')).toBeUndefined()
    expect(wrapper.getComponent({ name: 'MusicalStaff' }).props('notation')).toBeUndefined()
    expect(warn).toHaveBeenCalledWith([{ code: 'XP_CONTINUE_WITHOUT_ATTACK', severity: 'error' }])
    warn.mockRestore()
  })
})
