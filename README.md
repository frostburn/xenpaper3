# Xenpaper 3

Xenpaper 3 is an in-progress browser environment for writing and rendering
microtonal music. The repository currently contains two language runtimes and a
Vue test application used to exercise them:

- [`xenpaper-lang/`](xenpaper-lang/) parses Xenpaper scores, evaluates their
  pitches and rhythm, and projects them to beat events and staff notation.
- [`sw-patch/`](sw-patch/) implements a sandboxed language for constructing Web
  Audio synthesizers and effects.
- [`src/`](src/) contains test pages and notation, piano-roll, and waveform
  components and the in-progress DAW editor.

## Requirements

- Node.js 22.18 or later (Node.js 24.12 or later is also supported)
- npm

## Setup

```sh
npm install
```

The Peggy parsers are generated locally and deliberately excluded from version
control. The development, build, and test commands generate both parsers before
using them.

## Development

```sh
npm run dev
```

The home page links to the DAW, SW Patch, and Xenpaper language test pages. The
DAW is also available directly at `/daw`. Double-click an instrument or drum
timeline to add a clip, then edit its Xenpaper source below the lanes. Projects
can be imported and exported as readable `.xenpaper.json` files; add a
`?project=URL` query parameter to load one when the editor opens (for example,
`/daw?project=/minuet.xenpaper.json`).

## Playback architecture

The DAW playback path is intentionally split at the browser boundary:

- `src/daw/score.ts` compiles Xenpaper source into authored beats, envelopes, and
  C-relative pitches. It does not know which synthesizer will play the result.
- `src/daw/timeline.ts` snapshots and pre-integrates tempo changes.
- `src/daw/playback-plan.ts` turns mutable editor state into an immutable,
  browser-independent playback plan.
- `src/daw/web-audio-automation.ts` owns SW Patch detune conversion and Web Audio
  automation workarounds.
- `src/daw/web-audio-playback.ts` owns disposable nodes, patches, transport events,
  release tails, muting, and cleanup for one playback session.
- `src/daw/audio-engine.ts` is the small public facade used by Vue.

Keep musical transformations above this boundary and browser quirks below it. A
new renderer should be able to consume a playback plan without importing Web Audio.

Instrument envelopes use the concise attack/decay/sustain/release directive
`@adsr(100ms, 200ms, 70%, 300ms)`. The compatible named form, such as
`@patch(sustain: 55%)`, remains useful for partial updates to the prevailing envelope.

## Checks

```sh
npm run test:unit -- --run
npm run type-check
npm run lint
npm run build
```

`npm run lint` applies safe automatic fixes. `npm run format` formats `src/`
with oxfmt.

## Language documentation

See [`xenpaper-lang/README.md`](xenpaper-lang/README.md) for the score-language
pipeline and public entry points. See [`sw-patch/README.md`](sw-patch/README.md)
for patch syntax and runtime behavior.

## License

This project is licensed under the terms in [`LICENSE`](LICENSE).
