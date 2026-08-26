import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { compile } from '../../xenpaper-lang'
import MusicalStaff from '../components/MusicalStaff.vue'
import { projectGridToStaffNotation } from '../music/staff-notation-projection'

describe('staff notation projection', () => {
  it('does not engrave articulation release as rests or tuplets', () => {
    const result = compile(`@. 0 2 4 7 .
@: 0 2 4 7 .
@- 0 2 4 7 .
@_ 0 2 4 7 .
@art(75%) 0 2 4 7`)
    if (!('grid' in result)) throw new Error('Expected a compiled grid.')

    const notation = projectGridToStaffNotation(result.grid)
    if (notation.kind !== 'sequence') throw new Error('Expected a staff sequence.')

    expect(notation.children.filter((item) => item.kind === 'note')).toHaveLength(20)
    expect(notation.children.filter((item) => item.kind === 'rest')).toHaveLength(4)

    const wrapper = mount(MusicalStaff, { props: { notation } })
    expect(wrapper.findAll('.rest')).toHaveLength(4)
    expect(wrapper.find('.tuplet-number').exists()).toBe(false)
  })
})
