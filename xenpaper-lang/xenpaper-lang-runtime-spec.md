# Xenpaper 3 `xenpaper-lang` runtime implementation specification

**Status:** Codex implementation handoff  
**Pseudo-package:** `xenpaper-lang`  
**Authoritative syntax:** the current `xenpaper.peggy` file  
**Authoritative numeric core:** the current `value.ts` file

This document specifies the first working runtime that sits after the existing Peggy parser. It deliberately narrows the broader Xenpaper 3 design into a concrete, testable implementation target.

The required result is a compiler from Xenpaper source text to an exact, beat-domain structural score with source provenance, evaluated pitches, directives, repeats, parallel lanes, and diagnostics. Arranger placement, tempo-to-seconds conversion, Web Audio scheduling, engraving, and visualization are consumers of this result and are not part of this implementation task.

Normative words **must**, **should**, and **may** are used literally.

User note: This doc has been hallucinated by Sol (High). I've fixed some of of the confusion but machine and human errors likely remain. If the reality of software development gets in the way, use common sense and produce naturally flowing code and constructs instead of implementing this spec to a tee.
P.S. TL;mostly DR

---

## 1. Existing code is authoritative

### 1.1 Peggy grammar

Do not add a separate lexer or tokenization pass. Peggy parses the source character stream directly.

The grammar intentionally emits an untyped syntax tree. The runtime, not the parser, is responsible for:

- ratio-to-pitch coercion;
- type-directed arithmetic;
- pitch-context flow;
- directive scope;
- exact duration and score construction.
- repeat expansion;

Try to avoid redesigning the grammar while implementing the runtime but fixes are probably inevitable for something designed in a vacuum. Just make sure to add tests for any new behavior.

### 1.2 `Value`

Use the existing exported `Value` and `Dimensions` classes. Do not replace them with another numeric hierarchy.

The runtime may import `Fraction`, `FractionValue`, and `primeFactorize` from the already-used `xen-dev-utils` package. It must not add another runtime dependency or a computer-algebra package.

The runtime should treat these `Value` operations as the numeric contract:

```ts
new Value(value)
Value.real(value, dimensions)
Value.cents(value)
Value.decibels(value)
Value.beats(value)
Value.seconds(value)
Value.hertz(value)
Value.pitch(ratio)
Value.ratio(pitchOffset)
Value.equalDivision(steps, divisions, equave?)

value.add(other)
value.sub(other)
value.neg()
value.mul(other)
value.div(other)
value.pow(other)
value.equals(other)
value.strictEquals(other)
value.approximatelyEquals(other, tolerance)
value.compare(other)
value.exactRational()
value.valueOf()
```

`Value.equals()` is exact where the representation is exact. Never implement musical equality by epsilon comparison.

### 1.3 Small value-layer extension permitted

Pitch-context mapping needs access to exact prime exponents. Prefer keeping an independent `PrimeMonzo` in the language evaluator rather than reaching through `Value.magnitude`.

A pitch expression should therefore carry both:

1. an exact untempered prime formula used by the tuning mapper; and
2. its mapped `Value` pitch displacement.

No change to `Value` is required for the first runtime. If implementation pressure requires an accessor, add only a read-only API such as `exactPrimeExponents()`; do not expose mutable internal maps.

---

## 2. Required deliverables

Implement or update these modules, adapting names to the existing repository layout:

```text
xenpaper-lang/
  xenpaper-lang-runtime-spec.md    this document
  xenpaper.peggy              existing grammar
  parser.generated.js         generated from xenpaper.peggy
  parser.generated.d.ts       TypeScript declarations for parser output
  diagnostics.ts
  compile.ts                  public compiler entry points
  runtime/
    types.ts
    repeat-expansion.ts
    pitch-formula.ts
    pitch-context.ts
    literals.ts
    expressions.ts
    directives.ts
    score-shape.ts
    flatten.ts
    validate.ts
  value.ts                    existing numeric implementation
  index.ts

xenpaper-lang/__test__/
  parser.spec.ts
  values.spec.ts
  pitch-context.spec.ts
  score-runtime.spec.ts
  repeats.spec.ts
  directives.spec.ts
```

No new runtime dependencies.

The implementation must be usable without the UI, arranger, audio engine, or notation renderer.

---

## 3. Public API

Export at least:

```ts
export function parse(source: string): Program

export function compile(
  source: string,
  options?: CompileOptions,
): CompileResult

export function compileOrThrow(
  source: string,
  options?: CompileOptions,
): StructuralScore
```

Suggested contracts:

```ts
export interface CompileOptions {
  readonly initialContext?: Partial<PitchContextInput>
  readonly strict?: boolean
}

export interface CompileResult {
  readonly source: string
  readonly program?: Program
  readonly expandedProgram?: ExpandedProgram
  readonly score?: StructuralScore
  readonly diagnostics: readonly Diagnostic[]
}
```

Behavior:

- `parse()` may throw the parser's syntax error.
- `compile()` must convert parser exceptions into diagnostics and return without throwing for ordinary source errors.
- `compileOrThrow()` must throw `CompileError` if any error diagnostic exists.
- Warnings do not prevent score production.
- A failed subtree should produce an error value or error shape so later independent material can still be compiled where practical.

---

## 4. Parser AST contract

Create TypeScript declarations matching the grammar. Do not introduce an unrelated replacement AST before the runtime is working.

