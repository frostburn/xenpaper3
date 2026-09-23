import { Fraction } from 'xen-dev-utils/fraction'
import type { Program } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { evaluateProgramSemantics } from './score-shape'
import { DYNAMIC_VELOCITIES } from './directives'
import { Visitor, type VisitorEvaluation } from './visitor'
import type {
  BeatTimedEvent,
  BeatTimedNoteEvent,
  BeatTimedScore,
  ScoreShape,
  ScoreShapeOptions,
} from './types'

export type BeatEventExpansionOptions = ScoreShapeOptions

export type BeatEventExpansionResult =
  | { readonly score: BeatTimedScore; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] }

interface BeatEventFlatteningResult {
  readonly score: BeatTimedScore
  readonly diagnostics: readonly Diagnostic[]
  readonly grooveChanges: readonly GrooveChange[]
}

const copy = (value: Fraction) => new Fraction(value.n, value.d)

type Groove = {
  origin: Fraction
  cycle: Fraction
  points: { nominal: Fraction; actual: Fraction; dynamic: Fraction; articulation: Fraction }[]
}

type GrooveChange = { readonly start: Fraction; readonly groove?: Groove }

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
  useTimelineGroove: boolean
  articulation: Fraction
}

type FlatteningState = {
  active: MutableNoteEvent[]
  activeStart?: Fraction
  activeSpan?: Fraction
  groove?: Groove
  grooveOverride?: boolean
  drone?: MutableNoteEvent[]
}

interface FlatteningScope {
  readonly start: Fraction
  readonly state: FlatteningState
}

