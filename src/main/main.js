'use strict';
/*
 * Electron main process.
 *
 * All the engineering lives in src/core and runs here, in Node, so it can be
 * unit-tested without Electron. The renderer stays a pure UI layer that owns
 * no state and does no arithmetic: every number it shows arrived over IPC
 * already computed. That keeps node integration switched off in the window and
 * means a UI change can never alter a result.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const { parseMany } = require('../core/parseSettings');
const { readSource } = require('../core/bundle');
const { buildRelay, validateRelay, compareEnds } = require('../core/relay');
const { buildLine, DEFAULT_OPERATOR, FAULT_MODELS } = require('../core/line');
const { buildPlan, lockKeyOf } = require('../core/testplan');
const { buildRecord } = require('../core/record');
const { testPlanCsv } = require('../core/csv');
const { testReportPdf, recordPdf } = require('../core/pdf');
const { Store, sha256 } = require('./store');

const SMOKE = process.argv.includes('--smoke');
const SHOTS = process.argv.includes('--shots');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SAMPLES = path.join(__dirname, '..', '..', 'samples');

let mainWindow = null;
let store = null;

/*
 * The working session. Held here rather than in the renderer so that a
 * navigation, a reload, or a crashed view cannot lose a half-entered run.
 */
const session = {
  local: null,
  remote: null,
  names: { local: '', remote: '' },
  operator: Object.assign({}, DEFAULT_OPERATOR),
  signoff: {},
  /*
   * Locked test points, by lock key. A lock holds the frozen row and the
   * settings it was computed under, so experimenting elsewhere cannot move a
   * test line that has already been agreed.
   */
  locks: {},
  plan: null,
  record: null,
  reportId: null
};

/* ------------------------------------------------------------------ window */

function createWindow() {
  const work = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(1100, Math.min(1560, work.width - 80));
  const height = Math.max(720, Math.min(1000, work.height - 80));

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#12151a',
    show: false,
    title: 'Ender',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!SMOKE && !SHOTS) mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] renderer gone:', details.reason, details.exitCode);
    if (SMOKE) app.exit(1);
  });

  if (SMOKE) runSmoke();
  if (SHOTS) runShots();
}

/*
 * `npm run appshots`: walk the real app with the demo line loaded and capture
 * each screen, so a UI regression is reviewable without clicking through.
 */
function runShots() {
  const out = path.join(__dirname, '..', '..', 'tmp', 'shots');

  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      fs.mkdirSync(out, { recursive: true });

      // Drive the UI rather than the session directly: loading the demo in
      // main would leave the renderer's cached session stale and every nav
      // link disabled, which is exactly what a user would not see.
      if (!session.local || !session.remote) {
        await mainWindow.webContents.executeJavaScript(
          'document.querySelector(\'[data-act="demo"]\').click(), 1'
        );
      }
      const ready = await mainWindow.webContents.executeJavaScript(
        'new Promise(function (resolve) {' +
        '  var t0 = Date.now();' +
        '  (function tick() {' +
        '    var link = document.querySelector(\'[data-route="report"]\');' +
        '    if (link && !link.classList.contains("disabled")) return resolve(true);' +
        '    if (Date.now() - t0 > 8000) return resolve(false);' +
        '    setTimeout(tick, 80);' +
        '  })();' +
        '})'
      );
      if (!ready) throw new Error('demo line never finished loading');

      const routes = ['settings', 'system', 'distance', 'differential', 'report',
        'findings', 'reports', 'config', 'appearance'];
      let i = 0;
      for (const route of routes) {
        i += 1;
        await mainWindow.webContents.executeJavaScript(
          'document.querySelector(\'[data-route="' + route + '"]\').click(), "' + route + '"'
        );
        await wait(900);
        const need = await mainWindow.webContents.executeJavaScript(
          'Math.ceil(document.querySelector("main").scrollHeight) + 46'
        );
        mainWindow.setContentSize(1440, Math.min(Math.max(900, need), 4000));
        await wait(350);
        const img = await mainWindow.webContents.capturePage();
        const file = path.join(out, String(i).padStart(2, '0') + '-' + route + '.png');
        fs.writeFileSync(file, img.toPNG());
        console.log('  ' + path.basename(file));
        mainWindow.setContentSize(1440, 900);
      }
      console.log('[shots] done');
      app.exit(0);
    } catch (err) {
      console.error('[shots] FAIL - ' + (err.stack || err.message));
      app.exit(1);
    }
  });
}

