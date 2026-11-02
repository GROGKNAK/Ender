'use strict';
/*
 * The plots.
 *
 * Geometry is shared between the screen and the exported report, so these
 * tests are the only place either picture is checked. The ones that matter
 * most are the omission tests: a test point left out of the report must be
 * absent from the plot as well, or the picture quietly contradicts the table
 * printed beside it.
 */
const test = require('node:test');
const assert = require('node:assert');

const Plot = require('../src/core/plot');
const C = require('../src/core/complex');
const { parseSettings } = require('../src/core/parseSettings');
const { buildRelay } = require('../src/core/relay');
const { buildLine } = require('../src/core/line');
const { buildPlan, applyOmissions } = require('../src/core/testplan');

const SAMPLE = `<table>
  <tr><td>RID</td><td>ALPHA_LN1</td></tr>
  <tr><td>Z1MAG</td><td>8.32</td><td>Z1ANG</td><td>84.50</td></tr>
  <tr><td>Z0MAG</td><td>24.50</td><td>Z0ANG</td><td>78.20</td></tr>
  <tr><td>Z1P</td><td>7.07</td></tr><tr><td>Z2P</td><td>12.48</td></tr>
  <tr><td>87LR</td><td>6.00</td></tr><tr><td>87LANG</td><td>195.00</td></tr>
  <tr><td>87LPP</td><td>1.00</td></tr>
  <tr><td>CTR</td><td>240</td></tr><tr><td>PTR</td><td>2000</td></tr>
</table><p>FID = SEL-411L-R110</p>`;

function fixture() {
  const a = buildRelay(parseSettings(SAMPLE), { fileName: 'A.html', rawText: SAMPLE });
  const b = buildRelay(parseSettings(SAMPLE), { fileName: 'B.html', rawText: SAMPLE });
  const line = buildLine(a, b, { faultModel: 'constantCurrent' });
  return { line, plan: buildPlan(line) };
}

const asPoints = (rows) => Plot.distancePoints(rows.map((r) => ({
  id: r.id, zMag: C.abs(r.zLoop), reverse: r.reverse, expect21: r.expect21
})));

/*
 * Every identifier on every dot. Read from `labels` rather than from `label`,
 * which is the drawn text and gets shortened to "T01, T03, T05 +4" once more
 * than a few rows land on one spot.
 */
const labelsOf = (points) => points.flatMap((p) => p.labels);

/* ------------------------------------------------------------- omission --- */

test('an omitted distance point is absent from the plot', () => {
  const { plan } = fixture();
  const victim = plan.distance[2];
  assert.ok(labelsOf(asPoints(plan.distance)).includes(victim.id), 'present to begin with');

  const trimmed = applyOmissions(plan, { [victim.lockKey]: true });
  const labels = labelsOf(asPoints(trimmed.distance));

  assert.ok(!labels.includes(victim.id), victim.id + ' is still on the plot');
  // And nothing else went with it.
  for (const r of trimmed.distance) assert.ok(labels.includes(r.id), r.id + ' went missing');
});

test('an omitted 87L check is absent from the plot', () => {
  const { plan } = fixture();
  const victim = plan.differential[0];
  const at = (list) => list.filter((x) =>
    Math.abs(x.ratio.angle - victim.ratio.angle) < 0.05 &&
    Math.abs(x.ratio.magnitude - victim.ratio.magnitude) < 0.001);
  const dotAt = (list) => Plot.differentialPoints(list).filter((p2) =>
    Math.abs(p2.angle - victim.ratio.angle) < 0.05 &&
    Math.abs(p2.magnitude - victim.ratio.magnitude) < 0.001);

  assert.ok(labelsOf(Plot.differentialPoints(plan.differential)).includes(victim.id),
    'present to begin with');

  /*
   * A check exists once per phase. Omitting one phase leaves the others in
   * the report, so the dot has to stay -- it is the same injection, and the
   * table beside the plot still lists it.
   */
  const sameCheck = plan.differential.filter((x) => x.label === victim.label);
  assert.ok(sameCheck.length > 1, 'the check covers more than one phase');
  let trimmed = applyOmissions(plan, { [victim.lockKey]: true });
  assert.strictEqual(dotAt(trimmed.differential).length, 1,
    'the dot should survive while another phase of the check remains');

  // Every row that shares the spot gone: no row left, so no dot.
  const all = {};
  for (const x of at(plan.differential)) all[x.lockKey] = true;
  trimmed = applyOmissions(plan, all);
  assert.strictEqual(dotAt(trimmed.differential).length, 0,
    victim.label + ' is still plotted after every check at that ratio was omitted');
});

