'use strict';
/*
 * Generates the static UI mockups in this folder.
 *
 * The numbers are computed rather than typed so the screens stay internally
 * consistent -- if the fault maths is wrong here it will look wrong, which is
 * the point of mocking it up before building the real thing.
 *
 *   node mockup/build.js
 */

const fs = require('fs');
const path = require('path');

const OUT = __dirname;

/* ---------- complex helpers (rectangular internally, polar for display) ---- */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const pol = (mag, ang) => ({ re: mag * Math.cos(ang * D2R), im: mag * Math.sin(ang * D2R) });
const add = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
const sub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const mul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const div = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const scale = (a, k) => ({ re: a.re * k, im: a.im * k });
const mag = (a) => Math.hypot(a.re, a.im);
const ang = (a) => {
  let d = Math.atan2(a.im, a.re) * R2D;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
};

const fmtM = (v, dp = 2) => v.toFixed(dp);
const fmtA = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '°';
const phasor = (c, dp = 2) => fmtM(mag(c), dp) + ' ∠' + fmtA(ang(c));

/* ---------- the example line ---------------------------------------------- */

const REL_L = {
  end: 'Local', station: 'ALPHA 345 kV', model: 'SEL-411L',
  rid: 'ALPHA_LN1', tid: 'LINE 1 TERM A', ctr: 240, ptr: 2000, serial: '1142730612'
};
const REL_R = {
  end: 'Remote', station: 'BRAVO 345 kV', model: 'SEL-411L',
  rid: 'BRAVO_LN1', tid: 'LINE 1 TERM B', ctr: 240, ptr: 2000, serial: '1142730619'
};

const LINE = {
  Z1MAG: 8.32, Z1ANG: 84.5,
  Z0MAG: 24.5, Z0ANG: 78.2,
  lengthMi: 42.7,
  VNOM: 67.0,
  zones: [
    { name: 'Zone 1', reach: 7.07, pct: '85% of line', dir: 'Forward', delay: '0.00 s' },
    { name: 'Zone 2', reach: 12.48, pct: '150% of line', dir: 'Forward', delay: '0.30 s' },
    { name: 'Zone 3', reach: 20.80, pct: '250% of line', dir: 'Forward', delay: '1.00 s' }
  ],
  d87: { R: 6.0, ANG: 195, PP: 1.0, PU: '1.00 A sec' }
};

const Z1 = pol(LINE.Z1MAG, LINE.Z1ANG);
const Z0 = pol(LINE.Z0MAG, LINE.Z0ANG);
const K0 = div(sub(Z0, Z1), scale(Z1, 3));
const K0_1 = add({ re: 1, im: 0 }, K0);

const ITEST = 5.0;          // A secondary, constant-current model
const INFEED = 0.65;        // remote-end contribution used for the example

module.exports = { pol, add, sub, mul, div, scale, mag, ang, fmtM, fmtA, phasor, REL_L, REL_R, LINE, Z1, Z0, K0, K0_1, ITEST, INFEED, OUT, fs, path };

/* ---------- fault quantities ---------------------------------------------- */

/*
 * Constant-current model: hold the injected current at ITEST and let the
 * voltages fall out of the loop impedance. Ground loops carry the (1+k0)
 * residual compensation; phase loops do not.
 */
function endQuantities(zLoop, current, type) {
  const V = LINE.VNOM;
  const zGround = mul(zLoop, K0_1);

  if (type === 'AG') {
    const vaMag = current * mag(zGround);
    const va = pol(vaMag, 0);
    const ia = pol(current, -ang(zGround));
    return {
      v: [va, pol(V, -120), pol(V, 120)],
      i: [ia, pol(0, 0), pol(0, 0)]
    };
  }

  if (type === 'BC') {
    // VB + VC = -VA with no zero sequence; VB - VC collapses to I x 2Z.
    const vbc = pol(2 * current * mag(zLoop), -90);
    const sum = pol(V, 180);
    const vb = scale(add(sum, vbc), 0.5);
    const vc = scale(sub(sum, vbc), 0.5);
    const ib = pol(current, -90 - ang(zLoop));
    return {
      v: [pol(V, 0), vb, vc],
      i: [pol(0, 0), ib, scale(ib, -1)]
    };
  }

  // ABC: balanced collapse, no residual compensation.
  const vm = current * mag(zLoop);
  const za = ang(zLoop);
  return {
    v: [pol(vm, 0), pol(vm, -120), pol(vm, 120)],
    i: [pol(current, -za), pol(current, -120 - za), pol(current, 120 - za)]
  };
}

function buildTests() {
  const rows = [];
  const types = [
    { key: 'AG', label: 'A–G', kind: 'Phase-to-ground' },
    { key: 'BC', label: 'B–C', kind: 'Phase-to-phase' },
    { key: 'ABC', label: 'ABC', kind: 'Three-phase' }
  ];
  const points = [
    { key: 'in', label: 'In zone', pct: 0.85 },
    { key: 'out', label: 'Out of zone', pct: 1.10 }
  ];

  LINE.zones.slice(0, 2).forEach((zone, zi) => {
    types.forEach((t) => {
      points.forEach((p) => {
        const zLoop = pol(zone.reach * p.pct, LINE.Z1ANG);
        const onLine = mag(zLoop) <= LINE.Z1MAG;
        const linePct = (mag(zLoop) / LINE.Z1MAG) * 100;

        const local = endQuantities(zLoop, ITEST, t.key);

        // Remote end: infeed while the fault is on the line, through-current
        // once it is past the far bus.
        let remote, zRemote, iRemote;
        if (onLine) {
          zRemote = sub(Z1, zLoop);
          iRemote = ITEST * INFEED;
          remote = endQuantities(zRemote, iRemote, t.key);
        } else {
          zRemote = sub(zLoop, Z1);
          iRemote = ITEST;
          remote = endQuantities(zRemote, iRemote, t.key);
          // Current leaves the line at the far end on a through fault.
          remote.i = remote.i.map((c) => scale(c, -1));
        }

        rows.push({
          zone: zone.name,
          zoneIdx: zi + 1,
          type: t.label,
          kind: t.kind,
          point: p.label,
          pctOfReach: Math.round(p.pct * 100),
          linePct,
          zLoop,
          onLine,
          expect21: p.key === 'in' ? 'OPERATE' : 'RESTRAIN',
          expect87: onLine ? 'OPERATE' : 'RESTRAIN',
          local,
          remote
        });
      });
    });
  });
  return rows;
}

const TESTS = buildTests();

/* ---------- page furniture ------------------------------------------------ */