/* -------------------------------------------------------------- session -- */

/*
 * One end's settings, from whatever shape they arrived in: a single export, a
 * zip, or the native folder of per-group files. readSource() flattens all
 * three to a list of texts so everything below this line is the same.
 */
function loadEnd(end, target) {
  const source = readSource(target);
  const parsed = parseMany(source.sources, {});
  const rawText = source.sources.map((s) => s.text).join('\n');
  const relay = buildRelay(parsed, { fileName: source.label, rawText });
  const entry = {
    end,
    filePath: target,
    fileName: source.label,
    sourceKind: source.kind,
    fileCount: source.sources.length,
    files: parsed.files || [],
    bytes: Buffer.byteLength(rawText),
    hash: sha256(rawText),
    relay,
    problems: validateRelay(relay)
  };
  session[end] = entry;
  const fallback = relay.rid || path.basename(filePath).replace(/\.[^.]+$/, '');
  if (!session.names[end]) session.names[end] = fallback;
  invalidate();
  return summary();
}

/** Anything derived is discarded whenever an input changes. */
function invalidate() {
  session.plan = null;
  session.record = null;
}

function endSummary(entry, name) {
  if (!entry) return null;
  const r = entry.relay;
  return {
    fileName: entry.fileName,
    filePath: entry.filePath,
    sourceKind: entry.sourceKind,
    fileCount: entry.fileCount,
    files: entry.files,
    layout: r.layout,
    format: r.kind,
    group: r.group,
    groups: r.groups,
    enables: r.enables,
    bytes: entry.bytes,
    hash: entry.hash,
    hashShort: entry.hash.slice(0, 4) + '…' + entry.hash.slice(-4),
    name,
    model: r.model,
    rid: r.rid,
    ridFrom: r.ridFrom,
    tid: r.tid,
    serial: r.serial,
    ctr: r.ctr ? r.ctr.value : null,
    ptr: r.ptr ? r.ptr.value : null,
    settingCount: r.settingCount,
    usedCount: r.catalogue.filter((c) => c.status === 'used').length,
    duplicateCount: r.catalogue.filter((c) => c.status === 'duplicate').length,
    unusedCount: r.catalogue.filter((c) => c.status === 'unused').length,
    catalogue: r.catalogue.slice(0, 1500),
    problems: entry.problems,
    zones: r.zones
  };
}

function summary() {
  const both = session.local && session.remote;
  let line = null;
  let comparison = [];

  if (both) {
    comparison = compareEnds(session.local.relay, session.remote.relay);
    try {
      const m = buildLine(session.local.relay, session.remote.relay, session.operator);
      line = {
        z1: m.z1,
        z0: m.z0,
        z1mag: m.z1mag.value,
        z1ang: m.z1ang.value,
        z0mag: m.z0mag.value,
        z0ang: m.z0ang.value,
        k0: m.k0,
        k0p1: m.k0p1,
        k0Source: m.k0Source,
        zones: m.zones,
        d87: m.d87,
        ctr: m.ctr ? m.ctr.value : null,
        ptr: m.ptr ? m.ptr.value : null,
        length: m.lengthUnits ? m.lengthUnits.value : null
      };
    } catch (err) {
      line = { error: err.message };
    }
  }

  return {
    local: endSummary(session.local, session.names.local),
    remote: endSummary(session.remote, session.names.remote),
    names: session.names,
    operator: session.operator,
    signoff: session.signoff,
    comparison,
    line,
    faultModels: FAULT_MODELS,
    ready: Boolean(both && line && !line.error),
    hasPlan: Boolean(session.plan),
    reportId: session.reportId
  };
}