Every parser node has:

```ts
export interface SourcePosition {
  readonly offset: number
  readonly line: number
  readonly column: number
}

export interface SourceLocation {
  readonly start: SourcePosition
  readonly end: SourcePosition
}

export interface BaseNode {
  readonly type: string
  readonly location: SourceLocation
}
```

The grammar currently emits the following node families.

### 4.1 Document and score structure

```ts
interface Program extends BaseNode {
  readonly type: 'Program'
  readonly source: string
  readonly body: readonly ProgramItem[]
  readonly comments: readonly CommentNode[]
}

type ProgramItem = ExpressionNode | HardBoundaryNode

interface SequenceNode extends BaseNode {
  readonly type: 'Sequence'
  readonly items: readonly ExpressionNode[]
}

interface ParallelNode extends BaseNode {
  readonly type: 'Parallel'
  readonly branches: readonly ExpressionNode[]
}

interface GroupNode extends BaseNode {
  readonly type: 'Group'
  readonly expression: ExpressionNode
}

interface NormalizeToSlotNode extends BaseNode {
  readonly type: 'NormalizeToSlot'
  readonly expression: ExpressionNode | null
}
```

### 4.2 Operators and postfix marks

```ts
interface UnaryExpressionNode extends BaseNode {
  readonly type: 'UnaryExpression'
  readonly operator: string
  readonly operand: ExpressionNode
}

interface BinaryExpressionNode extends BaseNode {
  readonly type: 'BinaryExpression'
  readonly operator: '+' | '-' | '*' | '/' | 'div' | 'mod' | '^'
  readonly left: ExpressionNode
  readonly right: ExpressionNode
}

interface PostfixExpressionNode extends BaseNode {
  readonly type: 'PostfixExpression'
  readonly expression: ExpressionNode
  readonly marks: readonly (DetachedContinueNode | TailEliminationNode)[]
}

interface DetachedContinueNode extends BaseNode {
  readonly type: 'DetachedContinue'
  readonly raw: '='
  readonly attached?: boolean
}

interface TailEliminationNode extends BaseNode {
  readonly type: 'TailElimination'
  readonly count: number
  readonly raw: string
}
```

Attached and detached `=` have distinct syntax nodes but identical duration semantics after lowering: each contributes one current pulse of continuation.

### 4.3 Structural nodes

```ts
interface RestNode extends BaseNode {
  readonly type: 'Rest'
}

interface BarlineNode extends BaseNode {
  readonly type: 'Barline'
}

interface HardBoundaryNode extends BaseNode {
  readonly type: 'HardBoundary'
}

interface RepeatNode extends BaseNode {
  readonly type: 'Repeat'
  readonly count: IntegerLiteralNode
  readonly body: readonly ProgramItem[]
}
```

### 4.4 Directives

```ts
interface DirectiveNode extends BaseNode {
  readonly type: 'Directive'
  readonly name: string
  readonly rawName: string
  readonly arguments: readonly (ExpressionNode | NamedArgumentNode)[]
  readonly graceCount: number
}

interface NamedArgumentNode extends BaseNode {
  readonly type: 'NamedArgument'
  readonly name: string
  readonly value: ExpressionNode
}
```

The numeric spellings `@4`, `@1/8`, and `@4??` are already lowered by the parser to `Directive { name: 'subdivision', ... }`.

### 4.5 Pitch-context nodes

```ts
interface PitchContextChangeNode extends BaseNode {
  readonly type: 'PitchContextChange'
  readonly statements: readonly ContextStatementNode[]
}

type ContextStatementNode =
  | ContextAssignmentNode
  | ContextPresetNode
  | ContextExpressionNode

interface ContextAssignmentNode extends BaseNode {
  readonly type: 'ContextAssignment'
  readonly target:
    | ContextOperatorTargetNode
    | ContextPitchTargetNode
    | ContextNameTargetNode
  readonly value: ExpressionNode | MappingLiteralNode
}

interface ContextPresetNode extends BaseNode {
  readonly type: 'ContextPreset'
  readonly kind: 'rank1' | 'b-val' | 'equalDivision'
  readonly raw: string
}

interface ContextExpressionNode extends BaseNode {
  readonly type: 'ContextExpression'
  readonly value: ExpressionNode
}
```

### 4.6 Literal and call nodes

Declare the fields emitted by the grammar for:

```text
Identifier
CallExpression
IntervalLiteral
PitchLiteral
PitchNominal
PitchModifier
Accidental
FjsInflection
DegreeLiteral
EqualDivisionLiteral
QuantityLiteral
RatioLiteral
DecimalLiteral
IntegerLiteral
MappingLiteral
Comment
```

Keep all parser strings as strings until the literal-evaluation pass. This avoids accidental IEEE-754 conversion before `Fraction` construction.

---

## 5. Compiler passes

The compiler must run these passes in order.

```text
source
  -> Peggy parse
  -> repeat macro expansion
  -> context/type/directive evaluation into exact score shapes
  -> score-shape normalization
  -> flattening into structural lanes
  -> validation and diagnostics
  -> StructuralScore
```

User note: Repeat macro expansion will likely have to be moved to different spot so that staff notation can display repeats unexpanded.

### Pass 1: parse

Use the generated Peggy parser as-is. Preserve the parser node locations and the top-level source string.

### Pass 2: repeat macro expansion