const CSS = `
:root{
  --bg:#12151a; --panel:#1a1f27; --panel2:#151921; --line:#2a313c; --line2:#353e4b;
  --text:#e6e9ef; --muted:#8b95a5; --dim:#5d6878;
  --accent:#4f9dff; --good:#3fb950; --warn:#d29922; --bad:#f85149; --violet:#a371f7;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:14px/1.5 "Segoe UI",system-ui,sans-serif;display:flex;height:100vh;overflow:hidden}
nav{width:210px;flex:0 0 210px;background:var(--panel2);border-right:1px solid var(--line);
  padding:16px 0;display:flex;flex-direction:column}
.brand{padding:0 18px 16px;border-bottom:1px solid var(--line);margin-bottom:12px}
.brand h1{margin:0;font-size:17px;font-weight:600;letter-spacing:-0.01em}
.brand span{color:var(--dim);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
nav a{display:flex;align-items:center;gap:10px;padding:9px 18px;color:var(--muted);
  text-decoration:none;font-size:13px;border-left:2px solid transparent}
nav a .n{width:19px;height:19px;border-radius:50%;border:1px solid var(--line2);
  display:grid;place-items:center;font-size:10px;color:var(--dim);flex:0 0 19px}
nav a.on{color:var(--text);background:#1e2531;border-left-color:var(--accent)}
nav a.on .n{border-color:var(--accent);color:var(--accent)}
nav a.done .n{background:var(--good);border-color:var(--good);color:#0d1117}
.navfoot{margin-top:auto;padding:12px 18px 0;border-top:1px solid var(--line);color:var(--dim);font-size:11px}
main{flex:1;overflow:auto;padding:22px 26px}
header.page{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px}
header.page h2{margin:0;font-size:19px;font-weight:600}
header.page p{margin:3px 0 0;color:var(--muted);font-size:13px}
.actions{display:flex;gap:8px}
button{font:inherit;font-size:13px;padding:7px 14px;border-radius:6px;cursor:pointer;
  background:#222a35;color:var(--text);border:1px solid var(--line2)}
button.primary{background:var(--accent);border-color:var(--accent);color:#06101f;font-weight:600}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:15px 17px;margin-bottom:14px}
.card h3{margin:0 0 3px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.card .sub{color:var(--muted);font-size:12px;margin:0 0 12px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;color:var(--muted);font-weight:500;font-size:11px;text-transform:uppercase;
  letter-spacing:.05em;padding:7px 9px;border-bottom:1px solid var(--line2);white-space:nowrap}
td{padding:7px 9px;border-bottom:1px solid #20262f;white-space:nowrap}
tr:last-child td{border-bottom:none}
tr.sel td{background:#1e2735}
.num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
.mono{font-family:"Cascadia Mono",Consolas,monospace;font-size:12px}
.tag{display:inline-block;padding:1.5px 7px;border-radius:999px;font-size:10.5px;font-weight:600;letter-spacing:.03em}
.t-op{background:rgba(63,185,80,.15);color:var(--good);border:1px solid rgba(63,185,80,.35)}
.t-re{background:rgba(139,149,165,.13);color:var(--muted);border:1px solid var(--line2)}
.t-in{background:rgba(79,157,255,.15);color:var(--accent);border:1px solid rgba(79,157,255,.35)}
.t-ex{background:rgba(210,153,34,.15);color:var(--warn);border:1px solid rgba(210,153,34,.35)}
.t-ok{background:rgba(63,185,80,.15);color:var(--good)}
.kv{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:12.5px}
.kv dt{color:var(--muted)}
.kv dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.drop{border:1.5px dashed var(--line2);border-radius:9px;padding:22px;text-align:center;
  background:var(--panel2);margin-bottom:12px}
.drop.filled{border-style:solid;border-color:rgba(63,185,80,.4);background:rgba(63,185,80,.05);text-align:left;padding:15px 17px}
.drop .big{font-size:13px;color:var(--muted)}
.warn{display:flex;gap:9px;align-items:flex-start;background:rgba(210,153,34,.09);
  border:1px solid rgba(210,153,34,.3);border-radius:7px;padding:10px 13px;font-size:12.5px;margin-bottom:14px}
.warn b{color:var(--warn)}
.ctl{display:flex;align-items:center;gap:11px;margin-bottom:11px;font-size:12.5px}
.ctl label{width:128px;color:var(--muted);flex:0 0 128px}
.ctl input[type=range]{flex:1;accent-color:var(--accent)}
.ctl .val{width:62px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text)}
.seg{display:inline-flex;border:1px solid var(--line2);border-radius:6px;overflow:hidden}
.seg span{padding:5px 11px;font-size:12px;color:var(--muted);border-right:1px solid var(--line2)}
.seg span:last-child{border-right:none}
.seg span.on{background:var(--accent);color:#06101f;font-weight:600}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin-top:9px}
.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}
.phgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:4px}
.ph{background:var(--panel2);border:1px solid var(--line);border-radius:7px;padding:9px 11px}
.ph .lbl{color:var(--dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.05em}
.ph .v{font-size:14px;font-variant-numeric:tabular-nums;margin-top:2px}
.ph .a{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.pa{color:var(--bad)} .pb{color:var(--good)} .pc{color:var(--accent)}
.navsep{padding:14px 18px 6px;color:var(--dim);font-size:10px;letter-spacing:.09em;
  text-transform:uppercase;border-top:1px solid var(--line);margin-top:10px}
nav a .n.ico{font-size:11px;color:var(--muted);border-color:var(--line2)}
nav a.on .n.ico{color:var(--accent)}

.tip{position:relative;display:inline-flex;align-items:center;gap:4px;cursor:help}
.tip>.q{display:inline-grid;place-items:center;width:13px;height:13px;border-radius:50%;
  border:1px solid var(--line2);color:var(--dim);font-size:9px;line-height:1;flex:0 0 13px}
.tip:hover>.q,.tip.open>.q{border-color:var(--accent);color:var(--accent)}
.tipbox{position:absolute;left:-6px;top:calc(100% + 8px);width:286px;background:#0e1116;
  border:1px solid var(--line2);border-radius:8px;padding:11px 13px;z-index:40;
  box-shadow:0 12px 30px rgba(0,0,0,.6);display:none;
  font-size:12px;line-height:1.55;color:var(--text);white-space:normal;text-align:left;
  font-weight:400;text-transform:none;letter-spacing:0}
.tip:hover .tipbox,.tip.open .tipbox{display:block}
.tip.right .tipbox{left:auto;right:-6px}
.tipbox b{display:block;color:var(--accent);font-size:10.5px;text-transform:uppercase;
  letter-spacing:.05em;margin-bottom:5px;font-weight:600}
.tipbox .tcode{display:block;margin-top:7px;padding:6px 8px;background:#161b22;border-radius:5px;
  font-family:"Cascadia Mono",Consolas,monospace;font-size:11px;color:var(--good)}
th .tip{color:var(--muted)}

.swatches{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.sw{width:34px;height:34px;border-radius:7px;border:2px solid transparent;cursor:pointer}
.sw.on{border-color:var(--text)}
.themegrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.theme{border:1.5px solid var(--line);border-radius:8px;padding:10px;cursor:pointer;background:var(--panel2)}
.theme.on{border-color:var(--accent)}
.theme .bars{display:flex;gap:3px;height:28px;margin-bottom:7px}
.theme .bars i{flex:1;border-radius:3px}
.theme .nm{font-size:12px}
.rowline{display:flex;align-items:center;justify-content:space-between;padding:9px 0;
  border-bottom:1px solid #20262f;font-size:12.5px}
.rowline:last-child{border-bottom:none}
.rowline .lbl{color:var(--muted)}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:6px;
  border:1px solid var(--line2);background:var(--panel2);font-size:12px;color:var(--muted)}
.search{width:100%;padding:8px 11px;border-radius:7px;border:1px solid var(--line2);
  background:var(--panel2);color:var(--text);font:inherit;font-size:13px}
.linkbtn{color:var(--accent);cursor:pointer}
.sgn{font:inherit;font-size:11px;padding:3px 5px;border-radius:5px;background:var(--panel2);
  color:var(--muted);border:1px solid var(--line2);min-width:88px}
.sgn.pass{color:var(--good);border-color:rgba(63,185,80,.35)}
.sgn.fail{color:var(--bad);border-color:rgba(248,81,73,.35)}
.sgn.skip{color:var(--warn);border-color:rgba(210,153,34,.35)}
.sgn.neutral{color:var(--muted);border-color:var(--line2)}
tr.pick{cursor:pointer}
tr.pick:hover td{background:#1b2230}
tr.pick.sel td{background:#1e2735}
.toast{position:fixed;right:22px;bottom:22px;z-index:200;display:flex;align-items:center;gap:9px;
  background:#152a1b;border:1px solid rgba(63,185,80,.45);color:#b9f0c4;border-radius:9px;
  padding:11px 15px;font-size:13px;box-shadow:0 14px 34px rgba(0,0,0,.55);
  opacity:0;transform:translateY(9px);transition:opacity .16s,transform .16s}
.toast.in{opacity:1;transform:translateY(0)}
.toast .ok{display:inline-grid;place-items:center;width:17px;height:17px;border-radius:50%;
  background:#3fb950;color:#0d1117;font-size:11px;font-weight:700}
.swatchin{width:26px;height:22px;padding:0;border:1px solid var(--line2);border-radius:5px;
  background:transparent;cursor:pointer}

/* Calculation record: formula, substitution, result -- one line each. */
.math{display:grid;grid-template-columns:auto 18px 1fr;align-items:baseline;
  font-family:"Cascadia Mono",Consolas,monospace;font-size:12px;line-height:1.75;
  background:var(--panel2);border:1px solid var(--line);border-radius:7px;
  padding:11px 14px;margin:9px 0 0;overflow-x:auto}
.math .l{color:var(--accent);text-align:right;padding-right:7px;white-space:nowrap}
.math .e{color:var(--dim);text-align:center}
.math .r{color:var(--text);white-space:nowrap}
.math .r em{color:var(--muted);font-style:normal}
.why{color:var(--muted);font-size:12px;margin:8px 0 0;line-height:1.6}
.ref{font-family:"Cascadia Mono",Consolas,monospace;font-size:11px;color:var(--violet)}
.sec{margin-bottom:18px}
.sec>h4{display:flex;align-items:center;gap:9px;margin:0 0 4px;font-size:14px;font-weight:600}
.sec>h4 .badge{display:inline-grid;place-items:center;width:21px;height:21px;border-radius:5px;
  background:#242c38;color:var(--accent);font-size:11px;font-weight:700}
.toc{position:sticky;top:0}
.toc a{display:block;padding:6px 9px;border-radius:6px;color:var(--muted);text-decoration:none;
  font-size:12.5px;border-left:2px solid transparent}
.toc a:hover{background:var(--panel2);color:var(--text)}
.toc a.on{background:#1e2531;color:var(--text);border-left-color:var(--accent)}
.chk{display:flex;gap:9px;align-items:flex-start;background:rgba(63,185,80,.07);
  border:1px solid rgba(63,185,80,.28);border-radius:7px;padding:10px 13px;margin-top:10px;font-size:12.5px}
.chk b{color:var(--good)}
.excl li{margin-bottom:5px}
.signbox{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px}
.signbox .fld{border-bottom:1px solid var(--line2);padding:16px 2px 6px;color:var(--dim);font-size:11.5px}
.sgnp{display:inline-block;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:600;
  border:1px solid var(--line2);background:var(--panel2)}
.sgnp.pass{color:var(--good);border-color:rgba(63,185,80,.35)}
.sgnp.fail{color:var(--bad);border-color:rgba(248,81,73,.35)}
.sgnp.skip{color:var(--warn);border-color:rgba(210,153,34,.35)}
.sgnp.neutral{color:var(--muted);border-color:var(--line2)}
.cell{font:inherit;font-size:12.5px;color:var(--text);background:var(--panel2);
  border:1px solid var(--line2);border-radius:5px;padding:4px 8px;width:100%}
.cell:focus{outline:none;border-color:var(--accent)}
.initials{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;
  background:#242c38;color:var(--accent);font-size:11px;font-weight:600}
.endlbl{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
.namewrap{display:flex;align-items:center;gap:7px;margin:3px 0 2px}
.nameedit{font:inherit;font-size:15px;font-weight:600;color:var(--text);background:transparent;
  border:1px solid transparent;border-radius:6px;padding:4px 8px;margin-left:-8px;flex:1;min-width:0}
.nameedit:hover{border-color:var(--line2);background:var(--panel2)}
.nameedit.active{border-color:var(--accent);background:var(--panel2);outline:none;
  box-shadow:0 0 0 3px rgba(79,157,255,.16)}
.pencil{color:var(--dim);font-size:13px;cursor:pointer}
.nameedit:hover+.pencil,.nameedit.active+.pencil{color:var(--accent)}
.src{font-size:11px;color:var(--dim);margin-bottom:10px;display:flex;align-items:center;gap:5px}
.src .tip>.q{width:12px;height:12px;font-size:8px}

`;

