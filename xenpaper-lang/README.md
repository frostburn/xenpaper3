# xenpaper-lang

## Shared rhythm grammars

The pitched and sample languages share document sequencing, parallel branches,
normalized groups, repeats, rests, continuations, postfix marks, and directives.

Pitch-context blocks also support `tuning *= factor`. For example,
`{tuning *= 102%}` stretches the active scale, prime mapping, equave, ups/lifts,
and MOS intervals to 102% of their current size in pitch-space while leaving the
root frequency fixed.
Callers enumerate sample names when parsing, so the grammars split only for those
bare event leaves. Without that option, `bd` retains its pitched meaning as B
half-flat.

```ts
import { parse } from './index.js'

parse('bd') // B half-flat
parse('|:@x2 [bd sd] :|, hh', { drumSamples: ['bd', 'sd', 'hh'] })
```

`xenpaper-lang` is the parser and renderer-independent runtime for Xenpaper 3's
microtonal score language. It is currently part of this repository rather than
a separately published package.

## Processing a score

The public exports are collected in [`index.ts`](index.ts). A typical consumer
parses source and then expands it to exact beat-timed events:

```ts
import { expandToBeatEvents, parse } from './xenpaper-lang'

const program = parse(String.raw`{31edo} C E^5 G`)
const result = expandToBeatEvents(program)

if ('score' in result) {
  console.log(result.score.duration, result.score.events)
} else {
  console.error(result.diagnostics)
}
```

`parse()` is the generated Peggy parser and throws a Peggy syntax error for
invalid source. Runtime stages return diagnostics for semantic errors.
Staff notation and audio scheduling are separate projections of the parsed
source. `evaluateScoreShape()` produces an abstract, exact-duration notation
tree; dynamics remain zero-duration annotations and velocity never changes a
notation attack. `constructStaffNotationShape()` converts that tree to
renderer-independent staff data.

`evaluateProgramSemantics()` expands repeats and evaluates the score once,
returning its exact-duration tree and prevailing context. `expandToBeatEvents()`
projects those semantics into notes and structural markers, including dynamics,
articulation and groove, still on a rational grid. Neither API schedules audio
or converts beats to seconds. `expandRepeats()` is also available for tooling
that needs source occurrences and their expansion paths.

## Global grid context

`evaluateInitialization()` compiles an enclosing zero-duration source, or a
global timeline with `allowDuration: true`. Pass the returned `initialization`
to another initialization or to score evaluation. A clip's `beatOffset` is an
exact `Fraction`; global context is selected at each expression's absolute grid
position, before evaluation. Local groups and function calls retain their scopes.

```ts
const global = evaluateInitialization(parse('{19edo};{12edo}'), {
  allowDuration: true,
  timeSignature: { numerator: 4, denominator: 4 },
})
const result = expandToBeatEvents(parse('D D D D D D'), {
  initialization: global.initialization,
})
```

Global changes remain in force until another authored change. There is no
implicit looping or inferred final segment: write `|: {19edo};{12edo}; :|` to
repeat those two measures. This applies equally to tuning, meter, tempo, and
groove changes. A groove's own rhythmic template still cycles while active.

`evaluateTimeline()` enables global `@tempo` directives and exposes typed tempo
and meter changes at exact grid positions. Tempo only affects the renderer's
conversion to seconds. `gridMeasureBoundaries()` enumerates rational measure
positions without floating-point accumulation. Bar rests and barline checks
use the same prevailing meter during evaluation.

Normalized slots establish their rhythm before looking up timed contexts at
their scaled positions. If a context-dependent expression changes that rhythm,
layout is resolved again; a cyclic or non-converging layout is diagnosed rather
than assigned inconsistent note positions.

The lower-level literal, expression, pitch, FJS, directive, and notation helpers
are exported for focused tooling and tests. There is not yet a single
`compile(source)` convenience API; consumers must call `parse()` themselves.

Arithmetic expressions provide `pitch(ratio)` to convert a positive scalar
ratio to a pitch displacement, `ratio(offset)` for the inverse conversion, and
`sqrt(quantity)` for a square root. `sqrt()` retains an exact monomial when the
value model is closed under the operation and halves the quantity's dimensions.
The built-in identifier `pi` evaluates to the dimensionless real constant π.

## Local declarations and functions

Declarations are zero-duration score items:

```text
let fifth = 3/2
fn transpose(interval, note) { ret note + interval }
transpose(fifth, C) transpose(fifth, D)
```

Parameters may declare coercions and trailing defaults:

```text
fn power(value: ratio, exponent: integer = 2/1) { ret value ** exponent }
power(3/2) power(3/2, 3/1)
```

