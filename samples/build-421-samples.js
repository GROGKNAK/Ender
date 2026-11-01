'use strict';
/*
 * Regenerates the SEL-421 sample pair, then parses it back to prove the
 * values survived.
 *
 *   node samples/build-421-samples.js
 *
 * Source: SEL-421 Relay Applications Handbook, date code 20130627,
 * "230 kV Overhead Transmission Line Example" — a double-ended 230 kV line
 * with an SEL-421 at each terminal, Station S (Harvard) and Station R
 * (Princeton). The handbook works the settings for Station S in full.
 *
 * Station R is derived, and the derivation is sound rather than convenient:
 * the handbook gives the sources at both ends as identical (Z1S = Z1R =
 * 50 Ω ∠ 86° primary) on one shared line, so the line constants and the zone
 * reaches must be the same at both terminals. Only the identifiers differ.
 *
 * Unlike the SEL-311L pair, this relay carries no line differential at all.
 * That is the point of having it: it exercises the path where 87L settings
 * are simply absent and the differential half of a plan has to come back
 * empty rather than broken.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = __dirname;
const SEP = '\u001c';                      // record separator, as real files use

/* ------------------------------------------------------------- settings - */

const INFO = [
  'RELAYTYPE=SEL-421',
  'FID=SEL-421-R118-V0-Z002002-D20130627',
  'BFID=SELBOOT-4V1-R104',
  'PARTNO=0421A1X8X8X21820'
];

const globals = (s) => [
  ['SID', s.sid, 'ASCII string, 40 characters', 'STATION', 'Station Identifier'],
  ['RID', s.rid, 'ASCII string, 40 characters', 'SEL-421', 'Relay Identifier'],
  ['BID1', 'CIRCUIT BREAKER 1', 'ASCII string, 40 characters', 'BREAKER 1', 'Breaker 1 Identifier'],
  ['NUMBK', '1', 'Range = 1 to 2', '1', 'Number of Breakers in Scheme'],
  ['NFREQ', '60', 'Range = 50, 60', '60', 'Nominal System Frequency (Hz)'],
  ['PHROT', 'ABC', 'Range = ABC, ACB', 'ABC', 'System Phase Rotation'],
  ['ESS', 'N', 'Range = Y, N, 1, 2, 3, 4', 'N', 'Current and Voltage Source Selection'],
  ['BK1TYP', '3', 'Range = 1, 3', '3', 'Breaker 1 Trip Type (3 = three-pole)']
];