function interpolateGroove(
  groove: Groove,
  value: Fraction,
  key: 'actual' | 'dynamic' | 'articulation',
) {
  const relative = value.sub(groove.origin)
  const cycleIndex = relative.div(groove.cycle).floor()
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

function stopDrone(state: FlatteningState, end: Fraction) {
  for (const event of state.drone ?? []) event.duration = end.sub(event.start)
  state.drone = undefined
}

/** Flatten evaluated playback semantics without converting exact beat positions to seconds. */
export function flattenScoreSemantics(
  shape: ScoreShape,
  timeline?: BeatEventFlatteningResult,
  beatOffset = new Fraction(0),
): BeatEventFlatteningResult {
  const events: BeatTimedEvent[] = []
  const diagnostics: Diagnostic[] = []
  const grooveChanges: GrooveChange[] = []
  const completedAutomations = new WeakSet<MutableNoteEvent>()
  const evaluate: VisitorEvaluation<ScoreShape, FlatteningScope, Fraction> = (current, visitor) => {
    const { state } = visitor.scope
    if (!current.isolatedDirectiveScope) return visitCurrent(current, visitor)
    const isolatedState = { ...state }
    const isolatedVisitor = visitor.spawn({ state: isolatedState })
    const end = visitCurrent(current, isolatedVisitor)
    if (isolatedState.drone !== state.drone) stopDrone(isolatedState, end)
    if (isolatedState.groove !== state.groove)
      grooveChanges.push({ start: copy(end), groove: state.groove })
    state.active = isolatedState.active
    state.activeStart = isolatedState.activeStart
    state.activeSpan = isolatedState.activeSpan
    return end
  }

  const visitCurrent = (
    current: ScoreShape,
    visitor: Visitor<ScoreShape, FlatteningScope, Fraction>,
  ): Fraction => {
    const { start, state } = visitor.scope
    if (current.kind === 'attack') {
      const event: MutableNoteEvent = {
        kind: 'note',
        start: copy(start),
        duration: copy(current.duration),
        pitch: current.pitch,
        rootPitch: current.rootPitch,
        dynamic: copy((current as typeof current & { readonly velocity: Fraction }).velocity),
        directiveState: { ...current.directiveState },
        automation: current.automation,
        label: current.authoredLabel ?? current.displayLabel,
        origins: current.origins,
        groove: state.groove,
        useTimelineGroove: !state.grooveOverride,
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
      state.grooveOverride = true
      if (!current.template) {
        state.groove = undefined
        grooveChanges.push({ start: copy(start) })
      } else {
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
          grooveChanges.push({ start: copy(start), groove: state.groove })
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
              useTimelineGroove: !state.grooveOverride,
            }
            events.push(drone)
            return drone
          })
      }
    } else if (
      current.kind === 'barline' ||
      current.kind === 'annotation' ||
      current.kind === 'dynamic' ||
      current.kind === 'time-signature' ||
      current.kind === 'tempo'
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
              : current.kind === 'time-signature'
                ? `${current.numerator}/${current.denominator}`
                : current.kind === 'tempo'
                  ? current.bpm.toFraction()
                  : current.text,
        origins: current.origins,
      })
    } else if (current.kind === 'clef' || current.kind === 'key-signature') {
      // Clefs and signatures are engraving-only context and deliberately do not enter playback.
    } else if (current.kind === 'sequence') {
      const firstEvent = events.length
      let cursor = start
      for (const child of current.children) cursor = visitor.visit(child, { start: cursor })
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
      const states = current.branches.map(
        (): FlatteningState => ({
          active: [],
          groove: state.groove,
          grooveOverride: state.grooveOverride,
        }),
      )
      current.branches.forEach((branch, index) => visitor.visit(branch, { state: states[index]! }))
      const end = start.add(current.duration)
      for (const branchState of states) {
        stopDrone(branchState, end)
        if (branchState.groove !== state.groove)
          grooveChanges.push({ start: copy(end), groove: state.groove })
      }
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

  const rootState: FlatteningState = { active: [] }
  const visitor = new Visitor(evaluate, { start: new Fraction(0), state: rootState })
  const end = visitor.visit(shape)
  stopDrone(rootState, end)
  for (const event of events) {
    if (event.kind !== 'note') continue
    const mutable = event as MutableNoteEvent
    const nominalStart = mutable.start
    const nominalEnd = nominalStart.add(mutable.duration)
    const groove =
      mutable.groove ??
      (timeline && mutable.useTimelineGroove
        ? grooveAt(timeline.grooveChanges, nominalStart.add(beatOffset))
        : undefined)
    if (groove) {
      const grooveStart = nominalStart.add(beatOffset)
      const grooveEnd = nominalEnd.add(beatOffset)
      const warpedStart = interpolateGroove(groove, grooveStart, 'actual').sub(beatOffset)
      const warpedEnd = interpolateGroove(groove, grooveEnd, 'actual').sub(beatOffset)
      mutable.start = warpedStart
      mutable.duration = warpedEnd
        .sub(warpedStart)
        .mul(mutable.articulation)
        .mul(interpolateGroove(groove, grooveStart, 'articulation'))
      mutable.dynamic = mutable.dynamic.mul(
        interpolateGroove(groove, grooveStart, 'dynamic').div(DYNAMIC_VELOCITIES.mf),
      )
    } else mutable.duration = mutable.duration.mul(mutable.articulation)
    delete mutable.groove
    delete (mutable as Partial<MutableNoteEvent>).useTimelineGroove
    delete (mutable as Partial<MutableNoteEvent>).articulation
  }
  events.sort((left, right) => left.start.compare(right.start))
  return { score: { duration: copy(shape.duration), events }, diagnostics, grooveChanges }
}

const grooveAt = (changes: readonly GrooveChange[], absoluteBeat: Fraction): Groove | undefined => {
  let groove: Groove | undefined
  for (const change of changes) {
    if (change.start.compare(absoluteBeat) > 0) break
    groove = change.groove
  }
  return groove
}

/** Expand repeats, evaluate score semantics, then produce exact beat-timed events. */
export function expandToBeatEvents(
  program: Program,
  options: BeatEventExpansionOptions = {},
): BeatEventExpansionResult {
  const evaluated = evaluateProgramSemantics(program, options)
  const diagnostics = [...evaluated.diagnostics]
  if (!('shape' in evaluated)) return { diagnostics }
  const initializationShape = options.initialization?.shape
  const timelineShape = options.initialization?.timelineShape
  const shape = initializationShape
    ? {
        kind: 'sequence' as const,
        duration: evaluated.shape.duration,
        origins: [...initializationShape.origins, ...evaluated.shape.origins],
        children: [initializationShape, evaluated.shape],
      }
    : evaluated.shape
  const timeline = timelineShape?.duration.n ? flattenScoreSemantics(timelineShape) : undefined
  const flattened = flattenScoreSemantics(shape, timeline, options.beatOffset ?? new Fraction(0))
  const allDiagnostics = [
    ...diagnostics,
    ...(timeline?.diagnostics ?? []),
    ...flattened.diagnostics,
  ]
  return allDiagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { diagnostics: allDiagnostics }
    : { score: flattened.score, diagnostics: allDiagnostics }
}
