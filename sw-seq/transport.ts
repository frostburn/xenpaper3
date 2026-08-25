import { mmod } from 'xen-dev-utils/fraction'

const round = Math.round

type ParametricEvent = {
  id: number
  callback: (time: number) => void
  when: number
}

/** Releases a scheduled note and returns the time at which its audio tail is silent. */
export type NoteOff = (time: number) => number

export type ParametricNote = {
  /** Starts the note and returns its matching release callback. */
  noteOn: (time: number) => NoteOff
  when: number
  duration: number
}

type ParametricNoteHandle = ParametricNote & {
  id: number
}
type TransportEvent = {
  id: number
  callback: () => void
  when: number
}

type TimeoutHandle = ReturnType<typeof setTimeout>

export type TransportOptions = {
  interval?: number
  lookAhead?: number
  useSetTimeoutFallback?: boolean
}

const validateTimingOption = (value: number, name: string, minimum: number): void => {
  if (!Number.isFinite(value) || value < minimum)
    throw new RangeError(`${name} must be finite and at least ${minimum}`)
}

/** Look-ahead event scheduler whose public position follows the audible context clock. */
export class Transport extends EventTarget {
  readonly context: BaseAudioContext
  active: boolean
  loop: boolean

  // Private times and durations are integral sample positions.
  // "Time" refers to context time; "position" refers to event time.
  private interval: number
  private _lookAhead: number
  private audibleStartTime: number
  private startPosition: number
  private lastTickTime: number
  private schedulePosition: number
  private stoppedPosition: number
  private endPos: number
  private loopStartPos: number
  private loopEndPos: number
  private parametricEventsById: Map<number, ParametricEvent>
  private parametricNotesById: Map<number, ParametricNoteHandle>
  private eventsById: Map<number, TransportEvent>
  private nextEventId: number
  private useSetTimeoutFallback: boolean
  private tickTimeout: TimeoutHandle | undefined
  private runId: number
  private endedDispatched: boolean

  constructor(context: BaseAudioContext, options: TransportOptions = {}) {
    super()

    const { interval = 0.1, lookAhead = 0.2, useSetTimeoutFallback = false } = options
    validateTimingOption(interval, 'Transport interval', Number.EPSILON)
    validateTimingOption(lookAhead, 'Transport look-ahead', 0)

    this.context = context
    this.interval = Math.max(1, round(interval * context.sampleRate))
    this._lookAhead = Math.max(0, round(lookAhead * context.sampleRate))
    this.active = false
    this.loop = false
    this.audibleStartTime = NaN
    this.startPosition = 0
    this.lastTickTime = NaN
    this.schedulePosition = 0
    this.stoppedPosition = 0
    this.endPos = Infinity
    this.loopStartPos = 0
    this.loopEndPos = 0
    this.parametricEventsById = new Map()
    this.parametricNotesById = new Map()
    this.eventsById = new Map()
    this.nextEventId = 1
    this.useSetTimeoutFallback = useSetTimeoutFallback
    this.tickTimeout = undefined
    this.runId = 0
    this.endedDispatched = false
  }

  get lookAhead() {
    return this._lookAhead / this.context.sampleRate
  }

  /** Event position at the audible audio clock, not the scheduler's look-ahead horizon. */
  get position() {
    const samples = this.active ? this.clockPosition() : this.stoppedPosition
    return this.normalizePosition(samples) / this.context.sampleRate
  }

  get endTime() {
    return this.endPos / this.context.sampleRate
  }

  set endTime(value: number) {
    if ((value !== Infinity && !Number.isFinite(value)) || value < 0)
      throw new RangeError('Transport end time must be non-negative and finite or Infinity')
    this.endPos = round(value * this.context.sampleRate)
  }

  get loopStart() {
    return this.loopStartPos / this.context.sampleRate
  }

