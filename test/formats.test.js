'use strict';
/*
 * Format coverage for the settings parser.
 *
 * Fixtures are synthetic but shaped like the real exports, including the
 * nine-column acSELerator report where the value is NOT the cell beside the
 * name. Nothing here embeds real substation data.
 */
const test = require('node:test');
const assert = require('node:assert');

const { parseSettings, toNumber } = require('../src/core/parseSettings');
const { buildRelay, validateRelay } = require('../src/core/relay');

/* The real layout: Group | Setting | Range | Default Value | Value | ... */
function reportRow(group, name, range, dflt, value) {
  return '<tr>' + [group, name, range, dflt, value, 'True', name + ' description', '', 'False']
    .map((c) => '<td class="cs1"><div class="cell">' + c + '</div></td>').join('') + '</tr>';
}

const REPORT = '<html><body><table>' +
  '<tr>' + ['Group', 'Setting', 'Range', 'Default Value', 'Value', 'Delta', 'Description', 'Comments', 'Hidden']
    .map((h) => '<td class="cs0"><div class="cell">' + h + '</div></td>').join('') + '</tr>' +
  reportRow('1', 'RID', 'Range = ASCII string with a maximum length of 30.', 'SEL-311L', 'SEL-311L LINE RELAY L2P') +
  reportRow('1', 'CTR', 'Range = 1 to 6000', '200', '120') +
  reportRow('1', 'PTR', 'Range = 1.00 to 10000.00', '100.00', '63.50') +
  reportRow('1', 'Z1MAG', 'Range = 0.05 to 255.00', '5.00', '7.80') +
  reportRow('1', 'Z1ANG', 'Range = 5.00 to 90.00', '85.00', '84.00') +
  reportRow('1', 'Z0MAG', 'Range = 0.05 to 255.00', '15.00', '24.80') +
  reportRow('1', 'Z0ANG', 'Range = 5.00 to 90.00', '85.00', '81.50') +
  reportRow('1', 'Z1P', 'Range = 0.05 to 64.00, OFF', 'OFF', '6.24') +
  reportRow('1', 'Z2P', 'Range = 0.05 to 64.00, OFF', 'OFF', '9.36') +
  reportRow('1', 'k0M1', 'Range = 0.000 to 10.000', '0.000', '0.726') +
  reportRow('1', 'k0A1', 'Range = -180.00 to 180.00', '0.00', '-3.69') +
  reportRow('1', '87LR', 'Range = 2.0 to 8.0', '6.0', '6.0') +
  reportRow('1', '87LANG', 'Range = 90 to 195', '195', '195') +
  reportRow('1', 'E21P', 'Range = N, 1, 2, 3, 4', 'N', 'N') +
  reportRow('1', 'E87L', 'Range = N, 1, 2', 'N', '2') +
  // second settings group, deliberately different, to prove group selection
  reportRow('2', 'Z1MAG', 'Range = 0.05 to 255.00', '5.00', '99.99') +
  reportRow('2', 'Z1P', 'Range = 0.05 to 64.00, OFF', 'OFF', '11.11') +
  '</table></body></html>';

test('the value column is read, not the cell beside the name', () => {
  const p = parseSettings(REPORT, { fileName: '311.html' });
  assert.strictEqual(p.get('Z1MAG'), '7.80');
  assert.strictEqual(p.get('RID'), 'SEL-311L LINE RELAY L2P');
  assert.strictEqual(p.layout, 'column');
  // The failure this guards against: picking up the Range text as a value.
  assert.ok(!String(p.get('Z1MAG')).includes('Range'));
  assert.ok(!String(p.get('CTR')).includes('Range'));
});

test('settings groups are kept apart and group 1 is the default', () => {
  const p = parseSettings(REPORT);
  assert.deepStrictEqual(p.groups, ['1', '2']);
  assert.strictEqual(p.group, '1');
  assert.strictEqual(p.get('Z1MAG'), '7.80');
  assert.strictEqual(p.byGroup['2'].Z1MAG, '99.99');
});

test('a different group can be selected', () => {
  const p = parseSettings(REPORT, { group: '2' });
  assert.strictEqual(p.group, '2');
  assert.strictEqual(p.get('Z1MAG'), '99.99');
  assert.strictEqual(p.get('Z1P'), '11.11');
  // Settings only present in group 1 still resolve.
  assert.strictEqual(p.get('87LR'), '6.0');
});

test('lowercase mnemonics are read', () => {
  const p = parseSettings(REPORT);
  assert.strictEqual(p.get('K0M1'), '0.726');
  assert.strictEqual(p.get('k0a1'), '-3.69');
});

