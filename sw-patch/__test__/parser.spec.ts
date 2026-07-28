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
    pitch: AudioSignal<Cents>,
    velocity: Level,
    attack: Duration = 100ms,
    decay: Duration = 200ms,
    sustain: Level = 70%,
    release: Duration = 300ms,
):
    osc = OscillatorNode(type = oscillatorType)
    attackEnv = GainNode(gain = 0)
    decayEnv = GainNode(gain = 1)

    until osc.ended:
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
    expect(on.body.some(({ type }) => type === 'UntilStatement')).toBe(true)
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
    const ast = parse('source -> destination:2,3\n')

    expect(ast.body[0]).toMatchObject({
      type: 'ConnectionStatement',
      links: [{ operator: 'connect', output: 2, input: 3 }],
    })
  })
})
