'use strict';
/*
 * The two library screens: saved reports and appearance.
 *
 * Kept apart from build.js only to stay readable -- build.js hands in the
 * shared page shell, the tooltip helper and the writer.
 */

const ARCHIVE = [
  { id: 'R-0231', date: '2026-10-28', line: 'ALPHA – BRAVO', ln: 'Line 1', kv: '345 kV',
    relays: 'SEL-411L / SEL-411L', tests: 30, model: 'Source Z', state: 'Signed off', by: 'J. Hale', size: '418 KB' },
  { id: 'R-0230', date: '2026-10-24', line: 'BRAVO – CHARLIE', ln: 'Line 4', kv: '345 kV',
    relays: 'SEL-421 / SEL-421', tests: 18, model: 'Constant I', state: 'Results entered', by: 'J. Hale', size: '274 KB' },
  { id: 'R-0228', date: '2026-10-17', line: 'ALPHA – DELTA', ln: 'Line 2', kv: '138 kV',
    relays: 'SEL-311L / SEL-311L', tests: 24, model: 'Source Z', state: 'Signed off', by: 'M. Ortiz', size: '352 KB' },
  { id: 'R-0227', date: '2026-10-09', line: 'DELTA – ECHO', ln: 'Line 7', kv: '138 kV',
    relays: 'SEL-311C / SEL-421', tests: 18, model: 'Constant V', state: 'Generated', by: 'J. Hale', size: '201 KB' },
  { id: 'R-0225', date: '2026-09-30', line: 'ALPHA – BRAVO', ln: 'Line 1', kv: '345 kV',
    relays: 'SEL-411L / SEL-411L', tests: 30, model: 'Source Z', state: 'Superseded', by: 'M. Ortiz', size: '416 KB' },
  { id: 'R-0224', date: '2026-09-22', line: 'ECHO – FOXTROT', ln: 'Line 9', kv: '69 kV',
    relays: 'SEL-311C / SEL-311C', tests: 12, model: 'Constant I', state: 'Signed off', by: 'R. Kwan', size: '188 KB' }
];

const STATE_CLS = {
  'Signed off': 't-op',
  'Results entered': 't-in',
  'Generated': 't-re',
  'Superseded': 't-ex'
};

const THEMES = [
  { name: 'Ender dark', on: true, c: ['#12151a', '#1a1f27', '#4f9dff', '#3fb950'] },
  { name: 'Midnight', c: ['#0d1117', '#161b22', '#58a6ff', '#3fb950'] },
  { name: 'Slate', c: ['#1c2128', '#262c36', '#6cb6ff', '#57ab5a'] },
  { name: 'Graphite', c: ['#17191c', '#202326', '#7ee787', '#d29922'] },
  { name: 'High contrast', c: ['#000000', '#101010', '#ffd33d', '#00e676'] },
  { name: 'Daylight', c: ['#f6f8fa', '#ffffff', '#0969da', '#1a7f37'] }
];

const ROLES = [
  ['Background', '#12151a'], ['Panel', '#1a1f27'], ['Border', '#2a313c'],
  ['Body text', '#e6e9ef'], ['Muted text', '#8b95a5'], ['Accent', '#4f9dff'],
  ['Operate / pass', '#3fb950'], ['Restrain / neutral', '#8b95a5'],
  ['Warning', '#d29922'], ['Fail', '#f85149']
];

const ACCENTS = ['#4f9dff', '#7ee787', '#d29922', '#f85149', '#a371f7', '#ff7b72', '#39c5cf', '#e6e9ef'];

