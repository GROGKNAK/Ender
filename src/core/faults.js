'use strict';
/*
 * Fault quantities at both line ends, under the three models the operator can
 * choose between.
 *
 * constantCurrent / constantVoltage are bench models: one quantity is held and
 * the other follows the loop impedance. They need no system data and are what
 * most routine reach testing uses.
 *
 * sourceImpedance is a real two-source fault calculation in symmetrical
 * components. Both ends feed the fault, the split is by current division, and
 * each relay sees the drop across its own source. It is the only model that
 * produces believable remote-end quantities, which is why it is the default.
 *
 * Every model returns the same shape, so the rest of the app does not care
 * which one ran.
 */

const C = require('./complex');

const A = C.polar(1, 120);          // 1 ∠ 120°, the sequence operator
const A2 = C.polar(1, 240);

/** Sequence components (0, 1, 2) back to phase quantities (A, B, C). */
function toPhase(s0, s1, s2) {
  return [
    C.add(C.add(s0, s1), s2),
    C.add(C.add(s0, C.mul(A2, s1)), C.mul(A, s2)),
    C.add(C.add(s0, C.mul(A, s1)), C.mul(A2, s2))
  ];
}

/** Parallel combination of two impedances. */
function par(a, b) {
  return C.div(C.mul(a, b), C.add(a, b));
}

/*
 * Rotate a reference fault (on phase A, or between B and C) onto another
 * phase. Shifting the array alone is not enough -- the whole phasor set has to
 * turn with it, or the healthy phases end up at the wrong angles.
 */
function rotate(arr, r) {
  if (!r) return arr.slice();
  const t = C.polar(1, -120 * r);
  const out = new Array(3);
  for (let k = 0; k < 3; k += 1) out[(k + r) % 3] = C.mul(arr[k], t);
  return out;
}

const FAULT_TYPES = [
  { key: 'AG', label: 'A–G', kind: 'Phase-to-ground', base: 'ground', r: 0 },
  { key: 'BG', label: 'B–G', kind: 'Phase-to-ground', base: 'ground', r: 1 },
  { key: 'CG', label: 'C–G', kind: 'Phase-to-ground', base: 'ground', r: 2 },
  { key: 'BC', label: 'B–C', kind: 'Phase-to-phase', base: 'phase', r: 0 },
  { key: 'CA', label: 'C–A', kind: 'Phase-to-phase', base: 'phase', r: 1 },
  { key: 'AB', label: 'A–B', kind: 'Phase-to-phase', base: 'phase', r: 2 },
  { key: 'ABC', label: 'ABC', kind: 'Three-phase', base: 'three', r: 0 }
];

const byKey = (k) => FAULT_TYPES.find((t) => t.key === k);

/* ------------------------------------------------------------------ bench - */

/*
 * One end, with the test quantity held. `zLoop` is the positive-sequence
 * impedance to the fault as seen from this end; the residual term is applied
 * here for ground loops and nowhere else.
 */
function benchEnd(type, zLoop, k0p1, hold, vnom) {
  const t = byKey(type);
  const zGround = C.mul(zLoop, k0p1);

  if (t.base === 'ground') {
    const z = zGround;
    const current = hold.kind === 'current' ? hold.value : hold.value / C.abs(z);
    const vMag = current * C.abs(z);
    const v = [C.polar(vMag, 0), C.polar(vnom, -120), C.polar(vnom, 120)];
    const i = [C.polar(current, -C.arg(z)), C.ZERO, C.ZERO];
    return { v: rotate(v, t.r), i: rotate(i, t.r), zEff: z, current };
  }

  if (t.base === 'phase') {
    // Reference is a B-C fault: A stays healthy, B and C collapse toward it.
    const z2 = C.scale(zLoop, 2);
    const current = hold.kind === 'current' ? hold.value : (hold.value * Math.sqrt(3)) / C.abs(z2);
    const vbc = C.polar(current * C.abs(z2), -90);
    const sum = C.polar(vnom, 180);                 // V_B + V_C = -V_A
    const vb = C.scale(C.add(sum, vbc), 0.5);
    const vc = C.scale(C.sub(sum, vbc), 0.5);
    const ib = C.div(vbc, z2);
    const v = [C.polar(vnom, 0), vb, vc];
    const i = [C.ZERO, ib, C.neg(ib)];
    return { v: rotate(v, t.r), i: rotate(i, t.r), zEff: z2, current };
  }

  const current = hold.kind === 'current' ? hold.value : hold.value / C.abs(zLoop);
  const vMag = current * C.abs(zLoop);
  const za = C.arg(zLoop);
  return {
    v: [C.polar(vMag, 0), C.polar(vMag, -120), C.polar(vMag, 120)],
    i: [C.polar(current, -za), C.polar(current, -120 - za), C.polar(current, 120 - za)],
    zEff: zLoop,
    current
  };
}

/* --------------------------------------------------- source impedance ----- */

/*
 * Two-source fault calculation. `m` is the fault position as a fraction of the
 * line from the local end; it may exceed 1, which puts the fault beyond the
 * far bus and makes the remote current a through current.
 */
