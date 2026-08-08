import { Fraction, type FractionValue } from 'xen-dev-utils/fraction'
import type { Expression } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import { evaluateExpression } from './expressions'
import { DEFAULT_PITCH_CONTEXT, applyPitchContextChange, mapFormula } from './pitches'
import type {
  AttackShape,
  AttackAppearance,
  AnnotationShape,
  AbsolutePitchValue,
  BarlineShape,
  BarlineStyle,
  ContinueShape,
  ParallelShape,
  PitchOffsetValue,
  RestShape,
  ScoreShape,
  SequenceShape,
  SourceOrigin,
  PitchContext,
} from './types'

export interface ScoreShapeOptions {
  readonly pulse?: FractionValue
  readonly pitchContext?: PitchContext
}

export type ScoreShapeEvaluationResult =
  | { readonly shape: ScoreShape; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] }

function hasShape(
  result: ScoreShapeEvaluationResult,
): result is { readonly shape: ScoreShape; readonly diagnostics: readonly Diagnostic[] } {
  return 'shape' in result
}

function origin(node: Expression, role: SourceOrigin['role'] = 'structural'): SourceOrigin {
  return { location: node.location, role }
}

function sequence(children: readonly ScoreShape[], origins: readonly SourceOrigin[]): SequenceShape {
  return {
    kind: 'sequence',
    children,
    duration: children.reduce((duration, child) => duration.add(child.duration), new Fraction(0)),
    origins,
  }
}

function generatedRest(duration: Fraction): RestShape {
  return { kind: 'rest', duration, generated: true, origins: [] }
}

function barline(node: Expression, style: BarlineStyle): BarlineShape {
  return { kind: 'barline', style, duration: new Fraction(0), origins: [origin(node)] }
}

function pad(shape: ScoreShape, duration: Fraction): ScoreShape {
  const missing = duration.sub(shape.duration)
  if (!missing.n) return shape
  return sequence([shape, generatedRest(missing)], shape.origins)
}

function scaleShape(shape: ScoreShape, factor: Fraction): ScoreShape {
  const duration = shape.duration.mul(factor)
  switch (shape.kind) {
    case 'attack':
    case 'rest':
    case 'continue':
    case 'barline':
    case 'annotation':
      return { ...shape, duration }
    case 'sequence':
      return { ...shape, duration, children: shape.children.map((child) => scaleShape(child, factor)) }
    case 'parallel':
      return { ...shape, duration, branches: shape.branches.map((branch) => scaleShape(branch, factor)) }
  }
}

function annotateRepeatAppearances(shape: ScoreShape, alternatives: readonly (readonly AttackAppearance[])[]): ScoreShape {
  let attackIndex = 0
  const annotate = (current: ScoreShape): ScoreShape => {
    if (current.kind === 'attack') {
      const alternateAppearances = alternatives[attackIndex++]
      return alternateAppearances?.length ? { ...current, alternateAppearances } : current
    }
    if (current.kind === 'sequence') return { ...current, children: current.children.map(annotate) }
    if (current.kind === 'parallel') return { ...current, branches: current.branches.map(annotate) }
    return current
  }
  return annotate(shape)
}

function attacks(shape: ScoreShape): AttackShape[] {
  if (shape.kind === 'attack') return [shape]
  if (shape.kind === 'sequence') return shape.children.flatMap(attacks)
  if (shape.kind === 'parallel') return shape.branches.flatMap(attacks)
  return []
}

function contextAnnotation(node: Extract<Expression, { type: 'PitchContextChange' }>): AnnotationShape {
  const text = node.statements.map((statement) => {
    if (statement.type !== 'ContextAssignment') return statement.type === 'ContextPreset' ? statement.raw : 'context'
    const target = statement.target.type === 'ContextNameTarget'
      ? statement.target.name
      : statement.target.type === 'ContextPitchTarget'
        ? statement.target.pitch.raw
        : statement.target.operator
    const value = 'raw' in statement.value
      ? String(statement.value.raw)
      : statement.value.type === 'Identifier'
        ? statement.value.name
        : statement.value.type
    return `${target} = ${value}`
  }).join('; ')
  return { kind: 'annotation', text, duration: new Fraction(0), origins: [origin(node, 'context')] }
}

