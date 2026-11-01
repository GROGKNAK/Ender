'use strict';
/*
 * The report and the calculation record.
 *
 * Both render structures that main already computed. The record in particular
 * is drawn straight from the blocks the core built, so the screen and the PDF
 * cannot show different working for the same number.
 */

window.Views = window.Views || {};

(function () {
  const { esc, n, deg, deg2, abs, arg, polar, OHM, tip, tag, toast, guard, on, hexA } = U;

  const PH = ['A', 'B', 'C'];
  const CLS = ['pa', 'pb', 'pc'];

  function labelFor(labels, code) {
    return labels.find((l) => l.code === code) || null;
  }

  function signoffCell(key, value, labels) {
    const opts = labels.map((l) =>
      '<option' + (l.code === value ? ' selected' : '') + '>' + esc(l.code) + '</option>').join('');
    const chosen = labelFor(labels, value);
    const style = chosen
      ? ' style="color:' + chosen.colour + ';border-color:' + hexA(chosen.colour, 0.45) + '"'
      : '';
    return '<td><select class="sgn" data-sg="' + key + '"' + style + '>' + opts + '</select></td>';
  }

  function endPanel(name, meta, end) {
    const rows = PH.map((p, k) =>
      '<tr><td class="' + CLS[k] + '" style="font-weight:600">' + p + '</td>' +
      '<td class="num">' + n(abs(end.v[k]), 2) + ' V</td>' +
      '<td class="num" style="color:var(--muted)">' + deg(arg(end.v[k])) + '</td>' +
      '<td class="num">' + n(abs(end.i[k]), 3) + ' A</td>' +
      '<td class="num" style="color:var(--muted)">' + deg(arg(end.i[k])) + '</td></tr>').join('');
    return '<div class="card" style="margin:0"><h3>' + esc(name) + '</h3>' +
      '<p class="sub">' + esc(meta) + '</p><table>' +
      '<tr><th>Ph</th><th>Voltage</th>' +
      '<th>' + tip('Angle', 'Voltage reference',
        'Angles are referenced to the faulted phase voltage at 0°. Healthy phases stay at nominal, 120° apart.') + '</th>' +
      '<th>Current</th>' +
      '<th>' + tip('Angle', 'Current angle',
        'Lags its voltage by the loop impedance angle, plus the k0 correction on ground loops. This is the angle you dial into the test set.',
        '∠I = −(∠Z_loop)', true) + '</th></tr>' + rows + '</table></div>';
  }

  Views.report = {
    render(st) {
      if (!st.session.ready) return '<div class="err"><b>✕</b><div>Load both settings files first.</div></div>';
      return '<header class="page"><div><h2>Test report</h2>' +
        '<p id="rsub">Building…</p></div>' +
        '<div class="actions"><button data-go="differential">← Back</button>' +
        '<button data-act="csv">Export CSV</button>' +
        '<button data-act="reportPdf">Export PDF</button>' +
        '<button data-act="save">Save report</button>' +
        '<button class="primary" data-go="findings">Findings →</button></div></header>' +
        '<div id="warnbox"></div>' +
        '<div class="card"><h3>Test matrix</h3>' +
        '<p class="sub">Every fault type at an in-zone and an out-of-zone point, per zone. ' +
        'Select a row to see the injected quantities. The two right-hand columns are sign-off, ' +
        'one per station — edit the choices in System settings.</p>' +
        '<table id="matrix"><tr><td class="spin">Computing…</td></tr></table></div>' +
        '<h3 id="dhead" style="font-size:14px;margin:18px 0 9px"></h3>' +
        '<div class="grid2" id="dcards"></div>';
    },

    async mount(root, st, app) {
      let plan;
      try {
        plan = await window.ender.plan.build();
      } catch (err) {
        root.querySelector('#matrix').innerHTML = '<tr><td class="err">' + esc(err.message) + '</td></tr>';
        return;
      }
      app.plan = plan;
      const s = st.session;
      const labels = st.config.labels;
      const shortL = (s.names.local || 'Local').split(' ')[0];
      const shortR = (s.names.remote || 'Remote').split(' ')[0];

      root.querySelector('#rsub').textContent =
        plan.counts.distance + ' distance points · ' + plan.counts.differential +
        ' differential checks · ' + (s.names.local || 'Local') + ' – ' + (s.names.remote || 'Remote') +
        (plan.lockedCount ? ' · ' + plan.lockedCount + ' locked' : '');

      if (plan.lockedCount) {
        const bar = root.querySelector('.actions');
        const b = document.createElement('button');
        b.dataset.act = 'unlockAll';
        b.textContent = 'Unlock all (' + plan.lockedCount + ')';
        bar.insertBefore(b, bar.firstChild.nextSibling);
      }

      if (plan.counts.voltageWarnings) {
        root.querySelector('#warnbox').innerHTML = '<div class="warn"><b>⚠</b><div><b>' +
          plan.counts.voltageWarnings + ' test point' + (plan.counts.voltageWarnings > 1 ? 's need' : ' needs') +
          ' more than ' + n(s.operator.warnVolts, 0) + ' V on the faulted phase.</b> ' +
          'The bench model does not bound voltage, so it is asking for more than the system could produce. ' +
          'Lower the test current, or switch to the constant source impedance model.</div></div>';
      }

      const head = '<tr><th>' + tip('□', 'Lock a test point',
          'A locked test point keeps the quantities and settings it was computed with. Changing the ' +
          'fault model, a reach percentage or the 87L characteristic no longer moves it, so a line ' +
          'that has been agreed stays put while you experiment with the rest. Unlocking asks first.',
          null, false) + '</th>' +
        '<th>#</th><th>Zone</th><th>Fault</th><th>Type</th><th>% reach</th>' +
        '<th>' + tip('Z loop', 'Loop impedance',
          'What the relay measures for this fault. Ground loops include the (1+k0) term, phase loops do not.',
          'Z = reach × % ∠ Z1ANG') + '</th>' +
        '<th>' + tip('% line', 'Fault position',
          'Position along the real line. Past 100% the fault is beyond the far bus.',
          'Z_loop / Z1MAG × 100') + '</th>' +
        '<th>' + tip('87L view', 'Internal or external',
          'The differential sees any fault between the two CT sets as internal. Past either bus it is through current and must restrain, regardless of what the distance zones do.') + '</th>' +
        '<th>' + tip('21 expected', 'Distance verdict',
          'Whether this zone should operate. In-zone points must trip; out-of-zone points must not.') + '</th>' +
        '<th>' + tip('87L expected', 'Differential verdict',
          'Independent of the distance result. A Zone 2 fault past the far bus is external to 87L, so the two columns disagree on purpose.', null, true) + '</th>' +
        '<th></th>' +
        '<th>' + tip(esc(shortL), 'Local sign-off',
          'What actually happened at this end. The choices come from System settings, so the wording is yours.', null, true) + '</th>' +
        '<th>' + tip(esc(shortR), 'Remote sign-off',
          'The same record for the far end, kept separate because the two ends are often tested by different crews on different days.', null, true) + '</th></tr>';

      const rows = plan.distance.map((r, i) =>
        '<tr class="pick' + (i === 0 ? ' sel' : '') + (r.locked ? ' locked' : '') + '" data-row="' + i + '">' +
        '<td><span class="lockbtn' + (r.locked ? ' on' : '') + '" data-lock="' + esc(r.lockKey) + '" ' +
        'title="' + (r.locked ? 'Locked — click to unlock' : 'Click to lock this test point') + '">' +
        (r.locked ? '■' : '□') + '</span></td>' +
        '<td class="num">' + esc(r.id) + '</td><td>' + esc(r.zone) + '</td><td>' + esc(r.typeLabel) + '</td>' +
        '<td style="color:var(--muted)">' + esc(r.kind) + '</td>' +
        '<td class="num">' + r.pctOfReach + '%</td>' +
        '<td class="num">' + n(abs(r.zLoop), 2) + ' ' + OHM + '</td>' +
        '<td class="num">' + n(r.linePct, 0) + '%</td>' +
        '<td>' + tag(r.onLine ? 'internal' : 'external', r.onLine ? 't-in' : 't-ex') + '</td>' +
        '<td>' + tag(r.expect21, r.expect21 === 'OPERATE' ? 't-op' : 't-re') + '</td>' +
        '<td>' + tag(r.expect87, r.expect87 === 'OPERATE' ? 't-op' : 't-re') + '</td>' +
        '<td>' + (r.voltageWarning ? tag('V high', 't-ex') : '') + '</td>' +
        signoffCell('L' + i, s.signoff['L' + i] || labels[0].code, labels) +
        signoffCell('R' + i, s.signoff['R' + i] || labels[0].code, labels) +
        '</tr>').join('');

      root.querySelector('#matrix').innerHTML = head + rows;

      const dhead = root.querySelector('#dhead');
      const dcards = root.querySelector('#dcards');
      function showDetail(i) {
        const r = plan.distance[i];
        dhead.innerHTML = esc(r.id) + ' · ' + esc(r.zone) + ' ' + esc(r.typeLabel) + ' ' + esc(r.point) +
          ' <span style="color:var(--muted);font-weight:400">— injected quantities, both ends</span>';
        const lm = s.local.model + ' · ' + (s.local.rid || '') + ' · CT ' + (s.local.ctr || '?') + ':1 · PT ' + (s.local.ptr || '?') + ':1';
        const rm = s.remote.model + ' · ' + (s.remote.rid || '') + ' · CT ' + (s.remote.ctr || '?') + ':1 · PT ' + (s.remote.ptr || '?') + ':1';
        dcards.innerHTML =
          endPanel('Local — ' + (s.names.local || ''), lm, r.local) +
          endPanel('Remote — ' + (s.names.remote || ''), rm, r.remote);
        root.querySelectorAll('tr.pick').forEach((tr, k) => tr.classList.toggle('sel', k === i));
      }
      showDetail(0);

      on(root, 'tr.pick', 'click', (e, tr) => {
        if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
        if (e.target.closest('.lockbtn')) return;
        showDetail(Number(tr.dataset.row));
      });

      on(root, '[data-lock]', 'click', guard(async (e, b) => {
        e.stopPropagation();
        const key = b.dataset.lock;
        if (b.classList.contains('on')) {
          const ok = window.confirm(
            'Unlock this test point?\n\n' +
            'It will be recalculated from the settings in force now, and the quantities it was ' +
            'locked with will be lost.'
          );
          if (!ok) return;
          await window.ender.plan.unlock(key);
          toast('Unlocked — recalculated from the current settings');
        } else {
          await window.ender.plan.lock(key);
          toast('Locked — this point no longer follows the other pages');
        }
        app.go('report');
      }));

      on(root, '[data-act="unlockAll"]', 'click', guard(async () => {
        const ok = window.confirm(
          'Unlock all ' + plan.lockedCount + ' locked test points?\n\n' +
          'Every one of them will be recalculated from the settings in force now.'
        );
        if (!ok) return;
        await window.ender.plan.unlockAll();
        toast('All test points unlocked');
        app.go('report');
      }));

      on(root, 'select.sgn', 'change', guard(async (e, sel) => {
        const chosen = labelFor(labels, sel.value);
        sel.style.color = chosen ? chosen.colour : '';
        sel.style.borderColor = chosen ? hexA(chosen.colour, 0.45) : '';
        const res = await window.ender.session.setSignoff(sel.dataset.sg, sel.value);
        st.session.signoff = res.signoff;
        toast('Sign-off saved');
      }));

      on(root, '[data-act="csv"]', 'click', guard(async () => {
        const target = await window.ender.exports.csv();
        if (target) toast('Saved ' + target.split(/[\\/]/).pop());
      }));
      on(root, '[data-act="reportPdf"]', 'click', guard(async () => {
        const target = await window.ender.exports.reportPdf();
        if (target) { toast('Saved ' + target.split(/[\\/]/).pop()); window.ender.shell.reveal(target); }
      }));
      on(root, '[data-act="save"]', 'click', guard(async () => {
        const saved = await window.ender.reports.save({ status: 'Generated' });
        app.setSession(await window.ender.session.get(), true);
        toast('Saved to the archive as ' + saved.id);
      }));
    }
  };

  /* ------------------------------------------------------- 6. findings --- */

  function mathBlock(b) {
    const rows = b.rows.map((r, i) => {
      const text = Array.isArray(r) ? r[0] : r;
      return '<span class="l">' + (i === 0 ? esc(b.symbol) : '') + '</span>' +
        '<span class="e">=</span><span class="r">' + esc(text) + '</span>';
    }).join('');
    return '<div class="math">' + rows + '</div>' +
      (b.note ? '<p class="why">' + esc(b.note) + '</p>' : '');
  }

  Views.findings = {
    render(st) {
      if (!st.session.ready) return '<div class="err"><b>✕</b><div>Load both settings files first.</div></div>';
      return '<header class="page"><div><h2>Findings &amp; calculation record</h2>' +
        '<p>Every result traced from the settings file to the number, so a reviewer can check it ' +
        'without re-deriving it themselves.</p></div>' +
        '<div class="actions"><button data-go="report">← Back</button>' +
        '<button class="primary" data-act="recordPdf">Export record (PDF)</button></div></header>' +
        '<div id="rec"><div class="spin">Building the record…</div></div>';
    },

    async mount(root, st) {
      let rec;
      try {
        rec = await window.ender.record.build();
      } catch (err) {
        root.querySelector('#rec').innerHTML = '<div class="err"><b>✕</b><div>' + esc(err.message) + '</div></div>';
        return;
      }

      const inputs = rec.inputs.rows.map((r) =>
        '<tr><td><span class="mono" style="color:var(--violet);font-size:11px">[' + esc(r.ref) + ']</span></td>' +
        '<td>' + esc(r.symbol) + '</td>' +
        '<td class="mono" style="color:var(--muted)">' + esc(r.setting) + '</td>' +
        '<td class="num">' + esc(r.value) + '</td>' +
        '<td>' + tag(r.origin, r.origin === 'operator' ? 't-ex' : (r.origin === 'FILES DISAGREE' ? 't-bad' : 't-ok')) +
        '</td></tr>').join('');

      const options = rec.tests.map((t, i) =>
        '<option value="' + i + '">' + esc(t.title) + '</option>').join('');

      const blocks = rec.tests.map((t, i) =>
        '<div class="tblock" data-t="' + i + '" style="display:' + (i === 0 ? 'block' : 'none') + '">' +
        '<h5 style="margin:0 0 2px;font-size:13px">' + esc(t.title) + '</h5>' +
        '<p class="why" style="margin-top:0">' + esc(t.subtitle) + '</p>' +
        t.blocks.map(mathBlock).join('') +
        (t.voltageWarning ? '<div class="warn" style="margin-top:10px"><b>⚠</b><div>This point needs ' +
          n(t.voltageWarning, 1) + ' V on the faulted phase. The bench model does not bound voltage; ' +
          'a real source could not produce this.</div></div>' : '') +
        '<div class="chk"><b>✓</b><div>Expected: Zone <b>' + esc(t.expect21) + '</b>, 87L <b>' +
        esc(t.expect87) + '</b>. The self check above reproduces the placement impedance to within ' +
        t.residual.toExponential(1) + ' ' + OHM + '.</div></div></div>').join('');

      const alphaHtml = rec.alpha ? mathBlock(rec.alpha.block) +
        '<table style="margin-top:12px"><tr><th>Check</th><th>Ratio</th><th>Magnitude test</th><th>Angle test</th><th>Result</th></tr>' +
        rec.differential.filter((x) => x.phase === 'A').map((x) =>
          '<tr><td>' + esc(x.label) + '</td>' +
          '<td class="num">' + n(x.ratio.magnitude, 3) + ' ∠' + deg2(x.ratio.angle) + '</td>' +
          '<td class="num" style="color:var(--' + (x.result.magOk ? 'good' : 'bad') + ')">' +
            n(x.result.inner, 4) + ' ≤ ' + n(x.result.magnitude, 3) + ' ≤ ' + n(x.result.outer, 2) +
            (x.result.magOk ? ' ✓' : ' ✗') + '</td>' +
          '<td class="num" style="color:var(--' + (x.result.angOk ? 'good' : 'bad') + ')">' +
            n(x.result.deviation, 2) + '° ≤ ' + n(x.result.halfSpan, 2) + '°' +
            (x.result.angOk ? ' ✓' : ' ✗') + '</td>' +
          '<td>' + tag(x.result.expect, x.result.expect === 'OPERATE' ? 't-op' : 't-re') + '</td></tr>').join('') +
        '</table>' : '<div class="empty">No 87L settings were found, so there is nothing to evaluate.</div>';

      root.querySelector('#rec').innerHTML =
        '<div style="display:grid;grid-template-columns:214px 1fr;gap:16px;align-items:start">' +
        '<div class="card toc" style="margin:0;padding:11px">' +
        '<p class="sub" style="margin:0 0 7px;padding-left:9px">Contents</p>' +
        ['secA:A · Inputs', 'secB:B · Derived constants', 'secC:C · Test derivations',
         'secD:D · Alpha plane', 'secE:E · Assumptions', 'secF:F · Self check']
          .map((x, i) => {
            const [id, label] = x.split(':');
            return '<a data-jump="' + id + '"' + (i === 0 ? ' class="on"' : '') + '>' + label + '</a>';
          }).join('') +
        '<div style="border-top:1px solid var(--line);margin:9px 0 0;padding:9px 9px 0;color:var(--dim);font-size:11px">' +
        rec.tests.length + ' test points<br>' + rec.inputs.rows.length + ' traced inputs</div></div><div>' +

        '<div class="card sec" id="secA"><h4><span class="badge">A</span>Inputs</h4>' +
        '<p class="sub">Every quantity the calculation starts from. Later sections cite these tags, ' +
        'so no number appears without a stated origin.</p>' +
        '<table><tr><th>Ref</th><th>Symbol</th><th>Setting</th><th>Value</th><th>Origin</th></tr>' +
        inputs + '</table>' +
        '<p class="why">Entries marked <span class="tag t-ex">operator</span> are not in the relay. ' +
        'They are choices, and a reviewer is entitled to disagree with them — which is why they are ' +
        'listed separately rather than mixed in with the settings.</p></div>' +

        '<div class="card sec" id="secB"><h4><span class="badge">B</span>Derived constants</h4>' +
        rec.derived.map(mathBlock).join('') + '</div>' +

        '<div class="card sec" id="secC"><h4><span class="badge">C</span>Test point derivations</h4>' +
        '<p class="sub">One block per test point. The exported PDF contains all ' + rec.tests.length +
        '; pick one here to read it on screen.</p>' +
        '<select id="tsel" class="cell" style="max-width:380px;margin-bottom:14px">' + options + '</select>' +
        blocks + '</div>' +

        '<div class="card sec" id="secD"><h4><span class="badge">D</span>Alpha plane evaluation</h4>' +
        alphaHtml + '</div>' +

        '<div class="card sec" id="secE"><h4><span class="badge">E</span>Assumptions and exclusions</h4>' +
        '<p class="sub">What this record does <b>not</b> account for. A reviewer needs this as much as ' +
        'the arithmetic — a number is only as good as what was left out of it.</p>' +
        '<ul style="margin:4px 0 0;padding-left:19px;font-size:12.5px;color:var(--muted)">' +
        rec.assumptions.map((a) => '<li style="margin-bottom:5px">' + esc(a) + '</li>').join('') + '</ul></div>' +

        '<div class="card sec" id="secF"><h4><span class="badge">F</span>Self check</h4>' +
        '<p class="sub">Each test point was worked backwards from its derived voltages and currents to ' +
        'an impedance and compared against the placement value.</p>' +
        '<div class="' + (rec.selfCheck.ok ? 'chk' : 'err') + '"><b>' + (rec.selfCheck.ok ? '✓' : '✕') + '</b><div>' +
        'Largest residual across all ' + rec.tests.length + ' points: <b>' +
        rec.selfCheck.worstResidual.toExponential(2) + ' ' + OHM + '</b>. ' +
        (rec.selfCheck.ok ? 'That is floating-point noise, as expected.'
          : 'This is larger than expected and should be investigated before the record is relied on.') +
        '</div></div></div></div></div>';

      on(root, '#tsel', 'change', (e, sel) => {
        root.querySelectorAll('.tblock').forEach((b) => {
          b.style.display = b.dataset.t === sel.value ? 'block' : 'none';
        });
      });
      on(root, '[data-jump]', 'click', (e, a) => {
        root.querySelectorAll('[data-jump]').forEach((x) => x.classList.remove('on'));
        a.classList.add('on');
        const target = root.querySelector('#' + a.dataset.jump);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      on(root, '[data-act="recordPdf"]', 'click', guard(async () => {
        const target = await window.ender.exports.recordPdf();
        if (target) { toast('Saved ' + target.split(/[\\/]/).pop()); window.ender.shell.reveal(target); }
      }));
    }
  };
}());
