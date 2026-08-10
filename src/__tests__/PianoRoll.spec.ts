import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { Fraction } from 'xen-dev-utils/fraction'
import type { BeatTimedScore } from '../../xenpaper-lang/runtime/types'
import { Value } from '../../xenpaper-lang/value'
import PianoRoll from '../components/PianoRoll.vue'

describe('PianoRoll', () => {
  it('renders Value and Fraction instances received through a deep Vue proxy', () => {
    const score = reactive<BeatTimedScore>({
      duration: new Fraction(2),
      events: [
        {
          kind: 'note',
          start: new Fraction(1, 3),
          duration: new Fraction(2, 3),
          pitch: {
            kind: 'pitchOffset',
            value: Value.cents(700),
            origins: [],
          },
          rootStaffPosition: 0,
          dynamic: new Fraction(1, 2),
          label: 'G',
          origins: [],
        },
      ],
    })

    const wrapper = mount(
      defineComponent({
        setup: () => () => h(PianoRoll, { score: score as unknown as BeatTimedScore }),
      }),
    )

    expect(wrapper.findAll('rect.note')).toHaveLength(1)
    expect(wrapper.get('rect.note title').text()).toContain('G — beat 0.3333333333333333')
    expect(wrapper.findAll('.beat-line').map((line) => line.attributes('x1'))).toEqual([
      '70',
      '170',
      '270',
    ])
  })
})