test('element enables are interpreted, not assumed', () => {
  const r = buildRelay(parseSettings(REPORT), { fileName: '311.html', rawText: REPORT });
  assert.strictEqual(r.enables.distancePhase, false, 'E21P = N');
  assert.strictEqual(r.enables.differential, true, 'E87L = 2');
  const problems = validateRelay(r);
  assert.ok(problems.some((x) => x.field === 'group' && /2 settings groups/.test(x.message)));
});

test('an explicit k0 setting is picked up from the report', () => {
  const r = buildRelay(parseSettings(REPORT));
  assert.strictEqual(r.k0mag.value, 0.726);
  assert.strictEqual(r.k0ang.value, -3.69);
  assert.strictEqual(r.k0mag.from, 'K0M1');
});

/* ------------------------------------------------------------- csv / tsv - */

const CSV = [
  'Group,Setting,Range,Default Value,Value,Description',
  '1,RID,"ASCII, max 30",SEL-411L,"ALPHA, LINE 1",Relay id',
  '1,Z1MAG,0.05 to 255.00,5.00,8.32,Positive sequence',
  '1,Z1ANG,5.00 to 90.00,85.00,84.50,Angle',
  '1,Z0MAG,0.05 to 255.00,15.00,24.50,Zero sequence',
  '1,Z0ANG,5.00 to 90.00,85.00,78.20,Angle',
  '1,Z1P,"0.05 to 64.00, OFF",OFF,7.07,Zone 1'
].join('\n');

test('csv export is read by the same column logic', () => {
  const p = parseSettings(CSV, { fileName: 'relay.csv' });
  assert.strictEqual(p.kind, 'delimited');
  assert.strictEqual(p.get('Z1MAG'), '8.32');
  assert.strictEqual(p.get('Z1P'), '7.07');
});

test('quoted csv fields containing commas survive', () => {
  const p = parseSettings(CSV, { fileName: 'relay.csv' });
  assert.strictEqual(p.get('RID'), 'ALPHA, LINE 1');
});

test('tab separated is read too', () => {
  const tsv = CSV.split('\n').map((l) =>
    l.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '\t')).join('\n');
  const p = parseSettings(tsv, { fileName: 'relay.tsv' });
  assert.strictEqual(p.get('Z1ANG'), '84.50');
});

/* ------------------------------------------------------------------ json - */

test('grid configurator style json is read', () => {
  const json = JSON.stringify({
    device: { model: 'SEL-411L' },
    settings: [
      { group: '1', name: 'Z1MAG', value: '8.32' },
      { group: '1', name: 'Z1ANG', value: 84.5 },
      { group: '1', name: 'Z0MAG', value: '24.50' },
      { group: '2', name: 'Z1MAG', value: '1.11' }
    ]
  });
  const p = parseSettings(json, { fileName: 'relay.json' });
  assert.strictEqual(p.kind, 'json');
  assert.strictEqual(p.get('Z1MAG'), '8.32');
  assert.strictEqual(p.get('Z1ANG'), '84.5');
  assert.strictEqual(p.byGroup['2'].Z1MAG, '1.11');
});

test('a flat json object of name to value is read', () => {
  const p = parseSettings(JSON.stringify({ Z1MAG: 8.32, Z1ANG: 84.5, RID: 'ALPHA' }),
    { fileName: 'flat.json' });
  assert.strictEqual(p.get('Z1MAG'), '8.32');
  assert.strictEqual(p.get('RID'), 'ALPHA');
});

/* ------------------------------------------------------------- plain text */

test('a plain text settings dump is read', () => {
  const txt = ['FID = SEL-311L-R305-V0', 'RID = ALPHA_LN1', 'Z1MAG = 8.32',
    'Z1ANG = 84.50', 'Z0MAG = 24.50', 'Z0ANG = 78.20'].join('\n');
  const p = parseSettings(txt, { fileName: 'settings.txt' });
  assert.strictEqual(p.get('Z1MAG'), '8.32');
  assert.ok(String(p.get('FID')).includes('SEL-311L'));
});

test('an export with no header falls back to name/value pairs', () => {
  const html = '<table><tr><td>Z1MAG</td><td>8.32</td><td>Z1ANG</td><td>84.50</td></tr></table>';
  const p = parseSettings(html, { fileName: 'simple.html' });
  assert.strictEqual(p.layout, 'pair');
  assert.strictEqual(p.get('Z1MAG'), '8.32');
  assert.strictEqual(p.get('Z1ANG'), '84.50');
});

