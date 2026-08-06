import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import XenpaperLangTestingView from '../views/XenpaperLangTestingView.vue'

const { parse } = vi.hoisted(() => ({
  parse: vi.fn<(source: string) => object>(() => ({ type: 'Program' })),
}))
vi.mock('../../xenpaper-lang', () => ({ parse }))

describe('XenpaperLangTestingView', () => {
  it('parses and logs the textarea contents', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('C E G')
    await wrapper.get('button').trigger('click')

    expect(parse).toHaveBeenCalledWith('C E G')
    expect(log).toHaveBeenCalledWith({ type: 'Program' })
    log.mockRestore()
  })
})
