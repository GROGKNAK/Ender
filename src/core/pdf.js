'use strict';
/*
 * PDF output: the test report, and the calculation record.
 *
 * pdf-lib's standard fonts are WinAnsi-encoded, so the Unicode the UI uses --
 * angle signs, ohms, subscripts, arrows -- cannot be drawn directly and throws
 * rather than rendering a blank. Everything is therefore transliterated to an
 * ASCII convention that protection engineers already read ("8.32 ohm @ 84.50
 * deg"), and anything unmapped is caught by a final sweep so a stray character
 * can never abort an export mid-document.
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const C = require('./complex');

/* --------------------------------------------------------- transliteration */

const MAP = {
  '∠': '@', 'Ω': 'ohm', '−': '-', '≤': '<=', '≥': '>=',
  '×': 'x', '→': '->', '←': '<-', '∴': 'therefore',
  '–': '-', '—': '--', '‘': "'", '’': "'",
  '“': '"', '”': '"', '…': '...', '✓': 'OK', '✗': 'X',
  '⚠': '!', 'Δ': 'delta', 'θ': 'theta', 'μ': 'u',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  'ₚ': 'p', 'ₗ': 'l', 'ₒ': 'o', 'ᵢ': 'i', 'ₙ': 'n',
  'ₜ': 't', 'ᵣ': 'r', 'ₑ': 'e', 'ₘ': 'm', 'ᵤ': 'u',
  'ᴄ': 'C', 'ʜ': 'H', 'ᴇ': 'E', 'ᴋ': 'K', 'ᶠ': 'f'
};

function ascii(input) {
  let s = String(input === null || input === undefined ? '' : input);
  for (const [from, to] of Object.entries(MAP)) s = s.split(from).join(to);
  // Anything still outside WinAnsi would throw at draw time; drop it rather
  // than fail the whole export.
  return s.replace(/[^\x09\x0a\x0d\x20-\xff]/g, '');
}

/* ----------------------------------------------------------------- layout */

const A4 = [595.28, 841.89];
const MARGIN = 44;
const INK = rgb(0.09, 0.10, 0.12);
const MUTED = rgb(0.42, 0.45, 0.50);
const RULE = rgb(0.80, 0.82, 0.85);
const GOOD = rgb(0.13, 0.52, 0.22);
const BAD = rgb(0.72, 0.16, 0.13);
const WARN = rgb(0.62, 0.45, 0.07);

