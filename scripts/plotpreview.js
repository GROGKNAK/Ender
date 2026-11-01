'use strict';
/*
 * Draw the report's plots to an HTML page, in the paper palette.
 *
 * Chromium's PDF viewer will not paint in a window this harness can drive,
 * so the drawing is checked here instead: the geometry is the same module
 * the exporter uses, and pdf-lib's own path convention is pinned by a test.
 * What this shows is whether the picture reads on white -- spacing, crowding,
 * contrast -- which is the part no assertion covers.
 *
 *   node scripts/plotpreview.js [out.html]
 */
const fs = require('fs');
const path = require('path');

const { parseSettings } = require('../src/core/parseSettings');
const { buildRelay } = require('../src/core/relay');
const { buildLine } = require('../src/core/line');
const { buildPlan, applyOmissions } = require('../src/core/testplan');
const Plot = require('../src/core/plot');
const C = require('../src/core/complex');

// The same palette pdf.js resolves its roles from, as CSS colours.
const INK = {
  grid: '#e6e8ed', axis: '#9ea6b3', line100: '#404448', anchor: '#737a85',
  region: '#858c99', live: '#9e7312', good: '#218535', bad: '#b82921',
  mixed: '#9e7312', zone0: '#2961b8', zone1: '#7347b8', zone2: '#666d7a', zone3: '#1a808c'
};

function svg(spec) {
  const out = [];
  for (const it of spec.items) {
    const c = INK[it.role] || '#666';
    const dash = it.dash ? ' stroke-dasharray="' + it.dash.join(' ') + '"' : '';
    if (it.t === 'line') {
      out.push('<line x1="' + it.x1 + '" y1="' + it.y1 + '" x2="' + it.x2 + '" y2="' + it.y2 +
        '" stroke="' + c + '" stroke-width="' + it.w + '"' + dash +
        (it.fade ? ' opacity="0.55"' : '') + '/>');
    } else if (it.t === 'circle') {
      out.push('<circle cx="' + it.cx + '" cy="' + it.cy + '" r="' + it.r + '" fill="none" stroke="' +
        c + '" stroke-width="' + it.w + '"' + dash + '/>');
    } else if (it.t === 'dot') {
      out.push('<circle cx="' + it.cx + '" cy="' + it.cy + '" r="' + it.r + '" fill="' + c +
        (it.w ? '" stroke="#fff" stroke-width="' + it.w : '') + '"/>');
    } else if (it.t === 'path') {
      out.push('<path d="M ' + it.pts.map((p) => p[0] + ' ' + p[1]).join(' L ') +
        (it.closed ? ' Z' : '') + '" fill="' + (it.role === 'region' ? '#f0f2f4' : 'none') +
        '" stroke="' + c + '" stroke-width="' + it.w + '"/>');
    } else if (it.t === 'text') {
      out.push('<text x="' + it.x + '" y="' + it.y + '" fill="' + c + '" font-size="' + it.size +
        '" font-family="Helvetica, Arial, sans-serif">' + it.s + '</text>');
    }
  }
  return '<svg width="' + spec.width + '" height="' + spec.height + '">' + out.join('') + '</svg>';
}

const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'test', 'plot.test.js'), 'utf8')
  .match(/const SAMPLE = `([\s\S]*?)`;/)[1];

const a = buildRelay(parseSettings(SAMPLE), { fileName: 'A.html', rawText: SAMPLE });
const b = buildRelay(parseSettings(SAMPLE), { fileName: 'B.html', rawText: SAMPLE });
const line = buildLine(a, b, { faultModel: 'constantCurrent' });
let plan = buildPlan(line);

// Drop a couple of points, so the preview also shows that they leave the plot.
const omit = {};
omit[plan.distance[4].lockKey] = true;
omit[plan.distance[5].lockKey] = true;
const victim = plan.differential[2];
for (const x of plan.differential) if (x.label === victim.label) omit[x.lockKey] = true;
plan = applyOmissions(plan, omit);

const rxSpec = Plot.rx(
  { zones: line.zones, z1mag: C.abs(line.z1), z1ang: C.arg(line.z1) },
  {
    width: 330, height: 340, chrome: false,
    points: Plot.distancePoints(plan.distance.map((r) => ({
      id: r.id, zMag: C.abs(r.zLoop), reverse: r.reverse, expect21: r.expect21
    })))
  }
);
const apSpec = Plot.alpha(
  { r: line.d87.r, ang: line.d87.ang },
  { width: 300, height: 300, chrome: false, points: Plot.differentialPoints(plan.differential) }
);

const out = process.argv[2] || path.join(__dirname, '..', 'tmp', 'plot-preview.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '<!doctype html><meta charset="utf-8"><title>Report plots</title>' +
  '<style>body{background:#fff;color:#16181c;font:13px Helvetica,Arial,sans-serif;margin:24px}' +
  'h2{font-size:14px;margin:18px 0 6px}p{color:#5c636e;font-size:10px;max-width:520px;margin:6px 0 0}' +
  'div{display:inline-block;vertical-align:top;margin-right:28px}</style>' +
  '<div><h2>Test points on the R-X plane</h2>' + svg(rxSpec) +
  '<p>Omitted ' + plan.omittedCount + ' point(s); they must not appear above.</p></div>' +
  '<div><h2>87L checks on the alpha plane</h2>' + svg(apSpec) +
  '<p>Omitted the check "' + victim.label + '" on every phase.</p></div>');
console.log(out);
console.log('plotted', plan.distance.length, 'distance,', plan.differential.length, 'differential');
