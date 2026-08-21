import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from '../parser.generated.js'
import { expandToBeatEvents } from '../runtime/beat-events'

describe('Xenpaper tutorial', () => {
  it('contains executable score examples', () => {
    const markdown = readFileSync(`${process.cwd()}/xenpaper3-tutorial.md`, 'utf8')
    const blocks = markdown.matchAll(/```(?:\w+)?\n([\s\S]*?)```/g)

    for (const match of blocks) {
      const line = markdown.slice(0, match.index).split('\n').length + 1
      const program = parse(match[1]!)
      const result = expandToBeatEvents(program)

      expect(result, `Tutorial score at line ${line} has runtime diagnostics`).toHaveProperty(
        'score',
      )
    }
  })
})