class Doc {
  constructor(pdf, fonts, title) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.title = title;
    this.pages = [];
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - MARGIN;
    return this.page;
  }

  room(h) {
    if (this.y - h < MARGIN + 26) this.newPage();
  }

  text(s, opts = {}) {
    const size = opts.size || 9;
    const font = opts.font || this.fonts.body;
    const colour = opts.colour || INK;
    const indent = opts.indent || 0;
    const maxWidth = (opts.width || (A4[0] - MARGIN * 2)) - indent;
    const words = ascii(s).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    for (const ln of lines) {
      this.room(size + 3);
      this.page.drawText(ln, { x: MARGIN + indent, y: this.y - size, size, font, color: colour });
      this.y -= size + 3;
    }
    if (opts.gap !== false) this.y -= 2;
  }

  heading(s, level = 1) {
    const size = level === 1 ? 14 : 10.5;
    this.room(size + 14);
    this.y -= level === 1 ? 10 : 7;
    this.page.drawText(ascii(s), {
      x: MARGIN, y: this.y - size, size, font: this.fonts.bold, color: INK
    });
    this.y -= size + 4;
    if (level === 1) {
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: A4[0] - MARGIN, y: this.y },
        thickness: 0.7, color: RULE
      });
      this.y -= 7;
    }
  }

  /* Fixed-width columns. `widths` are points; negative means right-aligned. */
  table(headers, rows, widths, opts = {}) {
    const size = opts.size || 7.6;
    const lh = size + 5;
    const draw = (cells, font, colour) => {
      this.room(lh);
      let x = MARGIN;
      cells.forEach((cell, i) => {
        const w = Math.abs(widths[i]);
        const text = ascii(cell === null || cell === undefined ? '' : cell);
        const clipped = this.clip(text, font, size, w - 4);
        const tw = font.widthOfTextAtSize(clipped, size);
        const cx = widths[i] < 0 ? x + w - 4 - tw : x;
        const tint = (opts.colourOf && opts.colourOf(cells, i)) || colour;
        this.page.drawText(clipped, { x: cx, y: this.y - size, size, font, color: tint });
        x += w;
      });
      this.y -= lh;
    };

    draw(headers, this.fonts.bold, MUTED);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 3 },
      end: { x: A4[0] - MARGIN, y: this.y + 3 },
      thickness: 0.6, color: RULE
    });
    this.y -= 2;
    for (const r of rows) draw(r, opts.mono ? this.fonts.mono : this.fonts.body, INK);
    this.y -= 4;
  }

  clip(text, font, size, max) {
    if (font.widthOfTextAtSize(text, size) <= max) return text;
    let s = text;
    while (s.length > 1 && font.widthOfTextAtSize(s + '..', size) > max) s = s.slice(0, -1);
    return s + '..';
  }

  /* A derivation: symbol on the left, each right-hand side on its own line. */
  mathBlock(symbol, rows, note) {
    const size = 8;
    const lh = size + 4;
    this.room(lh * (rows.length + 1) + 8);
    const lw = Math.max(46, this.fonts.mono.widthOfTextAtSize(ascii(symbol), size) + 8);
    rows.forEach((r, i) => {
      this.room(lh);
      if (i === 0) {
        this.page.drawText(ascii(symbol), {
          x: MARGIN + 6, y: this.y - size, size, font: this.fonts.mono, color: rgb(0.13, 0.36, 0.68)
        });
      }
      this.page.drawText('=', {
        x: MARGIN + 6 + lw, y: this.y - size, size, font: this.fonts.mono, color: MUTED
      });
      const body = this.clip(ascii(r[0] !== undefined ? r[0] : r),
        this.fonts.mono, size, A4[0] - MARGIN * 2 - lw - 24);
      this.page.drawText(body, {
        x: MARGIN + 6 + lw + 12, y: this.y - size, size, font: this.fonts.mono, color: INK
      });
      this.y -= lh;
    });
    this.y -= 2;
    if (note) this.text(note, { size: 7.6, colour: MUTED, indent: 6 });
    this.y -= 4;
  }

  rule() {
    this.room(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y }, end: { x: A4[0] - MARGIN, y: this.y },
      thickness: 0.6, color: RULE
    });
    this.y -= 8;
  }

  finish(subtitle) {
    this.pages.forEach((p, i) => {
      p.drawText(ascii(this.title + (subtitle ? '  |  ' + subtitle : '')), {
        x: MARGIN, y: 24, size: 7, font: this.fonts.body, color: MUTED
      });
      const label = 'Page ' + (i + 1) + ' of ' + this.pages.length;
      const w = this.fonts.body.widthOfTextAtSize(label, 7);
      p.drawText(label, { x: A4[0] - MARGIN - w, y: 24, size: 7, font: this.fonts.body, color: MUTED });
    });
  }
}

async function open(title) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(ascii(title));
  pdf.setProducer('Ender');
  pdf.setCreator('Ender');
  const fonts = {
    body: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier)
  };
  return new Doc(pdf, fonts, title);
}

/* ------------------------------------------------------------ test report */

const ph = (z, dp = 2) => C.abs(z).toFixed(dp) + ' @ ' + C.arg(z).toFixed(1) + ' deg';

