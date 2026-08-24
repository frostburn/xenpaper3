import type { PitchLiteral, Program } from '../parser.generated.js'
import type { Diagnostic } from '../diagnostics'
import type { Value } from '../value'
import type { LocationRange } from 'peggy'
import type { Fraction } from 'xen-dev-utils/fraction'

/** Immutable, extension-owned prevailing state, keyed by extension name. */
export type DirectiveExtensionState = Readonly<Record<string, unknown>>

export interface DirectiveExtensionResult {
  readonly state: unknown
  readonly diagnostics?: readonly Diagnostic[]
}

/** A second-party prevailing directive interpreted outside Xenpaper's core vocabulary. */
export interface DirectiveExtension {
  readonly name: string
  readonly initialState?: unknown
  /** Pure state transition; return immutable state so earlier snapshots remain stable. */
  readonly apply: (
    directive: import('../parser.generated.js').Directive,
    context: PitchContext,
    previousState: unknown,
  ) => DirectiveExtensionResult
}

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

export interface ScoreShapeOptions {
  readonly pulse?: import('xen-dev-utils/fraction').FractionValue
  readonly pitchContext?: PitchContext
  readonly directiveExtensions?: readonly DirectiveExtension[]
}

export type ScoreShapeEvaluationResult =
  | { readonly shape: ScoreShape; readonly diagnostics: readonly Diagnostic[] }
  | { readonly diagnostics: readonly Diagnostic[] }

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
  /** This offset was explicitly converted from a positive exact scalar ratio. */
  readonly justIntonation?: boolean
  /** Root-relative value retained for notation when `value` includes a sounding root displacement. */
  readonly notationValue?: Value
  readonly formula?: PrimeMonzo
  readonly spelling?: IntervalSpelling
  /** Authored numeric scale degree, retained so engraving does not infer an interordinal. */
  readonly scaleDegree?: number
  readonly origins: readonly SourceOrigin[]
}

export interface AbsolutePitchValue {
  readonly kind: 'absolutePitch'
  readonly rootOffset: Value
  readonly formula: PrimeMonzo
  readonly spelling: PitchSpelling
  readonly origins: readonly SourceOrigin[]
  /** Diamond-MOS ordinal and configuration retained for named pitch subtraction. */
  readonly mos?: {
    readonly rank: number
    readonly context: MosContext
  }
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
  /** The written decorations came from the active signature rather than this note token. */
  readonly signature?: boolean
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
  /** Equal-division generator, when this mapping is rank-1 equal temperament. */
  readonly equalDivision?: {
    readonly divisions: number
    readonly equave: Value
  }
}

export interface PitchContext {
  readonly mapping: PrimeMapping
  /** Scale degrees. Plain scale declarations initially use the last entry as the equave. */
  readonly degrees: readonly Value[]
  /** Displacement applied when numeric degrees wrap and by each equave modifier. */
  readonly degreeEquave: Value
  /** Sounding displacement of the current root from the default root frequency. */
  readonly rootDisplacement: Value
  /** Absolute frequency used to turn frequency quantities into root-relative notation. */
  readonly rootFrequency: Value
  /** Absolute pitch used as the notation root. */
  readonly rootPitch: AbsolutePitchValue
  readonly up: Value
  readonly lift: Value
  /** Defaults applied to otherwise unaltered written pitch nominals. */
  readonly signature?: ReadonlyMap<string, PitchLiteral>
  /** Active Diamond-MOS notation, installed by a MOS declaration. */
  readonly mos?: MosContext
}

export interface MosDegree {
  readonly center: Value
  readonly imperfect: boolean
  readonly mid?: Value
}

export interface MosContext {
  readonly pattern: string
  readonly equave: Value
  readonly period: Value
  readonly large: Value
  readonly small: Value
  /** A single step of the equal temperament hosting this MOS, when one exists. */
  readonly hostStep?: Value
  readonly up?: Value
  readonly lift?: Value
  readonly nominals: ReadonlyMap<string, Value>
  readonly degrees: readonly MosDegree[]
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
  /** Diamond-MOS information used to replace the conventional clef and staff guides. */
  readonly diamondMos?: {
    readonly rank: number
    readonly pattern: string
  }
}

/** A change of the notation reference shown at an exact position in the score. */
export type StaffClef =
  | { readonly kind: 'treble' }
  | { readonly kind: 'bass' }
  | { readonly kind: 'diamond-mos'; readonly pattern: string }

export type StaffNotationShape =
  | {
      readonly kind: 'note'
      readonly pitch: StaffPitch
      readonly duration: Fraction
      readonly displayLabel?: string
      readonly justIntonation?: boolean
      readonly grace?: boolean
      readonly notatedDuration?: Fraction
      readonly articulationMarks?: readonly string[]
      /** Engraved glissando segments owned by this sounding note. */
      readonly glissandi?: readonly {
        readonly start: Fraction
        readonly duration: Fraction
        readonly from: StaffPitch
        readonly to: StaffPitch
      }[]
    }
  | { readonly kind: 'rest'; readonly duration: Fraction; readonly generated: boolean }
  | {
      readonly kind: 'continue'
      readonly duration: Fraction
      /** False for a glissando target whose time must not lengthen the source notehead. */
      readonly extendsAutomation?: boolean
    }
  | {
      readonly kind: 'barline'
      readonly style: BarlineStyle
      readonly duration: Fraction
      readonly endingNumber?: number
    }
  | { readonly kind: 'annotation'; readonly text: string; readonly duration: Fraction }
  | {
      readonly kind: 'swing'
      readonly straightDurations: readonly Fraction[]
      readonly grooveDurations: readonly Fraction[]
      readonly tuplet?: number
      readonly duration: Fraction
    }
  | { readonly kind: 'dynamic'; readonly mark: DynamicMark; readonly duration: Fraction }
  | { readonly kind: 'clef'; readonly clef: StaffClef; readonly duration: Fraction }
  | {
      readonly kind: 'key-signature'
      readonly pitches: readonly StaffPitch[]
      readonly duration: Fraction
    }
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
  /** Directive state within this shape does not escape to its parent scope. */
  readonly isolatedDirectiveScope?: boolean
}