/*
 * Sign-off labels. Defined once here, rendered by the System settings screen
 * and read back by the report, so a colour or wording change in one place
 * shows up in the other. In the real app this is a stored config file.
 */
const LABELS = [
  { code: '—', text: 'Not set', colour: '#8b95a5', as: 'Neutral', dflt: true },
  { code: 'PASS', text: 'Passed', colour: '#3fb950', as: 'Pass', dflt: false },
  { code: 'FAIL', text: 'Failed', colour: '#f85149', as: 'Fail', dflt: false },
  { code: 'NOOP', text: 'No operation', colour: '#d29922', as: 'Skipped', dflt: false },
  { code: 'NO TEST', text: 'Not tested', colour: '#8b95a5', as: 'Skipped', dflt: false },
  { code: 'N/A', text: 'Not applicable', colour: '#8b95a5', as: 'Neutral', dflt: false },
  { code: 'DEFER', text: 'Deferred to next outage', colour: '#d29922', as: 'Skipped', dflt: false },
  { code: 'RETEST', text: 'Retest required', colour: '#f85149', as: 'Fail', dflt: false }
];

/*
 * A station name that has to follow the rename on screen 1. The baked value is
 * only the default -- the runtime at the bottom of every page overwrites it
 * from stored state, so one rename reaches every screen.
 *
 * `short` keeps column headings to the first word ("ALPHA 345 kV" -> "ALPHA").
 */
function nm(which, value, short) {
  return `<span data-nm="${which}"${short ? ' data-short="1"' : ''}>${value}</span>`;
}

// The five workflow steps, in order, so the sidebar and the Back/Continue
// buttons agree about what comes next.
const ORDER = [
  '01-settings.html', '02-system.html', '03-distance.html',
  '04-differential.html', '05-report.html', '06-findings.html'
];

