import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MusicalStaff from '../components/MusicalStaff.vue'
import {
  constructStaffNotationShape,
  evaluateScoreShape,
  parse,
  type StaffNotationShape,
} from '../../xenpaper-lang'

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
  it.each(['C @2 D E @1 F G', 'C [D E] F G'])(
    'renders equivalent quarter and eighth note values for %s',
    (source) => {
      const expression = parse(source).body[0]!
      const evaluated = evaluateScoreShape(expression)
      if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
      const wrapper = mount(MusicalStaff, {
        props: { notation: constructStaffNotationShape(evaluated.shape) },
      })

      expect(wrapper.findAll('.notehead')).toHaveLength(5)
      expect(wrapper.findAll('.flag')).toHaveLength(2)
    },
  )

  it('renders sixteenth-note subdivisions with two flags', () => {
    const expression = parse('@4 C D E F').body[0]!
    const evaluated = evaluateScoreShape(expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.notehead')).toHaveLength(4)
    expect(wrapper.findAll('.flag')).toHaveLength(8)
  })

  it('renders a three-note normalized slot as a triplet', () => {
    const expression = parse('[C D E]').body[0]!
    const evaluated = evaluateScoreShape(expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.notehead')).toHaveLength(3)
    expect(wrapper.findAll('.flag')).toHaveLength(3)
    expect(wrapper.get('.tuplet-number').text()).toBe('3')
    expect(wrapper.findAll('.tuplet-bracket')).toHaveLength(1)
  })

  it('brackets the full extent of a quintuplet', () => {
    const expression = parse('C [D E F G G] F').body[0]!
    const evaluated = evaluateScoreShape(expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.get('.tuplet-number').text()).toBe('5')
    expect(wrapper.get('.tuplet-bracket').attributes('d')).toBe(
      'M 102 40 V 34 H 206 M 226 34 H 330 V 40',
    )
  })

  it('infers a triplet with an intact continued note', () => {
    const expression = parse('C [F G=] F').body[0]!
    const evaluated = evaluateScoreShape(expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.get('.tuplet-number').text()).toBe('3')
    expect(wrapper.findAll('.tuplet-bracket')).toHaveLength(1)
    expect(wrapper.findAll('.flag')).toHaveLength(1)
  })

  it('uses an eighth-rest glyph in a two-item normalized slot', () => {
    const expression = parse('C [F .] F').body[0]!
    const evaluated = evaluateScoreShape(expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.get('.rest').text()).toBe('𝄾')
  })

  it('renders whole, half, and dotted rests', () => {
    const evaluated = evaluateScoreShape(parse('@1/4 . @1/2 . @1 ...').body[0]!)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.rest-box')).toHaveLength(3)
    expect(wrapper.findAll('.rest-box--whole')).toHaveLength(1)
    expect(wrapper.findAll('.rest-box--half')).toHaveLength(2)
    expect(wrapper.get('.rest-box--whole').attributes()).toMatchObject({ y: '64', height: '6' })
    expect(wrapper.get('.rest-box--half').attributes()).toMatchObject({ y: '70', height: '6' })
    expect(wrapper.findAll('.rest-dot')).toHaveLength(1)
  })

  it('extends every note in a continued binary normalized slot', () => {
    const evaluated = evaluateScoreShape(parse('[C D]=').body[0]!)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.notehead')).toHaveLength(2)
    expect(wrapper.findAll('.flag')).toHaveLength(0)
    expect(wrapper.findAll('.augmentation-dot')).toHaveLength(0)
  })

  it('extends a normalized note and rest without continuing through the rest barrier', () => {
    const evaluated = evaluateScoreShape(parse('[C .]=').body[0]!)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.notehead')).toHaveLength(1)
    expect(wrapper.findAll('.flag')).toHaveLength(0)
    expect(wrapper.findAll('.notehead--open')).toHaveLength(0)
    expect(wrapper.get('.rest').text()).toBe('𝄽')
  })

  it('does not mark an ordinary three-note sequence as a triplet', () => {
    const expression = parse('C D E').body[0]!
    const evaluated = evaluateScoreShape(expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.find('.tuplet-number').exists()).toBe(false)
    expect(wrapper.findAll('.flag')).toHaveLength(0)
  })

  it('aligns parallel branches in the same staff columns', () => {
    const expression = parse('C D, E F').body[0]!
    const evaluated = evaluateScoreShape(expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('ellipse.notehead').map((note) => note.attributes('cx'))).toEqual([
      '60',
      '112',
      '60',
      '112',
    ])
  })

  it('aligns parallel branches by rhythmic offset across different subdivisions', () => {
    const expression = parse('C D, [E F] [G A]').body[0]!
    const evaluated = evaluateScoreShape(expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('ellipse.notehead').map((note) => note.attributes('cx'))).toEqual([
      '60',
      '164',
      '60',
      '112',
      '164',
      '216',
    ])
  })

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
        { kind: 'continue', duration: { n: 1, d: 1 } as StaffNotationShape['duration'] },
        { kind: 'continue', duration: { n: 1, d: 1 } as StaffNotationShape['duration'] },
      ],
    }
    const wrapper = mount(MusicalStaff, { props: { notation: continued } })

    expect(wrapper.findAll('.notehead')).toHaveLength(1)
    expect(wrapper.findAll('.notehead--open')).toHaveLength(1)
    expect(wrapper.findAll('.tie')).toHaveLength(0)
    expect(wrapper.findAll('.accidental')).toHaveLength(1)
  })

  it('renders explicit half and whole note durations', () => {
    const expression = parse('@1/2 C D @1/4 E').body[0]!
    const evaluated = evaluateScoreShape(expression)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.notehead--open')).toHaveLength(3)
    expect(wrapper.findAll('.stem')).toHaveLength(2)
  })

  it('renders two continues as a dotted half note', () => {
    const evaluated = evaluateScoreShape(parse('C==').body[0]!)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.notehead')).toHaveLength(1)
    expect(wrapper.findAll('.notehead--open')).toHaveLength(1)
    expect(wrapper.findAll('.stem')).toHaveLength(1)
    expect(wrapper.findAll('.augmentation-dot')).toHaveLength(1)
  })

  it('distinguishes half, dotted-half, and whole-note continues', () => {
    const evaluated = evaluateScoreShape(parse('C= D== E===').body[0]!)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.notehead--open')).toHaveLength(3)
    expect(wrapper.findAll('.stem')).toHaveLength(2)
    expect(wrapper.findAll('.augmentation-dot')).toHaveLength(1)
  })

  it('shows a question mark instead of approximating an unsupported note duration', () => {
    const evaluated = evaluateScoreShape(parse('C====').body[0]!)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.get('.notation-error').text()).toBe('?')
    expect(wrapper.find('.notehead').exists()).toBe(false)
    expect(wrapper.find('.stem').exists()).toBe(false)
    expect(wrapper.find('.augmentation-dot').exists()).toBe(false)
  })

  it('shows a question mark for unsupported rest durations', () => {
    const wrapper = mount(MusicalStaff, {
      props: {
        notation: {
          kind: 'rest',
          duration: { n: 5, d: 1 } as StaffNotationShape['duration'],
          generated: false,
        },
      },
    })

    expect(wrapper.get('.rest').text()).toBe('?')
  })

  it('preserves exact effective durations in large normalized tuplets', () => {
    const source = `[${Array.from({ length: 48 }, () => 'C').join(' ')} .]`
    const evaluated = evaluateScoreShape(parse(source).body[0]!)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.notehead')).toHaveLength(48)
    expect(wrapper.find('.notation-error').exists()).toBe(false)
    expect(wrapper.get('.rest').text()).toBe('𝄾')
  })

  it('extends notes and chords through following continues', () => {
    for (const source of ['C=', '[C, E, G]=']) {
      const evaluated = evaluateScoreShape(parse(source).body[0]!)
      if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
      const wrapper = mount(MusicalStaff, {
        props: { notation: constructStaffNotationShape(evaluated.shape) },
      })
      expect(wrapper.findAll('.notehead--open')).toHaveLength(source === 'C=' ? 1 : 3)
      expect(wrapper.findAll('.tie')).toHaveLength(0)
    }
  })

  it('extends a continued bracket slot into quarter-note triplets', () => {
    const evaluated = evaluateScoreShape(parse('[C E G]=').body[0]!)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.notehead')).toHaveLength(3)
    expect(wrapper.findAll('.flag')).toHaveLength(0)
    expect(wrapper.get('.tuplet-number').text()).toBe('3')
    expect(wrapper.findAll('.tuplet-bracket')).toHaveLength(1)
  })

  it('resolves a twice-continued bracket slot into regular quarter notes', () => {
    const evaluated = evaluateScoreShape(parse('[C E G]==').body[0]!)
    if (!('shape' in evaluated)) throw new Error('Expected a score shape.')
    const wrapper = mount(MusicalStaff, {
      props: { notation: constructStaffNotationShape(evaluated.shape) },
    })

    expect(wrapper.findAll('.notehead')).toHaveLength(3)
    expect(wrapper.findAll('.notehead--open')).toHaveLength(0)
    expect(wrapper.findAll('.stem')).toHaveLength(3)
    expect(wrapper.findAll('.flag')).toHaveLength(0)
    expect(wrapper.find('.tuplet-number').exists()).toBe(false)
    expect(wrapper.find('.tuplet-bracket').exists()).toBe(false)
  })

  it('renders barlines without interrupting continued notes', () => {
    const barred: StaffNotationShape = {
      kind: 'sequence',
      duration: notation.duration,
      children: [
        notation.children[0]!,
        {
          kind: 'barline',
          style: 'single',
          duration: { n: 0, d: 1 } as StaffNotationShape['duration'],
        },
        { kind: 'continue', duration: notation.duration },
      ],
    }
    const wrapper = mount(MusicalStaff, { props: { notation: barred } })

    expect(wrapper.findAll('.barline')).toHaveLength(1)
    expect(wrapper.findAll('.notehead')).toHaveLength(1)
    expect(wrapper.findAll('.notehead--open')).toHaveLength(1)
    expect(wrapper.findAll('.tie')).toHaveLength(0)
  })

  it('renders double and repeat barlines with repeat dots', () => {
    const duration = { n: 0, d: 1 } as StaffNotationShape['duration']
    const structural: StaffNotationShape = {
      kind: 'sequence',
      duration,
      children: [
        { kind: 'barline', style: 'double', duration },
        { kind: 'barline', style: 'repeat-start', duration },
        { kind: 'barline', style: 'repeat-end', duration },
      ],
    }
    const wrapper = mount(MusicalStaff, { props: { notation: structural } })

    expect(wrapper.findAll('.barline--double line')).toHaveLength(2)
    expect(wrapper.findAll('.barline--repeat-start circle')).toHaveLength(2)
    expect(wrapper.findAll('.barline--repeat-end circle')).toHaveLength(2)
  })

  it('renders an x notehead for context-dependent repeat appearances', () => {
    const crossed: StaffNotationShape = {
      kind: 'note',
      duration: notation.duration,
      pitch: {
        staffPosition: 3,
        accidentals: [],
        notehead: 'x',
        cents: 500,
      },
      soundingLabel: '1/1',
    }
    const wrapper = mount(MusicalStaff, { props: { notation: crossed } })

    expect(wrapper.findAll('.x-notehead line')).toHaveLength(2)
    expect(wrapper.find('ellipse.notehead').exists()).toBe(false)
    expect(wrapper.get('.sounding-label').text()).toBe('1/1')
    expect(wrapper.get('.sounding-label').attributes('y')).toBe('130')
  })

  it('renders root-change annotations above the staff', () => {
    const annotated: StaffNotationShape = {
      kind: 'annotation',
      text: 'root = D',
      duration: { n: 0, d: 1 } as StaffNotationShape['duration'],
    }
    const wrapper = mount(MusicalStaff, { props: { notation: annotated } })

    expect(wrapper.get('.annotation').text()).toBe('root = D')
    expect(wrapper.get('.annotation').attributes('y')).toBe('25')
  })

  it('renders ASCII-style operators and flavored numeric FJS inflections before accidentals', () => {
    const decorated: StaffNotationShape = {
      kind: 'note',
      duration: notation.duration,
      pitch: {
        staffPosition: 2,
        inflections: [
          { kind: 'up' },
          { kind: 'down' },
          { kind: 'lift' },
          { kind: 'drop' },
          { direction: 'numerator', prime: 5n, flavor: 'c' },
          { direction: 'denominator', prime: 7n, flavor: 'n' },
        ],
        accidentals: ['flat'],
        notehead: 'normal',
        cents: 0,
      },
    }
    const wrapper = mount(MusicalStaff, { props: { notation: decorated } })

    expect(wrapper.findAll('.inflection').map((element) => element.text())).toEqual([
      '^',
      'v',
      '/',
      '\\',
      '5c',
      '/7n',
    ])
    expect(wrapper.get('.pitch-decorations').text()).toBe('^v/\\5c/7n♭')
    expect(
      wrapper.get('.pitch-decorations').element.lastElementChild?.classList.contains('accidental'),
    ).toBe(true)
  })
})
