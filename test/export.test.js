'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { parseSettings } = require('../src/core/parseSettings');
const { buildRelay } = require('../src/core/relay');
const { buildLine } = require('../src/core/line');
const { buildPlan } = require('../src/core/testplan');
const { buildRecord } = require('../src/core/record');
const { testPlanCsv } = require('../src/core/csv');
const { testReportPdf, recordPdf, ascii } = require('../src/core/pdf');

const SAMPLE = `<table>
  <tr><td>RID</td><td>ALPHA_LN1</td></tr>
  <tr><td>Z1MAG</td><td>8.32</td><td>Z1ANG</td><td>84.50</td></tr>
  <tr><td>Z0MAG</td><td>24.50</td><td>Z0ANG</td><td>78.20</td></tr>
  <tr><td>Z1P</td><td>7.07</td></tr><tr><td>Z2P</td><td>12.48</td></tr>
  <tr><td>87LR</td><td>6.00</td></tr><tr><td>87LANG</td><td>195.00</td></tr>
  <tr><td>87LPP</td><td>1.00</td></tr>
  <tr><td>CTR</td><td>240</td></tr><tr><td>PTR</td><td>2000</td></tr>
</table><p>FID = SEL-411L-R110</p>`;

function fixture(op) {
  const a = buildRelay(parseSettings(SAMPLE), { fileName: 'A.html', rawText: SAMPLE });
  const b = buildRelay(parseSettings(SAMPLE), { fileName: 'B.html', rawText: SAMPLE });
  const line = buildLine(a, b, Object.assign({ faultModel: 'constantCurrent' }, op));
  const plan = buildPlan(line);
  return { a, b, line, plan };
}

/* ----------------------------------------------------------------- record */

test('record tags every input and cites the tags later', () => {
  const { line, plan, a, b } = fixture();
  const rec = buildRecord({ line, plan, local: a, remote: b });
  assert.ok(rec.inputs.rows.length >= 8);
  assert.strictEqual(rec.inputs.rows[0].ref, 'I-01');
  const k0 = rec.derived.find((x) => x.symbol.indexOf('k') === 0);
  assert.ok(k0.rows.some((r) => String(r[0] !== undefined ? r[0] : r).includes('I-0')),
    'k0 derivation cites an input tag');
});

test('record separates operator entries from relay settings', () => {
  const { line, plan, a, b } = fixture();
  const rec = buildRecord({ line, plan, local: a, remote: b });
  const operator = rec.inputs.rows.filter((r) => r.origin === 'operator');
  assert.strictEqual(operator.length, 3, 'test current, infeed and nominal voltage');
  assert.ok(rec.inputs.rows.some((r) => r.origin === 'both files agree'));
});

test('record flags a disagreement between the two files', () => {
  const a = buildRelay(parseSettings(SAMPLE), { fileName: 'A.html' });
  const b = buildRelay(parseSettings(SAMPLE.replace('24.50', '25.90')), { fileName: 'B.html' });
  const line = buildLine(a, b, {});
  const rec = buildRecord({ line, plan: buildPlan(line), local: a, remote: b });
  assert.ok(rec.inputs.rows.some((r) => r.origin === 'FILES DISAGREE'));
});

test('every test block ends with a self check that reproduces the input', () => {
  const { line, plan, a, b } = fixture();
  const rec = buildRecord({ line, plan, local: a, remote: b });
  assert.strictEqual(rec.tests.length, plan.distance.length);
  for (const t of rec.tests) assert.ok(t.residual < 1e-9, t.id + ' residual ' + t.residual);
  assert.strictEqual(rec.selfCheck.ok, true);
});

test('record holds for every fault model', () => {
  for (const faultModel of ['constantCurrent', 'constantVoltage', 'sourceImpedance']) {
    const { line, plan, a, b } = fixture({ faultModel });
    const rec = buildRecord({ line, plan, local: a, remote: b });
    assert.strictEqual(rec.selfCheck.ok, true, faultModel + ' self check');
    assert.ok(rec.assumptions.length >= 6, faultModel + ' states its assumptions');
  }
});

