/** In-memory undo history. Call begin() at user gesture boundaries, not on every pointer move. */
export class EditorHistory {
  private past: string[] = []
  private future: string[] = []
  private merging = false

  constructor(
    private current: string,
    private readonly limit = 100,
  ) {}

  get canUndo() {
    return this.past.length > 0
  }

  get canRedo() {
    return this.future.length > 0
  }

  begin() {
    this.merging = false
  }

  record(snapshot: string) {
    if (snapshot === this.current) return
    if (!this.merging) {
      this.past.push(this.current)
      if (this.past.length > this.limit) this.past.shift()
    }
    this.current = snapshot
    this.future = []
    this.merging = true
  }

  undo() {
    const snapshot = this.past.pop()
    if (snapshot === undefined) return
    this.future.push(this.current)
    this.current = snapshot
    this.begin()
    return snapshot
  }

  redo() {
    const snapshot = this.future.pop()
    if (snapshot === undefined) return
    this.past.push(this.current)
    this.current = snapshot
    this.begin()
    return snapshot
  }

  reset(snapshot: string) {
    this.past = []
    this.future = []
    this.current = snapshot
    this.begin()
  }
}
