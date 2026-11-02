'use strict';
/*
 * Builds the test matrix from the line model.
 *
 * Two points per zone per fault type: one inside the reach where the element
 * must operate, one past it where it must not. The out-of-zone point is the
 * half that actually proves anything -- an element that trips for everything
 * passes every in-zone test ever written.
 *
 * The distance verdict and the differential verdict are computed independently
 * and will disagree on purpose: a Zone 2 fault beyond the far bus is inside
 * the distance reach but outside the differential zone.
 */

const C = require('./complex');
const { FAULT_TYPES, byKey, faultQuantities } = require('./faults');
const { standardChecks } = require('./alpha');

/*
 * Every loop, not one per category.
 *
 * The six phase loops are not interchangeable: each uses different CT and VT
 * inputs and a different measuring loop in the relay. A swapped B-phase CT,
 * an open C-phase VT fuse, or a zone that only picks up on two of the three
 * ground loops all pass an A-G test and fail a B-G one. Testing one loop per
 * category proves the settings; testing all six proves the wiring too, which
 * is what commissioning is for.
 *
 * It costs points -- three zones become 42 rows rather than 18 -- so anything
 * not wanted on a particular job comes off with the omit checkbox on the
 * report, per row, rather than by quietly never being generated.
 */
const DEFAULT_TYPES = ['AG', 'BG', 'CG', 'BC', 'CA', 'AB', 'ABC'];

const A_OP = C.polar(1, 120);
const A2_OP = C.polar(1, 240);

/*
 * Does enough current flow for the zone's fault detectors to let it operate?
 *
 * A distance element is supervised: the impedance can sit squarely inside the
 * reach and the element still will not pick up if the current is below the
 * detector thresholds. Ignoring that produces a test point marked OPERATE
 * that a healthy relay will correctly fail to trip on.
 */
function evaluateSupervision(zone, base, currents) {
  const sup = zone.supervision || {};
  const [ia, ib, ic] = currents;

  const residual = C.abs(C.add(C.add(ia, ib), ic));
  const positive = C.abs(C.scale(C.add(C.add(ia, C.mul(A_OP, ib)), C.mul(A2_OP, ic)), 1 / 3));
  const phaseToPhase = Math.max(
    C.abs(C.sub(ia, ib)), C.abs(C.sub(ib, ic)), C.abs(C.sub(ic, ia))
  );

  const checks = [];
  if (base === 'ground' && sup.ground !== null && sup.ground !== undefined) {
    checks.push({ label: 'residual', setting: sup.groundFrom || '50GZ', need: sup.ground, got: residual });
  }
  if (base !== 'ground' && sup.phase !== null && sup.phase !== undefined) {
    checks.push({ label: 'phase-to-phase', setting: sup.phaseFrom || '50PP', need: sup.phase, got: phaseToPhase });
  }
  if (sup.positive !== null && sup.positive !== undefined) {
    checks.push({ label: 'positive sequence', setting: sup.positiveFrom || '50L', need: sup.positive, got: positive });
  }

  if (!checks.length) {
    // Nothing to judge it against; say so rather than implying it passed.
    return { checked: false, ok: null, checks: [], residual, positive, phaseToPhase };
  }

  const failed = checks.filter((c) => c.got <= c.need);
  return {
    checked: true,
    ok: failed.length === 0,
    checks,
    failed,
    residual,
    positive,
    phaseToPhase
  };
}

/*
 * A lock has to survive the settings being changed, so it cannot be keyed on
 * the row number or the percentage. Zone, fault type and which side of the
 * reach the point sits on identify the same test across any amount of
 * experimenting.
 */
function lockKeyOf(row) {
  return row.zoneNo + '|' + row.type + '|' + row.pointKey;
}

/*
 * The same idea for a differential check. Prefixed so a differential key can
 * never collide with a distance one in the same map.
 */
function diffKeyOf(check) {
  return 'D|' + check.phase + '|' + check.label;
}

function distanceTests(line, opts = {}) {
  const op = line.operator;
  const types = (opts.faultTypes || DEFAULT_TYPES).map(byKey).filter(Boolean);
  const zones = opts.zones
    ? line.zones.filter((z) => opts.zones.includes(z.n))
    : line.zones;

  const points = [
    { key: 'in', label: 'In zone', pct: op.inZonePct, expect: 'OPERATE' },
    { key: 'out', label: 'Out of zone', pct: op.outZonePct, expect: 'RESTRAIN' }
  ];

  const rows = [];
  let n = 0;

  for (const zone of zones) {
    for (const type of types) {
      for (const point of points) {
        const p = point.pct / 100;
        // A reverse zone looks behind the relay, so its test points sit on the
        // opposite side of the origin: same magnitude, 180 degrees round.
        const reverse = zone.direction === 'reverse';
        const zLoop = C.polar(zone.reach * p, line.z1ang.value + (reverse ? 180 : 0));
        const q = faultQuantities({ type: type.key, zLoop, line, reverse });
        const linePct = (C.abs(zLoop) / C.abs(line.z1)) * 100;
        const onLine = q.meta.onLine;
        const vFaulted = Math.max(...q.local.v.map(C.abs).map((x, i) =>
          (C.abs(q.local.i[i]) > 1e-9 ? x : 0)));

        /*
         * Supervision can only hold an element back. An out-of-zone point is
         * already expected to restrain, so this changes nothing there; it
         * matters for an in-zone point that the relay cannot act on.
         */
        const supervision = evaluateSupervision(zone, type.base, q.local.i);
        const starved = supervision.ok === false;
        const expect21 = point.expect === 'OPERATE' && starved ? 'RESTRAIN' : point.expect;

        n += 1;
        rows.push({
          n,
          id: 'T' + String(n).padStart(2, '0'),
          supervision,
          heldBySupervision: point.expect === 'OPERATE' && starved,
          zone: zone.name,
          zoneNo: zone.n,
          reach: zone.reach,
          reachFrom: zone.reachFrom,
          direction: zone.direction,
          directionSource: zone.directionSource,
          directionFrom: zone.directionFrom,
          reverse,
          // The reverse reach is deeper than the source behind the terminal,
          // so there is no physical fault point with the source data given.
          unphysical: Boolean(q.meta.unphysical),
          type: type.key,
          typeLabel: type.label,
          kind: type.kind,
          point: point.label,
          pointKey: point.key,
          pctOfReach: point.pct,
          zLoop,
          linePct,
          onLine,
          expect21,
          expect87: onLine ? 'OPERATE' : 'RESTRAIN',
          local: q.local,
          remote: q.remote,
          meta: q.meta,
          model: q.model,
          // Flagged rather than silently produced: a bench model will happily
          // ask for a voltage no real source could deliver.
          voltageWarning: vFaulted > op.warnVolts ? vFaulted : null
        });
      }
    }
  }
  return rows;
}