function playablePitch(node: Expression, context: PitchContext):
  | { readonly pitch: PitchOffsetValue | (AbsolutePitchValue & { readonly value: Value }); readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] } {
  const evaluated = evaluateExpression(node, context)
  if (!('value' in evaluated)) return evaluated
  if (evaluated.value.kind === 'pitchOffset') {
    return { pitch: evaluated.value, diagnostics: evaluated.diagnostics }
  }
  if (evaluated.value.kind === 'absolutePitch') {
    const absoluteRootOffset = evaluated.value.rootOffset.add(mapFormula(context.rootFormula, context.mapping))
    return {
      pitch: { ...evaluated.value, rootOffset: absoluteRootOffset, value: evaluated.value.rootOffset },
      diagnostics: evaluated.diagnostics,
    }
  }
  const ratio = evaluated.value.value.exactRational()
  if (!ratio || ratio.compare(0) <= 0) {
    return {
      diagnostics: [
        ...evaluated.diagnostics,
        {
          code: 'XP_TYPE_MISMATCH',
          severity: 'error',
          message: 'A score atom must be a pitch offset or positive exact ratio.',
          locations: [node.location],
        },
      ],
    }
  }
  return {
    pitch: { kind: 'pitchOffset', value: Value.pitch(evaluated.value.value), origins: evaluated.value.origins },
    diagnostics: evaluated.diagnostics,
  }
}

