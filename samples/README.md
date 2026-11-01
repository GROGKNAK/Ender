# Sample settings — 230 kV line, Station S ↔ Station R

Two SEL-311L relays on the same two-terminal 230 kV line, one at each end.
Both relays run 87L (line current differential) **and** 21 (step distance),
which is exactly the combination Ender is built for.

## Where this came from

**SEL-311L-1, -7 Instruction Manual, date code 20111031**, Section 9,
*"Settings Example: 230 kV Transmission Line Single-Pole Tripping"*,
Figure 9.12 *"230 kV Model Power System"*.

This is SEL's own published worked example, not invented data. The manual
states plainly that the figure "shows a 230 kV transmission line with SEL-311L
protection at Stations S and R".

## What is published vs. derived

| | |
|---|---|
| **Published by SEL** | Every setting value, the full system data table, and the source impedance behind *both* terminals. The manual prints the relay at **Station S** in full. |
| **Derived here** | The **Station R** file. It is the Station S settings with `TID` changed to `BUS R`. |

The derivation is sound rather than convenient: an 87L scheme will not work
unless the line parameters and the differential characteristic agree at every
terminal, so `Z1MAG`, `Z1ANG`, `Z0MAG`, `Z0ANG`, `LL`, `87LR`, `87LANG` and the
pickups **must** be identical at both ends. The data table gives CTR = 240 and
PTR = 2000 at both stations, so the ratios match too. `build-samples.js`
asserts this — it reports exactly three differing lines between the two files.

What genuinely differs between the ends is the **source impedance**, and that
is system data, not a relay setting. It is recorded as a comment in each file
because Ender's constant-source-impedance fault model needs it.

## System data (Table 9.9)

| Parameter | Primary | Secondary |
|---|---|---|
| Line-to-line voltage | 230 kV | 115 V |
| Nominal frequency | 60 Hz | |
| Line length S–R | 20 miles | |
| Line impedance Z1L | 11.86 Ω ∠ 84.70° | 1.42 Ω ∠ 84.70° |
| Line impedance Z0L | 38.66 Ω ∠ 73.00° | 4.64 Ω ∠ 73.00° |
| Source S (Z1S = Z0S) | 10 Ω ∠ 87° | 1.20 Ω ∠ 87° |
| Source R (Z1R = Z0R) | 35 Ω ∠ 87° | 4.20 Ω ∠ 87° |
| PTR | 230 kV : 115 V | 2000 : 1 |
| CTR | 1200 : 5 | 240 : 1 |
| CT burden class (S and R) | C800 | |
| Line charging current | 16 A | 0.07 A |
| Max forward load at S | 1100 A | 4.58 A |
| Max reverse load at S | 600 A | 2.50 A |
| Max load imbalance | 5% | |
| Phase rotation | ABC | |
| 87L communications | Single channel | |

Secondary conversion factor `k = CTR / PTR = 240 / 2000 = 0.12`.

**The sources are deliberately asymmetric** — 10 Ω behind S against 35 Ω behind
R. That is useful: it produces genuinely unequal infeed from the two ends, so a
fault calculation that quietly assumes a symmetric line will give visibly wrong
remote-end quantities instead of passing by luck.

## Cross-checks

Everything below was recomputed from the published primary values and agrees:

- `11.86 × 0.12 = 1.423` → published `Z1MAG = 1.42` ✓
- `38.66 × 0.12 = 4.639` → published `Z0MAG = 4.64` ✓
- `Z1P = 1.13` is **79.6%** of `Z1MAG` → the manual's stated 80% ✓
- `Z2P = 1.70` is **119.7%** of `Z1MAG` → the manual's stated 120% ✓
- `k0 = (Z0 − Z1) / (3 · Z1) = 0.7658 ∠ −16.76°`, so `1 + k0 = 1.7473 ∠ −7.26°`

That last one matters. In the **SEL-421 Applications Handbook** (date code
20130627) the relay computes its own compensation factor for a different
230 kV line (`Z1 = 1.95 ∠ 84.00°`, `Z0 = 6.20 ∠ 81.50°`) and prints
`k0M1 := 0.727`, `k0A1 := 3.65`. Feeding those same impedances to Ender's k0
routine returns **0.727 ∠ −3.65°** — an exact match for the magnitude and the
angle. The compensation maths is therefore checked against a relay's own
calculation, not just against itself.

## Two defects in SEL's published arithmetic

Worth knowing, because a parser will faithfully reproduce them:

1. The manual sets `Z1MAG = 1.42` but then computes the Zone 1 reach as
   `1.41 × 0.8 = 1.13`. Both round to `1.13`, so the setting is right, but the
   intermediate value is inconsistent with the setting above it.
2. The Zone 2 formula prints as `Z2P = 1.41 × (CTR / PTR) × 1.2 = 1.7`. Applied
   literally that gives `0.203`, not `1.7` — the `CTR/PTR` term has already been
   applied. The printed *answer* (`1.70 = 1.42 × 1.2`) is correct.

Neither affects the settings themselves. They make reasonable regression cases:
the parser should return what the file says, not what the arithmetic implies.

## The files

Each end is written in both formats `parseSettings` supports, so the same
published values can be fed through either code path:

| File | Format | Parsed as |
|---|---|---|
| `SEL-311L_BUS_S.txt` | Native database export — `[INFO]` / `[1]` sections, `NAME,"value"` | `native` |
| `SEL-311L_BUS_S.html` | Report export — Group / Setting / Range / Default Value / Value columns | `column` |
| `SEL-311L_BUS_R.txt` | as above, remote end | `native` |
| `SEL-311L_BUS_R.html` | as above, remote end | `column` |

The HTML deliberately puts the **Range** column between the name and the value.
That is the trap `parseSettings` was written to avoid: walking cells in pairs
picks up `0.05-255.00 secondary` instead of `1.42` and looks entirely
reasonable while being wrong. These files will catch that regression if it ever
comes back.

## What these files are not

They are a **faithful transcription of SEL's published values**, not a capture
from a real relay or a verified acSELerator export.

I searched specifically for a genuine HTML export and could not find one. There
is no public documentation of that file's structure, the three GitHub projects
that parse SEL formats (`sellib`, `rdb-tool`, `SELRelay_DataParser`) ship **no**
settings fixtures at all, and real settings for an identified line are the kind
of material utilities treat as confidential. So the exact HTML layout still
wants one real sample to confirm.

That limitation is narrower than it sounds. What these files pin down is the
part that drives the calculations — the setting *names*, their value formats,
and the relationships that must hold across two terminals of one line. If the
real export turns out to nest its table differently, that is a change to one
row-extraction function, not to the calculation or cross-check logic.

## Regenerating

```bash
node samples/build-samples.js
```

This rewrites all four files and then parses them back through
`src/core/parseSettings` to confirm that every key value survives the round
trip, that both ends still agree on everything an 87L scheme requires to match
(`Z1MAG`, `Z1ANG`, `Z0MAG`, `Z0ANG`, `LL`, `87LR`, `87LANG`, pickups, ratios and
zone reaches), and that the two terminal identifiers still differ. It exits
non-zero if any of that stops being true.
