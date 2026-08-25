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

## Motivation

I can't figure out why Tone.js runs out of polyphony. This library takes care to re-use resources as much as possible based on years of experience working around Web Audio API jank in sw-synth.
