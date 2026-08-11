import type { LocationRange } from 'peggy'

export type DiagnosticSeverity = 'error' | 'warning'

export interface Diagnostic {
  readonly code: string
  readonly severity: DiagnosticSeverity
  readonly message: string
  readonly locations: readonly LocationRange[]
}
