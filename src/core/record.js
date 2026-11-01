'use strict';
/*
 * The calculation record: the derivation behind every number in the report.
 *
 * This is built from the same line model and plan the report renders, and it
 * recomputes nothing. If it had its own copy of the arithmetic the record
 * could quietly disagree with the result it claims to explain, which would be
 * worse than having no record at all.
 *
 * Structure is deliberately presentation-free -- a block is a symbol and a
 * list of right-hand sides -- so the screen and the PDF render the same
 * derivation and cannot drift apart.
 */

const C = require('./complex');
const { byKey } = require('./faults');
const alpha = require('./alpha');

/* ----------------------------------------------------------- formatting -- */

const n = (v, dp = 3) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(dp));
const deg = (v) => (v >= 0 ? '' : '−') + Math.abs(v).toFixed(2) + '°';
const polar = (z, unit = '', dp = 3) => n(C.abs(z), dp) + (unit ? ' ' + unit : '') + ' ∠ ' + deg(C.arg(z));
const rect = (z, unit = '', dp = 3) =>
  n(z.re, dp) + (unit ? ' ' + unit : '') + (z.im < 0 ? ' − j' : ' + j') + n(Math.abs(z.im), dp);

const OHM = 'Ω';

function block(symbol, rows, note) {
  return { symbol, rows, note: note || null };
}

/* --------------------------------------------------------------- inputs -- */

function buildInputs(line, local, remote) {
  const op = line.operator;
  const both = (field) => {
    const a = local && local[field] ? local[field].value : null;
    const b = remote && remote[field] ? remote[field].value : null;
    if (a === null || b === null) return 'one file only';
    return Math.abs(a - b) < 1e-9 ? 'both files agree' : 'FILES DISAGREE';
  };

  const rows = [];
  let i = 0;
  const push = (symbol, setting, value, origin) => {
    i += 1;
    rows.push({ ref: 'I-' + String(i).padStart(2, '0'), symbol, setting, value, origin });
  };

  push('Z₁', (line.z1mag.from || '') + ' ∠ ' + (line.z1ang.from || ''), polar(line.z1, OHM), both('z1mag'));
  push('Z₀', (line.z0mag.from || '') + ' ∠ ' + (line.z0ang.from || ''), polar(line.z0, OHM), both('z0mag'));
  for (const z of line.zones) {
    push('Zₚ(' + z.name + ')', z.reachFrom || '—', n(z.reach) + ' ' + OHM, 'both files agree');
  }
  if (line.d87) {
    push('R₇', line.d87.rFrom || '87LR', n(line.d87.r), 'both files agree');
    push('θ₇', line.d87.angFrom || '87LANG', n(line.d87.ang, 2) + '°', 'both files agree');
    if (line.d87.pickup !== null) {
      push('I₇ₚᵤ', line.d87.pickupFrom || '87LPP', n(line.d87.pickup) + ' A', 'both files agree');
    }
  }
  push('Iₜ', '—', n(op.testCurrent) + ' A sec', 'operator');
  push('kᵢ', '—', n(op.infeed), 'operator');
  push('Vₙ', '—', n(op.vnom, 2) + ' V L–N', 'operator');

  const index = {};
  for (const r of rows) index[r.symbol] = r.ref;
  return { rows, index };
}

const refOf = (inputs, symbol) => inputs.index[symbol] || '';

/* ----------------------------------------------------- derived constants -- */