function page(title, active, body) {
  const steps = [
    'Settings files', 'Line &amp; system', 'Distance (21)', 'Differential (87L)',
    'Report', 'Findings'
  ];
  const extras = [
    { key: 'reports', label: 'Saved reports', icon: '\u25a4', group: 'Library', file: '07-reports.html' },
    { key: 'system', label: 'System settings', icon: '\u2699', group: 'Settings', file: '09-config.html' },
    { key: 'theme', label: 'Appearance', icon: '\u25d0', group: 'Settings', file: '08-appearance.html' }
  ];
  const isStep = typeof active === 'number';

  const stepNav = steps.map((s, i) => {
    const n = i + 1;
    const cls = isStep && n === active ? 'on' : (isStep && n < active ? 'done' : '');
    const mark = isStep && n < active ? '\u2713' : n;
    return `<a href="${ORDER[i]}" class="${cls}"><span class="n">${mark}</span>${s}</a>`;
  }).join('\n    ');

  const extraNav = extras.map((e, i) =>
    (i === 0 || extras[i - 1].group !== e.group
      ? `<div class="navsep">${e.group}</div>\n    ` : '') +
    `<a href="${e.file}" class="${active === e.key ? 'on' : ''}"><span class="n ico">${e.icon}</span>${e.label}</a>`
  ).join('\n    ');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head>
<body>
  <nav>
    <div class="brand"><h1>Ender</h1><span>87L / 21 test builder</span></div>
    ${stepNav}
    ${extraNav}
    <div class="navfoot">${nm('local', 'ALPHA', true)} \u2013 ${nm('remote', 'BRAVO', true)}<br>Line 1 \u00b7 345 kV \u00b7 42.7 mi</div>
  </nav>
  <main>
${body}
  </main>
<script>
/*
 * Shared runtime for every page: station names, sign-off colours, navigation
 * and save confirmations. State lives in the main process so a rename made on
 * one screen is already true on the next.
 */
(function () {
  var ORDER = ${JSON.stringify(ORDER)};
  var DEFAULT_LABELS = ${JSON.stringify(LABELS)};
  var DEFAULT_NAMES = { local: ${JSON.stringify(REL_L.station)}, remote: ${JSON.stringify(REL_R.station)} };
  var SAVE_MSG = ${JSON.stringify(title.replace('Ender — ', '') + ' saved')};

  var state = { names: DEFAULT_NAMES, labels: DEFAULT_LABELS, signoff: {} };

  function hexA(hex, a) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    var tick = document.createElement('span');
    tick.className = 'ok';
    tick.textContent = '\\u2713';
    var txt = document.createElement('span');
    txt.textContent = msg;
    el.appendChild(tick);
    el.appendChild(txt);
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    setTimeout(function () {
      el.classList.remove('in');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, 2200);
  }

  function save(patch, msg) {
    if (window.demo) window.demo.set(patch);
    if (msg) toast(msg);
  }

  function labelFor(code) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].code === code) return state.labels[i];
    }
    return null;
  }

  function applyNames() {
    var els = document.querySelectorAll('[data-nm]');
    for (var i = 0; i < els.length; i++) {
      var v = state.names[els[i].getAttribute('data-nm')] || '';
      if (els[i].hasAttribute('data-short')) v = v.split(' ')[0];
      els[i].textContent = v;
    }
    var ins = document.querySelectorAll('[data-nmv]');
    for (var j = 0; j < ins.length; j++) {
      ins[j].value = state.names[ins[j].getAttribute('data-nmv')] || '';
    }
  }

  function paint(sel) {
    var L = labelFor(sel.value);
    sel.style.color = L ? L.colour : '';
    sel.style.borderColor = L ? hexA(L.colour, 0.45) : '';
  }

  function buildSelects() {
    var sels = document.querySelectorAll('select.sgn');
    for (var i = 0; i < sels.length; i++) {
      (function (s) {
        var key = s.getAttribute('data-sg');
        var cur = (key && state.signoff[key]) || s.value;
        s.innerHTML = '';
        for (var j = 0; j < state.labels.length; j++) {
          var o = document.createElement('option');
          o.textContent = state.labels[j].code;
          s.appendChild(o);
        }
        if (cur) s.value = cur;
        paint(s);
        s.onchange = function () {
          paint(s);
          var sg = {};
          for (var k in state.signoff) sg[k] = state.signoff[k];
          sg[key] = s.value;
          state.signoff = sg;
          save({ signoff: sg }, 'Sign-off saved');
        };
      })(sels[i]);
    }
  }

  function paintChips() {
    var chips = document.querySelectorAll('[data-chip]');
    for (var i = 0; i < chips.length; i++) {
      var L = labelFor(chips[i].getAttribute('data-chip'));
      if (L) {
        chips[i].style.color = L.colour;
        chips[i].style.borderColor = hexA(L.colour, 0.45);
      }
    }
  }

  function wire() {
    var here = decodeURIComponent(location.pathname.split('/').pop());
    var at = ORDER.indexOf(here);
    var bs = document.querySelectorAll('button');
    for (var k = 0; k < bs.length; k++) {
      (function (b) {
        var t = b.textContent.trim();
        if (t.indexOf('\\u2190') === 0 && at > 0) {
          b.onclick = function () { location.href = ORDER[at - 1]; };
        } else if (t.slice(-1) === '\\u2192' && at >= 0 && at < ORDER.length - 1) {
          b.onclick = function () { location.href = ORDER[at + 1]; };
        } else if (t === 'New test run') {
          b.onclick = function () { location.href = ORDER[0]; };
        } else if (t === 'Save') {
          b.onclick = function () { save({ names: state.names, labels: state.labels }, SAVE_MSG); };
        } else if (t === 'Reset to default') {
          b.onclick = function () {
            state.names = DEFAULT_NAMES;
            state.labels = DEFAULT_LABELS;
            save({ names: DEFAULT_NAMES, labels: DEFAULT_LABELS }, 'Reset to defaults');
            applyNames(); buildSelects(); paintChips(); syncSwatches();
          };
        }
      })(bs[k]);
    }

    var ins = document.querySelectorAll('[data-nmv]');
    for (var m = 0; m < ins.length; m++) {
      (function (inp) {
        inp.onchange = function () {
          var which = inp.getAttribute('data-nmv');
          var names = { local: state.names.local, remote: state.names.remote };
          names[which] = inp.value.trim() || names[which];
          state.names = names;
          applyNames();
          save({ names: names }, 'Renamed to ' + names[which]);
        };
      })(ins[m]);
    }

    var cols = document.querySelectorAll('input[data-lblcolour]');
    for (var c = 0; c < cols.length; c++) {
      (function (inp) {
        inp.onchange = function () {
          var code = inp.getAttribute('data-lblcolour');
          state.labels = state.labels.map(function (L) {
            if (L.code !== code) return L;
            return { code: L.code, text: L.text, colour: inp.value, as: L.as, dflt: L.dflt };
          });
          paintChips(); buildSelects(); syncSwatches();
          save({ labels: state.labels }, code + ' colour saved');
        };
      })(cols[c]);
    }
  }

  function syncSwatches() {
    var hexes = document.querySelectorAll('[data-lblhex]');
    for (var i = 0; i < hexes.length; i++) {
      var L = labelFor(hexes[i].getAttribute('data-lblhex'));
      if (L) hexes[i].textContent = L.colour;
    }
    var ins = document.querySelectorAll('input[data-lblcolour]');
    for (var j = 0; j < ins.length; j++) {
      var M = labelFor(ins[j].getAttribute('data-lblcolour'));
      if (M) ins[j].value = M.colour;
    }
  }

  function start() {
    applyNames();
    buildSelects();
    paintChips();
    syncSwatches();
    wire();
    if (window.initDetail) window.initDetail(state);
  }

  if (window.demo) {
    window.demo.get().then(function (s) {
      if (s && s.names) state.names = { local: s.names.local || DEFAULT_NAMES.local, remote: s.names.remote || DEFAULT_NAMES.remote };
      if (s && s.labels && s.labels.length) state.labels = s.labels;
      if (s && s.signoff) state.signoff = s.signoff;
      start();
    }, start);
  } else {
    start();
  }
})();
</script>
</body></html>`;
}

/*
 * Hover help on a calculated field. The marker is part of the label so the
 * explanation sits next to the number it describes, not in a manual.
 */
function tip(label, title, text, formula, open, right) {
  const code = formula ? `<span class="tcode">${formula}</span>` : '';
  return `<span class="tip${open ? ' open' : ''}${right ? ' right' : ''}">${label}<span class="q">?</span>` +
    `<span class="tipbox"><b>${title}</b>${text}${code}</span></span>`;
}

function write(name, html) {
  fs.writeFileSync(path.join(OUT, name), html);
  console.log('  ' + name);
}

/* ---------- 1. settings files --------------------------------------------- */

/*
 * One dropped settings file.
 *
 * "Local" and "Remote" are positional -- which slot the file went into -- and
 * the display name defaults to the relay's RID, which is free text an engineer
 * typed at commissioning. Both are therefore editable here, and the chosen name
 * is what every later screen and the PDF use.
 */
function relayCard(r, file, size, editing) {
  const nameTip = tip('', 'Where this name comes from',
    'Defaulted from the relay RID in the settings file. RID is free text set at commissioning, so it is often a terminal code rather than a station name. Rename it here and the whole report follows.',
    'RID = ' + r.rid);

  return `<div class="drop filled">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <span class="endlbl">${r.end} end</span>
        <span class="tag t-ok">parsed</span>
      </div>
      <div class="namewrap">
        <input class="nameedit${editing ? ' active' : ''}" data-nmv="${r.end.toLowerCase()}" value="${r.station}">
        <span class="pencil">✎</span>
      </div>
      <div class="src">default from RID · <span class="mono">${r.rid}</span> ${nameTip}</div>
      <div class="mono" style="color:var(--muted);font-size:11.5px;margin-bottom:11px">${file}
        <span style="color:var(--dim)"> · ${size}</span></div>
      <dl class="kv">
        <dt>Relay model</dt><dd>${r.model}</dd>
        <dt>${tip('Relay ID', 'RID', 'The relay identifier string stored in the settings. Ender uses it as the default display name and to match a re-import to an existing report.')}</dt><dd class="mono">${r.rid}</dd>
        <dt>${tip('Terminal ID', 'TID', 'The terminal identifier string. Useful for telling two ends of the same line apart when both RIDs look alike.')}</dt><dd class="mono">${r.tid}</dd>
        <dt>Serial</dt><dd class="mono">${r.serial}</dd>
        <dt>CT ratio</dt><dd>${r.ctr}:1</dd>
        <dt>PT ratio</dt><dd>${r.ptr}:1</dd>
      </dl>
    </div>`;
}

function screen1() {
  const body = `    <header class="page">
      <div><h2>Settings files</h2>
      <p>Drop the acSELerator HTML export from each end of the line. Names default to the relay RID — click one to rename it.</p></div>
      <div class="actions"><button>⇄ Swap ends</button><button>Clear</button><button class="primary">Continue →</button></div>
    </header>

    <div class="grid2">
      ${relayCard(REL_L, 'ALPHA_LN1_Settings.html', '412 KB')}
      ${relayCard(REL_R, 'BRAVO_LN1_Settings.html', '409 KB', true)}
    </div>

    <div class="card">
      <h3>Elements found</h3>
      <p class="sub">Both files carry the settings groups Ender needs. Anything missing is listed so you can fix it before calculating.</p>
      <table>
        <tr><th>Element</th><th>Setting</th><th>Local (${nm('local', 'ALPHA', true)})</th>
          <th>Remote (${nm('remote', 'BRAVO', true)})</th><th>Status</th></tr>
        <tr><td>Line impedance</td><td class="mono">Z1MAG ∠ Z1ANG</td>
          <td class="num">8.32 Ω ∠ 84.50°</td><td class="num">8.32 Ω ∠ 84.50°</td>
          <td><span class="tag t-ok">match</span></td></tr>
        <tr><td>Zero-seq impedance</td><td class="mono">Z0MAG ∠ Z0ANG</td>
          <td class="num">24.50 Ω ∠ 78.20°</td><td class="num">24.50 Ω ∠ 78.20°</td>
          <td><span class="tag t-ok">match</span></td></tr>
        <tr><td>Zone 1 reach</td><td class="mono">Z1P / Z1MG</td>
          <td class="num">7.07 Ω</td><td class="num">7.07 Ω</td>
          <td><span class="tag t-ok">match</span></td></tr>
        <tr><td>Zone 2 reach</td><td class="mono">Z2P / Z2MG</td>
          <td class="num">12.48 Ω</td><td class="num">12.48 Ω</td>
          <td><span class="tag t-ok">match</span></td></tr>
        <tr><td>Zone 3 reach</td><td class="mono">Z3P / Z3MG</td>
          <td class="num">20.80 Ω</td><td class="num">20.80 Ω</td>
          <td><span class="tag t-ok">match</span></td></tr>
        <tr><td>87L restraint radius</td><td class="mono">87LR</td>
          <td class="num">6.00</td><td class="num">6.00</td>
          <td><span class="tag t-ok">match</span></td></tr>
        <tr><td>87L restraint angle</td><td class="mono">87LANG</td>
          <td class="num">195°</td><td class="num">195°</td>
          <td><span class="tag t-ok">match</span></td></tr>
        <tr><td>87L pickup</td><td class="mono">87LPP</td>
          <td class="num">1.00 A</td><td class="num">1.00 A</td>
          <td><span class="tag t-ok">match</span></td></tr>
      </table>
    </div>`;
  return page('Ender — Settings files', 1, body);
}

/* ---------- 2. line & system ---------------------------------------------- */

function screen2() {
  const body = `    <header class="page">
      <div><h2>Line &amp; system data</h2>
      <p>Derived from the settings files. Source impedances are yours to supply — they are not in the relay.</p></div>
      <div class="actions"><button>← Back</button><button class="primary">Continue →</button></div>
    </header>

    <div class="grid2">
      <div class="card">
        <h3>Protected line</h3>
        <p class="sub">Read from both relays and cross-checked.</p>
        <dl class="kv">
          <dt>Positive-sequence Z1</dt><dd>8.32 Ω ∠ 84.50°</dd>
          <dt>Zero-sequence Z0</dt><dd>24.50 Ω ∠ 78.20°</dd>
          <dt>Line length</dt><dd>42.7 mi</dd>
          <dt>Nominal secondary</dt><dd>67.0 V L–N</dd>
          <dt>${tip('k0', 'Zero-sequence compensation', 'Lets a ground loop measure the same distance as a phase loop. Derived from the line Z1 and Z0 in the settings file — never typed in, because a wrong k0 shifts every ground test point.', 'k0 = (Z0 − Z1) / (3 · Z1)', true)}</dt><dd>${fmtM(mag(K0), 4)} ∠ ${fmtA(ang(K0))}</dd>
          <dt>${tip('1 + k0', 'Ground loop multiplier', 'Every phase-to-ground test voltage is scaled by this. A ground fault needs this much more voltage than a phase fault at the same distance.', 'V = I · Z_loop · (1 + k0)')}</dt><dd>${fmtM(mag(K0_1), 4)} ∠ ${fmtA(ang(K0_1))}</dd>
        </dl>
      </div>

      <div class="card">
        <h3>Fault model</h3>
        <p class="sub">How voltage and current are derived for each test point.</p>
        <div class="ctl"><label>Method</label>
          <div class="seg"><span class="on">Constant source Z</span><span>Constant I</span><span>Constant V</span></div>
        </div>
        <dl class="kv" style="margin-top:14px">
          <dt>Source Z1 behind ${nm('local', 'ALPHA', true)}</dt><dd>3.10 Ω ∠ 86.0°</dd>
          <dt>Source Z0 behind ${nm('local', 'ALPHA', true)}</dt><dd>4.95 Ω ∠ 81.0°</dd>
          <dt>Source Z1 behind ${nm('remote', 'BRAVO', true)}</dt><dd>5.80 Ω ∠ 85.0°</dd>
          <dt>Source Z0 behind ${nm('remote', 'BRAVO', true)}</dt><dd>9.20 Ω ∠ 80.0°</dd>
          <dt>Remote infeed ratio</dt><dd>0.65</dd>
        </dl>
      </div>
    </div>

    <div class="card">
      <h3>Distance zones</h3>
      <p class="sub">Reaches as a share of the line, so an over- or under-reaching zone is obvious at a glance.</p>
      <table>
        <tr><th>Zone</th><th>Reach (Ω sec)</th><th>${tip('% of line', 'Reach vs the line', 'The zone reach divided by the total line impedance. Under 100% underreaches the far bus; over 100% reaches past it and must be time-delayed.', 'reach / Z1MAG × 100')}</th><th>Direction</th><th>Delay</th><th>Characteristic</th></tr>
        ${LINE.zones.map((z) => `<tr><td>${z.name}</td><td class="num">${z.reach.toFixed(2)}</td>
          <td class="num">${((z.reach / LINE.Z1MAG) * 100).toFixed(0)}%</td>
          <td>${z.dir}</td><td class="num">${z.delay}</td><td>Mho + quadrilateral</td></tr>`).join('\n        ')}
      </table>
    </div>`;
  return page('Ender — Line & system', 2, body);
}

/* ---------- 3. distance (21) ---------------------------------------------- */

function screen3() {
  const zoneData = JSON.stringify(LINE.zones.map((z) => ({ name: z.name, reach: z.reach })));
  const tpHdr = '<tr><th>Zone</th><th>Point</th><th>% reach</th><th>' +
    tip('Z loop', 'Loop impedance', 'The impedance the relay measures for this fault. Ground loops carry the (1+k0) term; phase loops do not.', 'Z = reach × % ∠ Z1ANG') +
    '</th><th>' +
    tip('% of line', 'Fault position', 'Where the fault sits as a share of the real line. Over 100% means the fault is past the far bus — external to the 87L zone even while the distance zone still sees it.', 'Z_loop / Z1MAG × 100') +
    '</th><th>Expected</th></tr>';

  const body = `    <header class="page">
      <div><h2>Distance (21) test points</h2>
      <p>Drag the sliders to move the in-zone and out-of-zone points. The plot is the relay characteristic in secondary ohms.</p></div>
      <div class="actions"><button>← Back</button><button class="primary">Continue →</button></div>
    </header>

    <div style="display:grid;grid-template-columns:420px 1fr;gap:14px;align-items:start">
      <div class="card" style="margin:0">
        <h3>R–X plane</h3>
        <p class="sub">Mho characteristic, local end</p>
        <svg id="rx" width="384" height="448"></svg>
        <div class="legend">
          <span><i style="background:#4f9dff"></i>Zone 1</span>
          <span><i style="background:#a371f7"></i>Zone 2</span>
          <span><i style="background:#8b95a5"></i>Zone 3</span>
          <span><i style="background:#3fb950"></i>In zone</span>
          <span><i style="background:#f85149"></i>Out of zone</span>
        </div>
      </div>

      <div>
        <div class="card">
          <h3>Test point placement</h3>
          <p class="sub">Defaults follow common practice: 85% in, 110% out.</p>
          <div class="ctl"><label>${tip('In zone', 'In-zone test point', 'A fault placed inside the zone reach, where the element must operate. 85% leaves margin for CT and VT error so a healthy relay still passes.', 'Z = reach × 85%')}</label>
            <input type="range" id="sIn" min="50" max="99" value="85">
            <span class="val" id="vIn">85%</span></div>
          <div class="ctl"><label>${tip('Out of zone', 'Out-of-zone test point', 'A fault just past the reach, where the element must stay put. This is the security half of the test — it catches a zone set too long.', 'Z = reach × 110%')}</label>
            <input type="range" id="sOut" min="101" max="160" value="110">
            <span class="val" id="vOut">110%</span></div>
          <div class="ctl"><label>${tip('Test current', 'Injected current', 'Held constant while voltage follows the loop impedance. Raising it lowers the voltage the test set must produce at long reaches.', 'V = I · Z_loop')}</label>
            <input type="range" id="sI" min="10" max="100" value="50">
            <span class="val" id="vI">5.0 A</span></div>
          <div class="ctl" style="margin-top:14px"><label>Characteristic</label>
            <div class="seg"><span class="on">Mho</span><span>Quadrilateral</span></div></div>
          <div class="ctl"><label>Fault types</label>
            <div class="seg"><span class="on">A–G</span><span class="on">B–C</span><span class="on">ABC</span></div></div>
        </div>

        <div class="card">
          <h3>Resulting test points</h3>
          <p class="sub">Three fault types at each point, every zone — <span id="ntests">18</span> tests.</p>
          <table id="tp">
            <tr><th>Zone</th><th>Point</th><th>% reach</th><th>Z loop</th><th>% of line</th><th>Expected</th></tr>
          </table>
        </div>
      </div>
    </div>

