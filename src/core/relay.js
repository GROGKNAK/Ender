'use strict';
/*
 * Turns a flat settings map into the structured quantities the calculations
 * need, and records which setting name each value came from.
 *
 * That provenance is not decoration: the calculation record has to be able to
 * say "Z1 came from Z1MAG in ALPHA_LN1.html", and a reviewer has to be able to
 * check that claim. So every resolved field carries the alias that matched.
 *
 * Setting mnemonics differ between relay families, and this is written against
 * published naming rather than a sample file, so each field accepts a list of
 * aliases and anything unrecognised is kept in `unmatched` for the UI to show.
 */

const { toNumber } = require('./parseSettings');

/*
 * Aliases are tried in order; the first present wins. Keep the most specific
 * name first so a generic fallback never shadows an exact match.
 */
const ALIASES = {
  rid: ['RID', 'RELAYID', 'RELAY_ID'],
  // The 311L names the location TID; the 421 uses SID for the station. Either
  // serves as the human label for the end, so fall back to SID.
  tid: ['TID', 'TERMID', 'TERMINAL_ID', 'SID'],
  fid: ['FID', 'PARTNO', 'PART_NO'],

  ctr: ['CTR', 'CTRW', 'CTR1', 'CTRP', 'CTRY'],
  ptr: ['PTR', 'PTRW', 'PTR1', 'VTR', 'PTRY'],
  vnom: ['VNOM', 'VNOMW', 'VNOMY'],

  z1mag: ['Z1MAG', 'Z1MAGN', 'Z1M'],
  z1ang: ['Z1ANG', 'Z1A'],
  z0mag: ['Z0MAG', 'Z0MAGN', 'Z0M'],
  z0ang: ['Z0ANG', 'Z0A'],

  lineLength: ['LL', 'LINELEN', 'LENGTH'],

  // Explicit residual compensation, where the relay is set that way instead of
  // deriving it from Z0 and Z1.
  k0mag: ['K0M1', 'K0MAG', 'K0M'],
  k0ang: ['K0A1', 'K0ANG', 'K0A'],

  d87r: ['87LR', '87LRAD'],
  d87ang: ['87LANG', '87LA'],
  d87pu: ['87LPP', '87LPU', '87L1P', '87LP'],

  // Element enables. A relay can carry a full set of reaches for an element
  // that is switched off, and generating tests for it would be misleading.
  e21p: ['E21P', 'E21PP'],
  e21mg: ['E21MG', 'E21G', 'E21GP'],
  e87l: ['E87L', 'E87']
};

/*
 * SEL enable settings are not booleans: they are 'N'/'Y', or a count of how
 * many zones are enabled, or a scheme name. Anything that is not an explicit
 * negative counts as enabled.
 */
function isEnabled(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return !/^(n|no|off|0|none|disabled)$/i.test(s);
}

/*
 * Each distance zone is supervised by fault detectors: the element will not
 * operate unless enough current is flowing, however good the impedance looks.
 *
 *   50PPn  phase-to-phase current, for phase and three-phase loops
 *   50Ln   positive-sequence current, for every loop
 *   50GZn  residual current (3I0), for ground loops
 *
 * Without these a test point can be inside the reach and still not operate,
 * which is the same trap 87LPP sets for the differential.
 */
const ZONE_ALIASES = [
  { n: 1, phase: ['Z1P', 'Z1PP', 'Z1MP'], ground: ['Z1MG', 'Z1G', 'Z1GP'], delay: ['Z1D', 'Z1PD', 'Z1GD'], dir: ['DIR1'],
    supPhase: ['50PP1', '50PP'], supPos: ['50L1', '50L'], supGround: ['50GZ1', '50G1', '50GZ'] },
  { n: 2, phase: ['Z2P', 'Z2PP', 'Z2MP'], ground: ['Z2MG', 'Z2G', 'Z2GP'], delay: ['Z2D', 'Z2PD', 'Z2GD'], dir: ['DIR2'],
    supPhase: ['50PP2'], supPos: ['50L2'], supGround: ['50GZ2', '50G2'] },
  { n: 3, phase: ['Z3P', 'Z3PP', 'Z3MP'], ground: ['Z3MG', 'Z3G', 'Z3GP'], delay: ['Z3D', 'Z3PD', 'Z3GD'], dir: ['DIR3'],
    supPhase: ['50PP3'], supPos: ['50L3'], supGround: ['50GZ3', '50G3'] },
  { n: 4, phase: ['Z4P', 'Z4PP', 'Z4MP'], ground: ['Z4MG', 'Z4G', 'Z4GP'], delay: ['Z4D', 'Z4PD', 'Z4GD'], dir: ['DIR4'],
    supPhase: ['50PP4'], supPos: ['50L4'], supGround: ['50GZ4', '50G4'] }
];

