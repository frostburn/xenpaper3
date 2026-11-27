# Xenpaper 3

Xenpaper 3 is an in-progress browser environment for writing and rendering
microtonal music.

- The standalone `xenpaper-lang` package parses Xenpaper scores, evaluates their
  pitches and rhythm, and projects them to beat events and staff notation.
  [Language repository](https://github.com/frostburn/xenpaper-lang)
- [`sw-patch/`](sw-patch/) implements a sandboxed language for constructing Web
  Audio synthesizers and effects.
- [`src/`](src/) contains test pages and notation, piano-roll, and waveform
  components and the in-progress DAW editor.

## Requirements

- Node.js 22.18+ in the 22.x line, 24.12+ in the 24.x line, or 26.0+
- npm

## Setup

```sh
npm install
```

npm installs `xenpaper-lang` from GitHub and builds its parser. The development,
build, and test commands generate the local SW Patch parser.

## Development

```sh
npm run dev
```

The home page links to the DAW, SW Patch, and Xenpaper language test pages. The
DAW is also available directly at `/daw`. Double-click an instrument or drum
timeline to add a clip, then edit its Xenpaper source below the lanes. Projects
can be imported and exported as readable `.xenpaper.json` files. Built-in demos
are bundled in [`src/demo-projects/`](src/demo-projects/) and loaded by their
stable IDs with the `demo` query parameter, such as `/daw?demo=minuet` or
`/daw?demo=lucky-debugger`. To load a project hosted elsewhere, use the
`?project=URL` query parameter instead (for example,
`/daw?project=https%3A%2F%2Fexample.com%2Fpiece.xenpaper.json`).

### Shareable snippets

Open `/snippet` for a single-clip editor with playback and a piano-roll preview.
The clip supports `@tempo(120bpm)` and `@time(4/4)`, including changes partway
through the score. Instrument config includes gain and the same default,
unison, noise, or sampled instruments as the DAW. Write tuning and envelope
directives in the clip source; there is no separate lane-source editor.

Every edit updates the URL. Snippets use a versioned `#v1.` fragment followed
by unpadded UTF-8 base64url JSON containing `[clipSource, laneSource, gain,
instrument]`. Only letters, digits, hyphens, underscores, and the version dot
appear in the encoded payload, so score punctuation cannot break chat links
or MediaWiki markup. Opening a link restores all snippet settings without
local storage or a project file. The sharing controls copy a plain URL. Sampled instruments
include their manifest in the URL; their audio files still load from the
configured sample URLs.

The `/tutorial` page covers the four original tutorial chapters and a chapter of
additional score features, with up to 10 entries per
page and a table of contents linking to each page and example. Each chapter has a dedicated JSON file in
`src/tutorial/interactive/`, containing its example IDs, titles, explanations,
and complete snippet props. Edit these files independently of the sidebar tutorial
in `src/tutorial/`. Entries without snippet props remain readable explanations.
Advanced score construction starts with scale assignments, combination product
sets, and combined tuning assignments. The lessons in
`src/tutorial/interactive/additional-features.json` cover explicit degrees, measure
rests, hold-to-end, functions, containers, scale helpers, tempo, envelopes, unison,
and signal ramps. Keep chapter order and example
IDs stable to preserve existing permalinks. Each playable example declares its
hidden tempo directly in `props.laneSource` (120 or 240 BPM), alongside its envelope
and any other lane settings; there are no separate title or tempo override tables.
Lessons that deliberately demonstrate warnings list their diagnostic codes in
`expectedWarnings`, so validation checks them while requiring other examples to
compile without diagnostics.
Snippets have no implicit time signature, including during playback
and note highlighting. Write `@time(...)` in the clip or lane source to enable
measure rests and barline validation; the DAW still inherits its project meter.
Tutorial pages have permalinks such as `/tutorial?page=2`; example links also
include an anchor, such as `/tutorial?page=3#basics-22-heading`. Browser history
restores the selected page. Vue renders the active page and binds `source`, `instrument`, and `gain` with
`v-model`. Page changes stop playback and retain edits for the current visit.
The `simplified` prop shows Play, Stop, Gain, and instrument-specific controls
alongside the editable score.

## Playback architecture

The DAW playback path is intentionally split at the browser boundary:

- `src/daw/score.ts` compiles Xenpaper source into authored beats, envelopes, and
  C-relative pitches. It does not know which synthesizer will play the result.
- `src/daw/timeline.ts` snapshots and pre-integrates tempo changes.
- `src/daw/playback-plan.ts` turns mutable editor state into an immutable,
  browser-independent playback plan.
- `src/daw/signal-automation.ts` samples pitch, effect, and spread ramps through
  the same tempo map, preserving each ramp's endpoints and audible window.
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

`npm run lint` applies safe automatic fixes. `npm run format` formats the app and
language runtime sources with oxfmt.

## Language documentation

The standalone package documents the score language and its public API.
[Xenpaper language documentation](https://github.com/frostburn/xenpaper-lang#readme)

With `xenpaper-lang` 0.2.0, separate a variable declaration from a directive on
the same line with `$`, as in `let division <- 4/1 $ @subdivision(division)`.
Write continuations inside branches of uneven parallels, as in `(C=, D E=)`.

See [`sw-patch/README.md`](sw-patch/README.md) for patch syntax and runtime behavior.

## License

This project is licensed under the terms in [`LICENSE`](LICENSE).