test('an unreadable file yields nothing rather than throwing', () => {
  for (const junk of ['', 'not a settings file at all', '<html><body><p>hello</p></body></html>']) {
    const p = parseSettings(junk, { fileName: 'junk.html' });
    assert.ok(p.count >= 0);
    assert.strictEqual(typeof p.get('Z1MAG'), 'undefined');
  }
});

test('OFF and N read as absent, not as zero', () => {
  assert.strictEqual(toNumber('OFF'), null);
  assert.strictEqual(toNumber('N'), null);
  assert.strictEqual(toNumber('0.00'), 0);
});

/* ------------------------------------------------- native export format - */

const { parseMany } = require('../src/core/parseSettings');
const { readZip, sortSources } = require('../src/core/bundle');
const zlib = require('zlib');

/* The native files terminate each line with a record separator (0x1C). */
const SEP = '\u001c';
const nativeGroup = (group, lines) =>
  '[INFO]\r\nRELAYTYPE=SEL-311L-1\r\nFID=SEL-311L-1-R502-V0-Z106006\r\n[' + group + ']\r\n' +
  lines.map(([k, v]) => k + ',"' + v + '"' + SEP).join('\r\n') + '\r\n';

const SET_1 = nativeGroup('1', [
  ['RID', 'SEL-311L LINE RELAY L2P'], ['CTR', '120'], ['PTR', '63.50'],
  ['Z1MAG', '7.80'], ['Z1ANG', '84.00'], ['Z0MAG', '24.80'], ['Z0ANG', '81.50'],
  ['Z1P', '6.24'], ['Z2P', '9.36'], ['k0M1', '0.726'], ['k0A1', '-3.69'],
  ['87LR', '6.0'], ['87LANG', '195'], ['E87L', '2'], ['E21P', 'N']
]);
const SET_2 = nativeGroup('2', [['Z1MAG', '1.11'], ['Z1P', '2.22']]);
const SET_G = nativeGroup('G', [['NFREQ', '60'], ['PHROT', 'ABC']]);

test('the native export format is read', () => {
  const p = parseSettings(SET_1, { fileName: 'set_1.txt' });
  assert.strictEqual(p.kind, 'native');
  assert.strictEqual(p.get('Z1MAG'), '7.80');
  assert.strictEqual(p.get('RID'), 'SEL-311L LINE RELAY L2P');
  assert.deepStrictEqual(p.groups, ['1']);
});

test('record separators are stripped from native values', () => {
  const p = parseSettings(SET_1, { fileName: 'set_1.txt' });
  for (const name of ['Z1MAG', 'RID', 'CTR', '87LANG']) {
    const v = String(p.get(name));
    assert.ok(!/[\u0000-\u001f]/.test(v), name + ' still carries a control character: ' + JSON.stringify(v));
    assert.ok(!v.includes('"'), name + ' still carries a quote: ' + JSON.stringify(v));
  }
});

test('[INFO] is device metadata, not a settings group', () => {
  const p = parseSettings(SET_1, { fileName: 'set_1.txt' });
  assert.ok(!p.groups.includes('INFO'));
  assert.ok(String(p.get('FID')).includes('SEL-311L'));
});

test('a folder of per-group files reads as one relay', () => {
  const p = parseMany([
    { name: 'set_1.txt', text: SET_1 },
    { name: 'set_2.txt', text: SET_2 },
    { name: 'set_G.txt', text: SET_G }
  ]);
  assert.deepStrictEqual(p.groups, ['1', '2', 'G']);
  assert.strictEqual(p.group, '1');
  assert.strictEqual(p.get('Z1MAG'), '7.80', 'group 1 wins');
  assert.strictEqual(p.byGroup['2'].Z1MAG, '1.11', 'group 2 is kept');
  assert.strictEqual(p.get('NFREQ'), '60', 'global settings still resolve');
  assert.strictEqual(p.files.length, 3);
});

test('the merged relay matches what one combined file would give', () => {
  const p = parseMany([{ name: 'set_1.txt', text: SET_1 }, { name: 'set_2.txt', text: SET_2 }]);
  const r = buildRelay(p, { fileName: 'native', rawText: SET_1 });
  assert.strictEqual(r.z1mag.value, 7.80);
  assert.strictEqual(r.k0mag.value, 0.726);
  assert.strictEqual(r.zones.length, 2);
  assert.strictEqual(r.enables.differential, true);
  assert.strictEqual(r.enables.distancePhase, false);
});

/* ------------------------------------------------------------------ zip - */

