# sw-seq

SW Seq is a basic audio sequencer. The scheduled cousin of [sw-synth](https://github.com/xenharmonic-devs/sw-synth).

## Design

Audio events are scheduled based on looking slightly ahead of `.currentTime` of an AudioContext. This library only handles loops and cleanup in case of a premature stop. Tempo changes are assumed to be _baked in_ and there's no way to speed up or slow down what has already been scheduled.

## Motivation

I can't figure out why Tone.js runs out of polyphony. This library takes care to re-use resources as much as possible based on years of experience working around Web Audio API jank in sw-synth.
