import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import router from '../router'
import DawView from '../views/DawView.vue'
import InstrumentPianoRollLane from '../components/daw/InstrumentPianoRollLane.vue'
import { beat, beatToNumber, createDefaultProject, pointerXToBeat, snapBeat } from '../daw/project'
import {
  parseProjectNotes,
  parseClipNotes,
  notePlaybackWindow,
  easeGlissando,
  glissandoPitchAtBeat,
  glissandoPitchAtElapsedTime,
  glissandoCurveDuration,
  projectBeatToSeconds,
  projectSecondsToBeat,
  sourceClipLength,
} from '../daw/audio-engine'

describe('DAW project model', () => {
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
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.3 },
      source: expect.stringContaining('Defaults inherited'),
      clips: [],
    })
    expect(JSON.parse(JSON.stringify(project))).toEqual(project)
  })

  it('converts scrolled, zoomed pointer coordinates and snaps exactly', () => {
    expect(pointerXToBeat(96, 32, 64)).toBe(2)
    expect(snapBeat(2.13, beat(1, 4))).toEqual(beat(9, 4))
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

  it('uses lane ADSR defaults and keeps clip patch directives as overrides', () => {
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]!
    lane.envelope = { attack: 0.03, decay: 0.4, sustain: 0.25, release: 0.8 }
    lane.clips.push({
      id: 'defaults',
      start: beat(0),
      length: beat(2),
      source: 'C @patch(sustain: 90%) D',
    })

    const notes = parseProjectNotes(project)
    expect(notes[0]!.envelope).toEqual(lane.envelope)
    expect(notes[1]!.envelope).toEqual({ ...lane.envelope, sustain: 0.9 })
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
    const controls = wrapper.findAll<HTMLInputElement>('.timeline-controls input')
    await controls[0]!.setValue('96')
    await controls[1]!.setValue('32')

    const style = wrapper.get('[aria-label="Instrument piano roll"]').attributes('style')
    expect(style).toContain('--beat-width: 96px')
    expect(style).toContain('--grid-offset: -32px')
  })

  it('edits global controls, waveform, and the clip preview mode', async () => {
    const wrapper = mount(DawView)
    await wrapper.get('[aria-label="Tempo in BPM"]').setValue('144')
    await wrapper.get('[aria-label="Time signature numerator"]').setValue('7')
    await wrapper.get('[aria-label="Time signature denominator"]').setValue('8')
    await wrapper.get('[aria-label="Waveform"]').setValue('triangle')
    await wrapper.get('[aria-label="Instrument gain"]').setValue('0.42')
    await wrapper.get('[aria-label="Default attack"]').setValue('0.04')
    await wrapper.get('[aria-label="Default sustain"]').setValue('0.6')
    await wrapper.get('[aria-label="Global source"]').setValue('{31edo}')
    await wrapper.get('[aria-label="Instrument lane source"]').setValue('@patch(sustain: 45%)')

    expect((wrapper.get('[aria-label="Tempo in BPM"]').element as HTMLInputElement).value).toBe(
      '144',
    )
    expect((wrapper.get('[aria-label="Waveform"]').element as HTMLSelectElement).value).toBe(
      'triangle',
    )
    expect(wrapper.get('.instrument-header output').text()).toBe('42%')
    expect((wrapper.get('[aria-label="Default attack"]').element as HTMLInputElement).value).toBe(
      '0.04',
    )
    expect((wrapper.get('[aria-label="Default sustain"]').element as HTMLInputElement).value).toBe(
      '0.6',
    )
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

  it('resizes a clip when its source duration changes', async () => {
    const wrapper = mount(DawView)
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