test('assumptions change with the model rather than being boilerplate', () => {
  const bench = buildRecord(Object.assign(fixture({ faultModel: 'constantCurrent' }),
    { local: null, remote: null }));
  const real = buildRecord(Object.assign(fixture({ faultModel: 'sourceImpedance' }),
    { local: null, remote: null }));
  assert.ok(bench.assumptions.some((a) => /constant-current/.test(a)));
  assert.ok(real.assumptions.some((a) => /short-circuit study/.test(a)));
});

/* -------------------------------------------------------------------- csv */

test('csv has one row per test and matching column counts', () => {
  const { line, plan } = fixture();
  const csv = testPlanCsv({ plan, line, names: { local: 'ALPHA', remote: 'BRAVO' } });
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  const header = lines[0].split(',');
  // 11 describing the test, 12 phase quantities per end, 2 sign-offs.
  assert.strictEqual(header.length, 11 + 12 + 12 + 2);
  const body = lines.slice(1, 1 + plan.distance.length);
  assert.strictEqual(body.length, plan.distance.length);
  for (const row of body) assert.strictEqual(row.split(',').length, header.length);
});

test('csv carries sign-off values and the alpha plane section', () => {
  const { line, plan } = fixture();
  const csv = testPlanCsv({ plan, line, names: {}, signoff: { L0: 'PASS', R0: 'RETEST' } });
  assert.ok(csv.includes('PASS'));
  assert.ok(csv.includes('RETEST'));
  assert.ok(csv.includes('87L alpha plane checks'));
});

test('csv quotes a value containing a comma', () => {
  const { line, plan } = fixture();
  const csv = testPlanCsv({ plan, line, names: { local: 'WEST, MAIN' } });
  assert.ok(csv.includes('"WEST, MAIN V'));
});

/* -------------------------------------------------------------------- pdf */

test('transliteration maps what the standard fonts cannot encode', () => {
  assert.strictEqual(ascii('8.32 Ω ∠ 84.5°'), '8.32 ohm @ 84.5°');
  assert.strictEqual(ascii('Z₁ − Z₀'), 'Z1 - Z0');
  assert.strictEqual(ascii('a ≤ b × c'), 'a <= b x c');
  assert.strictEqual(ascii('中文'), '', 'unmapped characters are dropped, not drawn');
});

test('test report pdf renders', async () => {
  const { line, plan } = fixture();
  const bytes = await testReportPdf({
    plan, line, names: { local: 'ALPHA 345 kV', remote: 'BRAVO 345 kV' },
    org: { utility: 'TX Drone Co', titlePrefix: 'Line Protection Test Record' },
    signoff: { L0: 'PASS' }
  });
  assert.ok(bytes.length > 2000);
  assert.strictEqual(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
});

test('calculation record pdf renders for every model', async () => {
  for (const faultModel of ['constantCurrent', 'sourceImpedance']) {
    const { line, plan, a, b } = fixture({ faultModel });
    const record = buildRecord({ line, plan, local: a, remote: b, meta: { appVersion: '0.1.0' } });
    const bytes = await recordPdf({
      record, line, names: { local: 'ALPHA', remote: 'BRAVO' },
      org: { utility: 'TX Drone Co' },
      provenance: [{ end: 'Local', fileName: 'A.html', hash: 'abc123', model: 'SEL-411L', serial: '1142' }]
    });
    assert.ok(bytes.length > 3000, faultModel);
    assert.strictEqual(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  }
});

test('pdf export survives unicode in operator-supplied names', async () => {
  const { line, plan } = fixture();
  const bytes = await testReportPdf({
    plan, line,
    names: { local: 'Wärtsilä — Ω 中文', remote: 'BRAVO' },
    org: {}
  });
  assert.ok(bytes.length > 2000);
});

/* ------------------------------------------------------- what the report says */

/*
 * pdf-lib writes drawn text as hex strings in deflated content streams, so
 * reading a report back means inflating every stream and decoding the
 * <...> Tj operands. Worth the twenty lines: the rule that the report states
 * only what was tested is a decision the user made twice, and asserting it
 * on the real bytes is the only way it stays true.
 */
function pdfText(bytes) {
  const zlib = require('node:zlib');
  const buf = Buffer.from(bytes);
  const latin = buf.toString('latin1');
  let body = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(latin))) {
    const from = m.index + m[0].length;
    const to = latin.indexOf('endstream', from);
    try { body += zlib.inflateSync(buf.subarray(from, to)).toString('latin1'); } catch (err) { /* not deflated */ }
  }
  return [...body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)]
    .map((x) => Buffer.from(x[1], 'hex').toString('latin1'))
    .join('\n');
}