function requireLine() {
  if (!session.local || !session.remote) throw new Error('Both settings files must be loaded first');
  return buildLine(session.local.relay, session.remote.relay, session.operator);
}

function buildAll() {
  const line = requireLine();
  session.plan = buildPlan(line, { locks: session.locks });
  session.record = buildRecord({
    line,
    plan: session.plan,
    local: session.local.relay,
    remote: session.remote.relay,
    meta: { appVersion: app.getVersion() }
  });
  return { line, plan: session.plan, record: session.record };
}

function provenance() {
  return ['local', 'remote'].filter((e) => session[e]).map((e) => ({
    end: e === 'local' ? 'Local' : 'Remote',
    fileName: session[e].fileName,
    hash: session[e].hash.slice(0, 16),
    model: session[e].relay.model,
    serial: session[e].relay.serial
  }));
}

function fingerprint() {
  return sha256(['local', 'remote'].map((e) => (session[e] ? session[e].hash : '')).join('|')).slice(0, 16);
}

/* ------------------------------------------------------------------- ipc -- */

/* Every handler is wrapped so a thrown error reaches the UI as a message
 * rather than a silent rejected promise the renderer never reports. */
/* How many times each channel has been invoked, so the smoke test can prove
 * that one click produces exactly one request. */
const ipcCalls = Object.create(null);

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    ipcCalls[channel] = (ipcCalls[channel] || 0) + 1;
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      console.error('[' + channel + ']', err);
      return { ok: false, error: err.message || String(err) };
    }
  });
}

handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  node: process.versions.node,
  samplesDir: SAMPLES,
  reportsDir: store.usage().dir
}));

handle('files:pick', async (end) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select the ' + end + ' end settings export',
    defaultPath: SAMPLES,
    filters: [
      { name: 'Relay settings', extensions: ['html', 'htm', 'txt', 'csv', 'tsv', 'json', 'zip', 'rdb', 'set'] },
      { name: 'acSELerator report', extensions: ['html', 'htm'] },
      { name: 'Native export archive', extensions: ['zip'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return loadEnd(end, res.filePaths[0]);
});

/* The native export is a folder, so it needs its own picker. */
handle('files:pickFolder', async (end) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select the ' + end + ' end settings folder',
    defaultPath: SAMPLES,
    properties: ['openDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return loadEnd(end, res.filePaths[0]);
});

handle('files:load', (end, filePath) => loadEnd(end, filePath));

handle('files:loadDemo', () => {
  loadEnd('local', path.join(SAMPLES, 'DEMO_ALPHA_LN1_Settings.html'));
  loadEnd('remote', path.join(SAMPLES, 'DEMO_BRAVO_LN1_Settings.html'));
  return summary();
});

handle('session:get', () => summary());

handle('session:clear', () => {
  session.local = null;
  session.remote = null;
  session.names = { local: '', remote: '' };
  session.signoff = {};
  session.reportId = null;
  invalidate();
  return summary();
});

handle('session:setName', (end, name) => {
  session.names[end] = String(name || '').trim() || session.names[end];
  return summary();
});

handle('session:swap', () => {
  const l = session.local;
  session.local = session.remote;
  session.remote = l;
  if (session.local) session.local.end = 'local';
  if (session.remote) session.remote.end = 'remote';
  const n = session.names.local;
  session.names.local = session.names.remote;
  session.names.remote = n;
  invalidate();
  return summary();
});

handle('session:setOperator', (patch) => {
  session.operator = Object.assign({}, session.operator, patch || {});
  invalidate();
  return summary();
});

handle('session:setSignoff', (key, value) => {
  session.signoff[key] = value;
  return { signoff: session.signoff };
});

handle('plan:build', () => {
  const { plan } = buildAll();
  return plan;
});

/*
 * Locking freezes a row as it stands. The row is captured from a plan built
 * with the lock absent, so locking never captures an already-frozen copy of
 * itself, and the operator settings travel with it for the record.
 */
handle('plan:lock', (key) => {
  const line = requireLine();
  const live = buildPlan(line, { locks: {} });
  const row = live.distance.find((r) => lockKeyOf(r) === key);
  if (!row) throw new Error('No such test point: ' + key);
  session.locks[key] = {
    row,
    operator: JSON.parse(JSON.stringify(session.operator)),
    at: new Date().toISOString()
  };
  invalidate();
  return buildAll().plan;
});

handle('plan:unlock', (key) => {
  delete session.locks[key];
  invalidate();
  return buildAll().plan;
});

handle('plan:unlockAll', () => {
  session.locks = {};
  invalidate();
  return buildAll().plan;
});

/* Experimental settings are everything the operator can change after the
 * files are loaded. Clearing returns to the stored defaults, leaving locked
 * rows alone -- that is the point of locking them. */
handle('session:clearExperimental', () => {
  const defaults = store.getConfig().defaults;
  session.operator = Object.assign({}, DEFAULT_OPERATOR, defaults, { d87Override: null });
  invalidate();
  return summary();
});

handle('session:setD87Override', (patch) => {
  if (!patch) session.operator.d87Override = null;
  else session.operator.d87Override = Object.assign({}, session.operator.d87Override, patch);
  invalidate();
  return summary();
});

handle('record:build', () => {
  if (!session.record) buildAll();
  return session.record;
});

/* ---------------------------------------------------------------- export - */

async function askSave(defaultName, extension, label) {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save ' + label,
    defaultPath: defaultName,
    filters: [{ name: label, extensions: [extension] }]
  });
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
}

