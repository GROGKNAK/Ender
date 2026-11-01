'use strict';
/*
 * The working session: which two files are loaded, what the operator has
 * changed, what is locked, what is omitted, and how all that turns into a
 * plan, a record and an export bundle.
 *
 * This holds no platform. Reading a file, hashing it, saving a report and
 * asking where to write a PDF all differ between the desktop app and the web
 * build, so they arrive as a small adapter object. Everything that decides
 * what a report *contains* lives here, once, for the same reason the plot
 * geometry does: the two builds are the same instrument, and a test record
 * that depends on which one produced it would be worth very little.
 *
 * The adapter must provide:
 *   readSource(target)  -> { sources:[{name,text}], label, kind }  (may be async)
 *   hash(text)          -> hex digest                              (may be async)
 *   byteLength(text)    -> number
 *   basename(target)    -> file name, used only when a relay carries no RID
 *   appVersion()        -> string, stamped into the calculation record
 *   store.getConfig()   -> { defaults, org, ... }
 *   store.getReport(id) -> a saved snapshot, or null
 */

const { parseMany } = require('./parseSettings');
const { buildRelay, validateRelay, compareEnds } = require('./relay');
const { buildLine, DEFAULT_OPERATOR, FAULT_MODELS } = require('./line');
const { buildPlan, applyOmissions } = require('./testplan');
const { buildRecord } = require('./record');

function slug(s) {
  return String(s || 'ender').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'ender';
}

