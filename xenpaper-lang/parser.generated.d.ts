import type { LocationRange, ParserOptions } from "peggy";

export interface Node {
  type: string;
  location: LocationRange;
}

export interface Program extends Node {
  type: "Program";
  source: string;
  body: Expression[];
  comments: Comment[];
}

export interface Comment extends Node {
  type: "Comment";
  value: string;
  raw: string;
}

export type Expression =
  | Barline
  | BinaryExpression
  | CallExpression
  | ContextAssignment
  | ContextExpression
  | ContextNameTarget
  | ContextOperatorTarget
  | ContextPitchTarget
  | ContextPreset
  | DecimalLiteral
  | DegreeLiteral
  | Directive
  | DetachedContinue
  | EqualDivisionLiteral
  | Group
  | HardBoundary
  | Identifier
  | IntegerLiteral
  | IntervalLiteral
  | MappingLiteral
  | NamedArgument
  | NormalizeToSlot
  | Parallel
  | PitchContextChange
  | PitchLiteral
  | PostfixExpression
  | QuantityLiteral
  | RatioLiteral
  | Repeat
  | Rest
  | Sequence
  | TailElimination
  | UnaryExpression;

export interface Barline extends Node {
  type: "Barline";
  raw: "|";
}

export interface BinaryExpression extends Node {
  type: "BinaryExpression";
  operator: string;
  left: Expression;
  right: Expression;
}

export interface CallExpression extends Node {
  type: "CallExpression";
  callee: string;
  arguments: Expression[];
}

export interface ContextAssignment extends Node {
  type: "ContextAssignment";
  target: ContextNameTarget | ContextOperatorTarget | ContextPitchTarget;
  value: Expression;
}

export interface ContextExpression extends Node {
  type: "ContextExpression";
  value: Expression;
}

export interface ContextNameTarget extends Node {
  type: "ContextNameTarget";
  name: string;
}

export interface ContextOperatorTarget extends Node {
  type: "ContextOperatorTarget";
  operator: string;
}

export interface ContextPitchTarget extends Node {
  type: "ContextPitchTarget";
  pitch: PitchLiteral;
}

export interface ContextPreset extends Node {
  type: "ContextPreset";
  kind: string;
  raw: string;
}

export interface DecimalLiteral extends Node {
  type: "DecimalLiteral";
  value: string;
  raw: string;
  sign?: string;
}

export interface DegreeLiteral extends Node {
  type: "DegreeLiteral";
  modifiers: PitchModifier[];
  degree: string;
  raw: string;
}

export interface Directive extends Node {
  type: "Directive";
  name: string;
  rawName: string;
  arguments: Expression[];
  graceCount: number;
}

export interface DetachedContinue extends Node {
  type: "DetachedContinue";
  raw: "=";
  attached?: boolean;
}

export interface EqualDivisionLiteral extends Node {
  type: "EqualDivisionLiteral";
  steps: string;
  divisions: string;
  equave: Expression | null;
  raw: string;
  sign?: string;
}

export interface Group extends Node {
  type: "Group";
  expression: Expression;
}

export interface HardBoundary extends Node {
  type: "HardBoundary";
  raw: "||";
}

export interface Identifier extends Node {
  type: "Identifier";
  name: string;
}

export interface IntegerLiteral extends Node {
  type: "IntegerLiteral";
  value: string;
  raw: string;
  sign?: string;
}

export interface IntervalLiteral extends Node {
  type: "IntervalLiteral";
  modifiers: PitchModifier[];
  quality: string;
  number: string;
  inflections: FjsInflection[];
  raw: string;
}

export interface MappingLiteral extends Node {
  type: "MappingLiteral";
  values: Expression[];
  closingDelimiter: "]" | ">";
}

export interface NamedArgument extends Node {
  type: "NamedArgument";
  name: string;
  value: Expression;
}

export interface NormalizeToSlot extends Node {
  type: "NormalizeToSlot";
  expression: Expression | null;
}

export interface Parallel extends Node {
  type: "Parallel";
  branches: Expression[];
}

export interface PitchContextChange extends Node {
  type: "PitchContextChange";
  statements: Expression[];
}

export interface PostfixExpression extends Node {
  type: "PostfixExpression";
  expression: Expression;
  marks: (DetachedContinue | TailElimination)[];
}

export interface PitchLiteral extends Node {
  type: "PitchLiteral";
  modifiers: PitchModifier[];
  nominal: PitchNominal;
  accidentals: Accidental[];
  inflections: FjsInflection[];
  raw: string;
}

export interface QuantityLiteral extends Node {
  type: "QuantityLiteral";
  sign: string | null;
  magnitude: string;
  unit: string;
  raw: string;
}

export interface RatioLiteral extends Node {
  type: "RatioLiteral";
  numerator: string;
  denominator: string;
  raw: string;
  sign?: string;
}

export interface Repeat extends Node {
  type: "Repeat";
  count: IntegerLiteral;
  body: Expression[];
}

export interface Rest extends Node {
  type: "Rest";
  raw: string;
}

export interface Sequence extends Node {
  type: "Sequence";
  items: Expression[];
}

export interface TailElimination extends Node {
  type: "TailElimination";
  count: number;
  raw: string;
}

export interface UnaryExpression extends Node {
  type: "UnaryExpression";
  operator: string;
  operand: Expression;
}

export interface Accidental extends Node {
  type: "Accidental";
  value: string;
}

export interface FjsInflection extends Node {
  type: "FjsInflection";
  direction: "numerator" | "denominator";
  marker: string;
  prime: string;
  flavor: string;
  raw: string;
}

export interface PitchModifier extends Node {
  type: "PitchModifier";
  kind: string;
  raw: string;
}

export interface PitchNominal extends Node {
  type: "PitchNominal";
  system: "latin" | "mos" | "greek";
  value: string;
}

export declare const StartRules: ["Start"];
export declare function parse(input: string, options?: ParserOptions): Program;