Expand every `Repeat` before pitch-context evaluation.

This order is mandatory. A repeat body may change `root`, and the resulting context must feed the next iteration. This is how comma-pump examples drift in a temperament that does not temper out the comma.

Expansion rules:

- omitted count is already represented as integer `2`;
- count must be an exact non-negative integer;
- nested repeats expand recursively;
- an iteration does not introduce a context scope;
- context changes in one iteration flow into the next iteration and then into following source after the repeat;
- the expanded nodes retain the original source locations;
- each expanded occurrence receives an `ExpansionPath`, for example `[repeatId, iteration, nestedRepeatId, iteration]`;
- source selection therefore maps one written node to many expanded occurrences;
- enforce a configurable expansion limit, default `100_000` emitted nodes, and diagnose overflow.

Do not implement alternate endings, Segno, Coda, D.C., or D.S. in this runtime.

### Pass 3: semantic evaluation

Walk source order with immutable snapshots of:

- pitch context;
- rhythmic/directive state;
- pending next-event directives.

This pass creates exact `ScoreShape` values and typed scalar/pitch values.

### Pass 4: shape normalization

Apply:

- attached continuation marks;
- tail elimination;
- square-bracket normalization;
- pitch arithmetic broadcasting;
- max-duration parallel composition;
- grace-note stealing;
- glissando transformation.

### Pass 5: flattening

Convert score-shape trees to exact lanes and events while preserving provenance and structural IDs.

### Pass 6: validation

Run boundary, continuation, dimension, shape, and directive checks that require a complete score.

---

## 6. Exact runtime values

### 6.1 Runtime semantic categories

Do not use dimensions alone to distinguish musical meaning. Use tagged wrappers:

```ts
export type EvaluatedValue =
  | ScalarValue
  | PitchOffsetValue
  | AbsolutePitchValue
  | DegreeValue
  | MappingValue

export interface ScalarValue {
  readonly kind: 'scalar'
  readonly value: Value
  readonly origins: readonly SourceOrigin[]
}

export interface PitchOffsetValue {
  readonly kind: 'pitchOffset'
  readonly value: Value              // dimensions { pitch: 1 }
  readonly formula?: PrimeMonzo       // untempered exact formula when known
  readonly spelling: IntervalSpelling
  readonly origins: readonly SourceOrigin[]
}

export interface AbsolutePitchValue {
  readonly kind: 'absolutePitch'
  readonly frequency: Value          // dimensions { seconds: -1 }
  readonly rootOffset: Value          // mapped pitch displacement from current root
  readonly spelling: PitchSpelling
  readonly origins: readonly SourceOrigin[]
}

export interface DegreeValue {
  readonly kind: 'degree'
  readonly degree: bigint
  readonly modifiers: readonly PitchModifierNode[]
  readonly origins: readonly SourceOrigin[]
}
```

`PrimeMonzo` is a sparse map from prime to rational exponent:

```ts
export type PrimeMonzo = ReadonlyMap<number, Fraction>
```

It is not a second public numeric system. It is a compact exact pitch formula used by the tuning mapper and spelling code.

### 6.2 Unit literals

Evaluate units as follows:

| Source unit | Runtime value |
|---|---|
| `c` | `Value.cents(magnitude)` |
| `dB` | `Value.decibels(magnitude)` |
| `beat`, `beats` | `Value.beats(magnitude)` |
| `s` | `Value.seconds(magnitude)` |
| `ms` | `Value.seconds(magnitude / 1000)` |
| `Hz` | `Value.hertz(magnitude)` |
| `kHz` | `Value.hertz(magnitude * 1000)` |
| `%` | exact dimensionless `magnitude / 100` |

Units are case-sensitive where the grammar is case-sensitive. Follow the parsed unit spelling rather than reparsing source text.

### 6.3 Numeric literals

- `IntegerLiteral`, `DecimalLiteral`, and `RatioLiteral` must become exact `Fraction` values before constructing `Value`.
- A decimal spelling such as `1.95` becomes `195/100`, reduced exactly.
- A ratio denominator of zero is an error diagnostic.
- `EqualDivisionLiteral p\q<e>` becomes `Value.equalDivision(p, q, e)` after the equave is evaluated as a positive dimensionless ratio.
- The default equal-division equave is `2`.

### 6.4 General arithmetic

Scalar arithmetic delegates to `Value` where possible.

| Operator | Semantics |
|---|---|
| `+` | typed addition |
| `-` | typed subtraction |
| `*` | typed multiplication or scalar action on pitch displacement |
| `/`, `div` | typed division |
| `mod` | exact rational modulo only |
| `^` | exponentiation; exponent must be dimensionless |

`mod` requires both operands to be dimensionless exact rationals. Define:

```text
a mod b = a - floor(a / b) * b
```

with a nonzero divisor and a result having the divisor's sign convention documented by tests. Use the Euclidean non-negative result when `b > 0`.

### 6.5 Pitch coercions

Use explicit internal coercion nodes even though the source syntax is implicit.

Rules:

