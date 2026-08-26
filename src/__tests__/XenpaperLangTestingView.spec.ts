import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import XenpaperLangTestingView from '../views/XenpaperLangTestingView.vue'

describe('XenpaperLangTestingView', () => {
  it('loads tutorial tunes and compiles them to the exact score grid', async () => {
    const wrapper = mount(XenpaperLangTestingView)
    const tune = wrapper.get('button.tune')
    const source = tune.get('pre').text()

    await tune.trigger('click')

    expect(wrapper.get('textarea').element.value).toBe(source)
    expect(wrapper.get('[aria-label="Syntax-highlighted Xenpaper source"]').text()).toBe(source)
    expect(wrapper.get('.grid-summary').text()).toContain('beats')
    expect(wrapper.findAll('.grid-debugger tbody tr').length).toBeGreaterThan(0)
  })

  it('shows exact grid timing and pitch coordinates', async () => {
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('C D E')
    await wrapper.findAll('button')[0]!.trigger('click')

    expect(wrapper.get('.grid-summary').text()).toContain('Span: 3 beats · 3 events')
    const rows = wrapper.findAll('.grid-debugger tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.text()).toContain('absolute')
    expect(wrapper.findAllComponents({ name: 'MusicalStaff' })).toHaveLength(1)
    expect(wrapper.findAll('.staff-debugger .notehead')).toHaveLength(3)
    expect(rows[1]!.findAll('code')[0]!.text()).toContain('[-3 2>@2.3')
    expect(rows[1]!.findAll('code')[1]!.text()).toContain('[-3 2>@2.3')
  })

  it('logs the complete compilation result', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('C E G')
    await wrapper.findAll('button')[1]!.trigger('click')

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ grid: expect.objectContaining({ events: expect.any(Array) }) }),
    )
    log.mockRestore()
  })

  it('exposes syntax-highlight token ranges', async () => {
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('@tempo(120) C# # fast')
    await wrapper.findAll('button')[0]!.trigger('click')

    const highlighted = wrapper.get('[aria-label="Syntax-highlighted Xenpaper source"]')
    expect(highlighted.text()).toBe('@tempo(120) C# # fast')
    expect(highlighted.findAll('[data-highlight]').length).toBeGreaterThan(0)
    expect(wrapper.get('.highlight-debugger').text()).toContain('0–11')
  })

  it('renders compiler diagnostics instead of a partial grid', async () => {
    const wrapper = mount(XenpaperLangTestingView)
    await wrapper.get('textarea').setValue('= C D E')
    await wrapper.findAll('button')[0]!.trigger('click')

    expect(wrapper.text()).toContain('No grid compiled.')
    expect(wrapper.get('[aria-label="Compiler diagnostics"]').text()).toContain(
      'XP_CONTINUE_WITHOUT_ATTACK',
    )
  })
})

it('projects equal-tempered grids and renders structural barlines', async () => {
  const wrapper = mount(XenpaperLangTestingView)
  await wrapper.get('textarea').setValue('{31edo} C | D ||')
  await wrapper.findAll('button')[0]!.trigger('click')

  expect(wrapper.text()).not.toContain('No grid compiled.')
  expect(wrapper.find('.staff-debugger .barline--single').exists()).toBe(true)
  expect(wrapper.find('.staff-debugger .barline--double').exists()).toBe(true)
  expect(wrapper.find('.staff-debugger').text()).not.toContain('single')
  expect(wrapper.find('.staff-debugger').text()).not.toContain('double')
})
