import { describe, expect, it } from 'vitest'
import { EditorHistory } from '../daw/editor-history'

describe('EditorHistory', () => {
  it('does not record navigation or other unchanged snapshots', () => {
    const history = new EditorHistory('initial')
    history.begin()
    history.record('initial')
    expect(history.canUndo).toBe(false)
    expect(history.undo()).toBeUndefined()
    expect(history.redo()).toBeUndefined()
  })

  it('coalesces a drag or typing gesture into one undo step', () => {
    const history = new EditorHistory('before drag')
    history.begin()
    history.record('first move')
    history.record('second move')
    history.record('final move')
    expect(history.undo()).toBe('before drag')
    expect(history.canUndo).toBe(false)
    expect(history.redo()).toBe('final move')
  })

  it('keeps separate user gestures separate', () => {
    const history = new EditorHistory('empty')
    history.begin()
    history.record('clip')
    history.begin()
    history.record('clip and duplicate')
    expect(history.undo()).toBe('clip')
    expect(history.undo()).toBe('empty')
    expect(history.redo()).toBe('clip')
    expect(history.redo()).toBe('clip and duplicate')
    expect(history.canRedo).toBe(false)
  })

  it('preserves redo on no-ops, but clears it when a new edit branches history', () => {
    const history = new EditorHistory('a')
    history.record('b')
    history.undo()
    history.begin()
    history.record('a')
    expect(history.canRedo).toBe(true)
    history.record('c')
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toBe('a')
    expect(history.redo()).toBe('c')
  })

  it('bounds the number of retained undo gestures', () => {
    const history = new EditorHistory('0', 2)
    for (const snapshot of ['1', '2', '3']) {
      history.begin()
      history.record(snapshot)
    }
    expect(history.undo()).toBe('2')
    expect(history.undo()).toBe('1')
    expect(history.undo()).toBeUndefined()
    expect(history.redo()).toBe('2')
    expect(history.redo()).toBe('3')
  })

  it('starts a clean history when importing another project', () => {
    const history = new EditorHistory('old')
    history.record('edited')
    history.undo()
    history.reset('imported')
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    history.record('new edit')
    expect(history.undo()).toBe('imported')
  })
})