- a ratio used alone in score position becomes a root-relative pitch offset through the active prime mapping;
- a named interval used alone in score position sounds relative to the root;
- cents and equal-division values used alone in score position sound relative to the root;
- a frequency used alone in score position is already an absolute pitch;
- `AbsolutePitch + PitchOffset -> AbsolutePitch`;
- `AbsolutePitch - PitchOffset -> AbsolutePitch`;
- `AbsolutePitch - AbsolutePitch -> PitchOffset`;
- `PitchOffset + PitchOffset -> PitchOffset`;
- `PitchOffset - PitchOffset -> PitchOffset`;
- `rational scalar * PitchOffset -> PitchOffset`;
- `PitchOffset / rational scalar -> PitchOffset`;
- adding two absolute pitches is an error;
- multiplying two pitch offsets is an error;
- a ratio mixed with a pitch offset is coerced through the active prime mapping before the operation;
- a bare scale degree is not admitted into arithmetic. Use a future explicit `degree()` call for that purpose.

Calls supported initially:

```xenpaper
pitch(ratio)   # untempered explicit ratio -> pitch displacement
ratio(offset)  # pitch displacement -> dimensionless positive ratio
degree(n)      # explicit scale lookup, optional but recommended
```

Unknown calls are errors, not JavaScript invocation.

---

## 7. Pitch formulas, spellings, and tuning

### 7.1 Default root

The default root frequency is exact MIDI C4 under A4 = 440 Hz:

```ts
const defaultRoot = Value.hertz(440).mul(
  new Value(2).pow(new Value(-3n, 4n)),
)
```

Nominal `C` has zero mapped displacement from this root.

### 7.2 Untempered default mapping

The default prime mapping is identity in pitch space:

```ts
mapPrime(p) = Value.pitch(new Value(BigInt(p)))
```

The default numeric-degree scale is 12 equal divisions of `2/1`. This default is only for making degree literals immediately usable; Latin nominals remain Pythagorean, not 12-EDO approximations, until a tempering preset is selected.

Default operator offsets:

```text
up   = 1\12
lift = 0c
```

`down` is the negative of `up`; `drop` is the negative of `lift`.

### 7.3 Pythagorean Latin nominals

Use these untempered ratios relative to `C`:

| Nominal | Ratio |
|---|---:|
| `C` | `1/1` |
| `D` | `9/8` |
| `E` | `81/64` |
| `F` | `4/3` |
| `G` | `3/2` |
| `A` | `27/16` |
| `B` | `243/128` |
| `c` | `2/1` times the corresponding uppercase nominal |

Other lowercase Latin nominals are one Pythagorean octave above uppercase. Prefix equave shifts on Latin nominals add powers of prime 2 to the untempered formula before the active mapping is applied.

### 7.4 Named intervals

Implement arbitrary positive interval numbers with Pythagorean quality.

Diatonic classes `1`, `4`, and `5` are perfect-class. Classes `2`, `3`, `6`, and `7` are major-class.

For the simple major/perfect forms, use the same Pythagorean formulas as the corresponding C-based nominal. Compound intervals add powers of `2`.

Quality changes are Pythagorean chromatic shifts:

```text
one augmented step  = 2187/2048 = 3^7 / 2^11
one diminished step = inverse
```

For perfect-class intervals:

```text
P  -> 0 chromatic shifts
A  -> +1 per A
 d -> -1 per d
```

For major-class intervals:

```text
M  -> 0
m  -> -1
d  -> -2 for one d, then one additional negative shift per extra d
A  -> +1 per A
```

Reject invalid quality/class combinations with a diagnostic.

### 7.5 Pythagorean accidentals

Required initial semantics:

| Spellings | Formula |
|---|---|
| `#`, `♯` | one positive Pythagorean chromatic shift |
| `b`, `♭` | one negative shift |
| `x`, `𝄪` | two positive shifts |
| `𝄫` | two negative shifts |
| `♮`, `_` | natural/no additional shift |

The grammar accepts additional historical accidental glyphs. Until their mappings are defined, emit `XP_UNSUPPORTED_ACCIDENTAL` and do not invent a value.

Accidentals are applied before FJS inflections. Thus `Eb_5` is valid and `E_5b` is not parsed as the same pitch.

### 7.6 FJS inflections

For an odd prime `p`, define its FJS comma deterministically as the nearest-to-unison 3-limit ratio divided by `p`:

```text
comma(p) = 2^a * 3^b / p
```

Choose integers `a` and `b` that minimize:

```text
abs(log2(2^a * 3^b / p))
```

Implementation algorithm:

1. Search integer `b` in `[-64, 64]`.
2. For each `b`, set `a = round(log2(p) - b * log2(3))`.
3. Pick the candidate with smallest absolute log distance.
4. Break ties by smaller `abs(b)`, then smaller `b`.
5. Cache the resulting exact monzo.

This produces at least:

```text
comma(5) = 81/80
comma(7) = 64/63
```

Apply inflections to the untempered formula:

- `^p` means the prime occurs in the numerator: multiply by `1 / comma(p)`;
- `_p` and postfix `vp` mean the prime occurs in the denominator: multiply by `comma(p)`.

Examples in the untempered context:

```text
E^5  = 5/4
Eb_5 = 6/5
P1_5 = 81/80
```

The resulting prime formula is then passed through the active mapping, so a temperament may temper the comma out.

### 7.7 Pitch modifiers

Pitch prefix order is irrelevant. Sum all modifiers by kind before evaluation.

