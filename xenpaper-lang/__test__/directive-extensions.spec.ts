import { describe, expect, it } from 'vitest'
import { parse } from '../parser.generated.js'
import { expandToBeatEvents } from '../runtime/beat-events'
import { evaluateExpression } from '../runtime/expressions'
import { evaluateScoreShape } from '../runtime/score-shape'
import type { BeatTimedNoteEvent, DirectiveExtension, PitchContext } from '../runtime/types'
import { DEFAULT_PITCH_CONTEXT } from '../runtime/pitches'
import type { Value } from '../value'

interface MockPatch {
  readonly name: string
  readonly parameters: Readonly<Record<string, Value>>
}

// A mock audio engine owns patch geometry. Xenpaper only carries its immutable state.
const patchExtension: DirectiveExtension = {
  name: 'patch',
  initialState: { name: 'plain', parameters: {} } satisfies MockPatch,
  apply(directive, context: PitchContext, previousState) {
    const previous = previousState as MockPatch
    let name = previous.name
    const parameters = { ...previous.parameters }
    const diagnostics = []
    for (const argument of directive.arguments) {
      if (argument.type !== 'NamedArgument') throw new Error('@patch accepts named arguments.')
      if (argument.name === 'name') {
        if (argument.value.type !== 'Identifier')
          throw new Error('Patch name must be an identifier.')
        name = argument.value.name
        continue
      }
      const evaluated = evaluateExpression(argument.value, context)
      diagnostics.push(...evaluated.diagnostics)
      if (!('value' in evaluated) || evaluated.value.kind !== 'scalar')
        throw new Error(`Patch parameter ${argument.name} must be scalar.`)
      // Parameters deliberately have no universal name or dimension restriction.
      parameters[argument.name] = evaluated.value.value
    }
    return { state: { name, parameters } satisfies MockPatch, diagnostics }
  },
}

const notes = (source: string) => {
  const result = expandToBeatEvents(parse(source), { directiveExtensions: [patchExtension] })
  expect(result.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([])
  if (!('score' in result)) throw new Error('Expected score.')
  return result.score.events.filter((event): event is BeatTimedNoteEvent => event.kind === 'note')
}
const patch = (event: BeatTimedNoteEvent) => event.directiveState.patch as MockPatch

const shapeNotes = (source: string, extensions: readonly DirectiveExtension[]) => {
  const result = evaluateScoreShape(parse(source).body[0]!, { directiveExtensions: extensions })
  expect(result.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([])
  if (!('shape' in result)) throw new Error('Expected shape.')
  const visit = (shape: typeof result.shape): (typeof result.shape & { kind: 'attack' })[] =>
    shape.kind === 'attack'
      ? [shape]
      : shape.kind === 'sequence'
        ? shape.children.flatMap(visit)
        : shape.kind === 'parallel'
          ? shape.branches.flatMap(visit)
          : []
  return visit(result.shape)
}

describe('second-party directive extensions', () => {
  it('lets an audio engine define unrelated and sustainless patch geometries', () => {
    const events = notes('C @patch(name: kick, decay: 80ms, pitchDrop: 2) D @patch(click: 25%) E')
    expect(events.map((event) => patch(event).name)).toEqual(['plain', 'kick', 'kick'])
    expect(Object.keys(patch(events[0]!).parameters)).toEqual([])
    expect(patch(events[1]!).parameters.decay!.dimensions.equals({ seconds: 1 })).toBe(true)
    expect(patch(events[1]!).parameters.pitchDrop!.valueOf()).toBe(2)
    expect(patch(events[2]!).parameters.click!.valueOf()).toBe(0.25)
    expect(patch(events[1]!)).not.toBe(patch(events[2]!))
  })

  it('uses core repeat expansion and lexical isolation without leaking engine state', () => {
    const repeated = notes('|: @patch(name: snare, noise: 40%) C :| D')
    expect(repeated.map((event) => patch(event).name)).toEqual(['snare', 'snare', 'snare'])

    const scoped = notes('C (@patch(name: tom, bend: 3/2) D) E, @patch(name: hat) F')
    expect(scoped.map((event) => patch(event).name).sort()).toEqual([
      'hat',
      'plain',
      'plain',
      'tom',
    ])
  })

  it('threads pitch context while accumulating state across authored repeats', () => {
    const memo: DirectiveExtension = {
      name: 'memo',
      initialState: [] as number[],
      apply(_directive, context, previous) {
        return {
          state: [...(previous as number[]), context.rootDisplacement.valueOf()],
        }
      },
    }
    const events = shapeNotes('|: @memo C {root = D} :| E', [memo])
    const memories = events.at(-1)!.directiveState.memo as number[]
    expect(memories).toHaveLength(2)
    expect(memories[0]).not.toBe(memories[1])
  })

  it('propagates extensions through postfix-wrapped repeats and into drones', () => {
    const wrapped = shapeNotes('|: @patch(name: tom) C :|= D', [patchExtension])
    expect((wrapped.at(-1)!.directiveState.patch as MockPatch).name).toBe('tom')

    const droned = notes('@patch(name: kick) @drone(C) D @drone()')
    expect(droned.map((event) => patch(event).name)).toEqual(['kick', 'kick'])
  })

  it('turns extension failures into source-located diagnostics', () => {
    const result = expandToBeatEvents(parse('@patch(name: 1) C'), {
      pitchContext: DEFAULT_PITCH_CONTEXT,
      directiveExtensions: [patchExtension],
    })
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'XP_DIRECTIVE_EXTENSION',
        severity: 'error',
        locations: [expect.objectContaining({ start: expect.any(Object) })],
      }),
    )
  })
})
