'use strict';
const test = require('node:test');
const assert = require('node:assert');

const C = require('../src/core/complex');
const { parseSettings, toNumber } = require('../src/core/parseSettings');
const { buildRelay, validateRelay, compareEnds } = require('../src/core/relay');
const { buildLine } = require('../src/core/line');
const { faultQuantities, byKey, rotate } = require('../src/core/faults');
const alpha = require('../src/core/alpha');
const { buildPlan } = require('../src/core/testplan');

const near = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) < eps, (what || '') + ' expected ' + b + ', got ' + a);

/* ---------------------------------------------------------------- complex - */

test('polar and back round-trips', () => {
  const z = C.polar(8.32, 84.5);
  near(C.abs(z), 8.32, 1e-9);
  near(C.arg(z), 84.5, 1e-9);
});

test('arg normalises to (-180, 180]', () => {
  near(C.arg(C.polar(1, 270)), -90, 1e-9);
  near(C.arg360(C.polar(1, -90)), 270, 1e-9);
});

test('angleDiff wraps across 0/360 rather than through it', () => {
  near(C.angleDiff(10, 350), 20, 1e-9);
  near(C.angleDiff(280, 180), 100, 1e-9);
  near(C.angleDiff(265, 180), 85, 1e-9);
});

test('division by a zero phasor is refused', () => {
  assert.throws(() => C.div(C.ONE, C.ZERO), RangeError);
});

/* ----------------------------------------------------------------- parser - */

const SAMPLE = `
<html><head><style>td{}</style></head><body>
<h1>SEL-411L Settings Report</h1>
<table>
  <tr><th>Setting</th><th>Value</th></tr>
  <tr><td>RID</td><td>ALPHA_LN1</td></tr>
  <tr><td>TID</td><td>LINE 1 TERM A</td></tr>
  <tr><td>Z1MAG</td><td>8.32</td><td>Z1ANG</td><td>84.50</td></tr>
  <tr><td>Z0MAG</td><td>24.50</td><td>Z0ANG</td><td>78.20</td></tr>
  <tr><td>Z1P</td><td>7.07</td></tr>
  <tr><td>Z2P</td><td>12.48</td></tr>
  <tr><td>Z3P</td><td>20.80</td></tr>
  <tr><td>Z2D</td><td>0.30</td></tr>
  <tr><td>87LR</td><td>6.00</td></tr>
  <tr><td>87LANG</td><td>195.00</td></tr>
  <tr><td>87LPP</td><td>1.00</td></tr>
  <tr><td>CTR</td><td>240</td></tr>
  <tr><td>PTR</td><td>2000</td></tr>
  <tr><td>Zone 1 Reach</td><td>ignored, not a mnemonic</td></tr>
  <tr><td>WEIRDSET</td><td>42</td></tr>
</table>
<p>FID = SEL-411L-R110-V0-Z001001</p>
</body></html>`;

test('parser finds settings in table pairs', () => {
  const p = parseSettings(SAMPLE);
  assert.strictEqual(p.get('Z1MAG'), '8.32');
  assert.strictEqual(p.get('Z1ANG'), '84.50');
  assert.strictEqual(p.get('87LANG'), '195.00');
  assert.strictEqual(p.get('RID'), 'ALPHA_LN1');
});

test('parser ignores prose labels but keeps unknown mnemonics', () => {
  const p = parseSettings(SAMPLE);
  assert.strictEqual(p.has('Zone 1 Reach'), false);
  assert.strictEqual(p.get('WEIRDSET'), '42');
});

test('parser picks up name = value outside tables', () => {
  const p = parseSettings(SAMPLE);
  assert.ok(String(p.get('FID')).indexOf('SEL-411L') === 0);
});

test('toNumber copes with units, OFF and a Unicode minus', () => {
  assert.strictEqual(toNumber('8.32 Ohm'), 8.32);
  assert.strictEqual(toNumber('−3.5'), -3.5);
  assert.strictEqual(toNumber('OFF'), null);
  assert.strictEqual(toNumber(undefined), null);
});

/* ------------------------------------------------------------------ relay - */

function relayFrom(html, name) {
  return buildRelay(parseSettings(html), { fileName: name, rawText: html });
}

