import { Fraction } from 'xen-dev-utils/fraction'
import type { Directive, Expression } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { evaluateExpression } from './expressions'
import type { DynamicMark, LexicalEnvironment, PitchContext, StaffClef } from './types'

export const DYNAMIC_VELOCITIES: Readonly<Record<DynamicMark, Fraction>> = {
  ppp: new Fraction(1, 10),
  pp: new Fraction(1, 5),
  p: new Fraction(3, 10),
  mp: new Fraction(2, 5),
  mf: new Fraction(1, 2),
  f: new Fraction(13, 20),
  ff: new Fraction(41, 50),
  fff: new Fraction(1),
}

export const GLISS_CURVES: ReadonlyArray<string> = Object.freeze([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
])

export const DIRECTIVE_REGISTRY = Object.freeze({
  subdivision: 'subdivision',
  velocity: 'velocity',
  gliss: 'gliss',
  groove: 'groove',
  drone: 'drone',
  clef: 'clef',
  art: 'articulation',
  'articulation-shorthand': 'articulation',
  staccatissimo: 'articulation',
  staccato: 'articulation',
  portato: 'articulation',
  tenuto: 'articulation',
  legato: 'articulation',
  ppp: 'dynamic',
  pp: 'dynamic',
  p: 'dynamic',
  mp: 'dynamic',
  mf: 'dynamic',
  f: 'dynamic',
  ff: 'dynamic',
  fff: 'dynamic',
} as const)

export type ResolvedDirective =
  | { kind: 'subdivision'; pulse: Fraction }
  | { kind: 'grace'; duration: Fraction; count: number }
  | { kind: 'dynamic'; mark: DynamicMark; velocity: Fraction }
  | { kind: 'velocity'; velocity: Fraction }
  | { kind: 'gliss'; curve: string }
  | { kind: 'groove'; argument?: Expression }
  | { kind: 'drone'; argument?: Expression }
  | { kind: 'articulation'; ratio: Fraction; mark?: string; shorthand: boolean }
  | { kind: 'clef'; clef: Extract<StaffClef, { kind: 'treble' | 'bass' }> }
  | { kind: 'unknown' }

