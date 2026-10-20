import { Fraction } from 'xen-dev-utils/fraction'
import type { AttackShape, ContinueShape, ScoreShape, SourceOrigin } from './types'

interface TimedAttack {
  readonly attack: AttackShape
  start: Fraction
  duration: Fraction
  origins: readonly SourceOrigin[]
  automation: AttackShape['automation']
  automationComplete?: boolean
}

/** Resolve existing holds before changing endpoints, retaining the authored grid. */
function timedAttacks(shape: ScoreShape) {
  const notes: TimedAttack[] = []
  const continued = new Set<ContinueShape>()
  type State = { active: TimedAttack[]; start?: Fraction; span?: Fraction }
  const visit = (current: ScoreShape, start: Fraction, state: State): void => {
    if (current.kind === 'attack') {
      const note: TimedAttack = {
        attack: current,
        start,
        duration: current.duration,
        origins: current.origins,
        automation: current.automation,
      }
      notes.push(note)
      state.active = [note]
      state.start = start
      state.span = current.duration
    } else if (current.kind === 'continue' && state.active.length) {
      continued.add(current)
      const activeStart = state.start ?? state.active[0]!.start
      const activeSpan = state.span ?? current.duration
      const scale = activeSpan.add(current.duration).div(activeSpan)
      for (const note of state.active) {
        note.start = activeStart.add(note.start.sub(activeStart).mul(scale))
        note.duration = note.duration.mul(scale)
        note.origins = [...note.origins, ...current.origins]
        if (current.extendsAutomation === false) note.automationComplete = true
        if (note.automation && !note.automationComplete)
          note.automation = { ...note.automation, duration: note.duration }
      }
      state.span = activeSpan.add(current.duration)
    } else if (current.kind === 'rest') {
      state.active = []
      state.start = state.span = undefined
    } else if (current.kind === 'sequence') {
      const first = notes.length
      let offset = start
      for (const child of current.children) {
        visit(child, offset, state)
        offset = offset.add(child.duration)
      }
      if (current.normalized || current.continuationTarget === 'all') {
        state.active = notes.slice(first)
        state.start = current.normalized ? start : undefined
        state.span = current.normalized ? current.duration : undefined
      }
    } else if (current.kind === 'parallel') {
      const first = notes.length
      for (const branch of current.branches) visit(branch, start, { active: [] })
      state.active = notes.slice(first)
      state.start = state.span = undefined
    }
  }
  visit(shape, new Fraction(0), { active: [] })
  return { notes, continued }
}

/**
 * Sequence two operands, replacing each matching left endpoint with the latest
 * matching right endpoint. Matched right attacks disappear; their slots remain.
 */
export function tieScoreShapes(
  left: ScoreShape,
  right: ScoreShape,
  origins: readonly SourceOrigin[],
): ScoreShape {
  const source = timedAttacks(left)
  const target = timedAttacks(right)
  const removed = new Set<AttackShape>()
  for (const note of source.notes) {
    const matches = target.notes.filter((other) =>
      note.attack.pitch.value.equals(other.attack.pitch.value),
    )
    if (!matches.length) continue
    let end = new Fraction(0)
    for (const match of matches) {
      removed.add(match.attack)
      const matchEnd = match.start.add(match.duration)
      if (matchEnd.compare(end) > 0) end = matchEnd
    }
    note.duration = left.duration.add(end).sub(note.start)
    note.origins = [...note.origins, ...origins, ...matches.flatMap((match) => match.origins)]
  }

  const restore = (shape: ScoreShape, timing: ReturnType<typeof timedAttacks>): ScoreShape => {
    const notes = new Map(timing.notes.map((note) => [note.attack, note]))
    const visit = (current: ScoreShape, start: Fraction): ScoreShape => {
      if (current.kind === 'attack') {
        if (removed.has(current))
          return {
            kind: 'rest',
            duration: current.duration,
            generated: true,
            origins: current.origins,
          }
        const note = notes.get(current)!
        if (
          note.start.equals(start) &&
          note.duration.equals(current.duration) &&
          note.origins === current.origins
        )
          return current
        const attack: AttackShape = {
          ...current,
          duration: note.duration,
          origins: note.origins,
          automation: note.automation,
        }
        const delay = note.start.sub(start)
        const branch: ScoreShape = delay.n
          ? {
              kind: 'sequence',
              duration: delay.add(attack.duration),
              children: [
                { kind: 'rest', duration: delay, generated: true, origins: current.origins },
                attack,
              ],
              origins: current.origins,
            }
          : attack
        // Keep the attack's rhythmic slot even when its sounding end changes.
        return {
          kind: 'parallel',
          duration: current.duration,
          branches: [branch],
          origins: current.origins,
        }
      }
      if (current.kind === 'continue' && timing.continued.has(current))
        return {
          kind: 'rest',
          duration: current.duration,
          generated: true,
          origins: current.origins,
        }
      if (current.kind === 'sequence') {
        let offset = start
        const children = current.children.map((child) => {
          const result = visit(child, offset)
          offset = offset.add(child.duration)
          return result
        })
        return { ...current, children }
      }
      if (current.kind === 'parallel')
        return { ...current, branches: current.branches.map((branch) => visit(branch, start)) }
      return current
    }
    return visit(shape, new Fraction(0))
  }
  const duration = left.duration.add(right.duration)
  return {
    kind: 'sequence',
    duration,
    children: [restore(left, source), restore(right, target)],
    continuationTarget: 'all',
    origins,
  }
}