test('relay maps settings and records where each came from', () => {
  const r = relayFrom(SAMPLE, 'ALPHA.html');
  assert.strictEqual(r.z1mag.value, 8.32);
  assert.strictEqual(r.z1mag.from, 'Z1MAG');
  assert.strictEqual(r.model, 'SEL-411L');
  assert.strictEqual(r.rid, 'ALPHA_LN1');
  assert.strictEqual(r.zones.length, 3);
  assert.strictEqual(r.zones[1].delay, 0.30);
});

test('unrecognised settings are kept, not dropped', () => {
  const r = relayFrom(SAMPLE, 'ALPHA.html');
  assert.ok(r.unmatched.some((u) => u.name === 'WEIRDSET'));
});

test('validation reports what is missing instead of throwing', () => {
  const bare = buildRelay(parseSettings('<table><tr><td>Z1MAG</td><td>8.32</td></tr></table>'));
  const problems = validateRelay(bare);
  assert.ok(problems.some((p) => p.field === 'z0mag' && p.level === 'error'));
  assert.ok(problems.some((p) => p.field === 'zones'));
});

test('comparing ends flags a genuine disagreement', () => {
  const a = relayFrom(SAMPLE, 'A.html');
  const b = relayFrom(SAMPLE.replace('<td>7.07</td>', '<td>7.50</td>'), 'B.html');
  const rows = compareEnds(a, b);
  const z1 = rows.find((r) => r.key === 'zone1');
  assert.strictEqual(z1.status, 'differ');
  assert.strictEqual(rows.find((r) => r.key === 'z1mag').status, 'match');
});

/* ------------------------------------------------------------------- line - */

function demoLine(op) {
  const a = relayFrom(SAMPLE, 'A.html');
  const b = relayFrom(SAMPLE, 'B.html');
  return buildLine(a, b, Object.assign({ faultModel: 'constantCurrent' }, op));
}

test('k0 derives to the published worked value', () => {
  const line = demoLine();
  near(C.abs(line.k0), 0.6513, 5e-4, 'k0 magnitude');
  near(C.arg(line.k0), -9.52, 0.05, 'k0 angle');
  assert.strictEqual(line.k0Source, 'derived');
});

test('1 + k0 is the ground loop multiplier', () => {
  const line = demoLine();
  near(C.abs(line.k0p1), 1.6458, 5e-4);
  near(C.arg(line.k0p1), -3.75, 0.05);
});

test('an explicit k0 setting wins over deriving one', () => {
  const html = SAMPLE.replace('<tr><td>87LR</td>', '<tr><td>K0M1</td><td>0.70</td></tr><tr><td>K0A1</td><td>-8.00</td></tr><tr><td>87LR</td>');
  const r = relayFrom(html, 'A.html');
  const line = buildLine(r, r, {});
  assert.strictEqual(line.k0Source, 'setting');
  near(C.abs(line.k0), 0.70, 1e-9);
});

/* ----------------------------------------------------------------- faults - */

test('ground loop carries the residual term, phase loop does not', () => {
  const line = demoLine();
  const zLoop = C.polar(6.01, 84.5);
  const g = faultQuantities({ type: 'AG', zLoop, line });
  const p = faultQuantities({ type: 'ABC', zLoop, line });
  near(C.abs(g.local.v[0]), 5 * 6.01 * C.abs(line.k0p1), 0.01, 'A-G voltage');
  near(C.abs(p.local.v[0]), 5 * 6.01, 0.01, 'ABC voltage');
});

test('constant current holds the current and lets voltage follow', () => {
  const line = demoLine();
  const q = faultQuantities({ type: 'AG', zLoop: C.polar(6.01, 84.5), line });
  near(C.abs(q.local.i[0]), 5.0, 1e-9);
  near(C.abs(q.local.v[0]), 49.45, 0.02);
  near(C.arg(q.local.i[0]), -80.75, 0.05);
});

test('constant voltage holds voltage and lets current follow', () => {
  const line = demoLine({ faultModel: 'constantVoltage' });
  const q = faultQuantities({ type: 'AG', zLoop: C.polar(6.01, 84.5), line });
  near(C.abs(q.local.v[0]), 67.0, 1e-6);
});

