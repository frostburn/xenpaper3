import { Fraction, type FractionValue } from 'xen-dev-utils/fraction'
import type { Expression } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import { evaluateExpression } from './expressions'
import { DYNAMIC_VELOCITIES, resolveDirective } from './directives'
import { DEFAULT_PITCH_CONTEXT, applyPitchContextChange, mapFormula } from './pitches'
import type {
  AttackShape,
  AttackAppearance,
  AnnotationShape,
  AbsolutePitchValue,
  BarlineShape,
  BarlineStyle,
  ContinueShape,
  EvaluatedLiteral,
  ParallelShape,
  PitchOffsetValue,
  RestShape,
  ScoreShape,
  SequenceShape,
  SourceOrigin,
  PitchContext,
  DynamicMark,
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
      if (!alternateAppearances?.length) return current
      const notationValue = (pitch: AttackShape['pitch']) => pitch.kind === 'absolutePitch'
        ? pitch.rootOffset
        : pitch.notationValue ?? pitch.value
      const ambiguous = alternateAppearances.some((appearance) =>
        appearance.rootStaffPosition !== current.rootStaffPosition ||
        !notationValue(appearance.pitch).equals(notationValue(current.pitch)))
      return {
        ...current,
        alternateAppearances,
        ...(ambiguous && !current.displayLabel ? { displayLabel: authoredLabels.get(current) } : {}),
      }
    }
    if (current.kind === 'sequence') return { ...current, children: current.children.map(annotate) }
    if (current.kind === 'parallel') return { ...current, branches: current.branches.map(annotate) }
    return current
  }
  return annotate(shape)
}