test('a dot is labelled from one phase, not all three', () => {
  const { plan } = fixture();
  const phaseOf = new Map(plan.differential.map((x) => [x.id, x.phase]));
  const ids = labelsOf(Plot.differentialPoints(plan.differential));
  assert.ok(ids.length, 'some points were plotted');
  for (const id of ids) {
    assert.strictEqual(phaseOf.get(id), 'A',
      id + ' is labelled from a phase other than the first');
  }
});

/* --------------------------------------------------------------- points --- */

test('points carry the verdict the table shows', () => {
  const { plan } = fixture();
  const byId = new Map();
  for (const p of asPoints(plan.distance)) {
    for (const id of p.labels) byId.set(id, p.role);
  }
  for (const r of plan.distance) {
    assert.strictEqual(byId.get(r.id), r.expect21 === 'OPERATE' ? 'good' : 'bad',
      r.id + ' is plotted in the wrong colour');
  }
});

test('coincident points merge and a split verdict is marked rather than guessed', () => {
  const same = { key: 'k', mag: 1, label: 'T01', role: 'good' };
  assert.strictEqual(Plot.groupPoints([same, Object.assign({}, same, { label: 'T02' })])[0].label,
    'T01, T02');

  const split = Plot.groupPoints([same, Object.assign({}, same, { label: 'T02', role: 'bad' })]);
  assert.strictEqual(split.length, 1);
  assert.strictEqual(split[0].role, 'mixed');
});

test('the three phases of one check are a single dot, labelled once', () => {
  const checks = ['A', 'B', 'C'].map((phase) => ({
    id: 'D01', phase, ratio: { magnitude: 2, angle: 180 }, result: { expect: 'OPERATE' }
  }));
  const pts = Plot.differentialPoints(checks);
  assert.strictEqual(pts.length, 1);
  assert.strictEqual(pts[0].label, 'D01');
});

/* ------------------------------------------------------------ geometry --- */

test('a reverse zone puts its points on the other side of the origin', () => {
  const zones = [
    { name: 'Zone 1', reach: 7, direction: 'forward' },
    { name: 'Zone 3', reach: 5, direction: 'reverse' }
  ];
  const model = { zones, z1mag: 8.32, z1ang: 84.5 };
  const fwd = Plot.rx(model, { points: [{ key: 'f', mag: 6, reverse: false, role: 'good', label: 'T01' }] });
  const rev = Plot.rx(model, { points: [{ key: 'r', mag: 6, reverse: true, role: 'good', label: 'T02' }] });

  const dot = (spec) => spec.items.find((i) => i.t === 'dot');
  const axis = Plot.rx(model, {}).items.find((i) => i.t === 'line' && i.role === 'axis');

  assert.ok(dot(fwd).cy < axis.y1, 'a forward point should sit above the resistance axis');
  assert.ok(dot(rev).cy > axis.y1, 'a reverse point should sit below it');
});