```text
'   equave up by one
"   equave up by two
`   equave down by one
^   add current up offset
v   subtract current up offset
/   add current lift offset
\   subtract current lift offset
```

For Latin nominal pitches, apostrophe/quote/grave modify the prime-2 exponent before mapping.

For MOS/Greek nominals, degrees, ratios, and equal-division literals, equave modifiers add or subtract the active degree-scale equave displacement.

### 7.8 Pitch result

```ts
export interface EvaluatedPitch {
  readonly frequency: Value
  readonly rootOffset: Value
  readonly formula?: PrimeMonzo
  readonly spelling: PitchSpelling
  readonly derivation: PitchDerivation
  readonly origins: readonly SourceOrigin[]
}
```

The audio backend may later project `frequency` to cents detuning from 440 Hz. The runtime must not store cents-from-440 as the canonical pitch.

---

## 8. Pitch context

```ts
export interface PitchContext {
  readonly rootFrequency: Value
  readonly mapping: PrimeMapping
  readonly degreeScale: DegreeScale
  readonly up: Value
  readonly lift: Value
  readonly bindings: ReadonlyMap<string, EvaluatedValue>
}

export interface PrimeMapping {
  readonly id: string
  readonly mapPrime: (prime: number) => Value
}

export interface DegreeScale {
  readonly divisions: Fraction
  readonly equaveRatio: Value
  readonly step: Value
}
```

Contexts are immutable snapshots. Context statements produce a new snapshot.

### 8.1 Scope and state flow

- At top level and in an ordinary sequence, a context change affects following items.
- A `HardBoundary` does not reset context.
- Parenthesized groups and normalized square-bracket groups receive the incoming context and restore it on exit.
- Each parallel branch receives the same incoming context and evaluates independently.
- No context change inside a parallel branch escapes that branch or the parallel expression.
- A repeat is expanded before context evaluation and does not introduce scope. Context changes flow across repeat iterations and out of the repeat.

The parallel rule is necessary because max-duration parallel composition is commutative and cannot select one branch as the state authority.

### 8.2 Rank-1 presets

#### `{Nedo}` and `{Np}`

For positive integer `N`:

```text
equave = 2
step = 1\N<2>
mapPrime(p) = round(N * log2(p)) * step
numeric degree d = d * step
up = step
```

`p` is initially synonymous with `edo`.

#### `{bN}`

```text
equave = 3
step = 1\N<3>
mapPrime(p) = round(N * log base 3 of p) * step
numeric degree d = d * step
up = step
```

#### `{NedR}`

For positive ratio `R`:

```text
equave = R
step = 1\N<R>
mapPrime(p) = round(N * log base R of p) * step
numeric degree d = d * step
up = step
```

#### `{Nc}`

The grammar accepts this spelling, but its val-selection meaning is not yet sufficiently specified. Emit `XP_UNSUPPORTED_PRESET` for the first runtime. Do not silently treat it as `{Nedo}`.

### 8.3 Explicit map

```xenpaper
{map = <24\24 38\24 56\24 67\24 83\24]}
```

Map entries correspond in order to ascending primes:

```text
2, 3, 5, 7, 11, 13, 17, ...
```

Every entry must evaluate to a pitch displacement. A referenced prime missing from an explicit finite map is an error.

The `]` and `>` closing spellings have identical runtime meaning.

### 8.4 Named assignments

Required names:

- `root`: assign an absolute frequency or absolute pitch;
- `map`: assign a `MappingLiteral`;
- other identifiers: create/update a context binding usable by following context expressions.

`root` is exposed as an `AbsolutePitchValue` at the current root frequency.

### 8.5 Operator assignments

```xenpaper
{^ = 1\24}
{/ = 5\24}
```

The right side must be a pitch displacement.

- assigning `^` sets `up`;
- assigning `v` sets `up` to the negation of the supplied displacement;
- assigning `/` sets `lift`;
- assigning `\` sets `lift` to the negation of the supplied displacement.

This keeps up/down and lift/drop paired inverses.

### 8.6 Pitch-target anchoring

A context assignment target may be a pitch spelling:

```xenpaper
{`A = root}
```

Evaluate the target's mapped displacement `d` from the current root and the right side's absolute frequency `f`. Set the new root frequency to:

```text
f / ratio(d)
```

Afterward the target spelling sounds at `f`.

This is distinct from:

```xenpaper
{root = `Av5}
```

which evaluates the right-side pitch under the current context and assigns that absolute frequency directly as the new root.

---

## 9. Directive runtime

Represent directive state explicitly:

```ts
export interface DirectiveState {
  readonly pulse: Fraction          // current logical unit in beats
  readonly dynamic: DynamicMark
  readonly velocity?: Fraction      // pending or persistent as defined below
  readonly pendingGrace?: GraceSpec
  readonly pendingGliss?: GlissSpec
}
```

Groups and parallel branches isolate directive state using the same scope rules as pitch context. Repeat expansion does not isolate it.

### 9.1 Required directive registry

#### Subdivision

```xenpaper
@4 C D
@1/4 G
```

With no question marks, `@n` sets:

```text
pulse = 1 beat / n
```

Therefore:

```text
@4   -> quarter-beat pulse
@1/4 -> four-beat pulse
```

The value must be a positive dimensionless exact rational.

#### Grace cluster

```xenpaper
@4? B c=
@4?? B c# c=
```

`@n` followed by `k > 0` question marks is a one-shot grace specification, not a persistent pulse change.

- the next `k` attack-bearing sequence items each receive duration `1/n` beat;
- their total duration is stolen from the following attack-bearing item;
- the following item's notated duration is reduced by exactly `k/n` beat;
- the whole cluster retains the duration the following item would otherwise have occupied;
- intervening zero-duration directives and barlines do not count as grace notes;
- insufficient following duration is an error.

For:

```xenpaper
@4?? B c# c=
```

`B` and `c#` each last `1/4` beat. `c=` would normally last `2` beats and is shortened to `3/2` beats. Total cluster duration remains `2` beats.

