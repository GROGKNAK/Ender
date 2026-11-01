'use strict';
/*
 * Renderer entry point: the sidebar, the router, and the shared state the
 * views render from.
 *
 * State here is a cache of what main already holds. Main is the source of
 * truth, so every mutation goes over IPC and the answer replaces the cache
 * rather than the renderer patching its own copy and hoping the two agree.
 */

(function () {
  const { esc, toast } = U;

  const STEPS = [
    { key: 'settings', label: 'Settings files' },
    { key: 'system', label: 'Line &amp; system' },
    { key: 'distance', label: 'Distance (21)' },
    { key: 'differential', label: 'Differential (87L)' },
    { key: 'report', label: 'Report' },
    { key: 'findings', label: 'Findings' }
  ];

  const EXTRAS = [
    { key: 'reports', label: 'Saved reports', icon: '▤', group: 'Library' },
    { key: 'config', label: 'System settings', icon: '⚙', group: 'Settings' },
    { key: 'appearance', label: 'Appearance', icon: '◐', group: 'Settings' }
  ];

  const state = { session: null, config: null, theme: null, info: null };
  const app = { route: 'settings', plan: null, state };

  const navEl = document.getElementById('nav');
  const mainEl = document.getElementById('main');

  /* ----------------------------------------------------------- theming -- */

  app.applyTheme = function applyTheme(theme) {
    state.theme = theme || state.theme;
    const t = state.theme || {};
    const root = document.documentElement;
    if (t.accent) root.style.setProperty('--accent', t.accent);
    for (const [key, value] of Object.entries(t.roles || {})) {
      if (value) root.style.setProperty('--' + key, value);
    }
    if (t.textSize) root.style.setProperty('--base', t.textSize + 'px');
    const pad = { compact: '4px', normal: '7px', roomy: '11px' }[t.density || 'normal'];
    root.style.setProperty('--rowpad', pad);
  };

  /* -------------------------------------------------------------- nav --- */

  function renderNav() {
    const s = state.session;
    const ready = Boolean(s && s.ready);
    const reached = (i) => {
      if (i === 0) return true;
      return ready;
    };

    const steps = STEPS.map((step, i) => {
      const on = app.route === step.key;
      const done = ready && STEPS.findIndex((x) => x.key === app.route) > i;
      const cls = [on ? 'on' : '', done ? 'done' : '', reached(i) ? '' : 'disabled'].filter(Boolean).join(' ');
      return '<a data-route="' + step.key + '" class="' + cls + '">' +
        '<span class="n">' + (done ? '✓' : i + 1) + '</span>' + step.label + '</a>';
    }).join('');

    let extras = '';
    let group = '';
    for (const x of EXTRAS) {
      if (x.group !== group) {
        group = x.group;
        extras += '<div class="navsep">' + group + '</div>';
      }
      extras += '<a data-route="' + x.key + '" class="' + (app.route === x.key ? 'on' : '') + '">' +
        '<span class="n ico">' + x.icon + '</span>' + x.label + '</a>';
    }

    const foot = s && s.ready
      ? esc((s.names.local || '') .split(' ')[0]) + ' – ' + esc((s.names.remote || '').split(' ')[0]) +
        '<br>' + (s.line && s.line.length ? s.line.length + ' units · ' : '') +
        (s.line ? U.n(U.abs(s.line.z1), 2) + ' ' + U.OHM + ' line' : '')
      : 'No line loaded';

    navEl.innerHTML = '<div class="brand"><h1>Ender</h1><span>87L / 21 test builder</span></div>' +
      steps + extras + '<div class="navfoot">' + foot + '</div>';
  }

  /* ------------------------------------------------------------ router -- */

  /*
   * Each render gets its own host element.
   *
   * Views attach delegated listeners to the root they are handed. If that root
   * survived the render, every re-mount would add another listener to the same
   * node and a single click would fire once per visit -- six navigations, six
   * file dialogs. Replacing the host means the old listeners are collected
   * with the old DOM and a view cannot leak them however it binds.
   */
  app.go = async function go(route) {
    const view = window.Views[route];
    if (!view) return;
    app.route = route;
    renderNav();

    const host = document.createElement('div');
    host.className = 'viewhost';
    host.innerHTML = view.render(state);
    mainEl.replaceChildren(host);
    mainEl.scrollTop = 0;

    try {
      if (view.mount) await view.mount(host, state, app);
    } catch (err) {
      toast(err.message || String(err), true);
    }
    document.body.setAttribute('data-smoke', 'ready');
  };

  /* Replace the cached session. `quiet` re-renders only the nav, for changes
   * that must not yank the view out from under a slider mid-drag. */
  app.setSession = function setSession(session, quiet) {
    if (!session) return;
    state.session = session;
    if (quiet) renderNav();
    else app.go(app.route);
  };

  /*
   * A file dropped anywhere but a drop zone would otherwise navigate the
   * window to it, replacing the running app with the contents of the file and
   * losing the session. The zones call stopPropagation, so anything reaching
   * here was dropped somewhere that should ignore it.
   */
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  navEl.addEventListener('click', (e) => {
    const link = e.target.closest('[data-route]');
    if (link && !link.classList.contains('disabled')) app.go(link.dataset.route);
  });

  mainEl.addEventListener('click', (e) => {
    const link = e.target.closest('[data-go]');
    if (link && !link.disabled) app.go(link.dataset.go);
  });

  /* Clearing experimental settings is offered on several screens, so it is
   * handled once here rather than wired into each view's mount. */
  mainEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act="clearExp"]');
    if (!b) return;
    try {
      app.setSession(await window.ender.session.clearExperimental());
      toast('Experimental settings cleared — locked test points were left alone');
    } catch (err) {
      toast(err.message || String(err), true);
    }
  });

  /* ------------------------------------------------------------- boot --- */

  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;
    try {
      const [info, session, config, theme] = await Promise.all([
        window.ender.appInfo(),
        window.ender.session.get(),
        window.ender.config.get(),
        window.ender.theme.get()
      ]);
      state.info = info;
      state.session = session;
      state.config = config;
      app.applyTheme(theme);
      await app.go('settings');
    } catch (err) {
      mainEl.innerHTML = '<div class="err"><b>✕</b><div>Could not start: ' +
        esc(err.message || String(err)) + '</div></div>';
      document.body.setAttribute('data-smoke', 'error');
    }
  }

  window.ender.onMenu(async (action) => {
    try {
      if (action === 'load-local') app.setSession(await window.ender.files.pick('local'));
      else if (action === 'load-remote') app.setSession(await window.ender.files.pick('remote'));
      else if (action === 'load-demo') app.setSession(await window.ender.files.loadDemo());
      else if (action === 'export-report') await window.ender.exports.reportPdf();
      else if (action === 'export-record') await window.ender.exports.recordPdf();
      else if (action === 'export-csv') await window.ender.exports.csv();
    } catch (err) {
      toast(err.message || String(err), true);
    }
  });

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
}());