export function resolveDirective(
  node: Directive,
  context: PitchContext,
  environment?: LexicalEnvironment,
): { directive?: ResolvedDirective; diagnostics: Diagnostic[] } {
  const fail = (message: string) => ({
    diagnostics: [
      { code: 'XP_DIRECTIVE', severity: 'error' as const, message, locations: [node.location] },
    ],
  })
  const registered = DIRECTIVE_REGISTRY[node.name as keyof typeof DIRECTIVE_REGISTRY]
  if (!registered)
    return {
      directive: { kind: 'unknown' },
      diagnostics: [
        {
          code: 'XP_UNKNOWN_DIRECTIVE',
          severity: 'warning',
          message: `Unknown directive @${node.name}.`,
          locations: [node.location],
        },
      ],
    }
  if (registered === 'dynamic') {
    if (node.arguments.length) return fail(`@${node.name} does not accept arguments.`)
    const mark = node.name as DynamicMark
    return {
      directive: { kind: 'dynamic', mark, velocity: DYNAMIC_VELOCITIES[mark] },
      diagnostics: [],
    }
  }
  if (registered === 'clef') {
    const argument = node.arguments[0]
    if (node.arguments.length !== 1 || argument?.type !== 'Identifier')
      return fail('@clef requires exactly one clef name: treble or bass.')
    const kind = argument.name.toLowerCase()
    if (kind !== 'treble' && kind !== 'bass')
      return fail(`Unsupported clef ${argument.name}. Expected treble or bass.`)
    return { directive: { kind: 'clef', clef: { kind } }, diagnostics: [] }
  }
  if (registered === 'groove') {
    if (node.arguments.length > 1 || node.arguments[0]?.type === 'NamedArgument')
      return fail('@groove accepts one score argument, or no argument to turn it off.')
    return {
      directive: { kind: 'groove', argument: node.arguments[0] as Expression | undefined },
      diagnostics: [],
    }
  }
  if (registered === 'drone') {
    if (node.arguments.length > 1 || node.arguments[0]?.type === 'NamedArgument')
      return fail('@drone accepts one score argument, or no argument to turn it off.')
    return {
      directive: { kind: 'drone', argument: node.arguments[0] as Expression | undefined },
      diagnostics: [],
    }
  }
  if (registered === 'articulation') {
    const shorthand = (node as Directive & { articulationMark?: string }).articulationMark
    const ratios: Record<string, Fraction> = {
      "'": new Fraction(1, 4),
      '.': new Fraction(1, 2),
      ':': new Fraction(17, 20),
      '-': new Fraction(1),
      _: new Fraction(11, 10),
      staccatissimo: new Fraction(1, 4),
      staccato: new Fraction(1, 2),
      portato: new Fraction(17, 20),
      tenuto: new Fraction(1),
      legato: new Fraction(11, 10),
    }
    if (shorthand) {
      if (node.arguments.length) return fail(`@${shorthand} does not accept arguments.`)
      return {
        directive: {
          kind: 'articulation',
          ratio: ratios[shorthand]!,
          mark: shorthand,
          shorthand: true,
        },
        diagnostics: [],
      }
    }
    if (node.name !== 'art') {
      if (node.arguments.length) return fail(`@${node.name} does not accept arguments.`)
      return {
        directive: { kind: 'articulation', ratio: ratios[node.name]!, shorthand: false },
        diagnostics: [],
      }
    }
    if (node.arguments.length !== 1 || node.arguments[0]?.type === 'NamedArgument')
      return fail('@art requires one non-negative dimensionless exact rational argument.')
    const evaluated = evaluateExpression(node.arguments[0] as Expression, context, environment)
    if (
      !('value' in evaluated) ||
      evaluated.value.kind !== 'scalar' ||
      !evaluated.value.value.dimensions.isDimensionless
    )
      return fail('@art requires one non-negative dimensionless exact rational argument.')
    const exact = evaluated.value.value.exactRational()
    if (!exact || exact.compare(0) < 0)
      return fail('@art requires one non-negative dimensionless exact rational argument.')
    return {
      directive: { kind: 'articulation', ratio: new Fraction(exact), shorthand: false },
      diagnostics: [...evaluated.diagnostics],
    }
  }
  if (registered === 'gliss') {
    if (node.arguments.length > 1) return fail('@gliss accepts at most one curve argument.')
    const argument = node.arguments[0]
    const curve =
      argument?.type === 'Identifier'
        ? argument.name
        : argument === undefined
          ? 'linear'
          : undefined
    if (!curve || !GLISS_CURVES.includes(curve))
      return fail(`The glissando curve must be one of: ${GLISS_CURVES.join(', ')}.`)
    return { directive: { kind: 'gliss', curve }, diagnostics: [] }
  }
  if (registered === 'velocity') {
    if (node.arguments.length !== 1 || node.arguments[0]?.type === 'NamedArgument')
      return fail('@velocity requires one dimensionless scalar argument.')
    const evaluated = evaluateExpression(node.arguments[0] as Expression, context, environment)
    if (
      !('value' in evaluated) ||
      evaluated.value.kind !== 'scalar' ||
      !evaluated.value.value.dimensions.isDimensionless
    )
      return fail('@velocity requires one dimensionless scalar argument.')
    const exact = evaluated.value.value.exactRational()
    if (!exact || exact.compare(0) < 0) return fail('@velocity must be non-negative and exact.')
    return {
      directive: { kind: 'velocity', velocity: new Fraction(exact) },
      diagnostics: [...evaluated.diagnostics],
    }
  }
  if (node.arguments.length !== 1 || node.arguments[0]?.type === 'NamedArgument')
    return fail('Subdivision requires one positive dimensionless exact rational.')
  const evaluated = evaluateExpression(node.arguments[0] as Expression, context, environment)
  if (
    !('value' in evaluated) ||
    evaluated.value.kind !== 'scalar' ||
    !evaluated.value.value.dimensions.isDimensionless
  )
    return fail('Subdivision requires one positive dimensionless exact rational.')
  const exact = evaluated.value.value.exactRational()
  if (!exact || exact.compare(0) <= 0)
    return fail('Subdivision requires one positive dimensionless exact rational.')
  const duration = new Fraction(1).div(new Fraction(exact))
  return {
    directive: node.graceCount
      ? { kind: 'grace', duration, count: node.graceCount }
      : { kind: 'subdivision', pulse: duration },
    diagnostics: [...evaluated.diagnostics],
  }
}
