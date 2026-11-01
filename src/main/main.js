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

const { readSource } = require('../core/bundle');
const { DEFAULT_OPERATOR } = require('../core/line');
const { lockKeyOf } = require('../core/testplan');
const { createSession } = require('../core/session');
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
 * The working session, and everything that turns it into a plan, a record
 * and an export bundle. That logic is shared with the web build -- see
 * core/session.js -- so the two produce the same report from the same two
 * files. What stays here is the platform: the file system, the dialogs and
 * the store.
 */
const S = createSession({
  readSource,
  hash: sha256,
  byteLength: (text) => Buffer.byteLength(text),
  basename: (target) => path.basename(target),
  appVersion: () => app.getVersion(),
  store: {
    getConfig: () => store.getConfig(),
    getReport: (id) => store.getReport(id)
  }
});

const session = S.state;
const {
  invalidate, loadEnd, summary, endSummary, experimentalDeviations,
  buildAll, provenance, fingerprint, exportBundle
} = S;

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

handle('files:loadDemo', async () => {
  await loadEnd('local', path.join(SAMPLES, 'DEMO_ALPHA_LN1_Settings.html'));
  await loadEnd('remote', path.join(SAMPLES, 'DEMO_BRAVO_LN1_Settings.html'));
  return summary();
});

handle('session:get', () => summary());

handle('session:clear', () => {
  S.clear();
  return summary();
});

handle('session:setName', (end, name) => S.setName(end, name));

handle('session:swap', () => S.swap());

handle('session:setOperator', (patch) => S.setOperator(patch));

handle('session:setSignoff', (key, value) => S.setSignoff(key, value));

handle('session:setReportTitle', (title) => S.setReportTitle(title));

handle('session:setOmit', (key, omitted) => S.setOmit(key, omitted));

handle('plan:build', () => {
  const { plan } = buildAll();
  return plan;
});

handle('plan:lock', (key) => S.lock(key));
handle('plan:unlock', (key) => S.unlock(key));
handle('plan:unlockAll', () => S.unlockAll());
handle('session:clearExperimental', () => S.clearExperimental());
handle('session:setD87Override', (patch) => S.setD87Override(patch));

handle('record:build', () => {
  if (!session.record) buildAll();
  return session.record;
});

async function askSave(defaultName, extension, label) {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save ' + label,
    defaultPath: defaultName,
    filters: [{ name: label, extensions: [extension] }]
  });
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
}

handle('export:csv', async (savedId) => {
  const b = exportBundle(savedId);
  const target = await askSave(b.base + '-tests.csv', 'csv', 'test plan CSV');
  if (!target) return null;
  fs.writeFileSync(target, testPlanCsv({
    plan: b.plan, line: b.line, names: b.names, signoff: b.signoff
  }), 'utf8');
  return target;
});

handle('export:reportPdf', async (savedId) => {
  const b = exportBundle(savedId);
  const target = await askSave(b.base + '-report.pdf', 'pdf', 'test report');
  if (!target) return null;
  const bytes = await testReportPdf({
    plan: b.plan, line: b.line, names: b.names, org: store.getConfig().org,
    signoff: b.signoff, reportTitle: b.title
  });
  fs.writeFileSync(target, Buffer.from(bytes));
  return target;
});