#### Dynamics

Recognize:

```text
ppp pp p mp mf f ff fff
```

These are persistent lane-state directives. Preserve the named mark. Use this default performance map only for the initial runtime:

```text
ppp=.10 pp=.20 p=.30 mp=.40 mf=.50 f=.65 ff=.82 fff=1.00
```

The exact named mark survives for notation. The numeric map is replaceable by the instrument layer later.

#### Velocity

```xenpaper
@velocity(80%) C
```

This is a one-shot next-attack directive. The argument must be a non-negative dimensionless scalar. Values above `100%` are allowed. Consume it after one compatible attack shape.

#### Glissando

```xenpaper
@gliss(linear) F= C?
@gliss [F, C]= [E, D]?
```

`@gliss` is a one-shot sequence transform:

1. take the next pitch-bearing score item as the source shape;
2. take the immediately following pitch-bearing item as the target shape;
3. the target must have zero duration after tail elimination;
4. source and target shapes must be identical in pitch-leaf structure;
5. replace each source leaf's fixed pitch with a `PitchAutomation` from source to corresponding target over the source leaf's duration;
6. the target contributes no attack and no time;
7. consume both score items as one transformed source item.

Supported curves initially:

```text
linear
```

An omitted curve defaults to `linear`. Unknown curves are errors.

Parenthesizing the source/target pair as one grouped operand is not the gliss syntax and should not be given special meaning.

#### Unknown directives

Preserve unknown directives as zero-duration annotations and emit `XP_UNKNOWN_DIRECTIVE` warning. Do not execute arbitrary behavior.

---

## 10. Score-shape algebra

Use an immutable tree until arithmetic, normalization, grace, and gliss operations are complete.

```ts
export type ScoreShape =
  | AttackShape
  | RestShape
  | ContinueShape
  | SequenceShape
  | ParallelShape
  | ScopedShape
  | AnnotationShape

export interface ShapeBase {
  readonly duration: Fraction
  readonly origins: readonly SourceOrigin[]
}

export interface AttackShape extends ShapeBase {
  readonly kind: 'attack'
  readonly pitch: EvaluatedPitch
  readonly velocity: Fraction
  readonly automation?: PitchAutomation
}

export interface RestShape extends ShapeBase {
  readonly kind: 'rest'
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
```

Equivalent representations are allowed, but the implementation must preserve enough tree structure for broadcasting and gliss shape matching before flattening.

### 10.1 Atoms

At the current pulse:

- playable pitch-like atom -> one `AttackShape` of `pulse` duration;
- `.` -> one `RestShape` of `pulse` duration;
- detached `=` -> one `ContinueShape` of `pulse` duration;
- barline/directive/context change -> zero duration structural/annotation shape.

A named interval, ratio, cents value, or equal-division value in playable position is applied relative to the current root before creating the attack.

### 10.2 Sequencing

Sequence children in source order:

```text
duration(sequence) = sum(child durations)
```

Context and directive state flow from one item to the next, subject to the scope rules above.

### 10.3 Attached continuation

Each attached `=` lowers as if one detached continuation of the current pulse followed the expression.

Examples:

```text
C==   == C = =
[C,E]= appends one continuation pulse to every ending lane of the group
(C D)= extends the final sustain-capable event D
```

Attached and detached spellings retain different origins for formatting and selection.

### 10.4 Tail elimination

Each attached `?` removes one current pulse from the end of the expression.

- removing exactly the whole duration leaves a zero-duration pitch shape suitable as a gliss target;
- removing more than the duration is an error;
- trimming a sequence works backward from its end;
- trimming a parallel shape trims every branch to the new container duration;
- pitch identity and shape structure must survive a trim to zero.

### 10.5 Parentheses

Parentheses preserve intrinsic duration and shape. They introduce context/directive scope but no rhythmic scaling.

### 10.6 Square-bracket normalization

`[fragment]` scales the complete fragment to exactly one current pulse:

```text
scale = pulse / intrinsicDuration(fragment)
```

Scale all contained starts and durations exactly.

Examples:

```text
C [D E F]  -> C for one pulse; D/E/F each one third pulse
[C= D]     -> C for two thirds pulse; D for one third pulse
[E, G]     -> simultaneous E and G for one pulse
```

An empty `[]` is one pulse of rest.

A non-empty zero-duration fragment cannot be normalized and is an error.

### 10.7 Parallel composition

Parallel composition is commutative with respect to duration and never rescales authored material.

```text
duration(parallel) = max(branch durations)
```

Each shorter branch receives generated trailing silence. Generated padding is not an authored `Rest` node and has no literal source origin.

```xenpaper
C D, E F G
```

is equivalent in sound and timing to:

```xenpaper
C D ., E F G
```

All branches:

- start at the same local time;
- use the same incoming pulse, pitch context, and directive state;
- evaluate independently;
- do not leak state to sibling branches or after the parallel expression.

