'use strict';
/*
 * Zone direction.
 *
 * A reverse zone looks behind the terminal. Placing its test points forward
 * would produce a plausible-looking set of quantities that test the wrong
 * side of the relay, so this is worth pinning down hard.
 */
const test = require('node:test');
const assert = require('node:assert');

const C = require('../src/core/complex');
const { parseSettings } = require('../src/core/parseSettings');
const { buildRelay } = require('../src/core/relay');
const { buildLine } = require('../src/core/line');
const { buildPlan } = require('../src/core/testplan');
const { buildRecord } = require('../src/core/record');
const { byKey } = require('../src/core/faults');

const cell = (c) => '<td><div class="cell">' + c + '</div></td>';
const row = (group, name, value) =>
  '<tr>' + [group, name, 'Range = x', '0', value, 'True', name, '', 'False'].map(cell).join('') + '</tr>';

function fixture(extra) {
  return '<html><body><table><tr>' +
    ['Group', 'Setting', 'Range', 'Default Value', 'Value', 'Delta', 'Description', 'Comments', 'Hidden']
      .map(cell).join('') + '</tr>' +
    row('1', 'RID', 'SEL-311L LINE RELAY') +
    row('1', 'Z1MAG', '7.80') + row('1', 'Z1ANG', '84.00') +
    row('1', 'Z0MAG', '24.80') + row('1', 'Z0ANG', '81.50') +
    row('1', 'Z1P', '6.24') + row('1', 'Z2P', '9.36') + row('1', 'Z3P', '1.87') +
    row('1', '87LR', '6.0') + row('1', '87LANG', '195') +
    (extra || '') + '</table></body></html>';
}

const relayOf = (extra) => buildRelay(parseSettings(fixture(extra)), { fileName: 'r.html' });
const lineOf = (extra, op) => buildLine(relayOf(extra), relayOf(extra),
  Object.assign({ faultModel: 'constantCurrent' }, op));

/* --------------------------------------------------------------- reading - */

test('a reverse direction setting is read', () => {
  const r = relayOf(row('1', 'DIR3', 'R') + row('1', 'DIR4', 'F'));
  const z3 = r.zones.find((z) => z.n === 3);
  assert.strictEqual(z3.direction, 'reverse');
  assert.strictEqual(z3.directionFrom, 'DIR3');
  assert.strictEqual(z3.directionKnown, true);
});

test('a zone with no direction setting is assumed forward and says so', () => {
  const line = lineOf(row('1', 'DIR3', 'R'));
  const z1 = line.zones.find((z) => z.n === 1);
  const z3 = line.zones.find((z) => z.n === 3);
  assert.strictEqual(z1.direction, 'forward');
  assert.strictEqual(z1.directionSource, 'assumed');
  assert.strictEqual(z3.direction, 'reverse');
  assert.strictEqual(z3.directionSource, 'setting');
});

test('direction values are read in their various spellings', () => {
  for (const [raw, want] of [['R', 'reverse'], ['REV', 'reverse'], ['F', 'forward'],
    ['Forward', 'forward'], ['N', 'off'], ['OFF', 'off']]) {
    const r = relayOf(row('1', 'DIR3', raw));
    assert.strictEqual(r.zones.find((z) => z.n === 3).direction, want, raw);
  }
});

test('an operator override beats the relay, in both directions', () => {
  const forced = lineOf(row('1', 'DIR3', 'R'), { zoneDirections: { 3: 'forward' } });
  const z3 = forced.zones.find((z) => z.n === 3);
  assert.strictEqual(z3.direction, 'forward');
  assert.strictEqual(z3.directionSource, 'operator');
  assert.strictEqual(z3.relayDirection, 'reverse', 'what the relay said is kept');

  const flipped = lineOf('', { zoneDirections: { 1: 'reverse' } });
  assert.strictEqual(flipped.zones.find((z) => z.n === 1).direction, 'reverse');
});

test('a zone switched off produces no test points', () => {
  const on = buildPlan(lineOf(row('1', 'DIR3', 'R')));
  const off = buildPlan(lineOf(row('1', 'DIR3', 'N')));
  // Every fault loop, at both points, for that one zone.
  const { DEFAULT_TYPES } = require('../src/core/testplan');
  assert.strictEqual(on.distance.filter((r) => r.zoneNo === 3).length, DEFAULT_TYPES.length * 2);
  assert.strictEqual(off.distance.filter((r) => r.zoneNo === 3).length, 0);
});

/* --------------------------------------------------------------- placing - */

test('a reverse zone places its points behind the relay', () => {
  const plan = buildPlan(lineOf(row('1', 'DIR3', 'R')));
  const fwd = plan.distance.find((r) => r.zoneNo === 1 && r.pointKey === 'in' && r.type === 'AG');
  const rev = plan.distance.find((r) => r.zoneNo === 3 && r.pointKey === 'in' && r.type === 'AG');

  assert.ok(Math.abs(C.arg(fwd.zLoop) - 84) < 1e-9, 'forward sits at the line angle');
  const diff = Math.abs(C.angleDiff(C.arg360(rev.zLoop), C.arg360(fwd.zLoop)));
  assert.ok(Math.abs(diff - 180) < 1e-9, 'reverse sits 180 degrees round, got ' + diff);
  assert.strictEqual(rev.reverse, true);
});

