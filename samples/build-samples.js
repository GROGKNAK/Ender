'use strict';
/*
 * Generates the sample settings files from one shared definition, so the local
 * and remote ends cannot drift apart by transcription error.
 *
 * Source: SEL-311L-1, -7 Instruction Manual, date code 20111031,
 * "Settings Example: 230kV Transmission Line Single-Pole Tripping"
 * (Section 9, Figure 9.12 "230kV Model Power System").
 *
 * The manual prints the relay at Station S in full. The Station R file is the
 * same settings with the terminal identifier changed -- see README.md for
 * exactly which values are published and which are derived.
 *
 * Two formats are written per end, both of which parseSettings already reads:
 *   .txt   the native database export ([INFO] / [1] sections, NAME,"value")
 *   .html  the report export, with the Group/Setting/Range/Value columns
 *
 *   node samples/build-samples.js
 */

const fs = require('fs');
const path = require('path');
const { parseSettings, toNumber } = require('../src/core/parseSettings');

/*
 * Every setting is [name, value, range, description]. The range strings are
 * the ones the manual prints beside each setting, which makes the HTML report
 * a realistic shape -- the Range column sitting next to the name is precisely
 * the trap the parser's column logic exists to avoid.
 */
const SECTIONS = [
  ['Identifier Labels', [
    ['RID', 'SEL-311L 87L SPT', '30 characters', 'Relay Identifier']
  ]],
  ['Line Current Differential Configuration', [
    ['APP', '87LSP', '87L, 87L21, 87L21P, 87LSP, 311L', 'Application'],
    ['EHST', 'SP1', 'SP1, SP2, N', 'High-speed tripping'],
    ['EHSDTT', 'N', 'Y, N', 'Enable high-speed direct transfer trip'],
    ['EDD', 'Y', 'Y, N', 'Enable delta current detect'],
    ['EOCTL', 'N', 'Y, N', 'Enable Open CT Logic'],
    ['CTR_X', '240', '1-6000', 'CTR at terminal connected to Channel X']
  ]],
  ['Differential Element Settings', [
    ['87LPP', '5.60', 'OFF, 1.00-10.00 A secondary', 'Phase 87L'],
    ['87L2P', 'OFF', 'OFF, 0.50-5.00 A secondary', '3I2 Negative-sequence 87L'],
    ['87LGP', '0.50', 'OFF, 0.50-5.00 A secondary', 'Ground 87L'],
    ['CTALRM', '5.10', '0.50-10.00 A secondary', 'Phase difference current alarm pickup']
  ]],
  ['Restraint Region Characteristic', [
    ['87LR', '6.0', '2.0-8.0', 'Outer Radius'],
    ['87LANG', '195', '90-270 degrees', 'Angle']
  ]],
  ['Transformer Ratios', [
    ['CTR', '240', '1-6000', 'Current Transformer Ratio'],
    ['CTRP', '200', '1-6000', 'Polarizing (IPOL) Current Transformer Ratio'],
    ['PTR', '2000', '1.00-10000.00', 'Phase (VA, VB, VC) Potential Transformer Ratio'],
    ['PTRS', '2000', '1.00-10000.00', 'Synchronism Voltage (VS) Potential Transformer Ratio']
  ]],
  ['Line Parameters', [
    ['Z1MAG', '1.42', '0.05-255.00 secondary', 'Positive-sequence line impedance magnitude'],
    ['Z1ANG', '84.70', '5.00-90.00 degrees', 'Positive-sequence line impedance angle'],
    ['Z0MAG', '4.64', '0.05-255.00 secondary', 'Zero-sequence line impedance magnitude'],
    ['Z0ANG', '73.00', '5.00-90.00 degrees', 'Zero-sequence line impedance angle'],
    ['LL', '20.00', '0.10-999.00, unitless', 'Line length']
  ]],
  ['Element Enables', [
    ['E21P', '2', 'N, 1-4, 1C-4C', 'Mho phase distance element zones'],
    ['E21MG', '2', 'N, 1-4', 'Mho ground distance element zones'],
    ['E21XG', 'N', 'N, 1-4', 'Quadrilateral ground distance element zones'],
    ['E50P', 'N', 'N, 1-3', 'Phase instantaneous element levels'],
    ['E50G', 'N', 'N, 1-4', 'Residual ground instantaneous element levels'],
    ['E50Q', 'N', 'N, 1-4', 'Negative-sequence instantaneous element levels'],
    ['E51P', 'N', 'Y, N', 'Phase time-overcurrent element'],
    ['E51G', 'Y', 'Y, N', 'Residual ground time-overcurrent element'],
    ['E51Q', 'N', 'Y, N', 'Negative-sequence time-overcurrent element'],
    ['E32', 'AUTO', 'Y, AUTO', 'Directional control'],
    ['EOOS', 'N', 'Y, N', 'Out-of-Step'],
    ['ELOAD', 'N', 'Y, N', 'Load encroachment'],
    ['ESOTF', 'N', 'Y, N', 'Switch-onto-fault'],
    ['EVOLT', 'N', 'Y, N', 'Voltage elements'],
    ['E25', 'N', 'Y, N', 'Synchronism check'],
    ['E81', 'N', 'N, 1-6', 'Frequency elements'],
    ['EFLOC', 'Y', 'Y, N', 'Fault location'],
    ['ELOP', 'Y1', 'Y, Y1, N', 'Loss-of-potential'],
    ['EBBPT', 'N', 'Y, N', 'Enable busbar PT LOP logic'],
    ['ECOMM', 'N', 'N, DCB, POTT, DCUB1, DCUB2', 'Communications-assisted trip scheme'],
    ['E79', '1', 'N, 1-4', 'Reclosures'],
    ['EZ1EXT', 'N', 'Y, N', 'Zone 1 extension'],
    ['ECCVT', 'Y', 'Y, N', 'CCVT transient detection'],
    ['ESV', 'N', 'N, 1-16', 'SELOGIC control equation Variable Timers'],
    ['ELAT', 'N', 'N, 1-16', 'SELOGIC LATCH Bits'],
    ['EDP', '2', 'N, 1-16', 'SELOGIC Display Points'],
    ['EDEM', 'THM', 'THM, ROL', 'Demand Metering'],
    ['EADVS', 'N', 'Y, N', 'Advanced settings']
  ]],
  ['Mho Phase Distance Elements', [
    ['Z1P', '1.13', 'OFF, 0.05-64.00 secondary', 'Zone 1 reach'],
    ['Z2P', '1.70', 'OFF, 0.05-64.00 secondary', 'Zone 2 reach'],
    ['50PP1', '0.5', '0.5-170.00 A secondary', 'Zone 1 phase-to-phase current fault detector']
  ]],
  ['Mho Ground Distance Elements', [
    ['Z1MG', '1.13', 'OFF, 0.05-64.00 secondary', 'Zone 1 reach'],
    ['Z2MG', '1.70', 'OFF, 0.05-64.00 secondary', 'Zone 2 reach'],
    ['50GZ1', '0.5', '0.5-170.00 A secondary', 'Zone 1 residual ground current fault detector'],
    ['50L1', '0.5', '0.5-170.00 A secondary', 'Zone 1 phase current fault detector']
  ]],
  ['Zone Time Delays', [
    ['Z1D', 'OFF', 'OFF, 0.00-16000.00 cycles', 'Zone 1 time delay'],
    ['Z2D', '20.00', 'OFF, 0.00-16000.00 cycles', 'Zone 2 time delay']
  ]],
  ['Residual Ground Time-Overcurrent', [
    ['51GP', '0.5', '0.50-16.00 A secondary', 'Pickup'],
    ['51GC', 'U3', 'U1-U5, C1-C5', 'Curve'],
    ['51GTD', '2.0', '0.50-15.00', 'Time dial'],
    ['51GRS', 'Y', 'Y, N', 'Electromechanical reset']
  ]]
];