function reportsScreen(page, tip) {
  const rows = ARCHIVE.map((r, i) => `<tr class="${i === 0 ? 'sel' : ''}">
        <td class="mono">${r.id}</td>
        <td class="num">${r.date}</td>
        <td>${r.line}<div style="color:var(--dim);font-size:11px">${r.ln} · ${r.kv}</div></td>
        <td style="color:var(--muted)">${r.relays}</td>
        <td class="num">${r.tests}</td>
        <td style="color:var(--muted)">${r.model}</td>
        <td>${r.by}</td>
        <td><span class="tag ${STATE_CLS[r.state]}">${r.state}</span></td>
        <td class="num" style="color:var(--dim)">${r.size}</td>
        <td><span class="linkbtn">Open</span> <span style="color:var(--line2)">·</span>
            <span class="linkbtn">PDF</span> <span style="color:var(--line2)">·</span>
            <span class="linkbtn">CSV</span></td>
      </tr>`).join('\n      ');

  const modelTip = tip('Model', 'Fault model used',
    'Which calculation produced the quantities. Worth keeping with the report — a retest should use the same model or the numbers will not line up.');

  const fpTip = tip('Settings fingerprint', 'Settings fingerprint',
    'A hash of the two settings files this report was built from. If someone changes a relay setting afterwards, this stops matching and the report is stale.');

  const body = `    <header class="page">
      <div><h2>Saved reports</h2>
      <p>Every report Ender has generated on this machine, newest first.</p></div>
      <div class="actions"><button>Open folder</button><button class="primary">New test run</button></div>
    </header>

    <div class="card">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:13px">
        <input class="search" placeholder="Search by line, relay, terminal or report ID…" style="flex:1">
        <div class="seg"><span class="on">All</span><span>Signed off</span><span>In progress</span></div>
      </div>
      <table>
        <tr><th>Report</th><th>Date</th><th>Line</th><th>Relays</th><th>Tests</th>
          <th>${modelTip}</th><th>Engineer</th><th>Status</th><th>Size</th><th></th></tr>
      ${rows}
      </table>
    </div>

    <div class="grid2">
      <div class="card" style="margin:0">
        <h3>R-0231 · ALPHA – BRAVO Line 1</h3>
        <p class="sub">Signed off 2026-10-28 by J. Hale</p>
        <div class="rowline"><span class="lbl">Settings files</span>
          <span class="mono" style="font-size:11.5px">ALPHA_LN1.html, BRAVO_LN1.html</span></div>
        <div class="rowline"><span class="lbl">Zones covered</span><span>Zone 1, 2, 3</span></div>
        <div class="rowline"><span class="lbl">Fault types</span><span>A–G, B–C, ABC</span></div>
        <div class="rowline"><span class="lbl">87L checks</span><span>18 across A, B, C</span></div>
        <div class="rowline"><span class="lbl">${fpTip}</span>
          <span class="mono" style="font-size:11.5px;color:var(--good)">9f2c…a41e unchanged</span></div>
        <div style="margin-top:13px;display:flex;gap:8px">
          <button>Re-open</button><button>Duplicate as new run</button><button>Delete</button>
        </div>
      </div>

      <div class="card" style="margin:0">
        <h3>Storage</h3>
        <p class="sub">Reports are kept as files, so they survive an uninstall and can be backed up.</p>
        <div class="rowline"><span class="lbl">Location</span>
          <span class="mono" style="font-size:11.5px">%APPDATA%\\Ender\\reports</span></div>
        <div class="rowline"><span class="lbl">Reports stored</span><span>31</span></div>
        <div class="rowline"><span class="lbl">Disk used</span><span>9.4 MB</span></div>
        <div class="rowline"><span class="lbl">Oldest</span><span>2025-04-02</span></div>
        <div style="margin-top:13px;display:flex;gap:8px">
          <button>Export all</button><button>Import…</button><button>Change folder…</button>
        </div>
      </div>
    </div>`;

  return page('Ender — Saved reports', 'reports', body);
}