  set loopStart(value: number) {
    if (!Number.isFinite(value)) throw new RangeError('Loop start must be finite')
    this.loopStartPos = round(value * this.context.sampleRate)
  }

  get loopEnd() {
    return this.loopEndPos / this.context.sampleRate
  }

  set loopEnd(value: number) {
    if (!Number.isFinite(value)) throw new RangeError('Loop end must be finite')
    this.loopEndPos = round(value * this.context.sampleRate)
  }

  private get loopLength() {
    return this.loopEndPos - this.loopStartPos
  }

  start(offset = 0) {
    if (!Number.isFinite(offset)) throw new RangeError('Transport offset must be finite')
    if (this.active) this.stop()
    if (this.tickTimeout !== undefined) clearTimeout(this.tickTimeout)
    this.tickTimeout = undefined

    const runId = ++this.runId
    this.endedDispatched = false
    this.lastTickTime = round(this.context.currentTime * this.context.sampleRate)
    this.audibleStartTime = this.lastTickTime + this._lookAhead
    this.startPosition = this.normalizePosition(round(offset * this.context.sampleRate))
    this.schedulePosition = this.startPosition
    this.stoppedPosition = this.startPosition
    this.active = true
    this.onInterval(runId)
  }

  private clockPosition(): number {
    if (!Number.isFinite(this.audibleStartTime)) return 0
    const contextTime = round(this.context.currentTime * this.context.sampleRate)
    return this.startPosition + Math.max(0, contextTime - this.audibleStartTime)
  }

  private normalizePosition(position: number): number {
    if (this.loop && this.loopLength > 0 && position >= this.loopEndPos) {
      return this.loopStartPos + mmod(position - this.loopStartPos, this.loopLength)
    }
    if (!this.loop && Number.isFinite(this.endPos)) return Math.min(position, this.endPos)
    return position
  }

  private scheduleTimeout(callback: () => void, time: number) {
    const delay = Math.max(0, (time - this.context.currentTime) * 1000)
    return setTimeout(callback, delay)
  }

  private scheduleTick(runId: number, time: number, completes: boolean): void {
    const scheduledTime = Math.max(
      time,
      this.context.currentTime + 1 / this.context.sampleRate,
    )
    const callback = () => {
      if (runId !== this.runId || !this.active) return
      if (completes) this.finish(runId)
      else this.onInterval(runId)
    }

    if (this.useSetTimeoutFallback) {
      this.tickTimeout = this.scheduleTimeout(() => {
        this.tickTimeout = undefined
        callback()
      }, scheduledTime)
      return
    }

    const ticker = this.context.createConstantSource()
    ticker.addEventListener('ended', callback, { once: true })
    ticker.start(this.context.currentTime)
    ticker.stop(scheduledTime)
  }

  /** Fire the next scheduling interval, wrapping through the active loop when necessary. */
  private onInterval(runId = this.runId) {
    if (runId !== this.runId || !this.active) return

    let startTime = this.lastTickTime
    let startPos = this.schedulePosition
    const loopLength = this.loopLength
    if (this.loop && loopLength > 0) {
      let endPos = startPos + this.interval
      while (endPos > this.loopEndPos) {
        this.fireInRange(runId, startTime, startPos, this.loopEndPos)
        startTime += this.loopEndPos - startPos
        startPos = this.loopStartPos
        endPos -= loopLength
      }
      this.fireInRange(runId, startTime, startPos, endPos)
      this.schedulePosition = endPos
      this.lastTickTime += this.interval
      this.scheduleTick(runId, this.lastTickTime / this.context.sampleRate, false)
      return
    }

    const endPos = Math.min(startPos + this.interval, this.endPos)
    this.fireInRange(runId, startTime, startPos, endPos)
    const advance = Math.max(0, endPos - startPos)
    this.schedulePosition = endPos
    this.lastTickTime += advance
    const completes = endPos >= this.endPos
    const tickTime = this.lastTickTime + (completes ? this._lookAhead : 0)
    this.scheduleTick(runId, tickTime / this.context.sampleRate, completes)
  }