The supported coercions are `ratio`, `pitch`, `integer`, `container`, and
`boolean`. Container element coercions may be nested, as in `container<ratio>`.
Coercions are applied while evaluating the argument; for example, bare integers
inside a `container<ratio>` argument are ratios rather than scale degrees.
`niente` passes through a coercion so it can be used as an optional default.
Required parameters cannot follow defaulted parameters.
For the otherwise ambiguous bare integer syntax in a call, `ratio`, `integer`,
and `boolean` parameters interpret the argument as an integer scalar, while an
unannotated or `pitch` parameter receives the active scale degree. Consequently,
`sqrt(4)` is always `2`, while an unannotated `identity(4)` receives degree 4.

`let name = expression` evaluates the initializer once. `fn name(parameters) {
... ret expression }` creates a lexical closure. A function body contains zero
or more local `let` or `fn` declarations followed by exactly one `ret`, whose
expression is the call's result. Commas separate parameters and a trailing comma
is not accepted. `let`, `fn`, and `ret` are reserved (case-sensitive) and cannot
be used as pitches, identifiers, or function names. Names that are valid musical
pitch spellings are likewise unavailable for declarations: music always wins and
the meaning of a pitch token never depends on lexical scope.

Every evaluation starts with a prelude written in Xenpaper itself. It currently
declares `pi` and defines `sqrt(radicand: ratio)` as `radicand ** 1/2`; ordinary
lexical shadowing can replace either name in a narrower scope.

`ret` has lower precedence than score sequencing and parallel composition, so a
function may return an entire musical fragment:

```text
fn LICC() {
  ret @2 D E F G E= C D==
}
LICC()
```

Calling the function evaluates that returned fragment in the function's lexical
environment while inheriting the caller's current pitch, timing, and directive
contexts.

Scope is sequential and lexical: a declaration is visible only after its source
position. A function captures the environment at its declaration, arguments are
evaluated exactly once in left-to-right order at the call site, and parameters
are then bound in a child scope. Later declarations may shadow earlier ones.
Groups, normalized groups, and each parallel branch isolate their local bindings;
hard boundaries retain the surrounding sequence's bindings. Repeats splice their
body and selected ending into that sequence, just like written-out copies.
Declarations are evaluated at each occurrence and can shadow earlier bindings;
only explicit groups, slots, function calls, and parallel branches create scopes.

Parameter names must be unique. Functions are intentionally non-recursive (both
direct and mutual recursion are rejected), keeping score evaluation finite and
making repeat notation the sole mechanism for repetition. Declarations emit no
attack, rest, annotation, beat, duration, or staff symbol.

Key signatures may include a diatonic mode after the tonic, such as
`{key = D minor}`. The supported names are Lydian, Ionian, Mixolydian, Dorian,
Aeolian, Phrygian, and Locrian; `major` aliases Ionian and `minor` aliases
Aeolian. Mode names are case-insensitive, and a key without a mode remains
Ionian.

## Exact values

`Value` deliberately provides a small set of closed exact forms instead of a
general computer algebra system:

1. **Multiplicative monomials** represent rational numbers and products of prime
   factors raised to rational powers. This covers just-intonation ratios, EDO
   ratios, and large interval stacks.
2. **Rational dimensional quantities** represent beats, seconds, frequencies,
   decibels, and arbitrary sparse dimensions.
3. **Pitch displacements** use an additive canonical form containing rational
   cents and rational coefficients of `pitch(prime)` terms.

For example, these identities remain exact:

```text
pitch(2) = 1200 cents
7\12 = 700 cents
13 * (1\13<3>) = pitch(3)
ratio(13 * (1\13<3>)) = 3
```

Operations outside those closed forms, such as `sqrt(2) + sqrt(3)`, fall back to
a floating-point real magnitude while retaining dimensions. Exact equality does
not use an epsilon; approximate comparison is explicit.

## Generated parser

Edit [`xenpaper.peggy`](xenpaper.peggy), not `parser.generated.js`. Generate the
ignored parser artifact with:

```sh
npm run compile:xenpaper-lang
```

`parser.generated.d.ts` is maintained alongside the grammar and describes the
syntax tree returned to TypeScript callers.

## Directive extensions

Xenpaper parses named directive arguments without assigning synthesizer or real-time
meaning to them. Second-party runtimes can supply `DirectiveExtension` objects through
`ScoreShapeOptions.directiveExtensions`. An extension owns its initial and prevailing
state, interprets the directive arguments, and returns any source-located diagnostics.
Extension state follows the same sequencing, repeat, explicit-group, normalized-slot,
and parallel-branch isolation rules as core prevailing directives.

Every attack and `BeatTimedNoteEvent` contains a `directiveState` snapshot keyed by
extension name. Extensions should treat their state values as immutable; returning a new
value for each change ensures already-produced notes cannot be affected later. This lets
an audio engine implement ADSR, drum patches without sustain, or arbitrary patch
parameters without adding those concepts to Xenpaper itself.

## Tests

The unit tests in [`__test__/`](__test__/) cover the grammar, exact values,
literal and expression evaluation, repeat expansion, score shaping, directives,
beat events, and staff notation. Run them from the repository root:

```sh
npm run test:unit -- --run
```
