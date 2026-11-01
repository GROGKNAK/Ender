'use strict';
/*
 * SEL-421 support, against the matched pair in samples/.
 *
 * The 421 is a distance relay with no line differential, so it exercises a
 * path the 311L pair never does: a line where 87L settings are simply absent
 * and the differential half of the plan has to come back empty rather than
 * broken. It also names the station SID where the 311L uses TID.
 *
 * Values come from the SEL-421 Relay Applications Handbook "230 kV Overhead
 * Transmission Line Example" (Stations S and R, date code 20130627).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const C = require('../src/core/complex');
const { parseSettings } = require('../src/core/parseSettings');
const { buildRelay, validateRelay, compareEnds } = require('../src/core/relay');
const { buildLine } = require('../src/core/line');
const { buildPlan } = require('../src/core/testplan');
const { buildRecord } = require('../src/core/record');

const SAMPLES = path.join(__dirname, '..', 'samples');

function load(name) {
  const raw = fs.readFileSync(path.join(SAMPLES, name), 'utf8');
  return buildRelay(parseSettings(raw, { fileName: name }), { fileName: name, rawText: raw });
}

const localEnd = () => load('SEL421_S_HARVARD_230kV.html');
const remoteEnd = () => load('SEL421_R_PRINCETON_230kV.html');

/* The handbook's sources: Z1S = Z1R = 50 ohm at 86 degrees primary, and
 * k = CTR/PTR = 0.05, so 2.5 ohm at 86 degrees secondary at both ends. */
const SOURCE = { z1mag: 2.5, z1ang: 86, z0mag: 2.5, z0ang: 86 };

const lineOf = (op) => buildLine(localEnd(), remoteEnd(), Object.assign({
  faultModel: 'sourceImpedance', vnom: 66.4, sourceLocal: SOURCE, sourceRemote: SOURCE
}, op));

test('the 421 pair is recognised as SEL-421 at both ends', () => {
  assert.strictEqual(localEnd().model, 'SEL-421');
  assert.strictEqual(remoteEnd().model, 'SEL-421');
});

test('line constants match the published example', () => {
  const r = localEnd();
  assert.strictEqual(r.z1mag.value, 1.95);
  assert.strictEqual(r.z1ang.value, 84.00);
  assert.strictEqual(r.z0mag.value, 6.20);
  assert.strictEqual(r.z0ang.value, 81.50);
  assert.strictEqual(r.ctr.value, 100, 'CTRW');
  assert.strictEqual(r.ptr.value, 2000, 'PTRY');
  assert.strictEqual(r.lineLength.value, 50);
});

test('the station name falls back to SID where there is no TID', () => {
  assert.strictEqual(localEnd().tid, 'HARVARD 230 KV');
  assert.strictEqual(remoteEnd().tid, 'PRINCETON 230 KV');
});

test('both zones are read, forward, with their reaches', () => {
  const zones = localEnd().zones;
  assert.strictEqual(zones.length, 2, 'Zone 3 is OFF and must not appear');
  assert.strictEqual(zones[0].phase, 1.56, '80% of 1.95');
  assert.strictEqual(zones[1].phase, 2.34, '120% of 1.95');
  assert.ok(zones.every((z) => z.direction === 'forward'));
});

test('the relay k0 setting is used and agrees with the derived value', () => {
  const r = localEnd();
  assert.strictEqual(r.k0mag.value, 0.727, 'k0M1');
  assert.strictEqual(r.k0ang.value, -3.65, 'k0A1');

  const line = lineOf();
  assert.strictEqual(line.k0Source, 'setting');
  // The handbook's AUTO calculation should reproduce (Z0 - Z1) / 3Z1.
  assert.ok(Math.abs(C.abs(line.k0) - C.abs(line.k0Derived)) < 0.001,
    'magnitude: ' + C.abs(line.k0) + ' vs ' + C.abs(line.k0Derived));
  assert.ok(Math.abs(C.angleDiff(C.arg(line.k0), C.arg(line.k0Derived))) < 0.05,
    'angle: ' + C.arg(line.k0) + ' vs ' + C.arg(line.k0Derived));
  assert.strictEqual(line.k0Check.agree, true);
});

test('a relay with no differential reports it rather than failing', () => {
  const r = localEnd();
  assert.strictEqual(r.d87.r, null, 'no 87LR on a 421');
  assert.strictEqual(r.enables.differential, null);
  const problems = validateRelay(r);
  assert.ok(problems.some((p) => p.level === 'warn' && /87L/.test(p.message)));
  // Missing 87L must not be an error: the distance tests are still valid.
  assert.ok(!problems.some((p) => p.level === 'error'));
});