function appearanceScreen(page, tip) {
  const cards = THEMES.map((t) => `<div class="theme ${t.on ? 'on' : ''}">
          <div class="bars">${t.c.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
          <div class="nm">${t.name}</div>
        </div>`).join('\n        ');

  const swatches = ACCENTS.map((c, i) =>
    `<div class="sw ${i === 0 ? 'on' : ''}" style="background:${c}"></div>`).join('');

  const roleRows = ROLES.map(([n, c]) => `<div class="rowline">
          <span class="lbl">${n}</span>
          <span style="display:flex;align-items:center;gap:9px">
            <span class="mono" style="font-size:11.5px;color:var(--muted)">${c}</span>
            <span style="width:22px;height:22px;border-radius:5px;background:${c};border:1px solid var(--line2)"></span>
          </span></div>`).join('\n        ');

  const roleTip = tip('Colour roles', 'Named by meaning',
    'Colours are named for what they mean rather than where they appear, so changing "operate" recolours the tag, the plot marker and the PDF together.');

  const body = `    <header class="page">
      <div><h2>Appearance</h2>
      <p>Saved per machine and applied immediately. Report PDFs follow the same palette.</p></div>
      <div class="actions"><button>Reset to default</button><button class="primary">Save</button></div>
    </header>

    <div style="display:grid;grid-template-columns:1fr 420px;gap:14px;align-items:start">
      <div>
        <div class="card">
          <h3>Theme</h3>
          <p class="sub">A starting palette. Any colour below can still be overridden.</p>
          <div class="themegrid">
        ${cards}
          </div>
        </div>

        <div class="card">
          <h3>Accent</h3>
          <p class="sub">Used for selection, focus and the primary button.</p>
          <div class="swatches">${swatches}</div>
        </div>

        <div class="card">
          <h3>${roleTip}</h3>
          <p class="sub">Click a swatch to change it. Contrast is checked as you go.</p>
        ${roleRows}
        </div>

        <div class="card">
          <h3>Text &amp; density</h3>
          <div class="ctl" style="margin-top:9px"><label>Base text size</label>
            <input type="range" min="12" max="18" value="14"><span class="val">14 px</span></div>
          <div class="ctl"><label>Row density</label>
            <div class="seg"><span>Compact</span><span class="on">Normal</span><span>Roomy</span></div></div>
          <div class="ctl"><label>Number font</label>
            <div class="seg"><span class="on">Tabular</span><span>Proportional</span></div></div>
        </div>
      </div>

      <div class="card" style="margin:0">
        <h3>Preview</h3>
        <p class="sub">Live, using the real report components.</p>
        <table>
          <tr><th>#</th><th>Zone</th><th>Fault</th><th>Z loop</th><th>Expected</th></tr>
          <tr class="sel"><td class="num">01</td><td>Zone 1</td><td>A–G</td><td class="num">6.01 Ω</td>
            <td><span class="tag t-op">OPERATE</span></td></tr>
          <tr><td class="num">02</td><td>Zone 1</td><td>A–G</td><td class="num">7.78 Ω</td>
            <td><span class="tag t-re">RESTRAIN</span></td></tr>
          <tr><td class="num">07</td><td>Zone 2</td><td>B–C</td><td class="num">10.61 Ω</td>
            <td><span class="tag t-ex">external</span></td></tr>
        </table>
        <div class="warn" style="margin:13px 0 0"><b>⚠</b>
          <div>Warning banners use the warning role.</div></div>
        <div style="display:flex;gap:8px;margin-top:13px">
          <button>Secondary</button><button class="primary">Primary</button>
        </div>
        <div class="phgrid" style="grid-template-columns:repeat(3,1fr);margin-top:13px">
          <div class="ph"><div class="lbl pa">Phase A</div><div class="v">49.45 V</div><div class="a">+0.0°</div></div>
          <div class="ph"><div class="lbl pb">Phase B</div><div class="v">67.00 V</div><div class="a">−120.0°</div></div>
          <div class="ph"><div class="lbl pc">Phase C</div><div class="v">67.00 V</div><div class="a">+120.0°</div></div>
        </div>
        <div class="rowline" style="margin-top:15px"><span class="lbl">Saved to</span>
          <span class="mono" style="font-size:11.5px">%APPDATA%\\Ender\\theme.json</span></div>
      </div>
    </div>`;

  return page('Ender — Appearance', 'theme', body);
}

module.exports = function render(ctx) {
  ctx.write('07-reports.html', reportsScreen(ctx.page, ctx.tip));
  ctx.write('08-appearance.html', appearanceScreen(ctx.page, ctx.tip));
};