async function testReportPdf(args) {
  const { plan, line, names, org, signoff, reportTitle } = args;
  const local = (names && names.local) || 'Local';
  const remote = (names && names.remote) || 'Remote';
  const title = ((org && org.titlePrefix) || 'Line Protection Test Record');
  const subject = reportTitle || (local + ' - ' + remote);
  const d = await open(title + ' - ' + subject);

  d.heading(title);
  d.text(subject, { size: 11, font: d.fonts.bold });
  d.text([
    (org && org.utility) || '',
    (org && org.division) || '',
    'Generated ' + new Date(plan.generatedAt).toISOString().slice(0, 16).replace('T', ' ')
  ].filter(Boolean).join('   |   '), { size: 8, colour: MUTED });

  d.heading('Basis', 2);
  d.table(['Quantity', 'Value'], [
    ['Positive-sequence Z1', ph(line.z1) + ' ohm'],
    ['Zero-sequence Z0', ph(line.z0) + ' ohm'],
    ['k0 (' + line.k0Source + ')', C.abs(line.k0).toFixed(4) + ' @ ' + C.arg(line.k0).toFixed(2) + ' deg'],
    ['Fault model', line.operator.faultModel],
    ['Test current', line.operator.testCurrent.toFixed(3) + ' A secondary'],
    ['In / out of zone', line.operator.inZonePct + '% / ' + line.operator.outZonePct + '%']
  ], [170, 340]);

  // Omitted points are left out silently and by design: the report is the
  // record of what was tested, not of what was considered and dropped.
  if (plan.lockedCount) {
    d.text('L marks a locked test point: it was computed earlier and is not affected by the ' +
      'settings above. The calculation record states the settings each one was built on.',
      { size: 8, colour: MUTED });
  }

  if (plan.counts.voltageWarnings) {
    d.text('! ' + plan.counts.voltageWarnings + ' test point(s) require more than ' +
      line.operator.warnVolts + ' V on the faulted phase. The bench model does not bound voltage; ' +
      'reduce the test current or use the source impedance model.',
      { size: 8, colour: WARN });
  }

  d.heading('Test matrix', 2);
  d.table(
    ['', '#', 'Zone', 'Fault', '%R', 'Z loop', '%line', '87L', '21 exp', '87L exp', local, remote],
    plan.distance.map((r) => [
      r.locked ? 'L' : '',
      r.id, r.zone, r.typeLabel, r.pctOfReach + '%',
      C.abs(r.zLoop).toFixed(2), r.linePct.toFixed(0) + '%',
      r.onLine ? 'int' : 'ext', r.expect21, r.expect87,
      (signoff && signoff['L' + (r.n - 1)]) || '-',
      (signoff && signoff['R' + (r.n - 1)]) || '-'
    ]),
    [14, 34, 44, 36, 30, 44, 36, 28, 56, 56, -62, -62],
    {
      colourOf: (cells, i) => {
        if (i === 0) return rgb(0.13, 0.36, 0.68);
        if (i === 8 || i === 9) return cells[i] === 'OPERATE' ? GOOD : MUTED;
        if (i === 10 || i === 11) return cells[i] === 'FAIL' || cells[i] === 'RETEST' ? BAD : INK;
        return null;
      }
    }
  );

  d.heading('Injected quantities', 2);
  for (const r of plan.distance) {
    d.room(74);
    d.text(r.id + '  ' + r.zone + '  ' + r.typeLabel + '  ' + r.point +
      '   (Z loop ' + ph(r.zLoop, 3) + ' ohm, ' + r.linePct.toFixed(1) + '% of line)',
      { size: 8.4, font: d.fonts.bold });
    const rows = ['A', 'B', 'C'].map((p, k) => [
      p,
      C.abs(r.local.v[k]).toFixed(2), C.arg(r.local.v[k]).toFixed(1),
      C.abs(r.local.i[k]).toFixed(3), C.arg(r.local.i[k]).toFixed(1),
      C.abs(r.remote.v[k]).toFixed(2), C.arg(r.remote.v[k]).toFixed(1),
      C.abs(r.remote.i[k]).toFixed(3), C.arg(r.remote.i[k]).toFixed(1)
    ]);
    d.table(
      ['Ph', local + ' V', 'deg', local + ' I', 'deg', remote + ' V', 'deg', remote + ' I', 'deg'],
      rows, [26, -62, -46, -62, -46, -62, -46, -62, -46], { mono: true }
    );
    if (r.voltageWarning) {
      d.text('! needs ' + r.voltageWarning.toFixed(1) + ' V on the faulted phase',
        { size: 7.4, colour: WARN, indent: 26 });
    }
  }

  if (plan.differential.length) {
    d.heading('87L alpha plane checks', 2);
    d.table(
      ['#', 'Ph', 'Check', 'IL', 'IR @ deg', 'Ratio', '@ deg', 'dev', 'Expected'],
      plan.differential.map((x) => [
        x.id, x.phase, x.label,
        x.local.magnitude.toFixed(2),
        x.remote.magnitude.toFixed(2) + ' @ ' + x.remote.angle.toFixed(0),
        x.ratio.magnitude.toFixed(3), x.ratio.angle.toFixed(1),
        x.result.deviation.toFixed(1), x.result.expect
      ]),
      [34, 24, 150, -40, -80, -46, -46, -40, -56],
      { colourOf: (cells, i) => (i === 8 ? (cells[8] === 'OPERATE' ? GOOD : MUTED) : null) }
    );
  }

  d.finish(subject);
  return d.pdf.save();
}

/* ------------------------------------------------------ calculation record */