function slug(s) {
  return String(s || 'ender').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'ender';
}

function baseName() {
  return slug(session.names.local) + '-' + slug(session.names.remote);
}

handle('export:csv', async () => {
  const { line, plan } = session.plan ? { line: requireLine(), plan: session.plan } : buildAll();
  const target = await askSave(baseName() + '-tests.csv', 'csv', 'test plan CSV');
  if (!target) return null;
  fs.writeFileSync(target, testPlanCsv({
    plan, line, names: session.names, signoff: session.signoff
  }), 'utf8');
  return target;
});

handle('export:reportPdf', async () => {
  const { line, plan } = session.plan ? { line: requireLine(), plan: session.plan } : buildAll();
  const target = await askSave(baseName() + '-report.pdf', 'pdf', 'test report');
  if (!target) return null;
  const bytes = await testReportPdf({
    plan, line, names: session.names, org: store.getConfig().org, signoff: session.signoff
  });
  fs.writeFileSync(target, Buffer.from(bytes));
  return target;
});

handle('export:recordPdf', async () => {
  const { line, record } = session.record ? { line: requireLine(), record: session.record } : buildAll();
  const target = await askSave(baseName() + '-calculation-record.pdf', 'pdf', 'calculation record');
  if (!target) return null;
  const bytes = await recordPdf({
    record, line, names: session.names, org: store.getConfig().org, provenance: provenance()
  });
  fs.writeFileSync(target, Buffer.from(bytes));
  return target;
});

handle('shell:show', (target) => {
  if (target) shell.showItemInFolder(target);
  return true;
});

handle('shell:openPath', (target) => shell.openPath(target));

/* ---------------------------------------------------------------- config - */

handle('config:get', () => store.getConfig());
handle('config:set', (patch) => store.setConfig(patch));
handle('config:reset', () => store.resetConfig());
handle('theme:get', () => store.getTheme());
handle('theme:set', (patch) => store.setTheme(patch));
handle('theme:reset', () => store.resetTheme());

/* --------------------------------------------------------------- reports - */

handle('reports:list', () => store.listReports());
handle('reports:usage', () => store.usage());
handle('reports:get', (id) => store.getReport(id));
handle('reports:delete', (id) => store.deleteReport(id));

