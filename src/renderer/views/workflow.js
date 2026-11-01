'use strict';
/*
 * The four workflow screens that lead up to the report: the settings files,
 * the line and system data derived from them, and the two characteristic
 * screens where test points are placed.
 *
 * Views render from a state object and attach handlers in mount(). They never
 * compute a result -- the plots draw numbers that main already worked out.
 */

window.Views = window.Views || {};

(function () {
  const { esc, n, deg2, abs, arg, polar, OHM, tip, tag, toast, guard, on } = U;
  const NS = 'http://www.w3.org/2000/svg';

  const el = (name, attrs) => {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  /* ------------------------------------------------------ 1. settings --- */

  function endCard(end, data, label) {
    if (!data) {
      return '<div class="drop" data-drop="' + end + '">' +
        '<div class="big">Drop the ' + label + ' end settings here</div>' +
        '<div style="margin-top:12px;display:flex;gap:8px;justify-content:center">' +
        '<button data-pick="' + end + '">Choose file…</button>' +
        '<button data-pickdir="' + end + '">Choose folder…</button></div>' +
        '<div style="margin-top:10px;color:var(--dim);font-size:11.5px">' +
        'acSELerator report (HTML), native export folder or .zip, CSV, JSON or text</div></div>';
    }
    const bad = data.problems.filter((p) => p.level === 'error');
    return '<div class="drop filled" data-drop="' + end + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
        '<span class="endlbl">' + label + ' end</span>' +
        (bad.length ? tag(bad.length + ' problem' + (bad.length > 1 ? 's' : ''), 't-bad') : tag('parsed', 't-ok')) +
      '</div>' +
      '<div class="namewrap"><input class="nameedit" data-name="' + end + '" value="' + esc(data.name) + '"></div>' +
      '<div class="src">default from ' + esc(data.ridFrom || 'file name') + ' · ' +
        '<span class="mono">' + esc(data.rid || data.fileName) + '</span></div>' +
      '<div class="mono" style="color:var(--muted);font-size:11.5px;margin-bottom:11px">' +
        esc(data.fileName) + ' <span style="color:var(--dim)">· ' + U.bytes(data.bytes) +
        ' · ' + data.settingCount + ' settings' +
        (data.fileCount > 1 ? ' from ' + data.fileCount + ' files' : '') +
        (data.sourceKind && data.sourceKind !== 'file' ? ' (' + esc(data.sourceKind) + ')' : '') +
        '</span></div>' +
      '<dl class="kv">' +
        '<dt>Relay model</dt><dd>' + esc(data.model || 'not stated') + '</dd>' +
        '<dt>' + tip('Relay ID', 'RID', 'The relay identifier stored in the settings. Used as the default display name and to recognise a re-import.') + '</dt><dd class="mono">' + esc(data.rid || '—') + '</dd>' +
        '<dt>Terminal ID</dt><dd class="mono">' + esc(data.tid || '—') + '</dd>' +
        '<dt>Serial / FID</dt><dd class="mono" style="font-size:11px">' + esc((data.serial || '—').slice(0, 22)) + '</dd>' +
        '<dt>CT ratio</dt><dd>' + (data.ctr ? data.ctr + ':1' : '—') + '</dd>' +
        '<dt>PT ratio</dt><dd>' + (data.ptr ? data.ptr + ':1' : '—') + '</dd>' +
        '<dt>SHA-256</dt><dd class="mono" style="font-size:11px">' + esc(data.hashShort) + '</dd>' +
        '<dt>' + tip('Read as', 'How this file was understood',
          'The format Ender recognised and the strategy it used. If this says "text" or "pair" for a ' +
          'file you expected to be a report, the layout was not recognised and values may be wrong.') +
        '</dt><dd>' + esc(data.format || '—') + ' / ' + esc(data.layout || '—') + '</dd>' +
        (data.groups && data.groups.length > 1
          ? '<dt>' + tip('Settings group', 'Which group was read',
            'A relay holds several settings groups and only one is active at a time. Values here come ' +
            'from the group named; the others are present in the file but not used.') +
            '</dt><dd>' + esc(data.group) + ' of ' + data.groups.length + '</dd>'
          : '') +
      '</dl>' +
      '<div style="margin-top:10px"><span class="linkbtn" data-raw="' + end + '">' +
        'View all ' + data.settingCount + ' settings</span>' +
        '<span style="color:var(--dim);font-size:11.5px"> · ' + data.usedCount + ' used · ' +
        data.duplicateCount + ' disregarded · ' + data.unusedCount + ' not used</span></div>' +
      '</div>';
  }

  function problemList(st) {
    const rows = [];
    for (const end of ['local', 'remote']) {
      const d = st.session[end];
      if (!d) continue;
      for (const p of d.problems) {
        rows.push('<div class="' + (p.level === 'error' ? 'err' : 'warn') + '"><b>' +
          (p.level === 'error' ? '✕' : '⚠') + '</b><div><b>' +
          esc(d.name) + '</b> — ' + esc(p.message) + '</div></div>');
      }
    }
    return rows.join('');
  }

  function comparisonTable(st) {
    if (!st.session.comparison.length) return '';
    const rows = st.session.comparison.map((r) => {
      const cls = r.status === 'match' ? 't-ok' : (r.status === 'differ' ? 't-bad' : 't-re');
      return '<tr><td>' + esc(r.label) + '</td><td class="mono" style="color:var(--muted)">' + esc(r.setting) + '</td>' +
        '<td class="num">' + (r.local === null ? '—' : n(r.local)) + '</td>' +
        '<td class="num">' + (r.remote === null ? '—' : n(r.remote)) + '</td>' +
        '<td>' + tag(r.status, cls) + '</td></tr>';
    }).join('');
    const differ = st.session.comparison.filter((r) => r.status === 'differ').length;
    return '<div class="card"><h3>Cross-check</h3>' +
      '<p class="sub">' + (differ
        ? '<b style="color:var(--bad)">' + differ + ' setting(s) disagree between the two ends.</b> ' +
          'The relays do not share a view of the line they are both protecting; resolve this before testing.'
        : 'Both files agree on every setting the calculation depends on.') + '</p>' +
      '<table><tr><th>Element</th><th>Setting</th><th>' + esc(st.session.names.local || 'Local') +
      '</th><th>' + esc(st.session.names.remote || 'Remote') + '</th><th>Status</th></tr>' +
      rows + '</table></div>';
  }

  Views.settings = {
    render(st) {
      const s = st.session;
      return '<header class="page"><div><h2>Settings files</h2>' +
        '<p>Drop the settings for each end of the line — an acSELerator report, a native export ' +
        'folder or .zip, CSV, JSON or text. Names default to the relay RID; click one to rename it.</p></div>' +
        '<div class="actions">' +
          '<button data-act="demo">Load demo line</button>' +
          '<button data-act="swap"' + (s.local && s.remote ? '' : ' disabled') + '>⇄ Swap ends</button>' +
          '<button data-act="clear">Clear</button>' +
          '<button class="primary" data-go="system"' + (s.ready ? '' : ' disabled') + '>Continue →</button>' +
        '</div></header>' +
        problemList(st) +
        '<div class="grid2">' + endCard('local', s.local, 'Local') + endCard('remote', s.remote, 'Remote') + '</div>' +
        comparisonTable(st) +
        '<div id="rawbox"></div>';
    },

    mount(root, st, app) {
      on(root, '[data-pick]', 'click', guard(async (e, b) => {
        const res = await window.ender.files.pick(b.dataset.pick);
        if (res) { app.setSession(res); toast('Loaded ' + res[b.dataset.pick].fileName); }
      }));
      on(root, '[data-pickdir]', 'click', guard(async (e, b) => {
        const res = await window.ender.files.pickFolder(b.dataset.pickdir);
        if (res) {
          const d = res[b.dataset.pickdir];
          app.setSession(res);
          toast('Loaded ' + d.fileName + ' (' + d.fileCount + ' files)');
        }
      }));
      on(root, '[data-act="demo"]', 'click', guard(async () => {
        app.setSession(await window.ender.files.loadDemo());
        toast('Demo line loaded — synthetic data, not a real relay');
      }));
      on(root, '[data-act="clear"]', 'click', guard(async () => {
        app.setSession(await window.ender.session.clear());
      }));
      on(root, '[data-act="swap"]', 'click', guard(async () => {
        app.setSession(await window.ender.session.swap());
        toast('Ends swapped');
      }));
      on(root, '.nameedit', 'change', guard(async (e, input) => {
        const res = await window.ender.session.setName(input.dataset.name, input.value);
        app.setSession(res);
        toast('Renamed to ' + res.names[input.dataset.name]);
      }));
      const STATUS = {
        used: ['t-op', 'used'],
        duplicate: ['t-ex', 'disregarded'],
        unused: ['t-re', 'not used']
      };

      function drawCatalogue(end, filter) {
        const data = st.session[end];
        const box = root.querySelector('#rawbox');
        const all = data.catalogue || [];
        const shown = filter === 'all' ? all : all.filter((c) => c.status === filter);

        const rows = shown.map((c) => {
          const [cls, label] = STATUS[c.status] || STATUS.unused;
          const note = c.status === 'used'
            ? esc(c.purpose)
            : (c.others && c.others.length
              ? 'also in ' + c.others.slice(0, 4).map((o) => 'group ' + esc(o.group) + ' = ' + esc(o.value)).join(', ') +
                (c.others.length > 4 ? ', …' : '')
              : '');
          return '<tr><td class="mono">' + esc(c.name) + '</td>' +
            '<td class="mono">' + esc(String(c.value).slice(0, 60)) + '</td>' +
            '<td>' + tag(label, cls) + '</td>' +
            '<td style="color:var(--muted);white-space:normal">' + note + '</td>' +
            '<td style="color:var(--dim)">' + esc(c.from) + '</td></tr>';
        }).join('');

        const seg = (key, text) =>
          '<span class="' + (filter === key ? 'on' : '') + '" data-cat="' + end + ':' + key + '">' + text + '</span>';

        box.innerHTML = '<div class="card"><h3>All settings read — ' + esc(data.name) + '</h3>' +
          '<p class="sub">' +
          '<b>Used</b> means a calculation consumed it, and the column says what for. ' +
          '<b>Disregarded</b> means the same setting carries a different value in another settings ' +
          'group, which was not the one read. <b>Not used</b> means nothing needed it — normal for ' +
          'most of a relay, which carries overcurrent, breaker failure, logic and comms settings this ' +
          'calculation has no use for. The point of the list is that a setting Ender <em>should</em> ' +
          'have used but did not recognise shows up here instead of being silently missing.</p>' +
          '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">' +
          '<div class="seg">' +
          seg('all', 'All ' + all.length) +
          seg('used', 'Used ' + data.usedCount) +
          seg('duplicate', 'Disregarded ' + data.duplicateCount) +
          seg('unused', 'Not used ' + data.unusedCount) +
          '</div><span class="linkbtn" data-closeraw="1">close</span></div>' +
          (rows
            ? '<table><tr><th>Setting</th><th>Value</th><th>Status</th><th>Used for / note</th><th>Source</th></tr>' + rows + '</table>'
            : '<div class="empty">Nothing in this category.</div>') + '</div>';
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      on(root, '[data-raw]', 'click', (e, link) => drawCatalogue(link.dataset.raw, 'all'));
      on(root, '[data-cat]', 'click', (e, b) => {
        const [end, filter] = b.dataset.cat.split(':');
        drawCatalogue(end, filter);
      });
      on(root, '[data-closeraw]', 'click', () => {
        root.querySelector('#rawbox').innerHTML = '';
      });

      // Drag and drop straight onto an end.
      root.querySelectorAll('[data-drop]').forEach((zone) => {
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('over'));
        zone.addEventListener('drop', guard(async (e) => {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.remove('over');
          const file = e.dataTransfer.files[0];
          if (!file) return;
          const filePath = window.ender.files.pathFor(file);
          if (!filePath) {
            toast('Could not read that file’s location — use Choose file instead', true);
            return;
          }
          app.setSession(await window.ender.files.load(zone.dataset.drop, filePath));
          toast('Loaded ' + file.name);
        }));
      });
    }
  };

  /* -------------------------------------------------------- 2. system --- */

  Views.system = {
    render(st) {
      const s = st.session;
      const line = s.line;
      if (!line || line.error) {
        return '<header class="page"><div><h2>Line &amp; system data</h2></div></header>' +
          '<div class="err"><b>✕</b><div>' + esc(line ? line.error : 'Load both settings files first.') + '</div></div>';
      }
      const op = s.operator;
      const models = Object.entries(s.faultModels).map(([k, v]) =>
        '<span class="' + (op.faultModel === k ? 'on' : '') + '" data-model="' + k + '">' + esc(v) + '</span>').join('');

      const zoneRows = line.zones.map((z) =>
        '<tr><td>' + esc(z.name) + '</td><td class="num">' + n(z.reach, 2) + '</td>' +
        '<td class="num">' + n(z.pctOfLine, 0) + '%</td>' +
        '<td class="mono" style="color:var(--muted)">' + esc(z.reachFrom || '—') + '</td>' +
        '<td class="num">' + (z.delay === null ? '—' : n(z.delay, 2) + ' s') + '</td></tr>').join('');

      const src = (which, label) => {
        const v = op[which];
        return '<div class="rowline"><span class="lbl">' + esc(label) + '</span>' +
          '<span style="display:flex;gap:6px">' +
          ['z1mag', 'z1ang', 'z0mag', 'z0ang'].map((f) =>
            '<input class="cell num" style="width:72px;text-align:right" data-src="' + which + '.' + f +
            '" value="' + n(v[f], 2) + '">').join('') + '</span></div>';
      };

      return '<header class="page"><div><h2>Line &amp; system data</h2>' +
        '<p>Derived from the settings files. Source impedances are yours to supply — they are not in the relay.</p></div>' +
        '<div class="actions"><button data-go="settings">← Back</button>' +
        '<button data-act="clearExp">Clear experimental</button>' +
        '<button class="primary" data-go="distance">Continue →</button></div></header>' +

        '<div class="grid2"><div class="card"><h3>Protected line</h3>' +
        '<p class="sub">Read from both relays and cross-checked.</p><dl class="kv">' +
        '<dt>Positive-sequence Z₁</dt><dd>' + polar(line.z1, OHM) + '</dd>' +
        '<dt>Zero-sequence Z₀</dt><dd>' + polar(line.z0, OHM) + '</dd>' +
        '<dt>CT / PT ratio</dt><dd>' + (line.ctr || '—') + ':1 / ' + (line.ptr || '—') + ':1</dd>' +
        '<dt>' + tip('k₀', 'Zero-sequence compensation',
          'Lets a ground loop measure the same distance as a phase loop. ' +
          (line.k0Source === 'derived' ? 'Derived from Z₀ and Z₁ because the relay carries no explicit setting.'
            : 'Read directly from the relay, which is what it will actually apply.'),
          'k₀ = (Z₀ − Z₁) / (3 · Z₁)') + '</dt>' +
        '<dd>' + polar(line.k0, '', 4) + '</dd>' +
        '<dt>1 + k₀</dt><dd>' + polar(line.k0p1, '', 4) + '</dd>' +
        '<dt>k₀ source</dt><dd>' + esc(line.k0Source) + '</dd></dl></div>' +

        '<div class="card"><h3>Fault model</h3>' +
        '<p class="sub">How voltage and current are derived for each test point.</p>' +
        '<div class="ctl"><label>Method</label><div class="seg">' + models + '</div></div>' +
        '<div class="ctl"><label>Test current</label>' +
        '<input type="range" data-op="testCurrent" min="5" max="200" value="' + Math.round(op.testCurrent * 10) + '">' +
        '<span class="val" data-val="testCurrent">' + n(op.testCurrent, 1) + ' A</span></div>' +
        '<div class="ctl"><label>Nominal voltage</label>' +
        '<input type="range" data-op="vnom" min="300" max="1200" value="' + Math.round(op.vnom * 10) + '">' +
        '<span class="val" data-val="vnom">' + n(op.vnom, 1) + ' V</span></div>' +
        '<div class="ctl"><label>Remote infeed</label>' +
        '<input type="range" data-op="infeed" min="0" max="200" value="' + Math.round(op.infeed * 100) + '">' +
        '<span class="val" data-val="infeed">' + n(op.infeed, 2) + '</span></div>' +
        (op.faultModel === 'sourceImpedance'
          ? '<div style="margin-top:12px"><p class="sub" style="margin-bottom:6px">Source impedance ' +
            '(Z1 mag, Z1 ang, Z0 mag, Z0 ang)</p>' +
            src('sourceLocal', esc(s.names.local || 'Local')) +
            src('sourceRemote', esc(s.names.remote || 'Remote')) + '</div>'
          : '<p class="why">The infeed ratio only applies to the bench models. ' +
            'Switch to constant source impedance for a real two-source calculation.</p>') +
        '</div></div>' +

        '<div class="card"><h3>Distance zones</h3>' +
        '<p class="sub">Reaches as a share of the line, so an over- or under-reaching zone is obvious at a glance.</p>' +
        '<table><tr><th>Zone</th><th>Reach (' + OHM + ' sec)</th>' +
        '<th>' + tip('% of line', 'Reach vs the line',
          'The zone reach divided by the total line impedance. Under 100% underreaches the far bus; over 100% reaches past it and must be time-delayed.',
          'reach / Z1MAG × 100') + '</th>' +
        '<th>From setting</th><th>Delay</th></tr>' + zoneRows + '</table></div>';
    },

    mount(root, st, app) {
      on(root, '[data-model]', 'click', guard(async (e, b) => {
        app.setSession(await window.ender.session.setOperator({ faultModel: b.dataset.model }));
        toast(st.session.faultModels[b.dataset.model] + ' selected');
      }));

      const scale = { testCurrent: 10, vnom: 10, infeed: 100 };
      root.querySelectorAll('[data-op]').forEach((slider) => {
        const key = slider.dataset.op;
        const show = root.querySelector('[data-val="' + key + '"]');
        slider.addEventListener('input', () => {
          const v = Number(slider.value) / scale[key];
          show.textContent = key === 'infeed' ? n(v, 2) : n(v, 1) + (key === 'vnom' ? ' V' : ' A');
        });
        slider.addEventListener('change', guard(async () => {
          const patch = {};
          patch[key] = Number(slider.value) / scale[key];
          app.setSession(await window.ender.session.setOperator(patch));
          toast('Saved');
        }));
      });

      on(root, '[data-src]', 'change', guard(async (e, input) => {
        const [which, field] = input.dataset.src.split('.');
        const next = Object.assign({}, st.session.operator[which]);
        next[field] = Number(input.value);
        const patch = {};
        patch[which] = next;
        app.setSession(await window.ender.session.setOperator(patch));
        toast('Source impedance saved');
      }));
    }
  };

  /* ------------------------------------------------------ 3. distance --- */

  function drawRX(svg, line, inPct, outPct) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const zones = line.zones;
    if (!zones.length) return;

    const zang = line.z1ang;

    /*
     * A reverse zone sits below the origin, so the frame has to make room on
     * both sides of it. With only forward zones this is the same picture as
     * before; with a reverse zone the origin moves up to fit it in.
     */
    const fwd = zones.filter((z) => z.direction !== 'reverse').map((z) => z.reach);
    const rev = zones.filter((z) => z.direction === 'reverse').map((z) => z.reach);
    const forwardMax = Math.max(abs(line.z1), ...(fwd.length ? fwd : [0]));
    const reverseMax = rev.length ? Math.max(...rev) : 0;

    const top = forwardMax * 1.25;
    const bottom = Math.max(reverseMax * 1.3, forwardMax * 0.18);
    const half = Math.max(forwardMax, reverseMax) * 1.15;
    const S = Math.min(380 / (half * 2), 430 / (top + bottom));
    const cx = 196;
    const cy = 6 + top * S;
    const px = (r) => cx + r * S;
    const py = (x) => cy - x * S;
    const span = half;

    for (let g = -span; g <= span; g += Math.max(2, Math.round(span / 5))) {
      svg.appendChild(el('line', { x1: px(g), y1: py(top), x2: px(g), y2: py(-bottom), stroke: '#222a35', 'stroke-width': 1 }));
      svg.appendChild(el('line', { x1: px(-span), y1: py(g), x2: px(span), y2: py(g), stroke: '#222a35', 'stroke-width': 1 }));
    }
    svg.appendChild(el('line', { x1: px(-span), y1: py(0), x2: px(span), y2: py(0), stroke: '#4a5566', 'stroke-width': 1.4 }));
    svg.appendChild(el('line', { x1: px(0), y1: py(top), x2: px(0), y2: py(-bottom), stroke: '#4a5566', 'stroke-width': 1.4 }));

    const cols = ['#4f9dff', '#a371f7', '#8b95a5', '#39c5cf'];
    for (let i = zones.length - 1; i >= 0; i -= 1) {
      const z = zones[i];
      const sign = z.direction === 'reverse' ? -1 : 1;
      const rad = z.reach / 2;
      const zx = sign * rad * Math.cos(zang * Math.PI / 180);
      const zy = sign * rad * Math.sin(zang * Math.PI / 180);
      svg.appendChild(el('circle', {
        cx: px(zx), cy: py(zy), r: rad * S, fill: 'none',
        stroke: cols[i % cols.length], 'stroke-width': 1.6, opacity: 0.85,
        'stroke-dasharray': sign < 0 ? '5 3' : ''
      }));
      const lab = el('text', {
        x: px(zx - rad) + 6, y: py(zy) + (sign < 0 ? 13 : -5),
        fill: cols[i % cols.length], 'font-size': 10.5
      });
      lab.textContent = z.name + (sign < 0 ? ' (rev)' : '');
      svg.appendChild(lab);
    }

    const lx = abs(line.z1) * Math.cos(zang * Math.PI / 180);
    const ly = abs(line.z1) * Math.sin(zang * Math.PI / 180);
    svg.appendChild(el('line', {
      x1: px(0), y1: py(0), x2: px(lx), y2: py(ly),
      stroke: '#e6e9ef', 'stroke-width': 1.8, 'stroke-dasharray': '4 3'
    }));
    const lt = el('text', { x: px(lx) + 8, y: py(ly), fill: '#e6e9ef', 'font-size': 10.5 });
    lt.textContent = 'Line 100%';
    svg.appendChild(lt);

    for (const z of zones) {
      const sign = z.direction === 'reverse' ? -1 : 1;
      for (const [pct, colour] of [[inPct, '#3fb950'], [outPct, '#f85149']]) {
        const r = sign * z.reach * pct / 100;
        svg.appendChild(el('circle', {
          cx: px(r * Math.cos(zang * Math.PI / 180)),
          cy: py(r * Math.sin(zang * Math.PI / 180)),
          r: 4.5, fill: colour, stroke: '#12151a', 'stroke-width': 1.5
        }));
      }
    }
  }

  Views.distance = {
    render(st) {
      const s = st.session;
      if (!s.ready) return '<div class="err"><b>✕</b><div>Load both settings files first.</div></div>';
      const op = s.operator;
      return '<header class="page"><div><h2>Distance (21) test points</h2>' +
        '<p>Drag the sliders to move the in-zone and out-of-zone points. The plot is the relay characteristic in secondary ohms.</p></div>' +
        '<div class="actions"><button data-go="system">← Back</button>' +
        '<button data-act="clearExp">Clear experimental</button>' +
        '<button class="primary" data-go="differential">Continue →</button></div></header>' +
        '<div style="display:grid;grid-template-columns:420px 1fr;gap:14px;align-items:start">' +
        '<div class="card" style="margin:0"><h3>R–X plane</h3>' +
        '<p class="sub">Mho characteristic, local end</p>' +
        '<svg id="rx" width="392" height="440"></svg>' +
        '<div class="legend"><span><i style="background:#4f9dff"></i>Zone 1</span>' +
        '<span><i style="background:#a371f7"></i>Zone 2</span>' +
        '<span><i style="background:#8b95a5"></i>Zone 3</span>' +
        '<span><i style="background:#3fb950"></i>In zone</span>' +
        '<span><i style="background:#f85149"></i>Out of zone</span></div></div>' +
        '<div><div class="card"><h3>Test point placement</h3>' +
        '<p class="sub">Defaults follow common practice: 85% in, 110% out.</p>' +
        '<div class="ctl"><label>' + tip('In zone', 'In-zone test point',
          'A fault inside the reach, where the element must operate. 85% leaves margin for CT and VT error so a healthy relay still passes.',
          'Z = reach × 85%') + '</label>' +
        '<input type="range" data-pct="inZonePct" min="40" max="99" value="' + op.inZonePct + '">' +
        '<span class="val" data-val="inZonePct">' + op.inZonePct + '%</span></div>' +
        '<div class="ctl"><label>' + tip('Out of zone', 'Out-of-zone test point',
          'A fault just past the reach, where the element must stay put. This is the security half of the test — it catches a zone set too long.',
          'Z = reach × 110%') + '</label>' +
        '<input type="range" data-pct="outZonePct" min="101" max="180" value="' + op.outZonePct + '">' +
        '<span class="val" data-val="outZonePct">' + op.outZonePct + '%</span></div></div>' +
        '<div class="card"><h3>Resulting test points</h3>' +
        '<p class="sub">Three fault types at each point, every zone.</p>' +
        '<table id="tp"></table></div></div></div>';
    },

    mount(root, st, app) {
      const line = st.session.line;
      const svg = root.querySelector('#rx');
      const table = root.querySelector('#tp');
      const read = (k) => Number(root.querySelector('[data-pct="' + k + '"]').value);

      function redraw() {
        const inP = read('inZonePct');
        const outP = read('outZonePct');
        drawRX(svg, line, inP, outP);
        let html = '<tr><th>Zone</th><th>Point</th><th>% reach</th><th>Z loop</th><th>% of line</th><th>Expected</th></tr>';
        for (const z of line.zones) {
          for (const [pct, label, expect] of [[inP, 'In zone', 'OPERATE'], [outP, 'Out of zone', 'RESTRAIN']]) {
            const zl = z.reach * pct / 100;
            html += '<tr><td>' + esc(z.name) + '</td><td>' + label + '</td><td class="num">' + pct + '%</td>' +
              '<td class="num">' + n(zl, 2) + ' ' + OHM + '</td>' +
              '<td class="num">' + n((zl / abs(line.z1)) * 100, 0) + '%</td>' +
              '<td>' + tag(expect, expect === 'OPERATE' ? 't-op' : 't-re') + '</td></tr>';
          }
        }
        table.innerHTML = html;
      }

      root.querySelectorAll('[data-pct]').forEach((slider) => {
        const key = slider.dataset.pct;
        slider.addEventListener('input', () => {
          root.querySelector('[data-val="' + key + '"]').textContent = slider.value + '%';
          redraw();
        });
        slider.addEventListener('change', guard(async () => {
          const patch = {};
          patch[key] = Number(slider.value);
          app.setSession(await window.ender.session.setOperator(patch), true);
          toast('Saved');
        }));
      });

      redraw();
    }
  };

  /* -------------------------------------------------- 4. differential --- */

  function drawAlpha(svg, r, angle, live) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const dom = Math.max(7, r * 1.2);
    const S = 196 / dom;
    const cx = 210;
    const cy = 210;
    const P = (mag, a) => [cx + mag * Math.cos(a * Math.PI / 180) * S, cy - mag * Math.sin(a * Math.PI / 180) * S];

    const step = Math.max(1, Math.round(dom / 4));
    for (let k = -dom; k <= dom; k += step) {
      svg.appendChild(el('line', { x1: cx + k * S, y1: cy - dom * S, x2: cx + k * S, y2: cy + dom * S, stroke: '#222a35', 'stroke-width': 1 }));
      svg.appendChild(el('line', { x1: cx - dom * S, y1: cy - k * S, x2: cx + dom * S, y2: cy - k * S, stroke: '#222a35', 'stroke-width': 1 }));
    }
    svg.appendChild(el('line', { x1: cx - dom * S, y1: cy, x2: cx + dom * S, y2: cy, stroke: '#4a5566', 'stroke-width': 1.4 }));
    svg.appendChild(el('line', { x1: cx, y1: cy - dom * S, x2: cx, y2: cy + dom * S, stroke: '#4a5566', 'stroke-width': 1.4 }));

    const a1 = 180 - angle / 2;
    const a2 = 180 + angle / 2;
    const big = angle > 180 ? 1 : 0;
    const o1 = P(r, a1);
    const o2 = P(r, a2);
    const i2 = P(1 / r, a2);
    const i1 = P(1 / r, a1);
    svg.appendChild(el('path', {
      d: 'M ' + o1[0] + ' ' + o1[1] +
         ' A ' + r * S + ' ' + r * S + ' 0 ' + big + ' 0 ' + o2[0] + ' ' + o2[1] +
         ' L ' + i2[0] + ' ' + i2[1] +
         ' A ' + (1 / r) * S + ' ' + (1 / r) * S + ' 0 ' + big + ' 1 ' + i1[0] + ' ' + i1[1] + ' Z',
      fill: 'rgba(139,149,165,0.16)', stroke: '#8b95a5', 'stroke-width': 1.5
    }));

    const anchor = P(1, 180);
    svg.appendChild(el('circle', { cx: anchor[0], cy: anchor[1], r: 3, fill: '#8b95a5' }));
    const at = el('text', { x: anchor[0] - 4, y: anchor[1] + 17, fill: '#8b95a5', 'font-size': 10 });
    at.textContent = '−1';
    svg.appendChild(at);

    if (live) {
      const p = P(live.magnitude, live.angle);
      svg.appendChild(el('circle', { cx: p[0], cy: p[1], r: 7, fill: 'none', stroke: '#d29922', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: p[0], cy: p[1], r: 3, fill: '#d29922' }));
    }
    return { P, svg };
  }

  Views.differential = {
    render(st) {
      const s = st.session;
      if (!s.ready) return '<div class="err"><b>✕</b><div>Load both settings files first.</div></div>';
      if (!s.line.d87) {
        return '<header class="page"><div><h2>Differential (87L) test points</h2></div>' +
          '<div class="actions"><button data-go="distance">← Back</button>' +
          '<button class="primary" data-go="report">Continue →</button></div></header>' +
          '<div class="warn"><b>⚠</b><div>Neither settings file carries 87L alpha plane settings ' +
          '(87LR, 87LANG), so no differential tests can be generated. The distance tests are unaffected.</div></div>';
      }
      const d = s.line.d87;
      return '<header class="page"><div><h2>Differential (87L) test points</h2>' +
        '<p>The Alpha Plane: the complex ratio of remote to local current. Inside the shaded region the element restrains.</p></div>' +
        '<div class="actions"><button data-go="distance">← Back</button>' +
        '<button data-act="clearExp">Clear experimental</button>' +
        '<button class="primary" data-go="report">Continue →</button></div></header>' +
        '<div style="display:grid;grid-template-columns:460px 1fr;gap:14px;align-items:start">' +
        '<div class="card" style="margin:0"><h3>Alpha plane — I<sub>R</sub> / I<sub>L</sub></h3>' +
        '<p class="sub">Restraint region from ' + esc(d.rFrom || '87LR') + ' = ' + n(d.r, 2) +
        ' and ' + esc(d.angFrom || '87LANG') + ' = ' + n(d.ang, 1) + '°</p>' +
        '<svg id="ap" width="420" height="420"></svg>' +
        '<div class="legend"><span><i style="background:#8b95a5"></i>Restraint region</span>' +
        '<span><i style="background:#d29922"></i>Live point</span></div></div>' +
        '<div><div class="card"><h3>Characteristic' +
        (d.overridden ? ' ' + tag('experimental', 't-ex') : '') + '</h3>' +
        '<p class="sub">Read from the relay. Change them to explore what a different setting would ' +
        'do — nothing is written back to the relay, and the record states when a test point was ' +
        'built on an override.</p>' +
        '<div class="ctl"><label>' + tip('87LR', 'Restraint radius',
          'The outer radius of the restraint region; the inner radius is its reciprocal. Widening it ' +
          'makes the element more tolerant of current mismatch between the ends.',
          '1/87LR ≤ |I_R/I_L| ≤ 87LR') + '</label>' +
        '<input type="range" data-d87="r" min="20" max="100" value="' + Math.round(d.r * 10) + '">' +
        '<span class="val" data-d87v="r">' + n(d.r, 1) + '</span></div>' +
        '<div class="ctl"><label>' + tip('87LANG', 'Restraint angle',
          'The angular extent of the restraint region, centred on 180°. Larger values tolerate ' +
          'more channel asymmetry; smaller values operate faster for internal faults.',
          '|∠ − 180°| ≤ 87LANG/2') + '</label>' +
        '<input type="range" data-d87="ang" min="90" max="220" value="' + Math.round(d.ang) + '">' +
        '<span class="val" data-d87v="ang">' + n(d.ang, 0) + '°</span></div>' +
        (d.pickup !== null
          ? '<div class="ctl"><label>87LPP pickup</label>' +
            '<input type="range" data-d87="pickup" min="5" max="200" value="' + Math.round(d.pickup * 10) + '">' +
            '<span class="val" data-d87v="pickup">' + n(d.pickup, 2) + ' A</span></div>'
          : '') +
        (d.overridden
          ? '<p class="why">Relay values: 87LR ' + n(d.base.r, 1) + ', 87LANG ' + n(d.base.ang, 0) +
            '°' + (d.base.pickup !== null ? ', 87LPP ' + n(d.base.pickup, 2) + ' A' : '') +
            '. Overridden: ' + d.overridden.join(', ') + '.</p>'
          : '<p class="why">From ' + esc(d.rFrom || '87LR') + ' and ' + esc(d.angFrom || '87LANG') +
            ' in the settings file.</p>') +
        '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button data-act="resetD87"' + (d.overridden ? '' : ' disabled') + '>Reset to relay settings</button>' +
        '<button class="primary" data-act="regen">Generate new test points</button></div></div>' +

        '<div class="card"><h3>Live test point</h3>' +
        '<p class="sub">Where an injected current pair would land. The relay settings themselves are read-only here.</p>' +
        '<div class="ctl"><label>Ratio magnitude</label>' +
        '<input type="range" id="am" min="5" max="' + Math.round(d.r * 140) + '" value="100">' +
        '<span class="val" id="amv">1.00</span></div>' +
        '<div class="ctl"><label>Ratio angle</label>' +
        '<input type="range" id="aa" min="0" max="359" value="180"><span class="val" id="aav">180°</span></div>' +
        '<div style="margin-top:12px;padding:11px 13px;border-radius:7px;background:#151921;border:1px solid var(--line)">' +
        '<span style="color:var(--muted);font-size:12.5px">Element should </span><span id="verdict"></span></div>' +
        '<div id="why" class="why"></div></div>' +
        '<div class="card"><h3>Generated checks</h3>' +
        '<p class="sub">Built from the relay’s own settings so they still bracket the boundary if a setting changes.</p>' +
        '<table id="dchecks"></table></div></div></div>';
    },

    mount(root, st, app) {
      const d = st.session.line.d87;
      if (!d) return;
      const svg = root.querySelector('#ap');
      const mag = root.querySelector('#am');
      const ang = root.querySelector('#aa');
      const verdict = root.querySelector('#verdict');
      const why = root.querySelector('#why');

      /* The characteristic the plot should show: whatever the sliders say
       * right now, so dragging previews the change before it is committed. */
      const scale = { r: 10, ang: 1, pickup: 10 };
      function cur() {
        const read = (key, fallback) => {
          const el = root.querySelector('[data-d87="' + key + '"]');
          return el ? Number(el.value) / scale[key] : fallback;
        };
        return { r: read('r', d.r), ang: read('ang', d.ang) };
      }

      function evaluate(m, a) {
        const c = cur();
        const dev = Math.abs((((a - 180) + 540) % 360) - 180);
        const magOk = m >= 1 / c.r && m <= c.r;
        const angOk = dev <= c.ang / 2;
        return { dev, magOk, angOk, restrain: magOk && angOk, c };
      }

      function redraw() {
        const m = Number(mag.value) / 100;
        const a = Number(ang.value);
        const c = cur();
        root.querySelector('#amv').textContent = n(m, 2);
        root.querySelector('#aav').textContent = a + '°';
        drawAlpha(svg, c.r, c.ang, { magnitude: m, angle: a });
        const r = evaluate(m, a);
        verdict.outerHTML = '<span id="verdict">' + tag(r.restrain ? 'RESTRAIN' : 'OPERATE', r.restrain ? 't-re' : 't-op') + '</span>';
        why.textContent =
          'magnitude ' + n(1 / r.c.r, 3) + ' ≤ ' + n(m, 3) + ' ≤ ' + n(r.c.r, 2) + (r.magOk ? ' ✓' : ' ✗') +
          '   ·   deviation ' + n(r.dev, 2) + '° ≤ ' + n(r.c.ang / 2, 2) + '°' + (r.angOk ? ' ✓' : ' ✗');
      }

      mag.addEventListener('input', redraw);
      ang.addEventListener('input', redraw);

      // Characteristic sliders: preview while dragging, commit on release.
      root.querySelectorAll('[data-d87]').forEach((slider) => {
        const key = slider.dataset.d87;
        slider.addEventListener('input', () => {
          const v = Number(slider.value) / scale[key];
          const label = root.querySelector('[data-d87v="' + key + '"]');
          label.textContent = key === 'ang' ? n(v, 0) + '°' : (key === 'pickup' ? n(v, 2) + ' A' : n(v, 1));
          redraw();
        });
        slider.addEventListener('change', guard(async () => {
          const patch = {};
          patch[key] = Number(slider.value) / scale[key];
          app.setSession(await window.ender.session.setD87Override(patch), true);
          toast('87L override saved — generate to apply it to the test points');
        }));
      });

      on(root, '[data-act="resetD87"]', 'click', guard(async () => {
        app.setSession(await window.ender.session.setD87Override(null));
        toast('Back to the relay settings');
      }));

      on(root, '[data-act="regen"]', 'click', guard(async () => {
        const plan = await window.ender.plan.build();
        toast('Generated ' + plan.counts.distance + ' distance and ' +
          plan.counts.differential + ' differential points' +
          (plan.lockedCount ? ' (' + plan.lockedCount + ' locked, left as they were)' : ''));
        app.go('report');
      }));

      redraw();

      window.ender.plan.build().then((plan) => {
        const rows = plan.differential.filter((x) => x.phase === 'A').map((x) =>
          '<tr><td>' + esc(x.label) + '</td>' +
          '<td class="num">' + n(x.local.magnitude, 2) + ' ∠' + deg2(x.local.angle) + '</td>' +
          '<td class="num">' + n(x.remote.magnitude, 2) + ' ∠' + deg2(x.remote.angle) + '</td>' +
          '<td class="num">' + n(x.ratio.magnitude, 3) + ' ∠' + deg2(x.ratio.angle) + '</td>' +
          '<td>' + tag(x.result.expect, x.result.expect === 'OPERATE' ? 't-op' : 't-re') + '</td></tr>').join('');
        root.querySelector('#dchecks').innerHTML =
          '<tr><th>Check</th><th>I<sub>L</sub></th><th>I<sub>R</sub></th><th>Ratio</th><th>Expected</th></tr>' + rows;
      }).catch((err) => toast(err.message, true));
    }
  };
}());
