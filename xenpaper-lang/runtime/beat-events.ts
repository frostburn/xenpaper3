import { Fraction } from 'xen-dev-utils/fraction'
import type { Program } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { expandRepeats } from './repeat-expansion'
import { evaluateScoreSemantics } from './score-evaluation'
import { DYNAMIC_VELOCITIES } from './directives'
import type {
  BeatTimedEvent,
  BeatTimedNoteEvent,
  BeatTimedScore,
  ExpandedNode,
  RepeatExpansionOptions,
  ScoreShape,
  ScoreShapeOptions,
} from './types'

export interface BeatEventExpansionOptions extends ScoreShapeOptions, RepeatExpansionOptions {}

export type BeatEventExpansionResult =
  | { readonly score: BeatTimedScore; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] }

interface BeatEventFlatteningResult {
  readonly score: BeatTimedScore
  readonly diagnostics: readonly Diagnostic[]
}

const copy = (value: Fraction) => new Fraction(value.n, value.d)

/** Flatten evaluated playback semantics without converting exact beat positions to seconds. */
export function flattenScoreSemantics(shape: ScoreShape): BeatEventFlatteningResult {
  const events: BeatTimedEvent[] = []
  const diagnostics: Diagnostic[] = []
  type MutableNoteEvent = Omit<
    BeatTimedNoteEvent,
    'start' | 'duration' | 'dynamic' | 'automation' | 'origins'
  > & {
    start: Fraction
    duration: Fraction
    dynamic: Fraction
    directiveState: BeatTimedNoteEvent['directiveState']
    automation?: BeatTimedNoteEvent['automation']
    origins: readonly BeatTimedNoteEvent['origins'][number][]
    groove?: Groove
    articulation: Fraction
  }
  type State = {
    active: MutableNoteEvent[]
    activeStart?: Fraction
    activeSpan?: Fraction
    groove?: Groove
    drone?: MutableNoteEvent[]
  }
  const completedAutomations = new WeakSet<MutableNoteEvent>()
  type Groove = {
    origin: Fraction
    cycle: Fraction
    points: { nominal: Fraction; actual: Fraction; dynamic: Fraction; articulation: Fraction }[]
  }
  const interpolate = (
    groove: Groove,
    value: Fraction,
    key: 'actual' | 'dynamic' | 'articulation',
  ) => {
    const relative = value.sub(groove.origin)
    const cycleIndex = Math.floor(relative.div(groove.cycle).valueOf())
    const local = relative.sub(groove.cycle.mul(cycleIndex))
    const points = groove.points
    let left = points[0]!
    let right = { ...points[0]!, nominal: groove.cycle, actual: groove.cycle }
    for (let index = 1; index < points.length; index++) {
      if (local.compare(points[index]!.nominal) <= 0) {
        right = points[index]!
        break
      }
      left = points[index]!
    }
    const span = right.nominal.sub(left.nominal)
    const ratio = span.n ? local.sub(left.nominal).div(span) : new Fraction(0)
    const interpolated = left[key].add(right[key].sub(left[key]).mul(ratio))
    return key === 'actual'
      ? groove.origin.add(groove.cycle.mul(cycleIndex)).add(interpolated)
      : interpolated
  }

  const stopDrone = (state: State, end: Fraction) => {
    for (const event of state.drone ?? []) event.duration = end.sub(event.start)
    state.drone = undefined
  }

  const visit = (current: ScoreShape, start: Fraction, state: State): Fraction => {
    if (!current.isolatedDirectiveScope) return visitCurrent(current, start, state)
    const isolatedState = { ...state }
    const end = visitCurrent(current, start, isolatedState)
    if (isolatedState.drone !== state.drone) stopDrone(isolatedState, end)
    state.active = isolatedState.active
    state.activeStart = isolatedState.activeStart
    state.activeSpan = isolatedState.activeSpan
    return end
  }

  const visitCurrent = (current: ScoreShape, start: Fraction, state: State): Fraction => {
    if (current.kind === 'attack') {
      const event: MutableNoteEvent = {
        kind: 'note',
        start: copy(start),
        duration: copy(current.duration),
        ...(current.notatedDuration || current.automation
          ? {
              notatedDuration: copy(
                current.notatedDuration ?? current.automation?.duration ?? current.duration,
              ),
            }
          : {}),
        pitch: current.pitch,
        rootPitch: current.rootPitch,
        dynamic: copy((current as typeof current & { readonly velocity: Fraction }).velocity),
        directiveState: { ...current.directiveState },
        automation: current.automation,
        label: current.authoredLabel ?? current.displayLabel,
        origins: current.origins,
        groove: state.groove,
        articulation: current.articulation ?? new Fraction(1),
      }
      events.push(event)
      state.active = [event]
      state.activeStart = copy(start)
      state.activeSpan = copy(current.duration)
    } else if (current.kind === 'continue') {
      if (!state.active.length) {
        diagnostics.push({
          code: 'XP_CONTINUE_WITHOUT_ATTACK',
          severity: 'error',
          message: 'A continuation requires an active note.',
          locations: current.origins.map((origin) => origin.location),
        })
      } else {
        const activeStart = state.activeStart ?? state.active[0]!.start
        const activeSpan = state.activeSpan ?? current.duration
        const scale = activeSpan.add(current.duration).div(activeSpan)
        for (const event of state.active) {
          event.start = activeStart.add(event.start.sub(activeStart).mul(scale))
          event.duration = event.duration.mul(scale)
          if (current.extendsAutomation === false) completedAutomations.add(event)
          if (event.automation && !completedAutomations.has(event))
            event.automation = {
              ...event.automation,
              duration: copy(event.duration),
            }
          event.origins = [...event.origins, ...current.origins]
        }
        state.activeSpan = activeSpan.add(current.duration)
      }
    } else if (current.kind === 'rest') {
      state.active = []
      state.activeStart = undefined
      state.activeSpan = undefined
    } else if (current.kind === 'groove') {
      if (!current.template) state.groove = undefined
      else {
        const flattened = flattenScoreSemantics(current.template)
        diagnostics.push(...flattened.diagnostics)
        const controls = flattened.score.events.filter(
          (event): event is BeatTimedNoteEvent => event.kind === 'note',
        )
        if (
          !flattened.diagnostics.some(({ severity }) => severity === 'error') &&
          controls.length >= 2 &&
          flattened.score.duration.compare(0) > 0
        ) {
          const cycle = flattened.score.duration
          state.groove = {
            origin: copy(start),
            cycle,
            points: controls.map((control, index) => {
              const nextStart = controls[index + 1]?.start ?? cycle
              const occupied = nextStart.sub(control.start)
              return {
                nominal: cycle.mul(index).div(controls.length),
                actual: control.start,
                dynamic: control.dynamic,
                articulation: occupied.n ? control.duration.div(occupied) : new Fraction(1),
              }
            }),
          }
        }
      }
    } else if (current.kind === 'drone') {
      stopDrone(state, start)
      if (current.template) {
        const flattened = flattenScoreSemantics(current.template)
        diagnostics.push(...flattened.diagnostics)
        state.drone = flattened.score.events
          .filter((event): event is BeatTimedNoteEvent => event.kind === 'note')
          .map((event): MutableNoteEvent => {
            const drone: MutableNoteEvent = {
              ...event,
              // The expression selects the drone's notes; its internal rhythm does not
              // delay their attacks because every selected note begins with the directive.
              start: copy(start),
              duration: new Fraction(0),
              dynamic: copy(event.dynamic),
              origins: [...current.origins, ...event.origins],
              articulation: new Fraction(1),
              groove: state.groove,
            }
            events.push(drone)
            return drone
          })
      }
    } else if (
      current.kind === 'barline' ||
      current.kind === 'annotation' ||
      current.kind === 'dynamic'
    ) {
      events.push({
        kind: 'marker',
        start: copy(start),
        marker: current.kind,
        label:
          current.kind === 'barline'
            ? current.style
            : current.kind === 'dynamic'
              ? current.mark
              : current.text,
        origins: current.origins,
      })
    } else if (current.kind === 'clef' || current.kind === 'key-signature') {
      // Clefs and signatures are engraving-only context and deliberately do not enter playback.
    } else if (current.kind === 'sequence') {
      const firstEvent = events.length
      let cursor = start
      for (const child of current.children) cursor = visit(child, cursor, state)
      if (current.normalized) {
        state.active = events
          .slice(firstEvent)
          .filter((event): event is MutableNoteEvent => event.kind === 'note')
        state.activeStart = copy(start)
        state.activeSpan = copy(current.duration)
      }
      return start.add(current.duration)
    } else {
      const firstEvent = events.length
      const states = current.branches.map((): State => ({ active: [], groove: state.groove }))
      current.branches.forEach((branch, index) => visit(branch, start, states[index]!))
      const end = start.add(current.duration)
      for (const branchState of states) stopDrone(branchState, end)
      // A continuation after a parallel distributes over every attack in the
      // construction, rather than only the last attack in each branch.
      state.active = events
        .slice(firstEvent)
        .filter((event): event is MutableNoteEvent => event.kind === 'note')
      // Unlike a normalized sequence, an uneven parallel has no single active
      // span: only the final notes of its longest branches remain active.
      state.activeStart = undefined
      state.activeSpan = undefined
      return end
    }
    return start.add(current.duration)
  }

  const rootState: State = { active: [] }
  const end = visit(shape, new Fraction(0), rootState)
  stopDrone(rootState, end)
  for (const event of events) {
    if (event.kind !== 'note') continue
    const mutable = event as MutableNoteEvent
    const nominalStart = mutable.start
    const nominalEnd = nominalStart.add(mutable.duration)
    if (mutable.groove) {
      const warpedStart = interpolate(mutable.groove, nominalStart, 'actual')
      const warpedEnd = interpolate(mutable.groove, nominalEnd, 'actual')
      mutable.start = warpedStart
      mutable.duration = warpedEnd
        .sub(warpedStart)
        .mul(mutable.articulation)
        .mul(interpolate(mutable.groove, nominalStart, 'articulation'))
      mutable.dynamic = mutable.dynamic.mul(
        interpolate(mutable.groove, nominalStart, 'dynamic').div(DYNAMIC_VELOCITIES.mf),
      )
    } else mutable.duration = mutable.duration.mul(mutable.articulation)
    delete mutable.groove
    delete (mutable as Partial<MutableNoteEvent>).articulation
  }
  events.sort((left, right) => left.start.compare(right.start))
  return { score: { duration: copy(shape.duration), events }, diagnostics }
}

/** Expand repeats, evaluate score semantics, then produce exact beat-timed events. */
export function expandToBeatEvents(
  program: Program,
  options: BeatEventExpansionOptions = {},
): BeatEventExpansionResult {
  const expanded = expandRepeats(program, options)
  if (!expanded.program) return { diagnostics: expanded.diagnostics }
  const body = expanded.program.body
  if (!body.length)
    return { score: { duration: new Fraction(0), events: [] }, diagnostics: expanded.diagnostics }
  const location = program.location
  const node = {
    type: 'Sequence',
    items: body,
    location,
    expansionPath: [],
  } as unknown as ExpandedNode
  const evaluated = evaluateScoreSemantics(node as never, options)
  const diagnostics = [...expanded.diagnostics, ...evaluated.diagnostics]
  if (!('shape' in evaluated)) return { diagnostics }
  const flattened = flattenScoreSemantics(evaluated.shape)
  const allDiagnostics = [...diagnostics, ...flattened.diagnostics]
  return allDiagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { diagnostics: allDiagnostics }
    : { score: flattened.score, diagnostics: allDiagnostics }
}