/*
 * Zone direction. A reverse zone looks behind the relay, so its test points
 * belong on the other side of the origin and are always external to the
 * differential -- placing them forward would be silently wrong.
 *
 * Not every zone carries a direction setting: on the 311L only zones 3 and 4
 * are selectable and 1 and 2 are forward by design. So an absent setting means
 * "forward by default", recorded as an assumption rather than a reading, and
 * the operator can always override it.
 */
function readDirection(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;
  if (/^(R|REV|REVERSE|B|BACK)/.test(s)) return 'reverse';
  if (/^(F|FWD|FORWARD)/.test(s)) return 'forward';
  if (/^(N|OFF|NONE|DISABLED|0)$/.test(s)) return 'off';
  return null;
}

const MODEL_RE = /\bSEL[-\s]?(\d{2,4}[A-Z]?(?:-\d)?[A-Z]?)\b/i;

/*
 * What each field is for, in words, so the UI can say why a setting was read
 * rather than only that it was. A setting with no purpose listed here was
 * read from the file and not used by any calculation.
 */
const PURPOSE = {
  rid: 'Relay identifier', tid: 'Terminal identifier', fid: 'Firmware / part number',
  ctr: 'CT ratio', ptr: 'PT ratio', vnom: 'Nominal secondary voltage',
  z1mag: 'Positive-sequence line impedance', z1ang: 'Positive-sequence line angle',
  z0mag: 'Zero-sequence line impedance', z0ang: 'Zero-sequence line angle',
  lineLength: 'Line length',
  k0mag: 'Residual compensation magnitude', k0ang: 'Residual compensation angle',
  d87r: '87L restraint radius', d87ang: '87L restraint angle', d87pu: '87L pickup',
  e21p: 'Phase distance enable', e21mg: 'Ground distance enable', e87l: 'Differential enable'
};

function resolve(parsed, aliases, used, purpose) {
  for (const name of aliases) {
    if (parsed.has(name)) {
      if (used) used.set(name.toUpperCase(), purpose || 'used');
      return { raw: parsed.get(name), from: name.toUpperCase() };
    }
  }
  return null;
}

function resolveNumber(parsed, aliases, used, purpose) {
  const hit = resolve(parsed, aliases, used, purpose);
  if (!hit) return null;
  const value = toNumber(hit.raw);
  if (value === null) return null;
  return { value, raw: hit.raw, from: hit.from };
}

/**
 * Build a relay model from parsed settings.
 *
 * @param {object} parsed  result of parseSettings()
 * @param {object} [opts]  { fileName, rawText } -- rawText only helps detect
 *                         the model number when no setting carries it.
 */
