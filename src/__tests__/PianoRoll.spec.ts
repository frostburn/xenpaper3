import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { Fraction } from 'xen-dev-utils/fraction'
import type { BeatTimedScore } from '../../xenpaper-lang/runtime/types'
import { Value } from '../../xenpaper-lang/value'
import PianoRoll from '../components/PianoRoll.vue'
import PianoRollInspector from '../components/PianoRollInspector.vue'

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
    expect(wrapper.get('.inspection-line').attributes('x1')).toBe('-1000')
    expect(wrapper.get('.inspection-line').attributes('x2')).toBe('203.33333333333331')
    expect(wrapper.get('.cents-label text').text()).toBe('700.00¢')
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

  it('box-selects notes and emits inspectable element information', async () => {
    const score: BeatTimedScore = {
      duration: new Fraction(2),
      events: [
        {
          kind: 'note',
          start: new Fraction(0),
          duration: new Fraction(1),
          pitch: { kind: 'pitchOffset', value: Value.cents(700), origins: [] },
          dynamic: new Fraction(1, 2),
          label: 'selected G',
          origins: [],
        },
        {
          kind: 'note',
          start: new Fraction(1),
          duration: new Fraction(1),
          pitch: { kind: 'pitchOffset', value: Value.cents(0), origins: [] },
          dynamic: new Fraction(1, 2),
          label: 'not selected',
          origins: [],
        },
      ],
    }
    const wrapper = mount(PianoRoll, { props: { score } })
    const grid = wrapper.get('svg.grid')

    await grid.trigger('mousedown', { clientX: 65, clientY: 120 })
    await grid.trigger('mousemove', { clientX: 175, clientY: 135 })
    expect(wrapper.get('.selection-box').attributes()).toMatchObject({
      x: '65',
      y: '120',
      width: '110',
      height: '15',
    })
    await grid.trigger('mouseup', { clientX: 175, clientY: 135 })

    expect(wrapper.findAll('.note.selected')).toHaveLength(1)
    expect(wrapper.find('.selection-box').exists()).toBe(false)
    const inspectionEvents = wrapper.emitted('inspectionChange')!
    expect(inspectionEvents[inspectionEvents.length - 1]![0]).toEqual({
      inspected: undefined,
      selected: [
        {
          index: 0,
          label: 'selected G',
          kind: 'note',
          pitchKind: 'pitchOffset',
          cents: 700,
          start: '0',
          duration: '1',
          end: '1',
        },
      ],
    })
  })

  it('renders inspection details in a separate expandable inspector', () => {
    const wrapper = mount(PianoRollInspector, {
      props: {
        inspection: {
          selected: [
            {
              index: 2,
              label: 'P5',
              kind: 'note',
              pitchKind: 'pitchOffset',
              cents: 701.955,
              start: '1/2',
              duration: '1',
              end: '1 1/2',
            },
          ],
        },
      },
    })

    expect(wrapper.get('p').text()).toBe('1 note selected')
    expect(wrapper.get('details').attributes()).not.toHaveProperty('open')
    expect(wrapper.get('summary').text()).toBe('Element details')
    expect(wrapper.get('.selected-elements li').text()).toContain('1/2–1 1/2 beats, 701.96¢')
  })
})