function buildDerived(line, inputs) {
  const out = [];
  const r1 = refOf(inputs, 'Z₁');
  const r0 = refOf(inputs, 'Z₀');

  if (line.k0Source === 'setting') {
    out.push(block('k₀', [
      ['read directly from ' + line.k0From],
      [polar(line.k0, '', 4)]
    ], 'The relay carries an explicit residual compensation setting, so that is used rather than deriving one from Z₀ and Z₁. What the relay is set to is what it will apply.'));
  } else {
    out.push(block('k₀', [
      ['(Z₀ − Z₁) / (3 · Z₁)   [' + r0 + '] [' + r1 + ']'],
      ['(' + polar(line.z0, OHM) + ' − ' + polar(line.z1, OHM) + ') / (3 · ' + polar(line.z1, OHM) + ')'],
      ['(' + rect(line.z0) + ' − (' + rect(line.z1) + ')) / ' + polar(line.threeZ1, OHM)],
      ['(' + rect(line.dZ) + ') / ' + polar(line.threeZ1, OHM)],
      [polar(line.dZ, OHM) + ' / ' + polar(line.threeZ1, OHM)],
      [polar(line.k0, '', 4)]
    ], 'Subtraction is done in rectangular form and division in polar, which is why both appear. k₀ is dimensionless — the ohms cancel.'));
  }

  out.push(block('1 + k₀', [
    ['1 + ' + polar(line.k0, '', 4)],
    ['1 + (' + rect(line.k0, '', 4) + ')'],
    [rect(line.k0p1, '', 4)],
    [polar(line.k0p1, '', 4)]
  ], 'Every phase-to-ground loop impedance is multiplied by this. A ground fault at a given distance presents ' + n(C.abs(line.k0p1)) + '× the impedance a phase fault does at the same distance, which is what the relay’s residual compensation removes.'));

  return out;
}

/* ------------------------------------------------------ per-test working -- */