function createSession(platform) {
  /*
   * Held here rather than in the view so that a navigation, a reload or a
   * crashed screen cannot lose a half-entered run.
   */
  const session = {
    local: null,
    remote: null,
    names: { local: '', remote: '' },
    operator: Object.assign({}, DEFAULT_OPERATOR),
    signoff: {},
    /*
     * Locked test points, by lock key. A lock holds the frozen row and the
     * settings it was computed under, so experimenting elsewhere cannot move
     * a test line that has already been agreed.
     */
    locks: {},
    /* Test points marked omit-from-report, by lock key. They stay in the app
     * and are dropped only when exporting. */
    omit: {},
    /* What this report is called. Null means follow the two station names;
     * once set by hand it stays put even if the stations are renamed. */
    reportTitle: null,
    plan: null,
    record: null,
    reportId: null
  };

  /** Anything derived is discarded whenever an input changes. */
  function invalidate() {
    session.plan = null;
    session.record = null;
  }

  async function loadEnd(end, target) {
    const source = await platform.readSource(target);
    const parsed = parseMany(source.sources, {});
    const rawText = source.sources.map((s) => s.text).join('\n');
    const relay = buildRelay(parsed, { fileName: source.label, rawText });
    session[end] = {
      end,
      filePath: target,
      fileName: source.label,
      sourceKind: source.kind,
      fileCount: source.sources.length,
      files: parsed.files || [],
      bytes: platform.byteLength(rawText),
      hash: await platform.hash(rawText),
      relay,
      problems: validateRelay(relay)
    };
    /*
     * A station name the user can recognise. The relay's own RID is the right
     * answer when it has one; the file name is the fallback. The file name is
     * derived from the target the caller gave us, not from a variable that
     * only exists on the entry -- getting that wrong here used to throw for
     * any relay whose settings carry no RID.
     */
    if (!session.names[end]) {
      session.names[end] = relay.rid || platform.basename(target).replace(/\.[^.]+$/, '');
    }
    invalidate();
    return summary();
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

  /*
   * Where the current settings depart from the stored defaults.
   *
   * Experimenting is the point, but a report built on an override should say
   * so on its face rather than leaving someone to work out why the numbers
   * moved.
   */
  function experimentalDeviations() {
    const base = platform.store.getConfig().defaults;
    const op = session.operator;
    const out = [];
    const fields = [
      ['faultModel', 'Fault model', (v) => FAULT_MODELS[v] || v],
      ['testCurrent', 'Test current', (v) => v + ' A'],
      ['vnom', 'Nominal voltage', (v) => v + ' V'],
      ['infeed', 'Remote infeed', (v) => String(v)],
      ['inZonePct', 'In-zone point', (v) => v + '%'],
      ['outZonePct', 'Out-of-zone point', (v) => v + '%'],
      ['warnVolts', 'Warn above', (v) => v + ' V']
    ];
    for (const [key, label, fmt] of fields) {
      if (base[key] === undefined || op[key] === undefined) continue;
      if (String(op[key]) !== String(base[key])) {
        out.push({ label, now: fmt(op[key]), was: fmt(base[key]) });
      }
    }
    if (op.d87Override && Object.keys(op.d87Override).length) {
      const parts = Object.entries(op.d87Override)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => ({ r: '87LR', ang: '87LANG', pickup: '87LPP' }[k] + ' = ' + v));
      if (parts.length) {
        out.push({ label: '87L characteristic', now: parts.join(', '), was: 'as set in the relay' });
      }
    }
    const dirs = op.zoneDirections || {};
    const dirKeys = Object.keys(dirs);
    if (dirKeys.length) {
      out.push({
        label: 'Zone direction',
        now: dirKeys.map((k) => 'Zone ' + k + ' ' + dirs[k]).join(', '),
        was: 'as set in the relay'
      });
    }
    return out;
  }

  function reportTitle() {
    if (session.reportTitle) return session.reportTitle;
    const l = session.names.local || 'Local';
    const r = session.names.remote || 'Remote';
    return l + ' – ' + r;
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
      omit: session.omit,
      omittedCount: Object.keys(session.omit).length,
      reportTitle: both ? reportTitle() : '',
      reportTitleCustom: Boolean(session.reportTitle),
      comparison,
      line,
      experimental: both ? experimentalDeviations() : [],
      faultModels: FAULT_MODELS,
      ready: Boolean(both && line && !line.error),
      hasPlan: Boolean(session.plan),
      reportId: session.reportId
    };
  }

  function requireLine() {
    if (!session.local || !session.remote) {
      throw new Error('Both settings files must be loaded first');
    }
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
      meta: { appVersion: platform.appVersion() }
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

  async function fingerprint() {
    return (await platform.hash(
      ['local', 'remote'].map((e) => (session[e] ? session[e].hash : '')).join('|')
    )).slice(0, 16);
  }

  function baseName() {
    return slug(session.names.local) + '-' + slug(session.names.remote);
  }

  /*
   * Everything an export needs, from a saved snapshot or from the live
   * session. This is the one place omissions are applied, which is why the
   * report, the CSV and the plots all agree about what is in the run without
   * any of them filtering for themselves.
   */
  function exportBundle(savedId) {
    if (savedId) {
      const saved = platform.store.getReport(savedId);
      if (!saved) throw new Error('No saved report with id ' + savedId);
      if (!saved.plan || !saved.line) {
        throw new Error('Report ' + savedId + ' was saved before exports were self-contained, ' +
          'so it cannot be regenerated. Re-run it from the settings files.');
      }
      return {
        line: saved.line,
        plan: saved.plan,
        record: saved.record,
        names: saved.names || {},
        signoff: saved.signoff || {},
        provenance: saved.provenance || [],
        title: saved.title || saved.id,
        base: slug(saved.title || saved.id)
      };
    }

    const line = requireLine();
    if (!session.plan) buildAll();
    const plan = applyOmissions(session.plan, session.omit);
    const record = buildRecord({
      line,
      plan,
      local: session.local.relay,
      remote: session.remote.relay,
      meta: { appVersion: platform.appVersion() }
    });
    return {
      line,
      plan,
      record,
      names: session.names,
      signoff: session.signoff,
      provenance: provenance(),
      title: reportTitle(),
      base: slug(reportTitle())
    };
  }

  /* ---------------------------------------------------- operations --- */

  function setName(end, name) {
    session.names[end] = String(name || '').trim() || session.names[end];
    return summary();
  }

  function swap() {
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
  }

  function setOperator(patch) {
    session.operator = Object.assign({}, session.operator, patch || {});
    invalidate();
    return summary();
  }

  function setSignoff(key, value) {
    session.signoff[key] = value;
    return { signoff: session.signoff };
  }

  function setReportTitle(title) {
    const next = String(title === null || title === undefined ? '' : title).trim();
    // Clearing it goes back to following the station names.
    session.reportTitle = next || null;
    return summary();
  }

  function setOmit(key, omitted) {
    if (omitted) session.omit[key] = true;
    else delete session.omit[key];
    return { omit: session.omit, omittedCount: Object.keys(session.omit).length };
  }

  /*
   * Locking freezes a row as it stands. The row is captured from a plan built
   * with the lock absent, so locking never captures an already-frozen copy of
   * itself, and the operator settings travel with it for the record.
   */
  function lock(key) {
    const line = requireLine();
    const live = buildPlan(line, { locks: {} });
    const row = live.distance.find((r) => r.lockKey === key) ||
      live.differential.find((d) => d.lockKey === key);
    if (!row) throw new Error('No such test point: ' + key);
    session.locks[key] = {
      row,
      operator: JSON.parse(JSON.stringify(session.operator)),
      at: new Date().toISOString()
    };
    invalidate();
    return buildAll().plan;
  }

  function unlock(key) {
    delete session.locks[key];
    invalidate();
    return buildAll().plan;
  }

  function unlockAll() {
    session.locks = {};
    invalidate();
    return buildAll().plan;
  }

  /*
   * Experimental settings are everything the operator can change after the
   * files are loaded. Clearing returns to the stored defaults, leaving locked
   * rows alone -- that is the point of locking them.
   */
  function clearExperimental() {
    session.operator = Object.assign(
      {}, DEFAULT_OPERATOR, platform.store.getConfig().defaults, { d87Override: null }
    );
    invalidate();
    return summary();
  }

  function setD87Override(patch) {
    if (!patch) session.operator.d87Override = null;
    else session.operator.d87Override = Object.assign({}, session.operator.d87Override, patch);
    invalidate();
    return summary();
  }

  function clear() {
    session.local = null;
    session.remote = null;
    session.names = { local: '', remote: '' };
    session.signoff = {};
    session.locks = {};
    session.omit = {};
    session.reportTitle = null;
    session.reportId = null;
    invalidate();
  }

  return {
    state: session,
    invalidate,
    loadEnd,
    summary,
    endSummary,
    experimentalDeviations,
    reportTitle,
    requireLine,
    buildAll,
    provenance,
    fingerprint,
    baseName,
    exportBundle,
    clear,
    setName,
    swap,
    setOperator,
    setSignoff,
    setReportTitle,
    setOmit,
    lock,
    unlock,
    unlockAll,
    clearExperimental,
    setD87Override
  };
}

module.exports = { createSession, slug };
