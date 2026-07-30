# sw-patch

SW Patch is a wrapper DSL around the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API).

It's supposed to make writing sound synth patches a little easier than plain JavaScript, but more importantly it forms a sandbox where only synth stuff is callable.

## Package

The code herein is intended to be split into a dedicated package published on npm in the future.

We're just pretending to be a monorepo while Xenpaper 3 is being developed.

## Runtime

`createPatch` parses a patch and returns its public configuration and functions.
For example, `default.swpatch` produces an object whose `on` function can be
called to start notes and get a handle for turning the note off.

```ts
import { createPatch, registerMathWorklets } from './sw-patch'
import source from './src/patches/default.swpatch?raw'

const context = new AudioContext()
await registerMathWorklets(context)
const synth = createPatch(source, context)
const start = context.currentTime + 1
const pitch = context.createConstantSource()
const velocity = 0.5
const off = synth.on(context.destination, start, pitch, velocity)
const end = context.currentTime + 2
const cutOff = off(end)
pitch.stop(cutOff)

// Release implicit signal-arithmetic nodes and internal connections when the
// whole patch is no longer needed.
synth.dispose()
```

`registerMathWorklets()` installs SW Patch's inversion, conversion, and
standard `Math` `AudioWorkletProcessor`s from a blob URL. All processors
share a stoppable sample-by-sample superclass. Registration is
cached per context. Await it before evaluating patch functions that divide one
audio signal by another or explicitly convert an audio signal with `atodb()` or
`dbtoa()`. Unit annotations do not implicitly convert signals: for example,
`AudioSignal(+10dB)` carries the value `10`, while `dbtoa(AudioSignal(+10dB))`
produces its linear amplitude. The same rule applies to node options and scheduled
`AudioParam` values; call `dbtoa()` rather than relying on the destination node's
type. `createPatch()` also starts registration automatically,
but remains synchronous for patches that do not need those processors.

The unary functions `abs`, `acos`, `acosh`, `asin`, `asinh`, `atan`, `atanh`,
`cbrt`, `ceil`, `cos`, `cosh`, `exp`, `expm1`, `floor`, `fround`, `log`,
`log10`, `log1p`, `log2`, `round`, `sign`, `sin`, `sinh`, `sqrt`, `tan`,
`tanh`, `trunc`, and `clz32` accept either scalar quantities or audio signals.
The multi-argument functions `atan2`, `hypot`, `imul`, `max`, `min`, and `pow`
do as well. `hypot`, `max`, and `min` accept up to five arguments. `atan2`
accepts either positional `(y, x)` arguments or named `x` and `y` arguments. Signal
transforms are explicit function calls, so this creates and connects a `tanh`
worklet between the oscillator and destination:

```swpatch
tanh(osc) -> destination
```

The standard `Math` constants `E`, `LN10`, `LN2`, `LOG10E`, `LOG2E`, `PI`,
`SQRT1_2`, and `SQRT2` are available as scalars. `random()` returns a random
scalar between zero (inclusive) and one (exclusive).

SW Patch also provides audio-rate utility sources that follow the native source
node API. `TimeNode()` outputs elapsed seconds after `start()`, `PhaserNode()`
outputs an unfiltered sawtooth phase from zero up to one and exposes an
automatable `frequency` parameter, and `RandomNode()` produces a new
`Math.random()` value for every sample. Each accepts an optional AudioContext
timestamp in `start()` and `stop()`:

```swpatch
t = TimeNode()
phase = PhaserNode(frequency = 2Hz)
noise = RandomNode()
t.start(start)
phase.start(start)
noise.start(start)
```

Comparisons involving an audio signal (`<`, `>`, `<=`, `>=`, `==`, and `!=`)
produce a signal whose samples are `0` or `1`. The `%` operator also works at
audio rate and, for both signals and scalars, follows Python's modulo convention
that the remainder has the divisor's sign. `where(condition, consequent,
alternate)` selects between two values at audio rate; all three arguments are
always evaluated and connected, so it does not short-circuit.

Every patch owns the Web Audio resources that the runtime creates implicitly,
including scalar sources used by expressions such as `signal + 5`. Call
`dispose()` when the patch is no longer needed. Disposal is idempotent; resources
inside an `until` suite are still released earlier when that suite's event fires.

## Effects

A patch with top-level `input` and `output` AudioNode bindings is returned as an
AudioNode-like effect. Other nodes can connect to the patch (which routes into
`input`), while the patch's `connect()` and `disconnect()` methods operate on
`output`.

```swpatch
input = GainNode()
output = GainNode()
delay = DelayNode(maxDelayTime = 2s, delayTime = 250ms)

input -> delay -> output
```

Append a port to either connection endpoint when a connection needs explicit
Web Audio channel routing. For example, `delay:0 -> merger:1` connects output 0
of `delay` to input 1 of `merger`; omitting either suffix selects the default
port for that endpoint.

```ts
const effect = createPatch(source, context) as EffectPatch
synthNode.connect(effect)
effect.connect(context.destination)
```

Pass configuration overrides or extra explicitly allowed patch globals as the
third argument:

```ts
const synth = createPatch(source, context, {
  config: { oscillatorType: 'sine' },
  globals: { /* application-provided functions */ },
})
```
