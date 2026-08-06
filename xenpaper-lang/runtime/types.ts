import type { Program } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'

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

