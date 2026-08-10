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
  /** Root-relative value retained for notation when `value` includes a sounding root displacement. */
  readonly notationValue?: Value
  readonly formula?: PrimeMonzo
  readonly spelling?: IntervalSpelling
  readonly origins: readonly SourceOrigin[]
}

export interface AbsolutePitchValue {
  readonly kind: 'absolutePitch'
  readonly rootOffset: Value
  readonly formula: PrimeMonzo
  readonly spelling: PitchSpelling
  readonly origins: readonly SourceOrigin[]
}

export type PrimeMonzo = ReadonlyMap<number, Fraction>

export interface IntervalSpelling {
  readonly quality: string
  readonly number: bigint | Fraction
  readonly raw: string
  /** Direction authored by unary negation; an absent value is ascending. */
  readonly direction?: 'ascending' | 'descending'
  readonly inflections?: readonly FjsSpelling[]
  readonly modifiers?: readonly string[]
}

export interface FjsSpelling {
  readonly direction: 'numerator' | 'denominator'
  readonly prime: bigint
  readonly flavor?: string
}

export interface PitchSpelling {
  readonly nominal: string
  readonly raw: string
  /** The spelling was derived by pitch/interval arithmetic rather than written literally. */
  readonly derived?: boolean
  readonly system?: 'latin' | 'greek' | 'mos'
  readonly accidentals?: readonly string[]
  readonly inflections?: readonly FjsSpelling[]
  readonly modifiers?: readonly string[]
}

export interface StaffOperatorInflection {
  readonly kind: 'up' | 'down' | 'lift' | 'drop'
}

export type StaffInflection = FjsSpelling | StaffOperatorInflection

export interface PrimeMapping {
  readonly id: string
  readonly mapPrime: (prime: number) => Value
}

export interface PitchContext {
  readonly mapping: PrimeMapping
  /** Numeric scale-degree step; defaults to one semitone. */
  readonly degreeStep: Value
  /** Displacement applied by each equave modifier on a numeric degree. */
  readonly degreeEquave: Value
  /** Sounding displacement of the current root from the default root frequency. */
  readonly rootDisplacement: Value
  readonly rootFormula: PrimeMonzo
  readonly up: Value
  readonly lift: Value
  /** Diatonic staff steps from middle C occupied by the context root. */
  readonly rootStaffPosition: number
  /** Authored accidental tokens on the active notation root. */
  readonly rootStaffAccidentals: readonly string[]
}

export type EvaluatedLiteral = ScalarValue | PitchOffsetValue | AbsolutePitchValue

/** Renderer-independent description of a note on a treble/bass staff. */
export interface StaffPitch {
  /** Diatonic steps from middle C (C4). */
  readonly staffPosition: number
  /** Normalized written accidentals for the note, in source order. */
  readonly accidentals: readonly string[]
  /** FJS suffixes, such as the `^5` in A^5. */
  readonly inflections?: readonly StaffInflection[]
  /** Greek/interordinal pitches use a triangular head pointing at the other neighbouring line/space. */
  readonly notehead: 'normal' | 'triangle-up' | 'triangle-down' | 'x'
  /** Sounding distance above middle C, retained for positioning refinements by a renderer. */
  readonly cents: number
}