<script>
var ZONES = ${zoneData};
var HDR = ${JSON.stringify(tpHdr)};
var ZANG = ${LINE.Z1ANG};
var ZMAG = ${LINE.Z1MAG};
var COLS = ['#4f9dff','#a371f7','#8b95a5'];
var NS = 'http://www.w3.org/2000/svg';

var RMIN=-11, RMAX=13, XMIN=-2, XMAX=26, S=16;
function px(r){ return (r-RMIN)*S; }
function py(x){ return (XMAX-x)*S; }

function el(n,a){ var e=document.createElementNS(NS,n); for(var k in a){ e.setAttribute(k,a[k]); } return e; }

function draw(){
  var svg=document.getElementById('rx');
  while(svg.firstChild) svg.removeChild(svg.firstChild);

  var g;
  for(var r=RMIN;r<=RMAX;r+=4){
    g=el('line',{x1:px(r),y1:py(XMIN),x2:px(r),y2:py(XMAX),stroke:'#222a35','stroke-width':1});
    svg.appendChild(g);
  }
  for(var x=XMIN;x<=XMAX;x+=4){
    g=el('line',{x1:px(RMIN),y1:py(x),x2:px(RMAX),y2:py(x),stroke:'#222a35','stroke-width':1});
    svg.appendChild(g);
  }
  svg.appendChild(el('line',{x1:px(RMIN),y1:py(0),x2:px(RMAX),y2:py(0),stroke:'#4a5566','stroke-width':1.4}));
  svg.appendChild(el('line',{x1:px(0),y1:py(XMIN),x2:px(0),y2:py(XMAX),stroke:'#4a5566','stroke-width':1.4}));

  var tx=el('text',{x:px(RMAX)-14,y:py(0)-7,fill:'#5d6878','font-size':11}); tx.textContent='R'; svg.appendChild(tx);
  var ty=el('text',{x:px(0)+7,y:py(XMAX)+13,fill:'#5d6878','font-size':11}); ty.textContent='X'; svg.appendChild(ty);

  // mho circles, drawn largest first so Zone 1 stays readable on top
  for(var i=ZONES.length-1;i>=0;i--){
    var reach=ZONES[i].reach, rad=reach/2;
    var cx=rad*Math.cos(ZANG*Math.PI/180), cy=rad*Math.sin(ZANG*Math.PI/180);
    svg.appendChild(el('circle',{cx:px(cx),cy:py(cy),r:rad*S,fill:'none',stroke:COLS[i],'stroke-width':1.6,opacity:0.85}));
    var lab=el('text',{x:px(cx-rad)+6,y:py(cy)-5,fill:COLS[i],'font-size':10.5});
    lab.textContent=ZONES[i].name; svg.appendChild(lab);
  }

  // the line itself
  var lx=ZMAG*Math.cos(ZANG*Math.PI/180), ly=ZMAG*Math.sin(ZANG*Math.PI/180);
  svg.appendChild(el('line',{x1:px(0),y1:py(0),x2:px(lx),y2:py(ly),stroke:'#e6e9ef','stroke-width':1.8,'stroke-dasharray':'4 3'}));
  var lt=el('text',{x:px(lx)+8,y:py(ly),fill:'#e6e9ef','font-size':10.5}); lt.textContent='Line 100%'; svg.appendChild(lt);

  var inP=+document.getElementById('sIn').value/100;
  var outP=+document.getElementById('sOut').value/100;

  var rows=HDR;
  for(var i=0;i<ZONES.length;i++){
    [[inP,'#3fb950','In zone','OPERATE'],[outP,'#f85149','Out of zone','RESTRAIN']].forEach(function(p){
      var z=ZONES[i].reach*p[0];
      var ptx=z*Math.cos(ZANG*Math.PI/180), pty=z*Math.sin(ZANG*Math.PI/180);
      svg.appendChild(el('circle',{cx:px(ptx),cy:py(pty),r:4.5,fill:p[1],stroke:'#12151a','stroke-width':1.5}));
      var cls=p[3]==='OPERATE'?'t-op':'t-re';
      rows+='<tr><td>'+ZONES[i].name+'</td><td>'+p[2]+'</td><td class="num">'+Math.round(p[0]*100)+'%</td>'+
        '<td class="num">'+z.toFixed(2)+' Ω</td><td class="num">'+((z/ZMAG)*100).toFixed(0)+'%</td>'+
        '<td><span class="tag '+cls+'">'+p[3]+'</span></td></tr>';
    });
  }
  document.getElementById('tp').innerHTML=rows;
  document.getElementById('ntests').textContent=ZONES.length*2*3;
}