/* [name, value, range, default, description] */
const GROUP1 = [
  ['CTRW', '100', 'Range = 1 to 50000', '100', 'Current Transformer Ratio Input W'],
  ['PTRY', '2000', 'Range = 1.00 to 10000.00', '100.00', 'Potential Transformer Ratio Input Y'],
  ['VNOMY', '115', 'Range = 60 to 300 V secondary', '115', 'PT Nominal Voltage (L-L) Input Y'],
  ['PTRZ', '2000', 'Range = 1.00 to 10000.00', '100.00', 'Potential Transformer Ratio Input Z'],
  ['VNOMZ', '115', 'Range = 60 to 300 V secondary', '115', 'PT Nominal Voltage (L-L) Input Z'],

  ['Z1MAG', '1.95', 'Range = 0.05 to 255.00 secondary', '5.00', 'Positive-Sequence Line Impedance Magnitude'],
  ['Z1ANG', '84.00', 'Range = 5.00 to 90.00 degrees', '85.00', 'Positive-Sequence Line Impedance Angle'],
  ['Z0MAG', '6.20', 'Range = 0.05 to 255.00 secondary', '15.00', 'Zero-Sequence Line Impedance Magnitude'],
  ['Z0ANG', '81.50', 'Range = 5.00 to 90.00 degrees', '85.00', 'Zero-Sequence Line Impedance Angle'],
  ['EFLOC', 'Y', 'Range = Y, N', 'Y', 'Fault Location'],
  ['LL', '50', 'Range = 0.10 to 999', '100', 'Line Length'],

  ['E21P', '2', 'Range = N, 1 to 5', 'N', 'Mho Phase Distance Zones'],
  ['E21MG', '2', 'Range = N, 1 to 5', 'N', 'Mho Ground Distance Zones'],
  ['E21XG', 'N', 'Range = N, 1 to 5', 'N', 'Quadrilateral Ground Distance Zones'],

  ['Z1P', '1.56', 'Range = OFF, 0.05 to 64 secondary', 'OFF', 'Zone 1 Phase Reach'],
  ['Z2P', '2.34', 'Range = OFF, 0.05 to 64 secondary', 'OFF', 'Zone 2 Phase Reach'],
  ['Z3P', 'OFF', 'Range = OFF, 0.05 to 64 secondary', 'OFF', 'Zone 3 Phase Reach'],
  ['Z1MG', '1.56', 'Range = OFF, 0.05 to 64 secondary', 'OFF', 'Zone 1 Ground Reach'],
  ['Z2MG', '2.34', 'Range = OFF, 0.05 to 64 secondary', 'OFF', 'Zone 2 Ground Reach'],
  ['Z3MG', 'OFF', 'Range = OFF, 0.05 to 64 secondary', 'OFF', 'Zone 3 Ground Reach'],

  ['k0M1', '0.727', 'Range = AUTO, 0.000 to 10.000', 'AUTO', 'Zone 1 Zero-Sequence Compensation Magnitude'],
  ['k0A1', '-3.65', 'Range = -180.00 to 180.00 degrees', '0.00', 'Zone 1 Zero-Sequence Compensation Angle'],

  ['Z1D', '0.000', 'Range = OFF, 0.000 to 16000 cycles', '0.000', 'Zone 1 Time Delay'],
  ['Z2D', '20.000', 'Range = OFF, 0.000 to 16000 cycles', 'OFF', 'Zone 2 Time Delay'],
  ['ECDTD', 'Y', 'Range = Y, N', 'N', 'Distance Element Common Time Delay'],

  ['ECVT', 'N', 'Range = Y, N', 'N', 'CVT Transient Detection'],
  ['ESERCMP', 'N', 'Range = Y, N', 'N', 'Series-Compensated Line Logic'],
  ['EOOS', 'N', 'Range = Y, N', 'N', 'Out-of-Step Logic'],
  ['ELOAD', 'N', 'Range = Y, N', 'N', 'Load Encroachment'],
  ['ESOTF', 'Y', 'Range = Y, N', 'Y', 'Switch-Onto-Fault'],
  ['E50P', '1', 'Range = N, 1 to 4', 'N', 'Phase Instantaneous Overcurrent Elements'],
  ['E50G', 'N', 'Range = N, 1 to 4', 'N', 'Residual Ground Instantaneous Overcurrent Elements'],
  ['E50Q', 'N', 'Range = N, 1 to 4', 'N', 'Negative-Sequence Instantaneous Overcurrent Elements'],
  ['E51S', '1', 'Range = N, 1 to 3', 'N', 'Selectable Inverse-Time Overcurrent Element'],
  ['E32', 'AUTO', 'Range = Y, AUTO', 'AUTO', 'Directional Control'],
  ['ECOMM', 'N', 'Range = N, DCB, POTT, POTT2, POTT3, DCUB1, DCUB2', 'N', 'Communications-Assisted Tripping'],
  ['ELOP', 'Y1', 'Range = Y, Y1, N', 'Y', 'Loss-of-Potential'],
  ['EADVS', 'N', 'Range = Y, N', 'N', 'Advanced Settings']
];

const STATIONS = [
  {
    base: 'SEL421_S_HARVARD_230kV',
    sid: 'HARVARD 230 KV',
    rid: 'SEL-421 HARVARD LINE S-R',
    device: 'LINE S-R PROTECTION RELAY SEL-421 STATION S',
    source: 'Z1S = Z0S = 50 ohm at 86 deg primary = 2.50 ohm at 86 deg secondary'
  },
  {
    base: 'SEL421_R_PRINCETON_230kV',
    sid: 'PRINCETON 230 KV',
    rid: 'SEL-421 PRINCETON LINE R-S',
    device: 'LINE S-R PROTECTION RELAY SEL-421 STATION R',
    source: 'Z1R = Z0R = 50 ohm at 86 deg primary = 2.50 ohm at 86 deg secondary'
  }
];

/* --------------------------------------------------------- report export - */

const COLUMNS = ['Group', 'Setting', 'Range', 'Default Value', 'Value',
  'Delta', 'Description', 'Comments', 'Hidden'];

const cell = (cls, text) => '<td class="' + cls + '"><div class="cell">' + text + '</div></td>';

function reportHtml(s) {
  const all = globals(s).map((r) => ['G', r]).concat(GROUP1.map((r) => ['1', r]));
  const head = '<tr height="19px">' + COLUMNS.map((c) => cell('cs0', c)).join('') + '</tr>';
  const body = all.map(([group, r], i) => {
    const [name, value, range, dflt, desc] = r;
    // The Range column sits between the name and the value on purpose: that
    // is the layout a pair-walking parser gets wrong.
    return '<tr height="31px">' +
      [group, name, range, dflt, value, 'True', desc + '&nbsp;', '', 'False']
        .map((c) => cell(i % 2 ? 'cs2' : 'cs1', c)).join('') + '</tr>';
  }).join('\n');

  return '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">\n<html>\n<head>\n' +
    '<meta http-equiv="content-type" content="text/html" charset="utf-8">\n' +
    '<title>' + s.base + '</title>\n</head>\n<body>\n' +
    '<p>SEL-421 Relay Applications Handbook, date code 20130627, "230 kV Overhead\n' +
    'Transmission Line Example": a double-ended 230 kV line with an SEL-421 at each\n' +
    'terminal, Station S (Harvard) and Station R (Princeton). Faithful transcription of\n' +
    'published values, not a capture from a relay.</p>\n' +
    '<p>Source impedance behind this terminal: ' + s.source + '</p>\n' +
    '<p>FID = ' + INFO[1].split('=')[1] + '</p>\n' +
    '<p>PARTNO = ' + INFO[3].split('=')[1] + '</p>\n' +
    '<table border="0" cellspacing="0" width="1066" bgcolor="#FFFFFF">\n' +
    head + '\n' + body + '\n</table>\n</body>\n</html>\n';
}

