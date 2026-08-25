export * from './core'
export { expandRepeats } from './runtime/repeat-expansion'
export { decimalFraction, evaluateLiteral } from './runtime/literals'
export type { LiteralEvaluationResult, NumericLiteralNode } from './runtime/literals'
export { applyFjsInflections, fjsInflection, fjsPrimeComma } from './runtime/fjs'
export type { FjsFlavor, FjsInflectionInput } from './runtime/fjs'
export {
  DEFAULT_MAPPING,
  DEFAULT_PITCH_CONTEXT,
  applyPitchContextChange,
  createPitchContext,
  edoMapping,
  evaluateIntervalLiteral,
  evaluatePitchLiteral,
  mapFormula,
  scalePitchOffset,
  spellPitchDifference,
} from './runtime/pitches'
export {
  DIRECTIVE_REGISTRY,
  DYNAMIC_VELOCITIES,
  GLISS_CURVES,
  resolveDirective,
} from './runtime/directives'
export { evaluateProgramShape, evaluateScoreShape } from './runtime/score-shape'
export { expandToBeatEvents } from './runtime/beat-events'
export type { BeatEventExpansionOptions, BeatEventExpansionResult } from './runtime/beat-events'
export {
  constructStaffNotation,
  constructStaffNotationShape,
  toStaffPitch,
} from './runtime/staff-notation'
export type { StaffNotationOptions } from './runtime/staff-notation'
export type { ScoreShapeEvaluationResult } from './runtime/score-shape'
export type {
  AttackShape,
  AttackAppearance,
  AbsolutePitchValue,
  AnnotationShape,
  BarlineShape,
  BarlineStyle,
  BeatTimedEvent,
  BeatTimedMarkerEvent,
  BeatTimedNoteEvent,
  BeatTimedScore,
  ContinueShape,
  ClefShape,
  DynamicShape,
  DroneShape,
  GrooveShape,
  DynamicMark,
  PitchAutomation,
  EvaluatedLiteral,
  ExpandedNode,
  ExpandedProgram,
  RepeatExpansionOptions,
  RepeatExpansionResult,
  ScalarValue,
  PitchOffsetValue,
  PitchSpelling,
  IntervalSpelling,
  FjsSpelling,
  PrimeMonzo,
  ParallelShape,
  RestShape,
  ScoreShape,
  SequenceShape,
  ShapeBase,
  StaffPitch,
  StaffClef,
  StaffNotationShape,
  StaffInflection,
  StaffOperatorInflection,
} from './runtime/types'
