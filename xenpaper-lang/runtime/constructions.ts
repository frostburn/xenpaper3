import { Fraction } from 'xen-dev-utils/fraction'
import type { Expression } from '../parser.js'
import type { PitchContext, LexicalEnvironment } from './types'
import { resolveDirective } from './directives'

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
      item.type === 'BarRest' ||
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
  if (node.type === 'BinaryExpression' && node.operator === '->') {
    return { ...node, left: mapItem(node.left), right: mapItem(node.right) }
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
    'BarRest',
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

export function broadcastScalarOperation(
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
  if (node.type !== 'BinaryExpression' || node.operator === '->') return undefined
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
