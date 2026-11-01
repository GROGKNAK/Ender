'use strict';
/*
 * Plot geometry, with no idea what it is being drawn on.
 *
 * Both the screen and the exported report have to show the same picture. If
 * each one worked out its own layout they would drift the first time either
 * was touched, and a plot in a signed test record that disagrees with the
 * plot the engineer approved on screen is worse than no plot at all. So the
 * arithmetic lives here exactly once and produces a list of primitives; the
 * renderer paints them as SVG, the PDF exporter paints them with pdf-lib.
 *
 * Coordinates are in points from the top-left corner, the way SVG counts.
 * The PDF painter flips them, because PDF counts up from the bottom.
 *
 * Colours are named roles rather than values: the screen is dark and the page
 * is white, so each painter resolves them from its own palette.
 *
 * This file is loaded two ways -- required by the main process and pulled in
 * by a <script> tag in the renderer -- so it must stay free of anything that
 * only exists in one of them. Pure arithmetic only: no node, no DOM.
 */

const RAD = Math.PI / 180;

/*
 * Several test points can land on exactly the same spot -- a three-phase and
 * a phase-to-phase point at the same percentage of the same reach, for one.
 * Drawing a label per row would stack them into a smear, so coincident points
 * merge and their identifiers are joined. The key is the caller's business:
 * it decides what "the same spot" means for the quantity being plotted.
 */
function groupPoints(items) {
  const order = [];
  const seen = new Map();
  for (const it of items) {
    const prev = seen.get(it.key);
    if (prev) {
      // Distinct identifiers only: the same test can reach here more than
      // once (one row per phase, say) and "D01, D01, D01" labels nothing.
      if (prev.labels.indexOf(it.label) < 0) prev.labels.push(it.label);
      // A dot holding both an operate and a restrain point cannot honestly be
      // either colour, so it is marked as mixed rather than picking one.
      if (prev.role !== it.role) prev.role = 'mixed';
    } else {
      const next = Object.assign({}, it, { labels: [it.label] });
      seen.set(it.key, next);
      order.push(next);
    }
  }
  return order.map((g) => Object.assign(g, { label: g.labels.join(', ') }));
}

/*
 * Labels go on after the dots, nudged apart vertically where they would
 * otherwise land on top of each other. One that had to move gets a hairline
 * back to its dot: on a plot whose whole job is matching a dot to a table
 * row, a label sitting next to the wrong dot is worse than no label.
 */
function placeLabels(items, marks, size) {
  const gap = size + 1.5;
  let lastY = -Infinity;
  for (const m of marks.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
    const want = m.y + size / 2 - 1;
    const y = Math.max(want, lastY + gap);
    lastY = y;
    if (y - want > 3) {
      items.push({
        t: 'line', x1: m.x + 4, y1: m.y + 1, x2: m.x + 7, y2: y - 3,
        role: m.role, w: 0.7, fade: true
      });
    }
    items.push({ t: 'text', x: m.x + 8, y, s: m.label, size, role: m.role });
  }
}

function arcPoints(P, radius, from, to, steps) {
  const pts = [];
  for (let k = 0; k <= steps; k += 1) pts.push(P(radius, from + (to - from) * (k / steps)));
  return pts;
}

/* ------------------------------------------------------------- R-X plane --- */

/**
 * @param {object} model  { zones:[{name,reach,direction}], z1mag, z1ang }
 * @param {object} opts   { width, height, inPct, outPct, points, chrome }
 *   points: [{ mag, reverse, role, label, key }]
 *   inPct/outPct: the plain per-zone markers; null to leave them off
 *   chrome: false drops the zone and line captions, for a plot whose only
 *           text should be the test identifiers
 * @returns {object} { width, height, items }
 */
