# Xenpaper language development

- Always use helpers from `xen-dev-utils` when an appropriate helper is
  available instead of implementing a local equivalent.
- Keep the core representation exact: rational `Fraction` time and sparse
  rational-prime `Monomial` pitch coordinates.
- Cents, hertz, MIDI numbers, Web Audio scheduling, calibration, and engraving
  geometry belong in downstream projections rather than the language core.
- Treat a score value as an immutable transaction with a span. Sequence,
  overlay, and repeat by composing transactions; never let a callee mutate a
  caller-owned cursor.
- Directive-extension state is immutable application metadata. Preserve
  snapshots in the grid without teaching Xenpaper the extension's real-world
  meaning.
