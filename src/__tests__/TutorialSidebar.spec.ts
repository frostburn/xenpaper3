import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TutorialSidebar from '../components/TutorialSidebar.vue'

describe('TutorialSidebar', () => {
  it('opens chapters from the top-level tutorial titles', async () => {
    const wrapper = mount(TutorialSidebar)

    expect(wrapper.text()).toContain('Notes, rests, and duration')
    await wrapper.get('button:nth-child(3)').trigger('click')

    expect(wrapper.text()).toContain('Staff clefs')
    expect(wrapper.text()).not.toContain('Notes, rests, and duration')
  })

  it('emits the selected demo tune', async () => {
    const wrapper = mount(TutorialSidebar)
    const tune = wrapper.get('button.tune')
    const source = tune.get('pre').text()

    await tune.trigger('click')

    expect(wrapper.emitted('selectTune')).toEqual([[source]])
  })
})
