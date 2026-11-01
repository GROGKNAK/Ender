'use strict';
/*
 * Saved reports, appearance, and system settings.
 *
 * These three are configuration rather than workflow: they outlive any one
 * test run and are reachable at any time.
 */

window.Views = window.Views || {};

(function () {
  const { esc, n, tag, toast, guard, on, hexA } = U;

  /* ------------------------------------------------- saved reports ------ */

  const STATUS_CLS = {
    'Signed off': 't-op', 'Results entered': 't-in',
    Generated: 't-re', Superseded: 't-ex'
  };

  Views.reports = {
    render() {
      return '<header class="page"><div><h2>Saved reports</h2>' +
        '<p>Every report Ender has generated on this machine, newest first.</p></div>' +
        '<div class="actions"><button data-act="folder">Open folder</button>' +
        '<button class="primary" data-go="settings">New test run</button></div></header>' +
        '<div class="card"><div style="display:flex;gap:10px;align-items:center;margin-bottom:13px">' +
        '<input class="search" id="q" placeholder="Search by line, relay or report ID…" style="flex:1"></div>' +
        '<div id="list"><div class="spin">Loading…</div></div></div>' +
        '<div class="card"><h3>Storage</h3>' +
        '<p class="sub">Reports are kept as plain JSON files, so they survive an uninstall and can be ' +
        'backed up by copying a folder.</p><div id="usage"></div></div>';
    },

    async mount(root, st, app) {
      const [reports, usage] = await Promise.all([
        window.ender.reports.list(), window.ender.reports.usage()
      ]);

      function draw(filter) {
        const q = String(filter || '').toLowerCase();
        const shown = reports.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
        if (!shown.length) {
          root.querySelector('#list').innerHTML =
            '<div class="empty">' + (reports.length ? 'Nothing matches that search.'
              : 'No reports saved yet. Run a test and choose Save report.') + '</div>';
          return;
        }
        root.querySelector('#list').innerHTML =
          '<table><tr><th>Report</th><th>Saved</th><th>Name</th><th>Relays</th><th>Tests</th>' +
          '<th>Model</th><th>Status</th><th>Size</th><th>Download</th></tr>' +
          shown.map((r) => {
            if (r.broken) {
              return '<tr><td class="mono">' + esc(r.id) + '</td><td colspan="7">' +
                tag('unreadable file', 't-bad') + '</td>' +
                '<td><span class="linkbtn" data-del="' + esc(r.id) + '">Delete</span></td></tr>';
            }
            const relays = [r.relays && r.relays.local && r.relays.local.model,
              r.relays && r.relays.remote && r.relays.remote.model].filter(Boolean).join(' / ') || '—';
            const flags = [
              r.omittedCount ? tag(r.omittedCount + ' omitted', 't-ex') : '',
              r.lockedCount ? tag(r.lockedCount + ' locked', 't-in') : ''
            ].filter(Boolean).join(' ');
            const downloads = r.exportable
              ? '<span class="linkbtn" data-dl="pdf:' + esc(r.id) + '">PDF</span> ' +
                '<span style="color:var(--line2)">·</span> ' +
                '<span class="linkbtn" data-dl="record:' + esc(r.id) + '">Record</span> ' +
                '<span style="color:var(--line2)">·</span> ' +
                '<span class="linkbtn" data-dl="csv:' + esc(r.id) + '">CSV</span>'
              : '<span style="color:var(--dim)" title="Saved before reports became self-contained">not regenerable</span>';
            return '<tr><td class="mono">' + esc(r.id) + '</td>' +
              '<td class="num">' + U.when(r.savedAt) + '</td>' +
              '<td><span class="rename" data-rename="' + esc(r.id) + '" title="Click to rename">' +
                esc(r.title) + '</span></td>' +
              '<td style="color:var(--muted)">' + esc(relays) + '</td>' +
              '<td class="num">' + ((r.counts && r.counts.total) || '—') + '</td>' +
              '<td style="color:var(--muted)">' + esc(r.model || '—') + ' ' + flags + '</td>' +
              '<td>' + tag(r.status || 'Generated', STATUS_CLS[r.status] || 't-re') + '</td>' +
              '<td class="num" style="color:var(--dim)">' + U.bytes(r.size || 0) + '</td>' +
              '<td>' + downloads + ' <span style="color:var(--line2)">·</span> ' +
                '<span class="linkbtn" data-del="' + esc(r.id) + '">Delete</span></td></tr>';
          }).join('') + '</table>';
      }

      draw('');
      root.querySelector('#usage').innerHTML =
        '<div class="rowline"><span class="lbl">Location</span><span class="mono" style="font-size:11.5px">' +
        esc(usage.dir) + '</span></div>' +
        '<div class="rowline"><span class="lbl">Reports stored</span><span>' + usage.count + '</span></div>' +
        '<div class="rowline"><span class="lbl">Disk used</span><span>' + U.bytes(usage.bytes) + '</span></div>' +
        '<div class="rowline"><span class="lbl">Oldest</span><span>' + U.when(usage.oldest) + '</span></div>';

      on(root, '#q', 'input', (e, input) => draw(input.value));
      on(root, '[data-act="folder"]', 'click', guard(() => window.ender.shell.openPath(usage.dir)));
      on(root, '[data-rename]', 'click', guard(async (e, span) => {
        const id = span.dataset.rename;
        const current = reports.find((r) => r.id === id);
        const next = window.prompt('Name for ' + id, (current && current.title) || id);
        if (next === null) return;
        if (!next.trim()) { toast('A report needs a name', true); return; }
        await window.ender.reports.rename(id, next.trim());
        toast('Renamed to ' + next.trim());
        app.go('reports');
      }));

      on(root, '[data-dl]', 'click', guard(async (e, link) => {
        const [kind, id] = link.dataset.dl.split(':');
        const fn = { pdf: 'reportPdf', record: 'recordPdf', csv: 'csv' }[kind];
        const target = await window.ender.exports[fn](id);
        if (target) {
          toast('Saved ' + target.split(/[\\/]/).pop());
          window.ender.shell.reveal(target);
        }
      }));

      on(root, '[data-del]', 'click', guard(async (e, link) => {
        const id = link.dataset.del;
        if (!window.confirm('Delete report ' + id + '? This cannot be undone.')) return;
        await window.ender.reports.remove(id);
        toast('Deleted ' + id);
        app.go('reports');
      }));
    }
  };

  /* ------------------------------------------------------ appearance ---- */

  const THEMES = [
    { key: 'ender-dark', name: 'Ender dark', c: ['#12151a', '#1a1f27', '#4f9dff', '#3fb950'] },
    { key: 'midnight', name: 'Midnight', c: ['#0d1117', '#161b22', '#58a6ff', '#3fb950'] },
    { key: 'slate', name: 'Slate', c: ['#1c2128', '#262c36', '#6cb6ff', '#57ab5a'] },
    { key: 'graphite', name: 'Graphite', c: ['#17191c', '#202326', '#7ee787', '#d29922'] },
    { key: 'contrast', name: 'High contrast', c: ['#000000', '#101010', '#ffd33d', '#00e676'] },
    { key: 'daylight', name: 'Daylight', c: ['#f6f8fa', '#ffffff', '#0969da', '#1a7f37'] }
  ];

  const ROLES = [
    ['bg', 'Background'], ['panel', 'Panel'], ['line', 'Border'],
    ['text', 'Body text'], ['muted', 'Muted text'], ['accent', 'Accent'],
    ['good', 'Operate / pass'], ['warn', 'Warning'], ['bad', 'Fail']
  ];

  const ACCENTS = ['#4f9dff', '#7ee787', '#d29922', '#f85149', '#a371f7', '#39c5cf', '#e6e9ef'];

  Views.appearance = {
    render(st) {
      const t = st.theme;
      const cards = THEMES.map((x) =>
        '<div class="theme' + (t.preset === x.key ? ' on' : '') + '" data-theme="' + x.key + '">' +
        '<div class="bars">' + x.c.map((c) => '<i style="background:' + c + '"></i>').join('') + '</div>' +
        '<div class="nm">' + esc(x.name) + '</div></div>').join('');

      const swatches = ACCENTS.map((c) =>
        '<div class="sw' + (t.accent === c ? ' on' : '') + '" style="background:' + c +
        '" data-accent="' + c + '"></div>').join('');

      const roleRows = ROLES.map(([key, label]) => {
        const value = (t.roles && t.roles[key]) ||
          getComputedStyle(document.documentElement).getPropertyValue('--' + key).trim();
        return '<div class="rowline"><span class="lbl">' + esc(label) + '</span>' +
          '<span style="display:flex;align-items:center;gap:9px">' +
          '<span class="mono" data-rolehex="' + key + '" style="font-size:11.5px;color:var(--muted)">' + esc(value) + '</span>' +
          '<input type="color" class="swatchin" data-role="' + key + '" value="' + esc(value) + '"></span></div>';
      }).join('');

      return '<header class="page"><div><h2>Appearance</h2>' +
        '<p>Saved per machine and applied immediately. Colours are named by meaning, so a change ' +
        'reaches the tables, the plots and the tags together.</p></div>' +
        '<div class="actions"><button data-act="resetTheme">Reset to default</button>' +
        '<button class="primary" data-act="saveTheme">Save</button></div></header>' +
        '<div style="display:grid;grid-template-columns:1fr 400px;gap:14px;align-items:start"><div>' +
        '<div class="card"><h3>Theme</h3><p class="sub">A starting palette. Any colour below can still be overridden.</p>' +
        '<div class="themegrid">' + cards + '</div></div>' +
        '<div class="card"><h3>Accent</h3><p class="sub">Used for selection, focus and the primary button.</p>' +
        '<div class="swatches">' + swatches + '</div></div>' +
        '<div class="card"><h3>Colour roles</h3>' +
        '<p class="sub">Named for what they mean rather than where they appear.</p>' + roleRows + '</div>' +
        '<div class="card"><h3>Text &amp; density</h3>' +
        U.numField({ key: 'textSize', label: 'Base text size', min: 11, max: 20, step: 0.5,
          value: t.textSize || 14, unit: 'px', decimals: 1 }) +
        '<div class="ctl"><label>Row density</label><div class="seg">' +
        ['compact', 'normal', 'roomy'].map((d) =>
          '<span class="' + (t.density === d ? 'on' : '') + '" data-density="' + d + '">' +
          d[0].toUpperCase() + d.slice(1) + '</span>').join('') + '</div></div></div></div>' +
        '<div class="card" style="margin:0"><h3>Preview</h3>' +
        '<p class="sub">Live, using the real components.</p>' +
        '<table><tr><th>#</th><th>Zone</th><th>Fault</th><th>Expected</th></tr>' +
        '<tr class="sel"><td class="num">T01</td><td>Zone 1</td><td>A–G</td><td>' + tag('OPERATE', 't-op') + '</td></tr>' +
        '<tr><td class="num">T02</td><td>Zone 1</td><td>A–G</td><td>' + tag('RESTRAIN', 't-re') + '</td></tr>' +
        '<tr><td class="num">T07</td><td>Zone 2</td><td>B–C</td><td>' + tag('external', 't-ex') + '</td></tr></table>' +
        '<div class="warn" style="margin:13px 0 0"><b>⚠</b><div>Warnings use the warning role.</div></div>' +
        '<div style="display:flex;gap:8px;margin-top:13px"><button>Secondary</button>' +
        '<button class="primary">Primary</button></div></div></div>';
    },

    mount(root, st, app) {
      const apply = (patch) => app.applyTheme(Object.assign({}, st.theme, patch));

      on(root, '[data-theme]', 'click', guard(async (e, card) => {
        const theme = THEMES.find((x) => x.key === card.dataset.theme);
        const roles = Object.assign({}, st.theme.roles, {
          bg: theme.c[0], panel: theme.c[1], accent: theme.c[2], good: theme.c[3]
        });
        st.theme = await window.ender.theme.set({ preset: theme.key, accent: theme.c[2], roles });
        apply({});
        app.go('appearance');
        toast(theme.name + ' applied');
      }));

      on(root, '[data-accent]', 'click', guard(async (e, sw) => {
        st.theme = await window.ender.theme.set({ accent: sw.dataset.accent });
        apply({});
        app.go('appearance');
        toast('Accent saved');
      }));

      on(root, '[data-role]', 'change', guard(async (e, input) => {
        const roles = Object.assign({}, st.theme.roles);
        roles[input.dataset.role] = input.value;
        st.theme = await window.ender.theme.set({ roles });
        const hex = root.querySelector('[data-rolehex="' + input.dataset.role + '"]');
        if (hex) hex.textContent = input.value;
        apply({});
        toast(input.dataset.role + ' colour saved');
      }));

      U.bindNum(root, 'textSize', {
        // Preview on the live document so the size can be judged as it moves.
        preview: (value) => document.documentElement.style.setProperty('--base', value + 'px'),
        commit: guard(async (value) => {
          st.theme = await window.ender.theme.set({ textSize: value });
          apply({});
          toast('Text size saved');
        })
      });

      on(root, '[data-density]', 'click', guard(async (e, b) => {
        st.theme = await window.ender.theme.set({ density: b.dataset.density });
        apply({});
        app.go('appearance');
        toast('Density saved');
      }));

      on(root, '[data-act="saveTheme"]', 'click', guard(async () => {
        st.theme = await window.ender.theme.set({});
        toast('Appearance saved');
      }));

      on(root, '[data-act="resetTheme"]', 'click', guard(async () => {
        st.theme = await window.ender.theme.reset();
        apply({});
        app.go('appearance');
        toast('Reset to defaults');
      }));
    }
  };

  /* --------------------------------------------------- system settings -- */

  const AS_CLS = { Pass: 't-op', Fail: 't-bad', Skipped: 't-ex', Neutral: 't-re' };

  Views.config = {
    render(st) {
      const c = st.config;
      const rows = c.labels.filter((l) => l.code !== '—').map((l) =>
        '<tr><td><input class="cell mono" data-lbl="' + esc(l.code) + '.code" value="' + esc(l.code) + '" style="width:92px"></td>' +
        '<td><input class="cell" data-lbl="' + esc(l.code) + '.text" value="' + esc(l.text) + '"></td>' +
        '<td><span style="display:flex;align-items:center;gap:8px">' +
        '<input type="color" class="swatchin" data-lbl="' + esc(l.code) + '.colour" value="' + esc(l.colour) + '">' +
        '<span class="mono" style="font-size:11.5px;color:var(--muted)">' + esc(l.colour) + '</span></span></td>' +
        '<td>' + tag(l.as, AS_CLS[l.as] || 't-re') + '</td>' +
        '<td style="text-align:right"><span class="linkbtn" data-rmlbl="' + esc(l.code) + '">✕</span></td></tr>').join('');

      const engineers = c.engineers.length
        ? c.engineers.map((e) => '<tr><td><span class="initials">' + esc(e.initials) + '</span></td>' +
            '<td>' + esc(e.name) + '</td><td style="color:var(--muted)">' + esc(e.role || '') + '</td>' +
            '<td style="text-align:right"><span class="linkbtn" data-rmeng="' + esc(e.initials) + '">✕</span></td></tr>').join('')
        : '<tr><td colspan="4" class="empty">No engineers added yet.</td></tr>';

      const org = (key, label) =>
        '<div class="rowline"><span class="lbl">' + esc(label) + '</span>' +
        '<input class="cell" data-org="' + key + '" value="' + esc(c.org[key] || '') +
        '" style="max-width:260px;text-align:right"></div>';

      const def = (key, label, suffix) =>
        '<div class="rowline"><span class="lbl">' + esc(label) + '</span>' +
        '<span><input class="cell num" data-def="' + key + '" value="' + esc(c.defaults[key]) +
        '" style="width:84px;text-align:right"> ' + esc(suffix || '') + '</span></div>';

      return '<header class="page"><div><h2>System settings</h2>' +
        '<p>Applies to this installation and every test run on it — not to one report.</p></div>' +
        '<div class="actions"><button data-act="resetConfig">Reset to default</button>' +
        '<button class="primary" data-act="saveConfig">Save</button></div></header>' +

        '<div class="card"><h3>Sign-off labels</h3>' +
        '<p class="sub">The choices offered in the two sign-off columns of the test report, one column ' +
        'per station. Renaming applies to future reports only — a report already saved keeps the ' +
        'wording it was saved with, so it never silently changes meaning.</p>' +
        '<table><tr><th>Code</th><th>Description</th><th>Colour</th>' +
        '<th>' + U.tip('Treated as', 'Roll-up meaning',
          'How the label counts when a report totals itself up. Two names can share a meaning, so you can keep your own wording without breaking the summary.') + '</th><th></th></tr>' +
        rows + '</table>' +
        '<div style="margin-top:13px"><button data-act="addLabel">+ Add label</button></div></div>' +

        '<div class="grid2"><div class="card" style="margin:0"><h3>Organisation</h3>' +
        '<p class="sub">Printed on every report header and footer.</p>' +
        org('utility', 'Utility') + org('division', 'Division') +
        org('titlePrefix', 'Report title') + org('footer', 'Footer note') + '</div>' +

        '<div class="card" style="margin:0"><h3>Test defaults</h3>' +
        '<p class="sub">Starting values for a new run. Any run can override them without changing these.</p>' +
        def('testCurrent', 'Test current', 'A sec') +
        def('vnom', 'Nominal voltage', 'V L–N') +
        def('inZonePct', 'In-zone point', '% of reach') +
        def('outZonePct', 'Out-of-zone point', '% of reach') +
        def('warnVolts', 'Warn above', 'V') + '</div></div>' +

        '<div class="card"><h3>Engineers</h3>' +
        '<p class="sub">Who can be named on a sign-off.</p>' +
        '<table><tr><th style="width:38px"></th><th>Name</th><th>Role</th><th></th></tr>' + engineers + '</table>' +
        '<div style="margin-top:13px"><button data-act="addEng">+ Add engineer</button></div></div>';
    },

    mount(root, st, app) {
      const save = guard(async (patch, message) => {
        st.config = await window.ender.config.set(patch);
        if (message) toast(message);
        return st.config;
      });

      on(root, '[data-lbl]', 'change', async (e, input) => {
        const [code, field] = input.dataset.lbl.split('.');
        const labels = st.config.labels.map((l) =>
          (l.code === code ? Object.assign({}, l, { [field]: input.value }) : l));
        await save({ labels }, (field === 'colour' ? code + ' colour saved' : code + ' saved'));
        app.go('config');
      });

      on(root, '[data-rmlbl]', 'click', async (e, link) => {
        const labels = st.config.labels.filter((l) => l.code !== link.dataset.rmlbl);
        await save({ labels }, 'Removed ' + link.dataset.rmlbl);
        app.go('config');
      });

      on(root, '[data-act="addLabel"]', 'click', async () => {
        const code = (window.prompt('Short code for the new label, e.g. HOLD') || '').trim().toUpperCase();
        if (!code) return;
        if (st.config.labels.some((l) => l.code === code)) { toast('That code already exists', true); return; }
        const labels = st.config.labels.concat([
          { code, text: code, colour: '#8b95a5', as: 'Neutral', dflt: false }
        ]);
        await save({ labels }, 'Added ' + code);
        app.go('config');
      });

      on(root, '[data-org]', 'change', (e, input) => {
        const org = Object.assign({}, st.config.org, { [input.dataset.org]: input.value });
        save({ org }, 'Saved');
      });

      on(root, '[data-def]', 'change', (e, input) => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) { toast('That needs to be a number', true); return; }
        const defaults = Object.assign({}, st.config.defaults, { [input.dataset.def]: value });
        save({ defaults }, 'Default saved');
      });

      on(root, '[data-act="addEng"]', 'click', async () => {
        const name = (window.prompt('Engineer name, e.g. J. Hale') || '').trim();
        if (!name) return;
        const initials = name.split(/[\s.]+/).filter(Boolean).map((p) => p[0].toUpperCase()).join('').slice(0, 3);
        const engineers = st.config.engineers.concat([{ initials, name, role: '' }]);
        await save({ engineers }, 'Added ' + name);
        app.go('config');
      });

      on(root, '[data-rmeng]', 'click', async (e, link) => {
        const engineers = st.config.engineers.filter((x) => x.initials !== link.dataset.rmeng);
        await save({ engineers }, 'Removed');
        app.go('config');
      });

      on(root, '[data-act="saveConfig"]', 'click', guard(async () => {
        st.config = await window.ender.config.set({});
        toast('System settings saved');
      }));

      on(root, '[data-act="resetConfig"]', 'click', guard(async () => {
        st.config = await window.ender.config.reset();
        toast('Reset to defaults');
        app.go('config');
      }));
    }
  };
}());
