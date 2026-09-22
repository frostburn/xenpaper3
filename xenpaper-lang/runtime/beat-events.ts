import { Fraction } from 'xen-dev-utils/fraction'
import type { Program } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { expandRepeats } from './repeat-expansion'
import { evaluateScoreSemantics } from './score-evaluation'
import { DYNAMIC_VELOCITIES } from './directives'
import { Visitor, type VisitorEvaluation } from './visitor'
import type {
  BeatTimedEvent,
  BeatTimedNoteEvent,
  BeatTimedScore,
  ExpandedNode,
  RepeatExpansionOptions,
  ScoreShape,
  ScoreShapeOptions,
} from './types'

export interface BeatEventExpansionOptions extends ScoreShapeOptions, RepeatExpansionOptions {
  /** Pre-evaluated, zero-duration state annotations applied before the program. */
  initializationShape?: ScoreShape
  /** A duration-bearing global score whose state changes repeat over absolute time. */
  timelineShape?: ScoreShape
}

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
        ? grooveAt(timeline.grooveChanges, timelineDuration(timeline), nominalStart.add(beatOffset))
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

const grooveAt = (
  changes: readonly GrooveChange[],
  duration: Fraction,
  absoluteBeat: Fraction,
): Groove | undefined => {
  if (!changes.length || !duration.n) return undefined
  const cycleIndex = Math.floor(absoluteBeat.div(duration).valueOf())
  const cycleStart = duration.mul(cycleIndex)
  const localBeat = absoluteBeat.sub(cycleStart)
  let change = changes[changes.length - 1]!
  let changeCycle = cycleIndex - 1
  for (const candidate of changes) {
    if (candidate.start.compare(localBeat) > 0) break
    change = candidate
    changeCycle = cycleIndex
  }
  if (!change.groove) return undefined
  const origin = duration.mul(changeCycle).add(change.start)
  return { ...change.groove, origin }
}

const timelineDuration = (timeline: BeatEventFlatteningResult): Fraction => {
  const duration = timeline.score.duration
  const last = timeline.grooveChanges[timeline.grooveChanges.length - 1]
  const previous = timeline.grooveChanges[timeline.grooveChanges.length - 2]
  return last && previous && last.start.compare(duration) === 0
    ? duration.add(last.start.sub(previous.start))
    : duration
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
  const shape = options.initializationShape
    ? {
        kind: 'sequence' as const,
        duration: evaluated.shape.duration,
        origins: [...options.initializationShape.origins, ...evaluated.shape.origins],
        children: [options.initializationShape, evaluated.shape],
      }
    : evaluated.shape
  const timeline = options.timelineShape?.duration.n
    ? flattenScoreSemantics(options.timelineShape)
    : undefined
  const flattened = flattenScoreSemantics(shape, timeline, options.beatOffset ?? new Fraction(0))
  const allDiagnostics = [
    ...diagnostics,
    ...(timeline?.diagnostics ?? []),
    ...flattened.diagnostics,
  ]
  // Repeat expansion removes authored repeat/ending markers. Evaluate the original
  // tree as notation as well so every structural marker remains available for checks.
  const authored = evaluateScoreSemantics(
    {
      type: 'Sequence',
      items: program.body,
      location: program.location,
      expansionPath: [],
    } as unknown as never,
    options,
  )
  const structuralEvents =
    'shape' in authored
      ? flattenScoreSemantics(
          options.initializationShape
            ? {
                kind: 'sequence',
                duration: authored.shape.duration,
                origins: [...options.initializationShape.origins, ...authored.shape.origins],
                children: [options.initializationShape, authored.shape],
              }
            : authored.shape,
        ).score.events
      : flattened.score.events
  let signature: { length: Fraction; origin: Fraction } | undefined = options.timeSignature
    ? {
        length: new Fraction(
          options.timeSignature.numerator * 4,
          options.timeSignature.denominator,
        ),
        origin: new Fraction(0),
      }
    : undefined
  const absoluteOffset = options.beatOffset ?? new Fraction(0)
  const inheritedSignatureAt = (beat: Fraction) => {
    let prevailing: { length: Fraction; origin: Fraction } | undefined
    for (const change of options.timeSignatureChanges ?? []) {
      const origin = new Fraction(change.beat)
      if (origin.compare(beat) > 0) break
      prevailing = {
        length: new Fraction(change.numerator * 4, change.denominator),
        origin,
      }
    }
    return prevailing
  }
  let authoredSignature = false
  const warnedBarlines = new Set<string>()
  for (const event of structuralEvents) {
    if (event.kind !== 'marker') continue
    const absoluteStart = event.start.add(absoluteOffset)
    if (event.marker === 'time-signature') {
      const [numerator, denominator] = event.label.split('/').map(Number)
      signature = {
        length: new Fraction(numerator! * 4, denominator),
        origin: absoluteStart,
      }
      authoredSignature = true
    } else if (event.marker === 'barline') {
      if (!authoredSignature) signature = inheritedSignatureAt(absoluteStart) ?? signature
      if (!signature) continue
      const cycles = absoluteStart.sub(signature.origin).div(signature.length)
      const locations = event.origins.map((origin) => origin.location)
      const warningKey = locations
        .map(({ start, end }) => `${start.offset}:${end.offset}`)
        .join(',')
      if (cycles.d !== 1 && !warnedBarlines.has(warningKey)) {
        warnedBarlines.add(warningKey)
        allDiagnostics.push({
          code: 'XP_BARLINE_OFF_CYCLE',
          severity: 'warning',
          message: `Barline does not fall on a whole multiple of the ${signature.length.toFraction()}-beat measure.`,
          locations,
        })
      }
    }
  }
  return allDiagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { diagnostics: allDiagnostics }
    : { score: flattened.score, diagnostics: allDiagnostics }
}
