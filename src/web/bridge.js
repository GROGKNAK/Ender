'use strict';
/*
 * The web build's half of the preload bridge.
 *
 * The views were written against `window.ender` and know nothing about how it
 * is served. On the desktop every call crosses to the main process over IPC;
 * here the same operations run in the page against the same shared session,
 * so the two builds answer the same questions with the same code and the
 * views did not have to change at all.
 *
 * What differs is only what a browser cannot do: there is no save dialog, so
 * exports go to the downloads folder, and there is no file manager to reveal
 * anything in. Those say so plainly rather than failing quietly.
 */

const { createSession } = require('../core/session');
const { DEFAULT_OPERATOR } = require('../core/line');
const { testPlanCsv } = require('../core/csv');
const { testReportPdf, recordPdf } = require('../core/pdf');
const { WebStore } = require('./store');
const P = require('./platform');

/*
 * The views read the plot geometry off a global, because on the desktop it is
 * loaded by a plain script tag. Required here so that global exists however
 * the rest of the graph happens to be ordered, rather than by way of whatever
 * else pulls it in.
 */
require('../core/plot');

const DEMO = {
  local: 'DEMO_ALPHA_LN1_Settings.html',
  remote: 'DEMO_BRAVO_LN1_Settings.html'
};

async function install() {
  const manifest = window.__enderManifest || {};
  const version = manifest.version || '0.0.0';
  const store = await WebStore.open();

  const S = createSession({
    readSource: P.readSource,
    hash: P.hash,
    byteLength: P.byteLength,
    // A token stands for a chosen file; its label is the file's own name,
    // which is what the station-name fallback wants.
    basename: P.labelOf,
    appVersion: () => version,
    store: {
      getConfig: () => store.getConfig(),
      getReport: (id) => store.getReport(id)
    }
  });

  const session = S.state;
  session.operator = Object.assign({}, DEFAULT_OPERATOR, store.getConfig().defaults);

  /* ------------------------------------------------------- exports --- */

  const org = () => store.getConfig().org;

  async function exportCsv(savedId) {
    const b = S.exportBundle(savedId);
    return P.download(
      b.base + '-tests.csv',
      testPlanCsv({ plan: b.plan, line: b.line, names: b.names, signoff: b.signoff }),
      'text/csv;charset=utf-8'
    );
  }

  async function exportReport(savedId) {
    const b = S.exportBundle(savedId);
    const bytes = await testReportPdf({
      plan: b.plan, line: b.line, names: b.names, org: org(),
      signoff: b.signoff, reportTitle: b.title
    });
    return P.download(b.base + '-report.pdf', bytes, 'application/pdf');
  }

  async function exportRecord(savedId) {
    const b = S.exportBundle(savedId);
    if (!b.record) throw new Error('That saved report holds no calculation record');
    const bytes = await recordPdf({
      record: b.record, line: b.line, names: b.names,
      org: org(), provenance: b.provenance, reportTitle: b.title
    });
    return P.download(b.base + '-calculation-record.pdf', bytes, 'application/pdf');
  }

  /* ------------------------------------------------------- the API --- */

  const notHere = (what) => () => {
    throw new Error(what + ' is a desktop feature; this is the browser version.');
  };

  window.ender = {
    appInfo: async () => ({
      version,
      platform: 'web',
      arch: navigator.platform || 'browser',
      electron: null,
      node: null,
      userAgent: navigator.userAgent,
      samplesDir: 'samples/',
      reportsDir: store.usage().dir
    }),

    files: {
      pick: async (end) => {
        const token = await P.pick();
        return token ? S.loadEnd(end, token) : null;
      },
      pickFolder: async (end) => {
        const token = await P.pickFolder();
        return token ? S.loadEnd(end, token) : null;
      },
      load: async (end, target) => S.loadEnd(end, target),
      loadDemo: async () => {
        for (const end of ['local', 'remote']) {
          await S.loadEnd(end, await P.demoToken(end, DEMO[end]));
        }
        return S.summary();
      },
      /*
       * The desktop asks Electron for a dropped file's real path. A browser
       * has no such thing and should not: the file is read in the page. The
       * token returned here stands for it for as long as the tab is open,
       * which is all `load` needs.
       */
      pathFor: (file) => (file ? P.tokenFor(file) : '')
    },

    session: {
      get: async () => S.summary(),
      clear: async () => { S.clear(); return S.summary(); },
      setName: async (end, name) => S.setName(end, name),
      swap: async () => S.swap(),
      setOperator: async (patch) => S.setOperator(patch),
      setD87Override: async (patch) => S.setD87Override(patch),
      clearExperimental: async () => S.clearExperimental(),
      setSignoff: async (key, value) => S.setSignoff(key, value),
      setOmit: async (key, omitted) => S.setOmit(key, omitted),
      setReportTitle: async (title) => S.setReportTitle(title)
    },

    plan: {
      build: async () => S.buildAll().plan,
      lock: async (key) => S.lock(key),
      unlock: async (key) => S.unlock(key),
      unlockAll: async () => S.unlockAll()
    },

    record: {
      build: async () => {
        S.buildAll();
        return session.record;
      }
    },

    exports: {
      csv: exportCsv,
      reportPdf: exportReport,
      recordPdf: exportRecord
    },

    config: {
      get: async () => store.getConfig(),
      set: async (patch) => store.setConfig(patch),
      reset: async () => store.resetConfig()
    },

    theme: {
      get: async () => store.getTheme(),
      set: async (patch) => store.setTheme(patch),
      reset: async () => store.resetTheme()
    },

    reports: {
      list: async () => store.listReports(),
      usage: async () => store.usage(),
      get: async (id) => store.getReport(id),
      save: async (extra) => {
        const b = S.exportBundle(null);
        const saved = store.saveReport(Object.assign({
          id: session.reportId,
          title: b.title,
          names: session.names,
          relays: {
            local: S.endSummary(session.local, session.names.local),
            remote: S.endSummary(session.remote, session.names.remote)
          },
          operator: session.operator,
          signoff: session.signoff,
          omit: session.omit,
          locks: session.locks,
          counts: b.plan.counts,
          omittedCount: b.plan.omittedCount || 0,
          lockedCount: b.plan.lockedCount || 0,
          model: session.operator.faultModel,
          fingerprint: await S.fingerprint(),
          provenance: b.provenance,
          line: b.line,
          plan: b.plan,
          record: b.record
        }, extra || {}));
        session.reportId = saved.id;
        return saved;
      },
      rename: async (id, title) => {
        const saved = store.getReport(id);
        if (!saved) throw new Error('No saved report with id ' + id);
        const next = String(title || '').trim();
        if (!next) throw new Error('A report needs a name');
        saved.title = next;
        store.saveReport(saved);
        return saved;
      },
      remove: async (id) => store.deleteReport(id)
    },

    shell: {
      reveal: notHere('Showing a file in its folder'),
      openPath: notHere('Opening a file')
    },

    /*
     * No application menu in a browser. The handler is accepted and never
     * called: every action it covers has a button on screen, and pretending
     * to register a menu would be worse than doing nothing visibly.
     */
    onMenu: () => {}
  };

  return window.ender;
}

module.exports = { install };
