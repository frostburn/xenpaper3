import { Fraction } from 'xen-dev-utils/fraction'
import type { Expression } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import { Value } from '../value'
import { evaluateDeclaration, evaluateExpression, prepareFunctionCall } from './expressions'
import { DYNAMIC_VELOCITIES, resolveDirective } from './directives'
import { Visitor, type VisitorEvaluation } from './visitor'
import {
  DEFAULT_PITCH_CONTEXT,
  applyPitchContextChange,
  evaluatePitchLiteral,
  mapFormula,
  normalizeStaffAccidental,
} from './pitches'
import type {
  AttackShape,
  AttackAppearance,
  AnnotationShape,
  BarlineShape,
  BarlineStyle,
  ContinueShape,
  EvaluatedLiteral,
  ParallelShape,
  RestShape,
  ScoreShape,
  SequenceShape,
  SourceOrigin,
  PitchContext,
  DynamicMark,
  DirectiveExtensionState,
  ScoreShapeOptions,
  LexicalEnvironment,
  ScoreShapeEvaluationResult,
} from './types'

interface PlaybackAttackShape extends AttackShape {
  readonly dynamic: DynamicMark
  readonly velocity: Fraction
  readonly velocityExplicit?: boolean
}

interface VisitorScope {
  readonly context: PitchContext
  readonly pulse: Fraction
  readonly dynamic: DynamicMark
  readonly articulation: Fraction
  readonly articulationMarks: readonly string[]
  readonly directiveState: DirectiveExtensionState
  readonly environment?: LexicalEnvironment
  readonly subdivisionBase: Fraction
}

type ScoreVisitor = Visitor<Expression, VisitorScope, ScoreShapeEvaluationResult>

const MAX_REPEAT_EXPANSION_NODES = 100_000
const MAX_ENUMERATED_CHORD_SIZE = 10_000n

function mapScoreConstruction(
  node: Expression,
  mapLeaf: (leaf: Expression) => Expression,
): Expression | undefined {
  if (node.type === 'UnaryExpression' || node.type === 'PitchModifierExpression') {
    return mapScoreConstruction(node.operand, (leaf) => ({ ...node, operand: mapLeaf(leaf) }))
  }
  const mapItem = (item: Expression): Expression => {
    const construction = mapScoreConstruction(item, mapLeaf)
    if (construction) return construction
    if (item.type === 'Group') return { ...item, expression: mapItem(item.expression) }
    if (item.type === 'PostfixExpression') {
      return { ...item, expression: mapItem(item.expression) }
    }
    if (
      item.type === 'Rest' ||
      item.type === 'DetachedContinue' ||
      item.type === 'Barline' ||
      item.type === 'HardBoundary' ||
      item.type === 'Directive' ||
      item.type === 'PitchContextChange'
    ) {
      return item
    }
    return mapLeaf(item)
  }
  if (node.type === 'Sequence') {
    return {
      ...node,
      items: node.items.map(mapItem),
    }
  }
  if (node.type === 'Parallel') {
    return {
      ...node,
      branches: node.branches.map(mapItem),
    }
  }
  if (node.type === 'NormalizeToSlot' && node.expression) {
    return {
      ...node,
      expression: mapItem(node.expression),
    }
  }
  if (node.type === 'Repeat') {
    return {
      ...node,
      body: node.body.map(mapItem),
      endings: node.endings.map((ending) => ({ ...ending, body: ending.body.map(mapItem) })),
    }
  }
  if (node.type === 'Group') {
    const expression = mapScoreConstruction(node.expression, mapLeaf)
    if (expression) return { ...node, expression }
  }
  if (node.type === 'PostfixExpression') {
    const expression = mapScoreConstruction(node.expression, mapLeaf)
    return { ...node, expression: expression ?? mapLeaf(node.expression) }
  }
  return undefined
}

function isScalarOperand(node: Expression): boolean {
  if (mapScoreConstruction(node, (leaf) => leaf)) return false
  if (node.type === 'Group') return isScalarOperand(node.expression)
  return ![
    'Rest',
    'DetachedContinue',
    'Barline',
    'HardBoundary',
    'Directive',
    'PitchContextChange',
    'PostfixExpression',
    'EnumeratedChord',
  ].includes(node.type)
}

type BroadcastScalar = {
  expression: Expression
  articulation: Fraction
  continuations: Extract<Expression, { type: 'PostfixExpression' }>['marks']
}

/** Unwrap a single pitch expression together with the performance context authored around it. */
function broadcastScalarOperand(
  node: Expression,
  context: PitchContext,
  environment?: LexicalEnvironment,
): BroadcastScalar | undefined {
  if (node.type === 'Group') return broadcastScalarOperand(node.expression, context, environment)
  if (node.type === 'PostfixExpression') {
    const scalar = broadcastScalarOperand(node.expression, context, environment)
    if (!scalar) return undefined
    return {
      ...scalar,
      continuations: [
        ...scalar.continuations,
        ...node.marks.filter((mark) => mark.type === 'DetachedContinue'),
      ],
    }
  }
  if (node.type === 'Sequence') {
    let articulation = new Fraction(1)
    let scalar: BroadcastScalar | undefined
    for (const item of node.items) {
      if (item.type === 'Directive') {
        const names: Record<string, Fraction> = {
          'articulation-shorthand': new Fraction(1),
          art: new Fraction(1),
          staccatissimo: new Fraction(1, 4),
          staccato: new Fraction(1, 2),
          portato: new Fraction(17, 20),
          tenuto: new Fraction(1),
          legato: new Fraction(11, 10),
        }
        const shorthand = (item as typeof item & { articulationMark?: string }).articulationMark
        const shorthandRatios: Record<string, Fraction> = {
          "'": new Fraction(1, 4),
          '.': new Fraction(1, 2),
          ':': new Fraction(17, 20),
          '-': new Fraction(1),
          _: new Fraction(11, 10),
        }
        if (shorthand) articulation = shorthandRatios[shorthand]!
        else if (item.name !== 'art') {
          const named = names[item.name]
          if (!named) return undefined
          articulation = named
        } else {
          const resolved = resolveDirective(item, context, environment).directive
          if (resolved?.kind !== 'articulation') return undefined
          articulation = resolved.ratio
        }
        continue
      }
      if (scalar) return undefined
      scalar = broadcastScalarOperand(item, context, environment)
      if (!scalar) return undefined
    }
    return scalar ? { ...scalar, articulation } : undefined
  }
  return isScalarOperand(node)
    ? { expression: node, articulation: new Fraction(1), continuations: [] }
    : undefined
}

function applyBroadcastContinuations(
  expression: Expression,
  continuations: BroadcastScalar['continuations'],
): Expression {
  if (!continuations.length) return expression
  if (expression.type === 'PostfixExpression') {
    const existing = expression.marks.filter((mark) => mark.type === 'DetachedContinue')
    if (existing.length >= continuations.length) return expression
    return {
      ...expression,
      marks: [...expression.marks, ...continuations.slice(existing.length)],
    }
  }
  return {
    type: 'PostfixExpression',
    expression,
    marks: continuations,
    location: expression.location,
  }
}

