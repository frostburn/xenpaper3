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
    parse: vi.fn<(source: string) => object>(() => ({
      type: 'Program',
      body: [{ type: 'Sequence' }],
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
  it('parses and logs the textarea contents', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('C E G')
    await wrapper.findAll('button')[0]!.trigger('click')

    expect(parse).toHaveBeenCalledWith('C E G')
    expect(log).toHaveBeenCalledWith({ type: 'Program', body: [{ type: 'Sequence' }] })
    log.mockRestore()
  })

  it('populates the staff from the parsed source', async () => {
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('C D E')
    await wrapper.findAll('button')[1]!.trigger('click')

    expect(parse).toHaveBeenCalledWith('C D E')
    expect(evaluateProgramShape).toHaveBeenCalledWith({
      type: 'Program',
      body: [{ type: 'Sequence' }],
    })
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
