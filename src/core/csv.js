'use strict';
/*
 * CSV export.
 *
 * One row per test point with both ends side by side, because that is the
 * shape a test set wants and the shape a technician reads. Magnitude and angle
 * are separate columns rather than a single "49.45 ∠ 0.0" string so the file
 * is usable as data without re-parsing it.
 */

const C = require('./complex');

const PH = ['A', 'B', 'C'];

/*
 * Sign-offs are keyed by the test's own identity, not its position, so that
 * turning a fault type off cannot shuffle an engineer's answers onto
 * different tests. The numeric fallback reads reports saved before that.
 */
function signOf(signoff, end, row) {
  if (!signoff) return '';
  const byKey = signoff[end + '|' + row.lockKey];
  if (byKey !== undefined) return byKey;
  const legacy = signoff[end + (row.n - 1)];
  return legacy === undefined ? '' : legacy;
}

function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const line = (cells) => cells.map(esc).join(',');

function endColumns(prefix) {
  const out = [];
  for (const p of PH) out.push(prefix + ' V' + p + ' (V)', prefix + ' V' + p + ' (deg)');
  for (const p of PH) out.push(prefix + ' I' + p + ' (A)', prefix + ' I' + p + ' (deg)');
  return out;
}

function endValues(end) {
  const out = [];
  for (let k = 0; k < 3; k += 1) out.push(C.abs(end.v[k]).toFixed(2), C.arg(end.v[k]).toFixed(1));
  for (let k = 0; k < 3; k += 1) out.push(C.abs(end.i[k]).toFixed(3), C.arg(end.i[k]).toFixed(1));
  return out;
}

/**
 * @param {object} args { plan, line, names:{local,remote}, signoff }
 */
function testPlanCsv(args) {
  const { plan, line: model, names, signoff } = args;
  const local = (names && names.local) || 'Local';
  const remote = (names && names.remote) || 'Remote';
  const rows = [];

  rows.push(line([
    'Test', 'Zone', 'Fault', 'Type', '% of reach', 'Z loop (ohm)', 'Z loop (deg)',
    '% of line', '87L view', '21 expected', '87L expected',
    ...endColumns(local), ...endColumns(remote),
    local + ' sign-off', remote + ' sign-off'
  ]));

  for (const r of plan.distance) {
    rows.push(line([
      r.id, r.zone, r.typeLabel, r.kind, r.pctOfReach,
      C.abs(r.zLoop).toFixed(3), C.arg(r.zLoop).toFixed(2),
      r.linePct.toFixed(1), r.onLine ? 'internal' : 'external',
      r.expect21, r.expect87,
      ...endValues(r.local), ...endValues(r.remote),
      signOf(signoff, 'L', r), signOf(signoff, 'R', r)
    ]));
  }

  if (plan.differential.length) {
    rows.push('');
    rows.push(line(['87L alpha plane checks']));
    rows.push(line([
      'Test', 'Phase', 'Check', 'IL (A)', 'IL (deg)', 'IR (A)', 'IR (deg)',
      'Ratio', 'Ratio (deg)', 'Deviation from 180 (deg)',
      'Id (A)', '87LPP (A)', 'Expected',
      local + ' sign-off', remote + ' sign-off'
    ]));
    for (const d of plan.differential) {
      rows.push(line([
        d.id, d.phase, d.label,
        d.local.magnitude.toFixed(3), d.local.angle.toFixed(1),
        d.remote.magnitude.toFixed(3), d.remote.angle.toFixed(1),
        d.ratio.magnitude.toFixed(4), d.ratio.angle.toFixed(2),
        d.result.deviation.toFixed(2),
        d.result.current === null ? '' : d.result.current.toFixed(3),
        d.result.pickup === null ? '' : d.result.pickup.toFixed(3),
        d.result.expect + (d.result.heldBy === 'pickup' ? ' (held by pickup)' : ''),
        signOf(signoff, 'L', d), signOf(signoff, 'R', d)
      ]));
    }
  }

  rows.push('');
  /*
   * The CSV states what was omitted; the PDF report and the calculation
   * record do not. That split is deliberate: this file is the working copy
   * for the test set and for whoever ran the tests, where knowing a point was
   * dropped matters. The PDF is the deliverable, and it carries only what was
   * actually tested.
   */
  if (plan.omittedCount) {
    rows.push(line(['Omitted from this report', plan.omittedCount,
      (plan.omitted || []).map((o) => o.id + ' ' + o.zone + ' ' + o.type + ' ' + o.point).join('; ')]));
  }
  rows.push(line(['Fault model', model.operator.faultModel]));
  rows.push(line(['Test current (A sec)', model.operator.testCurrent]));
  rows.push(line(['Nominal voltage (V L-N)', model.operator.vnom]));
  rows.push(line(['Generated', plan.generatedAt]));

  // Excel reads a BOM-less UTF-8 CSV as the local code page; the BOM avoids
  // mangling the degree and ohm signs for anyone who opens it there.
  return '﻿' + rows.join('\r\n') + '\r\n';
}

module.exports = { testPlanCsv };