test('a reverse fault is always external to the differential', () => {
  const plan = buildPlan(lineOf(row('1', 'DIR3', 'R')));
  for (const r of plan.distance.filter((x) => x.zoneNo === 3)) {
    assert.strictEqual(r.onLine, false, r.id + ' behind the relay is never between the CTs');
    assert.strictEqual(r.expect87, 'RESTRAIN', r.id);
  }
  // Zone 3 is short, so placed forward it would have looked internal.
  const forward = buildPlan(lineOf(row('1', 'DIR3', 'F')));
  assert.ok(forward.distance.filter((x) => x.zoneNo === 3).every((r) => r.expect87 === 'OPERATE'),
    'the same reach forward would read as internal, which is the error this prevents');
});

test('the local current reverses while the remote stays forward', () => {
  const plan = buildPlan(lineOf(row('1', 'DIR3', 'R')));
  const fwd = plan.distance.find((r) => r.zoneNo === 1 && r.pointKey === 'in' && r.type === 'ABC');
  const rev = plan.distance.find((r) => r.zoneNo === 3 && r.pointKey === 'in' && r.type === 'ABC');
  const turn = Math.abs(C.angleDiff(C.arg360(rev.local.i[0]), C.arg360(fwd.local.i[0])));
  assert.ok(Math.abs(turn - 180) < 1e-6, 'local current turns through 180, got ' + turn);
});

/* ------------------------------------------------------------ self check - */

function backCalc(r, line) {
  const t = byKey(r.type);
  if (t.base === 'ground') {
    const k = t.r;
    const res = C.add(C.add(r.local.i[0], r.local.i[1]), r.local.i[2]);
    return C.div(r.local.v[k], C.add(r.local.i[k], C.mul(line.k0, res)));
  }
  if (t.base === 'phase') {
    const a = (t.r + 1) % 3;
    const b = (t.r + 2) % 3;
    return C.div(C.sub(r.local.v[a], r.local.v[b]), C.sub(r.local.i[a], r.local.i[b]));
  }
  return C.div(r.local.v[0], r.local.i[0]);
}

test('a reverse point derives back to the reverse reach, in every model', () => {
  for (const faultModel of ['constantCurrent', 'constantVoltage', 'sourceImpedance']) {
    const line = lineOf(row('1', 'DIR3', 'R'), { faultModel });
    const plan = buildPlan(line);
    for (const r of plan.distance.filter((x) => x.zoneNo === 3)) {
      const back = backCalc(r, line);
      assert.ok(Math.abs(C.abs(back) - C.abs(r.zLoop)) < 1e-6,
        faultModel + ' ' + r.id + ' magnitude: ' + C.abs(back) + ' vs ' + C.abs(r.zLoop));
      assert.ok(Math.abs(C.angleDiff(C.arg360(back), C.arg360(r.zLoop))) < 1e-6,
        faultModel + ' ' + r.id + ' angle: ' + C.arg(back) + ' vs ' + C.arg(r.zLoop));
    }
  }
});

test('the record self check passes with a reverse zone present', () => {
  for (const faultModel of ['constantCurrent', 'sourceImpedance']) {
    const line = lineOf(row('1', 'DIR3', 'R'), { faultModel });
    const rec = buildRecord({ line, plan: buildPlan(line), local: null, remote: null });
    assert.strictEqual(rec.selfCheck.ok, true, faultModel);
  }
});

test('the record states each zone direction and where it came from', () => {
  const line = lineOf(row('1', 'DIR3', 'R'));
  const rec = buildRecord({ line, plan: buildPlan(line), local: null, remote: null });
  const revTest = rec.tests.find((t) => /Zone 3/.test(t.title));
  const text = JSON.stringify(revTest.blocks);
  assert.ok(/reverse/.test(text), 'the reverse direction is stated');
  assert.ok(/DIR3/.test(text), 'and where it was read from');

  const fwdTest = rec.tests.find((t) => /Zone 1/.test(t.title));
  assert.ok(/assumed forward/.test(JSON.stringify(fwdTest.blocks)),
    'an assumed direction is declared as an assumption');
});

test('a reverse reach deeper than the source behind it is flagged', () => {
  // Source Z1 of 3.10 ohm, reverse reach pushed well past it.
  const deep = lineOf(row('1', 'DIR3', 'R'), {
    faultModel: 'sourceImpedance',
    zoneDirections: { 3: 'reverse' },
    sourceLocal: { z1mag: 1.0, z1ang: 86, z0mag: 1.6, z0ang: 81 }
  });
  const plan = buildPlan(deep);
  assert.ok(plan.unphysicalCount > 0, 'the impossible fault point is reported');
  const rec = buildRecord({ line: deep, plan, local: null, remote: null });
  const flagged = rec.tests.find((t) => /Zone 3/.test(t.title));
  assert.ok(/no physical fault point/.test(JSON.stringify(flagged.blocks)));
});
