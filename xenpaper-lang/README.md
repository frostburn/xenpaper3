# xenpaper-lang

`xenpaper-lang` is Xenpaper 3's renderer- and device-independent score language.
Its primary output is an **exact score grid**: rational beat positions paired
with sparse rational prime-exponent pitch coordinates. It is currently part of
this repository rather than a separately published package.

## Compile to the exact grid

Use `compile()` for application code. Syntax and semantic failures are returned
as diagnostics; successful compilation produces a `ScoreGrid<GridEvent>`.

```ts
import { compile } from './xenpaper-lang/core'

const result = compile(String.raw`{31edo} C E^5 G`)
if (!('grid' in result)) {
  console.error(result.diagnostics)
} else {
  for (const event of result.grid.events) {
    if (event.kind !== 'note') continue
    console.log(event.start, event.duration, event.pitch.sounding)
  }
}
```

The grid deliberately has no cents scale, concert-pitch calibration, MIDI note,
staff position, oscillator, or wall-clock time. A note instead carries:

- `pitch.sounding`: its exact coordinate after the active prime mapping;
- `pitch.formula`: its untempered/source identity when one exists;
- `pitch.notation`: a root-relative exact coordinate when notation needs one;
- spelling, source origins, and immutable extension snapshots as metadata.

For example, a nominal in 31-EDO can retain its Pythagorean source formula while
its sounding coordinate is an exact rational power of 2. Temperament therefore
changes a projection without erasing musical identity.

`compileProgram()` accepts an already parsed AST. The pure data model lives in
`grid.ts`; the lowering implementation lives in `runtime/compile-grid.ts`.
`core.ts` is the narrow application entry point.

## Transactional score composition

`ScoreGrid` is an immutable fragment with an exact `span` and timed events. It
has no ambient cursor:

```ts
const phrase = call.append(response) // append and advance once
const chord = soprano.overlay(bass) // same origin, maximum span
const ostinato = cell.repeat(8) // tile an evaluated fragment
const pickup = phrase.delay(1 / 4) // exact leading silence
```

These operations provide the transaction boundary for downstream composition
and the intended lowering target for language-level functions and repeats. A
callee constructs a local fragment; its caller decides whether to append,
overlay, delay, transform, or discard it. This avoids leaking either the
caller's cursor into the callee or the callee's internal cursor back into its
caller. Parser repeat syntax is lowered before the final grid is constructed.

## Monomial coordinates

`Monomial` is the public exact pitch-coordinate type. It is an immutable sparse
map from positive primes to rational exponents. Coordinate addition multiplies
ratios, subtraction divides them, and rational scaling raises them to a power.

```ts
import { Fraction } from 'xen-dev-utils/fraction'
import { Monomial } from './xenpaper-lang/core'

const fifth = Monomial.fromRatio(new Fraction(3, 2))
const fourth = Monomial.fromRatio(new Fraction(4, 3))
const octave = fifth.add(fourth)

const tritaveStep = Monomial.equalDivision(1, 13, Monomial.fromRatio(3))
console.assert(tritaveStep.scale(13).equals(Monomial.fromRatio(3)))
```

A downstream system supplies a logarithmic prime mapping when it needs a real
number. For example, the browser application defines its cents and frequency
projections in `src/music/pitch-projection.ts`; Xenpaper itself does not know
about A4 = 440 Hz or SW Patch's detune origin.

## Exact values

The expression evaluator still uses `Value` for general arithmetic and
quantities. It deliberately provides a small set of closed exact forms instead
of a general computer algebra system:

1. multiplicative monomials for rational numbers and rational prime powers;
2. rational dimensional quantities such as beats, seconds, frequencies, and
   decibels;
3. additive logarithmic pitch displacements.

For example, these identities remain exact:

```text
pitch(2) = 1200 cents
7\12 = 700 cents
13 * (1\13<3>) = pitch(3)
ratio(13 * (1\13<3>)) = 3
```

Operations outside those closed forms, such as `sqrt(2) + sqrt(3)`, may fall
back to a floating-point real magnitude while retaining dimensions. Such a
value can be useful during expression evaluation, but a sounding pitch must be
made exact before it can enter the core score grid. `compile()` reports
`XP_INEXACT_GRID_PITCH` instead of silently baking an approximation into the
score.

## Real-world projections

The exact grid is intentionally extensible rather than feature-complete.
Second-party runtimes can supply `DirectiveExtension` objects. Each extension
owns its prevailing state and returns immutable snapshots; every grid note
exposes those snapshots through `event.extensions`.

This lets applications add ADSR envelopes, instrument choices, controller data,
lyrics, spatialization, or other concerns without adding them to Xenpaper's
pitch/rhythm model. Staff notation remains a separate projection through
`constructStaffNotationShape()`, and audio scheduling remains an application
projection of exact beats and monomial pitches.

## Generated parser

Edit [`xenpaper.peggy`](xenpaper.peggy), not `parser.generated.js`. Generate the
ignored parser artifact with:

```sh
npm run compile:xenpaper-lang
```

`parser.generated.d.ts` is maintained alongside the grammar and describes the
syntax tree returned to TypeScript callers.

## Tests

The unit tests in [`__test__/`](__test__/) cover the grammar, monomial grid,
exact values, literal and expression evaluation, repeat expansion, score
shaping, directives, beat events, and staff notation. Run them
from the repository root:

```sh
npm run test:unit -- --run
```