function bind(id,out,fn){
  var s=document.getElementById(id);
  s.addEventListener('input',function(){ document.getElementById(out).textContent=fn(s.value); draw(); });
}
bind('sIn','vIn',function(v){return v+'%';});
bind('sOut','vOut',function(v){return v+'%';});
bind('sI','vI',function(v){return (v/10).toFixed(1)+' A';});
draw();
</script>`;
  return page('Ender — Distance (21)', 3, body);
}

/* ---------- 4. differential (87L) ----------------------------------------- */

function screen4() {
  const body = `    <header class="page">
      <div><h2>Differential (87L) test points</h2>
      <p>The Alpha Plane: the complex ratio of remote to local current. Inside the shaded region the element restrains.</p></div>
      <div class="actions"><button>← Back</button><button class="primary">Continue →</button></div>
    </header>

    <div style="display:grid;grid-template-columns:460px 1fr;gap:14px;align-items:start">
      <div class="card" style="margin:0">
        <h3>Alpha plane — I<sub>R</sub> / I<sub>L</sub></h3>
        <p class="sub">Restraint region from 87LR and 87LANG</p>
        <svg id="ap" width="420" height="420"></svg>
        <div class="legend">
          <span><i style="background:#8b95a5"></i>Restraint region</span>
          <span><i style="background:#3fb950"></i>Operate</span>
          <span><i style="background:#f85149"></i>Restrain</span>
          <span><i style="background:#d29922"></i>Live point</span>
        </div>
      </div>

      <div>
        <div class="card">
          <h3>Characteristic</h3>
          <p class="sub">Read from the relay, editable to explore margin.</p>
          <div class="ctl"><label>87LR (radius)</label>
            <input type="range" id="sR" min="20" max="100" value="60">
            <span class="val" id="vR">6.0</span></div>
          <div class="ctl"><label>87LANG</label>
            <input type="range" id="sA" min="120" max="220" value="195">
            <span class="val" id="vA">195°</span></div>
        </div>

        <div class="card">
          <h3>Live test point</h3>
          <p class="sub">Where the injected current pair lands.</p>
          <div class="ctl"><label>Ratio magnitude</label>
            <input type="range" id="sM" min="5" max="800" value="100">
            <span class="val" id="vM">1.00</span></div>
          <div class="ctl"><label>Ratio angle</label>
            <input type="range" id="sT" min="0" max="359" value="180">
            <span class="val" id="vT">180°</span></div>
          <div style="margin-top:12px;padding:11px 13px;border-radius:7px;background:#151921;border:1px solid var(--line)">
            <span style="color:var(--muted);font-size:12.5px">Element should </span>
            <span id="verdict" class="tag t-re">RESTRAIN</span>
          </div>
        </div>

        <div class="card">
          <h3>Standard 87L checks</h3>
          <p class="sub">Generated for each phase — 18 tests across A, B and C.</p>
          <table>
            <tr><th>Check</th><th>I<sub>L</sub></th><th>I<sub>R</sub></th><th>Ratio</th><th>Expected</th></tr>
            <tr><td>Through load</td><td class="num">5.0 ∠0°</td><td class="num">5.0 ∠180°</td><td class="num">1.00 ∠180°</td><td><span class="tag t-re">RESTRAIN</span></td></tr>
            <tr><td>Internal, equal infeed</td><td class="num">5.0 ∠0°</td><td class="num">5.0 ∠0°</td><td class="num">1.00 ∠0°</td><td><span class="tag t-op">OPERATE</span></td></tr>
            <tr><td>Outer radius check</td><td class="num">1.0 ∠0°</td><td class="num">6.5 ∠180°</td><td class="num">6.50 ∠180°</td><td><span class="tag t-op">OPERATE</span></td></tr>
            <tr><td>Inner radius check</td><td class="num">6.5 ∠0°</td><td class="num">1.0 ∠180°</td><td class="num">0.15 ∠180°</td><td><span class="tag t-op">OPERATE</span></td></tr>
            <tr><td>Angle edge, inside</td><td class="num">5.0 ∠0°</td><td class="num">5.0 ∠265°</td><td class="num">1.00 ∠265°</td><td><span class="tag t-re">RESTRAIN</span></td></tr>
            <tr><td>Angle edge, outside</td><td class="num">5.0 ∠0°</td><td class="num">5.0 ∠280°</td><td class="num">1.00 ∠280°</td><td><span class="tag t-op">OPERATE</span></td></tr>
            <tr><td>Pickup (87LPP)</td><td class="num">0.55 ∠0°</td><td class="num">0.55 ∠0°</td><td class="num">1.00 ∠0°</td><td><span class="tag t-op">OPERATE</span></td></tr>
          </table>
        </div>
      </div>
    </div>