  /** Fire all events in the half-open event-position range `[startPos, endPos)`. */
  private fireInRange(runId: number, startTime: number, startPos: number, endPos: number) {
    if (endPos <= startPos) return

    for (const event of this.parametricEventsById.values()) {
      if (event.when >= startPos && event.when < endPos) {
        event.callback(
          (event.when - startPos + startTime + this._lookAhead) / this.context.sampleRate,
        )
      }
    }

    const notes = Array.from(this.parametricNotesById.values())
      .filter((event) => event.when >= startPos && event.when < endPos)
      .sort((left, right) => left.when - right.when || left.id - right.id)
    for (const event of notes) {
      const noteOff = event.noteOn(
        (event.when - startPos + startTime + this._lookAhead) / this.context.sampleRate,
      )

      // Commit to the matching release together with note-on. Unpaired events are hard
      // to reason about and can leak voices even though this schedules farther ahead
      // than an ideal cancellation-aware transport would.
      noteOff(
        (event.when + event.duration - startPos + startTime + this._lookAhead) /
          this.context.sampleRate,
      )
    }

    for (const event of this.eventsById.values()) {
      if (event.when < startPos || event.when >= endPos) continue
      const eventTime =
        (event.when - startPos + startTime + this._lookAhead) / this.context.sampleRate
      const callback = () => {
        if (runId !== this.runId || !this.eventsById.has(event.id)) return
        event.callback()
      }

      if (this.useSetTimeoutFallback) {
        this.scheduleTimeout(callback, eventTime)
        continue
      }

      const timer = this.context.createConstantSource()
      timer.addEventListener('ended', callback, { once: true })
      timer.start(this.context.currentTime)
      timer.stop(eventTime)
    }
  }

  private finish(runId: number): void {
    if (runId !== this.runId || !this.active) return
    this.stoppedPosition = Number.isFinite(this.endPos)
      ? this.endPos
      : this.normalizePosition(this.clockPosition())
    this.active = false
    this.dispatchEnded()
  }

  private dispatchEnded(): void {
    if (this.endedDispatched) return
    this.endedDispatched = true
    this.dispatchEvent(new Event('ended'))
  }

  stop() {
    if (!this.active) return
    this.stoppedPosition = this.normalizePosition(this.clockPosition())
    this.active = false
    this.runId += 1
    if (this.tickTimeout !== undefined) clearTimeout(this.tickTimeout)
    this.tickTimeout = undefined
    this.dispatchEnded()
  }

  clear(id: number) {
    this.parametricEventsById.delete(id)
    this.parametricNotesById.delete(id)
    this.eventsById.delete(id)
  }

  clearAll() {
    this.parametricEventsById.clear()
    this.parametricNotesById.clear()
    this.eventsById.clear()
  }

  private eventPosition(value: number, name: string): number {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`)
    return round(value * this.context.sampleRate)
  }

  scheduleParametric(callback: (time: number) => void, when: number) {
    const position = this.eventPosition(when, 'Event time')
    const id = this.nextEventId++
    this.parametricEventsById.set(id, { id, callback, when: position })
    return id
  }

  scheduleParametricNote(note: ParametricNote) {
    const position = this.eventPosition(note.when, 'Note time')
    if (!Number.isFinite(note.duration) || note.duration < 0)
      throw new RangeError('Note duration must be finite and non-negative')
    const id = this.nextEventId++
    this.parametricNotesById.set(id, {
      ...note,
      id,
      when: position,
      duration: round(note.duration * this.context.sampleRate),
    })
    return id
  }

  scheduleEvent(callback: () => void, when: number) {
    const position = this.eventPosition(when, 'Event time')
    const id = this.nextEventId++
    this.eventsById.set(id, { id, callback, when: position })
    return id
  }
}
