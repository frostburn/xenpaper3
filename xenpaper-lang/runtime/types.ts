import type { Program } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import type { Value } from '../value'
import type { LocationRange } from 'peggy'
import type { Fraction } from 'xen-dev-utils/fraction'

export interface ExpansionStep {
  readonly repeatOffset: number
  readonly iteration: number
}

export type ExpansionPath = readonly ExpansionStep[]

/** Parser node decorated with the repeat occurrence that produced it. */
export type ExpandedNode = Record<string, unknown> & {
  readonly type: string
  readonly expansionPath: ExpansionPath
}

export interface ExpandedProgram extends Omit<Program, 'body'> {
  readonly body: readonly ExpandedNode[]
  readonly expansionPath: ExpansionPath
}

export interface RepeatExpansionOptions {
  readonly expansionLimit?: number
}

export interface RepeatExpansionResult {
  readonly program?: ExpandedProgram
  readonly diagnostics: readonly Diagnostic[]
}

export interface ScalarValue {
  readonly kind: 'scalar'
  readonly value: Value
  readonly origins: readonly SourceOrigin[]
}

export interface PitchOffsetValue {
  readonly kind: 'pitchOffset'
  readonly value: Value
  readonly origins: readonly SourceOrigin[]
}

export type EvaluatedLiteral = ScalarValue | PitchOffsetValue

export interface SourceOrigin {
  readonly location: LocationRange
  readonly role:
    | 'literal'
    | 'operator'
    | 'duration'
    | 'context'
    | 'directive'
    | 'structural'
    | 'generated'
}

export interface ShapeBase {
  readonly duration: Fraction
  readonly origins: readonly SourceOrigin[]
}

export interface AttackShape extends ShapeBase {
  readonly kind: 'attack'
  readonly pitch: PitchOffsetValue
}

export interface RestShape extends ShapeBase {
  readonly kind: 'rest'
  readonly generated: boolean
}

export interface ContinueShape extends ShapeBase {
  readonly kind: 'continue'
}

export interface SequenceShape extends ShapeBase {
  readonly kind: 'sequence'
  readonly children: readonly ScoreShape[]
}

export interface ParallelShape extends ShapeBase {
  readonly kind: 'parallel'
  readonly branches: readonly ScoreShape[]
}

export type ScoreShape =
  | AttackShape
  | RestShape
  | ContinueShape
  | SequenceShape
  | ParallelShape
