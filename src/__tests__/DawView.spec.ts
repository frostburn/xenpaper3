import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { Fraction } from 'xen-dev-utils'
import router from '../router'
import DawView from '../views/DawView.vue'
import InstrumentPianoRollLane from '../components/daw/InstrumentPianoRollLane.vue'
import DrumLane from '../components/daw/DrumLane.vue'
import {
  OSCILLATOR_TYPES,
  beat,
  beatToNumber,
  createDefaultProject,
  createClip,
  createDrumLane,
  createInstrumentLane,
  pointerXToBeat,
  snapBeat,
} from '../daw/project'
import {
  parseProjectNotes,
  parseClipNotes,
  parseDrumClipNotes,
  notePlaybackWindow,
  easeGlissando,
  glissandoPitchAtBeat,
  glissandoPitchAtElapsedTime,
  glissandoCurveDuration,
  projectBeatToSeconds,
  projectSecondsToBeat,
  sourceClipLength,
} from '../daw/audio-engine'
import { compileSourceInitialization, drumSamplesForLane } from '../daw/score'

describe('DAW project model', () => {
  it('offers periodic and aperiodic oscillator timbres', () => {
    expect(OSCILLATOR_TYPES).toContain('rich')
    expect(OSCILLATOR_TYPES).toContain('piano')
    expect(OSCILLATOR_TYPES).toContain('steel')
  })

  it('resumes sustained notes at the playhead with their remaining duration', () => {
    expect(notePlaybackWindow(0, 4, 2)).toEqual({ startBeat: 2, endBeat: 4 })
    expect(notePlaybackWindow(3, 1, 2)).toEqual({ startBeat: 3, endBeat: 4 })
    expect(notePlaybackWindow(0, 2, 2)).toBeUndefined()
  })

  it('creates the production-ready project defaults', () => {
    const project = createDefaultProject()

    expect(project.globalTrack.tempoChanges).toEqual([{ id: 'tempo-1', beat: beat(0), bpm: 120 }])
    expect(project.globalTrack.source).toContain('Shared tuning')
    expect(project.globalTrack.timeSignatureChanges[0]).toMatchObject({
      id: 'time-signature-1',
      beat: beat(0),
      numerator: 4,
      denominator: 4,
    })
    expect(project.instrumentLanes[0]).toMatchObject({
      id: 'instrument-1',
      patchSource: 'default',
      oscillatorType: 'sawtooth',
      source: expect.stringContaining('@adsr(100ms'),
      clips: [],
    })
    expect(JSON.parse(JSON.stringify(project), Fraction.reviver)).toEqual(project)
  })

  it('creates an instrument lane with a reusable unique number', () => {
    const project = createDefaultProject()
    project.instrumentLanes.push(createInstrumentLane(project))
    project.instrumentLanes.splice(0, 1)

    const lane = createInstrumentLane(project)
    expect(lane).toMatchObject({ id: 'instrument-1', name: 'Instrument 1', clips: [] })
    expect(lane.source).toContain('@adsr(100ms')
  })

  it('creates drum lanes with a basic 4/4 clip and named events', () => {
    const project = createDefaultProject()
    const lane = createDrumLane(project)
    const clip = createClip(lane, beat(0))
    const samples = drumSamplesForLane(lane)

    expect(lane).toMatchObject({ id: 'drum-1', kind: 'drum', patchSource: 'drumkit' })
    expect(clip.source).toContain('[bd,hh hh] [hh hh] [sd,hh hh] [hh hh]')
    expect(
      parseDrumClipNotes(clip.source, samples).map(({ beat, sample }) => [beat, sample]),
    ).toEqual([
      [0, 'bd'],
      [0, 'hh'],
      [0.5, 'hh'],
      [1, 'hh'],
      [1.5, 'hh'],
      [2, 'sd'],
      [2, 'hh'],
      [2.5, 'hh'],
      [3, 'hh'],
      [3.5, 'hh'],
    ])
  })

  it('converts scrolled, zoomed pointer coordinates and snaps exactly', () => {
    expect(pointerXToBeat(96, 32, 64)).toBe(2)
    expect(snapBeat(2.13, beat(1, 4))).toEqual(beat(9, 4))
    expect(beat(-1, 2).valueOf()).toBe(-0.5)
  })

  it('parses Xenpaper clip notes and offsets them onto the project timeline', () => {
    const project = createDefaultProject()
    project.instrumentLanes[0]!.clips.push({
      id: 'melody',
      start: beat(2),
      length: beat(4),
      source: 'C D E',
    })

    const notes = parseProjectNotes(project)
    expect(notes).toHaveLength(3)
    expect(notes.map(({ beat: start }) => start)).toEqual([2, 3, 4])
    expect(notes.every(({ duration }) => duration === 1)).toBe(true)
    expect(notes[0]!.cents).not.toBe(notes[1]!.cents)
  })

  it('parses clip-local notes for piano-roll rendering', () => {
    expect(parseClipNotes('C D E', 2)).toMatchObject([
      { beat: 0, duration: 1, cents: 0 },
      { beat: 1, duration: 1 },
    ])
  })

  it('converts scheduled pitches and glissandi to SW Patch A-based cents', () => {
    const project = createDefaultProject()
    project.instrumentLanes[0]!.clips.push({
      id: 'gliss',
      start: beat(0),
      length: beat(2),
      source: '@gliss C A',
    })
    const clipNotes = parseClipNotes('@gliss C A')
    const notes = parseProjectNotes(project)

    expect(notes[0]!.cents).toBe(clipNotes[0]!.cents - 900)
    expect(notes[0]!.glissando![0]!.from).toBe(clipNotes[0]!.glissando![0]!.from - 900)
    expect(notes[0]!.glissando![0]!.to).toBe(clipNotes[0]!.glissando![0]!.to - 900)
  })

  it('derives clip length from source and keeps zero-duration source visible for a bar', () => {
    expect(sourceClipLength('C D E')).toEqual(beat(3))
    expect(sourceClipLength('# only a comment')).toEqual(beat(4))
    expect(sourceClipLength('@tempo(120)')).toEqual(beat(4))
  })

  it('derives clip length using pitch context inherited from initialization sources', () => {
    const initialization = compileSourceInitialization('MOS{5L4s}')

    expect(sourceClipLength('J K L M N O P Q R j', beat(4), [], initialization)).toEqual(beat(10))
  })

  it('carries authored patch envelope parameters into scheduled notes', () => {
    const project = createDefaultProject()
    project.instrumentLanes[0]!.clips.push({
      id: 'envelope',
      start: beat(0),
      length: beat(4),
      source: '@patch(attack: 20ms, decay: 150ms, sustain: 55%, release: 400ms) C',
    })

    expect(parseProjectNotes(project)[0]!.envelope).toMatchObject({
      attack: expect.closeTo(0.02),
      decay: expect.closeTo(0.15),
      sustain: expect.closeTo(0.55),
      release: expect.closeTo(0.4),
    })
  })

  it('supports concise ADSR envelopes and partial patch updates across aliases', () => {
    const notes = parseClipNotes('@adsr(100ms, 200ms, 70%, 300ms) C @patch(sustain: 45%) D')

    expect(notes[0]!.envelope).toMatchObject({
      attack: expect.closeTo(0.1),
      decay: expect.closeTo(0.2),
      sustain: expect.closeTo(0.7),
      release: expect.closeTo(0.3),
    })
    expect(notes[1]!.envelope).toMatchObject({
      attack: expect.closeTo(0.1),
      decay: expect.closeTo(0.2),
      sustain: expect.closeTo(0.45),
      release: expect.closeTo(0.3),
    })
  })

  it('keeps ADSR changes lexical and supports initialization and drum sources', () => {
    const scoped = parseClipNotes('C (@adsr(10ms, 20ms, 30%, 40ms) D) E')
    expect(scoped.find(({ beat: start }) => start === 0)!.envelope.attack).toBe(0.1)
    expect(scoped.find(({ envelope }) => envelope.attack === 0.01)).toBeDefined()
    expect(scoped.find(({ beat: start }) => start === 2)!.envelope.attack).toBe(0.1)

    const initialization = compileSourceInitialization('@adsr(20ms, 30ms, 40%, 50ms)')
    expect(parseClipNotes('C', Infinity, initialization)[0]!.envelope.sustain).toBe(0.4)
    expect(parseDrumClipNotes('@adsr(20ms, 30ms, 40%, 50ms) bd', ['bd'])[0]!.envelope).toEqual({
      attack: 0.02,
      decay: 0.03,
      sustain: 0.4,
      release: 0.05,
    })
  })

  it('reports clear ADSR shape, scalar, and dimension diagnostics', () => {
    expect(() => parseClipNotes('@adsr(100ms, 200ms, 70%) C')).toThrow(
      'exactly four positional arguments',
    )
    expect(() =>
      parseClipNotes('@adsr(attack: 100ms, decay: 200ms, sustain: 70%, release: 300ms) C'),
    ).toThrow('positional arguments only')
    expect(() => parseClipNotes('@adsr(C, 200ms, 70%, 300ms) D')).toThrow('must be scalar')
    expect(() => parseClipNotes('@adsr(100, 200ms, 70%, 300ms) C')).toThrow('must be a time value')
    expect(() => parseClipNotes('@patch(sustain: 100ms) C')).toThrow('must be dimensionless')
  })

  it('uses lane ADSR defaults and keeps clip patch directives as overrides', () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    lane.source = '@patch(attack: 30ms, decay: 400ms, sustain: 25%, release: 800ms)'
    lane.clips.push({
      id: 'defaults',
      start: beat(0),
      length: beat(2),
      source: 'C @patch(sustain: 90%) D',
    })

    const notes = parseProjectNotes(project)
    expect(notes[0]!.envelope).toEqual({ attack: 0.03, decay: 0.4, sustain: 0.25, release: 0.8 })
    expect(notes[1]!.envelope).toEqual({ attack: 0.03, decay: 0.4, sustain: 0.9, release: 0.8 })
  })

  it('rejects duration-bearing global and lane initialization sources', () => {
    const project = createDefaultProject()
    project.instrumentLanes[0]!.clips.push({
      id: 'clip',
      start: beat(0),
      length: beat(1),
      source: 'D',
    })
    project.globalTrack.source = 'C'
    expect(() => parseProjectNotes(project)).toThrow(
      'Initialization sources cannot contain duration-bearing expressions.',
    )

    project.globalTrack.source = ''
    project.instrumentLanes[0]!.source = '.='
    expect(() => parseProjectNotes(project)).toThrow(
      'Initialization sources cannot contain duration-bearing expressions.',
    )
  })

  it('initializes every lane clip from the global and instrument sources', () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    project.globalTrack.source = '{19edo}'
    lane.source = '@patch(sustain: 25%)'
    lane.clips.push({ id: 'initialized', start: beat(0), length: beat(2), source: 'C D' })

    const notes = parseProjectNotes(project)
    expect(notes[0]!.envelope.sustain).toBe(0.25)
    expect(notes[1]!.cents).not.toBe(parseClipNotes('{12edo} D')[0]!.cents - 900)
  })

  it('propagates global and lane subdivision and articulation visitor context', () => {
    const global = compileSourceInitialization('@2 @.')
    const globalNotes = parseClipNotes('C D', Infinity, compileSourceInitialization('', global))
    expect(globalNotes.map(({ beat }) => beat)).toEqual([0, 0.5])
    expect(globalNotes.map(({ duration }) => duration)).toEqual([0.25, 0.25])

    const lane = compileSourceInitialization('@4 @.')
    const laneNotes = parseClipNotes('C D', Infinity, lane)
    expect(laneNotes.map(({ beat }) => beat)).toEqual([0, 0.25])
    expect(laneNotes.map(({ duration }) => duration)).toEqual([0.125, 0.125])

    const nested = compileSourceInitialization('@4', compileSourceInitialization('@2'))
    expect(parseClipNotes('C D', Infinity, nested).map(({ beat }) => beat)).toEqual([0, 0.125])
  })

  it('propagates initialization context through declarations and repeats', () => {
    const declared = compileSourceInitialization('let subdivision = 4 @subdivision(subdivision)')
    expect(parseClipNotes('C D', Infinity, declared).map(({ beat }) => beat)).toEqual([0, 0.25])

    const repeated = compileSourceInitialization('|: @ff @. :|')
    const inherited = parseClipNotes('C', Infinity, repeated)[0]!
    const explicit = parseClipNotes('@ff @. C')[0]!
    expect(inherited.velocity).toBe(explicit.velocity)
    expect(inherited.duration).toBe(explicit.duration)
  })

  it('propagates global function declarations into lane and clip sources', () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    project.globalTrack.source = 'fn LICC() { ret @2 D E F G E= C D== }'
    lane.source = 'fn phrase() { ret LICC() }'
    lane.clips.push({ id: 'function-call', start: beat(0), length: beat(8), source: 'phrase()' })

    const notes = parseProjectNotes(project)
    expect(notes).toHaveLength(7)
    expect(notes.map(({ beat }) => beat)).toEqual([0, 0.5, 1, 1.5, 2, 3, 3.5])
  })

  it('propagates a global groove through lane initialization into every clip', () => {
    const project = createDefaultProject()
    const instrument = project.instrumentLanes[0]!
    const drum = createDrumLane(project)
    project.instrumentLanes.push(drum)
    project.globalTrack.source = '@groove([0= 0])'
    instrument.clips.push({ id: 'melody', start: beat(0), length: beat(2), source: '[C D]' })
    drum.clips.push({ id: 'rhythm', start: beat(0), length: beat(2), source: '[bd sd]' })

    const notes = parseProjectNotes(project)
    expect(notes.filter(({ sample }) => !sample).map(({ beat }) => beat)).toEqual([0, 2 / 3])
    expect(notes.filter(({ sample }) => sample).map(({ beat }) => beat)).toEqual([0, 2 / 3])
  })

  it('compiles glissando segments and implements all supported easing curves', () => {
    const note = parseClipNotes('@gliss(ease-in) C @gliss(ease-out) D E')[0]!
    expect(note.glissando).toMatchObject([
      { start: 0, duration: 1, easing: 'ease-in' },
      { start: 1, duration: 1, easing: 'ease-out' },
    ])
    expect(note.glissando![0]!.from).toBe(note.cents)
    expect(note.glissando![0]!.to).not.toBe(note.cents)
    expect(easeGlissando('linear', 0.5)).toBe(0.5)
    expect(easeGlissando('ease-in', 0.5)).toBe(0.25)
    expect(easeGlissando('ease-out', 0.5)).toBe(0.75)
    expect(easeGlissando('ease-in-out', 0.5)).toBe(0.5)
    expect(easeGlissando('ease', 0.5)).toBeCloseTo(0.59375)
  })

  it('holds a completed glide target when playback resumes later in the note', () => {
    const note = parseClipNotes('@gliss C G')[0]!

    expect(note.duration).toBe(2)
    expect(glissandoPitchAtBeat(note, 1.5)).toBe(note.glissando![0]!.to)
  })

  it('samples glissando pitch in project beats across tempo changes', () => {
    const project = createDefaultProject()
    project.globalTrack.tempoChanges[0]!.bpm = 60
    project.globalTrack.tempoChanges.push({ id: 'faster', beat: beat(1), bpm: 120 })
    const note = parseClipNotes('@gliss C= G?')[0]!
    const segment = note.glissando![0]!
    const durationSeconds = projectBeatToSeconds(project, 2)

    // Half of the 1.5-second glide is only beat 0.75, not beat 1, because its
    // second beat is twice as fast as its first.
    expect(projectSecondsToBeat(project, durationSeconds / 2)).toBe(0.75)
    expect(glissandoPitchAtElapsedTime(note, project, 0, durationSeconds, 0.5)).toBeCloseTo(
      segment.from + (segment.to - segment.from) * 0.375,
    )
  })

  it('keeps adjacent 250 BPM glissando curves clear of their shared boundary', () => {
    const segmentStart = 14.024
    const segmentDuration = (3 * 60) / 250
    const sharedBoundary = 14.744

    // Chromium treats a curve ending exactly at another event's timestamp as an
    // overlap, even though both times display as the same shared boundary.
    expect(segmentStart + segmentDuration).toBe(sharedBoundary)
    expect(segmentStart + glissandoCurveDuration(segmentDuration)).toBeLessThan(sharedBoundary)
  })

  it('integrates every tempo segment and converts audio time back to beats', () => {
    const project = createDefaultProject()
    project.globalTrack.tempoChanges.push({ id: 'slow', beat: beat(4), bpm: 60 })
    project.globalTrack.tempoChanges.push({ id: 'fast', beat: beat(6), bpm: 240 })

    expect(projectBeatToSeconds(project, 4)).toBe(2)
    expect(projectBeatToSeconds(project, 6)).toBe(4)
    expect(projectBeatToSeconds(project, 8)).toBe(4.5)
    expect(projectSecondsToBeat(project, 4.5)).toBe(8)
  })
})