function zipScoreConstructions(
  left: Expression,
  right: Expression,
  combine: (left: Expression, right: Expression) => Expression,
): Expression | undefined {
  const zipItems = (leftItems: Expression[], rightItems: Expression[]) => {
    if (leftItems.length !== rightItems.length) return undefined
    const items = leftItems.map((leftItem, index) => {
      const rightItem = rightItems[index]!
      return (
        zipScoreConstructions(leftItem, rightItem, combine) ??
        (isScalarOperand(leftItem) && isScalarOperand(rightItem)
          ? combine(leftItem, rightItem)
          : undefined)
      )
    })
    return items.every((item) => item !== undefined) ? items : undefined
  }

  if (left.type === 'NormalizeToSlot' && right.type === 'NormalizeToSlot') {
    if (!left.expression || !right.expression) return undefined
    const expression =
      zipScoreConstructions(left.expression, right.expression, combine) ??
      (isScalarOperand(left.expression) && isScalarOperand(right.expression)
        ? combine(left.expression, right.expression)
        : undefined)
    return expression ? { ...left, expression } : undefined
  }
  if (left.type === 'Sequence' && right.type === 'Sequence') {
    const items = zipItems(left.items, right.items)
    return items ? { ...left, items } : undefined
  }
  if (left.type === 'Parallel' && right.type === 'Parallel') {
    const branches = zipItems(left.branches, right.branches)
    return branches ? { ...left, branches } : undefined
  }
  if (left.type === 'Group' && right.type === 'Group') {
    const expression =
      zipScoreConstructions(left.expression, right.expression, combine) ??
      (isScalarOperand(left.expression) && isScalarOperand(right.expression)
        ? combine(left.expression, right.expression)
        : undefined)
    return expression ? { ...left, expression } : undefined
  }
  return undefined
}

function broadcastScalarOperation(
  node: Expression,
  context: PitchContext,
  environment?: LexicalEnvironment,
): Expression | undefined {
  if (node.type === 'Group') {
    const expression = broadcastScalarOperation(node.expression, context, environment)
    return expression ? { ...node, expression } : undefined
  }
  if (node.type === 'PostfixExpression') {
    const expression = broadcastScalarOperation(node.expression, context, environment)
    return expression ? { ...node, expression } : undefined
  }
  if (node.type === 'UnaryExpression' || node.type === 'PitchModifierExpression') {
    const operand = broadcastScalarOperation(node.operand, context, environment)
    if (operand) return { ...node, operand }
    return mapScoreConstruction(node.operand, (item) => ({ ...node, operand: item }))
  }
  if (node.type !== 'BinaryExpression') return undefined
  const left = broadcastScalarOperation(node.left, context, environment)
  if (left) return { ...node, left }
  const right = broadcastScalarOperation(node.right, context, environment)
  if (right) return { ...node, right }
  const zipped = zipScoreConstructions(node.left, node.right, (left, right) => ({
    ...node,
    left,
    right,
  }))
  if (zipped) return zipped
  const leftScalar = broadcastScalarOperand(node.left, context, environment)
  if (leftScalar) {
    const mapped = mapScoreConstruction(node.right, (right) => ({
      ...node,
      left: leftScalar.expression,
      right,
      broadcastArticulation: leftScalar.articulation,
    }))
    if (mapped) return applyBroadcastContinuations(mapped, leftScalar.continuations)
  }
  const rightScalar = broadcastScalarOperand(node.right, context, environment)
  if (rightScalar) {
    const mapped = mapScoreConstruction(node.left, (left) => ({
      ...node,
      left,
      right: rightScalar.expression,
      broadcastArticulation: rightScalar.articulation,
    }))
    if (mapped) return applyBroadcastContinuations(mapped, rightScalar.continuations)
  }
  const overLeft = isScalarOperand(node.right)
    ? mapScoreConstruction(node.left, (left) => ({ ...node, left }))
    : undefined
  if (overLeft) return overLeft
  if (!isScalarOperand(node.left)) return undefined
  return mapScoreConstruction(node.right, (right) => ({ ...node, right }))
}

function expandEnumeratedChord(
  node: Expression,
  context: PitchContext,
): { readonly expressions: readonly Expression[]; readonly diagnostics: readonly Diagnostic[] } {
  if (node.type === 'EnumeratedChord') {
    let enumerands = node.enumerands
    if (!enumerands) {
      const endpoint = node.rangeEnd!
      const evaluated = [
        evaluateExpression(node.first, context),
        evaluateExpression(endpoint, context),
      ]
      const diagnostics = evaluated.flatMap((result) => result.diagnostics)
      const integers = evaluated.map((result) => {
        if (!('value' in result) || result.value.kind !== 'scalar') return undefined
        const exact = result.value.value.exactRational()
        return exact?.d === 1 ? BigInt(exact.s * exact.n) : undefined
      })
      if (integers.some((value) => value === undefined)) {
        return {
          expressions: [],
          diagnostics: [
            ...diagnostics,
            {
              code: 'XP_TYPE_MISMATCH',
              severity: 'error',
              message: 'Enumerated chord range endpoints must be exact integers.',
              locations: [node.location],
            },
          ],
        }
      }
      const [start, end] = integers as [bigint, bigint]
      const distance = start <= end ? end - start : start - end
      if (distance + 1n > MAX_ENUMERATED_CHORD_SIZE) {
        return {
          expressions: [],
          diagnostics: [
            ...diagnostics,
            {
              code: 'XP_EXPANSION_LIMIT',
              severity: 'error',
              message: `Enumerated chord exceeds the ${MAX_ENUMERATED_CHORD_SIZE}-member expansion limit.`,
              locations: [node.location],
            },
          ],
        }
      }
      const step = start <= end ? 1n : -1n
      enumerands = []
      for (let value = start; ; value += step) {
        enumerands.push({
          type: 'IntegerLiteral',
          value: String(value),
          raw: String(value),
          location: node.location,
        })
        if (value === end) break
      }
    }
    return {
      expressions: enumerands.map((enumerand) => ({
        type: 'BinaryExpression',
        operator: '/',
        left: node.inverted ? node.first : enumerand,
        right: node.inverted ? enumerand : node.first,
        location: node.location,
      })),
      diagnostics: [],
    }
  }
  if (node.type === 'BinaryExpression') {
    const left = expandEnumeratedChord(node.left, context)
    const right = expandEnumeratedChord(node.right, context)
    if (
      left.expressions.length === 1 &&
      left.expressions[0] === node.left &&
      right.expressions.length === 1 &&
      right.expressions[0] === node.right
    ) {
      return { expressions: [node], diagnostics: [...left.diagnostics, ...right.diagnostics] }
    }
    return {
      expressions: left.expressions.flatMap((lhs) =>
        right.expressions.map((rhs) => ({ ...node, left: lhs, right: rhs })),
      ),
      diagnostics: [...left.diagnostics, ...right.diagnostics],
    }
  }
  if (node.type === 'Group') {
    const expanded = expandEnumeratedChord(node.expression, context)
    if (expanded.expressions.length === 1 && expanded.expressions[0] === node.expression) {
      return { expressions: [node], diagnostics: expanded.diagnostics }
    }
    return {
      expressions: expanded.expressions.map((expression) => ({ ...node, expression })),
      diagnostics: expanded.diagnostics,
    }
  }
  if (node.type === 'UnaryExpression' || node.type === 'PitchModifierExpression') {
    const expanded = expandEnumeratedChord(node.operand, context)
    if (expanded.expressions.length === 1 && expanded.expressions[0] === node.operand) {
      return { expressions: [node], diagnostics: expanded.diagnostics }
    }
    return {
      expressions: expanded.expressions.map((operand) => ({ ...node, operand })),
      diagnostics: expanded.diagnostics,
    }
  }
  return { expressions: [node], diagnostics: [] }
}

