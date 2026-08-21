import { describe, expect, it } from 'vitest'
import { tutorialChapters } from '../../src/tutorial'
import { parse } from '../parser.generated.js'
import { expandToBeatEvents } from '../runtime/beat-events'

describe('Xenpaper tutorial', () => {
  it('contains executable score examples', () => {
    for (const chapter of tutorialChapters) {
      for (const section of chapter.sections) {
        for (const demo of section.demos) {
          if (!demo.tune) continue
          const program = parse(demo.tune)
          const result = expandToBeatEvents(program)

          expect(
            result,
            `${chapter.title} / ${section.title} contains a tune with runtime diagnostics`,
          ).toHaveProperty('score')
        }
      }
    }
  })
})