function sourceModel(type, opts) {
  const { m, z1, z0, srcL, srcR, e } = opts;
  const t = byKey(type);

  const zl1 = C.scale(z1, m);
  const zl0 = C.scale(z0, m);
  const zr1 = C.scale(z1, 1 - m);
  const zr0 = C.scale(z0, 1 - m);

  // Each side's path to the fault, per sequence. Beyond the far bus the remote
  // path doubles back through the line, which `1 - m` already makes negative,
  // so use the magnitude of the remaining section from the remote bus.
  const beyond = m > 1;
  const pathL1 = C.add(srcL.z1, zl1);
  const pathL0 = C.add(srcL.z0, zl0);
  const pathR1 = beyond ? C.add(srcR.z1, C.scale(z1, m - 1)) : C.add(srcR.z1, zr1);
  const pathR0 = beyond ? C.add(srcR.z0, C.scale(z0, m - 1)) : C.add(srcR.z0, zr0);

  const Z1T = par(pathL1, pathR1);
  const Z0T = par(pathL0, pathR0);
  const Z2T = Z1T;

  // Current division: the share flowing from each end.
  const shareL1 = C.div(pathR1, C.add(pathL1, pathR1));
  const shareL0 = C.div(pathR0, C.add(pathL0, pathR0));
  const shareR1 = C.sub(C.ONE, shareL1);
  const shareR0 = C.sub(C.ONE, shareL0);

  const E = C.polar(e, 0);
  let if1;
  let if2;
  let if0;

  if (t.base === 'ground') {
    if1 = C.div(E, C.add(C.add(Z1T, Z2T), Z0T));
    if2 = if1;
    if0 = if1;
  } else if (t.base === 'phase') {
    if1 = C.div(E, C.add(Z1T, Z2T));
    if2 = C.neg(if1);
    if0 = C.ZERO;
  } else {
    if1 = C.div(E, Z1T);
    if2 = C.ZERO;
    if0 = C.ZERO;
  }

  function end(share1, share0, src, reverse) {
    const i1 = C.mul(if1, share1);
    const i2 = C.mul(if2, share1);
    const i0 = C.mul(if0, share0);
    // Bus voltage is the source EMF less the drop across that source only.
    const v1 = C.sub(E, C.mul(i1, src.z1));
    const v2 = C.neg(C.mul(i2, src.z1));
    const v0 = C.neg(C.mul(i0, src.z0));
    const v = toPhase(v0, v1, v2);
    let i = toPhase(i0, i1, i2);
    if (reverse) i = i.map(C.neg);
    return { v: rotate(v, t.r), i: rotate(i, t.r) };
  }

  return {
    local: end(shareL1, shareL0, srcL, false),
    // Past the far bus the current leaves the line through the remote CT.
    remote: end(shareR1, shareR0, srcR, beyond),
    sequence: { if1, if2, if0, Z1T, Z0T }
  };
}

/*
 * A fault behind the local relay, for a reverse-looking zone.
 *
 * The fault sits at Zrev behind the local bus, between it and the local
 * source. The local source feeds it directly without passing through the
 * relay's CT, so the relay carries only what comes from the remote end,
 * through the line and out of the bus -- which is why it reads as reverse.
 *
 * Working the result back gives an apparent impedance of -Zrev at the local
 * relay, which is the reverse reach, as it should be.
 */
function reverseSourceModel(type, opts) {
  const { zrev, z1, z0, srcL, srcR, e } = opts;
  const t = byKey(type);

  // Zero-sequence reverse reach scales with the line's Z0/Z1 ratio.
  const ratio = C.div(z0, z1);
  const zrev0 = C.mul(zrev, ratio);

  // Local branch runs from the local source down to the fault; the fault is
  // between the bus and the source, so that branch is what is left of it.
  const localBranch1 = C.sub(srcL.z1, zrev);
  const localBranch0 = C.sub(srcL.z0, zrev0);
  const remoteBranch1 = C.add(C.add(srcR.z1, z1), zrev);
  const remoteBranch0 = C.add(C.add(srcR.z0, z0), zrev0);

  // A reverse reach deeper than the source behind the terminal has no
  // physical fault point with the source data given. Say so rather than
  // returning a confident negative impedance.
  const unphysical = C.abs(zrev) >= C.abs(srcL.z1);

  const Z1T = par(localBranch1, remoteBranch1);
  const Z0T = par(localBranch0, remoteBranch0);
  const Z2T = Z1T;

  // The relay sees only the remote branch's share.
  const share1 = C.div(localBranch1, C.add(localBranch1, remoteBranch1));
  const share0 = C.div(localBranch0, C.add(localBranch0, remoteBranch0));

  const E = C.polar(e, 0);
  let if1;
  let if2;
  let if0;
  if (t.base === 'ground') {
    if1 = C.div(E, C.add(C.add(Z1T, Z2T), Z0T));
    if2 = if1;
    if0 = if1;
  } else if (t.base === 'phase') {
    if1 = C.div(E, C.add(Z1T, Z2T));
    if2 = C.neg(if1);
    if0 = C.ZERO;
  } else {
    if1 = C.div(E, Z1T);
    if2 = C.ZERO;
    if0 = C.ZERO;
  }

  // Sequence voltages at the fault.
  const vf1 = C.sub(E, C.mul(if1, Z1T));
  const vf2 = C.neg(C.mul(if2, Z2T));
  const vf0 = C.neg(C.mul(if0, Z0T));

  // The part of the fault current that flows through the relay.
  const i1 = C.mul(if1, share1);
  const i2 = C.mul(if2, share1);
  const i0 = C.mul(if0, share0);

  const busOf = (add1, add0) => toPhase(
    C.add(vf0, C.mul(i0, add0)),
    C.add(vf1, C.mul(i1, add1)),
    C.add(vf2, C.mul(i2, add1))
  );

  // Local bus is Zrev back from the fault; the remote bus a line further.
  const vLocal = busOf(zrev, zrev0);
  const vRemote = busOf(C.add(zrev, z1), C.add(zrev0, z0));
  const through = toPhase(i0, i1, i2);

  return {
    // Reversed through the local CT, forward through the remote one.
    local: { v: rotate(vLocal, t.r), i: rotate(through.map(C.neg), t.r) },
    remote: { v: rotate(vRemote, t.r), i: rotate(through, t.r) },
    unphysical
  };
}

