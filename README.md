# Xenpaper 3

Xenpaper 3 is an in-progress browser environment for writing and rendering
microtonal music. The repository currently contains two language runtimes and a
Vue test application used to exercise them:

- [`xenpaper-lang/`](xenpaper-lang/) parses Xenpaper scores, evaluates their
  pitches and rhythm, and projects them to beat events and staff notation.
- [`sw-patch/`](sw-patch/) implements a sandboxed language for constructing Web
  Audio synthesizers and effects.
- [`src/`](src/) contains test pages and notation, piano-roll, and waveform
  components. It is development scaffolding rather than the finished editor.

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

The home page links to the SW Patch and Xenpaper language test pages.

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
