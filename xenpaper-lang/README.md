# xenpaper-lang

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
`expandToBeatEvents()` performs repeat expansion, score-shape evaluation, and
beat-event flattening. The individual stages are also exported for callers that
need the intermediate trees:

1. `expandRepeats()` clones repeat bodies and records an expansion path on each
   occurrence.
2. `evaluateScoreShape()` evaluates pitch contexts, directives, sequence and
   parallel duration, normalized slots, continuations, grace notes, and
   glissandi into an exact-duration tree.
3. `flattenScoreShape()` produces notes and zero-duration structural markers at
   exact beat positions.
4. `constructStaffNotationShape()` converts a score-shape tree to
   renderer-independent staff data.

The lower-level literal, expression, pitch, FJS, directive, and notation helpers
are exported for focused tooling and tests. There is not yet a single
`compile(source)` convenience API; consumers must call `parse()` themselves.

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

## Tests

The unit tests in [`__test__/`](__test__/) cover the grammar, exact values,
literal and expression evaluation, repeat expansion, score shaping, directives,
beat events, and staff notation. Run them from the repository root:

```sh
npm run test:unit -- --run
```
