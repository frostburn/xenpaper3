# xenpaper-lang

The grammar, parser and interfaces for quantities in the microtonal music composition language of Xenpaper 3.

(Sol prototype sketch stuff below)

# Xenpaper value prototype

This prototype deliberately avoids becoming a computer algebra system.

## Closed exact forms

`Value` retains exact values for:

1. **Multiplicative monomials** — rational numbers and products of prime factors raised to rational powers. This covers JI ratios, EDO ratios, and very large interval stacks.
2. **Rational dimensional quantities** — beats, seconds, frequencies, decibels, and arbitrary sparse dimensions.
3. **Pitch displacements** — an additive canonical form containing:
   - a rational number of cents; and
   - rational coefficients of `pitch(prime)` terms.

The pitch form makes these identities exact:

```text
pitch(2) = 1200 cents
7\\12 = 700 cents
13 * (1\\13<3>) = pitch(3)
ratio(13 * (1\\13<3>)) = 3
```

Anything outside the closed forms, such as `sqrt(2) + sqrt(3)`, falls back to a floating-point `real` magnitude while retaining its dimensions. Exact equality never uses an epsilon; approximate comparison is explicit.

## Commands

```bash
npm run build
npm run test:smoke
npm test             # requires Vitest to be installed
```

The included dependency-free smoke runner exercises the same core semantics as the Vitest suite.