const ENDS = [
  {
    key: 'S',
    file: 'SEL-311L_BUS_S',
    tid: 'EXAMPLE: BUS S, BREAKER 1',
    station: 'Station S',
    role: 'Local terminal',
    source: 'Z1S = Z0S = 10.00 ohm at 87.0 deg primary (1.20 ohm secondary)'
  },
  {
    key: 'R',
    file: 'SEL-311L_BUS_R',
    tid: 'EXAMPLE: BUS R, BREAKER 1',
    station: 'Station R',
    role: 'Remote terminal',
    source: 'Z1R = Z0R = 35.00 ohm at 87.0 deg primary (4.20 ohm secondary)'
  }
];

const FID = 'SEL-311L-1-R108-V0-Z003003-D20111031';

/* Settings in flat order, with the per-end terminal identifier spliced in. */
function settingsFor(end) {
  const out = [];
  for (const [section, rows] of SECTIONS) {
    for (const row of rows) out.push([section].concat(row));
    if (section === 'Identifier Labels') {
      out.push([section, 'TID', end.tid, '30 characters', 'Terminal Identifier']);
    }
  }
  return out;
}

/* The native database export: [INFO] metadata, then one section per group. */
function renderNative(end) {
  const L = [];
  L.push('[INFO]');
  L.push('RELAYTYPE=SEL-311L-1');
  L.push('FID=' + FID);
  L.push('TERMINAL=' + end.station);
  L.push('[1]');
  for (const [, name, value] of settingsFor(end)) {
    L.push(name + ',"' + value + '"');
  }
  L.push('');
  return L.join('\n');
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/*
 * The report export. The Range column deliberately sits between the name and
 * the value: an export read by walking cells in pairs would pick up the range
 * text and look entirely plausible while being wrong.
 */
function renderHtml(end) {
  const rows = settingsFor(end).map(([group, name, value, range, desc]) =>
    '    <tr><td>1</td><td>' + esc(name) + '</td><td>' + esc(range) +
    '</td><td></td><td>' + esc(value) + '</td><td>' + esc(group) +
    '</td><td>' + esc(desc) + '</td></tr>').join('\n');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Relay Settings Report</title></head>
<body>
<h1>SEL-311L Settings Report</h1>
<p>Transcribed from the SEL-311L-1, -7 Instruction Manual (date code 20111031),
"Settings Example: 230kV Transmission Line Single-Pole Tripping". The settings
values are SEL's published example; the layout of this report is modelled on an
acSELerator export and has not been verified against a real one.</p>
<p>FID = ${FID}</p>
<p>Terminal = ${esc(end.station)} (${esc(end.role)})</p>
<p>Line = Station S to Station R, 230 kV, 20 miles</p>
<p>Source impedance behind this terminal (system data, not a relay setting):
${esc(end.source)}</p>
<table border="1" cellspacing="0" cellpadding="3">
  <thead>
    <tr><th>Group</th><th>Setting</th><th>Range</th><th>Default Value</th>
        <th>Value</th><th>Category</th><th>Description</th></tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
</body>
</html>
`;
}

const outDir = __dirname;
const written = [];
for (const end of ENDS) {
  const txt = path.join(outDir, end.file + '.txt');
  const html = path.join(outDir, end.file + '.html');
  fs.writeFileSync(txt, renderNative(end));
  fs.writeFileSync(html, renderHtml(end));
  written.push([end, txt, html]);
  console.log('  ' + end.file + '.txt / .html');
}

/* ------------------------------------------------------------- checks -- */

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad += 1; };

console.log('\nparsing back through src/core/parseSettings:');
for (const [end, txt, html] of written) {
  for (const file of [txt, html]) {
    const parsed = parseSettings(fs.readFileSync(file, 'utf8'), { fileName: file });
    const label = path.basename(file).padEnd(26);

    // A value must survive the round trip exactly, comments and ranges included.
    const checks = [
      ['Z1MAG', '1.42'], ['Z1ANG', '84.70'], ['Z0MAG', '4.64'], ['Z0ANG', '73.00'],
      ['87LR', '6.0'], ['87LANG', '195'], ['87LPP', '5.60'], ['CTR', '240'],
      ['PTR', '2000'], ['Z1P', '1.13'], ['Z2P', '1.70'], ['LL', '20.00'],
      ['TID', end.tid]
    ];
    const wrong = checks.filter(([n, v]) => parsed.get(n) !== v);
    console.log('  ' + label + parsed.kind.padEnd(8) + parsed.layout.padEnd(8) +
      parsed.count + ' settings');
    for (const [n, v] of wrong) {
      fail(path.basename(file) + ': ' + n + ' = ' + JSON.stringify(parsed.get(n)) +
        ', expected ' + JSON.stringify(v));
    }
    if (toNumber(parsed.get('Z1MAG')) !== 1.42) fail(path.basename(file) + ': Z1MAG not numeric');
  }
}

// The two ends must agree on everything an 87L scheme requires to match.
const shared = ['Z1MAG', 'Z1ANG', 'Z0MAG', 'Z0ANG', 'LL', '87LR', '87LANG',
  '87LPP', '87LGP', 'CTR', 'PTR', 'Z1P', 'Z2P', 'Z1MG', 'Z2MG'];
const a = parseSettings(fs.readFileSync(written[0][2], 'utf8'));
const b = parseSettings(fs.readFileSync(written[1][2], 'utf8'));
for (const n of shared) {
  if (a.get(n) !== b.get(n)) fail('ends disagree on ' + n + ': ' + a.get(n) + ' vs ' + b.get(n));
}
if (a.get('TID') === b.get('TID')) fail('both ends carry the same TID');

console.log(bad ? '\n' + bad + ' problem(s)' : '\nall checks passed');
process.exit(bad ? 1 : 0);