The result's lane order follows source branch order even though timing is commutative.

### 10.8 Hard-boundary readability rule

When a top-level or repeat-body `Parallel` is immediately followed by `||`, its final source branch must already have the maximum branch duration.

Error:

```xenpaper
C D,
E F G,
A B ||
```

Valid:

```xenpaper
C D,
E F G,
A B . ||
```

Earlier branches may be shorter and receive generated padding. This validation is tied specifically to `||`; end-of-source does not impose it.

### 10.9 Pitch arithmetic over shapes

Arithmetic is first evaluated on semantic values, then lifted over timed shapes.

Rules:

1. Two leaves combine by typed value operation.
2. Result leaf duration is the greater operand duration.
3. A singleton pitch leaf broadcasts over any pitch-bearing shape.
4. Two compound shapes combine only when their constructors and arities match.
5. Before recursively combining matching containers of unequal duration, scale each container's local timeline to the greater container duration. This implements the agreed opaque-container max-duration rule.
6. Corresponding leaves then combine recursively using max leaf duration.
7. No implicit cycling, truncation, Cartesian product, or modulo indexing.
8. Arithmetic involving a rest yields a rest of the greater duration.
9. Arithmetic involving a continuation yields a continuation of the greater duration.
10. Barlines, context changes, and directives inside arithmetic operands are errors in the first runtime.

Examples:

```xenpaper
C= + P5
C + P5=
C + [P1 M3 P5]
P5 + [C, G]
```

### 10.10 Continuation resolution

Do not merge continuations while evaluating syntax. Resolve them after shape flattening, per lane and in performed order.

A continuation:

- extends the most recent sustain-capable attack in the same lane;
- may cross barlines and hard boundaries;
- may cross expanded repeat iteration boundaries;
- cannot cross a rest or a new attack;
- without a preceding sustain-capable attack is an error.

Record each continuation's source origin as a duration contribution on the resulting note.

---

## 11. Structural score output

```ts
export type StructuralEvent =
  | StructuralNote
  | StructuralRest
  | StructuralBarline
  | StructuralAnnotation

export interface StructuralScore {
  readonly duration: Fraction
  readonly segments: readonly StructuralSegment[]
  readonly lanes: readonly StructuralLane[]
  readonly notes: readonly StructuralNote[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface StructuralSegment {
  readonly start: Fraction
  readonly duration: Fraction
  readonly hardBoundaryOrigin?: SourceOrigin
}

export interface StructuralLane {
  readonly id: string
  readonly duration: Fraction
  readonly events: readonly StructuralEvent[]
}

export interface StructuralNote {
  readonly type: 'note'
  readonly id: string
  readonly laneId: string
  readonly start: Fraction
  readonly duration: Fraction
  readonly pitch: EvaluatedPitch
  readonly velocity: Fraction
  readonly automation?: PitchAutomation
  readonly attackOrigins: readonly SourceOrigin[]
  readonly durationOrigins: readonly SourceOrigin[]
  readonly expansionPath: ExpansionPath
}

export interface StructuralRest {
  readonly type: 'rest'
  readonly start: Fraction
  readonly duration: Fraction
  readonly generated: boolean
  readonly origins: readonly SourceOrigin[]
}

export interface StructuralBarline {
  readonly type: 'barline'
  readonly laneId: string
  readonly time: Fraction
  readonly origin: SourceOrigin
}
```

Generated padding may be represented explicitly as `StructuralRest { generated: true }` or only through lane duration. If represented, it must not pretend to be authored source.

Stable IDs should derive from source location plus expansion path and lane path. They must remain deterministic for unchanged source.

---

## 12. Provenance

```ts
export interface SourceOrigin {
  readonly location: SourceLocation
  readonly role:
    | 'literal'
    | 'operator'
    | 'duration'
    | 'context'
    | 'directive'
    | 'structural'
    | 'generated'
}

export type ExpansionPath = readonly {
  readonly repeatOffset: number
  readonly iteration: number
}[]
```

Every evaluated pitch must preserve origins for:

- the nominal/degree/ratio literal;
- accidentals and FJS inflections;
- prefix modifiers;
- arithmetic operators;
- context declarations that materially determine the result.

Every note occurrence must preserve the expansion path so one written attack can map to all repeated occurrences.

---

## 13. Diagnostics

```ts
export interface Diagnostic {
  readonly code: string
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly locations: readonly SourceLocation[]
}
```

Required codes include:

```text
XP_PARSE_ERROR
XP_REPEAT_COUNT
XP_REPEAT_EXPANSION_LIMIT
XP_LITERAL
XP_DIVISION_BY_ZERO
XP_DIMENSION_MISMATCH
XP_TYPE_MISMATCH
XP_INVALID_INTERVAL
XP_UNSUPPORTED_ACCIDENTAL
XP_UNSUPPORTED_PRESET
XP_UNKNOWN_IDENTIFIER
XP_UNKNOWN_CALL
XP_UNKNOWN_DIRECTIVE
XP_CONTEXT_TARGET
XP_CONTEXT_VALUE
XP_MISSING_PRIME_MAPPING
XP_SHAPE_MISMATCH
XP_TAIL_UNDERFLOW
XP_NORMALIZE_ZERO
XP_CONTINUE_WITHOUT_NOTE
XP_GRACE_TARGET
XP_GLISS_TARGET
XP_GLISS_SHAPE
XP_PARALLEL_FINAL_BRANCH
XP_HARD_BOUNDARY
```