handle('export:recordPdf', async (savedId) => {
  const b = exportBundle(savedId);
  if (!b.record) throw new Error('That saved report holds no calculation record');
  const target = await askSave(b.base + '-calculation-record.pdf', 'pdf', 'calculation record');
  if (!target) return null;
  const bytes = await recordPdf({
    record: b.record, line: b.line, names: b.names,
    org: store.getConfig().org, provenance: b.provenance, reportTitle: b.title
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

/*
 * A saved report holds everything needed to produce its documents again --
 * the line model, the plan and the record -- so it can be downloaded later
 * without the original settings files, which may have moved or changed.
 */
handle('reports:save', async (extra) => {
  const b = exportBundle(null);
  const saved = store.saveReport(Object.assign({
    id: session.reportId,
    title: b.title,
    names: session.names,
    relays: {
      local: endSummary(session.local, session.names.local),
      remote: endSummary(session.remote, session.names.remote)
    },
    operator: session.operator,
    signoff: session.signoff,
    omit: session.omit,
    locks: session.locks,
    counts: b.plan.counts,
    omittedCount: b.plan.omittedCount || 0,
    lockedCount: b.plan.lockedCount || 0,
    model: session.operator.faultModel,
    fingerprint: await fingerprint(),
    provenance: b.provenance,
    line: b.line,
    plan: b.plan,
    record: b.record
  }, extra || {}));
  session.reportId = saved.id;
  return saved;
});

handle('reports:rename', (id, title) => {
  const saved = store.getReport(id);
  if (!saved) throw new Error('No saved report with id ' + id);
  const next = String(title || '').trim();
  if (!next) throw new Error('A report needs a name');
  saved.title = next;
  store.saveReport(saved);
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
      await loadEnd('local', path.join(SAMPLES, 'DEMO_ALPHA_LN1_Settings.html'));
      await loadEnd('remote', path.join(SAMPLES, 'DEMO_BRAVO_LN1_Settings.html'));
      const { line, plan, record } = buildAll();

      if (!plan.distance.length) return fail('no test points generated');
      if (!record.selfCheck.ok) return fail('record self check failed');

      /*
       * Lock round trip: a locked point must survive a settings change that
       * moves every other point, and must come back under the new settings
       * once unlocked.
       */
      /*
       * A slider cannot land on 87.5, which is the whole reason the typed box
       * exists. Check the box reaches the session, not just the slider.
       */
      step('typed value entry');
      const typed = await mainWindow.webContents.executeJavaScript(
        '(async function () {' +
        // Make sure the renderer has a loaded session before relying on the
        // workflow nav, rather than assuming an earlier step left it ready.
        '  var demo = document.querySelector(\'[data-act="demo"]\');' +
        '  if (demo) demo.click();' +
        '  var link = null;' +
        '  var t0 = Date.now();' +
        '  while (Date.now() - t0 < 8000) {' +
        '    link = document.querySelector(\'[data-route="distance"]\');' +
        '    if (link && !link.classList.contains("disabled")) break;' +
        '    await new Promise(function (r) { setTimeout(r, 120); });' +
        '  }' +
        '  if (!link || link.classList.contains("disabled")) return "distance never became reachable";' +
        '  link.click();' +
        '  await new Promise(function (r) { setTimeout(r, 800); });' +
        '  var box = document.querySelector(\'[data-num="inZonePct"] [data-numbox]\');' +
        '  if (!box) {' +
        '    var link = document.querySelector(\'[data-route="distance"]\');' +
        '    return "no box; link=" + (link ? link.className || "(no class)" : "missing") +' +
        '      "; heading=" + ((document.querySelector("main h2") || {}).textContent || "?") +' +
        '      "; fields=" + document.querySelectorAll("[data-num]").length;' +
        '  }' +
        '  box.value = "87.5";' +
        '  box.dispatchEvent(new Event("change", { bubbles: true }));' +
        '  await new Promise(function (r) { setTimeout(r, 700); });' +
        '  var s = await window.ender.session.get();' +
        '  var range = document.querySelector(\'[data-num="inZonePct"] [data-numrange]\').value;' +
        '  var result = String(s.operator.inZonePct) + "/" + String(range);' +
        // Leave the renderer where it was found; later checks start from the
        // settings screen and a stranded view breaks them.
        '  var back = document.querySelector(\'[data-route="settings"]\');' +
        '  if (back) back.click();' +
        '  await new Promise(function (r) { setTimeout(r, 400); });' +
        '  return result;' +
        '})()'
      );
      if (typed !== '87.5/87.5') {
        return fail('a typed value did not reach the session and the slider (got ' + typed + ')');
      }
      session.operator.inZonePct = 85;
      invalidate();
      buildAll();
      console.log('[smoke] typed 87.5 into the box, slider and session both followed');

      /*
       * The generated checks are derived from the characteristic, so changing
       * 87LR has to move them. They were previously drawn once at mount and
       * went stale the moment anything was adjusted.
       */
      step('87L checks follow the characteristic');
      const followed = await mainWindow.webContents.executeJavaScript(
        '(async function () {' +
        '  var link = document.querySelector(\'[data-route="differential"]\');' +
        '  if (!link || link.classList.contains("disabled")) return "differential not reachable";' +
        '  link.click();' +
        '  await new Promise(function (r) { setTimeout(r, 900); });' +
        '  var rowText = function () {' +
        '    var rows = document.querySelectorAll("#dchecks tr");' +
        '    return rows.length > 3 ? rows[3].textContent : "";' +
        '  };' +
        '  var before = rowText();' +
        '  if (!before) return "no checks table";' +
        '  var box = document.querySelector(\'[data-num="d87r"] [data-numbox]\');' +
        '  if (!box) return "no 87LR control";' +
        '  box.value = "4";' +
        '  box.dispatchEvent(new Event("change", { bubbles: true }));' +
        '  await new Promise(function (r) { setTimeout(r, 1400); });' +
        '  var after = rowText();' +
        '  var sess = await window.ender.session.get();' +
        '  var rangeEl = document.querySelector(\'[data-num="d87r"] [data-numrange]\');' +
        '  var toastEl = document.querySelector(".toast");' +
        '  var diag = " override=" + JSON.stringify(sess.operator.d87Override) +' +
        '    " lineR=" + (sess.line && sess.line.d87 ? sess.line.d87.r : "?") +' +
        '    " range=" + (rangeEl ? rangeEl.value : "?") +' +
        '    " toast=" + (toastEl ? toastEl.textContent : "none");' +
        '  var home = document.querySelector(\'[data-route="settings"]\');' +
        '  if (home) home.click();' +
        '  await new Promise(function (r) { setTimeout(r, 400); });' +
        '  return before === after ? "unchanged" + diag : "changed";' +
        '})()'
      );
      if (followed !== 'changed') {
        return fail('the 87L checks did not follow the characteristic (' + followed + ')');
      }
      session.operator.d87Override = null;
      invalidate();
      buildAll();
      console.log('[smoke] 87L checks followed a characteristic change');

      /*
       * Each workflow page carries a second plot holding the generated points,
       * labelled with the identifiers the report uses. An empty one reads as a
       * rendering fault rather than the wiring mistake it would be, so both
       * are checked against their own table and for following their sliders.
       */
      step('generated-point plots');
      const plots = await mainWindow.webContents.executeJavaScript(
        '(async function () {' +
        '  var nav = async function (route) {' +
        '    var link = document.querySelector(\'[data-route="\' + route + \'"]\');' +
        '    if (!link || link.classList.contains("disabled")) return false;' +
        '    link.click();' +
        '    await new Promise(function (r) { setTimeout(r, 1100); });' +
        '    return true;' +
        '  };' +
        '  var labels = function (id) {' +
        '    return Array.prototype.map.call(' +
        '      document.querySelectorAll("#" + id + " text"),' +
        '      function (t) { return t.textContent; }).join(",").split(/[,\\s]+/)' +
        '      .filter(function (s) { return /^[TD]\\d+$/.test(s); });' +
        '  };' +
        '  var places = function (id) {' +
        '    return Array.prototype.map.call(' +
        '      document.querySelectorAll("#" + id + " circle"),' +
        '      function (c) { return c.getAttribute("cx") + ":" + c.getAttribute("cy"); })' +
        '      .join(" ");' +
        '  };' +
        '  var tableIds = function (sel) {' +
        '    return Array.prototype.map.call(document.querySelectorAll(sel + " tr"),' +
        '      function (tr) {' +
        '        var c = tr.querySelector("td");' +
        '        return c ? (c.textContent.match(/[TD]\\d+/) || [""])[0] : "";' +
        '      }).filter(Boolean);' +
        '  };' +
        '  var missing = function (want, got) {' +
        '    return want.filter(function (x) { return got.indexOf(x) < 0; });' +
        '  };' +
        '  if (!(await nav("distance"))) return "distance not reachable";' +
        '  var tIds = tableIds("#tp");' +
        '  if (!tIds.length) return "no distance rows";' +
        '  var gone = missing(tIds, labels("rx2"));' +
        '  if (gone.length) return "rx2 is missing " + gone.join(" ");' +
        '  var rxBefore = places("rx2");' +
        '  var inBox = document.querySelector(\'[data-num="inZonePct"] [data-numrange]\');' +
        '  if (!inBox) return "no in-zone control";' +
        '  inBox.value = "60";' +
        '  inBox.dispatchEvent(new Event("input", { bubbles: true }));' +
        '  await new Promise(function (r) { setTimeout(r, 300); });' +
        '  if (places("rx2") === rxBefore) return "rx2 ignored the in-zone slider";' +
        '  if (!(await nav("differential"))) return "differential not reachable";' +
        '  var dIds = tableIds("#dchecks");' +
        '  if (!dIds.length) return "no 87L rows";' +
        '  gone = missing(dIds, labels("ap2"));' +
        '  if (gone.length) return "ap2 is missing " + gone.join(" ");' +
        '  var apBefore = places("ap2");' +
        '  var rBox = document.querySelector(\'[data-num="d87r"] [data-numrange]\');' +
        '  if (!rBox) return "no 87LR control";' +
        '  rBox.value = "9";' +
        '  rBox.dispatchEvent(new Event("input", { bubbles: true }));' +
        '  await new Promise(function (r) { setTimeout(r, 300); });' +
        '  if (places("ap2") === apBefore) return "ap2 ignored the 87LR slider";' +
        '  var home = document.querySelector(\'[data-route="settings"]\');' +
        '  if (home) home.click();' +
        '  await new Promise(function (r) { setTimeout(r, 400); });' +
        '  return "ok " + tIds.length + " distance, " + dIds.length + " 87L";' +
        '})()'
      );
      if (!/^ok /.test(plots)) {
        return fail('the generated-point plots did not hold up (' + plots + ')');
      }
      console.log('[smoke] second plots carried every table row and followed their sliders (' +
        plots.replace(/^ok /, '') + ')');

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

      /*
       * Omit has to reach the export, and a saved report has to be able to
       * produce its documents again from the snapshot alone.
       */
      step('omit and saved report round trip');
      const fullCount = session.plan.distance.length;
      const omitKey = session.plan.distance[0].lockKey;
      session.omit[omitKey] = true;
      const cut = exportBundle(null);
      if (cut.plan.distance.length !== fullCount - 1 || cut.plan.omittedCount !== 1) {
        return fail('an omitted point still reached the export');
      }
      if (cut.record.tests.length !== fullCount - 1) {
        return fail('the record still holds the omitted point');
      }
      /*
       * Omissions are silent by design. Check the parts that get rendered --
       * the bookkeeping fields on the record are not printed anywhere.
       */
      const rendered = JSON.stringify([
        cut.record.assumptions, cut.record.tests, cut.record.derived
      ]);
      if (/omit/i.test(rendered)) return fail('the record still refers to an omitted point');
      // The CSV is the working file and does state it, by design.
      const csvText = testPlanCsv({
        plan: cut.plan, line: cut.line, names: cut.names, signoff: {}
      });
      if (!/Omitted from this report/.test(csvText)) {
        return fail('the csv no longer states what was omitted');
      }

      // The report name has to reach the export, not just the screen.
      session.reportTitle = 'Spring outage — Line 1';
      const named = exportBundle(null);
      if (named.title !== 'Spring outage — Line 1') return fail('the report name did not reach the export');
      if (!/Spring_outage/.test(named.base)) {
        return fail('the report name did not reach the file name (got ' + named.base + ')');
      }
      session.reportTitle = null;

      const savedSmoke = store.saveReport({
        title: 'smoke round trip',
        names: session.names,
        counts: cut.plan.counts,
        omittedCount: cut.plan.omittedCount,
        line: cut.line,
        plan: cut.plan,
        record: cut.record,
        provenance: cut.provenance,
        signoff: {}
      });
      // Read it back the way a download from the archive would.
      const reloaded = exportBundle(savedSmoke.id);
      if (reloaded.plan.distance.length !== cut.plan.distance.length) {
        return fail('a saved report did not reload with the same test points');
      }
      const savedPdf = await testReportPdf({
        plan: reloaded.plan, line: reloaded.line, names: reloaded.names, org: {}, signoff: {}
      });
      if (savedPdf.length < 2000) return fail('a saved report produced an empty PDF');
      store.deleteReport(savedSmoke.id);
      delete session.omit[omitKey];
      invalidate();
      buildAll();
      console.log('[smoke] omit reached the export; saved report re-exported from its snapshot');

      step('experimental deviation reporting');
      const baseDev = experimentalDeviations().length;
      const keepCurrent = session.operator.testCurrent;
      session.operator.testCurrent = keepCurrent + 2.5;
      const devs = experimentalDeviations();
      session.operator.testCurrent = keepCurrent;
      if (!devs.some((d) => /Test current/.test(d.label))) {
        return fail('a changed setting was not reported as experimental');
      }
      if (experimentalDeviations().length !== baseDev) {
        return fail('experimental deviations did not clear when the setting went back');
      }

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
        '  var home = document.querySelector(\'[data-route="settings"]\');' +
        '  if (home) home.click();' +
        '  await new Promise(function (r) { setTimeout(r, 400); });' +
        '  var demo = document.querySelector(\'[data-act="demo"]\');' +
        '  if (!demo) return "settings screen not reachable";' +
        '  demo.click();' +
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

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  session.operator = Object.assign({}, DEFAULT_OPERATOR, store.getConfig().defaults);

  /* Load a pair before the window boots, so screenshots and checks can run
   * against real exports rather than the demo line. */
  for (const end of ['local', 'remote']) {
    const from = process.env['ENDER_LOAD_' + end.toUpperCase()];
    if (!from) continue;
    try {
      await loadEnd(end, from);
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