function buildRelay(parsed, opts = {}) {
  const used = new Map();
  const num = (key) => resolveNumber(parsed, ALIASES[key], used, PURPOSE[key]);
  const str = (key) => resolve(parsed, ALIASES[key], used, PURPOSE[key]);

  const fid = str('fid');
  const ridHit = str('rid');
  const tidHit = str('tid');

  let model = null;
  const modelFrom = [fid && fid.raw, opts.rawText, opts.fileName].filter(Boolean).join(' ');
  const mm = modelFrom.match(MODEL_RE);
  if (mm) model = 'SEL-' + mm[1].toUpperCase();

  const zones = [];
  for (const z of ZONE_ALIASES) {
    const phase = resolveNumber(parsed, z.phase, used, 'Zone ' + z.n + ' phase reach');
    const ground = resolveNumber(parsed, z.ground, used, 'Zone ' + z.n + ' ground reach');
    const delay = resolveNumber(parsed, z.delay, used, 'Zone ' + z.n + ' time delay');
    const dirHit = resolve(parsed, z.dir, used, 'Zone ' + z.n + ' direction');
    const supPhase = resolveNumber(parsed, z.supPhase, used, 'Zone ' + z.n + ' phase current supervision');
    const supPos = resolveNumber(parsed, z.supPos, used, 'Zone ' + z.n + ' positive-sequence supervision');
    const supGround = resolveNumber(parsed, z.supGround, used, 'Zone ' + z.n + ' residual current supervision');
    const direction = dirHit ? readDirection(dirHit.raw) : null;
    if (!phase && !ground) continue;
    zones.push({
      n: z.n,
      name: 'Zone ' + z.n,
      phase: phase ? phase.value : null,
      phaseFrom: phase ? phase.from : null,
      ground: ground ? ground.value : null,
      groundFrom: ground ? ground.from : null,
      delay: delay ? delay.value : null,
      delayFrom: delay ? delay.from : null,
      supervision: {
        phase: supPhase ? supPhase.value : null,
        phaseFrom: supPhase ? supPhase.from : null,
        positive: supPos ? supPos.value : null,
        positiveFrom: supPos ? supPos.from : null,
        ground: supGround ? supGround.value : null,
        groundFrom: supGround ? supGround.from : null
      },
      direction: direction || 'forward',
      directionFrom: direction ? dirHit.from : null,
      directionRaw: dirHit ? dirHit.raw : null,
      // Stated by the relay, or assumed because no setting carries it.
      directionKnown: Boolean(direction)
    });
  }

  const e21p = str('e21p');
  const e21mg = str('e21mg');
  const e87l = str('e87l');
  const enables = {
    distancePhase: e21p ? isEnabled(e21p.raw) : null,
    distancePhaseFrom: e21p ? e21p.from : null,
    distancePhaseRaw: e21p ? e21p.raw : null,
    distanceGround: e21mg ? isEnabled(e21mg.raw) : null,
    distanceGroundFrom: e21mg ? e21mg.from : null,
    distanceGroundRaw: e21mg ? e21mg.raw : null,
    differential: e87l ? isEnabled(e87l.raw) : null,
    differentialFrom: e87l ? e87l.from : null,
    differentialRaw: e87l ? e87l.raw : null
  };

  /*
   * Resolve everything before working out what is left over. Computing
   * `unmatched` earlier would list settings that are about to be consumed,
   * which turns the "not recognised" list -- the one thing that makes a
   * mapping gap visible -- into noise that hides real gaps.
   */
  const fields = {
    ctr: num('ctr'),
    ptr: num('ptr'),
    vnom: num('vnom'),
    z1mag: num('z1mag'),
    z1ang: num('z1ang'),
    z0mag: num('z0mag'),
    z0ang: num('z0ang'),
    lineLength: num('lineLength'),
    k0mag: num('k0mag'),
    k0ang: num('k0ang'),
    d87: {
      r: num('d87r'),
      ang: num('d87ang'),
      pickup: num('d87pu')
    }
  };

  /*
   * Every setting read from the file, classified. "used" means a calculation
   * consumed it; "duplicate" means the same name carries a different value in
   * another settings group that was disregarded; "unused" means it was read
   * and nothing needed it, which for most of a relay's settings is normal.
   */
  const catalogue = parsed.pairs().map((p) => {
    const purpose = used.get(p.name) || null;
    const others = typeof parsed.others === 'function' ? parsed.others(p.name) : [];
    return {
      name: p.name,
      value: p.value,
      from: p.via,
      purpose,
      status: purpose ? 'used' : (others.length ? 'duplicate' : 'unused'),
      others
    };
  });

  const unmatched = catalogue.filter((p) => p.status !== 'used');

  return {
    fileName: opts.fileName || null,
    model,
    rid: ridHit ? ridHit.raw : null,
    ridFrom: ridHit ? ridHit.from : null,
    tid: tidHit ? tidHit.raw : null,
    serial: fid ? fid.raw : null,

    ctr: fields.ctr,
    ptr: fields.ptr,
    vnom: fields.vnom,

    z1mag: fields.z1mag,
    z1ang: fields.z1ang,
    z0mag: fields.z0mag,
    z0ang: fields.z0ang,
    lineLength: fields.lineLength,

    k0mag: fields.k0mag,
    k0ang: fields.k0ang,

    d87: fields.d87,

    zones,
    enables,
    catalogue,
    group: parsed.group || null,
    groups: parsed.groups || [],
    layout: parsed.layout || null,
    kind: parsed.kind || null,
    unmatched,
    settingCount: parsed.count
  };
}

/** Fields the calculation cannot proceed without. */
const REQUIRED = [
  ['z1mag', 'positive-sequence line impedance magnitude'],
  ['z1ang', 'positive-sequence line impedance angle'],
  ['z0mag', 'zero-sequence line impedance magnitude'],
  ['z0ang', 'zero-sequence line impedance angle']
];

/**
 * What is missing or inconsistent. Returned rather than thrown so the UI can
 * show every problem at once instead of one per attempt.
 */
