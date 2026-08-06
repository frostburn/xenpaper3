import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MusicalStaff from '../components/MusicalStaff.vue'
import type { StaffNotationShape } from '../../xenpaper-lang'

const notation: StaffNotationShape = {
  kind: 'sequence',
  duration: { n: 2, d: 1 } as StaffNotationShape['duration'],
  children: [
    {
      kind: 'note',
      duration: { n: 1, d: 1 } as StaffNotationShape['duration'],
      pitch: {
        staffPosition: 0,
        accidentals: ['sharp'],
        notehead: 'normal',
        cents: 0,
      },
    },
    { kind: 'rest', duration: { n: 1, d: 1 } as StaffNotationShape['duration'], generated: false },
  ],
}

describe('MusicalStaff', () => {
  it('renders staff lines, notes, accidentals, ledger lines, and rests', () => {
    const wrapper = mount(MusicalStaff, { props: { notation } })

    expect(wrapper.findAll('.staff-lines line')).toHaveLength(5)
    expect(wrapper.findAll('.notehead')).toHaveLength(1)
    expect(wrapper.get('.accidental').text()).toBe('♯')
    expect(wrapper.findAll('.ledger-line')).toHaveLength(1)
    expect(wrapper.findAll('.rest')).toHaveLength(1)
  })

  it('shows an empty state before notation is populated', () => {
    expect(mount(MusicalStaff).get('.empty-message').text()).toBe('No notation loaded')
  })

  it('renders continues as repeated noteheads joined by ties', () => {
    const continued: StaffNotationShape = {
      kind: 'sequence',
      duration: notation.duration,
      children: [
        notation.children[0]!,
        { kind: 'continue', duration: notation.duration },
        { kind: 'continue', duration: notation.duration },
      ],
    }
    const wrapper = mount(MusicalStaff, { props: { notation: continued } })

    expect(wrapper.findAll('.notehead')).toHaveLength(3)
    expect(wrapper.findAll('.tie')).toHaveLength(2)
    expect(wrapper.findAll('.accidental')).toHaveLength(1)
  })
})