export type StaffNotationShape =
  | {
      readonly kind: 'note'
      readonly pitch: StaffPitch
      readonly duration: Fraction
      readonly displayLabel?: string
      readonly velocity?: Fraction
      readonly velocityExplicit?: boolean
      readonly grace?: boolean
      readonly notatedDuration?: Fraction
    }
  | { readonly kind: 'rest'; readonly duration: Fraction; readonly generated: boolean }
  | { readonly kind: 'continue'; readonly duration: Fraction }
  | { readonly kind: 'barline'; readonly style: BarlineStyle; readonly duration: Fraction }
  | { readonly kind: 'annotation'; readonly text: string; readonly duration: Fraction }
  | { readonly kind: 'dynamic'; readonly mark: DynamicMark; readonly duration: Fraction }
  | {
      readonly kind: 'sequence'
      readonly duration: Fraction
      readonly children: readonly StaffNotationShape[]
      readonly normalized?: boolean
      readonly tuplet?: number
    }
  | {
      readonly kind: 'parallel'
      readonly duration: Fraction
      readonly branches: readonly StaffNotationShape[]
    }

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
  readonly pitch: PitchOffsetValue | (AbsolutePitchValue & { readonly value: Value })
  readonly rootStaffPosition: number
  readonly rootStaffAccidentals: readonly string[]
  readonly dynamic: DynamicMark
  readonly velocity: Fraction
  readonly automation?: PitchAutomation
  /** True when velocity came from an authored one-shot velocity directive. */
  readonly velocityExplicit?: boolean
  /** Grace attacks are engraved small and lead into the following donor note. */
  readonly grace?: boolean
  /** Authored rhythmic value of a grace donor before time was stolen. */
  readonly notatedDuration?: Fraction
  /** Authored pitch expression to show below the staff. */
  readonly displayLabel?: string
  /** Other contexts in which this source attack occurs after repeat expansion. */
  readonly alternateAppearances?: readonly AttackAppearance[]
}

export type DynamicMark = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff'

export interface PitchAutomation {
  readonly curve: 'linear'
  readonly from: AttackShape['pitch']
  readonly to: AttackShape['pitch']
  readonly duration: Fraction
}

export interface AttackAppearance {
  readonly pitch: AttackShape['pitch']
  readonly rootStaffPosition: number
  readonly rootStaffAccidentals: readonly string[]
}

export interface RestShape extends ShapeBase {
  readonly kind: 'rest'
  readonly generated: boolean
}

export interface ContinueShape extends ShapeBase {
  readonly kind: 'continue'
}

export interface BarlineShape extends ShapeBase {
  readonly kind: 'barline'
  readonly style: BarlineStyle
}

export interface AnnotationShape extends ShapeBase {
  readonly kind: 'annotation'
  readonly text: string
}

export interface DynamicShape extends ShapeBase {
  readonly kind: 'dynamic'
  readonly mark: DynamicMark
}

export type BarlineStyle = 'single' | 'double' | 'repeat-start' | 'repeat-end'

export interface SequenceShape extends ShapeBase {
  readonly kind: 'sequence'
  readonly children: readonly ScoreShape[]
  /** Whether the sequence was explicitly normalized into a single rhythmic slot. */
  readonly normalized?: boolean
  /** Number of notes explicitly normalized into a non-binary rhythmic slot. */
  readonly tuplet?: number
}

export interface ParallelShape extends ShapeBase {
  readonly kind: 'parallel'
  readonly branches: readonly ScoreShape[]
}

export type ScoreShape =
  | AttackShape
  | RestShape
  | ContinueShape
  | BarlineShape
  | AnnotationShape
  | DynamicShape
  | SequenceShape
  | ParallelShape

/** A renderer/audio-engine friendly score whose time axis is still exact beats. */
export interface BeatTimedNoteEvent {
  readonly kind: 'note'
  readonly start: Fraction
  readonly duration: Fraction
  readonly pitch: AttackShape['pitch']
  readonly rootStaffPosition: number
  readonly rootStaffAccidentals?: readonly string[]
  /** Effective amplitude from either the prevailing dynamic or a one-shot velocity. */
  readonly dynamic: Fraction
  readonly automation?: PitchAutomation
  readonly label?: string
  readonly origins: readonly SourceOrigin[]
}

export interface BeatTimedMarkerEvent {
  readonly kind: 'marker'
  readonly start: Fraction
  readonly marker: 'barline' | 'annotation' | 'dynamic'
  readonly label: string
  readonly origins: readonly SourceOrigin[]
}

export type BeatTimedEvent = BeatTimedNoteEvent | BeatTimedMarkerEvent

export interface BeatTimedScore {
  readonly duration: Fraction
  readonly events: readonly BeatTimedEvent[]
}