function validateRelay(relay) {
  const problems = [];
  for (const [key, what] of REQUIRED) {
    if (!relay[key]) problems.push({ level: 'error', field: key, message: 'No ' + what + ' found (tried ' + ALIASES[key].join(', ') + ')' });
  }
  if (!relay.zones.length) {
    problems.push({ level: 'error', field: 'zones', message: 'No distance zone reaches found' });
  }
  if (!relay.d87.r || !relay.d87.ang) {
    problems.push({ level: 'warn', field: 'd87', message: 'No 87L alpha plane settings found; differential tests will be skipped' });
  }
  if (!relay.ctr || !relay.ptr) {
    problems.push({ level: 'warn', field: 'ratios', message: 'CT or PT ratio missing; primary values cannot be shown' });
  }

  // A relay can carry a complete set of reaches for an element that is
  // switched off. Generating tests for it would look authoritative and be
  // wrong, so say so rather than quietly producing them.
  const e = relay.enables || {};
  if (e.distancePhase === false && e.distanceGround === false) {
    problems.push({
      level: 'warn',
      field: 'enables',
      message: 'Distance elements are disabled in this relay (' +
        (e.distancePhaseFrom || 'E21P') + ' = ' + e.distancePhaseRaw + ', ' +
        (e.distanceGroundFrom || 'E21MG') + ' = ' + e.distanceGroundRaw +
        '). Zone reaches are still present, but these tests describe elements that will not operate.'
    });
  }
  if (e.differential === false) {
    problems.push({
      level: 'warn',
      field: 'enables',
      message: 'The differential element is disabled (' +
        (e.differentialFrom || 'E87L') + ' = ' + e.differentialRaw + ').'
    });
  }
  if (relay.groups && relay.groups.length > 1) {
    problems.push({
      level: 'info',
      field: 'group',
      message: 'This file holds ' + relay.groups.length + ' settings groups (' +
        relay.groups.slice(0, 8).join(', ') + (relay.groups.length > 8 ? '…' : '') +
        '). Values were read from group ' + relay.group + '.'
    });
  }
  return problems;
}

/** Settings both ends must agree on for the pair to be a valid line. */
const MUST_MATCH = [
  ['z1mag', 'Z1 magnitude'], ['z1ang', 'Z1 angle'],
  ['z0mag', 'Z0 magnitude'], ['z0ang', 'Z0 angle']
];

/**
 * Cross-check the two ends. A mismatch here is a genuine finding -- the two
 * relays disagree about the line they are both protecting -- so it is surfaced
 * rather than silently resolved in favour of one end.
 */
function compareEnds(local, remote) {
  const rows = [];
  for (const [key, label] of MUST_MATCH) {
    const a = local[key] ? local[key].value : null;
    const b = remote[key] ? remote[key].value : null;
    rows.push({
      key,
      label,
      setting: (local[key] && local[key].from) || (remote[key] && remote[key].from) || key.toUpperCase(),
      local: a,
      remote: b,
      status: a === null || b === null ? 'missing' : (Math.abs(a - b) < 1e-9 ? 'match' : 'differ')
    });
  }
  for (const key of ['r', 'ang', 'pickup']) {
    const a = local.d87[key] ? local.d87[key].value : null;
    const b = remote.d87[key] ? remote.d87[key].value : null;
    if (a === null && b === null) continue;
    rows.push({
      key: '87L.' + key,
      label: { r: '87L restraint radius', ang: '87L restraint angle', pickup: '87L pickup' }[key],
      setting: (local.d87[key] && local.d87[key].from) || (remote.d87[key] && remote.d87[key].from) || '',
      local: a,
      remote: b,
      status: a === null || b === null ? 'missing' : (Math.abs(a - b) < 1e-9 ? 'match' : 'differ')
    });
  }
  const zoneCount = Math.max(local.zones.length, remote.zones.length);
  for (let i = 0; i < zoneCount; i += 1) {
    const a = local.zones[i];
    const b = remote.zones[i];
    const av = a ? a.phase : null;
    const bv = b ? b.phase : null;
    rows.push({
      key: 'zone' + (i + 1),
      label: 'Zone ' + (i + 1) + ' reach',
      setting: (a && a.phaseFrom) || (b && b.phaseFrom) || '',
      local: av,
      remote: bv,
      status: av === null || bv === null ? 'missing' : (Math.abs(av - bv) < 1e-9 ? 'match' : 'differ')
    });
  }
  return rows;
}

module.exports = { buildRelay, validateRelay, compareEnds, ALIASES, ZONE_ALIASES };
