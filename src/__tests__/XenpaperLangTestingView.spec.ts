import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import XenpaperLangTestingView from '../views/XenpaperLangTestingView.vue'

const { constructStaffNotationShape, evaluateScoreShape, parse } = vi.hoisted(() => ({
  constructStaffNotationShape: vi.fn<(shape: object) => object>(() => ({
    kind: 'note',
    pitch: { staffPosition: 0, accidentals: [], notehead: 'normal', cents: 0 },
  })),
  evaluateScoreShape: vi.fn<(expression: object) => object>(() => ({
    shape: { kind: 'attack' },
    diagnostics: [],
  })),
  parse: vi.fn<(source: string) => object>(() => ({
    type: 'Program',
    body: [{ type: 'Sequence' }],
  })),
}))
vi.mock('../../xenpaper-lang', () => ({
  constructStaffNotationShape,
  evaluateScoreShape,
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
    expect(evaluateScoreShape).toHaveBeenCalledWith({ type: 'Sequence' })
    expect(constructStaffNotationShape).toHaveBeenCalledWith({ kind: 'attack' })
    expect(wrapper.getComponent({ name: 'MusicalStaff' }).props('notation')).toMatchObject({
      kind: 'note',
      pitch: { staffPosition: 0 },
    })
  })
})