test('the plan carries distance points and no differential checks', () => {
  const plan = buildPlan(lineOf());
  assert.strictEqual(plan.counts.distance, 2 * 3 * 2, 'two zones, three fault types, two points');
  assert.strictEqual(plan.counts.differential, 0);
  assert.strictEqual(plan.differential.length, 0);
});

test('the two ends agree on everything the calculation uses', () => {
  const rows = compareEnds(localEnd(), remoteEnd());
  const differ = rows.filter((r) => r.status === 'differ');
  assert.deepStrictEqual(differ, [], 'the pair describes one line');
  assert.ok(rows.some((r) => r.key === 'z1mag' && r.status === 'match'));
});

test('the record self check holds for the 421 pair in every model', () => {
  for (const faultModel of ['sourceImpedance', 'constantCurrent', 'constantVoltage']) {
    const line = lineOf({ faultModel });
    const rec = buildRecord({ line, plan: buildPlan(line), local: localEnd(), remote: remoteEnd() });
    assert.strictEqual(rec.selfCheck.ok, true,
      faultModel + ' residual ' + rec.selfCheck.worstResidual);
  }
});

test('the alpha plane section is absent rather than empty-looking', () => {
  const line = lineOf();
  const rec = buildRecord({ line, plan: buildPlan(line), local: localEnd(), remote: remoteEnd() });
  assert.strictEqual(rec.alpha, null, 'no characteristic to describe');
  assert.ok(rec.tests.length > 0, 'the distance derivations are still there');
});

/* ----------------------------------------------- the same pair, 3 shapes - */

const { readSource } = require('../src/core/bundle');
const { parseMany } = require('../src/core/parseSettings');

function loadSource(name) {
  const src = readSource(path.join(SAMPLES, name));
  const parsed = parseMany(src.sources);
  return {
    kind: src.kind,
    files: src.sources.length,
    relay: buildRelay(parsed, {
      fileName: src.label,
      rawText: src.sources.map((s) => s.text).join('\n')
    })
  };
}

const SHAPES = [
  ['report file', 'SEL421_S_HARVARD_230kV.html', 'file'],
  ['native folder', 'SEL421_S_HARVARD_230kV_native', 'folder'],
  ['native zip', 'SEL421_S_HARVARD_230kV_native.zip', 'zip']
];

test('the same relay reads identically from a file, a folder and a zip', () => {
  const loaded = SHAPES.map(([label, name, kind]) => {
    const got = loadSource(name);
    assert.strictEqual(got.kind, kind, label + ' was read as ' + got.kind);
    return got.relay;
  });

  const fingerprint = (r) => JSON.stringify({
    model: r.model,
    z1: [r.z1mag.value, r.z1ang.value],
    z0: [r.z0mag.value, r.z0ang.value],
    ratios: [r.ctr.value, r.ptr.value],
    length: r.lineLength.value,
    k0: [r.k0mag.value, r.k0ang.value],
    zones: r.zones.map((z) => [z.n, z.phase, z.ground, z.direction]),
    tid: r.tid
  });

  const distinct = new Set(loaded.map(fingerprint));
  assert.strictEqual(distinct.size, 1,
    'the three shapes disagree:\n' + [...distinct].join('\n'));
});

test('the native shapes carry both settings groups', () => {
  for (const name of ['SEL421_S_HARVARD_230kV_native', 'SEL421_S_HARVARD_230kV_native.zip']) {
    const r = loadSource(name).relay;
    assert.ok(r.groups.includes('1'), name + ' group 1');
    assert.ok(r.groups.includes('G'), name + ' global group');
    assert.strictEqual(r.group, '1', 'the protection group is the one read');
  }
});

test('the ends can be loaded in different shapes and still pair up', () => {
  // A crew may well hand over one end as a report and the other as an archive.
  const local = loadSource('SEL421_S_HARVARD_230kV.html').relay;
  const remote = loadSource('SEL421_R_PRINCETON_230kV_native.zip').relay;
  const rows = compareEnds(local, remote);
  assert.deepStrictEqual(rows.filter((r) => r.status === 'differ'), []);
  assert.ok(rows.length >= 6);

  const line = buildLine(local, remote, {
    faultModel: 'sourceImpedance', vnom: 66.4, sourceLocal: SOURCE, sourceRemote: SOURCE
  });
  const rec = buildRecord({ line, plan: buildPlan(line), local, remote });
  assert.strictEqual(rec.selfCheck.ok, true);
});