function testBlocks(row, line, inputs) {
  const t = byKey(row.type);
  /*
   * A locked row was computed under its own settings, so every statement made
   * about it -- which model produced it, which checks apply -- has to use
   * those, not the ones in force now. Reading it against the current operator
   * would describe the row as something it is not.
   */
  const op = (row.locked && row.lockedOperator)
    ? Object.assign({}, line.operator, row.lockedOperator)
    : line.operator;
  const out = [];
  const p = row.pctOfReach / 100;

  /*
   * A locked row was computed earlier and is no longer affected by the current
   * settings. Section A describes the settings in force now, so a locked row
   * has to declare the ones it was actually built on or the record would
   * misrepresent it.
   */
  if (row.locked) {
    const was = row.lockedOperator || {};
    // Compared against the settings in force now -- line.operator, not `op`,
    // which is deliberately the locked row's own.
    const now = line.operator;
    const diffs = [];
    const compare = [
      ['fault model', 'faultModel', (v) => String(v)],
      ['test current', 'testCurrent', (v) => n(v) + ' A'],
      ['nominal voltage', 'vnom', (v) => n(v, 2) + ' V'],
      ['in-zone point', 'inZonePct', (v) => v + '%'],
      ['out-of-zone point', 'outZonePct', (v) => v + '%'],
      ['remote infeed', 'infeed', (v) => n(v, 3)]
    ];
    for (const [label, key, fmt] of compare) {
      if (was[key] === undefined || now[key] === undefined) continue;
      if (String(was[key]) !== String(now[key])) {
        diffs.push(label + ': ' + fmt(was[key]) + ' (now ' + fmt(now[key]) + ')');
      }
    }
    out.push(block('LOCKED', [
      ['frozen ' + (row.lockedAt ? String(row.lockedAt).slice(0, 16).replace('T', ' ') : '')],
      ...(diffs.length ? diffs.map((d) => [d]) : [['settings unchanged since it was locked']])
    ], diffs.length
      ? 'This test point is locked. It was computed under the settings listed above, which differ from those in Section A. The quantities below are the frozen ones and were not recalculated.'
      : 'This test point is locked, so it is no longer recalculated. The settings it was built on still match Section A.'));
  }

  const dirNote = {
    setting: 'read from ' + (row.directionFrom || 'the settings file'),
    operator: 'set by hand, overriding the settings file',
    assumed: 'assumed forward — no direction setting was found for this zone'
  }[row.directionSource] || 'assumed forward';

  out.push(block('Zf', [
    ['Zₚ(' + row.zone + ') · p   [' + refOf(inputs, 'Zₚ(' + row.zone + ')') + ']'],
    [n(row.reach) + ' ' + OHM + ' · ' + n(p, 3)],
    [polar(row.zLoop, OHM) + (row.reverse ? '   (reverse: 180° from the line angle)' : '')]
  ], 'Placement of the fault, as a share of this zone’s reach. The zone is ' +
     row.direction + ', ' + dirNote + '.' +
     (row.unphysical
       ? ' The reverse reach is deeper than the source impedance behind this terminal, so there is ' +
         'no physical fault point for it with the source data given — treat these quantities as ' +
         'a characteristic check only.'
       : '')));

  out.push(block('d', [
    ['|Zf| / |Z₁|   [' + refOf(inputs, 'Z₁') + ']'],
    [n(C.abs(row.zLoop)) + ' ' + OHM + ' / ' + n(C.abs(line.z1)) + ' ' + OHM],
    [n(row.linePct, 1) + ' % of the protected line']
  ], row.reverse
    ? 'This zone looks behind the relay, so the fault sits on the far side of the origin at ' +
      n(row.linePct, 1) + ' % of the line impedance behind the terminal. It is outside the two ' +
      'current transformers either way, so the differential must ' + row.expect87 + '.'
    : 'd ' + (row.onLine ? '≤' : '>') + ' 100 %, so the fault is ' +
      (row.onLine ? 'between the two current transformers' : 'beyond the far bus') +
      ' and the differential must ' + row.expect87 + ' whatever the distance zones do.'));

  if (t.base === 'ground') {
    out.push(block('Zₗₒₒₚ', [
      ['Zf · (1 + k₀)'],
      [polar(row.zLoop, OHM) + ' · ' + polar(line.k0p1, '', 4)],
      [polar(C.mul(row.zLoop, line.k0p1), OHM)]
    ], 'A ground loop includes the residual compensation term; a phase loop does not.'));
  } else if (t.base === 'phase') {
    out.push(block('Zₗₒₒₚ', [
      ['2 · Zf   (phase loop, no residual term)'],
      ['2 · ' + polar(row.zLoop, OHM)],
      [polar(C.scale(row.zLoop, 2), OHM)]
    ], 'The loop runs out one phase and back the other, so it sees twice the impedance to the fault.'));
  } else {
    out.push(block('Zₗₒₒₚ', [
      ['Zf   (balanced, no residual term)'],
      [polar(row.zLoop, OHM)]
    ], 'A balanced fault has no zero-sequence current, so no compensation applies.'));
  }

  const phases = ['A', 'B', 'C'];
  const endRows = (end) => phases.map((ph, k) => [
    'V' + ph + ' = ' + n(C.abs(end.v[k]), 2) + ' V ∠ ' + deg(C.arg(end.v[k])) +
    '    I' + ph + ' = ' + n(C.abs(end.i[k]), 3) + ' A ∠ ' + deg(C.arg(end.i[k]))
  ]);

  out.push(block('local', endRows(row.local),
    op.faultModel === 'constantCurrent'
      ? 'Current is held at Iₜ [' + refOf(inputs, 'Iₜ') + '] and voltage follows the loop impedance. Voltage is referenced to the faulted phase at 0°.'
      : op.faultModel === 'constantVoltage'
        ? 'Voltage is held at Vₙ [' + refOf(inputs, 'Vₙ') + '] and current follows.'
        : 'From a two-source fault calculation in symmetrical components; each end sees the drop across its own source impedance.'));

  out.push(block('remote', endRows(row.remote),
    row.onLine
      ? 'Remote infeed is kᵢ [' + refOf(inputs, 'kᵢ') + '] of the local current while the fault is on the line.'
      : 'Past the far bus both ends carry the same current in series, so the remote current reverses through its CT — the 180° difference is the signature the differential restrains on.'));

  // Independent check: work the quantities back to an impedance.
  //
  // The ground loop must use the residual-compensated form, not V/(I(1+k0)).
  // Those two agree only when the residual current equals the faulted-phase
  // current, which is true on a test set but not in a real two-source fault,
  // where the zero- and positive-sequence currents divide differently between
  // the ends and the local relay does see current in the healthy phases.
  let back;
  let label;
  let extra = null;
  let expected = row.zLoop;
  let k0Error = null;

  if (t.base === 'ground') {
    const k = t.r;
    const residual = C.add(C.add(row.local.i[0], row.local.i[1]), row.local.i[2]);
    back = C.div(row.local.v[k], C.add(row.local.i[k], C.mul(line.k0, residual)));
    label = 'V / (I + k₀ · Iᵣₑₛ)';
    extra = ['Iᵣₑₛ = Iₐ + Iᵦ + Iᶜ = ' + polar(residual, 'A')];

    /*
     * The fault is made by the real line impedances; the relay measures it
     * with whatever k0 it is set to. When the setting does not match the line
     * data, the apparent impedance genuinely shifts, and the expected value
     * has to account for that or the self check reports real physics as an
     * arithmetic error.
     */
    const mismatch = line.k0Check && !line.k0Check.agree0;
    if (op.faultModel === 'sourceImpedance' && line.k0Derived && mismatch !== undefined) {
      const trueTerm = C.add(row.local.i[k], C.mul(line.k0Derived, residual));
      const setTerm = C.add(row.local.i[k], C.mul(line.k0, residual));
      if (C.abs(setTerm) > 1e-12) {
        expected = C.mul(row.zLoop, C.div(trueTerm, setTerm));
        const err = (C.abs(expected) - C.abs(row.zLoop)) / C.abs(row.zLoop);
        if (Math.abs(err) > 1e-9) k0Error = err;
      }
    }
  } else if (t.base === 'phase') {
    const a = (t.r + 1) % 3;
    const b = (t.r + 2) % 3;
    back = C.div(C.sub(row.local.v[a], row.local.v[b]), C.sub(row.local.i[a], row.local.i[b]));
    label = 'ΔV / ΔI across the faulted pair';
  } else {
    back = C.div(row.local.v[0], row.local.i[0]);
    label = 'V / I';
  }
  const residual = Math.abs(C.abs(back) - C.abs(expected));

  const rows = [
    [label],
    ...(extra ? extra.map((e) => [e]) : []),
    [polar(back, OHM)]
  ];
  if (k0Error !== null) {
    rows.push(['expected ' + polar(expected, OHM) + '   (placement ' + polar(row.zLoop, OHM) + ')']);
  }
  rows.push(['error = ' + residual.toExponential(1) + ' ' + OHM]);

  out.push(block('Zᴄʜᴇᴄᴋ', rows,
    k0Error === null
      ? 'The derived quantities are worked back to an impedance using the loop the relay actually measures. It reproduces the placement value above, so the voltages and currents in this block are consistent with the fault they claim to represent. A reviewer can repeat this line with a calculator.'
      : 'The relay measures this loop with its own k₀ setting, which does not match the value its Z₀ and Z₁ imply. The fault sits at the placement impedance, but the relay sees ' +
        (k0Error >= 0 ? '+' : '−') + Math.abs(k0Error * 100).toFixed(2) +
        '% more than that — an apparent reach error caused by the setting, not by this calculation. The error line below is the residual against that expected value.'));

  if (k0Error !== null) {
    out.push(block('reach error', [
      ['(|Zᴀᴘᴘᴀʀᴇɴᴛ| − |Zᶠ|) / |Zᶠ|'],
      [(k0Error >= 0 ? '+' : '−') + Math.abs(k0Error * 100).toFixed(3) + ' %']
    ], 'Caused by k₀ = ' + polar(line.k0, '', 4) + ' (from the relay) against ' +
       polar(line.k0Derived, '', 4) + ' (from Z₀ and Z₁). Small here, but it is a real shift ' +
       'in where every ground element actually reaches, and it is worth a reviewer’s attention.'));
  }

  return { blocks: out, residual };
}