function rx(model, opts) {
  const o = Object.assign(
    { width: 392, height: 440, inPct: null, outPct: null, points: null, chrome: true },
    opts || {}
  );
  const items = [];
  const zones = model.zones || [];
  if (!zones.length) return { width: o.width, height: o.height, items };

  const zang = model.z1ang;

  /*
   * A reverse zone sits below the origin, so the frame has to make room on
   * both sides of it. With only forward zones this is the same picture it
   * always was; with a reverse zone the origin moves up to fit it in.
   */
  const fwd = zones.filter((z) => z.direction !== 'reverse').map((z) => z.reach);
  const rev = zones.filter((z) => z.direction === 'reverse').map((z) => z.reach);
  const forwardMax = Math.max(model.z1mag, ...(fwd.length ? fwd : [0]));
  const reverseMax = rev.length ? Math.max(...rev) : 0;

  const top = forwardMax * 1.25;
  const bottom = Math.max(reverseMax * 1.3, forwardMax * 0.18);
  const half = Math.max(forwardMax, reverseMax) * 1.15;
  const S = Math.min((o.width - 12) / (half * 2), (o.height - 10) / (top + bottom));
  const cx = o.width / 2;
  const cy = 6 + top * S;
  const px = (r) => cx + r * S;
  const py = (x) => cy - x * S;
  const span = half;

  // Trim the frame to what is actually drawn, so a line with only short
  // forward zones does not leave half the panel empty.
  const height = Math.ceil((top + bottom) * S) + 14;

  for (let g = -span; g <= span; g += Math.max(2, Math.round(span / 5))) {
    items.push({ t: 'line', x1: px(g), y1: py(top), x2: px(g), y2: py(-bottom), role: 'grid', w: 1 });
    items.push({ t: 'line', x1: px(-span), y1: py(g), x2: px(span), y2: py(g), role: 'grid', w: 1 });
  }
  items.push({ t: 'line', x1: px(-span), y1: py(0), x2: px(span), y2: py(0), role: 'axis', w: 1.4 });
  items.push({ t: 'line', x1: px(0), y1: py(top), x2: px(0), y2: py(-bottom), role: 'axis', w: 1.4 });

  for (let i = zones.length - 1; i >= 0; i -= 1) {
    const z = zones[i];
    const sign = z.direction === 'reverse' ? -1 : 1;
    const rad = z.reach / 2;
    const zx = sign * rad * Math.cos(zang * RAD);
    const zy = sign * rad * Math.sin(zang * RAD);
    items.push({
      t: 'circle', cx: px(zx), cy: py(zy), r: rad * S,
      role: 'zone' + (i % 4), w: 1.6, opacity: 0.85,
      dash: sign < 0 ? [5, 3] : null
    });
    /*
     * On a points plot the only text is the test identifiers. Naming the
     * zones and the line as well put four more captions into the same
     * crowded patch near the origin, and the plain plot beside it has them.
     */
    if (o.chrome) {
      items.push({
        t: 'text', x: px(zx - rad) + 6, y: py(zy) + (sign < 0 ? 13 : -5),
        s: z.name + (sign < 0 ? ' (rev)' : ''), size: 10.5, role: 'zone' + (i % 4)
      });
    }
  }

  const lx = model.z1mag * Math.cos(zang * RAD);
  const ly = model.z1mag * Math.sin(zang * RAD);
  items.push({
    t: 'line', x1: px(0), y1: py(0), x2: px(lx), y2: py(ly),
    role: 'line100', w: 1.8, dash: [4, 3]
  });
  if (o.chrome) {
    items.push({ t: 'text', x: px(lx) + 8, y: py(ly), s: 'Line 100%', size: 10.5, role: 'line100' });
  }

  if (o.inPct !== null) {
    for (const z of zones) {
      const sign = z.direction === 'reverse' ? -1 : 1;
      for (const [pct, role] of [[o.inPct, 'good'], [o.outPct, 'bad']]) {
        const r = sign * z.reach * pct / 100;
        items.push({
          t: 'dot', cx: px(r * Math.cos(zang * RAD)), cy: py(r * Math.sin(zang * RAD)),
          r: 4.5, role, w: 1.5
        });
      }
    }
  }

  /*
   * The points from the test table, each carrying the identifier the report
   * uses. A reverse point is mirrored through the origin, which is where the
   * relay actually sees it.
   */
  if (o.points && o.points.length) {
    const marks = o.points.map((pt) => {
      const r = (pt.reverse ? -1 : 1) * pt.mag;
      return {
        x: px(r * Math.cos(zang * RAD)), y: py(r * Math.sin(zang * RAD)),
        role: pt.role, label: pt.label
      };
    });
    for (const m of marks) items.push({ t: 'dot', cx: m.x, cy: m.y, r: 4.5, role: m.role, w: 1.5 });
    placeLabels(items, marks, 9.5);
  }

  return { width: o.width, height, items };
}

/* ----------------------------------------------------------- alpha plane --- */

/**
 * @param {object} model  { r, ang }  the restraint region
 * @param {object} opts   { width, height, points, live, chrome }
 *   points: [{ magnitude, angle, role, label, key }]
 * @returns {object} { width, height, items }
 */
