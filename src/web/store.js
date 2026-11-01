'use strict';
/*
 * The browser's version of the desktop store.
 *
 * Same interface, different shelf. Settings and the theme are small and live
 * in localStorage; saved reports carry a whole plan and calculation record
 * and would run localStorage out of room after a dozen or so, so they go in
 * IndexedDB.
 *
 * IndexedDB is asynchronous and the session reads a saved report
 * synchronously when exporting it, so the whole archive is read into memory
 * once at startup and written through from there. For the number of reports
 * one person produces that costs little, and it keeps the shared session
 * module free of any knowledge that this shell is different.
 *
 * Everything here stays on the machine it was typed on. There is no server to
 * send relay settings to, which is the point: a static page and a browser.
 */

const { DEFAULT_CONFIG, DEFAULT_THEME, mergeConfig, mergeTheme, clone } = require('../core/defaults');

const DB = 'ender';
const SHELF = 'reports';
const CONFIG_KEY = 'ender:config';
const THEME_KEY = 'ender:theme';

function readLocal(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    // Private windows and blocked site data both land here. Defaults are a
    // perfectly good answer; losing the session to it would not be.
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    /* nothing stored, nothing lost but the preference */
  }
  return value;
}

function openDb() {
  return new Promise((resolve) => {
    let req;
    try {
      req = window.indexedDB.open(DB, 1);
    } catch (err) {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHELF)) db.createObjectStore(SHELF, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    // No database means reports last only as long as the tab. The archive
    // page says so rather than letting someone believe they are filed.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function allFrom(db) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SHELF, 'readonly');
      const req = tx.objectStore(SHELF).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (err) {
      resolve([]);
    }
  });
}

class WebStore {
  constructor(db, seed) {
    this.db = db;
    this.durable = Boolean(db);
    this.reports = new Map();
    for (const r of seed) this.reports.set(String(r.id), r);
  }

  static async open() {
    const db = await openDb();
    return new WebStore(db, db ? await allFrom(db) : []);
  }

  /* ----------------------------------------------------- preferences --- */

  getConfig() { return mergeConfig(readLocal(CONFIG_KEY, {})); }
  setConfig(patch) { return writeLocal(CONFIG_KEY, Object.assign(this.getConfig(), patch || {})); }
  resetConfig() { return writeLocal(CONFIG_KEY, clone(DEFAULT_CONFIG)); }

  getTheme() { return mergeTheme(readLocal(THEME_KEY, {})); }
  setTheme(patch) { return writeLocal(THEME_KEY, Object.assign(this.getTheme(), patch || {})); }
  resetTheme() { return writeLocal(THEME_KEY, clone(DEFAULT_THEME)); }

  /* --------------------------------------------------------- reports --- */

  nextReportId() {
    const used = [...this.reports.keys()].map((id) => Number(String(id).replace(/\D/g, '')) || 0);
    return 'R-' + String((used.length ? Math.max(...used) : 0) + 1).padStart(4, '0');
  }

  /* Written to memory first so the next read is correct whatever the
   * database does; a failure to persist is reported, not swallowed. */
  saveReport(report) {
    const id = report.id || this.nextReportId();
    const now = new Date().toISOString();
    const record = Object.assign({}, report, {
      id,
      // Keep when it was first saved, so renaming or re-saving does not
      // reshuffle the archive or disguise how old a report is.
      savedAt: report.savedAt || now,
      updatedAt: now
    });
    this.reports.set(String(id), record);
    this.persist(record);
    return record;
  }

  persist(record) {
    if (!this.db) return;
    try {
      this.db.transaction(SHELF, 'readwrite').objectStore(SHELF).put(clone(record));
    } catch (err) {
      this.durable = false;
    }
  }

  listReports() {
    const out = [];
    for (const r of this.reports.values()) {
      out.push({
        id: r.id,
        title: r.title || ((r.names && (r.names.local + ' – ' + r.names.remote)) || r.id),
        savedAt: r.savedAt,
        updatedAt: r.updatedAt || r.savedAt,
        names: r.names || {},
        relays: r.relays || {},
        counts: r.counts || {},
        model: r.model,
        engineer: r.engineer || '',
        status: r.status || 'Generated',
        fingerprint: r.fingerprint || '',
        omittedCount: r.omittedCount || 0,
        lockedCount: r.lockedCount || 0,
        exportable: Boolean(r.plan && r.line),
        size: this.sizeOf(r)
      });
    }
    return out.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  sizeOf(record) {
    try {
      return new Blob([JSON.stringify(record)]).size;
    } catch (err) {
      return 0;
    }
  }

  getReport(id) { return this.reports.get(String(id)) || null; }

  deleteReport(id) {
    const key = String(id);
    if (!this.reports.delete(key)) return false;
    if (this.db) {
      try {
        this.db.transaction(SHELF, 'readwrite').objectStore(SHELF).delete(key);
      } catch (err) {
        /* gone from this session either way */
      }
    }
    return true;
  }

  usage() {
    const reports = this.listReports();
    const dates = reports.map((r) => r.savedAt).filter(Boolean).sort();
    return {
      dir: this.durable
        ? 'This browser, on this machine'
        : 'This tab only — the browser would not open a database, so reports are not being kept',
      count: reports.length,
      bytes: reports.reduce((sum, r) => sum + (r.size || 0), 0),
      oldest: dates[0] || null,
      durable: this.durable
    };
  }
}

module.exports = { WebStore };