function repeatCount(node: Extract<Expression, { type: 'Repeat' }>): number | undefined {
  let count: bigint
  try {
    count = node.count ? BigInt(String(node.count.value)) : 2n
  } catch {
    return undefined
  }
  let longestEnding = 0
  for (const ending of node.endings) {
    if (ending.body.length > longestEnding) longestEnding = ending.body.length
  }
  const expandedNodes = count * BigInt(Math.max(1, node.body.length + longestEnding))
  if (count < 0n || expandedNodes > BigInt(MAX_REPEAT_EXPANSION_NODES)) return undefined
  return Number(count)
}

const repeatEndingBodies = new WeakMap<
  Extract<Expression, { type: 'Repeat' }>,
  Map<bigint, Expression[]>
>()

function appendRepeatItems(result: Expression[], items: readonly Expression[]) {
  for (const item of items) {
    if (item.type === 'Sequence') {
      for (const child of item.items) result.push(child)
    } else result.push(item)
  }
}

function repeatBody(
  node: Extract<Expression, { type: 'Repeat' }>,
  iteration: number,
): readonly Expression[] {
  let endings = repeatEndingBodies.get(node)
  if (!endings) {
    endings = new Map()
    for (const ending of node.endings) {
      const number = BigInt(ending.number.value)
      if (!endings.has(number)) endings.set(number, ending.body)
    }
    repeatEndingBodies.set(node, endings)
  }
  const result: Expression[] = []
  appendRepeatItems(result, node.body)
  appendRepeatItems(result, endings.get(BigInt(iteration + 1)) ?? [])
  return result
}

function hasShape(
  result: ScoreShapeEvaluationResult,
): result is { readonly shape: ScoreShape; readonly diagnostics: readonly Diagnostic[] } {
  return 'shape' in result
}

function origin(node: Expression, role: SourceOrigin['role'] = 'structural'): SourceOrigin {
  return { location: node.location, role }
}

function sequence(
  children: readonly ScoreShape[],
  origins: readonly SourceOrigin[],
): SequenceShape {
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

function barline(node: Expression, style: BarlineStyle, endingNumber?: number): BarlineShape {
  return {
    kind: 'barline',
    style,
    duration: new Fraction(0),
    origins: [origin(node)],
    endingNumber,
  }
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
    case 'dynamic':
    case 'clef':
    case 'key-signature':
    case 'groove':
    case 'drone':
      return { ...shape, duration }
    case 'sequence':
      return {
        ...shape,
        duration,
        children: shape.children.map((child) => scaleShape(child, factor)),
      }
    case 'parallel':
      return {
        ...shape,
        duration,
        branches: shape.branches.map((branch) => scaleShape(branch, factor)),
      }
  }
}

/** Trim from the rhythmic tail without moving or rescaling earlier material. */
function trimShape(shape: ScoreShape, duration: Fraction): ScoreShape {
  if (duration.compare(0) < 0 || duration.compare(shape.duration) > 0)
    throw new RangeError('Invalid trimmed duration.')
  if (shape.kind === 'sequence') {
    let remaining = duration
    const children = shape.children.map((child) => {
      const kept = remaining.compare(child.duration) >= 0 ? child.duration : remaining
      remaining = remaining.sub(kept)
      return trimShape(child, kept)
    })
    return { ...shape, duration, children }
  }
  if (shape.kind === 'parallel') {
    return {
      ...shape,
      duration,
      branches: shape.branches.map((branch) =>
        trimShape(branch, branch.duration.compare(duration) > 0 ? duration : branch.duration),
      ),
    }
  }
  return { ...shape, duration }
}

/** Give a zero-duration pitch shape time without dividing by its old duration. */
function resizeShape(shape: ScoreShape, duration: Fraction): ScoreShape {
  if (shape.duration.n) return scaleShape(shape, duration.div(shape.duration))
  if (shape.kind === 'attack') return { ...shape, duration }
  if (shape.kind === 'parallel')
    return {
      ...shape,
      duration,
      branches: shape.branches.map((branch) => resizeShape(branch, duration)),
    }
  if (shape.kind === 'sequence') {
    const pitchChild = shape.children.findIndex((child) => attacks(child).length > 0)
    return {
      ...shape,
      duration,
      children: shape.children.map((child, index) =>
        index === pitchChild ? resizeShape(child, duration) : child,
      ),
    }
  }
  return { ...shape, duration }
}

function mapAttacks(
  shape: ScoreShape,
  transform: (attack: AttackShape) => AttackShape,
): ScoreShape {
  if (shape.kind === 'attack') return transform(shape)
  if (shape.kind === 'sequence')
    return { ...shape, children: shape.children.map((child) => mapAttacks(child, transform)) }
  if (shape.kind === 'parallel')
    return { ...shape, branches: shape.branches.map((branch) => mapAttacks(branch, transform)) }
  return shape
}

type PitchTree =
  | { kind: 'attack'; attack: AttackShape }
  | { kind: 'sequence' | 'parallel'; children: PitchTree[] }

function pitchTree(shape: ScoreShape): PitchTree | undefined {
  if (shape.kind === 'attack') return { kind: 'attack', attack: shape }
  if (shape.kind !== 'sequence' && shape.kind !== 'parallel') return undefined
  const children = (shape.kind === 'sequence' ? shape.children : shape.branches)
    .map(pitchTree)
    .filter((child): child is PitchTree => Boolean(child))
  if (!children.length) return undefined
  if (children.length === 1) return children[0]
  return { kind: shape.kind, children }
}

function matchingPitchTrees(source: PitchTree, target: PitchTree): boolean {
  if (source.kind === 'attack' || target.kind === 'attack') return source.kind === target.kind
  return (
    source.kind === target.kind &&
    source.children.length === target.children.length &&
    source.children.every((child, index) => matchingPitchTrees(child, target.children[index]!))
  )
}

/** Sounding span for each attack, including attached continuation shapes. */
function attackSpans(shape: ScoreShape): Map<AttackShape, Fraction> {
  const spans = new Map<AttackShape, Fraction>()
  type State = { active: AttackShape[] }
  const visit = (current: ScoreShape, state: State) => {
    if (current.kind === 'attack') {
      spans.set(current, current.duration)
      state.active = [current]
    } else if (current.kind === 'continue')
      for (const attack of state.active) spans.set(attack, spans.get(attack)!.add(current.duration))
    else if (current.kind === 'rest') state.active = []
    else if (current.kind === 'sequence') current.children.forEach((child) => visit(child, state))
    else if (current.kind === 'parallel') {
      const states = current.branches.map((): State => ({ active: [] }))
      current.branches.forEach((branch, index) => visit(branch, states[index]!))
      state.active = states.flatMap((branch) => branch.active)
    }
  }
  visit(shape, { active: [] })
  return spans
}

