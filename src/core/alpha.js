'use strict';
/*
 * The 87L alpha plane: the complex ratio of remote to local current.
 *
 * The element restrains inside an annular sector -- between radius 1/87LR and
 * 87LR, spanning 87LANG centred on 180 degrees. The centre is 180 because
 * through current enters one end and leaves the other, putting the ratio at
 * -1; an internal fault swings it toward +1 and out of the region.
 *
 * The angular test has to be done on the wrapped difference from 180. Doing it
 * by naive comparison is the classic way to get the boundary backwards, since
 * the region straddles the discontinuity at 0/360.
 */

const C = require('./complex');

/**
 * Decide what the element does.
 *
 * Two conditions have to hold for it to operate: the current ratio must fall
 * outside the restraint region, AND the differential current must exceed the
 * pickup setting. Judging the ratio alone looks right most of the time and is
 * wrong exactly where it matters -- a small in-phase pair sits outside the
 * region but is too small to operate on.
 *
 * @param {object} ratio complex I_remote / I_local
 * @param {number} r     87LR
 * @param {number} angle 87LANG, total angular extent in degrees
 * @param {object} [opts] { pickup, current } -- 87LPP and |I_local + I_remote|
 */
function evaluate(ratio, r, angle, opts = {}) {
  const inner = 1 / r;
  const magnitude = C.abs(ratio);
  const deviation = Math.abs(C.angleDiff(C.arg360(ratio), 180));

  const magOk = magnitude >= inner && magnitude <= r;
  const angOk = deviation <= angle / 2;
  const inRegion = magOk && angOk;

  const pickup = (opts.pickup === null || opts.pickup === undefined) ? null : opts.pickup;
  const current = opts.current === undefined ? null : opts.current;
  // null where there is nothing to judge it against, so the UI can say so
  // rather than implying the condition was checked.
  const pickupOk = (pickup === null || current === null) ? null : current > pickup;

  const restrain = inRegion || pickupOk === false;

  return {
    magnitude,
    angle: C.arg360(ratio),
    deviation,
    inner,
    outer: r,
    halfSpan: angle / 2,
    magOk,
    angOk,
    inRegion,
    pickup,
    current,
    pickupOk,
    restrain,
    expect: restrain ? 'RESTRAIN' : 'OPERATE',
    // Why it restrained, for the report: the region or the threshold.
    heldBy: restrain ? (inRegion ? 'region' : 'pickup') : null
  };
}

/** The boundary of the restraint region, for plotting. */
function region(r, angle) {
  return {
    inner: 1 / r,
    outer: r,
    from: 180 - angle / 2,
    to: 180 + angle / 2
  };
}

/*
 * A check set built from the relay's own settings rather than fixed numbers,
 * so it still brackets the boundary when the settings change. Each pair sits
 * just inside and just outside one edge -- that is what proves a setting, as
 * opposed to confirming a point deep in the middle of the region.
 */
function standardChecks(d87, testCurrent, phase = 'A') {
  const r = d87.r;
  const ang = d87.ang;
  const edge = 180 + ang / 2;
  const margin = 2.5;
  const out = [];

  const push = (label, note, iLmag, iLang, iRmag, iRang) => {
    const iL = C.polar(iLmag, iLang);
    const iR = C.polar(iRmag, iRang);
    // Differential current: the vector sum of what the two ends measure. For
    // through current the two cancel and it is zero; for an internal fault
    // they add.
    const differential = C.abs(C.add(iL, iR));
    const res = evaluate(C.div(iR, iL), r, ang, { pickup: d87.pickup, current: differential });
    out.push({
      phase,
      label,
      note,
      local: { magnitude: iLmag, angle: iLang },
      remote: { magnitude: iRmag, angle: iRang },
      differential,
      ratio: { magnitude: res.magnitude, angle: res.angle },
      result: res
    });
  };

  push('Through load', 'External current in one end and out the other',
    testCurrent, 0, testCurrent, 180);
  push('Internal fault, equal infeed', 'Both ends feed the fault in phase',
    testCurrent, 0, testCurrent, 0);
  push('Outer radius, outside', 'Ratio magnitude just past 87LR',
    testCurrent / r * 0.92, 0, testCurrent, 180);
  push('Outer radius, inside', 'Ratio magnitude just within 87LR',
    testCurrent / r * 1.08, 0, testCurrent, 180);
  push('Inner radius, outside', 'Ratio magnitude just below 1/87LR',
    testCurrent, 0, testCurrent / r * 0.92, 180);
  push('Angle edge, inside', 'Angular deviation just within 87LANG/2',
    testCurrent, 0, testCurrent, edge - margin);
  push('Angle edge, outside', 'Angular deviation just past 87LANG/2',
    testCurrent, 0, testCurrent, edge + margin);

  /*
   * The pickup threshold needs a pair either side of it, the same way a
   * distance reach does. Both have a ratio of +1, which is outside the
   * restraint region, so the ratio alone would say OPERATE for both -- only
   * the differential current tells them apart, and that is the point.
   *
   * Each end carries half the differential current, so 0.55 and 0.45 of the
   * setting put the pair at 110% and 90% of pickup.
   */
  if (d87.pickup) {
    push('Pickup, above threshold', 'Differential current just above 87LPP',
      d87.pickup * 0.55, 0, d87.pickup * 0.55, 0);
    push('Pickup, below threshold', 'Differential current just below 87LPP — too small to operate on',
      d87.pickup * 0.45, 0, d87.pickup * 0.45, 0);
  }

  return out;
}

module.exports = { evaluate, region, standardChecks };