function differentialTests(line, opts = {}) {
  if (!line.d87 || !line.d87.r || !line.d87.ang) return [];
  const phases = opts.phases || ['A', 'B', 'C'];
  const out = [];
  let n = 0;
  for (const phase of phases) {
    for (const check of standardChecks(line.d87, line.operator.testCurrent, phase)) {
      n += 1;
      out.push(Object.assign({
        n,
        id: 'D' + String(n).padStart(2, '0'),
        lockKey: diffKeyOf(check)
      }, check));
    }
  }
  return out;
}

/**
 * Everything a report needs, in one object.
 *
 * `opts.locks` maps a lock key to a frozen row captured earlier. A locked row
 * is substituted wholesale rather than recomputed, so changing the fault model
 * or a reach percentage leaves it exactly as it was signed off. The settings
 * it was built under travel with it, because a report that mixes locked and
 * live rows has to be able to say which is which.
 */
function buildPlan(line, opts = {}) {
  let distance = distanceTests(line, opts);
  const locks = opts.locks || {};

  distance = distance.map((row) => {
    const key = lockKeyOf(row);
    const lock = locks[key];
    if (!lock) return Object.assign({}, row, { lockKey: key, locked: false });
    return Object.assign({}, lock.row, {
      n: row.n,
      id: row.id,
      lockKey: key,
      locked: true,
      lockedAt: lock.at,
      lockedOperator: lock.operator
    });
  });

  let differential = differentialTests(line, opts);
  differential = differential.map((check) => {
    const lock = locks[check.lockKey];
    if (!lock) return Object.assign({}, check, { locked: false });
    return Object.assign({}, lock.row, {
      n: check.n,
      id: check.id,
      lockKey: check.lockKey,
      locked: true,
      lockedAt: lock.at,
      lockedOperator: lock.operator
    });
  });

  const warnings = distance.filter((r) => r.voltageWarning);
  const lockedCount = distance.filter((r) => r.locked).length +
    differential.filter((d) => d.locked).length;
  const reverseCount = distance.filter((r) => r.reverse).length;
  const unphysicalCount = distance.filter((r) => r.unphysical).length;
  const starvedCount = distance.filter((r) => r.heldBySupervision).length;

  return {
    distance,
    differential,
    lockedCount,
    reverseCount,
    unphysicalCount,
    starvedCount,
    counts: {
      distance: distance.length,
      differential: differential.length,
      total: distance.length + differential.length,
      voltageWarnings: warnings.length
    },
    generatedAt: new Date().toISOString()
  };
}

/**
 * Drop the test points marked "omit from report".
 *
 * Applied only when exporting, so the omitted rows stay visible and reversible
 * in the app. The count travels with the result because a report that quietly
 * contains fewer tests than were run is a worse document than one that says so.
 *
 * @param {object} plan  from buildPlan()
 * @param {object} omit  lock key -> true
 */
function applyOmissions(plan, omit) {
  const flags = omit || {};
  const kept = plan.distance.filter((r) => !flags[r.lockKey]);
  const dropped = plan.distance.filter((r) => flags[r.lockKey]);
  const keptD = plan.differential.filter((d) => !flags[d.lockKey]);
  const droppedD = plan.differential.filter((d) => flags[d.lockKey]);

  if (!dropped.length && !droppedD.length) {
    return Object.assign({}, plan, { omittedCount: 0, omitted: [] });
  }

  return Object.assign({}, plan, {
    distance: kept,
    differential: keptD,
    omittedCount: dropped.length + droppedD.length,
    omitted: dropped.map((r) => ({
      id: r.id, zone: r.zone, type: r.typeLabel, point: r.point
    })).concat(droppedD.map((d) => ({
      id: d.id, zone: '87L', type: d.phase, point: d.label
    }))),
    lockedCount: kept.filter((r) => r.locked).length + keptD.filter((d) => d.locked).length,
    starvedCount: kept.filter((r) => r.heldBySupervision).length,
    counts: Object.assign({}, plan.counts, {
      distance: kept.length,
      differential: keptD.length,
      total: kept.length + keptD.length,
      voltageWarnings: kept.filter((r) => r.voltageWarning).length
    })
  });
}

module.exports = {
  buildPlan, distanceTests, differentialTests, lockKeyOf, diffKeyOf, applyOmissions,
  DEFAULT_TYPES, FAULT_TYPES
};