<script>
var NS='http://www.w3.org/2000/svg';
var DOM=7, S=30, CX=210, CY=210;
function px(r){ return CX + r*S; }
function py(i){ return CY - i*S; }
function el(n,a){ var e=document.createElementNS(NS,n); for(var k in a){ e.setAttribute(k,a[k]); } return e; }
function P(r,a){ var t=a*Math.PI/180; return [px(r*Math.cos(t)), py(r*Math.sin(t))]; }

function restrains(m,t,R,A){
  if(m > R || m < 1/R) return false;
  var d=((t-180+540)%360)-180;
  return Math.abs(d) <= A/2;
}

function draw(){
  var svg=document.getElementById('ap');
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  var R=+document.getElementById('sR').value/10;
  var A=+document.getElementById('sA').value;

  for(var k=-DOM;k<=DOM;k+=2){
    svg.appendChild(el('line',{x1:px(k),y1:py(-DOM),x2:px(k),y2:py(DOM),stroke:'#222a35','stroke-width':1}));
    svg.appendChild(el('line',{x1:px(-DOM),y1:py(k),x2:px(DOM),y2:py(k),stroke:'#222a35','stroke-width':1}));
  }
  svg.appendChild(el('line',{x1:px(-DOM),y1:py(0),x2:px(DOM),y2:py(0),stroke:'#4a5566','stroke-width':1.4}));
  svg.appendChild(el('line',{x1:px(0),y1:py(-DOM),x2:px(0),y2:py(DOM),stroke:'#4a5566','stroke-width':1.4}));

  var a1=180-A/2, a2=180+A/2, big=A>180?1:0;
  var o1=P(R,a1), o2=P(R,a2), i2=P(1/R,a2), i1=P(1/R,a1);
  var d='M '+o1[0]+' '+o1[1]+
        ' A '+R*S+' '+R*S+' 0 '+big+' 0 '+o2[0]+' '+o2[1]+
        ' L '+i2[0]+' '+i2[1]+
        ' A '+(1/R)*S+' '+(1/R)*S+' 0 '+big+' 1 '+i1[0]+' '+i1[1]+' Z';
  svg.appendChild(el('path',{d:d,fill:'rgba(139,149,165,0.16)',stroke:'#8b95a5','stroke-width':1.5}));

  // the through-current anchor point
  svg.appendChild(el('circle',{cx:px(-1),cy:py(0),r:3,fill:'#8b95a5'}));
  var at=el('text',{x:px(-1)-4,y:py(0)+17,fill:'#8b95a5','font-size':10}); at.textContent='−1'; svg.appendChild(at);

  var pts=[[1,180,'#f85149'],[1,0,'#3fb950'],[6.5,180,'#3fb950'],[0.154,180,'#3fb950'],
           [1,265,'#f85149'],[1,280,'#3fb950']];
  pts.forEach(function(p){
    var c=P(p[0],p[1]);
    svg.appendChild(el('circle',{cx:c[0],cy:c[1],r:4,fill:p[2],stroke:'#12151a','stroke-width':1.4}));
  });

  var m=+document.getElementById('sM').value/100;
  var t=+document.getElementById('sT').value;
  var live=P(m,t);
  svg.appendChild(el('circle',{cx:live[0],cy:live[1],r:7,fill:'none',stroke:'#d29922','stroke-width':2}));
  svg.appendChild(el('circle',{cx:live[0],cy:live[1],r:3,fill:'#d29922'}));

  var v=document.getElementById('verdict');
  var res=restrains(m,t,R,A);
  v.textContent=res?'RESTRAIN':'OPERATE';
  v.className='tag '+(res?'t-re':'t-op');
}