export interface AttackShape extends ShapeBase {
  readonly kind: 'attack'
  readonly pitch: PitchOffsetValue | (AbsolutePitchValue & { readonly value: Value })
  readonly rootPitch: AbsolutePitchValue
  readonly automation?: PitchAutomation
  /** Grace attacks are engraved small and lead into the following donor note. */
  readonly grace?: boolean
  /** Authored rhythmic value of a grace donor before time was stolen. */
  readonly notatedDuration?: Fraction
  /** Authored pitch expression to show below the staff. */
  readonly displayLabel?: string
  /** Authored pitch expression retained for non-notation renderers such as piano rolls. */
  readonly authoredLabel?: string
  /** An exact ratio sounding without the active prime mapping. */
  readonly justIntonation?: boolean
  /** Sounding duration as a proportion of the occupied rhythmic duration. */
  readonly articulation?: Fraction
  /** Shorthand marks retained for staff engraving. */
  readonly articulationMarks?: readonly string[]
  /** Extension-owned prevailing state captured at this attack. */
  readonly directiveState: DirectiveExtensionState
  /** Other contexts in which this source attack occurs after repeat expansion. */
  readonly alternateAppearances?: readonly AttackAppearance[]
}

export type DynamicMark = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff'

export interface PitchAutomation {
  readonly curve: string
  readonly from: AttackShape['pitch']
  readonly to: AttackShape['pitch']
  /** Notation context of the source and destination pitches. */
  readonly fromRootPitch?: AbsolutePitchValue
  readonly toRootPitch?: AbsolutePitchValue
  readonly duration: Fraction
  /** Consecutive glides, including this automation's first segment. */
  readonly segments?: readonly PitchAutomationSegment[]
}

export interface PitchAutomationSegment {
  readonly curve: string
  readonly from: AttackShape['pitch']
  readonly to: AttackShape['pitch']
  /** Notation context at each endpoint, which may change during the glide. */
  readonly fromRootPitch?: AbsolutePitchValue
  readonly toRootPitch?: AbsolutePitchValue
  /** Offset from the beginning of the owning attack. */
  readonly start: Fraction
  readonly duration: Fraction
}

export interface AttackAppearance {
  readonly pitch: AttackShape['pitch']
  readonly rootPitch: AbsolutePitchValue
}

export interface RestShape extends ShapeBase {
  readonly kind: 'rest'
  readonly generated: boolean
}

export interface ContinueShape extends ShapeBase {
  readonly kind: 'continue'
  /** Whether this continuation also stretches pitch automation on the active attack. */
  readonly extendsAutomation?: boolean
}

export interface BarlineShape extends ShapeBase {
  readonly kind: 'barline'
  readonly style: BarlineStyle
  readonly endingNumber?: number
}

export interface AnnotationShape extends ShapeBase {
  readonly kind: 'annotation'
  readonly text: string
}

export interface DynamicShape extends ShapeBase {
  readonly kind: 'dynamic'
  readonly mark: DynamicMark
}

export interface ClefShape extends ShapeBase {
  readonly kind: 'clef'
  readonly clef: StaffClef
}

export interface KeySignatureShape extends ShapeBase {
  readonly kind: 'key-signature'
  readonly pitches: readonly AbsolutePitchValue[]
}

/** A playback timing cycle. The authored template is retained so staff notation can
 * show the swing equivalence without applying it to engraved note positions. */
export interface GrooveShape extends ShapeBase {
  readonly kind: 'groove'
  readonly template?: ScoreShape
  readonly controlCount?: number
}

/** Starts or stops notes which sustain independently of the rhythmic score. */
export interface DroneShape extends ShapeBase {
  readonly kind: 'drone'
  readonly template?: ScoreShape
}

export type BarlineStyle =
  | 'single'
  | 'double'
  | 'repeat-start'
  | 'repeat-end'
  | 'ending-start'
  | 'ending-end'

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
  | ClefShape
  | KeySignatureShape
  | GrooveShape
  | DroneShape
  | SequenceShape
  | ParallelShape

/** A renderer/audio-engine friendly score whose time axis is still exact beats. */
export interface BeatTimedNoteEvent {
  readonly kind: 'note'
  readonly start: Fraction
  readonly duration: Fraction
  readonly pitch: AttackShape['pitch']
  readonly rootPitch?: AbsolutePitchValue
  /** Effective amplitude from either the prevailing dynamic or a one-shot velocity. */
  readonly dynamic: Fraction
  /** Extension-owned prevailing state captured at this note's attack. */
  readonly directiveState: DirectiveExtensionState
  readonly automation?: PitchAutomation
  /** Faithful authored pitch expression, when one exists. */
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