test('the restraint region spans the set radii and angle', () => {
  const spec = Plot.alpha({ r: 6, ang: 195 }, { width: 420, height: 420 });
  const path = spec.items.find((i) => i.t === 'path');
  assert.ok(path && path.closed);

  const cx = 210;
  const cy = 210;
  const radii = path.pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const S = (210 - 14) / Math.max(7, 6 * 1.2);

  // The boundary runs between the inner and outer radii and touches both.
  assert.ok(Math.abs(Math.max(...radii) - 6 * S) < 0.01, 'outer radius is 87LR');
  assert.ok(Math.abs(Math.min(...radii) - (1 / 6) * S) < 0.01, 'inner radius is 1/87LR');

  // And it is centred on 180 degrees -- where a healthy line sits -- spanning
  // 87LANG, so the extreme points are 97.5 degrees either side of it.
  const angles = path.pts.map((p) => (Math.atan2(cy - p[1], p[0] - cx) * 180 / Math.PI + 360) % 360);
  assert.ok(Math.abs(Math.max(...angles) - (180 + 195 / 2)) < 0.01);
  assert.ok(Math.abs(Math.min(...angles) - (180 - 195 / 2)) < 0.01);
});

test('labels are nudged apart and the moved ones keep a line to their dot', () => {
  // Two points a hair apart: without spacing their labels would overlap.
  const checks = [
    { id: 'D06', phase: 'A', ratio: { magnitude: 1, angle: 275 }, result: { expect: 'RESTRAIN' } },
    { id: 'D07', phase: 'A', ratio: { magnitude: 1, angle: 276 }, result: { expect: 'OPERATE' } }
  ];
  const spec = Plot.alpha({ r: 6, ang: 195 }, { points: Plot.differentialPoints(checks) });
  const texts = spec.items.filter((i) => i.t === 'text' && /^D\d/.test(i.s));
  assert.strictEqual(texts.length, 2);
  assert.ok(Math.abs(texts[0].y - texts[1].y) >= 10.5, 'labels still overlap');
  assert.ok(spec.items.some((i) => i.t === 'line' && i.fade), 'a displaced label has no leader');
});

test('the frame shrinks to what is drawn', () => {
  const short = Plot.rx({ zones: [{ name: 'Zone 1', reach: 2, direction: 'forward' }], z1mag: 2, z1ang: 85 },
    { width: 392, height: 440 });
  assert.ok(short.height < 440, 'a short line should not leave half the panel empty');
  assert.ok(short.height > 60);
});

test('no settings means no plot rather than a broken one', () => {
  const spec = Plot.rx({ zones: [], z1mag: 0, z1ang: 0 }, {});
  assert.deepStrictEqual(spec.items, []);
});

test('a crowded spot keeps its label short without losing the rows', () => {
  /*
   * All six phase loops measure the same impedance wherever the ground and
   * phase reaches are equal, so a single dot routinely carries seven rows.
   * Seven identifiers strung across a plot label nothing, but the dot still
   * has to know which rows it holds.
   */
  const rows = ['T01', 'T03', 'T05', 'T07', 'T09', 'T11', 'T13'].map((id) => ({
    id, zMag: 6.01, reverse: false, expect21: 'OPERATE'
  }));
  const [dot] = Plot.distancePoints(rows);

  assert.strictEqual(dot.count, 7);
  assert.deepStrictEqual(dot.labels, rows.map((r) => r.id), 'every row is still on the dot');
  assert.strictEqual(dot.label, 'T01, T03, T05 +4');

  // A handful is written out in full; the cap only bites past three.
  assert.strictEqual(Plot.distancePoints(rows.slice(0, 3))[0].label, 'T01, T03, T05');
  assert.strictEqual(Plot.distancePoints(rows.slice(0, 4))[0].label, 'T01, T03, T05 +1');
});

test('the whole default matrix plots onto one dot per zone and point', () => {
  const { plan } = fixture();
  const pts = asPoints(plan.distance);
  // Two zones in this fixture, in and out: four spots, every row on one.
  assert.strictEqual(pts.length, 4);
  assert.strictEqual(
    pts.reduce((n, p) => n + p.count, 0),
    plan.distance.length,
    'every test point reached the plot exactly once'
  );
  for (const p of pts) assert.ok(p.label.length < 20, 'label too long to draw: ' + p.label);
});
