'use strict';
/*
 * System settings: configuration that belongs to this installation rather
 * than to any one test run.
 *
 * The sign-off labels defined here are what the two right-hand columns of the
 * test report offer. They live at system level precisely because the wording
 * is a house convention -- rename one here and every future report follows,
 * while reports already signed keep the wording they were signed with.
 */

const ENGINEERS = [
  { initials: 'JH', name: 'J. Hale', role: 'Relay technician' },
  { initials: 'MO', name: 'M. Ortiz', role: 'Protection engineer' },
  { initials: 'RK', name: 'R. Kwan', role: 'Relay technician' }
];

function labelRow(l) {
  const asCls = { Pass: 't-op', Fail: 't-ex', Skipped: 't-re', Neutral: 't-re' }[l.as];
  return `<tr>
        <td style="color:var(--dim);cursor:grab">⁙</td>
        <td><input class="cell mono" value="${l.code}" style="width:88px"></td>
        <td><input class="cell" value="${l.text}"></td>
        <td><span style="display:flex;align-items:center;gap:8px">
          <input type="color" class="swatchin" data-lblcolour="${l.code}" value="${l.colour}">
          <span class="mono" data-lblhex="${l.code}" style="font-size:11.5px;color:var(--muted)">${l.colour}</span>
        </span></td>
        <td><span class="tag ${asCls}">${l.as}</span></td>
        <td style="text-align:center">${l.dflt ? '<span class="tag t-in">default</span>' : '<span style="color:var(--dim)">—</span>'}</td>
        <td style="text-align:right;color:var(--dim);cursor:pointer">✕</td>
      </tr>`;
}

function systemScreen(page, tip, LABELS) {
  // The blank "not set" entry is part of the dropdown but is not a label
  // anyone signs off with, so it is not editable here.
  const rows = LABELS.filter((l) => l.code !== '—').map(labelRow).join('\n      ');

  const asTip = tip('Treated as', 'Roll-up meaning',
    'How the label counts when the report totals itself up. Two names can share a meaning — NOOP and NO TEST both count as Skipped — so you can keep your own wording without breaking the summary.');

  const engRows = ENGINEERS.map((e) => `<tr>
        <td><span class="initials">${e.initials}</span></td>
        <td>${e.name}</td>
        <td style="color:var(--muted)">${e.role}</td>
        <td style="text-align:right;color:var(--dim);cursor:pointer">✕</td>
      </tr>`).join('\n      ');

  const body = `    <header class="page">
      <div><h2>System settings</h2>
      <p>Applies to this installation and every test run on it — not to one report.</p></div>
      <div class="actions"><button>Reset to default</button><button class="primary">Save</button></div>
    </header>

    <div class="card">
      <h3>Sign-off labels</h3>
      <p class="sub">The choices offered in the two sign-off columns of the test report, one column per station.
        Drag to reorder — that is the order they appear in the dropdown.</p>
      <table>
        <tr><th style="width:18px"></th><th>Code</th><th>Description</th><th>Colour</th>
          <th>${asTip}</th><th style="text-align:center">Default</th><th></th></tr>
      ${rows}
      </table>
      <div style="margin-top:13px;display:flex;gap:8px;align-items:center">
        <button>+ Add label</button>
        <span style="color:var(--dim);font-size:12px">Renaming applies to future reports only — a report already
          signed off keeps the wording it was signed with, so it never silently changes meaning.</span>
      </div>
    </div>

    <div class="grid2">
      <div class="card" style="margin:0">
        <h3>How it looks on the report</h3>
        <p class="sub">Live preview of the two columns these feed.</p>
        <table>
          <tr><th>#</th><th>Zone</th><th>Fault</th><th><span data-nm="local" data-short="1">ALPHA</span></th>
            <th><span data-nm="remote" data-short="1">BRAVO</span></th></tr>
          <tr><td class="num">01</td><td>Zone 1</td><td>A–G</td>
            <td><span class="sgnp" data-chip="PASS">PASS</span></td><td><span class="sgnp" data-chip="PASS">PASS</span></td></tr>
          <tr><td class="num">08</td><td>Zone 2</td><td>A–G</td>
            <td><span class="sgnp" data-chip="NO TEST">NO TEST</span></td><td><span class="sgnp" data-chip="NO TEST">NO TEST</span></td></tr>
          <tr><td class="num">11</td><td>Zone 2</td><td>ABC</td>
            <td><span class="sgnp" data-chip="NOOP">NOOP</span></td><td><span class="sgnp" data-chip="RETEST">RETEST</span></td></tr>
        </table>
        <div class="rowline" style="margin-top:12px"><span class="lbl">Summary would read</span>
          <span>8 passed · 1 failed · 3 skipped</span></div>
      </div>

      <div class="card" style="margin:0">
        <h3>Engineers</h3>
        <p class="sub">Who can be named on a sign-off. Used by the report header and the saved-report list.</p>
        <table>
          <tr><th style="width:38px"></th><th>Name</th><th>Role</th><th></th></tr>
        ${engRows}
        </table>
        <div style="margin-top:13px"><button>+ Add engineer</button></div>
      </div>
    </div>

    <div class="grid2">
      <div class="card" style="margin:0">
        <h3>Organisation</h3>
        <p class="sub">Printed on every report header and footer.</p>
        <div class="rowline"><span class="lbl">Utility</span>
          <input class="cell" value="TX Drone Co" style="max-width:230px;text-align:right"></div>
        <div class="rowline"><span class="lbl">Division</span>
          <input class="cell" value="Transmission Protection" style="max-width:230px;text-align:right"></div>
        <div class="rowline"><span class="lbl">Report title prefix</span>
          <input class="cell" value="Line Protection Test Record" style="max-width:230px;text-align:right"></div>
        <div class="rowline"><span class="lbl">Footer note</span>
          <input class="cell" value="Internal use only" style="max-width:230px;text-align:right"></div>
      </div>

      <div class="card" style="margin:0">
        <h3>Test defaults</h3>
        <p class="sub">Starting values for a new run. Any run can override them without changing these.</p>
        <div class="rowline"><span class="lbl">Fault model</span>
          <span class="seg"><span class="on">Source Z</span><span>Constant I</span><span>Constant V</span></span></div>
        <div class="rowline"><span class="lbl">Test current</span><span>5.0 A secondary</span></div>
        <div class="rowline"><span class="lbl">In-zone point</span><span>85% of reach</span></div>
        <div class="rowline"><span class="lbl">Out-of-zone point</span><span>110% of reach</span></div>
        <div class="rowline"><span class="lbl">Warn above</span><span>100 V on the faulted phase</span></div>
      </div>
    </div>`;

  return page('Ender — System settings', 'system', body);
}

module.exports = function render(ctx) {
  ctx.write('09-config.html', systemScreen(ctx.page, ctx.tip, ctx.LABELS));
};
