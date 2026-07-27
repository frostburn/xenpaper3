# sw-patch

SW Patch is a wrapper DSL around the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API).

It's supposed to make writing sound synth patches a little easier than plain JavaScript, but more importantly it forms a sandbox where only synth stuff is callable.

## Package

The code herein is intended to be split into a dedicated package published on npm in the future.

We're just pretending to be a monorepo while Xenpaper 3 is being developed.

## Runtime

`createPatch` parses a patch and returns its public configuration and functions.
For example, `default-v3.swpatch` produces an object whose `on` function can be
called like the prototype `Synth.on` in `src/App.vue`:

```ts
import { createPatch } from './sw-patch'
import source from './default-v3.swpatch?raw'

const context = new AudioContext()
const synth = createPatch(source, context)
const off = synth.on(context.destination, start, pitch, velocity)
const cutOff = off(end)
```

Pass configuration overrides or extra explicitly allowed patch globals as the
third argument:

```ts
const synth = createPatch(source, context, {
  config: { oscillatorType: 'sine' },
  globals: { /* application-provided functions */ },
})
```
