import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { Fraction } from 'xen-dev-utils/fraction'
import type { BeatTimedScore } from '../../xenpaper-lang/runtime/types'
import { Value } from '../../xenpaper-lang/value'
import PianoRoll from '../components/PianoRoll.vue'

describe('PianoRoll', () => {
  it('renders Value and Fraction instances received through a deep Vue proxy', async () => {
    const score = reactive<BeatTimedScore>({
      duration: new Fraction(2),
      events: [
        {
          kind: 'note',
          start: new Fraction(4, 3),
          duration: new Fraction(2, 3),
          pitch: {
            kind: 'pitchOffset',
            value: Value.cents(700),
            origins: [],
          },
          dynamic: new Fraction(1, 2),
          label: 'G',
          origins: [],
        },
        {
          kind: 'note',
          start: new Fraction(0),
          duration: new Fraction(1, 3),
          pitch: {
            kind: 'absolutePitch',
            rootOffset: Value.cents(0),
            value: Value.cents(0),
            formula: new Map(),
            spelling: { nominal: 'C', raw: 'C', system: 'latin' },
            origins: [],
          },
          dynamic: new Fraction(1, 2),
          origins: [],
        },
        {
          kind: 'note',
          start: new Fraction(1, 3),
          duration: new Fraction(1, 3),
          pitch: {
            kind: 'pitchOffset',
            value: Value.cents(700),
            spelling: { quality: 'P', number: 5n, raw: 'P5' },
            origins: [],
          },
          dynamic: new Fraction(1, 2),
          origins: [],
        },
      ],
    })

    const wrapper = mount(
      defineComponent({
        setup: () => () => h(PianoRoll, { score: score as unknown as BeatTimedScore }),
      }),
    )

    expect(wrapper.findAll('rect.note')).toHaveLength(3)
    expect(wrapper.findAll('rect.note title').map((title) => title.text())).toEqual([
      'G',
      'C',
      'P5',
    ])
    expect(wrapper.findAll('.beat-line').map((line) => line.attributes('x1'))).toEqual([
      '70',
      '170',
      '270',
    ])

    await wrapper.get('rect.note').trigger('mouseenter')
    expect(wrapper.get('.inspection-line').attributes('x1')).toBe('0')
    expect(wrapper.get('.inspection-line').attributes('x2')).toBe('203.33333333333331')
    expect(wrapper.get('.cents-label text').text()).toBe('700.00¢')
    expect(wrapper.get('.cents-label line').attributes('x2')).toBe('200')
    expect(wrapper.findAll('.boundary-line')).toHaveLength(2)
    expect(wrapper.findAll('.beat-label').map((label) => label.text())).toEqual(['1 1/3', '2'])

    await wrapper.get('rect.note').trigger('mouseleave')
    expect(wrapper.find('.inspection-line').exists()).toBe(false)
  })

  it('leaves room for the final boundary label', async () => {
    const score: BeatTimedScore = {
      duration: new Fraction(7),
      events: [
        {
          kind: 'note',
          start: new Fraction(6),
          duration: new Fraction(1),
          pitch: {
            kind: 'pitchOffset',
            value: Value.cents(0),
            origins: [],
          },
          dynamic: new Fraction(1, 2),
          label: '1/1',
          origins: [],
        },
      ],
    }
    const wrapper = mount(PianoRoll, { props: { score } })

    await wrapper.get('rect.note').trigger('mouseenter')

    expect(wrapper.get('svg.grid').attributes('viewBox')).toBe('0 0 820 320')
    const endLabel = wrapper.findAll('.beat-label')[1]!
    expect(endLabel.attributes('x')).toBe('770')
    expect(endLabel.text()).toBe('7')
  })
})