/* ------------------------------------------------------------------ api --- */

/**
 * Quantities at both ends for one fault.
 *
 * @param {object} args
 *   type      fault key, e.g. 'AG'
 *   zLoop     positive-sequence impedance from the local end to the fault
 *   line      result of buildLine()
 * @returns {{local, remote, model, meta}}
 */
function faultQuantities(args) {
  const { type, zLoop, line, reverse } = args;
  const op = line.operator;
  const z1 = line.z1;
  const m = C.abs(zLoop) / C.abs(z1);
  // A reverse fault is behind the relay, so it is never between the two
  // current transformers and the differential must always restrain.
  const onLine = reverse ? false : m <= 1 + 1e-12;

  if (reverse) {
    // The reverse reach, expressed forward, for building the network.
    const zrev = C.polar(C.abs(zLoop), C.arg(z1));

    if (op.faultModel === 'sourceImpedance') {
      const { sourceOf } = require('./line');
      const out = reverseSourceModel(type, {
        zrev,
        z1: line.z1,
        z0: line.z0,
        srcL: sourceOf(op.sourceLocal),
        srcR: sourceOf(op.sourceRemote),
        e: op.vnom
      });
      return {
        local: out.local,
        remote: out.remote,
        model: 'sourceImpedance',
        meta: { m, onLine: false, reverse: true, unphysical: out.unphysical }
      };
    }

    const holdR = op.faultModel === 'constantVoltage'
      ? { kind: 'voltage', value: op.vnom }
      : { kind: 'current', value: op.testCurrent };

    // zLoop already carries the reversed angle, so the local current comes out
    // reversed on its own. The remote end looks forward through the whole line
    // and on past the local bus, carrying the same current in series.
    const local = benchEnd(type, zLoop, line.k0p1, holdR, op.vnom);
    const remote = benchEnd(type, C.add(z1, zrev), line.k0p1, holdR, op.vnom);
    return {
      local: { v: local.v, i: local.i },
      remote: { v: remote.v, i: remote.i },
      model: op.faultModel,
      meta: { m, onLine: false, reverse: true, zRemote: C.add(z1, zrev) }
    };
  }

  if (op.faultModel === 'sourceImpedance') {
    const { sourceOf } = require('./line');
    const out = sourceModel(type, {
      m,
      z1: line.z1,
      z0: line.z0,
      srcL: sourceOf(op.sourceLocal),
      srcR: sourceOf(op.sourceRemote),
      e: op.vnom
    });
    return {
      local: out.local,
      remote: out.remote,
      model: 'sourceImpedance',
      meta: { m, onLine, sequence: out.sequence }
    };
  }

  const hold = op.faultModel === 'constantVoltage'
    ? { kind: 'voltage', value: op.vnom }
    : { kind: 'current', value: op.testCurrent };

  const local = benchEnd(type, zLoop, line.k0p1, hold, op.vnom);

  // Remote end: infeed while the fault is on the line, through current past it.
  const zRemote = onLine ? C.sub(z1, zLoop) : C.sub(zLoop, z1);
  const remoteHold = hold.kind === 'current'
    ? { kind: 'current', value: hold.value * (onLine ? op.infeed : 1) }
    : hold;
  const remote = benchEnd(type, zRemote, line.k0p1, remoteHold, op.vnom);
  if (!onLine) remote.i = remote.i.map(C.neg);

  return {
    local: { v: local.v, i: local.i },
    remote: { v: remote.v, i: remote.i },
    model: op.faultModel,
    meta: {
      m,
      onLine,
      zRemote,
      zEffLocal: local.zEff,
      zEffRemote: remote.zEff,
      currentLocal: local.current,
      currentRemote: remote.current
    }
  };
}

module.exports = {
  FAULT_TYPES, byKey, faultQuantities, benchEnd, sourceModel, reverseSourceModel,
  toPhase, rotate, par
};
