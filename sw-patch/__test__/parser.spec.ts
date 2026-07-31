import { describe, it, expect } from 'vitest'
import { parse, type Node } from '../parser.generated.js'

function stripLocation<T extends Node>(node: T): Omit<T, 'location'> {
  const result: Partial<T> = { ...node }
  delete result.location
  return result as Omit<T, 'location'>
}

const DEFAULT_PATCH = `
config oscillatorType:
    'sine' | 'square' | 'sawtooth' | 'triangle' = 'triangle'

fn on(
    destination: AudioNode,
    start: Instant,
    pitch: AudioSignal<Pitch>,
    velocity: Level,
    attack: Duration = 100ms,
    decay: Duration = 200ms,
    sustain: Level = 70%,
    release: Duration = 300ms,
):
    osc = OscillatorNode(type = oscillatorType)
    attackEnv = GainNode(gain = 0)
    decayEnv = GainNode(gain = 1)

    until osc:ended:
        osc -> attackEnv -> decayEnv -> destination
        pitch -> osc.detune

    osc.start(start)

    @(start) attackEnv.gain = 0
    @(start + attack; linear) attackEnv.gain = velocity

    @(start + attack) decayEnv.gain = 1
    @(start + attack; target decay) decayEnv.gain = sustain

    ret once fn off(end: Instant):
        @(end; hold) attackEnv.gain
        @(end; hold) decayEnv.gain
        @(end; target release) decayEnv.gain = 0

        cutOff = end + 5 * release
        osc.stop(cutOff)

        ret cutOff
`

describe('SW Patch parser', () => {
  it('distinguishes until events from member access', () => {
    const ast = parse('until osc:ended:\n    osc -> destination\n')

    expect(ast.body[0]).toMatchObject({
      type: 'UntilStatement',
      emitter: { type: 'Identifier', name: 'osc' },
      event: 'ended',
    })
    expect(() => parse('until osc.ended:\n    osc -> destination\n')).toThrow('Expected')
  })

  it.each(['cancel', 'target'])('allows reserved word event name %s', (event) => {
    const ast = parse(`until emitter:${event}:\n    emitter -> destination\n`)

    expect(ast.body[0]).toMatchObject({
      type: 'UntilStatement',
      emitter: { type: 'Identifier', name: 'emitter' },
      event,
    })
  })

  it('distinguishes spaced percentage literals from modulo expressions', () => {
    const ast = parse('percentage = 70 %\nremainder = 70 % 8\n')

    expect(ast.body).toMatchObject([
      { value: { type: 'UnitLiteral', value: '70', unit: '%', spaced: true } },
      {
        value: {
          type: 'BinaryExpression',
          operator: '%',
          left: { type: 'NumberLiteral', value: '70' },
          right: { type: 'NumberLiteral', value: '8' },
        },
      },
    ])
  })

  it('parses semitone unit names', () => {
    const ast = parse('octave = 12semitones\nstep = 1 semitone\nshort = 2st\n')

    expect(ast.body).toMatchObject([
      { value: { type: 'UnitLiteral', value: '12', unit: 'semitones' } },
      { value: { type: 'UnitLiteral', value: '1', unit: 'semitone' } },
      { value: { type: 'UnitLiteral', value: '2', unit: 'st' } },
    ])
  })

  it('parses the default v3 patch', () => {
    const ast = parse(DEFAULT_PATCH)

    expect(ast.body.map(({ type }) => type)).toEqual([
      'ConfigDeclaration',
      'FunctionDeclaration'
    ])

    const on = ast.body[1]
    expect(on).toMatchObject({
      type: 'FunctionDeclaration',
      name: 'on',
      once: false,
      returned: false,
      parameters: [
        { name: 'destination', defaultValue: null },
        { name: 'start', defaultValue: null },
        { name: 'pitch', defaultValue: null },
        { name: 'velocity', defaultValue: null },
        { name: 'attack', defaultValue: { type: 'UnitLiteral', value: '100', unit: 'ms' } },
        { name: 'decay', defaultValue: { type: 'UnitLiteral', value: '200', unit: 'ms' } },
        { name: 'sustain', defaultValue: { type: 'UnitLiteral', value: '70', unit: '%' } },
        { name: 'release', defaultValue: { type: 'UnitLiteral', value: '300', unit: 'ms' } }
      ]
    })

    if (on?.type !== 'FunctionDeclaration') throw new Error('Expected function declaration')
    expect(on.body.find(({ type }) => type === 'UntilStatement')).toMatchObject({
      emitter: { type: 'Identifier', name: 'osc' },
      event: 'ended',
    })
    expect(on.body.at(-1)).toMatchObject({
      type: 'FunctionDeclaration',
      name: 'off',
      once: true,
      returned: true
    })
  })

  it('parses indents Python style', () => {
    const source = `# First line
"top level string"
if true:
    "second level string"
"back to top level"
`
    const ast = parse(source)

    expect(ast.type).toBe('Program')
    expect(ast.body).toHaveLength(4)

    // Comments are statements for syntax-highlighting purposes
    const [comment, topLevelExpression, conditional, finalExpression] = ast.body

    expect(comment).toMatchObject({
      type: 'CommentStatement',
      value: ' First line'
    })
    expect(comment?.location).toEqual({
      source: undefined,
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 12, line: 1, column: 13 }
    })

    expect(topLevelExpression?.type).toBe('ExpressionStatement')
    if (topLevelExpression?.type !== 'ExpressionStatement') {
      throw new Error('Expected expression')
    }
    expect(stripLocation(topLevelExpression.expression)).toEqual({
      type: 'StringLiteral',
      value: 'top level string'
    })

    expect(conditional?.type).toBe('IfStatement')
    if (conditional?.type !== 'IfStatement') throw new Error('Expected if statement')
    expect(conditional.body).toHaveLength(1)
    const nestedExpression = conditional.body[0]
    expect(nestedExpression?.type).toBe('ExpressionStatement')
    if (nestedExpression?.type !== 'ExpressionStatement') {
      throw new Error('Expected expression')
    }
    expect(stripLocation(nestedExpression.expression)).toEqual({
      type: 'StringLiteral',
      value: 'second level string'
    })

    expect(finalExpression?.type).toBe('ExpressionStatement')
    if (finalExpression?.type !== 'ExpressionStatement') {
      throw new Error('Expected expression')
    }
    expect(stripLocation(finalExpression.expression)).toEqual({
      type: 'StringLiteral',
      value: 'back to top level'
    })
  })

  it('parses connections with explicit output and input ports', () => {
    const ast = parse('source:2 -> destination:3\n')

    expect(ast.body[0]).toMatchObject({
      type: 'ConnectionStatement',
      links: [{ operator: 'connect', output: 2, input: 3 }],
    })
  })

  it('parses Python-style for and while loops', () => {
    const ast = parse(
      'for item in [1, 2]:\n'
      + '    while item > 0:\n'
      + '        if item == 2:\n'
      + '            continue\n'
      + '        break\n'
      + 'if true:\n'
      + '    pass\n',
    )

    expect(ast.body[0]).toMatchObject({
      type: 'ForStatement',
      target: 'item',
      iterable: { type: 'ListLiteral' },
      body: [{
        type: 'WhileStatement',
        test: { type: 'BinaryExpression', operator: '>' },
        body: [
          { type: 'IfStatement', body: [{ type: 'ContinueStatement' }] },
          { type: 'BreakStatement' },
        ],
      }],
    })
    expect(ast.body[1]).toMatchObject({
      type: 'IfStatement',
      body: [{ type: 'PassStatement' }],
    })
  })
})