test('a B-G fault is an A-G fault rotated, not relabelled', () => {
  const line = demoLine();
  const z = C.polar(6.01, 84.5);
  const ag = faultQuantities({ type: 'AG', zLoop: z, line });
  const bg = faultQuantities({ type: 'BG', zLoop: z, line });
  near(C.abs(bg.local.v[1]), C.abs(ag.local.v[0]), 1e-9, 'faulted phase magnitude');
  near(C.arg(bg.local.v[1]), -120, 1e-6, 'faulted phase sits at -120');
  near(C.abs(bg.local.i[0]), 0, 1e-9, 'A carries no current');
  near(C.abs(bg.local.v[0]), 67.0, 1e-6, 'A stays at nominal');
});

test('phase-to-phase collapses two phases toward the healthy one', () => {
  const line = demoLine();
  const q = faultQuantities({ type: 'BC', zLoop: C.polar(6.01, 84.5), line });
  near(C.abs(q.local.v[0]), 67.0, 1e-6, 'A healthy');
  near(C.abs(q.local.i[0]), 0, 1e-9, 'no A current');
  near(C.abs(q.local.v[1]), C.abs(q.local.v[2]), 1e-9, 'B and C symmetric');
  // I_B = -I_C, and the loop sees twice the line impedance.
  const vbc = C.sub(q.local.v[1], q.local.v[2]);
  near(C.abs(vbc), 5 * 2 * 6.01, 0.02);
});

test('deriving the loop impedance back from V and I reproduces the input', () => {
  const line = demoLine();
  const z = C.polar(6.01, 84.5);
  for (const type of ['AG', 'BG', 'CG', 'AB', 'BC', 'CA', 'ABC']) {
    const q = faultQuantities({ type, zLoop: z, line });
    const t = byKey(type);
    let back;
    if (t.base === 'ground') {
      const idx = t.r;
      const res = C.add(C.add(q.local.i[0], q.local.i[1]), q.local.i[2]);
      back = C.div(q.local.v[idx], C.add(q.local.i[idx], C.mul(line.k0, res)));
    } else if (t.base === 'phase') {
      const p = (t.r + 1) % 3;
      const n = (t.r + 2) % 3;
      back = C.div(C.sub(q.local.v[p], q.local.v[n]), C.sub(q.local.i[p], q.local.i[n]));
    } else {
      back = C.div(q.local.v[0], q.local.i[0]);
    }
    near(C.abs(back), C.abs(z), 1e-9, type + ' magnitude');
    near(C.arg(back), C.arg(z), 1e-9, type + ' angle');
  }
});

test('a fault past the far bus reverses the remote current', () => {
  const line = demoLine();
  const inside = faultQuantities({ type: 'AG', zLoop: C.polar(6.01, 84.5), line });
  const beyond = faultQuantities({ type: 'AG', zLoop: C.polar(13.73, 84.5), line });
  assert.strictEqual(inside.meta.onLine, true);
  assert.strictEqual(beyond.meta.onLine, false);
  const diff = Math.abs(C.angleDiff(C.arg360(beyond.remote.i[0]), C.arg360(inside.remote.i[0])));
  near(diff, 180, 1e-6, 'remote current reverses');
});

test('source impedance model feeds the fault from both ends', () => {
  const line = demoLine({ faultModel: 'sourceImpedance' });
  const q = faultQuantities({ type: 'ABC', zLoop: C.polar(4.16, 84.5), line });
  assert.ok(C.abs(q.local.i[0]) > 0, 'local current flows');
  assert.ok(C.abs(q.remote.i[0]) > 0, 'remote current flows');
  // Closer to the local end, so the local end carries the larger share.
  assert.ok(C.abs(q.local.i[0]) > C.abs(q.remote.i[0]));
  // Faulted-phase voltage collapses but stays below nominal.
  assert.ok(C.abs(q.local.v[0]) < 67.0);
});

test('source impedance voltages stay physical, unlike constant current', () => {
  const far = C.polar(13.73, 84.5);
  const bench = faultQuantities({ type: 'AG', zLoop: far, line: demoLine() });
  const real = faultQuantities({ type: 'AG', zLoop: far, line: demoLine({ faultModel: 'sourceImpedance' }) });
  assert.ok(C.abs(bench.local.v[0]) > 100, 'bench model overshoots');
  assert.ok(C.abs(real.local.v[0]) <= 67.0 + 1e-6, 'source model cannot exceed the EMF');
});

