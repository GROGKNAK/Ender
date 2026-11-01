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
const Plot = require('./plot');

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

/*
 * The plot palette for paper. The screen's is dark; these are the same roles
 * resolved for white, which is why core/plot.js names roles instead of
 * colours. Point colours match the verdict colours used in the tables above
 * them, so a green dot and a green OPERATE are saying the same thing.
 */
const PLOT_INK = {
  grid: rgb(0.90, 0.91, 0.93),
  axis: rgb(0.62, 0.65, 0.70),
  line100: rgb(0.25, 0.27, 0.30),
  anchor: rgb(0.45, 0.48, 0.53),
  region: rgb(0.52, 0.55, 0.60),
  live: WARN,
  good: GOOD,
  bad: BAD,
  mixed: WARN,
  zone0: rgb(0.16, 0.38, 0.72),
  zone1: rgb(0.45, 0.28, 0.72),
  zone2: rgb(0.40, 0.43, 0.48),
  zone3: rgb(0.10, 0.50, 0.55)
};

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

  /*
   * Paint a plot laid out by core/plot.js.
   *
   * The geometry arrives in SVG's convention -- y growing downward from the
   * top-left -- and PDF counts up from the bottom of the page, so every y is
   * mirrored about the plot's top edge. Nothing here decides where anything
   * goes; that is the shared module's job, and the point of the split is that
   * this and the screen cannot disagree about the picture.
   */
  plot(spec, opts = {}) {
    const caption = opts.caption;
    this.room(spec.height + (caption ? 26 : 10));
    const x0 = MARGIN + (opts.indent || 0);
    const top = this.y;
    const X = (x) => x0 + x;
    const Y = (y) => top - y;

    for (const it of spec.items) {
      const colour = PLOT_INK[it.role] || MUTED;
      if (it.t === 'line') {
        this.page.drawLine({
          start: { x: X(it.x1), y: Y(it.y1) },
          end: { x: X(it.x2), y: Y(it.y2) },
          thickness: it.w,
          color: colour,
          opacity: it.fade ? 0.55 : 1,
          dashArray: it.dash || undefined
        });
      } else if (it.t === 'circle') {
        this.page.drawCircle({
          x: X(it.cx), y: Y(it.cy), size: it.r,
          borderColor: colour, borderWidth: it.w,
          borderDashArray: it.dash || undefined,
          borderOpacity: it.opacity === undefined ? 1 : it.opacity
        });
      } else if (it.t === 'dot') {
        this.page.drawCircle({
          x: X(it.cx), y: Y(it.cy), size: it.r, color: colour,
          borderColor: it.w ? rgb(1, 1, 1) : undefined,
          borderWidth: it.w || 0
        });
      } else if (it.t === 'path') {
        // drawSvgPath reads the same top-left space the geometry is in and
        // anchors it at (x, y), so it is handed the plot's top-left corner.
        this.page.drawSvgPath(
          'M ' + it.pts.map((q) => q[0] + ' ' + q[1]).join(' L ') + (it.closed ? ' Z' : ''),
          {
            x: x0, y: top,
            color: it.role === 'region' ? rgb(0.94, 0.95, 0.96) : undefined,
            borderColor: colour, borderWidth: it.w
          }
        );
      } else if (it.t === 'text') {
        this.page.drawText(ascii(it.s), {
          x: X(it.x), y: Y(it.y), size: it.size, font: this.fonts.body, color: colour
        });
      }
    }

    this.y -= spec.height + 4;
    if (caption) this.text(caption, { size: 7.4, colour: MUTED, indent: opts.indent || 0 });
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

/* Sign-offs keyed by test identity, with a fallback for reports saved when
 * they were keyed by row position. */
function signOf(signoff, end, row) {
  if (!signoff) return '-';
  const byKey = signoff[end + '|' + row.lockKey];
  if (byKey !== undefined && byKey !== '') return byKey;
  const legacy = signoff[end + (row.n - 1)];
  return legacy === undefined || legacy === '' ? '-' : legacy;
}

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

  /*
   * No voltage warnings here, by the same rule that keeps the omitted points
   * out: this document records what was tested, not what the bench had to be
   * talked into. The warning stays on screen, where it can still change what
   * you do, and in the calculation record, which exists to show the working.
   * It is in neither export.
   */

  d.heading('Test matrix', 2);
  d.table(
    ['', '#', 'Zone', 'Fault', '%R', 'Z loop', '%line', '87L', '21 exp', '87L exp', local, remote],
    plan.distance.map((r) => [
      r.locked ? 'L' : '',
      r.id, r.zone, r.typeLabel, r.pctOfReach + '%',
      C.abs(r.zLoop).toFixed(2), r.linePct.toFixed(0) + '%',
      r.onLine ? 'int' : 'ext', r.expect21, r.expect87,
      signOf(signoff, 'L', r),
      signOf(signoff, 'R', r)
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

  /*
   * The matrix as a picture. It is built from the same rows the table above
   * was, so whatever is not in the report is not on the plot either -- no
   * filtering here, and nothing to keep in step with the table.
   *
   * Zone captions are left off and folded into the line beneath instead:
   * on a mho characteristic the short zones crowd together near the origin,
   * which is the one place the test identifiers have to stay readable.
   */
  if (plan.distance.length) {
    d.plot(
      Plot.rx(
        { zones: line.zones, z1mag: C.abs(line.z1), z1ang: C.arg(line.z1) },
        {
          width: 330, height: 340, chrome: false,
          points: Plot.distancePoints(plan.distance.map((r) => ({
            id: r.id, zMag: C.abs(r.zLoop), reverse: r.reverse, expect21: r.expect21
          })))
        }
      ),
      {
        caption: 'Test points on the R-X plane, local end, secondary ohms. Green is an ' +
          'expected OPERATE, red an expected RESTRAIN, amber a spot holding both. Dashed ' +
          'radial: the line at 100%. Circles, innermost out: ' +
          line.zones.map((z) => z.name + ' ' + z.reach.toFixed(2) + ' ohm' +
            (z.direction === 'reverse' ? ' reverse, drawn below the origin' : '')).join(', ') + '.'
      }
    );
  }

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
  }

  if (plan.differential.length) {
    d.heading('87L alpha plane checks', 2);
    d.table(
      ['#', 'Ph', 'Check', 'IL', 'IR @ deg', 'Ratio', 'Id', 'vs PU', 'Expected', local, remote],
      plan.differential.map((x) => [
        x.id, x.phase, x.label,
        x.local.magnitude.toFixed(2),
        x.remote.magnitude.toFixed(2) + ' @ ' + x.remote.angle.toFixed(0),
        x.ratio.magnitude.toFixed(3) + ' @ ' + x.ratio.angle.toFixed(0),
        x.result.current === null ? '-' : x.result.current.toFixed(2),
        x.result.pickupOk === null ? '-' : (x.result.pickupOk ? 'over' : 'under'),
        x.result.expect + (x.result.heldBy === 'pickup' ? ' (pu)' : ''),
        signOf(signoff, 'L', x),
        signOf(signoff, 'R', x)
      ]),
      [26, 16, 96, -30, -62, -62, -32, -38, -58, -46, -46],
      {
        colourOf: (cells, i) => {
          if (i === 7) return cells[7] === 'under' ? WARN : (cells[7] === 'over' ? GOOD : MUTED);
          if (i === 8) return cells[8].indexOf('OPERATE') === 0 ? GOOD : MUTED;
          if (i === 9 || i === 10) return cells[i] === 'FAIL' || cells[i] === 'RETEST' ? BAD : INK;
          return null;
        }
      }
    );
    d.text('Id is the differential current, the vector sum of the two end currents. The element ' +
      'needs it above 87LPP as well as a ratio outside the restraint region; "(pu)" marks a point ' +
      'held by the threshold rather than by the region.', { size: 7.6, colour: MUTED });

    // Same rows as the table, so the omitted checks are absent here too.
    if (line.d87) {
      d.plot(
        Plot.alpha(
          { r: line.d87.r, ang: line.d87.ang },
          { width: 300, height: 300, chrome: false, points: Plot.differentialPoints(plan.differential) }
        ),
        {
          caption: 'The checks on the alpha plane, the ratio of remote to local current. Inside ' +
            'the outlined region the element restrains; the grey dot at -1 is balanced through ' +
            'load. Region from ' + (line.d87.rFrom || '87LR') + ' = ' + line.d87.r.toFixed(2) +
            ' and ' + (line.d87.angFrom || '87LANG') + ' = ' + line.d87.ang.toFixed(1) + ' deg. ' +
            'Checks sharing a ratio share a dot: an amber one holds both an expected OPERATE and ' +
            'an expected RESTRAIN, which the plane alone cannot separate because they differ only ' +
            'in current. Labels are the phase A rows; the B and C check of each name carries the ' +
            'same ratio and sits on the same dot.'
        }
      );
    }
  }

  d.finish(subject);
  return d.pdf.save();
}

/* ------------------------------------------------------ calculation record */

async function recordPdf(args) {
  // The record carries its own worked-through quantities, so the line model
  // itself is not needed here even though callers pass it.
  const { record, names, org, provenance, reportTitle } = args;
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
    d.table(['#', 'Ph', 'Check', 'Ratio', 'Magnitude test', 'Angle test', 'Current test', 'Result'],
      record.differential.map((x) => [
        x.id, x.phase, x.label,
        x.ratio.magnitude.toFixed(3) + ' @ ' + x.ratio.angle.toFixed(0),
        x.result.inner.toFixed(3) + ' <= ' + x.result.magnitude.toFixed(3) + ' <= ' + x.result.outer.toFixed(2) +
          (x.result.magOk ? ' OK' : ' X'),
        x.result.deviation.toFixed(1) + ' <= ' + x.result.halfSpan.toFixed(1) + (x.result.angOk ? ' OK' : ' X'),
        x.result.pickupOk === null ? 'no 87LPP'
          : x.result.current.toFixed(2) + (x.result.pickupOk ? ' > ' : ' <= ') +
            x.result.pickup.toFixed(2) + (x.result.pickupOk ? ' OK' : ' X'),
        x.result.expect + (x.result.heldBy === 'pickup' ? ' (pu)' : '')
      ]),
      [26, 18, 104, -56, -104, -70, -72, -58],
      {
        colourOf: (cells, i) => {
          if (i === 6) return /X$/.test(cells[6]) ? WARN : (/OK$/.test(cells[6]) ? GOOD : MUTED);
          if (i === 7) return cells[7].indexOf('OPERATE') === 0 ? GOOD : MUTED;
          return null;
        }
      });
    d.text('The element operates only when the ratio falls outside the restraint region AND the ' +
      'differential current exceeds 87LPP. Both pickup rows carry the same ratio, so the current ' +
      'test is the only thing that separates them.', { size: 7.6, colour: MUTED });
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