function alpha(model, opts) {
  const o = Object.assign(
    { width: 420, height: 420, points: null, live: null, chrome: true }, opts || {}
  );
  const items = [];
  const r = model.r;
  const ang = model.ang;

  const dom = Math.max(7, r * 1.2);
  const S = (Math.min(o.width, o.height) / 2 - 14) / dom;
  const cx = o.width / 2;
  const cy = o.height / 2;
  const P = (mag, a) => [cx + mag * Math.cos(a * RAD) * S, cy - mag * Math.sin(a * RAD) * S];

  const step = Math.max(1, Math.round(dom / 4));
  for (let k = -dom; k <= dom; k += step) {
    items.push({ t: 'line', x1: cx + k * S, y1: cy - dom * S, x2: cx + k * S, y2: cy + dom * S, role: 'grid', w: 1 });
    items.push({ t: 'line', x1: cx - dom * S, y1: cy - k * S, x2: cx + dom * S, y2: cy - k * S, role: 'grid', w: 1 });
  }
  items.push({ t: 'line', x1: cx - dom * S, y1: cy, x2: cx + dom * S, y2: cy, role: 'axis', w: 1.4 });
  items.push({ t: 'line', x1: cx, y1: cy - dom * S, x2: cx, y2: cy + dom * S, role: 'axis', w: 1.4 });

  /*
   * The restraint region: between the inner and outer radii, over the angular
   * span, centred on 180 degrees -- where a healthy line sits, because the
   * two ends measure the same current in opposite directions.
   *
   * The boundary is stepped out as a polyline rather than written as an arc.
   * A true arc would be one instruction, but the two painters disagree about
   * arc direction and sweep flags, and the one thing this file exists to
   * guarantee is that they draw the same shape.
   */
  const a1 = 180 - ang / 2;
  const a2 = 180 + ang / 2;
  const steps = Math.max(8, Math.ceil(ang / 2));
  items.push({
    t: 'path',
    pts: arcPoints(P, r, a1, a2, steps).concat(arcPoints(P, 1 / r, a2, a1, steps)),
    closed: true, role: 'region', w: 1.5
  });

  const anchor = P(1, 180);
  items.push({ t: 'dot', cx: anchor[0], cy: anchor[1], r: 3, role: 'anchor', w: 0 });
  // The through-load anchor sits where a check often lands, so on a points
  // plot its caption is dropped rather than left overlapping a test number.
  if (o.chrome) {
    items.push({ t: 'text', x: anchor[0] - 4, y: anchor[1] + 17, s: '-1', size: 10, role: 'anchor' });
  }

  if (o.points && o.points.length) {
    const marks = o.points.map((pt) => {
      const c = P(pt.magnitude, pt.angle);
      return { x: c[0], y: c[1], role: pt.role, label: pt.label };
    });
    for (const m of marks) items.push({ t: 'dot', cx: m.x, cy: m.y, r: 4.5, role: m.role, w: 1.4 });
    placeLabels(items, marks.filter((m) => m.label), 9.5);
  }

  if (o.live) {
    const p = P(o.live.magnitude, o.live.angle);
    items.push({ t: 'circle', cx: p[0], cy: p[1], r: 7, role: 'live', w: 2 });
    items.push({ t: 'dot', cx: p[0], cy: p[1], r: 3, role: 'live', w: 0 });
  }

  return { width: o.width, height: o.height, items };
}

/* ------------------------------------------- turning a plan into points --- */

const roleOf = (expect) => (expect === 'OPERATE' ? 'good' : 'bad');

/**
 * The distance rows as plottable points. Whatever is handed in is what gets
 * drawn: the export passes a plan with the omitted rows already removed, so
 * they are absent from the plot for the same reason they are absent from the
 * table, without this needing to know anything about omission.
 */
function distancePoints(rows) {
  return groupPoints(rows.map((r) => ({
    key: (r.reverse ? 'r' : 'f') + r.zMag.toFixed(2),
    mag: r.zMag,
    reverse: !!r.reverse,
    role: roleOf(r.expect21),
    label: r.id
  })));
}

/**
 * The 87L checks as plottable points.
 *
 * Two things are going on here, and both come from the same fact: a check
 * exists once per phase, with its own identifier each time, and all three
 * carry the same ratio by construction.
 *
 * Every phase handed in is counted, so a dot survives as long as any of its
 * phases is still in the report -- which is what makes omission work without
 * this knowing anything about it. But only one phase's identifiers are
 * written next to the dot. Labelling with all of them would put nine numbers
 * on a single spot, and the caption can say in one line what nine numbers
 * would not: the other phases of each check sit underneath.
 */
function differentialPoints(checks) {
  const order = [];
  const groups = new Map();
  for (const x of checks) {
    const key = x.ratio.magnitude.toFixed(3) + '|' + x.ratio.angle.toFixed(1);
    let g = groups.get(key);
    if (!g) {
      g = { magnitude: x.ratio.magnitude, angle: x.ratio.angle, role: null, members: [] };
      groups.set(key, g);
      order.push(g);
    }
    const role = roleOf(x.result.expect);
    // A dot holding both an operate and a restrain check cannot honestly be
    // either colour. That happens for real: the pickup pair sits on one spot
    // and differs only in current, which this plane does not show.
    g.role = g.role === null || g.role === role ? role : 'mixed';
    g.members.push({ phase: x.phase, id: x.id });
  }

  return order.map((g) => {
    const phase = g.members.map((m) => m.phase).sort()[0];
    const ids = [];
    for (const m of g.members) {
      if (m.phase === phase && ids.indexOf(m.id) < 0) ids.push(m.id);
    }
    return { magnitude: g.magnitude, angle: g.angle, role: g.role, label: ids.join(', ') };
  });
}

const API = { rx, alpha, groupPoints, distancePoints, differentialPoints };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.EnderPlot = API;
