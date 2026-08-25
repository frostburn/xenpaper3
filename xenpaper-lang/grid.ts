import { Fraction, type FractionValue } from 'xen-dev-utils/fraction'
import { Monomial } from './monomial'
import type {
  DirectiveExtensionState,
  IntervalSpelling,
  PitchAutomation,
  PitchAutomationSegment,
  PitchSpelling,
  BeatTimedMarkerEvent,
  TimedNoteEvent,
} from './runtime/types'

const copyFraction = (value: Fraction): Fraction => new Fraction(value.s * value.n, value.d)

export interface GridTimedEvent {
  readonly start: Fraction
}

const shifted = <Event extends GridTimedEvent>(event: Event, offset: Fraction): Event =>
  Object.freeze({ ...event, start: event.start.add(offset) }) as Event

/**
 * An immutable exact-time score transaction.
 *
 * A grid has no ambient cursor. Sequential, parallel, delayed, and repeated use
 * return new grids, so a callee can construct music locally and its caller chooses
 * exactly once how that fragment is committed.
 */
export class ScoreGrid<Event extends GridTimedEvent> {
  readonly span: Fraction
  readonly events: readonly Event[]

  constructor(span: FractionValue, events: readonly Event[] = []) {
    const exactSpan = new Fraction(span)
    if (exactSpan.compare(0) < 0) throw new RangeError('A score grid cannot have a negative span.')
    this.span = exactSpan
    this.events = Object.freeze(
      events
        .map((event, index) => ({
          event: Object.freeze({ ...event, start: copyFraction(event.start) }) as Event,
          index,
        }))
        .sort(
          (left, right) => left.event.start.compare(right.event.start) || left.index - right.index,
        )
        .map(({ event }) => event),
    )
  }

  static empty<Event extends GridTimedEvent>(): ScoreGrid<Event> {
    return new ScoreGrid<Event>(0)
  }

  static sequence<Event extends GridTimedEvent>(
    ...fragments: readonly ScoreGrid<Event>[]
  ): ScoreGrid<Event> {
    return ScoreGrid.empty<Event>().append(...fragments)
  }

  static parallel<Event extends GridTimedEvent>(
    ...fragments: readonly ScoreGrid<Event>[]
  ): ScoreGrid<Event> {
    return ScoreGrid.empty<Event>().overlay(...fragments)
  }

  /** Compatibility name for consumers that think in score duration. */
  get duration(): Fraction {
    return this.span
  }

  /** Add exact leading silence. */
  delay(offset: FractionValue): ScoreGrid<Event> {
    const exactOffset = new Fraction(offset)
    if (exactOffset.compare(0) < 0) throw new RangeError('A score-grid delay cannot be negative.')
    return new ScoreGrid(
      this.span.add(exactOffset),
      this.events.map((event) => shifted(event, exactOffset)),
    )
  }

  /** Append fragments transactionally, advancing by each fragment's full span once. */
  append(...fragments: readonly ScoreGrid<Event>[]): ScoreGrid<Event> {
    let cursor = copyFraction(this.span)
    const events = [...this.events]
    for (const fragment of fragments) {
      events.push(...fragment.events.map((event) => shifted(event, cursor)))
      cursor = cursor.add(fragment.span)
    }
    return new ScoreGrid(cursor, events)
  }

  /** Overlay fragments at the same origin without advancing an implicit cursor. */
  overlay(...fragments: readonly ScoreGrid<Event>[]): ScoreGrid<Event> {
    let span = copyFraction(this.span)
    const events = [...this.events]
    for (const fragment of fragments) {
      events.push(...fragment.events)
      if (fragment.span.compare(span) > 0) span = copyFraction(fragment.span)
    }
    return new ScoreGrid(span, events)
  }

  /** Tile a completed transaction without re-evaluating its contents. */
  repeat(count: number): ScoreGrid<Event> {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new RangeError('A score-grid repeat count must be a non-negative safe integer.')
    if (!count) return ScoreGrid.empty<Event>()
    const events: Event[] = []
    for (let iteration = 0; iteration < count; iteration += 1) {
      const offset = this.span.mul(iteration)
      events.push(...this.events.map((event) => shifted(event, offset)))
    }
    return new ScoreGrid(this.span.mul(count), events)
  }

  map<Mapped extends GridTimedEvent>(
    mapper: (event: Event, index: number) => Mapped,
  ): ScoreGrid<Mapped> {
    return new ScoreGrid(this.span, this.events.map(mapper))
  }

  filter(predicate: (event: Event, index: number) => boolean): ScoreGrid<Event> {
    return new ScoreGrid(this.span, this.events.filter(predicate))
  }
}

export interface GridPitch {
  readonly kind: 'offset' | 'absolute'
  /** Exact sounding coordinate after the active Xenpaper prime mapping. */
  readonly sounding: Monomial
  /** Root-relative coordinate retained for notation when it differs from sounding pitch. */
  readonly notation?: Monomial
  /** Untempered/source identity before the active mapping, when one exists. */
  readonly formula?: Monomial
  readonly spelling?: IntervalSpelling | PitchSpelling
  readonly scaleDegree?: number
  readonly justIntonation?: boolean
}

export type GridPitchAutomationSegment = PitchAutomationSegment<GridPitch, GridPitch>
export type GridPitchAutomation = PitchAutomation<GridPitch, GridPitch>

export interface GridNoteEvent
  extends TimedNoteEvent<GridPitch, GridPitch, GridPitchAutomation> {
  /** Immutable snapshots owned by second-party directive extensions. */
  readonly extensions: DirectiveExtensionState
}

export type GridMarkerEvent = BeatTimedMarkerEvent

export type GridEvent = GridNoteEvent | GridMarkerEvent
export type MonomialGrid = ScoreGrid<GridEvent>