function bind(id,out,fn){
  var s=document.getElementById(id);
  s.addEventListener('input',function(){ document.getElementById(out).textContent=fn(s.value); draw(); });
}
bind('sR','vR',function(v){return (v/10).toFixed(1);});
bind('sA','vA',function(v){return v+'°';});
bind('sM','vM',function(v){return (v/100).toFixed(2);});
bind('sT','vT',function(v){return v+'°';});
draw();
</script>`;
  return page('Ender — Differential (87L)', 4, body);
}

/* ---------- 5. report ------------------------------------------------------ */

/*
 * The detail pane is rendered in the page rather than here, because it has to
 * follow whichever row is selected. These are the parts that do not change:
 * the header row (with its tooltips) and each end's fixed identity.
 */
const DETAIL_HDR = `<tr><th>Ph</th><th>Voltage</th><th>${tip('Angle', 'Voltage reference', 'Angles are referenced to the faulted phase voltage at 0°. Healthy phases stay at nominal, 120° apart.')}</th><th>Current</th><th>${tip('Angle', 'Current angle', 'Lags its voltage by the loop impedance angle, plus the k0 correction on ground loops. This is the angle you dial into the test set.', '∠I = −(∠Z_loop)', false, true)}</th></tr>`;

const DETAIL_META = {
  local: { end: 'Local', model: REL_L.model, rid: REL_L.rid, ctr: REL_L.ctr, ptr: REL_L.ptr },
  remote: { end: 'Remote', model: REL_R.model, rid: REL_R.rid, ctr: REL_R.ctr, ptr: REL_R.ptr }
};

function detailData() {
  const pack = (q) => ({
    v: q.v.map((c) => [mag(c), ang(c)]),
    i: q.i.map((c) => [mag(c), ang(c)])
  });
  return TESTS.map((t) => ({
    zone: t.zone, type: t.type, point: t.point,
    local: pack(t.local), remote: pack(t.remote)
  }));
}

/*
 * Per-end sign-off. The option list is house convention rather than anything
 * the relay or the test produces, so it is configured in System settings and
 * every report reads it from there.
 */
const SIGNOFF = ['—', 'PASS', 'FAIL', 'NOOP', 'NO TEST', 'N/A', 'DEFER', 'RETEST'];
// Classes follow each label's configured colour, not its roll-up meaning --
// NO TEST counts as Skipped but is deliberately grey rather than amber.
const SIGN_CLS = { PASS: 'pass', FAIL: 'fail', RETEST: 'fail',
  NOOP: 'skip', DEFER: 'skip', 'NO TEST': 'neutral', 'N/A': 'neutral' };
const SIGN_L = ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'NO TEST', 'PASS', 'PASS', 'NOOP', 'NOOP'];
const SIGN_R = ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'NO TEST', 'PASS', 'PASS', 'RETEST', 'NOOP'];
const SHORT_L = REL_L.station.split(' ')[0];
const SHORT_R = REL_R.station.split(' ')[0];

function signoff(v, key) {
  const opts = SIGNOFF.map((o) => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('');
  return `<td><select class="sgn ${SIGN_CLS[v] || ''}" data-sg="${key}">${opts}</select></td>`;
}

function screen5() {
  const overs = TESTS.filter((t) => mag(t.local.v[0]) > LINE.VNOM * 1.5).length;

  const rows = TESTS.map((t, i) => {
    const hot = mag(t.local.v[0]) > LINE.VNOM * 1.5;
    return `<tr class="pick${i === 0 ? ' sel' : ''}" data-row="${i}">
        <td class="num">${String(i + 1).padStart(2, '0')}</td>
        <td>${t.zone}</td>
        <td>${t.type}</td>
        <td style="color:var(--muted)">${t.kind}</td>
        <td class="num">${t.pctOfReach}%</td>
        <td class="num">${fmtM(mag(t.zLoop))} Ω</td>
        <td class="num">${t.linePct.toFixed(0)}%</td>
        <td><span class="tag ${t.onLine ? 't-in' : 't-ex'}">${t.onLine ? 'internal' : 'external'}</span></td>
        <td><span class="tag ${t.expect21 === 'OPERATE' ? 't-op' : 't-re'}">${t.expect21}</span></td>
        <td><span class="tag ${t.expect87 === 'OPERATE' ? 't-op' : 't-re'}">${t.expect87}</span></td>
        <td>${hot ? '<span class="tag t-ex">V high</span>' : ''}</td>
        ${signoff(SIGN_L[i], 'L' + i)}
        ${signoff(SIGN_R[i], 'R' + i)}
      </tr>`;
  }).join('\n      ');

  const body = `    <header class="page">
      <div><h2>Test report</h2>
      <p>${TESTS.length} test points · ${nm('local', 'ALPHA', true)} – ${nm('remote', 'BRAVO', true)} Line 1 · generated ${new Date().toISOString().slice(0, 10)}</p></div>
      <div class="actions"><button>← Back</button><button>Export CSV</button><button class="primary">Export PDF</button></div>
    </header>

    <div class="warn">
      <b>⚠</b>
      <div><b>${overs} test point${overs === 1 ? '' : 's'} need${overs === 1 ? 's' : ''} more than 100 V on the faulted phase.</b>
      Constant-current at 5.0 A pushes the far zones past what the system would really produce.
      Drop the test current to 2.5 A, or switch to the constant source impedance model.</div>
    </div>

    <div class="card">
      <h3>Test matrix</h3>
      <p class="sub">Every fault type at an in-zone and an out-of-zone point, per zone. Select a row to see the injected quantities.
        The two right-hand columns are sign-off, one per station — edit the choices in System settings.</p>
      <table>
        <tr><th>#</th><th>Zone</th><th>Fault</th><th>Type</th><th>% reach</th>
          <th>${tip('Z loop', 'Loop impedance', 'What the relay measures for this fault. Phase-to-ground loops include the (1+k0) term, phase loops do not.', 'Z = reach × % ∠ Z1ANG')}</th>
          <th>${tip('% line', 'Fault position', 'Position along the real line. Past 100% the fault is beyond the far bus.', 'Z_loop / Z1MAG × 100')}</th>
          <th>${tip('87L view', 'Internal or external', 'The differential sees any fault between the two CT sets as internal. Past either bus it is through current and must restrain — regardless of what the distance zones do.')}</th>
          <th>${tip('21 expected', 'Distance verdict', 'Whether this zone should operate. In-zone points must trip; out-of-zone points must not.')}</th>
          <th>${tip('87L expected', 'Differential verdict', 'Independent of the distance result. A Zone 2 fault past the far bus is external to 87L, so the two columns disagree on purpose.', null, false, true)}</th><th></th>
          <th>${tip(nm('local', SHORT_L, true), 'Local sign-off', 'What actually happened at this end for this test. The choices come from System settings, so the wording is yours to change.', null, false, true)}</th>
          <th>${tip(nm('remote', SHORT_R, true), 'Remote sign-off', 'The same record for the far end, kept separate because the two ends are often tested by different crews on different days.', null, false, true)}</th></tr>
      ${rows}
      </table>
    </div>

    <h3 id="dhead" style="font-size:14px;margin:18px 0 9px"></h3>
    <div class="grid2" id="dcards"></div>

<script>
/* Row selection: clicking any test row redraws both ends below it. */
(function () {
  var TD = ${JSON.stringify(detailData())};
  var META = ${JSON.stringify(DETAIL_META)};
  var HDR = ${JSON.stringify(DETAIL_HDR)};
  var PH = ['A', 'B', 'C'];
  var CLS = ['pa', 'pb', 'pc'];
  var current = 0;

  function ang(a) {
    return (a >= 0 ? '+' : '\\u2212') + Math.abs(a).toFixed(1) + '\\u00b0';
  }

  function card(meta, name, q) {
    var rows = '';
    for (var i = 0; i < 3; i++) {
      rows += '<tr><td class="' + CLS[i] + '" style="font-weight:600">' + PH[i] + '</td>' +
        '<td class="num">' + q.v[i][0].toFixed(2) + ' V</td>' +
        '<td class="num" style="color:var(--muted)">' + ang(q.v[i][1]) + '</td>' +
        '<td class="num">' + q.i[i][0].toFixed(3) + ' A</td>' +
        '<td class="num" style="color:var(--muted)">' + ang(q.i[i][1]) + '</td></tr>';
    }
    return '<div class="card" style="margin:0"><h3>' + meta.end + ' \\u2014 ' + name + '</h3>' +
      '<p class="sub">' + meta.model + ' \\u00b7 ' + meta.rid +
      ' \\u00b7 CT ' + meta.ctr + ':1 \\u00b7 PT ' + meta.ptr + ':1</p>' +
      '<table>' + HDR + rows + '</table></div>';
  }

  window.initDetail = function (state) {
    function render(i) {
      current = i;
      var t = TD[i];
      document.getElementById('dhead').innerHTML =
        'Test ' + ('0' + (i + 1)).slice(-2) + ' \\u00b7 ' + t.zone + ' ' + t.type + ' ' + t.point +
        ' <span style="color:var(--muted);font-weight:400">\\u2014 injected quantities, both ends</span>';
      document.getElementById('dcards').innerHTML =
        card(META.local, state.names.local, t.local) +
        card(META.remote, state.names.remote, t.remote);
      var rs = document.querySelectorAll('tr.pick');
      for (var k = 0; k < rs.length; k++) {
        if (k === i) rs[k].classList.add('sel'); else rs[k].classList.remove('sel');
      }
    }

    var rs = document.querySelectorAll('tr.pick');
    for (var k = 0; k < rs.length; k++) {
      (function (n) {
        rs[n].onclick = function (e) {
          // let the sign-off dropdowns work without moving the selection
          if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
          render(n);
        };
      })(k);
    }
    render(current);
  };
})();
</script>`;
  return page('Ender — Report', 5, body);
}

/* ---------- main ----------------------------------------------------------- */

console.log('writing mockups:');
write('01-settings.html', screen1());
write('02-system.html', screen2());
write('03-distance.html', screen3());
write('04-differential.html', screen4());
write('05-report.html', screen5());
console.log('done — ' + TESTS.length + ' test points');

require('./screens2.js')({ page, tip, write });

require('./screens3.js')({ page, tip, write, LABELS });

require('./screens4.js')({ page, tip, write, M: { pol, add, sub, mul, div, scale, mag, ang }, D: { Z1, Z0, K0, K0_1, LINE, REL_L, REL_R, TESTS, ITEST, INFEED } });
