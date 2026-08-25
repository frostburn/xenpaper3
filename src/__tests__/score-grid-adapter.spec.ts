import { describe, expect, it } from 'vitest'
import { compile } from '../../xenpaper-lang/core'
import { beat } from '../daw/project'
import { parseClipNotes, sourceClipLength } from '../daw/score'
import { monomialToCents } from '../music/pitch-projection'

describe('DAW exact-grid adapter', () => {
  it('projects the exact Xenpaper pitch only at the DAW boundary', () => {
    const compiled = compile('{31edo} E')
    expect('grid' in compiled).toBe(true)
    if (!('grid' in compiled)) return
    const exact = compiled.grid.events.find((event) => event.kind === 'note')
    expect(exact?.kind).toBe('note')
    if (!exact || exact.kind !== 'note') return

    expect(parseClipNotes('{31edo} E')[0]?.cents).toBeCloseTo(monomialToCents(exact.pitch.sounding))
  })

  it('turns incomplete editor syntax into a stable fallback clip span', () => {
    expect(sourceClipLength('(')).toEqual(beat(4))
  })
})