/* ------------------------------------------------------------ alpha plane - */

const D87 = { r: 6.0, ang: 195.0, pickup: 1.0 };

test('through current lands at -1 and restrains', () => {
  const res = alpha.evaluate(C.polar(1, 180), D87.r, D87.ang);
  assert.strictEqual(res.restrain, true);
  near(res.deviation, 0, 1e-9);
});

test('an internal fault swings the ratio out of the region', () => {
  const res = alpha.evaluate(C.polar(1, 0), D87.r, D87.ang);
  assert.strictEqual(res.restrain, false);
  near(res.deviation, 180, 1e-9);
});

test('the angular boundary sits at 180 + 87LANG/2', () => {
  // 87LANG = 195 puts the edge at 277.5 degrees.
  const inside = alpha.evaluate(C.polar(1, 275), D87.r, D87.ang);
  const outside = alpha.evaluate(C.polar(1, 280), D87.r, D87.ang);
  assert.strictEqual(inside.restrain, true, '275 deg is inside the region');
  assert.strictEqual(outside.restrain, false, '280 deg is outside the region');
  near(inside.deviation, 95, 1e-9);
  near(outside.deviation, 100, 1e-9);
});

test('radius limits are 87LR and its reciprocal', () => {
  assert.strictEqual(alpha.evaluate(C.polar(6.5, 180), D87.r, D87.ang).restrain, false);
  assert.strictEqual(alpha.evaluate(C.polar(5.5, 180), D87.r, D87.ang).restrain, true);
  assert.strictEqual(alpha.evaluate(C.polar(0.15, 180), D87.r, D87.ang).restrain, false);
  assert.strictEqual(alpha.evaluate(C.polar(0.20, 180), D87.r, D87.ang).restrain, true);
});

test('standard checks bracket both boundaries', () => {
  const checks = alpha.standardChecks(D87, 5.0);
  const byLabel = (l) => checks.find((c) => c.label === l);
  assert.strictEqual(byLabel('Through load').result.expect, 'RESTRAIN');
  assert.strictEqual(byLabel('Internal fault, equal infeed').result.expect, 'OPERATE');
  assert.strictEqual(byLabel('Angle edge, inside').result.expect, 'RESTRAIN');
  assert.strictEqual(byLabel('Angle edge, outside').result.expect, 'OPERATE');
  assert.strictEqual(byLabel('Outer radius, inside').result.expect, 'RESTRAIN');
  assert.strictEqual(byLabel('Outer radius, outside').result.expect, 'OPERATE');
});

/* -------------------------------------------------------------- test plan - */

test('plan covers every zone, type and point', () => {
  const plan = buildPlan(demoLine());
  const { DEFAULT_TYPES } = require('../src/core/testplan');

  /*
   * Asserted as coverage rather than as a number. The six phase loops are not
   * interchangeable -- each uses different CT and VT inputs -- so what matters
   * is that every one of them is generated for every zone at both points, not
   * that the total happens to be some count.
   */
  const zones = [...new Set(plan.distance.map((r) => r.zoneNo))];
  assert.strictEqual(zones.length, 3);
  assert.deepStrictEqual(
    [...new Set(plan.distance.map((r) => r.type))].sort(),
    DEFAULT_TYPES.slice().sort(),
    'a fault loop is missing from the matrix'
  );

  const missing = [];
  for (const zone of zones) {
    for (const type of DEFAULT_TYPES) {
      for (const point of ['in', 'out']) {
        const found = plan.distance.some((r) =>
          r.zoneNo === zone && r.type === type && r.pointKey === point);
        if (!found) missing.push(zone + '/' + type + '/' + point);
      }
    }
  }
  assert.deepStrictEqual(missing, []);
  assert.strictEqual(plan.counts.distance, zones.length * DEFAULT_TYPES.length * 2);

  assert.strictEqual(plan.distance[0].expect21, 'OPERATE');
  assert.strictEqual(plan.distance[1].expect21, 'RESTRAIN');
});

