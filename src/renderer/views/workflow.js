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

  // Shared with the PDF exporter: see the note on the script tag in index.html.
  const Plot = window.EnderPlot;

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
        U.numField({ key: 'testCurrent', label: 'Test current', min: 0.1, max: 20, step: 0.05,
          value: op.testCurrent, unit: 'A', decimals: 2 }) +
        U.numField({ key: 'vnom', label: 'Nominal voltage', min: 20, max: 140, step: 0.1,
          value: op.vnom, unit: 'V', decimals: 2 }) +
        U.numField({ key: 'infeed', label: 'Remote infeed', min: 0, max: 3, step: 0.01,
          value: op.infeed, decimals: 2 }) +
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

      for (const key of ['testCurrent', 'vnom', 'infeed']) {
        U.bindNum(root, key, {
          commit: guard(async (value) => {
            const patch = {};
            patch[key] = value;
            app.setSession(await window.ender.session.setOperator(patch));
            toast('Saved');
          })
        });
      }

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

  /*
   * Painting is all this layer does now. Where the dots and the characteristic
   * actually go is worked out in core/plot.js, which the PDF exporter uses as
   * well, so the plot an engineer approves on screen is the plot that ends up
   * in the signed record.
   */
  const PALETTE = {
    grid: '#222a35', axis: '#4a5566', line100: '#e6e9ef', anchor: '#8b95a5',
    region: '#8b95a5', live: '#d29922',
    good: '#3fb950', bad: '#f85149', mixed: '#d29922',
    zone0: '#4f9dff', zone1: '#a371f7', zone2: '#8b95a5', zone3: '#39c5cf'
  };
  const ink = (role) => PALETTE[role] || role || '#8b95a5';

  function paint(svg, plot) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('width', plot.width);
    svg.setAttribute('height', plot.height);

    for (const it of plot.items) {
      if (it.t === 'line') {
        const a = { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, stroke: ink(it.role), 'stroke-width': it.w };
        if (it.dash) a['stroke-dasharray'] = it.dash.join(' ');
        if (it.fade) a.opacity = 0.55;
        svg.appendChild(el('line', a));
      } else if (it.t === 'circle') {
        const a = { cx: it.cx, cy: it.cy, r: it.r, fill: 'none', stroke: ink(it.role), 'stroke-width': it.w };
        if (it.dash) a['stroke-dasharray'] = it.dash.join(' ');
        if (it.opacity) a.opacity = it.opacity;
        svg.appendChild(el('circle', a));
      } else if (it.t === 'dot') {
        const a = { cx: it.cx, cy: it.cy, r: it.r, fill: ink(it.role) };
        if (it.w) { a.stroke = '#12151a'; a['stroke-width'] = it.w; }
        svg.appendChild(el('circle', a));
      } else if (it.t === 'path') {
        svg.appendChild(el('path', {
          d: 'M ' + it.pts.map((q) => q[0] + ' ' + q[1]).join(' L ') + (it.closed ? ' Z' : ''),
          fill: it.role === 'region' ? 'rgba(139,149,165,0.16)' : 'none',
          stroke: ink(it.role), 'stroke-width': it.w
        }));
      } else if (it.t === 'text') {
        const t = el('text', { x: it.x, y: it.y, fill: ink(it.role), 'font-size': it.size });
        t.textContent = it.s === '-1' ? '−' + '1' : it.s;
        svg.appendChild(t);
      }
    }
  }

  const rxModel = (line) => ({ zones: line.zones, z1mag: abs(line.z1), z1ang: arg(line.z1) });

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
        '<div>' +
        '<div class="card" style="margin:0"><h3>R–X plane</h3>' +
        '<p class="sub">Mho characteristic, local end</p>' +
        '<svg id="rx" width="392" height="440"></svg>' +
        '<div class="legend"><span><i style="background:#4f9dff"></i>Zone 1</span>' +
        '<span><i style="background:#a371f7"></i>Zone 2</span>' +
        '<span><i style="background:#8b95a5"></i>Zone 3</span>' +
        '<span><i style="background:#3fb950"></i>In zone</span>' +
        '<span><i style="background:#f85149"></i>Out of zone</span></div></div>' +

        '<div class="card" style="margin:14px 0 0"><h3>Generated test points</h3>' +
        '<p class="sub">Every row from the table, plotted where the relay sees it and labelled ' +
        'with the number the report uses. Moves with the sliders. Loops that measure the same ' +
        'impedance share a dot — where the ground and phase reaches are equal, that is all six ' +
        'of them — so a label like <b>T01, T03, T05 +4</b> means seven rows on one spot.</p>' +
        '<svg id="rx2" width="392" height="440"></svg>' +
        '<div class="legend"><span><i style="background:#3fb950"></i>Expected OPERATE</span>' +
        '<span><i style="background:#f85149"></i>Expected RESTRAIN</span>' +
        '<span><i style="background:#d29922"></i>Both on one spot</span>' +
        '<span style="color:var(--dim)">labels are report numbers</span></div></div>' +
        '</div>' +
        '<div><div class="card"><h3>Test point placement</h3>' +
        '<p class="sub">Defaults follow common practice: 85% in, 110% out.</p>' +
        U.numField({
          key: 'inZonePct', min: 40, max: 99.5, step: 0.5, value: op.inZonePct,
          unit: '%', decimals: 1,
          label: tip('In zone', 'In-zone test point',
            'A fault inside the reach, where the element must operate. 85% leaves margin for CT and VT error so a healthy relay still passes.',
            'Z = reach × 85%')
        }) +
        U.numField({
          key: 'outZonePct', min: 100.5, max: 180, step: 0.5, value: op.outZonePct,
          unit: '%', decimals: 1,
          label: tip('Out of zone', 'Out-of-zone test point',
            'A fault just past the reach, where the element must stay put. This is the security half of the test — it catches a zone set too long.',
            'Z = reach × 110%')
        }) + '</div>' +

        '<div class="card"><h3>Zone direction</h3>' +
        '<p class="sub">Taken from the relay where it says so. A reverse zone looks behind the ' +
        'terminal, so its test points go on the other side of the origin and are always external ' +
        'to the differential. Override any of them if site says otherwise.</p>' +
        s.line.zones.map((z) => {
          const seg = (key, label) =>
            '<span class="' + (z.direction === key ? 'on' : '') + '" data-dir="' + z.n + ':' + key + '">' +
            label + '</span>';
          const note = {
            setting: 'from ' + esc(z.directionFrom || 'the relay') + ' = ' + esc(z.directionRaw || ''),
            operator: 'set by hand',
            assumed: 'assumed — no setting found'
          }[z.directionSource];
          return '<div class="rowline"><span class="lbl">' + esc(z.name) +
            ' <span style="color:var(--dim)">' + n(z.reach, 2) + ' ' + OHM + '</span></span>' +
            '<span style="display:flex;align-items:center;gap:10px">' +
            '<span style="color:var(--dim);font-size:11px">' + note + '</span>' +
            '<span class="seg">' + seg('forward', 'Forward') + seg('reverse', 'Reverse') +
            seg('off', 'Off') + '</span></span></div>';
        }).join('') +
        (s.line.zones.some((z) => z.directionSource === 'assumed')
          ? '<p class="why">Zones with no direction setting are assumed forward. On this relay ' +
            'family only some zones carry one, so that assumption is stated in the record rather ' +
            'than hidden.</p>'
          : '') +
        '</div>' +

        '<div class="card"><h3>Resulting test points</h3>' +
        '<p class="sub" id="tpsub">Every point the report will contain, with the same numbering, ' +
        'so a row here is the row you will see there.</p>' +
        '<table id="tp"><tr><td class="spin">Building…</td></tr></table></div></div></div>';
    },

    mount(root, st, app) {
      const line = st.session.line;
      const svg = root.querySelector('#rx');
      const svg2 = root.querySelector('#rx2');
      const table = root.querySelector('#tp');
      const read = (k) => Number(root.querySelector('[data-num="' + k + '"] [data-numrange]').value);

      /*
       * The table lists the real test points, with the identifiers the report
       * uses, because the whole point is being able to match a row here to a
       * row there while experimenting.
       *
       * Locked rows are shown as they are rather than as the sliders would
       * make them: they will not move, and previewing them as if they would
       * is exactly the confusion this is meant to remove.
       */
      let rows = null;
      const model = rxModel(line);

      function redraw() {
        const inP = read('inZonePct');
        const outP = read('outZonePct');
        paint(svg, Plot.rx(model, { inPct: inP, outPct: outP }));
        if (!rows) { paint(svg2, Plot.rx(model, { chrome: false })); return; }

        const live = [];
        let moved = 0;
        for (const r of rows) {
          if (r.locked) { live.push(r); continue; }
          const pct = r.pointKey === 'in' ? inP : outP;
          const mag = r.reach * pct / 100;
          if (pct !== r.pctOfReach) moved += 1;
          live.push(Object.assign({}, r, {
            pctOfReach: pct,
            zMag: mag,
            linePct: (mag / abs(line.z1)) * 100
          }));
        }

        /*
         * The second plot carries the same rows as the table, so a dot and a
         * row are the same test. Locked rows are plotted where they actually
         * stand, which makes a locked point visibly hold still while the
         * sliders move everything else.
         *
         * The expected verdict is taken from the generated row and is not
         * recomputed here. It cannot go stale: the in-zone slider stops at
         * 99.5% and the out-of-zone one starts at 100.5%, so no amount of
         * dragging moves a point across its own zone boundary. Generating
         * the report is what re-derives these.
         */
        paint(svg2, Plot.rx(model, { chrome: false, points: Plot.distancePoints(live) }));

        const lockedCount = rows.filter((r) => r.locked).length;
        root.querySelector('#tpsub').innerHTML =
          'Every point the report will contain, with the same numbering, so a row here is the row ' +
          'you will see there.' +
          (lockedCount
            ? ' <b>' + lockedCount + ' locked</b> — shown as they stand, and the sliders do not move them.'
            : '') +
          (moved ? ' <span style="color:var(--warn)">' + moved + ' points differ from the last generated report.</span>' : '');

        let html = '<tr><th>#</th><th>Zone</th><th>Dir</th><th>Fault</th><th>Point</th>' +
          '<th>% reach</th><th>Z loop</th><th>% of line</th><th>87L</th><th>21 expected</th></tr>';
        for (const r of live) {
          html += '<tr' + (r.locked ? ' class="locked"' : '') + '>' +
            '<td class="num">' + esc(r.id) + (r.locked ? ' <span class="lockbtn on" style="width:14px;height:14px;font-size:8px">■</span>' : '') + '</td>' +
            '<td>' + esc(r.zone) + '</td>' +
            '<td>' + tag(r.reverse ? 'rev' : 'fwd', r.reverse ? 't-ex' : 't-in') + '</td>' +
            '<td>' + esc(r.typeLabel) + '</td>' +
            '<td>' + esc(r.point) + '</td>' +
            '<td class="num">' + r.pctOfReach + '%</td>' +
            '<td class="num">' + n(r.zMag, 2) + ' ' + OHM + (r.reverse ? ' ∠+180°' : '') + '</td>' +
            '<td class="num">' + n(r.linePct, 0) + '%' + (r.reverse ? ' behind' : '') + '</td>' +
            '<td>' + tag(r.onLine ? 'internal' : 'external', r.onLine ? 't-in' : 't-ex') + '</td>' +
            '<td>' + tag(r.expect21, r.expect21 === 'OPERATE' ? 't-op' : 't-re') + '</td></tr>';
        }
        table.innerHTML = html;
      }

      window.ender.plan.build().then((plan) => {
        rows = plan.distance.map((r) => ({
          id: r.id,
          zone: r.zone,
          typeLabel: r.typeLabel,
          point: r.point,
          pointKey: r.pointKey,
          pctOfReach: r.pctOfReach,
          reach: r.reach,
          reverse: r.reverse,
          onLine: r.onLine,
          expect21: r.expect21,
          locked: r.locked,
          zMag: Math.hypot(r.zLoop.re, r.zLoop.im),
          linePct: r.linePct
        }));
        redraw();
      }).catch((err) => {
        table.innerHTML = '<tr><td class="err">' + esc(err.message) + '</td></tr>';
      });

      on(root, '[data-dir]', 'click', guard(async (e, b) => {
        const [zoneNo, value] = b.dataset.dir.split(':');
        const next = Object.assign({}, st.session.operator.zoneDirections || {});
        next[zoneNo] = value;
        app.setSession(await window.ender.session.setOperator({ zoneDirections: next }));
        toast('Zone ' + zoneNo + ' set to ' + value);
      }));

      for (const key of ['inZonePct', 'outZonePct']) {
        U.bindNum(root, key, {
          preview: redraw,
          commit: guard(async (value) => {
            const patch = {};
            patch[key] = value;
            app.setSession(await window.ender.session.setOperator(patch), true);
            toast('Saved');
          })
        });
      }

      redraw();
    }
  };

  /* -------------------------------------------------- 4. differential --- */

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
        '<div>' +
        '<div class="card" style="margin:0"><h3>Alpha plane — I<sub>R</sub> / I<sub>L</sub></h3>' +
        '<p class="sub">Restraint region from ' + esc(d.rFrom || '87LR') + ' = ' + n(d.r, 2) +
        ' and ' + esc(d.angFrom || '87LANG') + ' = ' + n(d.ang, 1) + '°</p>' +
        '<svg id="ap" width="420" height="420"></svg>' +
        '<div class="legend"><span><i style="background:#8b95a5"></i>Restraint region</span>' +
        '<span><i style="background:#d29922"></i>Live point</span></div></div>' +

        '<div class="card" style="margin:14px 0 0"><h3>Generated checks on the plane</h3>' +
        '<p class="sub">Every check from the table below, plotted against the characteristic. ' +
        'The region follows the sliders as you move them; the points themselves move when the ' +
        'change is applied, since they are derived from the settings.</p>' +
        '<svg id="ap2" width="420" height="420"></svg>' +
        '<div class="legend"><span><i style="background:#8b95a5"></i>Restraint region</span>' +
        '<span><i style="background:#3fb950"></i>Expected OPERATE</span>' +
        '<span><i style="background:#f85149"></i>Expected RESTRAIN</span>' +
        '<span><i style="background:#d29922"></i>Both on one spot</span>' +
        '<span style="color:var(--dim)">labels are the check numbers</span></div>' +
        '<p class="why">The pickup pair lands on one dot: both checks use the same ratio and ' +
        'differ only in how much current is flowing, which the plane does not show. That dot is ' +
        'amber because one of the two operates and the other does not.</p></div>' +
        '</div>' +
        '<div><div class="card"><h3>Characteristic' +
        (d.overridden ? ' ' + tag('experimental', 't-ex') : '') + '</h3>' +
        '<p class="sub">Read from the relay. Change them to explore what a different setting would ' +
        'do — nothing is written back to the relay, and the record states when a test point was ' +
        'built on an override.</p>' +
        U.numField({
          key: 'd87r', min: 1.5, max: 12, step: 0.1, value: d.r, decimals: 2,
          label: tip('87LR', 'Restraint radius',
            'The outer radius of the restraint region; the inner radius is its reciprocal. Widening it ' +
            'makes the element more tolerant of current mismatch between the ends.',
            '1/87LR ≤ |I_R/I_L| ≤ 87LR')
        }) +
        U.numField({
          key: 'd87ang', min: 90, max: 220, step: 1, value: d.ang, unit: '°', decimals: 0,
          label: tip('87LANG', 'Restraint angle',
            'The angular extent of the restraint region, centred on 180°. Larger values tolerate ' +
            'more channel asymmetry; smaller values operate faster for internal faults.',
            '|∠ − 180°| ≤ 87LANG/2')
        }) +
        (d.pickup !== null
          ? U.numField({ key: 'd87pickup', label: '87LPP pickup', min: 0.05, max: 20, step: 0.05,
            value: d.pickup, unit: 'A', decimals: 2 })
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
        U.numField({ key: 'ratioMag', label: 'Ratio magnitude', min: 0.05, max: Math.max(12, d.r * 1.5),
          step: 0.01, value: 1, decimals: 2 }) +
        U.numField({ key: 'ratioAng', label: 'Ratio angle', min: 0, max: 359.5, step: 0.5,
          value: 180, unit: '°', decimals: 1 }) +
        '<div style="margin-top:12px;padding:11px 13px;border-radius:7px;background:#151921;border:1px solid var(--line)">' +
        '<span style="color:var(--muted);font-size:12.5px">Element should </span><span id="verdict"></span></div>' +
        '<div id="why" class="why"></div></div>' +
        '<div class="card"><h3>Generated checks</h3>' +
        '<p class="sub">Built from the characteristic above, so they still bracket the boundary ' +
        'when a setting changes. Phase A shown; the report carries all three phases.</p>' +
        '<table id="dchecks"></table></div></div></div>';
    },

    mount(root, st, app) {
      const d = st.session.line.d87;
      if (!d) return;
      const svg = root.querySelector('#ap');
      const svg2 = root.querySelector('#ap2');
      const verdict = root.querySelector('#verdict');
      const why = root.querySelector('#why');

      /*
       * The generated checks, kept so the second plot can be redrawn against
       * a moving characteristic without rebuilding the plan on every frame.
       * Null until the first build returns.
       */
      let checks = null;

      const checkPoints = () => (checks ? Plot.differentialPoints(checks) : null);

      const valueOf = (key, fallback) => {
        const el = root.querySelector('[data-num="' + key + '"] [data-numrange]');
        return el ? Number(el.value) : fallback;
      };

      /* The characteristic the plot should show: whatever the controls say
       * right now, so adjusting previews the change before it is committed. */
      function cur() {
        return { r: valueOf('d87r', d.r), ang: valueOf('d87ang', d.ang) };
      }

      function evaluate(m, a) {
        const c = cur();
        const dev = Math.abs((((a - 180) + 540) % 360) - 180);
        const magOk = m >= 1 / c.r && m <= c.r;
        const angOk = dev <= c.ang / 2;
        return { dev, magOk, angOk, restrain: magOk && angOk, c };
      }

      function redraw() {
        const m = valueOf('ratioMag', 1);
        const a = valueOf('ratioAng', 180);
        const c = cur();
        paint(svg, Plot.alpha(c, { live: { magnitude: m, angle: a } }));
        /*
         * Same characteristic, so dragging 87LR or 87LANG moves the region
         * under the generated points immediately. The points themselves are
         * computed from those settings by the core, so they catch up when the
         * change is committed and the checks are rebuilt.
         */
        paint(svg2, Plot.alpha(c, { chrome: false, points: checkPoints() }));
        const r = evaluate(m, a);
        /*
         * Update the element in place. Assigning outerHTML replaces the node,
         * leaving this reference pointing at a detached one -- the next call
         * then throws, which silently killed everything downstream of the
         * redraw, including committing the change.
         */
        verdict.textContent = r.restrain ? 'RESTRAIN' : 'OPERATE';
        verdict.className = 'tag ' + (r.restrain ? 't-re' : 't-op');
        why.textContent =
          'magnitude ' + n(1 / r.c.r, 3) + ' ≤ ' + n(m, 3) + ' ≤ ' + n(r.c.r, 2) + (r.magOk ? ' ✓' : ' ✗') +
          '   ·   deviation ' + n(r.dev, 2) + '° ≤ ' + n(r.c.ang / 2, 2) + '°' + (r.angOk ? ' ✓' : ' ✗');
      }

      U.bindNum(root, 'ratioMag', { preview: redraw });
      U.bindNum(root, 'ratioAng', { preview: redraw });

      // Characteristic: preview while adjusting, commit on release.
      for (const [key, field] of [['d87r', 'r'], ['d87ang', 'ang'], ['d87pickup', 'pickup']]) {
        U.bindNum(root, key, {
          preview: redraw,
          commit: guard(async (value) => {
            const patch = {};
            patch[field] = value;
            app.setSession(await window.ender.session.setD87Override(patch), true);
            // Recompute the checks against the characteristic just set.
            await refreshChecks();
            toast('87L characteristic changed — checks updated');
          })
        });
      }

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

      /*
       * The generated checks come from the core, so they have to be rebuilt
       * whenever the characteristic changes. Drawing them once at mount left
       * the table showing ratios from the old 87LR the moment anything moved.
       */
      function drawChecks(plan) {
        checks = plan.differential.filter((x) => x.phase === 'A');
        const rows = checks.map((x) =>
          '<tr><td class="num">' + esc(x.id) + '</td><td>' + esc(x.label) + '</td>' +
          '<td class="num">' + n(x.local.magnitude, 2) + ' ∠' + deg2(x.local.angle) + '</td>' +
          '<td class="num">' + n(x.remote.magnitude, 2) + ' ∠' + deg2(x.remote.angle) + '</td>' +
          '<td class="num">' + n(x.ratio.magnitude, 3) + ' ∠' + deg2(x.ratio.angle) + '</td>' +
          '<td class="num" style="color:var(--' +
            (x.result.pickupOk === null ? 'dim' : (x.result.pickupOk ? 'good' : 'bad')) + ')">' +
            (x.result.pickupOk === null ? '—' : n(x.result.current, 2) + ' A') + '</td>' +
          '<td>' + tag(x.result.expect, x.result.expect === 'OPERATE' ? 't-op' : 't-re') +
            (x.result.heldBy === 'pickup' ? ' ' + tag('by pickup', 't-ex') : '') + '</td></tr>').join('');
        root.querySelector('#dchecks').innerHTML =
          '<tr><th>#</th><th>Check</th><th>I<sub>L</sub></th><th>I<sub>R</sub></th><th>Ratio</th>' +
          '<th>' + tip('I<sub>d</sub>', 'Differential current',
            'The vector sum of the two end currents, compared against 87LPP. The element needs ' +
            'this above pickup as well as a ratio outside the restraint region.',
            'Id = |I_L + I_R|') + '</th>' +
          '<th>Expected</th></tr>' + rows;

        // The point set just changed, so the plot showing it has to follow.
        redraw();
      }

      async function refreshChecks() {
        try {
          drawChecks(await window.ender.plan.build());
        } catch (err) {
          toast(err.message || String(err), true);
        }
      }

      refreshChecks();
    }
  };
}());