describe('DAW routing', () => {
  it('provides the DAW without replacing either development route', () => {
    const paths = router.getRoutes().map(({ path }) => path)
    expect(paths).toContain('/daw')
    expect(paths).toContain('/patch-testing')
    expect(paths).toContain('/xenpaper-lang-testing')
  })
})

describe('DawView', () => {
  it('adds and deletes instrument lanes while keeping their clips independent', async () => {
    const wrapper = mount(DawView)

    await wrapper.get('button.add-lane').trigger('click')
    expect(wrapper.findAll('.instrument-header')).toHaveLength(2)
    expect(wrapper.findAll('.instrument-header strong').map((name) => name.text())).toEqual([
      'Instrument 1',
      'Instrument 2',
    ])

    const lanes = wrapper.findAllComponents(InstrumentPianoRollLane)
    await lanes[1]!.trigger('dblclick', { clientX: 64 })
    expect(lanes[0]!.find('button.clip').exists()).toBe(false)
    expect(lanes[1]!.find('button.clip').exists()).toBe(true)

    await wrapper.get('button[aria-label="Delete Instrument 2"]').trigger('click')
    expect(wrapper.findAll('.instrument-header')).toHaveLength(1)
    expect(wrapper.find('textarea[aria-label="Xenpaper clip source"]').exists()).toBe(false)

    await wrapper.get('button[aria-label="Delete Instrument 1"]').trigger('click')
    expect(wrapper.findAll('.instrument-header')).toHaveLength(0)
    await wrapper.get('button.add-lane').trigger('click')
    expect(wrapper.get('.instrument-header strong').text()).toBe('Instrument 1')
  })

  it('double-clicks the empty lane to create, select, and edit a snapped clip', async () => {
    const wrapper = mount(DawView, { attachTo: document.body })
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    vi.spyOn(lane.element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 144,
      width: 800,
      height: 144,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    await lane.trigger('dblclick', { clientX: 70 })

    const clip = wrapper.get('button.clip')
    expect(clip.classes()).toContain('selected')
    expect(clip.attributes('style')).toContain('left: 64px')
    const source = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Xenpaper clip source"]')
    expect(source.element.value).toContain('[0,4,7]')
    expect(source.element.value).not.toContain('@patch')
    expect(document.activeElement).toBe(source.element)
    wrapper.unmount()
  })

  it('uses a single click for playhead placement and an existing clip click for selection', async () => {
    const wrapper = mount(DawView)
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    await lane.trigger('click', { clientX: 128 })
    expect(wrapper.get('output').text()).toBe('Beat 2.00')

    await lane.trigger('dblclick', { clientX: 64 })
    await wrapper.get('button.clip').trigger('click')
    expect(wrapper.get('button.clip').classes()).toContain('selected')
    expect(beatToNumber(beat(1, 4))).toBe(0.25)
  })

  it('does not create overlapping clips when an existing clip is double-clicked', async () => {
    const wrapper = mount(DawView)
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    await lane.trigger('dblclick', { clientX: 64 })
    await wrapper.get('button.clip').trigger('dblclick', { clientX: 64 })

    expect(wrapper.findAll('button.clip')).toHaveLength(1)
  })

  it('deletes the selected clip with Delete while the instrument lane has focus', async () => {
    const wrapper = mount(DawView, { attachTo: document.body })
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    await lane.trigger('dblclick', { clientX: 64 })
    const laneElement = lane.element as HTMLElement
    laneElement.focus()

    expect(document.activeElement).toBe(laneElement)
    await lane.trigger('keydown', { key: 'Delete' })

    expect(wrapper.find('button.clip').exists()).toBe(false)
    expect(wrapper.find('textarea[aria-label="Xenpaper clip source"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Select or create a clip')
    wrapper.unmount()
  })

  it('focuses a clicked clip and deletes it with Delete', async () => {
    const wrapper = mount(DawView, { attachTo: document.body })
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    await lane.trigger('dblclick', { clientX: 64 })
    const clip = wrapper.get('button.clip')
    const focus = vi.spyOn(clip.element as HTMLElement, 'focus')

    clip.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 64 }))
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(document.activeElement).toBe(clip.element)
    await clip.trigger('keydown', { key: 'Delete' })

    expect(wrapper.find('button.clip').exists()).toBe(false)
    wrapper.unmount()
  })

  it('deletes the selected clip from the Clip source header', async () => {
    const wrapper = mount(DawView)
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    await lane.trigger('dblclick', { clientX: 64 })

    await wrapper.get('button[aria-label="Delete clip"]').trigger('click')

    expect(wrapper.find('button.clip').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Delete clip"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Select or create a clip')
  })

  it('keeps the visual grid aligned with zoom and scroll', async () => {
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Timeline zoom"]').setValue('96')
    await wrapper.get('[aria-label="Timeline scroll"]').setValue('32')

    const style = wrapper.get('[aria-label="Instrument piano roll"]').attributes('style')
    expect(style).toContain('--beat-width: 96px')
    expect(style).toContain('--grid-offset: -32px')
  })

  it('offers a wide project-aware scroll range and a lower minimum zoom', async () => {
    const wrapper = mount(DawView)
    const zoom = wrapper.get('[aria-label="Timeline zoom"]')
    const scroll = wrapper.get('[aria-label="Timeline scroll"]')

    expect(zoom.attributes('min')).toBe('8')
    expect(scroll.element.parentElement?.parentElement?.className).toBe('scroll-controls')
    expect(Number(scroll.attributes('max'))).toBe(16 * 64)

    await wrapper.getComponent(InstrumentPianoRollLane).trigger('dblclick', { clientX: 1280 })
    expect(Number(scroll.attributes('max'))).toBe((24 + 16) * 64)
  })

  it('collapses and expands instrument and drum lanes', async () => {
    const wrapper = mount(DawView)
    const instrumentGrid = wrapper.get('[aria-label="Instrument piano roll"]')

    await wrapper.get('[aria-label="Collapse Instrument 1"]').trigger('click')
    expect(instrumentGrid.attributes('style')).toContain('display: none')
    await wrapper.get('[aria-label="Expand Instrument 1"]').trigger('click')
    expect(wrapper.get('[aria-label="Instrument piano roll"]').attributes('style')).not.toContain(
      'display: none',
    )

    await wrapper.get('button.add-drum-lane').trigger('click')
    await wrapper.get('[aria-label="Collapse Drums 1"]').trigger('click')
    expect(wrapper.get('[aria-label="Drum lane"]').attributes('style')).toContain('display: none')
  })

  it('adds play, solo, and stop actions to the selected clip header', async () => {
    const wrapper = mount(DawView)
    await wrapper.getComponent(InstrumentPianoRollLane).trigger('dblclick', { clientX: 64 })

    await wrapper.get('[aria-label="Play from clip start"]').trigger('click')
    expect(wrapper.get('[aria-label="Play"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('output').text()).toBe('Beat 1.00')
    await wrapper.get('[aria-label="Play clip solo from clip start"]').trigger('click')
    expect(wrapper.get('[aria-label="Play"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[aria-label="Stop clip playback"]').trigger('click')
    expect(wrapper.get('output').text()).toBe('Beat 0.00')
    wrapper.unmount()
  })

  it('edits global controls, waveform, and the clip preview mode', async () => {
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Tempo in BPM"]').setValue('144')
    await wrapper.get('[aria-label="Time signature numerator"]').setValue('7')
    await wrapper.get('[aria-label="Time signature denominator"]').setValue('8')
    await wrapper.get('[aria-label="Waveform"]').setValue('triangle')
    await wrapper.get('[aria-label="Instrument gain"]').setValue('0.42')
    await wrapper.get('[aria-label="Global source"]').setValue('{31edo}')
    await wrapper.get('[aria-label="Instrument lane source"]').setValue('@patch(sustain: 45%)')

    expect((wrapper.get('[aria-label="Tempo in BPM"]').element as HTMLInputElement).value).toBe(
      '144',
    )
    expect((wrapper.get('[aria-label="Waveform"]').element as HTMLSelectElement).value).toBe(
      'triangle',
    )
    expect(wrapper.get('.instrument-header output').text()).toBe('42%')
    expect(wrapper.find('[aria-label="Default attack"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Default sustain"]').exists()).toBe(false)
    expect((wrapper.get('[aria-label="Global source"]').element as HTMLTextAreaElement).value).toBe(
      '{31edo}',
    )
    expect(
      (wrapper.get('[aria-label="Instrument lane source"]').element as HTMLTextAreaElement).value,
    ).toBe('@patch(sustain: 45%)')

    await wrapper.getComponent(InstrumentPianoRollLane).trigger('dblclick', { clientX: 64 })
    expect(wrapper.find('[aria-label="Piano roll preview"]').exists()).toBe(true)
    await wrapper.get('[aria-label="Clip display"]').setValue('source')
    expect(wrapper.get('button.clip pre').text()).toContain('[0,4,7]===')
  })

  it('adds a drum lane and creates its default 4/4 clip', async () => {
    const wrapper = mount(DawView)
    await wrapper.get('button.add-drum-lane').trigger('click')
    const lane = wrapper.getComponent(DrumLane)
    expect(lane.get('[aria-label="Drum lane"]').attributes('aria-label')).toBe('Drum lane')

    await lane.get('[aria-label="Drum lane"]').trigger('dblclick', { clientX: 64 })
    expect(wrapper.get('[aria-label="Xenpaper clip source"]').element).toHaveProperty(
      'value',
      expect.stringContaining('[bd,hh hh] [hh hh] [sd,hh hh] [hh hh]'),
    )
    const notes = lane.findAll('[aria-label="Drum pattern preview"] i')
    expect(notes).toHaveLength(10)
    expect(notes.every((note) => note.text() === '')).toBe(true)
    expect(lane.findAll('.drum-row-label').map((label) => label.text())).toEqual(['sd', 'hh', 'bd'])
  })

  it('resizes a clip when its source duration changes', async () => {
    const wrapper = mount(DawView)
    await wrapper.getComponent(InstrumentPianoRollLane).trigger('dblclick', { clientX: 64 })
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').setValue('C D')

    expect(wrapper.get('button.clip').attributes('style')).toContain('width: 128px')
  })

  it('resizes a MOS clip using the global source context', async () => {
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Global source"]').setValue('MOS{5L4s}')
    await wrapper.getComponent(InstrumentPianoRollLane).trigger('dblclick', { clientX: 64 })
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').setValue('J K L M N O P Q R j')

    expect(wrapper.get('button.clip').attributes('style')).toContain('width: 640px')
    expect(wrapper.findAll('[aria-label="Piano roll preview"] i')).toHaveLength(10)
  })

  it('recalculates an invalid MOS clip when the global source becomes compatible', async () => {
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Global source"]').setValue('MOS{2L 1s}')
    await wrapper.getComponent(InstrumentPianoRollLane).trigger('dblclick', { clientX: 64 })
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').setValue('J K L M j')

    expect(wrapper.get('button.clip').attributes('style')).toContain('width: 256px')
    expect(wrapper.findAll('[aria-label="Piano roll preview"] i')).toHaveLength(0)

    await wrapper.get('[aria-label="Global source"]').setValue('MOS{3L 1s}')

    expect(wrapper.get('button.clip').attributes('style')).toContain('width: 320px')
    expect(wrapper.findAll('[aria-label="Piano roll preview"] i')).toHaveLength(5)
  })

  it('isolates incomplete clip syntax while recalculating other clips', async () => {
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Global source"]').setValue('MOS{2L 1s}')
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    await lane.trigger('dblclick', { clientX: 64 })
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').setValue('C (')
    await lane.trigger('dblclick', { clientX: 384 })
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').setValue('J K L M j')

    await wrapper.get('[aria-label="Global source"]').setValue('MOS{3L 1s}')

    const clips = wrapper.findAll('button.clip')
    expect(clips[0]!.attributes('style')).toContain('width: 256px')
    expect(clips[1]!.attributes('style')).toContain('width: 320px')
  })

  it('falls back safely when resizing with an invalid initialization source', async () => {
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Global source"]').setValue('MOS{')
    await wrapper.getComponent(InstrumentPianoRollLane).trigger('dblclick', { clientX: 64 })
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').setValue('C D')

    expect(wrapper.get('button.clip').attributes('style')).toContain('width: 128px')
  })

  it('renders piano-roll notes parsed from the edited clip source', async () => {
    const wrapper = mount(DawView)
    await wrapper.getComponent(InstrumentPianoRollLane).trigger('dblclick', { clientX: 64 })
    await wrapper.get('textarea[aria-label="Xenpaper clip source"]').setValue('C D E')

    const notes = wrapper.findAll('[aria-label="Piano roll preview"] i')
    expect(notes).toHaveLength(3)
    expect(notes.map((note) => note.attributes('data-beat'))).toEqual(['0', '1', '2'])
    expect(notes[0]!.attributes('style')).toContain('left: 0%')
    expect(notes[1]!.attributes('style')).toContain('left: 33.333')
    expect(notes[0]!.attributes('data-cents')).not.toBe(notes[1]!.attributes('data-cents'))
  })

  it('renders glissandi as eased bendy notes in the piano roll', () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    lane.clips = [
      { id: 'glissando', start: beat(0), length: beat(2), source: '@gliss(ease-in) C G' },
    ]
    const wrapper = mount(InstrumentPianoRollLane, {
      props: { lane, pixelsPerBeat: 64, scrollLeft: 0, displayMode: 'piano-roll' },
    })

    const preview = wrapper.get('[aria-label="Piano roll preview"]')
    const bendyNote = preview.get('.bendy-note')
    const path = bendyNote.attributes('d')
    expect(path).toMatch(/^M /)
    expect(path!.split(' L ')).toHaveLength(18)
    expect(bendyNote.attributes('data-beat')).toBe('0')
    expect(preview.findAll('i').filter((note) => note.isVisible())).toHaveLength(0)
  })

  it('stops a bendy note at the audible pitch when its glissando is clipped', () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    lane.clips = [
      { id: 'clipped-glissando', start: beat(0), length: beat(2), source: "@gliss C=== '''C" },
    ]
    const wrapper = mount(InstrumentPianoRollLane, {
      props: { lane, pixelsPerBeat: 64, scrollLeft: 0, displayMode: 'piano-roll' },
    })

    const path = wrapper.get('.bendy-note').attributes('d')!
    const xCoordinates = [...path.matchAll(/(?:M|L) ([^,]+),/g)].map((match) => Number(match[1]))
    expect(Math.max(...xCoordinates)).toBe(100)
    expect(xCoordinates[xCoordinates.length - 1]).toBe(100)
    expect(wrapper.find('.pitch-guide[data-cents="2400"]').exists()).toBe(false)
  })

  it('uses a lane-wide pitch scale and renders octave reference guides', () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    lane.clips = [
      { id: 'ascending', start: beat(0), length: beat(2), source: 'C D' },
      { id: 'descending', start: beat(2), length: beat(2), source: 'B C' },
    ]
    const wrapper = mount(InstrumentPianoRollLane, {
      props: { lane, pixelsPerBeat: 64, scrollLeft: 0, displayMode: 'piano-roll' },
    })

    const cPitch = String(parseClipNotes('C')[0]!.cents)
    const previews = wrapper.findAll('[aria-label="Piano roll preview"]')
    const firstC = previews[0]!.get(`i[data-cents="${cPitch}"]`)
    const secondC = previews[1]!.get(`i[data-cents="${cPitch}"]`)
    expect((firstC.element as HTMLElement).style.top).toBe(
      (secondC.element as HTMLElement).style.top,
    )

    const guides = previews[0]!.findAll('.pitch-guide')
    expect(guides.every((guide) => Number(guide.attributes('data-cents')) % 1200 === 0)).toBe(true)
    expect(previews[0]!.get('.pitch-guide[data-cents="0"]').classes()).toContain('global-reference')
  })

  it('renders the zero-cent guide as solid for the default chord clip', async () => {
    const wrapper = mount(DawView)
    await wrapper.getComponent(InstrumentPianoRollLane).trigger('dblclick', { clientX: 64 })

    const preview = wrapper.get('[aria-label="Piano roll preview"]')
    const zeroGuides = preview.findAll('.pitch-guide[data-cents="0"]')
    expect(zeroGuides).toHaveLength(1)
    expect(zeroGuides[0]!.classes()).toContain('global-reference')
  })

  it('folds disparate clip registers into view and labels their octave offset', () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    lane.clips = [
      { id: 'home-1', start: beat(0), length: beat(1), source: 'C' },
      { id: 'home-2', start: beat(1), length: beat(1), source: 'D' },
      { id: 'high', start: beat(2), length: beat(1), source: "''C" },
    ]
    const wrapper = mount(InstrumentPianoRollLane, {
      props: { lane, pixelsPerBeat: 64, scrollLeft: 0, displayMode: 'piano-roll' },
    })

    expect(wrapper.findAll('.register-label')).toHaveLength(1)
    expect(wrapper.get('.register-label').text()).toBe('+2400¢')
    const previews = wrapper.findAll('[aria-label="Piano roll preview"]')
    expect((previews[0]!.get('i').element as HTMLElement).style.top).toBe(
      (previews[2]!.get('i').element as HTMLElement).style.top,
    )
  })

  it('keeps the solid global-zero guide correct in a downward-shifted clip', () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    lane.clips = [
      { id: 'home-1', start: beat(0), length: beat(1), source: 'C' },
      { id: 'home-2', start: beat(1), length: beat(1), source: 'D' },
      { id: 'low', start: beat(2), length: beat(1), source: '`C' },
    ]
    const wrapper = mount(InstrumentPianoRollLane, {
      props: { lane, pixelsPerBeat: 64, scrollLeft: 0, displayMode: 'piano-roll' },
    })

    expect(wrapper.get('.register-label').text()).toBe('-1200¢')
    const lowPreview = wrapper.findAll('[aria-label="Piano roll preview"]')[2]!
    const globalZero = lowPreview.get('.pitch-guide[data-cents="0"]')
    expect(globalZero.classes()).toContain('global-reference')
    expect((globalZero.element as HTMLElement).style.top).not.toBe(
      (lowPreview.get('i').element as HTMLElement).style.top,
    )
  })

  it('moves clips on the snapped grid and wires play and stop', async () => {
    const wrapper = mount(DawView)
    const lane = wrapper.getComponent(InstrumentPianoRollLane)
    await lane.trigger('dblclick', { clientX: 64 })
    const clip = wrapper.get('button.clip')
    clip.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 70 }))
    lane.element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 139 }))
    lane.element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(clip.attributes('style')).toContain('left: 128px')

    await wrapper.get('[aria-label="Play"]').trigger('click')
    expect(wrapper.get('[aria-label="Play"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[aria-label="Stop"]').trigger('click')
    expect(wrapper.get('output').text()).toBe('Beat 0.00')
    wrapper.unmount()
  })
})
