# Ender

[![CI](https://github.com/GROGKNAK/Ender/actions/workflows/ci.yml/badge.svg)](https://github.com/GROGKNAK/Ender/actions/workflows/ci.yml)
[![CodeQL](https://github.com/GROGKNAK/Ender/actions/workflows/codeql.yml/badge.svg)](https://github.com/GROGKNAK/Ender/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Builds and documents relay test plans for transmission line protection: SEL
line current differential (87L) and distance (21) elements.

It reads the acSELerator settings export from the relay at each end of a line,
works out the fault quantities for a set of test points, and produces a test
report, a CSV for the test set, and a **calculation record** that shows every
step of the arithmetic so a reviewer can check the work.

> **Status: working against real exports.** 71 unit tests plus an end-to-end
> smoke test. The parser has been validated against a real SEL-311L in two
> different export formats — an acSELerator HTML report and the native
> per-group folder delivered as a zip — which produce identical values on
> every setting the calculation uses.

## What it does

1. **Settings files** — drop in the export from each end. Ender parses both,
   shows what it recognised and what it did not, and cross-checks the two ends
   against each other. A disagreement about the line the two relays are both
   protecting is a finding, so it is surfaced rather than silently resolved.
2. **Line & system** — derives `k0`, lists the zone reaches as a share of the
   line, and takes the operator inputs that are not in any relay (test current,
   source impedance, infeed).
3. **Distance (21)** — places an in-zone and an out-of-zone point per zone, per
   fault type, against the mho characteristic.
4. **Differential (87L)** — evaluates the alpha plane region from `87LR` and
   `87LANG`, with checks generated to bracket both boundaries.
5. **Report** — the test matrix with three-phase voltage and current, magnitude
   and angle, for both ends, plus a per-station sign-off column.
6. **Findings** — the calculation record.

## The calculation record

The point of this is defensibility. Every quantity appears three times — as a
formula, as that formula with the numbers substituted, and as a result:

```
Zloop = Zf · (1 + k0)
      = 6.009 Ω ∠ 84.50° · 1.6458 ∠ −3.75°
      = 9.891 Ω ∠ 80.75°
```

- Every input carries a reference tag (`[I-01]`…) that later lines cite, so no
  number appears without a stated origin.
- Operator entries are listed separately from relay settings, because those are
  the lines a reviewer is most entitled to argue with.
- Each test point ends with an **independent check**: the derived voltages and
  currents are worked back to an impedance through the loop the relay actually
  measures and compared against the placement value. Residual runs around
  `1e-15 Ω`, which is floating-point noise.
- A section states what the record does **not** account for — line charging,
  mutual coupling, fault resistance, CT saturation, element timing. A record
  that only shows what it did compute invites a reviewer to assume the rest was
  handled.

## Fault models

| Model | What it holds | When to use it |
|---|---|---|
| `sourceImpedance` | Nothing — a real two-source fault calculation in symmetrical components | Default. The only model that gives believable remote-end quantities. |
| `constantCurrent` | Injected current | Classic bench reach test. Needs no system data. |
| `constantVoltage` | Applied voltage | Useful for some elements. |

The bench models do not bound the quantity they let float, so a far-reach point
can demand a voltage no real source could produce. Those points are flagged in
the report and in the record rather than quietly produced.

## Reading a settings file

Settings arrive in several shapes, so the input layer separates *getting rows*
from *understanding them*. Adding a format means adding a row source.

| Shape | How it is read |
|---|---|
| acSELerator HTML report | Header row located, then the **Value** column read by index |
| Native export folder | One file per settings group (`set_1.txt` .. `set_G.txt`), merged |
| Native export .zip | Unpacked in memory, then as above |
| CSV / TSV | Same header logic, quoted fields honoured |
| JSON | Tree walked for name/value pairs |
| Plain text | `NAME = VALUE` per line |

Two details that are easy to get wrong, and were:

- **The value is not the cell beside the name.** The real report is
  `Group | Setting | Range | Default Value | Value | ...`, so pair-walking
  picks up the *Range* text, which looks plausible and is entirely wrong.
- **Settings repeat per group.** A 311L carries groups 1..6 plus logic and
  port classes, so the same mnemonic appears many times. Groups are kept
  apart and the one actually read is shown in the UI.

Mnemonics are matched through alias lists in `src/core/relay.js`, and each
resolved value records which alias matched, so the record can say *"Z1 came
from Z1MAG"* and a reviewer can check that claim. Everything not used by a
calculation is still listed in the UI — a relay has hundreds of settings and
this needs about fifteen, so the point of that list is that a setting Ender
*should* have used but did not recognise is visible rather than silently
missing.

## Layout

```
src/
  core/               no Electron, fully unit tested
    complex.js        complex arithmetic, degrees at the boundary
    parseSettings.js  export -> flat setting map
    relay.js          setting map -> structured relay, with provenance
    line.js           line constants, k0, operator inputs
    faults.js         three fault models; symmetrical components
    alpha.js          87L alpha plane region and checks
    testplan.js       the test matrix
    record.js         the calculation record
    csv.js  pdf.js    exports
    plot.js           plot geometry, shared by the screen and the report
    session.js        the working session, shared by both builds
    defaults.js       what both builds assume before being told otherwise
  main/               desktop shell: window, IPC, config and report stores
  web/                browser shell: the same session, served in the page
  renderer/           pure UI; owns no state and does no arithmetic
test/                 164 tests
samples/              synthetic demo line (not from a real relay)
```

The renderer computes nothing. Every number it shows arrived already worked
out, so a UI change cannot alter a result.

## Two builds, one instrument

Ender runs as a Windows desktop app and as a web page, and they are the same
program: `src/core` holds everything that decides what a report contains, and
`src/renderer` only ever talks to a `window.ender` object. The desktop serves
that object over IPC from the main process; the web build serves it from
`src/web`, in the page. Nothing in the view layer knows which it is running
in, and a test record does not depend on which produced it.

The web build is static. There is no server, no account and no upload: the
settings files you open are read in the browser and never leave the machine,
which for relay data is the only arrangement worth offering. Saved reports go
in the browser's own storage, so they stay on that machine too — and are not
a substitute for filing the PDF somewhere real.

```
npm run web      build the browser version into site/
npm run serve    serve it at http://localhost:4173
```

Build step aside, the shared modules ship unmodified: each is wrapped in a
function so a browser can load it, with no transpiling and no minifying, and
a test asserts the shipped text still matches the file on disk. The point of
sharing the source is lost the moment what ships stops being what was tested.

## Commands

```
npm start        run the app
npm test         unit tests, no Electron needed
npm run smoke    load the demo line, build everything, render both PDFs
npm run appshots capture every screen to tmp/shots
npm run icon     regenerate build/icon.ico
npm run dist     build the NSIS installer into dist/
npm run web      build the browser version into site/
npm run serve    serve the browser version locally
npm run site     build the full published site (app + mockups)
```

## Packaging

`npm run dist` produces a single per-user installer, `Ender-Setup-<version>.exe`,
that creates a desktop and Start Menu shortcut and lets the user choose the
install directory. No admin rights needed.

Config, theme and the saved report archive live under `%APPDATA%/Ender`.
Reports are plain JSON files in a folder, so they survive an uninstall and can
be backed up by copying a directory — a record only its own tool can read is
not much of a record.
