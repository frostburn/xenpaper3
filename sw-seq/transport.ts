import { mmod } from 'xen-dev-utils/fraction'

const round = Math.round

type ParametricEvent = {
  id: number
  callback: (time: number) => void
  when: number
}

type ParametricNoteHandle = {
  id: number
  noteOn: (time: number) => void
  noteOff: (time: number) => void
  when: number
  duration: number
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

/**
 * Transport using look-ahead scheduling.
 */
export class Transport extends EventTarget {
  readonly context: BaseAudioContext
  active: boolean
  loop: boolean

  // Private time/duration measured in samples
  // "Time" refers to context time
  // "Position" refers to event time
  private interval: number
  private _lookAhead: number
  private startTime: number
  private lastTickTime: number
  private _position: number
  private endPos: number
  private loopStartPos: number
  private loopEndPos: number
  private parametricEventsById: Map<number, ParametricEvent>
  private parametricNotesById: Map<number, ParametricNoteHandle>
  private eventsById: Map<number, TransportEvent>
  private nextEventId: number
  private useSetTimeoutFallback: boolean
  private tickTimeout: TimeoutHandle | undefined

  constructor(context: BaseAudioContext, options: TransportOptions = {}) {
    super()

    const { interval = 0.1, lookAhead = 0.2, useSetTimeoutFallback = false } = options

    this.context = context
    this.interval = round(interval * context.sampleRate)
    this._lookAhead = round(lookAhead * context.sampleRate)
    this.active = false
    this.loop = false
    this.startTime = NaN
    this.lastTickTime = NaN
    this._position = NaN
    this.endPos = Infinity
    this.loopStartPos = 0
    this.loopEndPos = 0
    this.parametricEventsById = new Map()
    this.parametricNotesById = new Map()
    this.eventsById = new Map()
    this.nextEventId = 1
    this.useSetTimeoutFallback = useSetTimeoutFallback
    this.tickTimeout = undefined
  }

  get lookAhead() {
    return this._lookAhead / this.context.sampleRate
  }

  get position() {
    return this._position / this.context.sampleRate
  }

  get endTime() {
    return this.endPos / this.context.sampleRate
  }

  set endTime(value: number) {
    this.endPos = round(value * this.context.sampleRate)
  }

  get loopStart() {
    return this.loopStartPos / this.context.sampleRate
  }

  set loopStart(value: number) {
    this.loopStartPos = round(value * this.context.sampleRate)
  }

  get loopEnd() {
    return this.loopEndPos / this.context.sampleRate
  }

  set loopEnd(value: number) {
    this.loopEndPos = round(value * this.context.sampleRate)
  }

  private get loopLength() {
    return this.loopEndPos - this.loopStartPos
  }

  start(offset = 0) {
    this.startTime = round((this.context.currentTime - offset) * this.context.sampleRate)
    this.active = true
    this.lastTickTime = round(this.context.currentTime * this.context.sampleRate)

    this._position = this.lastTickTime - this.startTime
    const loopLength = this.loopEndPos - this.loopStartPos
    if (this.loop && loopLength > 0 && this._position >= this.loopEndPos) {
      this._position = this.loopStartPos + mmod(this._position - this.loopStartPos, loopLength)
    }

    this.onInterval()
  }

  private scheduleTimeout(callback: () => void, time: number) {
    const delay = Math.max(0, (time - this.context.currentTime) * 1000)

    return setTimeout(callback, delay)
  }

  private scheduleNextInterval() {
    const nextTime = this.lastTickTime / this.context.sampleRate

    if (this.useSetTimeoutFallback) {
      this.tickTimeout = this.scheduleTimeout(() => {
        this.tickTimeout = undefined
        this.onInterval()
      }, nextTime)
      return
    }

    const ticker = this.context.createConstantSource()
    ticker.addEventListener('ended', this.onInterval.bind(this), { once: true })
    ticker.start(this.context.currentTime)
    ticker.stop(nextTime)
  }

  /**
   * Fire all events from the current position to pos+interval while looping.
   */
  private onInterval() {
    if (!this.active) {
      this.dispatchEvent(new Event('ended'))
      return
    }

    let startTime = this.lastTickTime
    let startPos = this._position
    this._position += this.interval
    const loopLength = this.loopEndPos - this.loopStartPos
    if (this.loop && loopLength > 0) {
      while (this._position > this.loopEndPos) {
        this.fireInRange(startTime, startPos, this.loopEndPos)
        startTime += this.loopEndPos - startPos
        startPos = this.loopStartPos
        this._position -= loopLength
      }
    }
    this.fireInRange(startTime, startPos, this._position)

    this.lastTickTime += this.interval
    this.scheduleNextInterval()

    if (this._position >= this.endPos) {
      this.active = false
    }
  }

  /**
   * Fire all events in the given range.
   */
  private fireInRange(startTime: number, startPos: number, endPos: number) {
    for (const event of this.parametricEventsById.values()) {
      if (event.when >= startPos && event.when < endPos) {
        event.callback(
          (event.when - startPos + startTime + this._lookAhead) / this.context.sampleRate,
        )
      }
    }

    const notes = Array.from(this.parametricNotesById.values())
      .filter((event) => event.when >= startPos && event.when < endPos)
      .sort((a, b) => a.when - b.when || a.id - b.id)
    for (const event of notes) {
      event.noteOn((event.when - startPos + startTime + this._lookAhead) / this.context.sampleRate)

      // XXX: Commiting to a note off this early is not the best or most accurate scheduling model
      // However it's important to commit somehow. Unpaired events are hard to debug and can lead to bad UX.
      event.noteOff(
        (event.when + event.duration - startPos + startTime + this._lookAhead) /
          this.context.sampleRate,
      )
    }

    for (const event of this.eventsById.values()) {
      if (event.when >= startPos && event.when < endPos) {
        const eventTime =
          (event.when - startPos + startTime + this._lookAhead) / this.context.sampleRate

        if (this.useSetTimeoutFallback) {
          this.scheduleTimeout(() => {
            if (!this.eventsById.has(event.id)) return
            event.callback()
          }, eventTime)
          continue
        }

        const timer = this.context.createConstantSource()
        timer.addEventListener(
          'ended',
          () => {
            if (!this.eventsById.has(event.id)) return
            event.callback()
          },
          { once: true },
        )
        timer.start(this.context.currentTime)
        timer.stop(eventTime)
      }
    }
  }

  stop() {
    this.active = false

    if (this.tickTimeout !== undefined) {
      clearTimeout(this.tickTimeout)
      this.tickTimeout = undefined
      this.dispatchEvent(new Event('ended'))
    }
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

  scheduleParametric(callback: (time: number) => void, when: number) {
    const id = this.nextEventId++
    this.parametricEventsById.set(id, { id, callback, when: round(when * this.context.sampleRate) })

    return id
  }

  scheduleParametricNote(note: Omit<ParametricNoteHandle, 'id'>) {
    const id = this.nextEventId++
    this.parametricNotesById.set(id, {
      ...note,
      id,
      when: round(note.when * this.context.sampleRate),
      duration: round(note.duration * this.context.sampleRate),
    })

    return id
  }

  scheduleEvent(callback: () => void, when: number) {
    const id = this.nextEventId++
    this.eventsById.set(id, { id, callback, when: round(when * this.context.sampleRate) })

    return id
  }
}
