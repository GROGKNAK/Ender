'use strict';
/*
 * Everything that has to outlive a run: system configuration, theme, and the
 * saved report archive.
 *
 * Reports are plain JSON files in a folder rather than rows in a database so
 * they survive an uninstall, can be backed up by copying a directory, and can
 * be read by something other than this program in ten years' time. A test
 * record that is only readable by the tool that wrote it is not much of a
 * record.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* Shared with the web build so both shells start from the same values. */
const {
  DEFAULT_LABELS, DEFAULT_CONFIG, DEFAULT_THEME, mergeConfig, mergeTheme, clone
} = require('../core/defaults');

class Store {
  constructor(root) {
    this.root = root;
    this.reportsDir = path.join(root, 'reports');
    fs.mkdirSync(this.reportsDir, { recursive: true });
  }

  file(name) {
    return path.join(this.root, name);
  }

  readJson(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    } catch (err) {
      return fallback;
    }
  }

  /* Write to a temporary file and rename, so a crash mid-write cannot leave a
   * truncated config behind. */
  writeJson(name, value) {
    const target = this.file(name);
    const tmp = target + '.tmp';
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, target);
    return value;
  }

  getConfig() {
    return mergeConfig(this.readJson('config.json', {}));
  }

  setConfig(patch) {
    const next = Object.assign(this.getConfig(), patch || {});
    return this.writeJson('config.json', next);
  }

  resetConfig() {
    return this.writeJson('config.json', clone(DEFAULT_CONFIG));
  }

  getTheme() {
    return mergeTheme(this.readJson('theme.json', {}));
  }

  setTheme(patch) {
    return this.writeJson('theme.json', Object.assign(this.getTheme(), patch || {}));
  }

  resetTheme() {
    return this.writeJson('theme.json', clone(DEFAULT_THEME));
  }

  /* ---------------------------------------------------------- reports --- */

  nextReportId() {
    const used = this.listReports().map((r) => Number(String(r.id).replace(/\D/g, '')) || 0);
    const next = (used.length ? Math.max(...used) : 0) + 1;
    return 'R-' + String(next).padStart(4, '0');
  }

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
    this.writeJson(path.join('reports', id + '.json'), record);
    return record;
  }

  listReports() {
    let names = [];
    try {
      names = fs.readdirSync(this.reportsDir).filter((f) => f.endsWith('.json'));
    } catch (err) {
      return [];
    }
    const out = [];
    for (const name of names) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(this.reportsDir, name), 'utf8'));
        const stat = fs.statSync(path.join(this.reportsDir, name));
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
          // Older saves hold no snapshot and cannot be regenerated.
          exportable: Boolean(r.plan && r.line),
          size: stat.size
        });
      } catch (err) {
        // A corrupt file should not hide the rest of the archive.
        out.push({ id: name.replace(/\.json$/, ''), broken: true, savedAt: null });
      }
    }
    return out.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  getReport(id) {
    return this.readJson(path.join('reports', String(id) + '.json'), null);
  }

  deleteReport(id) {
    try {
      fs.unlinkSync(path.join(this.reportsDir, String(id) + '.json'));
      return true;
    } catch (err) {
      return false;
    }
  }

  usage() {
    const reports = this.listReports();
    const bytes = reports.reduce((sum, r) => sum + (r.size || 0), 0);
    const dates = reports.map((r) => r.savedAt).filter(Boolean).sort();
    return {
      dir: this.reportsDir,
      count: reports.length,
      bytes,
      oldest: dates[0] || null
    };
  }
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

module.exports = { Store, DEFAULT_CONFIG, DEFAULT_THEME, DEFAULT_LABELS, sha256 };
