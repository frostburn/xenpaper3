# sw-seq

SW Seq is a basic audio sequencer. The scheduled cousin of [sw-synth](https://github.com/xenharmonic-devs/sw-synth).

## Package

The code herein is intended to be split into a dedicated package published on npm in the future.

We're just pretending to be a monorepo while Xenpaper 3 is being developed. Import the public API
from `sw-seq/index.ts` rather than reaching into implementation files.

## Design

Audio events are scheduled based on looking slightly ahead of `.currentTime` of an AudioContext. This library only handles loops and cleanup in case of a premature stop. Tempo changes are assumed to be _baked in_ and there's no way to speed up or slow down what has already been scheduled.

`transport.position` follows the audible AudioContext clock (with startup look-ahead, loop wrapping, and end clamping). It does not expose the scheduler's look-ahead cursor, so UI playheads remain independent of the scheduling interval. Calling `stop()` freezes that clock position and dispatches `ended` exactly once.

A parametric note's `noteOn` callback starts its audio graph and returns the callback that releases
that same graph. The release callback returns the cutoff time at which its audio tail has finished.
This matches the note handle produced by an SW Patch synth and lets callers stop note-owned control
sources at the cutoff:

```ts
transport.scheduleParametricNote({
  when: 0,
  duration: 1,
  noteOn(start) {
    pitch.start(start)
    const off = synth.on(destination, start, pitch, velocity)
    return (end) => {
      const cutoff = off(end)
      pitch.stop(cutoff)
      return cutoff
    }
  },
})
```

## Sampled drumkits

`loadSampledDrumkit` loads a Strudel-compatible `samples.json`, resolves its optional `_base`, and
decodes all variants before returning. The resulting kit can be scheduled directly by a
`Transport`; variant indices wrap in the same way as Strudel's `n` parameter.

```ts
const kit = await loadSampledDrumkit(context, '/samples/uzu.json')

transport.scheduleParametricNote({
  when: 0,
  duration: 0.25,
  noteOn: (time) => kit.hit('bd', destination, time, { index: 1, gain: 0.8 }),
})
```

Call `kit.dispose()` when playback is torn down to stop and disconnect any active samples.

## Sampled instruments

`loadSampledInstrument` also loads the pitched instrument maps used by Strudel/Dough. Note labels
use scientific pitch notation and may spell sharps with `s` (for example, `Ds4`). Playback chooses
the nearest available sample and adjusts its playback rate. The gain envelope is initialized from
the note velocity and fades for the configurable release time after note-off.

```ts
const piano = await loadSampledInstrument(context, '/samples/piano.json', 'piano', {
  release: 0.3,
})
const off = piano.note(60, destination, context.currentTime, { velocity: 0.8 })
off(context.currentTime + 1)
```

The note-off callback returns the end of the release tail, making it directly compatible with
`Transport.scheduleParametricNote`. Call `piano.dispose()` to stop active voices.

In Xenpaper's DAW, an instrument lane accepts the same raw manifest URLs, GitHub `blob` URLs, and
local JSON uploads as a sampled drum lane. Select a bank from a multi-instrument manifest after it
loads. The lane and note velocity set the sample envelope level, while the lane's `@adsr` release
value determines the sample's fade time.

In Xenpaper's DAW, select **Sampled drums**, then upload a JSON file or enter either a raw manifest
URL or a GitHub `blob` page URL. GitHub pages are converted to raw-content URLs without an initial
request, avoiding their CORS restriction. Relative `_base` paths are made absolute so the project
remains portable. The manifest's bank names become the lane's drum literals automatically.

## Motivation

I can't figure out why Tone.js runs out of polyphony. This library takes care to re-use resources as much as possible based on years of experience working around Web Audio API jank in sw-synth.