/** Build the exact-duration score-shape tree for sequencing, parallelism, and slots. */
export function evaluateScoreShape(
  node: Expression,
  options: ScoreShapeOptions = {},
): ScoreShapeEvaluationResult {
  const pulse = new Fraction(options.pulse ?? 1)
  if (pulse.compare(0) <= 0) throw new RangeError('pulse must be positive.')

  const contextAfter = (current: Expression, context: PitchContext): PitchContext => {
    if (current.type === 'PitchContextChange') {
      try {
        return applyPitchContextChange(current, context)
      } catch {
        return context
      }
    }
    if (current.type === 'Sequence') {
      return current.items.reduce((active, item) => contextAfter(item, active), context)
    }
    if (current.type === 'Group') return contextAfter(current.expression, context)
    if (current.type === 'NormalizeToSlot' && current.expression) return contextAfter(current.expression, context)
    if (current.type === 'PostfixExpression') return contextAfter(current.expression, context)
    if (current.type === 'Repeat') {
      let active = context
      const count = Number(current.count.value)
      for (let iteration = 0; iteration < count; iteration++) {
        active = current.body.reduce((bodyContext, item) => contextAfter(item, bodyContext), active)
      }
      return active
    }
    return context
  }

  const visit = (current: Expression, context: PitchContext): ScoreShapeEvaluationResult => {
    if (current.type === 'Rest') {
      return {
        shape: { kind: 'rest', duration: pulse, generated: false, origins: [origin(current)] },
        diagnostics: [],
      }
    }
    if (current.type === 'DetachedContinue') {
      const shape: ContinueShape = {
        kind: 'continue',
        duration: pulse,
        origins: [origin(current, 'duration')],
      }
      return { shape, diagnostics: [] }
    }
    if (current.type === 'Barline') {
      return { shape: barline(current, 'single'), diagnostics: [] }
    }
    if (current.type === 'HardBoundary') {
      return { shape: barline(current, 'double'), diagnostics: [] }
    }
    if (current.type === 'Repeat') {
      const count = Number(current.count.value)
      let activeContext = context
      let displayedShapes: ScoreShape[] | undefined
      let displayedAttacks: AttackShape[] = []
      const alternatives: AttackAppearance[][] = []
      const diagnostics: Diagnostic[] = []
      // Evaluate the written body once even for x0 so it remains engravable between the markers.
      const iterations = Math.max(1, count)
      for (let iteration = 0; iteration < iterations; iteration++) {
        let iterationContext = activeContext
        const results: ScoreShapeEvaluationResult[] = []
        for (const item of current.body) {
          results.push(visit(item, iterationContext))
          iterationContext = contextAfter(item, iterationContext)
        }
        diagnostics.push(...results.flatMap((result) => result.diagnostics))
        if (!results.every(hasShape)) return { diagnostics }
        const iterationShapes = results.map((result) => result.shape)
        if (!displayedShapes) {
          displayedShapes = iterationShapes
          displayedAttacks = iterationShapes.flatMap(attacks)
          for (const _attack of displayedAttacks) alternatives.push([])
        } else {
          const iterationAttacks = iterationShapes.flatMap(attacks)
          for (let index = 0; index < Math.min(displayedAttacks.length, iterationAttacks.length); index++) {
            const attack = iterationAttacks[index]!
            alternatives[index]!.push({
              pitch: attack.pitch,
              rootStaffPosition: attack.rootStaffPosition,
            })
          }
        }
        if (iteration < count) activeContext = iterationContext
      }
      const displayed = annotateRepeatAppearances(
        sequence(displayedShapes ?? [], [origin(current)]),
        alternatives,
      ) as SequenceShape
      return {
        shape: sequence(
          [
            barline(current, 'repeat-start'),
            ...displayed.children,
            barline(current, 'repeat-end'),
          ],
          [origin(current)],
        ),
        diagnostics,
      }
    }
    if (current.type === 'Sequence') {
      let activeContext = context
      const results: ScoreShapeEvaluationResult[] = []
      for (const item of current.items) {
        if (item.type === 'PitchContextChange') {
          try {
            activeContext = applyPitchContextChange(item, activeContext)
            results.push({ shape: contextAnnotation(item), diagnostics: [] })
          } catch (error) {
            results.push({ diagnostics: [{ code: 'XP_CONTEXT', severity: 'error', message: error instanceof Error ? error.message : 'Invalid pitch context.', locations: [item.location] }] })
          }
        } else {
          results.push(visit(item, activeContext))
          activeContext = contextAfter(item, activeContext)
        }
      }
      const diagnostics = results.flatMap((result) => result.diagnostics)
      if (!results.every(hasShape)) return { diagnostics }
      return {
        shape: sequence(results.map((result) => result.shape), [origin(current)]),
        diagnostics,
      }
    }
    if (current.type === 'Parallel') {
      const results = current.branches.map((branch) => visit(branch, context))
      const diagnostics = results.flatMap((result) => result.diagnostics)
      if (!results.every(hasShape)) return { diagnostics }
      const branches = results.map((result) => result.shape)
      const duration = branches.reduce(
        (maximum, branch) => (branch.duration.compare(maximum) > 0 ? branch.duration : maximum),
        new Fraction(0),
      )
      const shape: ParallelShape = {
        kind: 'parallel',
        duration,
        branches: branches.map((branch) => pad(branch, duration)),
        origins: [origin(current)],
      }
      return { shape, diagnostics }
    }
    if (current.type === 'Group') return visit(current.expression, context)
    if (current.type === 'NormalizeToSlot') {
      if (!current.expression) {
        return {
          shape: { kind: 'rest', duration: pulse, generated: false, origins: [origin(current)] },
          diagnostics: [],
        }
      }
      const evaluated = visit(current.expression, context)
      if (!('shape' in evaluated)) return evaluated
      if (!evaluated.shape.duration.n) {
        return {
          diagnostics: [
            ...evaluated.diagnostics,
            {
              code: 'XP_NORMALIZE_ZERO',
              severity: 'error',
              message: 'A non-empty zero-duration fragment cannot be normalized.',
              locations: [current.location],
            },
          ],
        }
      }
      return {
        shape: scaleShape(evaluated.shape, pulse.div(evaluated.shape.duration)),
        diagnostics: evaluated.diagnostics,
      }
    }
    if (current.type === 'PostfixExpression') {
      const evaluated = visit(current.expression, context)
      if (!('shape' in evaluated)) return evaluated
      const continuations = current.marks.filter((mark) => mark.type === 'DetachedContinue')
      if (!continuations.length) return evaluated
      return {
        shape: sequence(
          [
            evaluated.shape,
            ...continuations.map<ContinueShape>((mark) => ({
              kind: 'continue',
              duration: pulse,
              origins: [origin(mark, 'duration')],
            })),
          ],
          [origin(current)],
        ),
        diagnostics: evaluated.diagnostics,
      }
    }

    if (current.type === 'PitchContextChange') {
      return { shape: contextAnnotation(current), diagnostics: [] }
    }
    const evaluated = playablePitch(current, context)
    if (!('pitch' in evaluated)) return evaluated
    const shape: AttackShape = {
      kind: 'attack',
      pitch: evaluated.pitch,
      duration: pulse,
      origins: evaluated.pitch.origins,
      rootStaffPosition: context.rootStaffPosition,
      ...('raw' in current ? { soundingLabel: String(current.raw) } : {}),
    }
    return { shape, diagnostics: evaluated.diagnostics }
  }

  return visit(node, options.pitchContext ?? DEFAULT_PITCH_CONTEXT)
}