test('the report prints nothing about omitted points or bench warnings', async () => {
  const { line, plan } = fixture({ warnVolts: 40, testCurrent: 8 });
  assert.ok(plan.counts.voltageWarnings > 0, 'the fixture should trip the voltage warning');

  const { applyOmissions } = require('../src/core/testplan');
  const dropped = plan.distance[1];
  const cut = applyOmissions(plan, { [dropped.lockKey]: true });
  assert.strictEqual(cut.omittedCount, 1);

  const text = pdfText(await testReportPdf({
    plan: cut, line, names: { local: 'ALPHA', remote: 'BRAVO' }, org: {}, signoff: {}
  }));

  // It is a real report: the surviving points are all in it.
  assert.ok(text.includes('Test matrix'));
  for (const r of cut.distance) assert.ok(text.includes(r.id), r.id + ' is missing from the report');

  // And it says nothing about what was left out or what the bench must manage.
  assert.ok(!text.includes(dropped.id), 'the omitted point is named in the report');
  assert.ok(!/[Oo]mitted/.test(text), 'the report mentions omission');
  assert.ok(!/faulted phase/.test(text), 'the report still carries a voltage warning');
  assert.ok(!/require more than/.test(text), 'the report still carries the warning summary');
});

test('the calculation record keeps the warnings the report drops', async () => {
  const { line, plan, a, b } = fixture({ warnVolts: 40, testCurrent: 8 });
  const rec = buildRecord({ line, plan, local: a, remote: b });
  const text = pdfText(await recordPdf({ record: rec, line, names: { local: 'ALPHA', remote: 'BRAVO' }, org: {} }));
  /*
   * Match the warning itself, not the phrase "faulted phase" -- every
   * injection block carries a note saying voltage is referenced to the
   * faulted phase at 0 degrees, so the looser pattern passed whether or not
   * the warning was there at all.
   */
  const warnings = (text.match(/This point needs [\d.]+ V on the faulted phase/g) || []);
  assert.strictEqual(warnings.length, plan.counts.voltageWarnings,
    'the record exists to show the working, so one note per flagged point belongs in it');
});

test('the report carries both plots', async () => {
  const { line, plan } = fixture();
  const text = pdfText(await testReportPdf({
    plan, line, names: { local: 'ALPHA', remote: 'BRAVO' }, org: {}, signoff: {}
  }));
  assert.ok(/R-X plane/.test(text), 'no distance plot caption');
  assert.ok(/alpha plane/.test(text), 'no 87L plot caption');
  // The identifiers are drawn on the plots as well as in the tables.
  assert.ok((text.match(new RegExp(plan.distance[0].id, 'g')) || []).length >= 2,
    'the first test point should appear in both the table and the plot');
});

test('neither export carries a voltage warning', async () => {
  /*
   * The warning is a setup aid, not a result, so it belongs on screen and in
   * the calculation record and nowhere else. This is pinned because the CSV
   * has quietly regained a removed line once before.
   */
  const { line, plan } = fixture({ warnVolts: 40, testCurrent: 8 });
  assert.ok(plan.counts.voltageWarnings > 0, 'the fixture should trip the warning');

  const csv = testPlanCsv({ plan, line, names: { local: 'ALPHA', remote: 'BRAVO' } });
  assert.ok(!/[Vv]oltage warning/.test(csv), 'the csv still has the warning column');
  // The flagged point is still exported -- it is the note that is gone, not the test.
  const flagged = plan.distance.find((r) => r.voltageWarning);
  assert.ok(csv.includes(flagged.id), flagged.id + ' is missing from the csv');

  const text = pdfText(await testReportPdf({
    plan, line, names: { local: 'ALPHA', remote: 'BRAVO' }, org: {}, signoff: {}
  }));
  assert.ok(!/faulted phase/.test(text), 'the report still has the warning');
});