async function recordPdf(args) {
  const { record, line, names, org, provenance, reportTitle } = args;
  const local = (names && names.local) || 'Local';
  const remote = (names && names.remote) || 'Remote';
  const subject = reportTitle || (local + ' - ' + remote);
  const d = await open('Calculation record - ' + subject);

  d.heading('Findings and calculation record');
  d.text(subject, { size: 11, font: d.fonts.bold });
  d.text('Every result traced from the settings file to the number, so a reviewer can check it ' +
    'without re-deriving it. Values are secondary ohms, volts and amperes unless stated.',
    { size: 8, colour: MUTED });

  d.heading('Provenance', 2);
  d.table(['Source', 'File', 'SHA-256', 'Relay', 'Serial'],
    (provenance || []).map((p) => [p.end, p.fileName || '-', p.hash || '-', p.model || '-', p.serial || '-']),
    [54, 150, 120, 80, -100], { mono: true });
  d.table(['Setting', 'Value'], [
    ['Fault model', record.meta.model],
    ['Software', 'Ender ' + (record.meta.appVersion || '')],
    ['Generated', new Date(record.meta.generatedAt).toISOString().slice(0, 16).replace('T', ' ')],
    ['Utility', (org && org.utility) || '-']
  ], [170, 340]);

  d.heading('A - Inputs', 2);
  d.text('Every quantity the calculation starts from. Later sections cite these tags, so no number ' +
    'appears without a stated origin. Entries marked "operator" are not in the relay: they are ' +
    'choices, and a reviewer is entitled to disagree with them.', { size: 8, colour: MUTED });
  d.table(['Ref', 'Symbol', 'Setting', 'Value', 'Origin'],
    record.inputs.rows.map((r) => [r.ref, r.symbol, r.setting, r.value, r.origin]),
    [44, 80, 120, -130, 130],
    { colourOf: (cells, i) => (i === 4 && cells[4] === 'FILES DISAGREE' ? BAD : (i === 4 && cells[4] === 'operator' ? WARN : null)) });

  d.heading('B - Derived constants', 2);
  for (const b of record.derived) d.mathBlock(b.symbol, b.rows, b.note);

  d.heading('C - Test point derivations', 2);
  for (const t of record.tests) {
    d.room(90);
    d.text(t.title, { size: 9.4, font: d.fonts.bold });
    d.text(t.subtitle, { size: 7.8, colour: MUTED });
    for (const b of t.blocks) d.mathBlock(b.symbol, b.rows, b.note);
    d.text('Expected: Zone ' + t.expect21 + '   |   87L ' + t.expect87, { size: 8, font: d.fonts.bold });
    if (t.voltageWarning) {
      d.text('! This point needs ' + t.voltageWarning.toFixed(1) + ' V on the faulted phase.',
        { size: 7.6, colour: WARN });
    }
    d.rule();
  }

  if (record.alpha) {
    d.heading('D - Alpha plane evaluation', 2);
    d.mathBlock(record.alpha.block.symbol, record.alpha.block.rows, record.alpha.block.note);
    d.table(['#', 'Ph', 'Check', 'Ratio', '@ deg', 'Magnitude test', 'Angle test', 'Result'],
      record.differential.map((x) => [
        x.id, x.phase, x.label, x.ratio.magnitude.toFixed(3), x.ratio.angle.toFixed(1),
        x.result.inner.toFixed(3) + ' <= ' + x.result.magnitude.toFixed(3) + ' <= ' + x.result.outer.toFixed(2) +
          (x.result.magOk ? ' OK' : ' X'),
        x.result.deviation.toFixed(1) + ' <= ' + x.result.halfSpan.toFixed(1) + (x.result.angOk ? ' OK' : ' X'),
        x.result.expect
      ]),
      [30, 22, 132, -42, -40, -132, -92, -60],
      { colourOf: (cells, i) => (i === 7 ? (cells[7] === 'OPERATE' ? GOOD : MUTED) : null) });
  }

  d.heading('E - Assumptions and exclusions', 2);
  d.text('What this record does not account for. A reviewer needs this as much as the arithmetic: ' +
    'a number is only as good as what was left out of it.', { size: 8, colour: MUTED });
  for (const a of record.assumptions) d.text('-  ' + a, { size: 8, indent: 6 });

  d.heading('F - Self check', 2);
  d.text('Each test point above was worked backwards from its derived voltages and currents to an ' +
    'impedance and compared against the placement value. Largest residual across all ' +
    record.tests.length + ' points: ' + record.selfCheck.worstResidual.toExponential(2) + ' ohm.' +
    (record.selfCheck.ok ? ' This is floating-point noise, as expected.'
      : ' THIS IS LARGER THAN EXPECTED AND SHOULD BE INVESTIGATED.'),
    { size: 8, colour: record.selfCheck.ok ? INK : BAD });

  d.heading('G - Reviewer sign-off', 2);
  d.y -= 16;
  const half = (A4[0] - MARGIN * 2 - 20) / 2;
  for (const [i, label] of ['Prepared by / date', 'Checked by / date'].entries()) {
    const x = MARGIN + i * (half + 20);
    d.page.drawLine({ start: { x, y: d.y }, end: { x: x + half, y: d.y }, thickness: 0.6, color: RULE });
    d.page.drawText(label, { x, y: d.y - 11, size: 7.4, font: d.fonts.body, color: MUTED });
  }
  d.y -= 48;
  d.page.drawLine({
    start: { x: MARGIN, y: d.y }, end: { x: A4[0] - MARGIN, y: d.y }, thickness: 0.6, color: RULE
  });
  d.page.drawText('Reviewer comments / items disputed', {
    x: MARGIN, y: d.y - 11, size: 7.4, font: d.fonts.body, color: MUTED
  });

  d.finish(subject);
  return d.pdf.save();
}

module.exports = { testReportPdf, recordPdf, ascii };