Errors should point at all materially contributing operands. Do not throw from the middle of compilation for ordinary user mistakes; catch `Value`, `Fraction`, and evaluator errors and convert them to diagnostics.

---

## 14. Required acceptance tests

Use Vitest if it is already configured. Do not add another test framework.

### 14.1 Parser contract

Verify exact node families for:

```xenpaper
0 -1 -2 -12
-1/1 - 2/1
C==
C = =
3/2 ^ 2
m7 / 2
7\12
1\13<3>
E^5 Eb_5 P1_5
/'C '/C
@gliss(linear) F= C?
|:(x10) C {root = C^5} :|
```

### 14.2 Exact values

```ts
expect(evalValue('3/2 ^ 2').equals(new Value(9n, 4n))).toBe(true)
expect(evalValue('7\\12').equals(Value.cents(700))).toBe(true)
expect(
  evalValue('1\\13<3>').mul(13).equals(Value.pitch(new Value(3))),
).toBe(true)
```

### 14.3 Pythagorean and FJS pitches

In the untempered context, relative to root:

```text
C     = 1/1
D     = 9/8
E     = 81/64
G     = 3/2
E^5   = 5/4
Eb_5  = 6/5
P1_5  = 81/80
```

Compare exact ratios by dividing note frequency by root frequency.

### 14.4 Temperament

```xenpaper
{31edo} P1_5
```

The mapped syntonic comma must be unison in 31-EDO. Equivalently, `{31edo} E^5` must sound the same as `{31edo} E`.

```xenpaper
{41edo} P1_5
```

The mapped syntonic comma must be exactly one step of 41-EDO.

### 14.5 Rhythm

```xenpaper
C==
```

One note, duration `3` beats.

```xenpaper
C = =
```

Same sounding duration and distinct duration origins.

```xenpaper
[C= D]
```

`C` duration `2/3` beat; `D` duration `1/3` beat.

```xenpaper
C D, E F G
```

Score duration `3` beats. First branch notes retain one-beat durations and receives one beat generated silence.

### 14.6 Hard boundary

```xenpaper
C D,
E F G,
A B ||
```

Must produce `XP_PARALLEL_FINAL_BRANCH`.

```xenpaper
C D,
E F G,
A B . ||
```

Must not produce that diagnostic.

### 14.7 Grace

```xenpaper
@4?? B c# c=
```

- `B`: `1/4` beat;
- `c#`: `1/4` beat;
- `c`: `3/2` beats;
- total: `2` beats.

### 14.8 Glissando

```xenpaper
@gliss(linear) F= C?
```

Produces one two-beat note event, no separate C attack, and linear pitch automation from F to C.

```xenpaper
@gliss [F, C]= [E, D]?
```

Produces two simultaneous sliding notes with pairwise targets.

### 14.9 Repeat macro and context flow

For the comma-pump body from the design notes:

- in `{31edo}`, ten iterations must leave the final root unchanged because the syntonic comma maps to unison;
- in `{41edo}`, ten iterations must move the root by exactly ten 41-EDO steps;
- written attacks inside the repeat must have ten distinct structural occurrence IDs and one shared source location per written attack;
- context after the repeat must equal the final iteration's outgoing context.

### 14.10 Parallel state isolation

```xenpaper
{24edo}
(C {root = G}), (C)
C
```

Both parallel branches begin with the same incoming root. The root change in the first branch must not affect the second branch or the final `C` after the parallel expression.

---

## 15. Explicit non-goals for this implementation

Do not implement these as part of the first runtime:

- arranger clips or clip ranges;
- tempo maps or conversion from beats to seconds;
- groove playback timing beyond exact notated pulse boundaries;
- Web Audio nodes or `sw-patch` invocation;
- staff engraving or MusicXML;
- lattice layout;
- alternate endings, Segno, Coda, D.C., or D.S.;
- arbitrary user-defined functions;
- arbitrary CAS simplification;
- the `{Nc}` val-selection algorithm;
- unsupported historical accidental mappings;
- automatic canonical respelling of every arithmetic result.

The runtime must nevertheless retain enough exact value, spelling, provenance, and structural timing information for those layers to be implemented later.

---

## 16. Completion criteria

The task is complete when:

1. the current Peggy grammar generates and parses all fixtures;
2. `compile()` produces an exact `StructuralScore` for every valid acceptance example;
3. all durations are `Fraction` values, never floating-point beats;
4. all pitch arithmetic uses `Value` and exact prime formulas where available;
5. repeats expand before context evaluation and pass the comma-pump tests;
6. parallel composition uses max duration with generated rest padding;
7. hard-boundary final-branch validation works;
8. FJS examples evaluate correctly before and after temperament mapping;
9. directives `@subdivision`, grace, dynamics, velocity, and gliss work;
10. source locations and repeat occurrence paths survive into notes;
11. ordinary source errors are returned as diagnostics rather than uncaught exceptions;
12. no new runtime dependency has been added.

The intended first consumer is a debug view that can print each lane as:

```text
startBeat  durationBeat  frequencyApprox  pitchLabel  sourceRange  expansionPath
```

If that view can compile and display the acceptance examples deterministically, the language runtime is ready for arranger, audio, notation, piano-roll, and lattice integration.