/* --------------------------------------------------------- alpha section -- */

function alphaSection(line, inputs) {
  if (!line.d87) return null;
  const reg = alpha.region(line.d87.r, line.d87.ang);
  return {
    block: block('region', [
      ['(1 / R₇) ≤ |Iᵣ / Iₗ| ≤ R₇   [' + refOf(inputs, 'R₇') + ']'],
      [n(reg.inner, 4) + ' ≤ |Iᵣ / Iₗ| ≤ ' + n(reg.outer)],
      ['and  |∠(Iᵣ / Iₗ) − 180°| ≤ θ₇ / 2   [' + refOf(inputs, 'θ₇') + ']'],
      ['and  |∠(Iᵣ / Iₗ) − 180°| ≤ ' + n(line.d87.ang / 2, 2) + '°'],
      ['∴ arc ' + n(reg.from, 2) + '° → ' + n(reg.to, 2) + '°, containing the through-current point −1']
    ], 'Both inequalities must hold for the element to restrain. The angular test is taken on the wrapped difference from 180°, because the region straddles 0°/360° and a direct comparison gets the boundary backwards.'),
    region: reg
  };
}

/* ---------------------------------------------------------- assumptions -- */

function assumptions(line) {
  const op = line.operator;
  const list = [
    'Lumped line impedance. Distributed shunt capacitance and line charging current are not modelled, so 87L charging-current compensation is not represented.',
    'No zero-sequence mutual coupling from a parallel circuit. Where one exists, ground reach is affected and these points will not match a real fault.',
    'Fault resistance taken as zero, so the resistive reach of any quadrilateral element is not exercised.',
    'CT and VT treated as ideal: no ratio error, no saturation, no transient response.',
    'Pre-fault load current is not superimposed.',
    'Steady-state phasors only. No element timing, memory polarisation or transient behaviour is calculated — this record covers pickup quantities, not operate times.'
  ];
  if (op.faultModel === 'sourceImpedance') {
    list.push('Source impedances behind each terminal are operator-supplied and have not been reconciled against a short-circuit study.');
    list.push('Both sources are taken as having the same voltage magnitude and angle, so no pre-fault power transfer is represented.');
  } else {
    list.push('The ' + (op.faultModel === 'constantCurrent' ? 'constant-current' : 'constant-voltage') +
      ' model holds one quantity fixed and lets the other follow, which can demand a value no real source would produce. Affected points are flagged.');
    list.push('Remote-end quantities use a fixed infeed ratio rather than a fault calculation, so they indicate the pattern rather than the exact magnitudes.');
  }
  return list;
}

