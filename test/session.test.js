'use strict';
/*
 * The session, driven with no platform at all.
 *
 * These tests are the reason core/session.js exists: if the working session
 * can be exercised with a handful of fake adapters, then the desktop app and
 * the web build are running the same decisions about what a report contains,
 * and only the file system and the dialogs differ between them.
 */
const test = require('node:test');
const assert = require('node:assert');

const { createSession, slug } = require('../src/core/session');

const SAMPLE = `<table>
  <tr><td>RID</td><td>ALPHA_LN1</td></tr>
  <tr><td>Z1MAG</td><td>8.32</td><td>Z1ANG</td><td>84.50</td></tr>
  <tr><td>Z0MAG</td><td>24.50</td><td>Z0ANG</td><td>78.20</td></tr>
  <tr><td>Z1P</td><td>7.07</td></tr><tr><td>Z2P</td><td>12.48</td></tr>
  <tr><td>87LR</td><td>6.00</td></tr><tr><td>87LANG</td><td>195.00</td></tr>
  <tr><td>87LPP</td><td>1.00</td></tr>
  <tr><td>CTR</td><td>240</td></tr><tr><td>PTR</td><td>2000</td></tr>
</table><p>FID = SEL-411L-R110</p>`;

const NO_RID = SAMPLE.replace('<tr><td>RID</td><td>ALPHA_LN1</td></tr>', '');

/*
 * A platform made of nothing. The hash is deliberately trivial -- the session
 * only ever compares and truncates it -- and returning a promise keeps the
 * async path honest, since the browser's digest is async and node's is not.
 */
function fakePlatform(files, config) {
  const reports = new Map();
  return {
    reports,
    adapter: {
      readSource: async (target) => ({
        sources: [{ name: target, text: files[target] }],
        label: target,
        kind: 'html'
      }),
      hash: async (text) => {
        let h = 0;
        for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
        return h.toString(16).padStart(8, '0').repeat(8);
      },
      byteLength: (text) => text.length,
      basename: (target) => target.split(/[\\/]/).pop(),
      appVersion: () => '0.0.0-test',
      store: {
        getConfig: () => config || { defaults: {}, org: {} },
        getReport: (id) => reports.get(id) || null
      }
    }
  };
}

async function loaded(extra) {
  const files = Object.assign({ 'A.html': SAMPLE, 'B.html': SAMPLE }, extra || {});
  const p = fakePlatform(files);
  const S = createSession(p.adapter);
  await S.loadEnd('local', 'A.html');
  await S.loadEnd('remote', 'B.html');
  return { S, p };
}

test('a session reaches ready with two files and no platform to speak of', async () => {
  const { S } = await loaded();
  const sum = S.summary();
  assert.strictEqual(sum.ready, true);
  assert.strictEqual(sum.names.local, 'ALPHA_LN1');
  assert.ok(sum.line && !sum.line.error);
  assert.ok(sum.local.settingCount > 0);
});

test('a relay with no RID is named from its file instead of throwing', async () => {
  /*
   * This used to reference a variable that did not exist in scope, so any
   * settings file without an RID took down the load with a ReferenceError
   * rather than falling back. Every sample carries an RID, which is why it
   * went unnoticed.
   */
  const files = { 'A.html': SAMPLE, 'NO_RID_END.html': NO_RID };
  const p = fakePlatform(files);
  const S = createSession(p.adapter);
  await S.loadEnd('local', 'A.html');
  await S.loadEnd('remote', 'NO_RID_END.html');

  assert.strictEqual(S.summary().names.remote, 'NO_RID_END');
});

test('a name the user set is not overwritten by the next load', async () => {
  const { S } = await loaded();
  S.state.names.local = 'Substation Alpha';
  await S.loadEnd('local', 'A.html');
  assert.strictEqual(S.summary().names.local, 'Substation Alpha');
});

test('the export bundle is where omission happens, once, for every exporter', async () => {
  const { S } = await loaded();
  S.buildAll();
  const before = S.exportBundle(null);
  const victim = before.plan.distance[3];

  S.state.omit[victim.lockKey] = true;
  const after = S.exportBundle(null);

  assert.strictEqual(after.plan.distance.length, before.plan.distance.length - 1);
  assert.ok(!after.plan.distance.some((r) => r.id === victim.id));
  // The record is rebuilt from the trimmed plan, not the full one.
  assert.strictEqual(after.record.tests.length, after.plan.distance.length);
});

test('an export from a saved snapshot uses the snapshot, not the live session', async () => {
  const { S, p } = await loaded();
  S.buildAll();
  const live = S.exportBundle(null);
  p.reports.set('r1', {
    id: 'r1', title: 'As left', line: live.line, plan: live.plan,
    record: live.record, names: { local: 'OLD_A', remote: 'OLD_B' }
  });

  // Move the live session well away from what was saved.
  S.state.names.local = 'NEW_A';
  S.state.operator.inZonePct = 60;
  S.invalidate();

  const saved = S.exportBundle('r1');
  assert.strictEqual(saved.title, 'As left');
  assert.strictEqual(saved.names.local, 'OLD_A');
  assert.strictEqual(saved.plan.distance[0].pctOfReach, live.plan.distance[0].pctOfReach);
});

test('a snapshot saved before exports were self-contained says so', async () => {
  const { S, p } = await loaded();
  p.reports.set('old', { id: 'old', title: 'Legacy' });
  assert.throws(() => S.exportBundle('old'), /cannot be regenerated/);
  assert.throws(() => S.exportBundle('missing'), /No saved report/);
});

test('experimental deviations are measured against the stored defaults', async () => {
  const files = { 'A.html': SAMPLE, 'B.html': SAMPLE };
  const p = fakePlatform(files, { defaults: { inZonePct: 85, testCurrent: 5 }, org: {} });
  const S = createSession(p.adapter);
  await S.loadEnd('local', 'A.html');
  await S.loadEnd('remote', 'B.html');

  S.state.operator.inZonePct = 85;
  S.state.operator.testCurrent = 5;
  assert.deepStrictEqual(S.experimentalDeviations(), [], 'defaults are not a deviation');

  S.state.operator.inZonePct = 70;
  const devs = S.experimentalDeviations();
  assert.strictEqual(devs.length, 1);
  assert.strictEqual(devs[0].now, '70%');
  assert.strictEqual(devs[0].was, '85%');
});

test('clearing a session leaves nothing of the last run behind', async () => {
  const { S } = await loaded();
  S.buildAll();
  S.state.omit.x = true;
  S.state.locks.y = {};
  S.clear();

  const sum = S.summary();
  assert.strictEqual(sum.ready, false);
  assert.strictEqual(sum.local, null);
  assert.strictEqual(sum.omittedCount, 0);
  assert.deepStrictEqual(S.state.locks, {});
  assert.throws(() => S.requireLine(), /Both settings files/);
});

test('report titles follow the stations until one is set by hand', async () => {
  const { S } = await loaded();
  S.state.names.remote = 'BRAVO_LN1';
  assert.strictEqual(S.reportTitle(), 'ALPHA_LN1 – BRAVO_LN1');
  assert.strictEqual(S.baseName(), 'ALPHA_LN1-BRAVO_LN1');

  S.state.reportTitle = 'Annual / 2026 proving';
  assert.strictEqual(S.reportTitle(), 'Annual / 2026 proving');
  // The file name has to survive a title with characters a path cannot hold.
  assert.strictEqual(slug(S.reportTitle()), 'Annual_2026_proving');
});
