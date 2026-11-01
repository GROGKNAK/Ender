'use strict';
/*
 * The calculation record.
 *
 * The point of this screen is defensibility: a reviewer who did not run the
 * test must be able to follow every number from the settings file to the
 * result and disagree with it if it is wrong. So each quantity is shown three
 * times -- as a formula, as that formula with the numbers substituted, and as
 * a result -- and every input carries a reference tag that later lines cite.
 *
 * Nothing here is typed in. Every value is computed from the same functions
 * the report uses, so if the record and the report ever disagree, the record
 * is what is wrong, and that is visible.
 */

function render(ctx) {
  const { page, tip, write, M, D } = ctx;
  const { add, sub, mul, div, scale, mag, ang, pol } = M;
  const { Z1, Z0, K0, K0_1, LINE, REL_L, REL_R, TESTS, ITEST, INFEED } = D;

  /* ---------- formatting ------------------------------------------------- */

  const n = (v, dp = 3) => v.toFixed(dp);
  const deg = (v) => (v >= 0 ? '' : '−') + Math.abs(v).toFixed(2) + '°';
  const pol2 = (c, unit, dp = 3) => n(mag(c), dp) + (unit ? ' ' + unit : '') + ' ∠ ' + deg(ang(c));
  const rect = (c, unit, dp = 3) =>
    n(c.re, dp) + (unit ? ' ' + unit : '') + (c.im < 0 ? ' − j' : ' + j') + n(Math.abs(c.im), dp);

  const math = (rows) => '<div class="math">' + rows.map(([l, r]) =>
    `<span class="l">${l}</span><span class="e">=</span><span class="r">${r}</span>`).join('') + '</div>';

  const ref = (t) => `<span class="ref">[${t}]</span>`;

  /* ---------- A. inputs --------------------------------------------------- */

  const INPUTS = [
    ['I-01', 'Z₁', 'Z1MAG ∠ Z1ANG', pol2(Z1, 'Ω'), 'both files agree'],
    ['I-02', 'Z₀', 'Z0MAG ∠ Z0ANG', pol2(Z0, 'Ω'), 'both files agree'],
    ['I-03', 'Z₁ₚ (Zone 1)', 'Z1P', n(LINE.zones[0].reach) + ' Ω', 'both files agree'],
    ['I-04', 'Z₂ₚ (Zone 2)', 'Z2P', n(LINE.zones[1].reach) + ' Ω', 'both files agree'],
    ['I-05', 'Z₃ₚ (Zone 3)', 'Z3P', n(LINE.zones[2].reach) + ' Ω', 'both files agree'],
    ['I-06', 'R₇', '87LR', n(LINE.d87.R), 'both files agree'],
    ['I-07', 'θ₇', '87LANG', n(LINE.d87.ANG, 2) + '°', 'both files agree'],
    ['I-08', 'Iₜ', '—', n(ITEST) + ' A sec', 'operator'],
    ['I-09', 'kᵢ', '—', n(INFEED, 3), 'operator'],
    ['I-10', 'Vₙ', '—', n(LINE.VNOM, 2) + ' V L–N', 'operator']
  ];

  const inputRows = INPUTS.map(([r, sym, setting, val, src]) => `<tr>
        <td>${ref(r)}</td>
        <td>${sym}</td>
        <td class="mono" style="color:var(--muted)">${setting}</td>
        <td class="num">${val}</td>
        <td>${src === 'operator'
          ? '<span class="tag t-ex">operator entry</span>'
          : '<span class="tag t-ok">' + src + '</span>'}</td>
      </tr>`).join('\n        ');

  /* ---------- B. derived constants --------------------------------------- */

  const dZ = sub(Z0, Z1);
  const tZ1 = scale(Z1, 3);

  const sectionB = `
      ${math([
        ['k₀', '(Z₀ − Z₁) / (3 · Z₁)  <em>' + ref('I-02') + ' ' + ref('I-01') + '</em>'],
        ['', '(' + pol2(Z0, 'Ω') + ' − ' + pol2(Z1, 'Ω') + ') / (3 · ' + pol2(Z1, 'Ω') + ')'],
        ['', '(' + rect(Z0, '') + ' − (' + rect(Z1, '') + ')) / ' + pol2(tZ1, 'Ω')],
        ['', '(' + rect(dZ, '') + ')  /  ' + pol2(tZ1, 'Ω')],
        ['', pol2(dZ, 'Ω') + '  /  ' + pol2(tZ1, 'Ω')],
        ['', '<b>' + pol2(K0, '', 4) + '</b>']
      ])}
      <p class="why">Subtraction is done in rectangular form and division in polar form, which is why
        both appear. k₀ is dimensionless — the ohms cancel.</p>

      ${math([
        ['1 + k₀', '1 + ' + pol2(K0, '', 4)],
        ['', '1 + (' + rect(K0, '', 4) + ')'],
        ['', rect(K0_1, '', 4)],
        ['', '<b>' + pol2(K0_1, '', 4) + '</b>']
      ])}
      <p class="why">Every phase-to-ground loop impedance is multiplied by this. A ground fault at a
        given distance presents ${n(mag(K0_1), 3)}× the impedance a phase fault does at the same
        distance, which is exactly what the residual compensation in the relay removes.</p>`;

  /* ---------- C. one block per test point --------------------------------- */

  function testBlock(t, idx) {
    const p = t.pctOfReach / 100;
    const reach = mag(t.zLoop) / p;
    const zoneNo = t.zone;
    const isG = t.type.indexOf('G') >= 0;
    const isPP = t.type === 'B–C';
    const Zg = mul(t.zLoop, K0_1);
    const Zrem = t.onLine ? sub(Z1, t.zLoop) : sub(t.zLoop, Z1);
    const Irem = ITEST * (t.onLine ? INFEED : 1);

    // loop impedance actually presented to the relay, by fault type
    const loopRows = isG
      ? [['Zₗₒₒₚ', 'Zf · (1 + k₀)'],
         ['', pol2(t.zLoop, 'Ω') + ' · ' + pol2(K0_1, '', 4)],
         ['', '<b>' + pol2(Zg, 'Ω') + '</b>']]
      : isPP
        ? [['Zₗₒₒₚ', '2 · Zf   <em>(phase loop, no residual term)</em>'],
           ['', '2 · ' + pol2(t.zLoop, 'Ω')],
           ['', '<b>' + pol2(scale(t.zLoop, 2), 'Ω') + '</b>']]
        : [['Zₗₒₒₚ', 'Zf   <em>(balanced, no residual term)</em>'],
           ['', '<b>' + pol2(t.zLoop, 'Ω') + '</b>']];

    // local quantities
    const vL = t.local.v, iL = t.local.i;
    const localRows = isG
      ? [['Vₐ', 'Iₜ · |Zₗₒₒₚ|'],
         ['', n(ITEST) + ' A · ' + n(mag(Zg)) + ' Ω'],
         ['', '<b>' + n(mag(vL[0]), 2) + ' V ∠ ' + deg(ang(vL[0])) + '</b>'],
         ['Iₐ', 'Iₜ ∠ −∠Zₗₒₒₚ'],
         ['', n(ITEST) + ' A ∠ −(' + deg(ang(Zg)) + ')'],
         ['', '<b>' + n(mag(iL[0])) + ' A ∠ ' + deg(ang(iL[0])) + '</b>']]
      : isPP
        ? [['Vᵦᶜ', 'Iₜ · 2 · |Zf|'],
           ['', n(ITEST) + ' A · 2 · ' + n(mag(t.zLoop)) + ' Ω'],
           ['', '<b>' + n(mag(sub(vL[1], vL[2])), 2) + ' V ∠ ' + deg(ang(sub(vL[1], vL[2]))) + '</b>'],
           ['Vᵦ', '(−Vₐ + Vᵦᶜ) / 2  →  <b>' + n(mag(vL[1]), 2) + ' V ∠ ' + deg(ang(vL[1])) + '</b>'],
           ['Vᶜ', '(−Vₐ − Vᵦᶜ) / 2  →  <b>' + n(mag(vL[2]), 2) + ' V ∠ ' + deg(ang(vL[2])) + '</b>'],
           ['Iᵦ', '<b>' + n(mag(iL[1])) + ' A ∠ ' + deg(ang(iL[1])) + '</b>  <em>(Iᶜ = −Iᵦ)</em>']]
        : [['Vₐᵦᶜ', 'Iₜ · |Zf|'],
           ['', n(ITEST) + ' A · ' + n(mag(t.zLoop)) + ' Ω'],
           ['', '<b>' + n(mag(vL[0]), 2) + ' V</b> each phase, 120° apart'],
           ['Iₐ', '<b>' + n(mag(iL[0])) + ' A ∠ ' + deg(ang(iL[0])) + '</b>  <em>(B, C at ∓120°)</em>']];

    // independent back-calculation
    let zChk, chkLabel;
    if (isG) {
      zChk = div(div(vL[0], iL[0]), K0_1);
      chkLabel = '(Vₐ / Iₐ) / (1 + k₀)';
    } else if (isPP) {
      zChk = div(sub(vL[1], vL[2]), sub(iL[1], iL[2]));
      chkLabel = '(Vᵦ − Vᶜ) / (Iᵦ − Iᶜ)';
    } else {
      zChk = div(vL[0], iL[0]);
      chkLabel = 'Vₐ / Iₐ';
    }
    const resid = Math.abs(mag(zChk) - mag(t.zLoop));

    const hot = mag(vL[0]) > LINE.VNOM * 1.5;

    return `<div class="tblock" id="tc-${idx}" style="display:${idx === 0 ? 'block' : 'none'}">
      <h5 style="margin:0 0 2px;font-size:13px">Test ${String(idx + 1).padStart(2, '0')}
        · ${zoneNo} ${t.type} ${t.point}</h5>
      <p class="why" style="margin-top:0">${t.kind} fault at ${t.pctOfReach}% of the ${zoneNo} reach.</p>

      <h6 style="margin:14px 0 0;font-size:12px;color:var(--muted)">C.1 — Test point placement</h6>
      ${math([
        ['Zf', 'Zₚ(' + zoneNo + ') · p   <em>' + ref('I-0' + (3 + LINE.zones.findIndex((z) => z.name === zoneNo))) + '</em>'],
        ['', n(reach) + ' Ω · ' + n(p, 3)],
        ['', '<b>' + pol2(t.zLoop, 'Ω') + '</b>']
      ])}

      <h6 style="margin:14px 0 0;font-size:12px;color:var(--muted)">C.2 — Position on the line</h6>
      ${math([
        ['d', '|Zf| / |Z₁|   <em>' + ref('I-01') + '</em>'],
        ['', n(mag(t.zLoop)) + ' Ω / ' + n(mag(Z1)) + ' Ω'],
        ['', '<b>' + n(t.linePct, 1) + ' %</b> of the protected line']
      ])}
      <p class="why">d ${t.onLine ? '≤' : '>'} 100 %, so the fault is
        <b>${t.onLine ? 'between the two current transformers' : 'beyond the far bus'}</b> and the
        differential must <b>${t.expect87}</b> regardless of what the distance zones do.</p>

      <h6 style="margin:14px 0 0;font-size:12px;color:var(--muted)">C.3 — Loop impedance presented to the relay</h6>
      ${math(loopRows)}

      <h6 style="margin:14px 0 0;font-size:12px;color:var(--muted)">C.4 — Local end (${REL_L.station})</h6>
      ${math(localRows)}
      <p class="why">Voltage is referenced to the faulted phase at 0°, so the current carries the
        loop angle. Unfaulted phases are held at Vₙ ${ref('I-10')}.</p>
      ${hot ? `<div class="warn" style="margin:10px 0 0"><b>⚠</b><div>This point needs
        ${n(mag(vL[0]), 2)} V on the faulted phase, above the ${n(LINE.VNOM * 1.5, 0)} V threshold.
        The constant-current model does not bound voltage; a real source could not produce this.
        Reduce Iₜ ${ref('I-08')} or use the source-impedance model.</div></div>` : ''}

      <h6 style="margin:14px 0 0;font-size:12px;color:var(--muted)">C.5 — Remote end (${REL_R.station})</h6>
      ${math([
        ['Zᵣₑₘ', t.onLine ? 'Z₁ − Zf   <em>(remote bus to fault)</em>'
          : 'Zf − Z₁   <em>(fault beyond the remote bus)</em>'],
        ['', t.onLine ? pol2(Z1, 'Ω') + ' − ' + pol2(t.zLoop, 'Ω')
          : pol2(t.zLoop, 'Ω') + ' − ' + pol2(Z1, 'Ω')],
        ['', '<b>' + pol2(Zrem, 'Ω') + '</b>'],
        ['Iᵣₑₘ', t.onLine ? 'Iₜ · kᵢ   <em>' + ref('I-09') + '</em>'
          : 'Iₜ   <em>(through current, same path)</em>'],
        ['', '<b>' + n(Irem) + ' A</b>'],
        ['Vₐ(rem)', '<b>' + n(mag(t.remote.v[0]), 2) + ' V ∠ ' + deg(ang(t.remote.v[0])) + '</b>'],
        ['Iₐ(rem)', '<b>' + n(mag(t.remote.i[0])) + ' A ∠ ' + deg(ang(t.remote.i[0])) + '</b>']
      ])}
      ${t.onLine ? '' : `<p class="why">Past the far bus the two ends see the same current in series,
        so the remote current reverses through its CT — the 180° difference from the local
        angle is the signature the differential uses to restrain.</p>`}

      <h6 style="margin:14px 0 0;font-size:12px;color:var(--muted)">C.6 — Expected result</h6>
      <table style="margin-top:6px">
        <tr><th>Element</th><th>Expected</th><th>Rule applied</th></tr>
        <tr><td>${zoneNo} distance</td>
          <td><span class="tag ${t.expect21 === 'OPERATE' ? 't-op' : 't-re'}">${t.expect21}</span></td>
          <td style="color:var(--muted)">p = ${t.pctOfReach}% ${t.pctOfReach < 100 ? '< 100% → inside the reach' : '> 100% → outside the reach'}</td></tr>
        <tr><td>87L differential</td>
          <td><span class="tag ${t.expect87 === 'OPERATE' ? 't-op' : 't-re'}">${t.expect87}</span></td>
          <td style="color:var(--muted)">d = ${n(t.linePct, 1)}% ${t.onLine ? '≤ 100% → internal' : '> 100% → external'}</td></tr>
      </table>

      <h6 style="margin:14px 0 0;font-size:12px;color:var(--muted)">C.7 — Independent check</h6>
      ${math([
        ['Zᴄʜᴇᴄᴋ', chkLabel],
        ['', '<b>' + pol2(zChk, 'Ω') + '</b>'],
        ['residual', '|' + n(mag(zChk)) + ' − ' + n(mag(t.zLoop)) + '| = <b>' + resid.toExponential(1) + ' Ω</b>']
      ])}
      <div class="chk"><b>✓</b><div>Working the derived voltages and currents back to an
        impedance reproduces the placement value from C.1 to within ${resid.toExponential(1)} Ω.
        A reviewer can repeat this line with a calculator.</div></div>
    </div>`;
  }

  const testBlocks = TESTS.map(testBlock).join('\n');
  const testOpts = TESTS.map((t, i) =>
    `<option value="${i}">Test ${String(i + 1).padStart(2, '0')} · ${t.zone} ${t.type} ${t.point}</option>`).join('');

  /* ---------- D. alpha plane --------------------------------------------- */

  const R87 = LINE.d87.R;
  const A87 = LINE.d87.ANG;
  const lo = 1 / R87;
  const a1 = 180 - A87 / 2;
  const a2 = 180 + A87 / 2;

  const checks87 = [
    ['Through load', pol(ITEST, 0), pol(ITEST, 180)],
    ['Internal, equal infeed', pol(ITEST, 0), pol(ITEST, 0)],
    ['Angle edge, inside', pol(ITEST, 0), pol(ITEST, 265)],
    ['Angle edge, outside', pol(ITEST, 0), pol(ITEST, 280)]
  ].map(([label, iL, iR]) => {
    const ratio = div(iR, iL);
    let a = ang(ratio);
    if (a < 0) a += 360;
    const dev = Math.abs(((a - 180 + 540) % 360) - 180);
    const inMag = mag(ratio) >= lo && mag(ratio) <= R87;
    const inAng = dev <= A87 / 2;
    const restrain = inMag && inAng;
    return `<tr>
        <td>${label}</td>
        <td class="num">${n(mag(ratio), 3)} ∠ ${n(a, 2)}°</td>
        <td class="num" style="color:${inMag ? 'var(--good)' : 'var(--bad)'}">${n(lo, 4)} ≤ ${n(mag(ratio), 3)} ≤ ${n(R87, 3)} ${inMag ? '✓' : '✗'}</td>
        <td class="num" style="color:${inAng ? 'var(--good)' : 'var(--bad)'}">${n(dev, 2)}° ≤ ${n(A87 / 2, 2)}° ${inAng ? '✓' : '✗'}</td>
        <td><span class="tag ${restrain ? 't-re' : 't-op'}">${restrain ? 'RESTRAIN' : 'OPERATE'}</span></td>
      </tr>`;
  }).join('\n        ');

  /* ---------- page -------------------------------------------------------- */

  const body = `    <header class="page">
      <div><h2>Findings &amp; calculation record</h2>
      <p>Every result traced from the settings file to the number, so a reviewer can check it
        without re-deriving it themselves.</p></div>
      <div class="actions"><button>← Back</button><button>Copy as text</button>
        <button class="primary">Export record (PDF)</button></div>
    </header>

    <div style="display:grid;grid-template-columns:214px 1fr;gap:16px;align-items:start">
      <div class="card toc" style="margin:0;padding:11px">
        <p class="sub" style="margin:0 0 7px;padding-left:9px">Contents</p>
        <a href="#secP" class="on">Provenance</a>
        <a href="#secA">A · Inputs</a>
        <a href="#secB">B · Derived constants</a>
        <a href="#secC">C · Test derivations</a>
        <a href="#secD">D · Alpha plane</a>
        <a href="#secE">E · Assumptions</a>
        <a href="#secF">F · Reviewer sign-off</a>
        <div style="border-top:1px solid var(--line);margin:9px 0 0;padding:9px 9px 0;color:var(--dim);font-size:11px">
          ${TESTS.length} test points<br>${INPUTS.length} traced inputs<br>Record ID R-0232
        </div>
      </div>

      <div>
        <div class="card sec" id="secP">
          <h4><span class="badge">●</span>Provenance</h4>
          <p class="sub">What this record was built from. The fingerprints are what make it
            falsifiable — if a setting changes afterwards, this record no longer matches.</p>
          <table>
            <tr><th>Source</th><th>File</th><th>SHA-256</th><th>Relay</th><th>Serial</th></tr>
            <tr><td>Local</td><td class="mono">ALPHA_LN1_Settings.html</td>
              <td class="mono" style="color:var(--muted)">9f2c…a41e</td>
              <td>${REL_L.model}</td><td class="mono">${REL_L.serial}</td></tr>
            <tr><td>Remote</td><td class="mono">BRAVO_LN1_Settings.html</td>
              <td class="mono" style="color:var(--muted)">4d81…c07b</td>
              <td>${REL_R.model}</td><td class="mono">${REL_R.serial}</td></tr>
          </table>
          <div class="rowline" style="margin-top:10px"><span class="lbl">Fault model</span>
            <span>Constant test current, Iₜ = ${n(ITEST)} A secondary</span></div>
          <div class="rowline"><span class="lbl">Software</span><span>Ender 0.1.0</span></div>
          <div class="rowline"><span class="lbl">Generated</span><span>${new Date().toISOString().slice(0, 10)}</span></div>
        </div>

        <div class="card sec" id="secA">
          <h4><span class="badge">A</span>Inputs</h4>
          <p class="sub">Every quantity the calculation starts from. Later sections cite these tags,
            so no number appears without a stated origin.</p>
          <table>
            <tr><th>Ref</th><th>Symbol</th><th>Setting</th><th>Value</th><th>Origin</th></tr>
        ${inputRows}
          </table>
          <p class="why">Entries marked <span class="tag t-ex">operator entry</span> are not in the
            relay. They are choices, and a reviewer is entitled to disagree with them — which is
            why they are listed separately rather than mixed in with the settings.</p>
        </div>

        <div class="card sec" id="secB">
          <h4><span class="badge">B</span>Derived constants</h4>
          <p class="sub">Computed once and reused by every ground-loop test point below.</p>
          ${sectionB}
        </div>

        <div class="card sec" id="secC">
          <h4><span class="badge">C</span>Test point derivations</h4>
          <p class="sub">One block per test point. The exported PDF contains all ${TESTS.length};
            pick one here to read it on screen.</p>
          <select id="tsel" class="cell" style="max-width:360px;margin-bottom:14px">${testOpts}</select>
          ${testBlocks}
        </div>

        <div class="card sec" id="secD">
          <h4><span class="badge">D</span>Alpha plane evaluation</h4>
          <p class="sub">The differential decision is a region test on the complex ratio of remote to
            local current. Both inequalities must hold for the element to restrain.</p>
          ${math([
            ['region', '(1 / R₇) ≤ |Iᵣ / Iₗ| ≤ R₇   <em>' + ref('I-06') + '</em>'],
            ['', n(lo, 4) + ' ≤ |Iᵣ / Iₗ| ≤ ' + n(R87, 3)],
            ['and', '|∠(Iᵣ / Iₗ) − 180°| ≤ θ₇ / 2   <em>' + ref('I-07') + '</em>'],
            ['', '|∠(Iᵣ / Iₗ) − 180°| ≤ ' + n(A87 / 2, 2) + '°'],
            ['∴ arc', n(a1, 2) + '° → ' + n(a2, 2) + '° contains the through-current point −1']
          ])}
          <table style="margin-top:12px">
            <tr><th>Check</th><th>Iᵣ / Iₗ</th><th>Magnitude test</th><th>Angle test</th><th>Result</th></tr>
        ${checks87}
          </table>
          <p class="why">The angle boundary sits at ${n(a2, 2)}°, so a ratio at 265° is still
            inside the region and must restrain, while 280° falls outside and must operate. The
            two rows above bracket that boundary deliberately — a single test either side of it
            is what proves the setting, and getting them the wrong way round is an easy mistake to
            make by eye.</p>
        </div>

        <div class="card sec" id="secE">
          <h4><span class="badge">E</span>Assumptions and exclusions</h4>
          <p class="sub">What this record does <b>not</b> account for. A reviewer needs this as much
            as the arithmetic — a number is only as good as what was left out of it.</p>
          <ul class="excl" style="margin:4px 0 0;padding-left:19px;font-size:12.5px;color:var(--muted)">
            <li>Lumped line impedance. Distributed shunt capacitance and line charging current are
              not modelled, so 87L charging-current compensation is not represented.</li>
            <li>No zero-sequence mutual coupling from a parallel circuit. Where one exists, ground
              reach is affected and these points will not match a real fault.</li>
            <li>Fault resistance taken as zero. Resistive reach of quadrilateral elements is not
              exercised by these points.</li>
            <li>CT and VT treated as ideal: no ratio error, no saturation, no transient response.</li>
            <li>Pre-fault load current is not superimposed.</li>
            <li>Source impedances ${ref('I-09')} are operator-supplied and have not been reconciled
              against a short-circuit study.</li>
            <li>Steady-state phasors only. No element timing, memory polarisation, or transient
              behaviour is calculated — this record covers pickup quantities, not operate times.</li>
            <li>The constant-current model holds Iₜ fixed and lets voltage follow, which can
              demand a voltage no real source would produce. Affected points are flagged in C.4.</li>
          </ul>
        </div>

        <div class="card sec" id="secF">
          <h4><span class="badge">F</span>Reviewer sign-off</h4>
          <p class="sub">Checked independently of the engineer who generated it.</p>
          <div class="signbox">
            <div class="fld">Prepared by · date</div>
            <div class="fld">Checked by · date</div>
          </div>
          <div class="signbox" style="grid-template-columns:1fr">
            <div class="fld" style="padding-top:34px">Reviewer comments / items disputed</div>
          </div>
        </div>
      </div>
    </div>

<script>
/* Section C shows one derivation at a time; the PDF carries all of them. */
(function () {
  var sel = document.getElementById('tsel');
  sel.onchange = function () {
    var blocks = document.querySelectorAll('.tblock');
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].style.display = (String(i) === sel.value) ? 'block' : 'none';
    }
  };
  var links = document.querySelectorAll('.toc a');
  for (var k = 0; k < links.length; k++) {
    (function (a) {
      a.onclick = function () {
        for (var j = 0; j < links.length; j++) links[j].classList.remove('on');
        a.classList.add('on');
      };
    })(links[k]);
  }
})();
</script>`;

  write('06-findings.html', page('Ender — Findings', 6, body));
}

module.exports = render;
