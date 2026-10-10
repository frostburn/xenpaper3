import { describe, expect, it } from 'vitest'
import { compileSnippet, createDefaultSnippet, decodeSnippet, encodeSnippet } from '../snippet'
import { createPlaybackPlan } from '../daw/playback-plan'

describe('shareable snippets', () => {
  it('round trips Unicode, score punctuation, and full lane settings in a chat-safe URL', () => {
    const snippet = createDefaultSnippet()
    snippet.source = '# 音楽 🎵 [brackets] <angle> # & + %\n@tempo(90bpm)\n0 3/2\n'
    snippet.lane.source = '{19edo}\n@adsr(10ms, 20ms, 50%, 100ms)\n'
    snippet.lane.gain = 0.35
    snippet.lane.instrument = {
      type: 'patch',
      patchPreset: 'unison',
      oscillatorType: 'triangle',
      numberOfVoices: 7,
    }
    const fragment = encodeSnippet(snippet)
    expect(fragment).toMatch(/^#v1\.[A-Za-z0-9_-]+$/)
    const restored = decodeSnippet(new URL(`https://example.com/snippet${fragment}`).hash)
    expect(encodeSnippet(restored)).toBe(fragment)
    expect(restored.source).toBe(snippet.source)
    expect(restored.lane).toEqual({
      source: snippet.lane.source,
      gain: 0.35,
      instrument: snippet.lane.instrument,
    })
  })

  it('round trips a sampled instrument without relying on local state', () => {
    const snippet = createDefaultSnippet()
    snippet.lane.instrument = {
      type: 'samples',
      url: 'https://example.com/samples.json',
      instrument: 'piano',
      doughJson: { piano: { C4: 'piano.wav' } },
    }
    expect(decodeSnippet(encodeSnippet(snippet)).lane.instrument).toEqual(snippet.lane.instrument)
  })

  it.each(['#v2.abc', '#v1.%', '#v1.YWJj', '#v1.W10'])(
    'rejects malformed or unsupported fragments: %s',
    (hash) => {
      expect(() => decodeSnippet(hash)).toThrow()
    },
  )

  it('validates instrument configuration before loading it', () => {
    const snippet = createDefaultSnippet()
    snippet.lane.instrument = {
      type: 'patch',
      patchPreset: 'unison',
      oscillatorType: 'sine',
      numberOfVoices: 99,
    }
    expect(() => decodeSnippet(encodeSnippet(snippet))).toThrow('Invalid snippet data')
  })

  it('compiles mid-clip tempo changes into audio time and still rejects tempo in ordinary DAW clips', () => {
    const snippet = createDefaultSnippet()
    snippet.source = '@tempo(60bpm) 0 @tempo(120bpm) 4'
    const { project, score } = compileSnippet(snippet)
    expect(project.instrumentLanes).toHaveLength(1)
    expect(project.instrumentLanes[0]!.clips).toHaveLength(1)
    expect(score.duration.valueOf()).toBe(2)
    const plan = createPlaybackPlan(project, 0, { allowClipTempoDirective: true })
    expect(plan.lanes[0]!.notes.map(({ when, duration }) => [when, duration])).toEqual([
      [0, 1],
      [1, 0.5],
    ])
    expect(() => createPlaybackPlan(project)).toThrow(/tempo/)
  })

  it('restores scoped tempo declarations on the nominal grid', () => {
    const snippet = createDefaultSnippet()
    snippet.source = '@tempo(60bpm) (@tempo(120bpm) 0) 4'
    const { project } = compileSnippet(snippet)
    const plan = createPlaybackPlan(project, 0, { allowClipTempoDirective: true })
    expect(plan.lanes[0]!.notes.map(({ when, duration }) => [when, duration])).toEqual([
      [0, 0.5],
      [0.5, 1],
    ])
  })

  it('places repeated tempo changes at each repeated beat', () => {
    const snippet = createDefaultSnippet()
    snippet.source = '|:@x2 @tempo(60bpm) 0 @tempo(120bpm) 4 :|'
    const { project } = compileSnippet(snippet)
    const plan = createPlaybackPlan(project, 0, { allowClipTempoDirective: true })
    expect(plan.lanes[0]!.notes.map(({ when, duration }) => [when, duration])).toEqual([
      [0, 1],
      [1, 0.5],
      [1.5, 1],
      [2.5, 0.5],
    ])
  })

  it('allows meter changes and inherits lane tuning and envelope configuration', () => {
    const snippet = createDefaultSnippet()
    snippet.lane.source = '{19edo}\n@adsr(10ms, 20ms, 50%, 100ms)'
    snippet.source = '@time(3/4) 0== @time(2/4) 1='
    const { project, score } = compileSnippet(snippet)
    expect(score.duration.valueOf()).toBe(5)
    const plan = createPlaybackPlan(project, 0, { allowClipTempoDirective: true })
    expect(plan.lanes[0]!.notes[1]!.pitch.initialValue).toBeCloseTo(1200 / 19)
    expect(plan.lanes[0]!.notes[0]!.envelope).toEqual({
      attack: 0.01,
      decay: 0.02,
      sustain: 0.5,
      release: 0.1,
    })
  })

  it('retains trailing rests in the single clip and reports source errors', () => {
    const snippet = createDefaultSnippet()
    snippet.source = '0 ....'
    expect(compileSnippet(snippet).project.instrumentLanes[0]!.clips[0]!.length.valueOf()).toBe(5)
    snippet.source = '@tempo(-10bpm) 0'
    expect(() => compileSnippet(snippet)).toThrow(/positive/)
  })
})
