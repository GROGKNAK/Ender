'use strict';
/*
 * The protected line: what both relays agree it is, plus the operator inputs
 * that are not in either relay.
 *
 * Intermediate values (the numerator and denominator of k0, for instance) are
 * kept on the result rather than discarded, because the calculation record has
 * to show the working and must not re-derive it independently -- if it did,
 * the record could silently disagree with the numbers it claims to explain.
 */

const C = require('./complex');

/** Operator-supplied values, with the defaults used when nothing is entered. */
const DEFAULT_OPERATOR = {
  testCurrent: 5.0,       // A secondary
  infeed: 0.65,           // remote contribution while the fault is on the line
  vnom: 67.0,             // V line-to-neutral secondary
  faultModel: 'constantCurrent',
  inZonePct: 85,
  outZonePct: 110,
  /* Per-zone direction override, by zone number: 'forward' | 'reverse' | 'off'.
   * Empty means follow the relay, or forward where it does not say. */
  zoneDirections: {},
  warnVolts: 100,
  sourceLocal: { z1mag: 3.10, z1ang: 86.0, z0mag: 4.95, z0ang: 81.0 },
  sourceRemote: { z1mag: 5.80, z1ang: 85.0, z0mag: 9.20, z0ang: 80.0 }
};

const FAULT_MODELS = {
  constantCurrent: 'Constant test current',
  constantVoltage: 'Constant test voltage',
  sourceImpedance: 'Constant source impedance'
};

function pick(local, remote, key) {
  const a = local && local[key] ? local[key] : null;
  const b = remote && remote[key] ? remote[key] : null;
  return a || b;
}

/**
 * @param {object} local   relay model for the local end
 * @param {object} remote  relay model for the remote end
 * @param {object} op      operator inputs (see DEFAULT_OPERATOR)
 */
function buildLine(local, remote, op = {}) {
  const operator = Object.assign({}, DEFAULT_OPERATOR, op);

  const z1mag = pick(local, remote, 'z1mag');
  const z1ang = pick(local, remote, 'z1ang');
  const z0mag = pick(local, remote, 'z0mag');
  const z0ang = pick(local, remote, 'z0ang');

  if (!z1mag || !z1ang || !z0mag || !z0ang) {
    throw new Error('Line impedances are incomplete; cannot build the line model');
  }

  const z1 = C.polar(z1mag.value, z1ang.value);
  const z0 = C.polar(z0mag.value, z0ang.value);

  // Residual compensation: prefer what the relay is actually set to, because
  // that is what it will use. Only derive it when the relay does not carry it.
  const k0mag = pick(local, remote, 'k0mag');
  const k0ang = pick(local, remote, 'k0ang');

  const dZ = C.sub(z0, z1);
  const threeZ1 = C.scale(z1, 3);
  const derivedK0 = C.div(dZ, threeZ1);

  const fromSetting = Boolean(k0mag && k0ang);
  const k0 = fromSetting ? C.polar(k0mag.value, k0ang.value) : derivedK0;
  const k0p1 = C.add(C.ONE, k0);

  /*
   * When the relay carries k0 explicitly, it should agree with what Z0 and Z1
   * imply. A disagreement means the compensation does not match the line data
   * in the same relay, which is a finding worth raising rather than papering
   * over by silently preferring one of them.
   */
  let k0Check = null;
  if (fromSetting) {
    const dMag = C.abs(k0) - C.abs(derivedK0);
    const dAng = C.angleDiff(C.arg(k0), C.arg(derivedK0));
    const relative = C.abs(derivedK0) > 1e-9 ? Math.abs(dMag) / C.abs(derivedK0) : Math.abs(dMag);
    k0Check = {
      set: k0,
      derived: derivedK0,
      deltaMag: dMag,
      deltaAng: dAng,
      relative,
      // 2% and 2 degrees: tighter than rounding in a settings sheet, looser
      // than anything that would shift a test point noticeably.
      agree: relative <= 0.02 && Math.abs(dAng) <= 2
    };
  }

  // Zones: take the local end's, since the test is injected there. Where the
  // ends disagree, compareEnds() has already flagged it.
  const src = (local && local.zones.length ? local : remote) || { zones: [] };
  const overrides = operator.zoneDirections || {};
  const zones = src.zones.map((z) => {
    const reach = z.phase !== null ? z.phase : z.ground;
    const override = overrides[z.n];
    const direction = override || z.direction || 'forward';
    return {
      n: z.n,
      name: z.name,
      reach,
      reachFrom: z.phase !== null ? z.phaseFrom : z.groundFrom,
      ground: z.ground,
      delay: z.delay,
      direction,
      // Where the direction came from, so the UI and the record can say
      // whether it was read, assumed, or set by hand.
      directionSource: override ? 'operator' : (z.directionKnown ? 'setting' : 'assumed'),
      directionFrom: z.directionFrom || null,
      directionRaw: z.directionRaw || null,
      relayDirection: z.direction || 'forward',
      pctOfLine: ((reach || 0) / z1mag.value) * 100
    };
  }).filter((z) => z.reach !== null && z.reach > 0 && z.direction !== 'off');

  const d87src = (local && local.d87 && local.d87.r) ? local.d87 : (remote ? remote.d87 : null);

  /*
   * The differential characteristic as the relay is set, and then as the
   * operator is experimenting with it. The relay's own values are kept
   * alongside so the UI can show what is being departed from and the record
   * can state that a test point was built on an override rather than on the
   * settings file.
   */
  let d87 = d87src && d87src.r ? {
    r: d87src.r.value,
    rFrom: d87src.r.from,
    ang: d87src.ang ? d87src.ang.value : null,
    angFrom: d87src.ang ? d87src.ang.from : null,
    pickup: d87src.pickup ? d87src.pickup.value : null,
    pickupFrom: d87src.pickup ? d87src.pickup.from : null
  } : null;

  const override = operator.d87Override;
  if (d87 && override) {
    const base = { r: d87.r, ang: d87.ang, pickup: d87.pickup };
    const applied = {};
    for (const key of ['r', 'ang', 'pickup']) {
      if (override[key] !== undefined && override[key] !== null && override[key] !== base[key]) {
        applied[key] = override[key];
      }
    }
    if (Object.keys(applied).length) {
      d87 = Object.assign({}, d87, applied, { base, overridden: Object.keys(applied) });
    }
  }

  return {
    z1,
    z0,
    z1mag,
    z1ang,
    z0mag,
    z0ang,
    dZ,
    threeZ1,
    k0,
    k0p1,
    k0Source: fromSetting ? 'setting' : 'derived',
    k0From: fromSetting ? (k0mag.from + ' / ' + k0ang.from) : null,
    k0Derived: derivedK0,
    k0Check,
    zones,
    d87,
    ctr: pick(local, remote, 'ctr'),
    ptr: pick(local, remote, 'ptr'),
    lengthUnits: pick(local, remote, 'lineLength'),
    operator
  };
}

/** Source impedance behind an end, as a complex pair. */
function sourceOf(spec) {
  return {
    z1: C.polar(spec.z1mag, spec.z1ang),
    z0: C.polar(spec.z0mag, spec.z0ang)
  };
}

module.exports = { buildLine, sourceOf, DEFAULT_OPERATOR, FAULT_MODELS };