function zipOf(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const plain = Buffer.from(e.text, 'utf8');
    const deflate = e.deflate !== false;
    const data = deflate ? zlib.deflateRawSync(plain) : plain;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(0, 14);                 // crc, not verified by the reader
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt32LE(0, 16);
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

test('a zip of the native export is read', async () => {
  const zip = zipOf([
    { name: 'RELAY/set_1.txt', text: SET_1 },
    { name: 'RELAY/set_2.txt', text: SET_2 },
    { name: 'RELAY/Misc/Device.txt', text: 'LINE NO. 1 PROTECTION RELAY' },
    { name: 'RELAY/Misc/thumb.png', text: 'not text' }
  ]);
  const files = await readZip(zip);
  assert.ok(files.some((f) => f.name.endsWith('set_1.txt')));
  assert.ok(!files.some((f) => f.name.endsWith('.png')), 'binary entries are skipped');

  const p = parseMany(sortSources(files));
  assert.strictEqual(p.get('Z1MAG'), '7.80');
  assert.deepStrictEqual(p.groups, ['1', '2']);
});

test('stored (uncompressed) zip entries are read too', async () => {
  const zip = zipOf([{ name: 'set_1.txt', text: SET_1, deflate: false }]);
  const files = await readZip(zip);
  assert.strictEqual(files.length, 1);
  assert.ok(files[0].text.includes('Z1MAG'));
});

test('protection groups are read before anything else in the folder', () => {
  const sorted = sortSources([
    { name: 'Misc/Cfg.txt', text: '' }, { name: 'set_L1.txt', text: '' },
    { name: 'set_2.txt', text: '' }, { name: 'set_1.txt', text: '' }
  ]).map((f) => f.name);
  assert.deepStrictEqual(sorted, ['set_1.txt', 'set_2.txt', 'set_L1.txt', 'Misc/Cfg.txt']);
});

test('a file that is not a zip is refused clearly', async () => {
  await assert.rejects(() => readZip(Buffer.from('definitely not a zip')), /not a zip/i);
});

/* ---------------------------------------------------------------- locking */

const { buildLine } = require('../src/core/line');
const { buildPlan, lockKeyOf } = require('../src/core/testplan');
const { buildRecord } = require('../src/core/record');

function demoLine(op) {
  const r = buildRelay(parseSettings(REPORT), { fileName: 'r.html', rawText: REPORT });
  return buildLine(r, r, Object.assign({ faultModel: 'constantCurrent' }, op));
}

test('a lock key survives the settings being changed', () => {
  const a = buildPlan(demoLine({ inZonePct: 85 })).distance[0];
  const b = buildPlan(demoLine({ inZonePct: 70 })).distance[0];
  assert.strictEqual(lockKeyOf(a), lockKeyOf(b), 'same test, different percentage');
  assert.notStrictEqual(a.pctOfReach, b.pctOfReach);
});

test('a locked row ignores later settings changes', () => {
  const first = buildPlan(demoLine({ inZonePct: 85, testCurrent: 5 }));
  const row = first.distance[0];
  const key = lockKeyOf(row);
  const locks = { [key]: { row, operator: { inZonePct: 85, testCurrent: 5 }, at: '2026-01-01T00:00:00Z' } };

  const after = buildPlan(demoLine({ inZonePct: 60, testCurrent: 2 }), { locks });
  const locked = after.distance.find((r) => r.lockKey === key);
  const free = after.distance.find((r) => r.lockKey !== key && r.pointKey === 'in');

  assert.strictEqual(locked.locked, true);
  assert.strictEqual(locked.pctOfReach, 85, 'locked row kept its placement');
  assert.strictEqual(free.pctOfReach, 60, 'unlocked rows moved');
  assert.strictEqual(after.lockedCount, 1);
});

test('unlocking returns a row to the live settings', () => {
  const first = buildPlan(demoLine({ inZonePct: 85 }));
  const key = lockKeyOf(first.distance[0]);
  const locks = { [key]: { row: first.distance[0], operator: {}, at: 'x' } };
  const withLock = buildPlan(demoLine({ inZonePct: 60 }), { locks });
  const without = buildPlan(demoLine({ inZonePct: 60 }), { locks: {} });
  assert.strictEqual(withLock.distance[0].pctOfReach, 85);
  assert.strictEqual(without.distance[0].pctOfReach, 60);
  assert.strictEqual(without.lockedCount, 0);
});

test('the record declares a locked row and what it was built on', () => {
  const line85 = demoLine({ inZonePct: 85, testCurrent: 5 });
  const row = buildPlan(line85).distance[0];
  const locks = {
    [lockKeyOf(row)]: { row, operator: line85.operator, at: '2026-01-01T00:00:00Z' }
  };
  const line60 = demoLine({ inZonePct: 60, testCurrent: 2 });
  const plan = buildPlan(line60, { locks });
  const rec = buildRecord({ line: line60, plan, local: null, remote: null });

  const lockedTest = rec.tests.find((t) => t.locked);
  assert.ok(lockedTest, 'the record marks the locked test');
  const banner = lockedTest.blocks.find((b) => b.symbol === 'LOCKED');
  assert.ok(banner, 'the locked test carries a LOCKED block');
  const text = JSON.stringify(banner.rows);
  assert.ok(/test current/.test(text), 'it states the test current it used');
  assert.ok(/in-zone point/.test(text), 'it states the placement it used');
  assert.strictEqual(rec.lockedTests, 1);
  assert.ok(rec.assumptions.some((a) => /locked/.test(a)), 'exclusions mention the locked points');
});

test('a locked row still self-checks', () => {
  const line = demoLine({ inZonePct: 85 });
  const row = buildPlan(line).distance[0];
  const locks = { [lockKeyOf(row)]: { row, operator: line.operator, at: 'x' } };
  const other = demoLine({ inZonePct: 60, faultModel: 'sourceImpedance' });
  const rec = buildRecord({ line: other, plan: buildPlan(other, { locks }), local: null, remote: null });
  assert.strictEqual(rec.selfCheck.ok, true);
});

/* --------------------------------------------------- 87L override --------- */

test('an 87L override changes the characteristic but keeps the relay values', () => {
  const plain = demoLine();
  assert.strictEqual(plain.d87.r, 6.0);
  assert.ok(!plain.d87.overridden);

  const tweaked = demoLine({ d87Override: { r: 4.0 } });
  assert.strictEqual(tweaked.d87.r, 4.0);
  assert.deepStrictEqual(tweaked.d87.overridden, ['r']);
  assert.strictEqual(tweaked.d87.base.r, 6.0, 'the relay value is kept alongside');
  assert.strictEqual(tweaked.d87.ang, plain.d87.ang, 'untouched fields are unchanged');
});

test('an override equal to the relay value is not treated as an override', () => {
  const same = demoLine({ d87Override: { r: 6.0 } });
  assert.ok(!same.d87.overridden);
});

test('overriding the characteristic moves the differential checks', () => {
  const plain = buildPlan(demoLine()).differential;
  const tweaked = buildPlan(demoLine({ d87Override: { ang: 120 } })).differential;
  const edgeA = plain.find((d) => d.label === 'Angle edge, inside');
  const edgeB = tweaked.find((d) => d.label === 'Angle edge, inside');
  assert.notStrictEqual(edgeA.remote.angle, edgeB.remote.angle,
    'the checks follow the new angular boundary');
});

/* ----------------------------------------------------------- catalogue --- */

test('settings are classified as used, disregarded or not used', () => {
  const r = buildRelay(parseSettings(REPORT), { fileName: 'r.html', rawText: REPORT });
  const byName = Object.fromEntries(r.catalogue.map((c) => [c.name, c]));

  assert.strictEqual(byName.Z1MAG.status, 'used');
  assert.strictEqual(byName.Z1MAG.purpose, 'Positive-sequence line impedance');
  assert.strictEqual(byName.Z1P.purpose, 'Zone 1 phase reach');

  // Z1MAG differs in group 2, but group 1 was read and used, so "used" wins.
  assert.ok(byName.Z1MAG.others.some((o) => o.group === '2'));
  assert.ok(r.catalogue.every((c) => ['used', 'duplicate', 'unused'].includes(c.status)));
});

test('a setting only present in a disregarded group is flagged', () => {
  const extra = REPORT.replace('</table>',
    reportRow('2', 'ONLYG2', 'Range', '0', '5') +
    reportRow('1', 'ONLYG2', 'Range', '0', '9') + '</table>');
  const r = buildRelay(parseSettings(extra), { fileName: 'r.html' });
  const entry = r.catalogue.find((c) => c.name === 'ONLYG2');
  assert.strictEqual(entry.status, 'duplicate');
  assert.strictEqual(entry.value, '9', 'the chosen group wins');
  assert.deepStrictEqual(entry.others, [{ group: '2', value: '5' }]);
});

/* ------------------------------------------------- omit from report ------ */

const { applyOmissions } = require('../src/core/testplan');
const { testPlanCsv } = require('../src/core/csv');
const { testReportPdf, recordPdf } = require('../src/core/pdf');

test('omitted points are dropped and counted', () => {
  const line = demoLine();
  const full = buildPlan(line);
  const key = full.distance[2].lockKey;
  const cut = applyOmissions(full, { [key]: true });

  assert.strictEqual(cut.distance.length, full.distance.length - 1);
  assert.strictEqual(cut.omittedCount, 1);
  assert.ok(!cut.distance.some((r) => r.lockKey === key));
  assert.strictEqual(cut.omitted[0].id, full.distance[2].id);
  assert.strictEqual(cut.counts.distance, full.counts.distance - 1);
  assert.strictEqual(cut.counts.total, full.counts.total - 1);
});

test('omitting nothing leaves the plan untouched', () => {
  const full = buildPlan(demoLine());
  const same = applyOmissions(full, {});
  assert.strictEqual(same.distance.length, full.distance.length);
  assert.strictEqual(same.omittedCount, 0);
});

test('omitting a flagged point also drops its warning from the counts', () => {
  // A low threshold so this fixture's short zones trip it; the point is the
  // counting, not the particular voltage.
  const line = demoLine({ faultModel: 'constantCurrent', warnVolts: 40 });
  const full = buildPlan(line);
  const hot = full.distance.find((r) => r.voltageWarning);
  assert.ok(hot, 'the threshold is low enough to flag something');
  assert.ok(full.counts.voltageWarnings > 0);
  const cut = applyOmissions(full, { [hot.lockKey]: true });
  assert.strictEqual(cut.counts.voltageWarnings, full.counts.voltageWarnings - 1);
});

test('the record drops omitted points and says nothing about them', () => {
  const line = demoLine();
  const full = buildPlan(line);
  const dropped = full.distance[0];
  const cut = applyOmissions(full, { [dropped.lockKey]: true });
  const rec = buildRecord({ line, plan: cut, local: null, remote: null });

  assert.strictEqual(rec.tests.length, full.distance.length - 1);
  assert.ok(!rec.tests.some((t) => t.id === dropped.id), 'the point is gone');
  // Deliberately silent: the record covers what was tested, not what was dropped.
  assert.ok(!rec.assumptions.some((a) => /omit/i.test(a)), 'no mention in the exclusions');
  assert.ok(!JSON.stringify(rec.tests).includes('omit'), 'no mention anywhere in the tests');
});

test('the csv notes the omission; the pdf deliverable does not', async () => {
  const line = demoLine();
  const full = buildPlan(line);
  const cut = applyOmissions(full, { [full.distance[0].lockKey]: true });

  // The CSV is the working file: whoever ran the tests should see a point was
  // dropped. The PDF is the deliverable and carries only what was tested.
  const body = testPlanCsv({ plan: cut, line, names: {} }).replace(/^﻿/, '');
  assert.ok(/Omitted from this report/.test(body), 'the csv states the omission');
  assert.ok(/T01/.test(body.split('Omitted from this report')[1] || ''), 'and names the point');
  assert.ok(!/^T01,/m.test(body), 'while the row itself is gone from the body');
  assert.ok(/^T02,/m.test(body), 'the remaining rows are intact');

  const bytes = await testReportPdf({ plan: cut, line, names: {}, org: {} });
  assert.ok(bytes.length > 2000);
});

test('a report name reaches the pdf and is sanitised for the fonts', async () => {
  const line = demoLine();
  const plan = buildPlan(line);
  const named = await testReportPdf({
    plan, line, names: { local: 'A', remote: 'B' }, org: {},
    reportTitle: 'Line 1 — spring outage Ω'
  });
  const plain = await testReportPdf({ plan, line, names: { local: 'A', remote: 'B' }, org: {} });
  assert.ok(named.length > 2000);
  assert.notStrictEqual(named.length, plain.length, 'the title changes the document');
});

test('a report with every point omitted still renders', async () => {
  const line = demoLine();
  const full = buildPlan(line);
  const all = {};
  for (const r of full.distance) all[r.lockKey] = true;
  const cut = applyOmissions(full, all);
  assert.strictEqual(cut.distance.length, 0);
  assert.strictEqual(cut.omittedCount, full.distance.length);

  const rec = buildRecord({ line, plan: cut, local: null, remote: null });
  assert.strictEqual(rec.tests.length, 0);
  assert.strictEqual(rec.selfCheck.ok, true, 'no tests means no failed residuals');

  const bytes = await testReportPdf({ plan: cut, line, names: {}, org: {} });
  assert.ok(bytes.length > 1500);
  const rbytes = await recordPdf({ record: rec, line, names: {}, org: {}, provenance: [] });
  assert.ok(rbytes.length > 1500);
});

/* --------------------------------------- differential lock and omit ------ */

const { diffKeyOf } = require('../src/core/testplan');

test('a differential check carries a stable lock key', () => {
  const a = buildPlan(demoLine()).differential[0];
  const b = buildPlan(demoLine({ d87Override: { r: 4 } })).differential[0];
  assert.strictEqual(a.lockKey, b.lockKey, 'the key survives a characteristic change');
  assert.ok(a.lockKey.startsWith('D|'), 'and cannot collide with a distance key');
  assert.notStrictEqual(diffKeyOf(a), buildPlan(demoLine()).differential[1].lockKey);
});

test('a locked differential check ignores a characteristic change', () => {
  const first = buildPlan(demoLine());
  const check = first.differential.find((d) => d.label === 'Outer radius, outside');
  const locks = { [check.lockKey]: { row: check, operator: {}, at: 'x' } };

  const after = buildPlan(demoLine({ d87Override: { r: 4 } }), { locks });
  const locked = after.differential.find((d) => d.lockKey === check.lockKey);
  const free = after.differential.find((d) => d.label === 'Outer radius, inside');

  assert.strictEqual(locked.locked, true);
  assert.strictEqual(locked.ratio.magnitude, check.ratio.magnitude, 'frozen');
  assert.notStrictEqual(free.ratio.magnitude, first.differential
    .find((d) => d.label === 'Outer radius, inside').ratio.magnitude, 'the rest moved');
});

test('omitting a differential check drops it from the export', () => {
  const plan = buildPlan(demoLine());
  const check = plan.differential[0];
  const cut = applyOmissions(plan, { [check.lockKey]: true });

  assert.strictEqual(cut.differential.length, plan.differential.length - 1);
  assert.ok(!cut.differential.some((d) => d.lockKey === check.lockKey));
  assert.strictEqual(cut.counts.differential, plan.counts.differential - 1);
  assert.strictEqual(cut.omittedCount, 1);
  // Distance points are untouched by a differential omission.
  assert.strictEqual(cut.distance.length, plan.distance.length);
});

test('distance and differential omissions can be mixed', () => {
  const plan = buildPlan(demoLine());
  const cut = applyOmissions(plan, {
    [plan.distance[0].lockKey]: true,
    [plan.differential[0].lockKey]: true
  });
  assert.strictEqual(cut.omittedCount, 2);
  assert.strictEqual(cut.distance.length, plan.distance.length - 1);
  assert.strictEqual(cut.differential.length, plan.differential.length - 1);
  assert.strictEqual(cut.counts.total, plan.counts.total - 2);
});

/* ------------------------------------------- distance supervision -------- */

// The base fixture carries no fault detectors, so supervision needs its own.
const SUPERVISED = REPORT.replace('</table>',
  reportRow('1', '50PP1', 'Range = 0.25 to 100.00', '0.50', '0.50') +
  reportRow('1', '50L1', 'Range = 0.25 to 100.00', '0.50', '0.50') +
  reportRow('1', '50GZ1', 'Range = 0.25 to 100.00', '0.50', '0.50') + '</table>');

function supervisedLine(op) {
  const r = buildRelay(parseSettings(SUPERVISED), { fileName: 'r.html', rawText: SUPERVISED });
  return buildLine(r, r, Object.assign({ faultModel: 'constantCurrent' }, op));
}

test('supervision settings are read per zone', () => {
  const r = buildRelay(parseSettings(SUPERVISED), { fileName: 'r.html' });
  const z1 = r.zones.find((z) => z.n === 1);
  assert.strictEqual(z1.supervision.phase, 0.5);
  assert.strictEqual(z1.supervision.phaseFrom, '50PP1');
  assert.strictEqual(z1.supervision.ground, 0.5);
  assert.strictEqual(z1.supervision.groundFrom, '50GZ1');
  assert.strictEqual(z1.supervision.positive, 0.5);
});

test('a zone that cannot see enough current expects RESTRAIN', () => {
  const plenty = buildPlan(supervisedLine({ testCurrent: 5 }));
  const starved = buildPlan(supervisedLine({ testCurrent: 0.2 }));
  const pick = (p) => p.distance.find((r) => r.zoneNo === 1 && r.pointKey === 'in' && r.type === 'AG');

  assert.strictEqual(pick(plenty).expect21, 'OPERATE');
  assert.strictEqual(pick(plenty).heldBySupervision, false);

  const low = pick(starved);
  assert.strictEqual(low.expect21, 'RESTRAIN', 'supervised out');
  assert.strictEqual(low.heldBySupervision, true);
  assert.ok(starved.starvedCount > 0);
  // The impedance is unchanged; only the current decided it.
  assert.strictEqual(low.pctOfReach, pick(plenty).pctOfReach);
});

test('supervision never turns a RESTRAIN into an OPERATE', () => {
  const starved = buildPlan(supervisedLine({ testCurrent: 0.2 }));
  for (const r of starved.distance.filter((x) => x.pointKey === 'out')) {
    assert.strictEqual(r.expect21, 'RESTRAIN', r.id + ' stays restrained');
    assert.strictEqual(r.heldBySupervision, false, 'and is not attributed to supervision');
  }
});

test('with no supervision settings the condition is reported as unjudged', () => {
  // The fixture carries zone reaches but no 50PP/50L/50GZ settings.
  const plan = buildPlan(demoLine({ testCurrent: 0.05 }));
  const row = plan.distance[0];
  assert.strictEqual(row.supervision.checked, false);
  assert.strictEqual(row.supervision.ok, null, 'not judged rather than judged as passing');
  assert.strictEqual(row.expect21, 'OPERATE', 'so the impedance alone decides');
});

/* ------------------------------------------------------------ sign-offs - */

test('a sign-off stays with its test when the set is reordered', () => {
  const line = demoLine();
  const full = buildPlan(line, { faultTypes: ['AG', 'BC', 'ABC'] });
  const target = full.distance.find((r) => r.zoneNo === 1 && r.type === 'BC' && r.pointKey === 'in');
  const signoff = { ['L|' + target.lockKey]: 'PASS' };

  // Drop A-G: every row index shifts, but identity does not.
  const fewer = buildPlan(line, { faultTypes: ['BC', 'ABC'] });
  const moved = fewer.distance.find((r) => r.lockKey === target.lockKey);
  assert.ok(moved, 'the test still exists');
  assert.notStrictEqual(moved.n, target.n, 'and has moved position');

  const csv = testPlanCsv({ plan: fewer, line, names: {}, signoff }).replace(/^﻿/, '');
  const row = csv.split('\r\n').find((l) => l.startsWith(moved.id + ','));
  assert.ok(row.endsWith('PASS,'), 'the sign-off followed the test, not the row number');

  // And nothing else picked it up.
  const others = csv.split('\r\n').filter((l) => /^T\d/.test(l) && !l.startsWith(moved.id + ','));
  assert.ok(others.every((l) => !/PASS/.test(l)), 'no other test inherited it');
});

test('sign-offs saved against row positions are still read', () => {
  const line = demoLine();
  const plan = buildPlan(line);
  const legacy = { L0: 'NOOP' };
  const csv = testPlanCsv({ plan, line, names: {}, signoff: legacy }).replace(/^﻿/, '');
  const first = csv.split('\r\n').find((l) => l.startsWith('T01,'));
  assert.ok(/NOOP/.test(first), 'an older saved report still shows its sign-offs');
});

test('87L checks carry their own sign-offs through to the csv', () => {
  const line = demoLine();
  const plan = buildPlan(line);
  const check = plan.differential[0];
  const signoff = { ['L|' + check.lockKey]: 'PASS', ['R|' + check.lockKey]: 'RETEST' };

  const csv = testPlanCsv({ plan, line, names: {}, signoff }).replace(/^﻿/, '');
  const row = csv.split('\r\n').find((l) => l.startsWith(check.id + ','));
  assert.ok(/PASS/.test(row) && /RETEST/.test(row), 'both ends recorded');
});

test('87L sign-offs do not leak onto the distance tests', () => {
  const line = demoLine();
  const plan = buildPlan(line);
  const check = plan.differential[0];
  const signoff = { ['L|' + check.lockKey]: 'DEFER' };
  const csv = testPlanCsv({ plan, line, names: {}, signoff }).replace(/^﻿/, '');
  const distanceRows = csv.split('\r\n').filter((l) => /^T\d/.test(l));
  assert.ok(distanceRows.every((l) => !/DEFER/.test(l)));
});

test('the report pdf renders with sign-offs on both tables', async () => {
  const line = demoLine();
  const plan = buildPlan(line);
  const signoff = {
    ['L|' + plan.distance[0].lockKey]: 'PASS',
    ['L|' + plan.differential[0].lockKey]: 'FAIL'
  };
  const bytes = await testReportPdf({ plan, line, names: { local: 'A', remote: 'B' }, org: {}, signoff });
  assert.ok(bytes.length > 2000);
});