handle('reports:save', (extra) => {
  if (!session.plan) buildAll();
  const saved = store.saveReport(Object.assign({
    id: session.reportId,
    names: session.names,
    relays: {
      local: endSummary(session.local, session.names.local),
      remote: endSummary(session.remote, session.names.remote)
    },
    operator: session.operator,
    signoff: session.signoff,
    counts: session.plan.counts,
    model: session.operator.faultModel,
    fingerprint: fingerprint(),
    provenance: provenance()
  }, extra || {}));
  session.reportId = saved.id;
  return saved;
});

/* ----------------------------------------------------------------- smoke - */

/*
 * `npm run smoke`: load the demo pair, build everything, render both PDFs and
 * confirm the renderer drew the result. Exercises the whole chain without
 * anyone looking at a window.
 */
function runSmoke() {
  /* A check that hangs tells you nothing and blocks whatever is waiting on
   * it, so the run is bounded regardless of what goes wrong inside it. */
  const watchdog = setTimeout(() => {
    console.error('[smoke] FAIL - timed out after 90s at step: ' + (stage || 'start'));
    app.exit(1);
  }, 90000);
  let stage = 'start';

  mainWindow.webContents.once('did-finish-load', async () => {
    const fail = (msg) => {
      clearTimeout(watchdog);
      console.error('[smoke] FAIL - ' + msg);
      app.exit(1);
    };
    const step = (name) => { stage = name; };
    try {
      step('load demo files');
      loadEnd('local', path.join(SAMPLES, 'DEMO_ALPHA_LN1_Settings.html'));
      loadEnd('remote', path.join(SAMPLES, 'DEMO_BRAVO_LN1_Settings.html'));
      const { line, plan, record } = buildAll();

      if (!plan.distance.length) return fail('no test points generated');
      if (!record.selfCheck.ok) return fail('record self check failed');

      /*
       * Lock round trip: a locked point must survive a settings change that
       * moves every other point, and must come back under the new settings
       * once unlocked.
       */
      step('lock round trip');
      const key = lockKeyOf(plan.distance[0]);
      const lockedPct = plan.distance[0].pctOfReach;
      session.locks[key] = {
        row: plan.distance[0],
        operator: JSON.parse(JSON.stringify(session.operator)),
        at: new Date().toISOString()
      };
      session.operator.inZonePct = lockedPct === 60 ? 70 : 60;
      invalidate();
      const moved = buildAll().plan;
      const lockedRow = moved.distance.find((r) => r.lockKey === key);
      const freeRow = moved.distance.find((r) => r.lockKey !== key && r.pointKey === 'in');
      if (!lockedRow || lockedRow.pctOfReach !== lockedPct) {
        return fail('a locked point moved when the settings changed');
      }
      if (!freeRow || freeRow.pctOfReach === lockedPct) {
        return fail('unlocked points did not follow the settings change');
      }
      delete session.locks[key];
      invalidate();
      const released = buildAll().plan;
      if (released.distance[0].pctOfReach === lockedPct) {
        return fail('an unlocked point did not return to the live settings');
      }
      session.operator.inZonePct = lockedPct;
      invalidate();
      buildAll();
      console.log('[smoke] lock held at ' + lockedPct + '% while others moved, released cleanly');

      step('render pdfs');
      const a = await testReportPdf({ plan, line, names: session.names, org: {}, signoff: {} });
      const b = await recordPdf({ record, line, names: session.names, org: {}, provenance: provenance() });
      if (a.length < 2000 || b.length < 3000) return fail('a PDF came out suspiciously small');

      step('wait for renderer ready');
      const shown = await mainWindow.webContents.executeJavaScript(
        'new Promise(function (resolve) {' +
        '  var started = Date.now();' +
        '  (function tick() {' +
        '    var el = document.querySelector("[data-smoke]");' +
        '    if (el && el.getAttribute("data-smoke") !== "boot") return resolve(el.getAttribute("data-smoke"));' +
        '    if (Date.now() - started > 6000) return resolve(el ? el.getAttribute("data-smoke") : "missing");' +
        '    setTimeout(tick, 60);' +
        '  })();' +
        '})'
      );
      if (shown !== 'ready') return fail('renderer never signalled ready (saw "' + shown + '")');

      // Views re-mount on every navigation. If a view attaches its delegated
      // listeners to a node that outlives the render, they stack up and one
      // click fires N times -- which shows up as N file dialogs.
      step('listener duplication check');
      await mainWindow.webContents.executeJavaScript(
        '(async function () {' +
        '  document.querySelector(\'[data-act="demo"]\').click();' +
        '  await new Promise(function (r) { setTimeout(r, 600); });' +
        '  for (var i = 0; i < 4; i += 1) {' +
        '    document.querySelector(\'[data-route="system"]\').click();' +
        '    await new Promise(function (r) { setTimeout(r, 170); });' +
        '    document.querySelector(\'[data-route="settings"]\').click();' +
        '    await new Promise(function (r) { setTimeout(r, 170); });' +
        '  }' +
        '  return 1;' +
        '})()'
      );
      const before = ipcCalls['files:loadDemo'] || 0;
      await mainWindow.webContents.executeJavaScript(
        'document.querySelector(\'[data-act="demo"]\').click(), 1'
      );
      await wait(500);
      const fired = (ipcCalls['files:loadDemo'] || 0) - before;
      if (fired !== 1) {
        return fail('one click produced ' + fired + ' requests after 4 navigations - ' +
          'view listeners are stacking up on a node that outlives the render');
      }

      // A File built in the page has no real location, so '' is the right
      // answer. What this proves is that the API exists and degrades instead
      // of throwing, which is what a dropped file depends on.
      step('drop path api');
      const dropApi = await mainWindow.webContents.executeJavaScript(
        '(function () {' +
        '  try {' +
        '    if (typeof window.ender.files.pathFor !== "function") return "missing";' +
        '    return String(window.ender.files.pathFor(new File(["x"], "t.html")));' +
        '  } catch (e) { return "threw: " + e.message; }' +
        '})()'
      );
      if (dropApi !== '') return fail('drop path resolution is broken: ' + dropApi);

      console.log('[smoke] ' + plan.counts.distance + ' distance points, ' +
        plan.counts.differential + ' differential checks');
      console.log('[smoke] record self check residual ' + record.selfCheck.worstResidual.toExponential(1) + ' ohm');
      console.log('[smoke] report pdf ' + a.length + ' bytes, record pdf ' + b.length + ' bytes');
      clearTimeout(watchdog);
      console.log('[smoke] PASS');
      app.exit(0);
    } catch (err) {
      fail(err.stack || err.message);
    }
  });
}

/* ------------------------------------------------------------------ menu - */

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Load local settings…', click: () => mainWindow.webContents.send('menu', 'load-local') },
        { label: 'Load remote settings…', click: () => mainWindow.webContents.send('menu', 'load-remote') },
        { label: 'Load demo line', click: () => mainWindow.webContents.send('menu', 'load-demo') },
        { type: 'separator' },
        { label: 'Export test report (PDF)', click: () => mainWindow.webContents.send('menu', 'export-report') },
        { label: 'Export calculation record (PDF)', click: () => mainWindow.webContents.send('menu', 'export-record') },
        { label: 'Export test plan (CSV)', click: () => mainWindow.webContents.send('menu', 'export-csv') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' }
      ]
    }
  ]));
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  session.operator = Object.assign({}, DEFAULT_OPERATOR, store.getConfig().defaults);

  /* Load a pair before the window boots, so screenshots and checks can run
   * against real exports rather than the demo line. */
  for (const end of ['local', 'remote']) {
    const from = process.env['ENDER_LOAD_' + end.toUpperCase()];
    if (!from) continue;
    try {
      loadEnd(end, from);
    } catch (err) {
      console.error('[load] ' + end + ': ' + err.message);
    }
  }
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
