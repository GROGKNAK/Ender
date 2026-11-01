'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

/*
 * The only surface the renderer gets. Nothing here hands out raw fs, path or
 * ipcRenderer access -- every call is a named operation, and the renderer
 * cannot reach a channel that is not listed below.
 *
 * Main returns { ok, value } or { ok: false, error }; unwrapping it here means
 * a failure surfaces as a thrown error at the call site rather than as an
 * undefined that quietly renders as a blank panel.
 */

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || res.ok !== true) throw new Error((res && res.error) || 'Unknown error');
  return res.value;
}

contextBridge.exposeInMainWorld('ender', {
  appInfo: () => call('app:info'),

  files: {
    pick: (end) => call('files:pick', end),
    pickFolder: (end) => call('files:pickFolder', end),
    load: (end, filePath) => call('files:load', end, filePath),
    loadDemo: () => call('files:loadDemo'),

    /*
     * The real path of a dropped File. `File.path` was the old way and has
     * been on its way out since Electron 29, so ask webUtils first and keep
     * the old property only as a fallback. Returns '' when neither works, so
     * the caller can say so instead of passing undefined to the main process.
     */
    pathFor: (file) => {
      try {
        const p = webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : '';
        if (p) return p;
      } catch (err) {
        // fall through to the legacy property
      }
      return (file && file.path) || '';
    }
  },

  session: {
    get: () => call('session:get'),
    clear: () => call('session:clear'),
    setName: (end, name) => call('session:setName', end, name),
    swap: () => call('session:swap'),
    setOperator: (patch) => call('session:setOperator', patch),
    setD87Override: (patch) => call('session:setD87Override', patch),
    clearExperimental: () => call('session:clearExperimental'),
    setSignoff: (key, value) => call('session:setSignoff', key, value),
    setOmit: (key, omitted) => call('session:setOmit', key, omitted),
    setReportTitle: (title) => call('session:setReportTitle', title)
  },

  plan: {
    build: () => call('plan:build'),
    lock: (key) => call('plan:lock', key),
    unlock: (key) => call('plan:unlock', key),
    unlockAll: () => call('plan:unlockAll')
  },

  record: {
    build: () => call('record:build')
  },

  /* Each export takes an optional saved-report id; without one it uses the
   * live session. */
  exports: {
    csv: (savedId) => call('export:csv', savedId),
    reportPdf: (savedId) => call('export:reportPdf', savedId),
    recordPdf: (savedId) => call('export:recordPdf', savedId)
  },

  config: {
    get: () => call('config:get'),
    set: (patch) => call('config:set', patch),
    reset: () => call('config:reset')
  },

  theme: {
    get: () => call('theme:get'),
    set: (patch) => call('theme:set', patch),
    reset: () => call('theme:reset')
  },

  reports: {
    list: () => call('reports:list'),
    usage: () => call('reports:usage'),
    get: (id) => call('reports:get', id),
    save: (extra) => call('reports:save', extra),
    rename: (id, title) => call('reports:rename', id, title),
    remove: (id) => call('reports:delete', id)
  },

  shell: {
    reveal: (target) => call('shell:show', target),
    openPath: (target) => call('shell:openPath', target)
  },

  onMenu: (handler) => {
    const allowed = ['load-local', 'load-remote', 'load-demo', 'export-report', 'export-record', 'export-csv'];
    ipcRenderer.on('menu', (_e, action) => {
      if (allowed.includes(action)) handler(action);
    });
  }
});
