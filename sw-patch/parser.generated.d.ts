import type { LocationRange } from 'peggy'

export interface Node {
  type: string
  location: LocationRange
}

export interface Program extends Node {
  type: 'Program'
  body: Statement[]
}

export type Statement =
  | FunctionDeclaration
  | UntilStatement
  | ForStatement
  | WhileStatement
  | IfStatement
  | ElifStatement
  | ElseStatement
  | TypeAlias
  | ConfigDeclaration
  | TypedBinding
  | ScheduledStatement
  | ConnectionStatement
  | AssignmentStatement
  | ReturnStatement
  | DocStringStatement
  | CommentStatement
  | ExpressionStatement

export interface FunctionDeclaration extends Node {
  type: 'FunctionDeclaration'
  name: string
  parameters: Parameter[]
  once: boolean
  returned: boolean
  body: Statement[]
}

export interface Parameter extends Node {
  type: 'Parameter'
  name: string
  annotation: TypeExpression
  defaultValue: Expression | null
}

export interface UntilStatement extends Node {
  type: 'UntilStatement'
  emitter: Expression
  event: string
  body: Statement[]
}

export interface ForStatement extends Node {
  type: 'ForStatement'
  target: string
  iterable: Expression
  body: Statement[]
}

export interface WhileStatement extends Node {
  type: 'WhileStatement'
  test: Expression
  body: Statement[]
}

export interface IfStatement extends Node {
  type: 'IfStatement'
  test: Expression
  body: Statement[]
}

export interface ElifStatement extends Node {
  type: 'ElifStatement'
  test: Expression
  body: Statement[]
}

export interface ElseStatement extends Node {
  type: 'ElseStatement'
  body: Statement[]
}

export interface TypeAlias extends Node {
  type: 'TypeAlias'
  name: string
  value: TypeExpression
}

export interface ConfigDeclaration extends Node {
  type: 'ConfigDeclaration'
  name: string
  annotation: TypeExpression | null
  value: Expression
}

export interface TypedBinding extends Node {
  type: 'TypedBinding'
  name: string
  annotation: TypeExpression
  value: Expression
}

export interface ScheduledStatement extends Node {
  type: 'ScheduledStatement'
  at: Expression
  automation: Automation | null
  statement: AssignmentStatement | ConnectionStatement | ExpressionStatement
}

export type Automation =
  | LinearAutomation
  | ExponentialAutomation
  | CancelAutomation
  | HoldAutomation
  | TargetAutomation

export interface LinearAutomation extends Node {
  type: 'LinearAutomation'
}

export interface ExponentialAutomation extends Node {
  type: 'ExponentialAutomation'
}

export interface HoldAutomation extends Node {
  type: 'HoldAutomation'
}

export interface CancelAutomation extends Node {
  type: 'CancelAutomation'
}

export interface TargetAutomation extends Node {
  type: 'TargetAutomation'
  timeConstant: Expression
}

export interface ConnectionStatement extends Node {
  type: 'ConnectionStatement'
  first: Expression
  links: ConnectionLink[]
}

export interface ConnectionLink {
  operator: 'connect' | 'disconnect'
  target: Expression
  output?: number
  input?: number
}

export interface AssignmentStatement extends Node {
  type: 'AssignmentStatement'
  target: Identifier | MemberExpression
  value: Expression
}

export interface ReturnStatement extends Node {
  type: 'ReturnStatement'
  value: Expression
}

export interface DocStringStatement extends Node {
  type: 'DocStringStatement'
  value: string
}

export interface CommentStatement extends Node {
  type: 'CommentStatement'
  value: string
}

export interface ExpressionStatement extends Node {
  type: 'ExpressionStatement'
  expression: Expression
}

export type TypeExpression =
  | UnionType
  | GenericType
  | ObjectType
  | StringLiteralType
  | TypeName

export interface UnionType extends Node {
  type: 'UnionType'
  types: TypeExpression[]
}

export interface GenericType extends Node {
  type: 'GenericType'
  callee: TypeName
  argument: TypeExpression
}

export interface ObjectType extends Node {
  type: 'ObjectType'
  fields: TypeField[]
}

export interface TypeField extends Node {
  type: 'TypeField'
  name: string
  value: TypeExpression
}

export interface StringLiteralType extends Node {
  type: 'StringLiteralType'
  value: string
}

export interface TypeName extends Node {
  type: 'TypeName'
  name: string
}

export type Expression =
  | BinaryExpression
  | UnaryExpression
  | MemberExpression
  | CallExpression
  | UnitLiteral
  | NumberLiteral
  | BooleanLiteral
  | NullLiteral
  | StringLiteral
  | ObjectLiteral
  | ListLiteral
  | Identifier

export interface BinaryExpression extends Node {
  type: 'BinaryExpression'
  operator:
    | 'or'
    | 'and'
    | '<='
    | '>='
    | '=='
    | '!='
    | '<'
    | '>'
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
  left: Expression
  right: Expression
}

export interface UnaryExpression extends Node {
  type: 'UnaryExpression'
  operator: '+' | '-' | '!' | 'not'
  argument: Expression
}

export interface MemberExpression extends Node {
  type: 'MemberExpression'
  object: Expression
  property: string
}

export interface CallExpression extends Node {
  type: 'CallExpression'
  callee: Expression
  arguments: Argument[]
}

export type Argument = NamedArgument | PositionalArgument

export interface NamedArgument extends Node {
  type: 'NamedArgument'
  name: string
  value: Expression
}

export interface PositionalArgument extends Node {
  type: 'PositionalArgument'
  value: Expression
}

export interface ObjectLiteral extends Node {
  type: 'ObjectLiteral'
  entries: ObjectEntry[]
}

export interface ObjectEntry extends Node {
  type: 'ObjectEntry'
  key: string
  value: Expression
}

export interface ListLiteral extends Node {
  type: 'ListLiteral'
  elements: Expression[]
}

export interface UnitLiteral extends Node {
  type: 'UnitLiteral'
  value: string
  unit: string
  spaced: boolean
}

export interface NumberLiteral extends Node {
  type: 'NumberLiteral'
  value: string
}

export interface BooleanLiteral extends Node {
  type: 'BooleanLiteral'
  value: boolean
}

export interface NullLiteral extends Node {
  type: 'NullLiteral'
  value: null
}

export interface StringLiteral extends Node {
  type: 'StringLiteral'
  value: string
}

export interface Identifier extends Node {
  type: 'Identifier'
  name: string
}

export interface ParseOptions {
  grammarSource?: string
  startRule?: 'Start'
  [key: string]: unknown
}

export function parse(input: string, options?: ParseOptions): Program