/* --------------------------------------------------------- native export - */

/*
 * Written with LF, because the repository normalises line endings and a
 * generator that emitted CRLF would show a diff on every checkout. A real
 * export uses CRLF; the parser accepts either, and test/formats.test.js
 * covers the CRLF case explicitly with its own fixture. What matters here is
 * the shape -- [INFO] / [group] sections and NAME,"value" terminated by the
 * 0x1C record separator -- and that is preserved exactly.
 */
const section = (name, pairs) =>
  '[INFO]\n' + INFO.join('\n') + '\n[' + name + ']\n' +
  pairs.map((r) => r[0] + ',"' + r[1] + '"' + SEP).join('\n') + '\n';

const nativeFiles = (s) => [
  { name: 'set_1.txt', text: section('1', GROUP1) },
  { name: 'set_G.txt', text: section('G', globals(s)) },
  {
    name: 'Misc/Cfg.txt',
    text: '[INFO]\n' + INFO.join('\n') + '\n[CLASSES]\n' +
      'G,"Global"' + SEP + '\n1,"Group 1"' + SEP + '\n'
  },
  { name: 'Misc/Device.txt', text: s.device + '\n' }
];

/* A deflated zip, written here so the samples need no archiver. */
function zipOf(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const plain = Buffer.from(e.text, 'utf8');
    const data = zlib.deflateRawSync(plain);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(plain.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ------------------------------------------------------------------ run - */

const written = [];
for (const s of STATIONS) {
  const html = path.join(OUT, s.base + '.html');
  fs.writeFileSync(html, reportHtml(s));
  written.push(html);

  const files = nativeFiles(s);
  const folder = path.join(OUT, s.base + '_native');
  for (const f of files) {
    const target = path.join(folder, f.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.text);
  }
  written.push(folder);

  const zip = path.join(OUT, s.base + '_native.zip');
  fs.writeFileSync(zip, zipOf(files.map((f) => ({ name: s.base + '_native/' + f.name, text: f.text }))));
  written.push(zip);
}
for (const w of written) console.log('wrote ' + path.relative(path.join(OUT, '..'), w));

/* --------------------------------------------------------------- verify - */

const { readSource } = require('../src/core/bundle');
const { parseMany } = require('../src/core/parseSettings');
const { buildRelay, compareEnds } = require('../src/core/relay');

const problems = [];
/*
 * Reading a zip is asynchronous now: the web build inflates with the
 * browser's DecompressionStream, and one zip reader serving both builds means
 * the seam is async on this side too.
 */
const load = async (name) => {
  const src = await readSource(path.join(OUT, name));
  return buildRelay(parseMany(src.sources), {
    fileName: src.label, rawText: src.sources.map((x) => x.text).join('\n')
  });
};

const KEY = (r) => JSON.stringify({
  model: r.model,
  z1: [r.z1mag && r.z1mag.value, r.z1ang && r.z1ang.value],
  z0: [r.z0mag && r.z0mag.value, r.z0ang && r.z0ang.value],
  ratios: [r.ctr && r.ctr.value, r.ptr && r.ptr.value],
  k0: [r.k0mag && r.k0mag.value, r.k0ang && r.k0ang.value],
  zones: r.zones.map((z) => [z.n, z.phase, z.direction])
});

(async () => {
  for (const s of STATIONS) {
    const shapes = [s.base + '.html', s.base + '_native', s.base + '_native.zip'];
    const keys = new Set();
    for (const n of shapes) keys.add(KEY(await load(n)));
    if (keys.size !== 1) problems.push(s.base + ': the three shapes disagree');
    const r = await load(shapes[0]);
    if (!r.model) problems.push(s.base + ': no relay model detected');
    if (r.d87 && r.d87.r) problems.push(s.base + ': an SEL-421 should carry no 87L settings');
    if (r.zones.length !== 2) problems.push(s.base + ': expected two zones, got ' + r.zones.length);
  }

  const differ = compareEnds(
    await load(STATIONS[0].base + '.html'),
    await load(STATIONS[1].base + '_native.zip')
  ).filter((x) => x.status === 'differ');
  if (differ.length) problems.push('the ends disagree on: ' + differ.map((d) => d.label).join(', '));

  if (problems.length) {
    console.error('\nFAILED:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('\nverified: three shapes per end agree, both ends pair up, no 87L present');
})();