function annotateRepeatAppearances(
  shape: ScoreShape,
  alternatives: readonly (readonly AttackAppearance[])[],
): ScoreShape {
  let attackIndex = 0
  const annotate = (current: ScoreShape): ScoreShape => {
    if (current.kind === 'attack') {
      const alternateAppearances = alternatives[attackIndex++]
      if (!alternateAppearances?.length) return current
      const notationValue = (pitch: AttackShape['pitch']) =>
        pitch.kind === 'absolutePitch' ? pitch.rootOffset : (pitch.notationValue ?? pitch.value)
      const ambiguous = alternateAppearances.some(
        (appearance) =>
          appearance.rootPitch.spelling.raw !== current.rootPitch.spelling.raw ||
          !notationValue(appearance.pitch).equals(notationValue(current.pitch)),
      )
      return {
        ...current,
        alternateAppearances,
        ...(ambiguous && !current.displayLabel
          ? { displayLabel: authoredLabels.get(current) }
          : {}),
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

function contextAnnotation(
  node: Extract<Expression, { type: 'PitchContextChange' }>,
): AnnotationShape {
  const pitchText = (pitch: Extract<Expression, { type: 'PitchLiteral' }>) => {
    let text = pitch.raw
    for (const accidental of [...pitch.accidentals].reverse()) {
      const glyph =
        {
          flat: '♭',
          sharp: '♯',
          natural: '♮',
          'double-flat': '𝄫',
          'double-sharp': '𝄪',
          'half-flat': '𝄳',
          'half-sharp': '𝄲',
        }[normalizeStaffAccidental(accidental.value)] ?? accidental.value
      const start = accidental.location.start.offset - pitch.location.start.offset
      const end = accidental.location.end.offset - pitch.location.start.offset
      text = text.slice(0, start) + glyph + text.slice(end)
    }
    return text
  }
  const text = node.statements
    .map((statement) => {
      if (statement.type !== 'ContextAssignment')
        return statement.type === 'ContextPreset' ? statement.raw : 'context'
      const target =
        statement.target.type === 'ContextNameTarget'
          ? statement.target.name
          : statement.target.type === 'ContextPitchTarget'
            ? pitchText(statement.target.pitch)
            : statement.target.operator
      const expressionText = (value: Expression): string => {
        if ('raw' in value) return String(value.raw)
        if (value.type === 'Identifier') return value.name
        if (value.type === 'UnaryExpression')
          return `${value.operator}${expressionText(value.operand)}`
        if (value.type === 'PitchModifierExpression')
          return `${value.modifier.raw}${expressionText(value.operand)}`
        if (value.type === 'BinaryExpression')
          return `${expressionText(value.left)} ${value.operator} ${expressionText(value.right)}`
        if (value.type === 'Group') return `(${expressionText(value.expression)})`
        return value.type
      }
      const value = expressionText(statement.value)
      if (statement.association === 'rootAsTarget') return `root as ${target}`
      if (statement.association === 'targetAsRoot') return `${target} as root`
      return `${target} = ${value}`
    })
    .join('; ')
  return { kind: 'annotation', text, duration: new Fraction(0), origins: [origin(node, 'context')] }
}

function contextShape(
  node: Extract<Expression, { type: 'PitchContextChange' }>,
  context: PitchContext,
  previousContext?: PitchContext,
): ScoreShape {
  const signatureDeclared = node.statements.some(
    (statement) =>
      statement.type === 'SignatureDeclaration' ||
      (statement.type === 'MosDeclaration' &&
        statement.elements.some((element) => element.type === 'SignatureDeclaration')),
  )
  const signatureShape = () => {
    let names = context.mos ? [...context.mos.nominals.keys()] : ['C', 'D', 'E', 'F', 'G', 'A', 'B']
    if (!context.mos) {
      const written = [...(context.signature?.values() ?? [])].flatMap((pitch) =>
        pitch.accidentals.map((accidental) => accidental.value),
      )
      const sharps = written.some((value) => ['#', '♯', 'x', '𝄪', 't', '‡', '𝄲'].includes(value))
      const flats = written.some((value) => ['b', '♭', '𝄫', 'd', '𝄳'].includes(value))
      if (sharps && !flats) names = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
      else if (flats && !sharps) names = ['B', 'E', 'A', 'D', 'G', 'C', 'F']
    }
    const pitches = names.flatMap((name) => {
      let pitch = context.signature?.get(name)
      const decorated = (candidate: typeof pitch) =>
        candidate &&
        (candidate.accidentals.length || candidate.inflections.length || candidate.modifiers.length)
      if (!decorated(pitch)) {
        const previousPitch = previousContext?.signature?.get(name)
        if (!previousPitch || !decorated(previousPitch)) return []
        pitch = {
          ...previousPitch,
          modifiers: [],
          accidentals: [{ type: 'Accidental', value: '_', location: node.location }],
          inflections: [],
          raw: name,
        }
      }
      if (!pitch) return []
      const system: 'mos' | 'latin' = context.mos ? 'mos' : 'latin'
      const literal = {
        ...pitch,
        nominal: { ...pitch.nominal, value: name, system },
      }
      const value = evaluatePitchLiteral(literal, { ...context, signature: undefined })
      const spelling = value.spelling
      return spelling.accidentals?.length ||
        spelling.inflections?.length ||
        spelling.modifiers?.length
        ? [value]
        : []
    })
    return {
      kind: 'key-signature' as const,
      pitches,
      duration: new Fraction(0),
      origins: [origin(node, 'context')],
    }
  }
  if (node.statements.some((statement) => statement.type === 'MosDeclaration') && context.mos) {
    const large = [...context.mos.pattern].filter((step) => step === 'L').length
    const small = [...context.mos.pattern].filter((step) => step === 's').length
    const clef: ScoreShape = {
      kind: 'clef',
      clef:
        large === 5 && small === 2
          ? { kind: 'treble' }
          : { kind: 'diamond-mos', pattern: context.mos.pattern },
      duration: new Fraction(0),
      origins: [origin(node, 'context')],
    }
    if (!signatureDeclared) return clef
    return {
      kind: 'sequence',
      children: [clef, signatureShape()],
      duration: new Fraction(0),
      origins: [origin(node, 'context')],
    }
  }
  if (previousContext?.mos && !context.mos) {
    const clef: ScoreShape = {
      kind: 'clef',
      clef: { kind: 'treble' },
      duration: new Fraction(0),
      origins: [origin(node, 'context')],
    }
    if (!signatureDeclared) return clef
    return sequence([clef, signatureShape()], [origin(node, 'context')])
  }
  if (signatureDeclared) return signatureShape()
  return contextAnnotation(node)
}

function playablePitch(
  node: Expression,
  context: PitchContext,
  environment?: LexicalEnvironment,
):
  | {
      readonly pitch: AttackShape['pitch']
      readonly justIntonation?: boolean
      readonly diagnostics: readonly Diagnostic[]
    }
  | { readonly diagnostics: readonly Diagnostic[] } {
  const evaluated = evaluateExpression(node, context, environment)
  if (!('value' in evaluated)) return evaluated
  if (evaluated.value.kind === 'pitchOffset') {
    return {
      pitch: {
        ...evaluated.value,
        value: evaluated.value.value.add(context.rootDisplacement),
        notationValue: evaluated.value.value,
      },
      ...(context.mapping.id !== 'untempered' && evaluated.value.justIntonation
        ? { justIntonation: true }
        : {}),
      diagnostics: evaluated.diagnostics,
    }
  }
  if (evaluated.value.kind === 'absolutePitch') {
    const absoluteRootOffset = evaluated.value.rootOffset.add(
      mapFormula(context.rootPitch.formula, context.mapping),
    )
    return {
      pitch: {
        ...evaluated.value,
        rootOffset: absoluteRootOffset,
        value: evaluated.value.rootOffset.add(context.rootDisplacement),
      },
      diagnostics: evaluated.diagnostics,
    }
  }
  const ratio = evaluated.value.value
  if (ratio.dimensions.equals({ seconds: -1 }) && ratio.valueOf() > 0) {
    const notationRatio = ratio.div(context.rootFrequency)
    return {
      pitch: {
        kind: 'frequency',
        frequency: ratio,
        value: Value.pitch(notationRatio).add(context.rootDisplacement),
        notationValue: Value.pitch(notationRatio),
        origins: evaluated.value.origins,
      },
      diagnostics: evaluated.diagnostics,
    }
  }
  if (!ratio.dimensions.isDimensionless || ratio.valueOf() <= 0) {
    return {
      diagnostics: [
        ...evaluated.diagnostics,
        {
          code: 'XP_TYPE_MISMATCH',
          severity: 'error',
          message: 'A score atom must be a pitch offset or positive ratio.',
          locations: [node.location],
        },
      ],
    }
  }
  return {
    pitch: {
      kind: 'pitchOffset',
      value: Value.pitch(ratio).add(context.rootDisplacement),
      notationValue: Value.pitch(ratio),
      origins: evaluated.value.origins,
    },
    ...(context.mapping.id !== 'untempered' && ratio.isPositiveExactRatio()
      ? { justIntonation: true }
      : {}),
    diagnostics: evaluated.diagnostics,
  }
}

/** Build the exact-duration score-shape tree for sequencing, parallelism, and slots. */
export function evaluateScoreSemantics(
  node: Expression,
  options: ScoreShapeOptions = {},
): ScoreShapeEvaluationResult {
  const pulse = new Fraction(options.pulse ?? 1)
  if (pulse.compare(0) <= 0) throw new RangeError('pulse must be positive.')
  const extensions = new Map(
    (options.directiveExtensions ?? []).map((extension) => [
      extension.name.toLowerCase(),
      extension,
    ]),
  )
  if (extensions.size !== (options.directiveExtensions ?? []).length)
    throw new RangeError('Directive extension names must be unique.')
  const extensionInitialState: Record<string, unknown> = {}
  for (const [name, extension] of extensions) {
    const stateKey = extension.stateKey?.toLowerCase() ?? name
    if (!(stateKey in extensionInitialState) || extensionInitialState[stateKey] === undefined) {
      extensionInitialState[stateKey] = extension.initialState
    } else if (
      extension.initialState !== undefined &&
      !Object.is(extensionInitialState[stateKey], extension.initialState)
    ) {
      throw new RangeError(
        `Directive extensions sharing state key "${stateKey}" must share an initializer.`,
      )
    }
  }
  const initialDirectiveState: DirectiveExtensionState = {
    ...extensionInitialState,
    ...options.directiveState,
  }

  const applyExtension = (
    directive: Extract<Expression, { type: 'Directive' }>,
    context: PitchContext,
    state: DirectiveExtensionState,
  ): { state: DirectiveExtensionState; diagnostics: readonly Diagnostic[] } | undefined => {
    const extension = extensions.get(directive.name)
    if (!extension) return undefined
    const stateKey = extension.stateKey?.toLowerCase() ?? directive.name
    try {
      const result = extension.apply(directive, context, state[stateKey])
      return {
        state: { ...state, [stateKey]: result.state },
        diagnostics: result.diagnostics ?? [],
      }
    } catch (error) {
      return {
        state,
        diagnostics: [
          {
            code: 'XP_DIRECTIVE_EXTENSION',
            severity: 'error',
            message: error instanceof Error ? error.message : `Invalid @${directive.name}.`,
            locations: [directive.location],
          },
        ],
      }
    }
  }

  const contextAfter = (current: Expression, visitor: ScoreVisitor): PitchContext => {
    const { context } = visitor.scope
    if (current.type === 'PitchContextChange') {
      try {
        return applyPitchContextChange(current, context)
      } catch {
        return context
      }
    }
    if (current.type === 'Sequence') {
      let activeVisitor = visitor
      for (const item of current.items)
        activeVisitor = activeVisitor.spawn({ context: contextAfter(item, activeVisitor) })
      return activeVisitor.scope.context
    }
    // Explicit groups and normalized slots inherit the surrounding pitch context, but changes
    // made inside them are lexical and must not escape into the containing sequence.
    if (current.type === 'Group' || current.type === 'NormalizeToSlot') return context
    if (current.type === 'PostfixExpression') return contextAfter(current.expression, visitor)
    if (current.type === 'Repeat') {
      let active = context
      const count = repeatCount(current)
      if (count === undefined) return context
      for (let iteration = 0; iteration < count; iteration++) {
        for (const item of repeatBody(current, iteration)) {
          const itemVisitor = visitor.spawn({ context: active })
          active = contextAfter(item, itemVisitor)
        }
      }
      return active
    }
    return context
  }

  const subdivisionPulse = (
    current: Extract<Expression, { type: 'Directive' }>,
    visitor: ScoreVisitor,
  ) => {
    const { context, environment } = visitor.scope
    if (current.name !== 'subdivision' || current.graceCount) return undefined
    const argument = current.arguments[0]
    const evaluated =
      argument && argument.type !== 'NamedArgument'
        ? evaluateExpression(argument, context, environment)
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

  const pulseAfter = (current: Expression, visitor: ScoreVisitor): Fraction => {
    const { pulse: currentPulse, subdivisionBase } = visitor.scope
    if (current.type === 'Directive')
      return subdivisionPulse(current, visitor)?.pulse.mul(subdivisionBase) ?? currentPulse
    if (current.type === 'Sequence') {
      let activeVisitor = visitor
      for (const item of current.items)
        activeVisitor = activeVisitor.spawn({ pulse: pulseAfter(item, activeVisitor) })
      return activeVisitor.scope.pulse
    }
    if (current.type === 'Repeat') {
      let active = currentPulse
      const count = repeatCount(current)
      if (count === undefined) return active
      for (let iteration = 0; iteration < count; iteration++) {
        for (const item of repeatBody(current, iteration)) {
          const itemVisitor = visitor.spawn({ pulse: active })
          active = pulseAfter(item, itemVisitor)
        }
      }
      return active
    }
    // Explicit groups, normalized slots, and parallel branches isolate directive state.
    return currentPulse
  }

  const articulationAfter = (
    current: Expression,
    visitor: ScoreVisitor,
  ): { ratio: Fraction; marks: readonly string[] } => {
    const { articulation: ratio, articulationMarks: marks, context, environment } = visitor.scope
    if (current.type === 'Directive') {
      const resolved = resolveDirective(current, context, environment).directive
      if (resolved?.kind !== 'articulation') return { ratio, marks }
      return {
        ratio: resolved.ratio,
        marks: resolved.shorthand && resolved.mark !== '-' ? [...marks, resolved.mark!] : [],
      }
    }
    if (current.type === 'Sequence') {
      let activeVisitor = visitor
      for (const item of current.items) {
        const active = articulationAfter(item, activeVisitor)
        activeVisitor = activeVisitor.spawn({
          articulation: active.ratio,
          articulationMarks: active.marks,
        })
      }
      return {
        ratio: activeVisitor.scope.articulation,
        marks: activeVisitor.scope.articulationMarks,
      }
    }
    return { ratio, marks }
  }

  const directiveStateAfter = (
    current: Expression,
    visitor: ScoreVisitor,
  ): DirectiveExtensionState => {
    const { directiveState: state, context } = visitor.scope
    if (current.type === 'Directive') {
      return applyExtension(current, context, state)?.state ?? state
    }
    if (current.type === 'Sequence') {
      let activeVisitor = visitor
      for (const item of current.items) {
        activeVisitor = activeVisitor.spawn({
          directiveState: directiveStateAfter(item, activeVisitor),
          context: contextAfter(item, activeVisitor),
        })
      }
      return activeVisitor.scope.directiveState
    }
    if (current.type === 'PostfixExpression')
      return directiveStateAfter(current.expression, visitor)
    if (current.type === 'Repeat') {
      let activeVisitor = visitor
      const count = repeatCount(current)
      if (count === undefined) return state
      for (let iteration = 0; iteration < count; iteration++) {
        for (const item of repeatBody(current, iteration)) {
          activeVisitor = activeVisitor.spawn({
            directiveState: directiveStateAfter(item, activeVisitor),
            context: contextAfter(item, activeVisitor),
          })
        }
      }
      return activeVisitor.scope.directiveState
    }
    return state
  }

  const visitorAfter = (current: Expression, visitor: ScoreVisitor): ScoreVisitor =>
    visitor.spawn({
      context: contextAfter(current, visitor),
      pulse: pulseAfter(current, visitor),
      directiveState: directiveStateAfter(current, visitor),
    })

  const evaluateNode: VisitorEvaluation<Expression, VisitorScope, ScoreShapeEvaluationResult> = (
    current,
    visitor,
  ) => {
    const {
      context,
      pulse: currentPulse,
      dynamic: currentDynamic,
      articulation: currentArticulation,
      articulationMarks: currentArticulationMarks,
      directiveState: currentDirectiveState,
      environment,
      subdivisionBase,
    } = visitor.scope
    if (current.type === 'CallExpression') {
      const prepared = prepareFunctionCall(current, context, environment)
      if (prepared) {
        if (!('expression' in prepared)) return prepared
        const returned = visitor.visit(prepared.expression, {
          environment: prepared.environment,
          subdivisionBase: currentPulse,
        })
        return { ...returned, diagnostics: [...prepared.diagnostics, ...returned.diagnostics] }
      }
    }
    const broadcast = broadcastScalarOperation(current, context, environment)
    if (broadcast) return visitor.visit(broadcast)
    const expandedChord = expandEnumeratedChord(current, context)
    if (expandedChord.diagnostics.length) return { diagnostics: expandedChord.diagnostics }
    if (expandedChord.expressions.length !== 1 || expandedChord.expressions[0] !== current) {
      const results = expandedChord.expressions.map((expression) => visitor.visit(expression))
      const diagnostics = results.flatMap((result) => result.diagnostics)
      if (!results.every(hasShape)) return { diagnostics }
      const branches = results.map((result) => result.shape)
      const duration = branches.reduce(
        (maximum, branch) => (branch.duration.compare(maximum) > 0 ? branch.duration : maximum),
        new Fraction(0),
      )
      return {
        shape: {
          kind: 'parallel',
          duration,
          branches: branches.map((branch) => pad(branch, duration)),
          origins: [origin(current)],
        },
        diagnostics,
      }
    }
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
      const count = repeatCount(current)
      if (count === undefined) {
        return {
          diagnostics: [
            {
              code: 'XP_REPEAT_COUNT',
              severity: 'error',
              message: `Repeat count must be an exact non-negative integer within the ${MAX_REPEAT_EXPANSION_NODES}-node expansion limit.`,
              locations: [current.count?.location ?? current.location],
            },
          ],
        }
      }
      let activeVisitor = visitor
      let displayedShapes: ScoreShape[] | undefined
      let displayedAttacks: AttackShape[] = []
      const alternatives: AttackAppearance[][] = []
      const diagnostics: Diagnostic[] = []
      // Evaluate the written body once even for x0 so it remains engravable between the markers.
      const iterations = Math.max(1, count)
      for (let iteration = 0; iteration < iterations; iteration++) {
        const iterationNode: Expression = {
          type: 'Sequence',
          items: [...repeatBody(current, iteration)],
          location: current.location,
        }
        const result = activeVisitor.visit(iterationNode)
        const nextVisitor = visitorAfter(iterationNode, activeVisitor)
        diagnostics.push(...result.diagnostics)
        if (!hasShape(result)) return { diagnostics }
        const iterationShapes = [result.shape]
        if (!displayedShapes) {
          displayedShapes = iterationShapes
          displayedAttacks = iterationShapes.flatMap(attacks)
          for (const _attack of displayedAttacks) alternatives.push([])
        } else {
          const iterationAttacks = iterationShapes.flatMap(attacks)
          for (
            let index = 0;
            index < Math.min(displayedAttacks.length, iterationAttacks.length);
            index++
          ) {
            const attack = iterationAttacks[index]!
            alternatives[index]!.push({
              pitch: attack.pitch,
              rootPitch: attack.rootPitch,
            })
          }
        }
        if (iteration < count) activeVisitor = nextVisitor
      }
      const displayed = annotateRepeatAppearances(
        sequence(displayedShapes ?? [], [origin(current)]),
        alternatives,
      ) as SequenceShape
      const commonNode: Expression = {
        type: 'Sequence',
        items: current.body,
        location: current.location,
      }
      const endingArticulation = articulationAfter(commonNode, visitor)
      const endingVisitor = visitor.spawn({
        context: contextAfter(commonNode, visitor),
        pulse: pulseAfter(commonNode, visitor),
        articulation: endingArticulation.ratio,
        articulationMarks: endingArticulation.marks,
        directiveState: directiveStateAfter(commonNode, visitor),
      })
      const commonResult = visitor.visit(commonNode)
      diagnostics.push(...commonResult.diagnostics)
      const commonShapes = hasShape(commonResult) ? [commonResult.shape] : []
      const endingShapes = current.endings.map((ending) => {
        const endingNode: Expression = {
          type: 'Sequence',
          items: ending.body,
          location: current.location,
        }
        const result = endingVisitor.visit(endingNode)
        diagnostics.push(...result.diagnostics)
        return hasShape(result) ? [result.shape] : []
      })
      const endingMarkers = current.endings.flatMap((ending, index): ScoreShape[] => [
        barline(current, 'ending-start', Number(ending.number.value)),
        ...endingShapes[index]!,
        barline(current, index === current.endings.length - 1 ? 'ending-end' : 'repeat-end'),
      ])
      return {
        shape: sequence(
          [
            barline(current, 'repeat-start'),
            ...(current.endings.length ? [...commonShapes, ...endingMarkers] : displayed.children),
            ...(current.endings.length ? [] : [barline(current, 'repeat-end')]),
          ],
          [origin(current)],
        ),
        diagnostics,
      }
    }
    if (current.type === 'Sequence') {
      let activeVisitor = visitor
      let velocity: Fraction | undefined
      let grace: { duration: Fraction; count: number; indices: number[] } | undefined
      let gliss:
        | {
            indices: number[]
            /** A chained gliss reuses the previous target after it became a continuation. */
            sourceShape?: ScoreShape
            chainRequested?: boolean
            ownerIndex?: number
            segmentStart?: Fraction
            curve: string
            nextCurve?: string
          }
        | undefined
      const results: ScoreShapeEvaluationResult[] = []
      for (const item of current.items) {
        if (item.type === 'VariableDeclaration' || item.type === 'FunctionDeclaration') {
          const declared = evaluateDeclaration(
            item,
            activeVisitor.scope.context,
            activeVisitor.scope.environment,
          )
          activeVisitor = activeVisitor.spawn({ environment: declared.environment })
          results.push({ shape: sequence([], [origin(item)]), diagnostics: declared.diagnostics })
          continue
        }
        if (item.type === 'PitchContextChange') {
          try {
            const previousContext = activeVisitor.scope.context
            const changedContext = applyPitchContextChange(item, previousContext)
            activeVisitor = activeVisitor.spawn({ context: changedContext })
            results.push({
              shape: contextShape(item, changedContext, previousContext),
              diagnostics: [],
            })
          } catch (error) {
            results.push({
              diagnostics: [
                {
                  code: 'XP_CONTEXT',
                  severity: 'error',
                  message: error instanceof Error ? error.message : 'Invalid pitch context.',
                  locations: [item.location],
                },
              ],
            })
          }
          continue
        }
        if (item.type === 'Directive') {
          const extended = applyExtension(
            item,
            activeVisitor.scope.context,
            activeVisitor.scope.directiveState,
          )
          if (extended) {
            activeVisitor = activeVisitor.spawn({ directiveState: extended.state })
            results.push({
              shape: sequence([], [origin(item, 'directive')]),
              diagnostics: extended.diagnostics,
            })
            continue
          }
          const resolved = resolveDirective(
            item,
            activeVisitor.scope.context,
            activeVisitor.scope.environment,
          )
          const directive = resolved.directive
          if (directive?.kind === 'subdivision')
            activeVisitor = activeVisitor.spawn({ pulse: subdivisionBase.mul(directive.pulse) })
          else if (directive?.kind === 'dynamic')
            activeVisitor = activeVisitor.spawn({ dynamic: directive.mark })
          else if (directive?.kind === 'velocity') velocity = directive.velocity
          else if (directive?.kind === 'grace')
            grace = { duration: directive.duration, count: directive.count, indices: [] }
          else if (directive?.kind === 'gliss') {
            // A gliss directive between the source and target starts another segment at that
            // target. Keep collecting the current pair; completion below will seed the next pair.
            if (!gliss) gliss = { indices: [], curve: directive.curve }
            else if (gliss.indices.length === 1) {
              gliss.chainRequested = true
              gliss.nextCurve = directive.curve
            }
          } else if (directive?.kind === 'articulation') {
            const articulationMarks =
              directive.shorthand && directive.mark !== '-'
                ? [...activeVisitor.scope.articulationMarks, directive.mark!]
                : []
            activeVisitor = activeVisitor.spawn({
              articulation: directive.ratio,
              articulationMarks,
            })
          }
          let grooveTemplate: ScoreShape | undefined
          if (directive?.kind === 'groove' && directive.argument) {
            const template = activeVisitor.visit(directive.argument, {
              dynamic: 'mf',
              articulation: new Fraction(1),
              articulationMarks: [],
              directiveState: initialDirectiveState,
              subdivisionBase: activeVisitor.scope.pulse,
            })
            resolved.diagnostics.push(...template.diagnostics)
            if ('shape' in template) {
              if (attacks(template.shape).length < 2 || template.shape.duration.compare(0) <= 0) {
                resolved.diagnostics.push({
                  code: 'XP_GROOVE',
                  severity: 'error',
                  message: 'A groove requires at least two notes over a positive duration.',
                  locations: [directive.argument.location],
                })
              } else grooveTemplate = template.shape
            }
          }
          let droneTemplate: ScoreShape | undefined
          if (directive?.kind === 'drone' && directive.argument) {
            const template = activeVisitor.visit(directive.argument, {
              subdivisionBase: activeVisitor.scope.pulse,
            })
            resolved.diagnostics.push(...template.diagnostics)
            if ('shape' in template) {
              if (!attacks(template.shape).length) {
                resolved.diagnostics.push({
                  code: 'XP_DRONE',
                  severity: 'error',
                  message: 'A drone expression must contain at least one note.',
                  locations: [directive.argument.location],
                })
              } else droneTemplate = template.shape
            }
          }
          const shape: ScoreShape =
            directive?.kind === 'unknown'
              ? {
                  kind: 'annotation',
                  text: item.rawName.startsWith('@') ? item.rawName : `@${item.rawName}`,
                  duration: new Fraction(0),
                  origins: [origin(item, 'directive')],
                }
              : directive?.kind === 'dynamic'
                ? {
                    kind: 'dynamic',
                    mark: directive.mark,
                    duration: new Fraction(0),
                    origins: [origin(item, 'directive')],
                  }
                : directive?.kind === 'groove'
                  ? {
                      kind: 'groove',
                      template: grooveTemplate,
                      controlCount: grooveTemplate ? attacks(grooveTemplate).length : undefined,
                      duration: new Fraction(0),
                      origins: [origin(item, 'directive')],
                    }
                  : directive?.kind === 'drone'
                    ? {
                        kind: 'drone',
                        template: droneTemplate,
                        duration: new Fraction(0),
                        origins: [origin(item, 'directive')],
                      }
                    : directive?.kind === 'clef'
                      ? {
                          kind: 'clef',
                          clef: directive.clef,
                          duration: new Fraction(0),
                          origins: [origin(item, 'directive')],
                        }
                      : sequence([], [origin(item, 'directive')])
          results.push({ shape, diagnostics: resolved.diagnostics })
          continue
        }
        let result = activeVisitor.visit(item)
        const index = results.length
        if ('shape' in result && attacks(result.shape).length) {
          if (velocity) {
            let first = true
            const pending = velocity
            const applyVelocity = (shape: ScoreShape): ScoreShape => {
              if (shape.kind === 'attack' && first) {
                first = false
                return {
                  ...shape,
                  velocity: pending,
                  velocityExplicit: true,
                } as PlaybackAttackShape
              }
              if (shape.kind === 'sequence')
                return { ...shape, children: shape.children.map(applyVelocity) }
              if (shape.kind === 'parallel')
                return { ...shape, branches: shape.branches.map(applyVelocity) }
              return shape
            }
            result = { ...result, shape: applyVelocity(result.shape) }
            velocity = undefined
          }
          if (grace) grace.indices.push(index)
          if (gliss) gliss.indices.push(index)
        }
        results.push(result)
        if (grace && grace.indices.length === grace.count + 1) {
          const targetIndex = grace.indices[grace.indices.length - 1]!
          const stolen = grace.duration.mul(grace.count)
          for (const i of grace.indices.slice(0, -1)) {
            const r = results[i]!
            if ('shape' in r)
              results[i] = {
                ...r,
                shape: mapAttacks(resizeShape(r.shape, grace.duration), (attack) => ({
                  ...attack,
                  grace: true,
                })),
              }
          }
          const target = results[targetIndex]!
          if ('shape' in target && target.shape.duration.compare(stolen) >= 0) {
            const notatedDuration = target.shape.duration
            results[targetIndex] = {
              ...target,
              shape: mapAttacks(
                trimShape(target.shape, target.shape.duration.sub(stolen)),
                (attack) => ({ ...attack, notatedDuration }),
              ),
            }
          } else
            results.push({
              diagnostics: [
                {
                  code: 'XP_GRACE_DURATION',
                  severity: 'error',
                  message: 'Grace notes exceed the following item duration.',
                  locations: [item.location],
                },
              ],
            })
          grace = undefined
        }
        if (gliss && gliss.indices.length === 2) {
          const sourceIndex = gliss.indices[0]!,
            targetIndex = gliss.indices[1]!,
            source = results[sourceIndex]!,
            target = results[targetIndex]!
          const sourceShape = gliss.sourceShape ?? ('shape' in source ? source.shape : undefined)
          if (sourceShape && 'shape' in target) {
            const to = attacks(target.shape)
            const sourceTree = pitchTree(sourceShape)
            const targetTree = pitchTree(target.shape)
            if (!sourceTree || !targetTree || !matchingPitchTrees(sourceTree, targetTree))
              results.push({
                diagnostics: [
                  {
                    code: 'XP_GLISS_SHAPE',
                    severity: 'error',
                    message: 'Glissando source and target pitch structures must match.',
                    locations: [item.location],
                  },
                ],
              })
            else {
              const curve = gliss.curve
              const spans = attackSpans(sourceShape)
              const sourceAttacks = attacks(sourceShape)
              let leaf = 0
              const automate = (shape: ScoreShape): ScoreShape => {
                if (shape.kind === 'attack') {
                  const destination = to[leaf++]!
                  const duration = spans.get(shape) ?? shape.duration
                  return {
                    ...shape,
                    automation: {
                      curve,
                      from: shape.pitch,
                      to: destination.pitch,
                      fromRootPitch: shape.rootPitch,
                      toRootPitch: destination.rootPitch,
                      duration,
                      segments: [
                        {
                          curve,
                          from: shape.pitch,
                          to: destination.pitch,
                          fromRootPitch: shape.rootPitch,
                          toRootPitch: destination.rootPitch,
                          start: new Fraction(0),
                          duration,
                        },
                      ],
                    },
                  }
                }
                if (shape.kind === 'sequence')
                  return { ...shape, children: shape.children.map(automate) }
                if (shape.kind === 'parallel')
                  return { ...shape, branches: shape.branches.map(automate) }
                return shape
              }
              // Only the first segment owns an attack. Later segments begin at a target which
              // has already been lowered to a continuation of that original attack.
              if (!gliss.sourceShape && 'shape' in source)
                results[sourceIndex] = { ...source, shape: automate(sourceShape) }
              else if (gliss.ownerIndex !== undefined) {
                const owner = results[gliss.ownerIndex]!
                const segmentStart = gliss.segmentStart
                let attackIndex = 0
                if ('shape' in owner)
                  results[gliss.ownerIndex] = {
                    ...owner,
                    shape: mapAttacks(owner.shape, (attack) => {
                      const segmentSource = sourceAttacks[attackIndex]!
                      const destination = to[attackIndex++]!
                      const duration = spans.get(segmentSource) ?? segmentSource.duration
                      const previous = attack.automation
                      return {
                        ...attack,
                        automation: previous && {
                          ...previous,
                          segments: [
                            ...(previous.segments ?? []),
                            {
                              curve,
                              from: segmentSource.pitch,
                              to: destination.pitch,
                              fromRootPitch: segmentSource.rootPitch,
                              toRootPitch: destination.rootPitch,
                              start: segmentStart ?? previous.duration,
                              duration,
                            },
                          ],
                        },
                      }
                    }),
                  }
              }
              const chainedSource = target.shape
              results[targetIndex] = target.shape.duration.n
                ? {
                    ...target,
                    shape: {
                      kind: 'continue',
                      duration: target.shape.duration,
                      origins: target.shape.origins,
                      extendsAutomation: false,
                    },
                  }
                : { ...target, shape: sequence([], target.shape.origins) }
              gliss = gliss.chainRequested
                ? {
                    indices: [targetIndex],
                    sourceShape: chainedSource,
                    ownerIndex: gliss.ownerIndex ?? sourceIndex,
                    segmentStart: (gliss.segmentStart ?? new Fraction(0)).add(sourceShape.duration),
                    curve: gliss.nextCurve ?? 'linear',
                  }
                : undefined
            }
          }
          if (gliss?.indices.length === 2) gliss = undefined
        }
        activeVisitor = visitorAfter(item, activeVisitor)
      }
      const diagnostics = results.flatMap((result) => result.diagnostics)
      if (grace || gliss)
        diagnostics.push({
          code: 'XP_DIRECTIVE',
          severity: 'error',
          message: 'A one-shot directive is missing required following attacks.',
          locations: [current.location],
        })
      if (!results.every(hasShape)) return { diagnostics }
      return {
        shape: sequence(
          results.map((result) => result.shape),
          [origin(current)],
        ),
        diagnostics,
        lexicalEnvironment: activeVisitor.scope.environment,
      }
    }
    if (current.type === 'Parallel') {
      const results = current.branches.map((branch) =>
        visitor.visit(branch, { subdivisionBase: currentPulse }),
      )
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
    if (current.type === 'Group') {
      const grouped = visitor.visit(current.expression, { subdivisionBase: currentPulse })
      if (!('shape' in grouped)) return grouped
      return {
        ...grouped,
        shape: { ...grouped.shape, isolatedDirectiveScope: true },
      }
    }
    if (current.type === 'NormalizeToSlot') {
      if (!current.expression) {
        return {
          shape: {
            kind: 'rest',
            duration: currentPulse,
            generated: false,
            origins: [origin(current)],
          },
          diagnostics: [],
        }
      }
      const evaluated = visitor.visit(current.expression, { subdivisionBase: currentPulse })
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
      if (
        normalized.kind === 'sequence' &&
        tuplet &&
        tuplet > 1 &&
        !Number.isInteger(Math.log2(tuplet))
      ) {
        return {
          shape: { ...normalized, normalized: true, isolatedDirectiveScope: true, tuplet },
          diagnostics: evaluated.diagnostics,
        }
      }
      return {
        shape:
          normalized.kind === 'sequence'
            ? { ...normalized, normalized: true, isolatedDirectiveScope: true }
            : { ...normalized, isolatedDirectiveScope: true },
        diagnostics: evaluated.diagnostics,
      }
    }
    if (current.type === 'PostfixExpression') {
      const evaluated = visitor.visit(current.expression)
      if (!('shape' in evaluated)) return evaluated
      const elimination = current.marks.find((mark) => mark.type === 'TailElimination')
      let base = evaluated.shape
      if (elimination) {
        const removed = currentPulse.mul(elimination.count)
        if (removed.compare(base.duration) > 0)
          return {
            diagnostics: [
              ...evaluated.diagnostics,
              {
                code: 'XP_TAIL_ELIMINATION',
                severity: 'error',
                message: 'Tail elimination exceeds the score item duration.',
                locations: [elimination.location],
              },
            ],
          }
        base = trimShape(base, base.duration.sub(removed))
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
      try {
        const changed = applyPitchContextChange(current, context)
        return { shape: contextShape(current, changed, context), diagnostics: [] }
      } catch {
        return { shape: contextAnnotation(current), diagnostics: [] }
      }
    }
    const evaluated = playablePitch(current, context, environment)
    if (!('pitch' in evaluated)) return evaluated
    const broadcastContext = current as Expression & {
      readonly broadcastArticulation?: Fraction
    }
    const broadcastArticulation = broadcastContext.broadcastArticulation
    const articulation =
      broadcastArticulation && broadcastArticulation.compare(currentArticulation) > 0
        ? broadcastArticulation
        : currentArticulation
    const shape: PlaybackAttackShape = {
      kind: 'attack',
      pitch: evaluated.pitch,
      duration: currentPulse,
      origins: evaluated.pitch.origins,
      rootPitch: context.rootPitch,
      dynamic: currentDynamic,
      velocity: DYNAMIC_VELOCITIES[currentDynamic],
      articulation,
      directiveState: { ...currentDirectiveState },
      ...(currentArticulationMarks.length ? { articulationMarks: currentArticulationMarks } : {}),
      ...('raw' in current ? { authoredLabel: String(current.raw) } : {}),
      ...(evaluated.justIntonation ? { justIntonation: true } : {}),
      ...(current.type === 'DegreeLiteral' ||
      current.type === 'EqualDivisionLiteral' ||
      (current.type === 'QuantityLiteral' &&
        ['c', '¢', 'hz', 'khz'].includes(current.unit.toLowerCase()))
        ? { displayLabel: String(current.raw) }
        : {}),
    }
    if ('raw' in current) authoredLabels.set(shape, String(current.raw))
    return { shape, diagnostics: evaluated.diagnostics }
  }

  const initialContext = options.pitchContext ?? DEFAULT_PITCH_CONTEXT
  const visitor = new Visitor(evaluateNode, {
    context: initialContext,
    pulse,
    dynamic: 'mf',
    articulation: new Fraction(1),
    articulationMarks: [],
    directiveState: initialDirectiveState,
    environment: options.lexicalEnvironment,
    subdivisionBase: pulse,
  })
  const result = visitor.visit(node)
  if (!('shape' in result)) return result
  return {
    ...result,
    pitchContext: contextAfter(node, visitor),
    directiveState: directiveStateAfter(node, visitor),
    lexicalEnvironment: result.lexicalEnvironment ?? options.lexicalEnvironment,
  }
}
