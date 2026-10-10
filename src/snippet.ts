import {
  expandToBeatEvents,
  evaluateProgramSemantics,
  parse,
  scoreTimelineContexts,
} from '../xenpaper-lang'
import {
  beat,
  createDefaultProject,
  parseDawProject,
  type PitchedInstrumentLane,
} from './daw/project'
import { compileLaneSourceInitialization, ENVELOPE_EXTENSIONS } from './daw/score'

export interface Snippet {
  source: string
  lane: Pick<PitchedInstrumentLane, 'source' | 'gain' | 'instrument'>
}

export const createDefaultSnippet = (): Snippet => {
  const { source, gain, instrument } = createDefaultProject()
    .instrumentLanes[0]! as PitchedInstrumentLane
  return { source: '@tempo(120bpm)\n@time(4/4)\n[0,4,7]===\n', lane: { source, gain, instrument } }
}

/** A versioned UTF-8 base64url fragment: no brackets, whitespace, or chat markup. */
export const encodeSnippet = (snippet: Snippet): string => {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      snippet.source,
      snippet.lane.source,
      snippet.lane.gain,
      snippet.lane.instrument,
    ]),
  )
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return '#v1.' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const decodeSnippet = (hash: string): Snippet => {
  if (!hash) return createDefaultSnippet()
  if (!/^#v1\.[A-Za-z0-9_-]+$/.test(hash)) throw new Error('Invalid or unsupported snippet URL.')
  try {
    const binary = atob(hash.slice(4).replace(/-/g, '+').replace(/_/g, '/'))
    const payload: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      ),
    )
    if (!Array.isArray(payload) || payload.length !== 4 || typeof payload[0] !== 'string')
      throw new Error('Invalid snippet data.')
    const project = createDefaultProject()
    const lane = project.instrumentLanes[0]! as PitchedInstrumentLane
    lane.source = payload[1]
    lane.gain = payload[2]
    lane.instrument = payload[3]
    lane.clips = [{ id: 'snippet', start: beat(0), length: beat(4), source: payload[0] }]
    // Reuse the project's validation, including sampled instruments and unison constraints.
    const validated = parseDawProject(JSON.stringify(project))
    const validatedLane = validated.instrumentLanes[0]! as PitchedInstrumentLane
    return {
      source: payload[0],
      lane: {
        source: validatedLane.source,
        gain: validatedLane.gain,
        instrument: validatedLane.instrument,
      },
    }
  } catch {
    throw new Error('Invalid snippet data in the URL.')
  }
}

/** Compile one clip and lift its tempo timeline into the shared playback model. */
export const compileSnippet = (snippet: Snippet) => {
  const initialization = compileLaneSourceInitialization(snippet.lane.source)
  const options = {
    initialization,
    directiveExtensions: ENVELOPE_EXTENSIONS,
    allowTempoDirective: true,
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
  }
  const program = parse(snippet.source, { grammarSource: 'xenpaper:clip-source' })
  const expanded = expandToBeatEvents(program, options)
  if (!('score' in expanded))
    throw new Error(expanded.diagnostics.map(({ message }) => message).join('\n'))
  const evaluated = evaluateProgramSemantics(program, options)
  const base = evaluateProgramSemantics({ ...program, body: [] }, options)
  if (!('shape' in evaluated) || !('shape' in base) || !base.visitorContext)
    throw new Error('Cannot compile snippet.')
  const timeline = scoreTimelineContexts(evaluated.shape, base.visitorContext)
  const project = createDefaultProject()
  project.globalTrack.source = ''
  const changes = new Map([[0, project.globalTrack.tempoChanges[0]!]])
  timeline.changes.forEach(({ start, context }, index) => {
    if (context.tempo)
      changes.set(start.valueOf(), {
        id: `snippet-tempo-${index}`,
        beat: start,
        bpm: context.tempo.valueOf(),
      })
  })
  project.globalTrack.tempoChanges = [...changes.values()].sort((a, b) => a.beat.compare(b.beat))
  const lane = project.instrumentLanes[0]! as PitchedInstrumentLane
  Object.assign(lane, snippet.lane)
  lane.clips = [
    {
      id: 'snippet',
      start: beat(0),
      length: expanded.score.duration.n ? expanded.score.duration : beat(4),
      source: snippet.source,
    },
  ]
  return { project, score: expanded.score, diagnostics: expanded.diagnostics }
}