/* ------------------------------------------------------------------ api -- */

/**
 * @param {object} args { line, plan, local, remote, meta }
 */
function buildRecord(args) {
  const { line, plan, local, remote, meta } = args;
  const inputs = buildInputs(line, local, remote);
  const derived = buildDerived(line, inputs);

  const tests = plan.distance.map((row) => {
    const d = testBlocks(row, line, inputs);
    return {
      id: row.id,
      n: row.n,
      title: row.id + ' · ' + row.zone + ' ' + row.typeLabel + ' ' + row.point,
      subtitle: row.kind + ' fault at ' + row.pctOfReach + '% of the ' + row.zone + ' reach.',
      blocks: d.blocks,
      residual: d.residual,
      expect21: row.expect21,
      expect87: row.expect87,
      pctOfReach: row.pctOfReach,
      linePct: row.linePct,
      onLine: row.onLine,
      voltageWarning: row.voltageWarning,
      locked: Boolean(row.locked),
      lockedAt: row.lockedAt || null
    };
  });

  const lockedTests = tests.filter((t) => t.locked).length;

  const worstResidual = tests.reduce((m, t) => Math.max(m, t.residual), 0);

  return {
    meta: Object.assign({
      generatedAt: new Date().toISOString(),
      model: line.operator.faultModel,
      testCount: plan.counts.total
    }, meta || {}),
    inputs,
    derived,
    tests,
    alpha: alphaSection(line, inputs),
    differential: plan.differential,
    assumptions: assumptions(line).concat(lockedTests
      ? ['' + lockedTests + ' of ' + tests.length + ' test points are locked: they were computed ' +
         'earlier and are not affected by the settings in Section A. Each one states the settings ' +
         'it was built on.']
      : []),
    lockedTests,
    selfCheck: {
      worstResidual,
      // A residual far above floating-point noise means the derivation and the
      // reported numbers have come apart, which is a defect, not a tolerance.
      ok: worstResidual < 1e-6
    }
  };
}

module.exports = { buildRecord, n, deg, polar, rect, OHM };