test('each loop injects into its own phases', () => {
  /*
   * The whole reason for testing six loops rather than two: a B-G test has to
   * put current in B and depress B, or it proves nothing an A-G test did not
   * already prove and would pass with the B-phase CT wired to the wrong input.
   */
  const plan = buildPlan(demoLine());
  const faulted = (row) => ['A', 'B', 'C']
    .filter((p, k) => C.abs(row.local.i[k]) > 0.01).join('');

  const seen = {};
  for (const r of plan.distance.filter((x) => x.zoneNo === 1 && x.pointKey === 'in')) {
    seen[r.type] = faulted(r);
  }
  assert.deepStrictEqual(seen, {
    AG: 'A', BG: 'B', CG: 'C',
    BC: 'BC', CA: 'AC', AB: 'AB',
    ABC: 'ABC'
  });
});

test('distance and differential verdicts disagree where they should', () => {
  const plan = buildPlan(demoLine());
  const z2in = plan.distance.find((r) => r.zoneNo === 2 && r.pointKey === 'in' && r.type === 'AG');
  assert.strictEqual(z2in.expect21, 'OPERATE');
  assert.strictEqual(z2in.expect87, 'RESTRAIN');
  assert.ok(z2in.linePct > 100);
});

test('over-voltage points are flagged, not silently produced', () => {
  const plan = buildPlan(demoLine());
  assert.ok(plan.counts.voltageWarnings > 0);
  const flagged = plan.distance.find((r) => r.voltageWarning);
  assert.ok(flagged.voltageWarning > 100);
});

test('the source impedance model needs no voltage warnings', () => {
  const plan = buildPlan(demoLine({ faultModel: 'sourceImpedance' }));
  assert.strictEqual(plan.counts.voltageWarnings, 0);
});

test('differential checks are generated per phase', () => {
  const plan = buildPlan(demoLine());
  assert.strictEqual(plan.counts.differential, 3 * 9);
  assert.ok(plan.differential.every((d) => ['A', 'B', 'C'].includes(d.phase)));
});

test('the pickup pair is told apart by current, not by ratio', () => {
  const checks = alpha.standardChecks(D87, 5.0);
  const above = checks.find((c) => c.label === 'Pickup, above threshold');
  const below = checks.find((c) => c.label === 'Pickup, below threshold');

  // Identical ratios: the alpha plane alone cannot separate these two, which
  // is exactly why the pickup condition has to be evaluated.
  near(above.ratio.magnitude, below.ratio.magnitude, 1e-9);
  near(above.ratio.angle, below.ratio.angle, 1e-9);
  assert.strictEqual(above.result.inRegion, false);
  assert.strictEqual(below.result.inRegion, false);

  assert.ok(above.result.current > D87.pickup, 'above sits over the threshold');
  assert.ok(below.result.current < D87.pickup, 'below sits under it');
  assert.strictEqual(above.result.expect, 'OPERATE');
  assert.strictEqual(below.result.expect, 'RESTRAIN');
  assert.strictEqual(below.result.heldBy, 'pickup', 'held by the threshold, not the region');
});

test('a ratio outside the region still restrains below pickup', () => {
  const outside = C.polar(1, 0);
  const plenty = alpha.evaluate(outside, D87.r, D87.ang, { pickup: 1, current: 5 });
  const starved = alpha.evaluate(outside, D87.r, D87.ang, { pickup: 1, current: 0.2 });
  assert.strictEqual(plenty.expect, 'OPERATE');
  assert.strictEqual(starved.expect, 'RESTRAIN');
  assert.strictEqual(starved.heldBy, 'pickup');
});

test('with no pickup setting the ratio alone decides, and says so', () => {
  const res = alpha.evaluate(C.polar(1, 0), D87.r, D87.ang, {});
  assert.strictEqual(res.pickupOk, null, 'not judged rather than judged as passing');
  assert.strictEqual(res.expect, 'OPERATE');
});

test('the region still wins where both conditions fail', () => {
  // Through current: ratio inside the region and no differential current.
  const res = alpha.evaluate(C.polar(1, 180), D87.r, D87.ang, { pickup: 1, current: 0 });
  assert.strictEqual(res.expect, 'RESTRAIN');
  assert.strictEqual(res.heldBy, 'region');
});