const authoredLabels = new WeakMap<AttackShape, string>()

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
    return {
      pitch: {
        ...evaluated.value,
        value: evaluated.value.value.add(context.rootDisplacement),
        notationValue: evaluated.value.value,
      },
      diagnostics: evaluated.diagnostics,
    }
  }
  if (evaluated.value.kind === 'absolutePitch') {
    const absoluteRootOffset = evaluated.value.rootOffset
      .add(mapFormula(context.rootFormula, context.mapping))
    return {
      pitch: {
        ...evaluated.value,
        rootOffset: absoluteRootOffset,
        value: evaluated.value.rootOffset.add(context.rootDisplacement),
      },
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
    pitch: {
      kind: 'pitchOffset',
      value: Value.pitch(evaluated.value.value).add(context.rootDisplacement),
      notationValue: Value.pitch(evaluated.value.value),
      origins: evaluated.value.origins,
    },
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

  const subdivisionPulse = (current: Extract<Expression, { type: 'Directive' }>, context: PitchContext) => {
    if (current.name !== 'subdivision' || current.graceCount) return undefined
    const argument = current.arguments[0]
    const evaluated = argument && argument.type !== 'NamedArgument'
      ? evaluateExpression(argument, context)
      : undefined
    let subdivision: Fraction | undefined
    if (evaluated && 'value' in evaluated) {
      const value = (evaluated as { readonly value: EvaluatedLiteral }).value
      const exact = value.kind === 'absolutePitch' ? undefined : value.value.exactRational()
      if (exact) subdivision = new Fraction(exact)
    }
    return subdivision && subdivision.compare(0) > 0
      ? { pulse: new Fraction(1).div(subdivision), diagnostics: evaluated?.diagnostics ?? [] }
      : undefined
  }

  const pulseAfter = (current: Expression, currentPulse: Fraction, context: PitchContext): Fraction => {
    if (current.type === 'Directive') return subdivisionPulse(current, context)?.pulse ?? currentPulse
    if (current.type === 'Sequence') {
      return current.items.reduce(
        (active, item) => pulseAfter(item, active, context),
        currentPulse,
      )
    }
    if (current.type === 'Repeat') {
      let active = currentPulse
      for (let iteration = 0; iteration < Number(current.count.value); iteration++) {
        active = current.body.reduce(
          (bodyPulse, item) => pulseAfter(item, bodyPulse, context),
          active,
        )
      }
      return active
    }
    // Explicit groups, normalized slots, and parallel branches isolate directive state.
    return currentPulse
  }

  const visit = (
    current: Expression,
    context: PitchContext,
    currentPulse: Fraction = pulse,
    currentDynamic: DynamicMark = 'mf',
  ): ScoreShapeEvaluationResult => {
    if (current.type === 'Rest') {
      return {
        shape: {
          kind: 'rest',
          duration: currentPulse.mul(current.raw.length),
          generated: false,
          origins: [origin(current)],
        },
        diagnostics: [],
      }
    }
    if (current.type === 'DetachedContinue') {
      const shape: ContinueShape = {
        kind: 'continue',
        duration: currentPulse,
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
      let activePulse = currentPulse
      let displayedShapes: ScoreShape[] | undefined
      let displayedAttacks: AttackShape[] = []
      const alternatives: AttackAppearance[][] = []
      const diagnostics: Diagnostic[] = []
      // Evaluate the written body once even for x0 so it remains engravable between the markers.
      const iterations = Math.max(1, count)
      for (let iteration = 0; iteration < iterations; iteration++) {
        let iterationContext = activeContext
        let iterationPulse = activePulse
        const results: ScoreShapeEvaluationResult[] = []
        for (const item of current.body) {
          results.push(visit(item, iterationContext, iterationPulse))
          iterationPulse = pulseAfter(item, iterationPulse, iterationContext)
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
        if (iteration < count) {
          activeContext = iterationContext
          activePulse = iterationPulse
        }
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
      let activePulse = currentPulse
      let activeDynamic = currentDynamic
      let velocity: Fraction | undefined
      let grace: { duration: Fraction; count: number; indices: number[] } | undefined
      let gliss: number[] | undefined
      const results: ScoreShapeEvaluationResult[] = []
      for (const item of current.items) {
        if (item.type === 'PitchContextChange') {
          try { activeContext = applyPitchContextChange(item, activeContext); results.push({ shape: contextAnnotation(item), diagnostics: [] }) }
          catch (error) { results.push({ diagnostics: [{ code: 'XP_CONTEXT', severity: 'error', message: error instanceof Error ? error.message : 'Invalid pitch context.', locations: [item.location] }] }) }
          continue
        }
        if (item.type === 'Directive') {
          const resolved = resolveDirective(item, activeContext)
          const directive = resolved.directive
          if (directive?.kind === 'subdivision') activePulse = directive.pulse
          else if (directive?.kind === 'dynamic') activeDynamic = directive.mark
          else if (directive?.kind === 'velocity') velocity = directive.velocity
          else if (directive?.kind === 'grace') grace = { duration: directive.duration, count: directive.count, indices: [] }
          else if (directive?.kind === 'gliss') gliss = []
          const shape: ScoreShape = directive?.kind === 'unknown'
            ? { kind: 'annotation', text: item.rawName.startsWith('@') ? item.rawName : `@${item.rawName}`, duration: new Fraction(0), origins: [origin(item, 'directive')] }
            : sequence([], [origin(item, 'directive')])
          results.push({ shape, diagnostics: resolved.diagnostics })
          continue
        }
        let result = visit(item, activeContext, activePulse, activeDynamic)
        const index = results.length
        if ('shape' in result && attacks(result.shape).length) {
          if (velocity) {
            let first = true; const pending = velocity
            const applyVelocity = (shape: ScoreShape): ScoreShape => {
              if (shape.kind === 'attack' && first) { first = false; return { ...shape, velocity: pending } }
              if (shape.kind === 'sequence') return { ...shape, children: shape.children.map(applyVelocity) }
              if (shape.kind === 'parallel') return { ...shape, branches: shape.branches.map(applyVelocity) }
              return shape
            }
            result = { ...result, shape: applyVelocity(result.shape) }; velocity = undefined
          }
          if (grace) grace.indices.push(index)
          if (gliss) gliss.push(index)
        }
        results.push(result)
        if (grace && grace.indices.length === grace.count + 1) {
          const targetIndex = grace.indices[grace.indices.length - 1]!
          const stolen = grace.duration.mul(grace.count)
          for (const i of grace.indices.slice(0, -1)) { const r = results[i]!; if ('shape' in r) results[i] = { ...r, shape: scaleShape(r.shape, grace.duration.div(r.shape.duration)) } }
          const target = results[targetIndex]!
          if ('shape' in target && target.shape.duration.compare(stolen) >= 0) results[targetIndex] = { ...target, shape: scaleShape(target.shape, target.shape.duration.sub(stolen).div(target.shape.duration)) }
          else results.push({ diagnostics: [{ code: 'XP_GRACE_DURATION', severity: 'error', message: 'Grace notes exceed the following item duration.', locations: [item.location] }] })
          grace = undefined
        }
        if (gliss && gliss.length === 2) {
          const sourceIndex = gliss[0]!, targetIndex = gliss[1]!, source = results[sourceIndex]!, target = results[targetIndex]!
          if ('shape' in source && 'shape' in target) {
            const from = attacks(source.shape), to = attacks(target.shape)
            if (target.shape.duration.n || from.length !== to.length) results.push({ diagnostics: [{ code: 'XP_GLISS_SHAPE', severity: 'error', message: 'Glissando requires an equal-shaped zero-duration target.', locations: [item.location] }] })
            else {
              let leaf = 0
              const automate = (shape: ScoreShape): ScoreShape => {
                if (shape.kind === 'attack') { const destination = to[leaf++]!; return { ...shape, automation: { curve: 'linear', from: shape.pitch, to: destination.pitch, duration: shape.duration } } }
                if (shape.kind === 'sequence') return { ...shape, children: shape.children.map(automate) }
                if (shape.kind === 'parallel') return { ...shape, branches: shape.branches.map(automate) }
                return shape
              }
              results[sourceIndex] = { ...source, shape: automate(source.shape) }
              results[targetIndex] = { ...target, shape: sequence([], target.shape.origins) }
            }
          }
          gliss = undefined
        }
        activeContext = contextAfter(item, activeContext)
        activePulse = pulseAfter(item, activePulse, activeContext)
      }
      const diagnostics = results.flatMap((result) => result.diagnostics)
      if (grace || gliss) diagnostics.push({ code: 'XP_DIRECTIVE', severity: 'error', message: 'A one-shot directive is missing required following attacks.', locations: [current.location] })
      if (!results.every(hasShape)) return { diagnostics }
      return { shape: sequence(results.map((result) => result.shape), [origin(current)]), diagnostics }
    }
    if (current.type === 'Parallel') {
      const results = current.branches.map((branch) => visit(branch, context, currentPulse, currentDynamic))
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
    if (current.type === 'Group') return visit(current.expression, context, currentPulse, currentDynamic)
    if (current.type === 'NormalizeToSlot') {
      if (!current.expression) {
        return {
          shape: { kind: 'rest', duration: currentPulse, generated: false, origins: [origin(current)] },
          diagnostics: [],
        }
      }
      const evaluated = visit(current.expression, context, currentPulse, currentDynamic)
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
      const normalizedSlots = evaluated.shape.duration.div(currentPulse)
      const normalized = scaleShape(evaluated.shape, currentPulse.div(evaluated.shape.duration))
      const tuplet = Number(normalizedSlots.d) === 1 ? Number(normalizedSlots.n) : undefined
      if (normalized.kind === 'sequence' && tuplet && tuplet > 1 &&
        !Number.isInteger(Math.log2(tuplet))) {
        return {
          shape: { ...normalized, normalized: true, tuplet },
          diagnostics: evaluated.diagnostics,
        }
      }
      return {
        shape: normalized.kind === 'sequence' ? { ...normalized, normalized: true } : normalized,
        diagnostics: evaluated.diagnostics,
      }
    }
    if (current.type === 'PostfixExpression') {
      const evaluated = visit(current.expression, context, currentPulse, currentDynamic)
      if (!('shape' in evaluated)) return evaluated
      const elimination = current.marks.find((mark) => mark.type === 'TailElimination')
      let base = evaluated.shape
      if (elimination) {
        const removed = currentPulse.mul(elimination.count)
        if (removed.compare(base.duration) > 0) return { diagnostics: [...evaluated.diagnostics, { code: 'XP_TAIL_ELIMINATION', severity: 'error', message: 'Tail elimination exceeds the score item duration.', locations: [elimination.location] }] }
        base = scaleShape(base, base.duration.n ? base.duration.sub(removed).div(base.duration) : new Fraction(0))
      }
      const continuations = current.marks.filter((mark) => mark.type === 'DetachedContinue')
      if (!continuations.length) return { shape: base, diagnostics: evaluated.diagnostics }
      return {
        shape: sequence(
          [
            base,
            ...continuations.map<ContinueShape>((mark) => ({
              kind: 'continue',
              duration: currentPulse,
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
      duration: currentPulse,
      origins: evaluated.pitch.origins,
      rootStaffPosition: context.rootStaffPosition,
      dynamic: currentDynamic,
      velocity: DYNAMIC_VELOCITIES[currentDynamic],
      ...(current.type === 'DegreeLiteral' || current.type === 'EqualDivisionLiteral' ||
        (current.type === 'QuantityLiteral' && current.unit === 'c')
        ? { displayLabel: String(current.raw) }
        : {}),
    }
    if ('raw' in current) authoredLabels.set(shape, String(current.raw))
    return { shape, diagnostics: evaluated.diagnostics }
  }

  return visit(node, options.pitchContext ?? DEFAULT_PITCH_CONTEXT)
}
