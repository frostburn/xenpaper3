# sw-patch

SW Patch is a wrapper DSL around the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API).

It's supposed to make writing sound synth patches a little easier than plain JavaScript, but more importantly it forms a sandbox where only synth stuff is callable.

## Package

The code herein is intended to be split into a dedicated package published on npm in the future.

We're just pretending to be a monorepo while Xenpaper 3 is being developed.

Control flow uses Python-style indentation. `for` accepts any iterable value,
including list literals and arrays passed to patch functions, and `while` repeats
while its expression is truthy. A `ret` inside either loop immediately returns
from the enclosing function.

```swpatch
total = 0
for value in [1, 2, 3]:
    total = total + value

while total < 10:
    total = total + 1
```

The built-in `range(stop)`, `range(start, stop)`, and
`range(start, stop, step)` forms produce integer sequences. As in Python,
`break` exits the nearest loop, `continue` advances it to its next iteration,
and `pass` is an explicit no-op for otherwise empty suites.

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

## Drumkits

A live drumkit is an SW Patch whose top-level functions are its sample names.
Drum functions begin with the conventional parameters `destination: AudioNode`,
`start: Instant`, and `velocity: Level`; additional voice parameters may follow.
`drumNames()` discovers those names without creating audio nodes, so the same
list can be passed to Xenpaper's `parse(..., { drumSamples })`. `createDrumkit()`
compiles the source and exposes a common `hit(name, destination, start, velocity)`
dispatcher while leaving each named function directly callable for live-patch
tools.

```ts
import { createDrumkit, drumNames } from './sw-patch'
import { parse } from './xenpaper-lang'
import source from './src/patches/drumkit.swpatch?raw'

const drums = drumNames(source) // ['bd', 'sd', 'hh']
const score = parse('[bd sd] hh hh', { drumSamples: drums })
const kit = createDrumkit(source, audioContext)
const off = kit.hit('bd', audioContext.destination, audioContext.currentTime, 0.8)
off(audioContext.currentTime + 0.25)
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

Standard Web Audio nodes can be created with their API constructor names:
`AnalyserNode`, `AudioBufferSourceNode`, `BiquadFilterNode`,
`ChannelMergerNode`, `ChannelSplitterNode`, `ConstantSourceNode`,
`ConvolverNode`, `DelayNode`, `DynamicsCompressorNode`, `GainNode`,
`IIRFilterNode`, `OscillatorNode`, `PannerNode`, `StereoPannerNode`, and
`WaveShaperNode`. Constructor options use named arguments in patch source.
When a browser only provides the older `AudioContext.create*()` form, SW Patch
uses it automatically and applies the same options, including `AudioParam`
initial values.

SW Patch also provides audio-rate utility sources that follow the native source
node API. `TimeNode()` outputs elapsed seconds after `start()`, `PhaserNode()`
outputs an unfiltered sawtooth phase from zero up to one and exposes an
automatable `frequency` parameter and an OscillatorNode-style `detune`
parameter measured in cents. Like `OscillatorNode`, its default frequency is
440 Hz. `RandomNode()` produces a new
`Math.random()` value for every sample. Each accepts an optional AudioContext
timestamp in `start()` and `stop()`:

```swpatch
t = TimeNode()
phase = PhaserNode(frequency = 2Hz, detune = 100c)
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

The `**` operator performs right-associative exponentiation. When either
operand is an audio signal, SW Patch routes both operands through the existing
`pow` worklet.

Array literals can supply the Web Audio data that cannot be expressed as a
scalar node option. An oscillator's `periodicWave` is a two-element array
containing its real and imaginary Fourier coefficients; SW Patch converts it
with `context.createPeriodicWave()`. A wave shaper's `curve` is a single array
of samples, converted to the `Float32Array` required by Web Audio. Values with
units are converted to their canonical scalar values in both forms.
The `PeriodicWave(real, imaginary, options)` helper provides the same conversion
while supplying the patch's audio context implicitly, including support for the
`disableNormalization` option.

```swpatch
osc = OscillatorNode(periodicWave = [[0, 0, 0], [0, 1, 0.5]])
shaper = WaveShaperNode(curve = [-1, -50%, 0, 50%, 1], oversample = '4x')
osc -> shaper -> destination
```

To retain the Fourier coefficients' original amplitude, construct the wave
explicitly:

```swpatch
wave = PeriodicWave([0, 0, 0], [0, 1, 0.5], {disableNormalization: true})
osc = OscillatorNode(periodicWave = wave)
```

Every patch owns the Web Audio resources that the runtime creates implicitly,
including scalar sources used by expressions such as `signal + 5`. Call
`dispose()` when the patch is no longer needed. Disposal is idempotent; resources
inside an `until` suite are still released earlier when that suite's event fires.
An event listener uses `emitter:event` syntax, keeping the event name distinct
from member access. For example, `until osc:ended:` releases the suite's
resources when `osc` dispatches its `ended` event.

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
  globals: {/* application-provided functions */},
})
```
