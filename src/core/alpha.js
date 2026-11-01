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
 * @param {object} ratio complex I_remote / I_local
 * @param {number} r     87LR
 * @param {number} angle 87LANG, total angular extent in degrees
 */
function evaluate(ratio, r, angle) {
  const inner = 1 / r;
  const magnitude = C.abs(ratio);
  const deviation = Math.abs(C.angleDiff(C.arg360(ratio), 180));

  const magOk = magnitude >= inner && magnitude <= r;
  const angOk = deviation <= angle / 2;

  return {
    magnitude,
    angle: C.arg360(ratio),
    deviation,
    inner,
    outer: r,
    halfSpan: angle / 2,
    magOk,
    angOk,
    restrain: magOk && angOk,
    expect: magOk && angOk ? 'RESTRAIN' : 'OPERATE'
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
    const res = evaluate(C.div(iR, iL), r, ang);
    out.push({
      phase,
      label,
      note,
      local: { magnitude: iLmag, angle: iLang },
      remote: { magnitude: iRmag, angle: iRang },
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

  if (d87.pickup) {
    push('Pickup (87LPP)', 'Differential current at the pickup threshold',
      d87.pickup * 0.55, 0, d87.pickup * 0.55, 0);
  }

  return out;
}

module.exports = { evaluate, region, standardChecks };
