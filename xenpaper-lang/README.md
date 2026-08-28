# xenpaper-lang

## Shared rhythm grammars

The pitched and sample languages share document sequencing, parallel branches,
normalized groups, repeats, rests, continuations, postfix marks, and directives.
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

Independently, `expandToBeatEvents()` expands repeats and evaluates playback
semantics directly into notes and structural markers at exact beat positions.
It applies prevailing dynamics and one-shot velocities only in this audio
pipeline. `expandRepeats()` remains available separately for tooling that needs
to inspect expanded source occurrences and their expansion paths.

The lower-level literal, expression, pitch, FJS, directive, and notation helpers
are exported for focused tooling and tests. There is not yet a single
`compile(source)` convenience API; consumers must call `parse()` themselves.

Arithmetic expressions provide `pitch(ratio)` to convert a positive scalar
ratio to a pitch displacement, `ratio(offset)` for the inverse conversion, and
`sqrt(quantity)` for a square root. `sqrt()` retains an exact monomial when the
value model is closed under the operation and halves the quantity's dimensions.
The built-in identifier `pi` evaluates to the dimensionless real constant π.

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
