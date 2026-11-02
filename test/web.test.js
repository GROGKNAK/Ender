'use strict';
/*
 * The web build.
 *
 * The browser half cannot be exercised here -- there is no DOM and no
 * DecompressionStream -- but the two things most likely to break it can be.
 *
 * The first is the module graph. The web build wraps the same source files
 * and loads them with a require of its own, so a module that moves, or an
 * import that only ever resolved because Node found it, would leave a page
 * that fails on load and no test that noticed. Here the generated bundle is
 * run against the same loader the browser uses, which answers that in a
 * second rather than in a browser.
 *
 * The second is the inflate seam: the zip reader takes its inflate as an
 * argument so the browser can pass an asynchronous one, and that argument has
 * to actually be used.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const { readZip, sortSources } = require('../src/core/bundle');
const { build, VIEW_SCRIPTS } = require('../scripts/build-web');

/* ------------------------------------------------------------- inflate --- */

function zipOf(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.text, 'utf8');
    const body = e.store ? raw : zlib.deflateRawSync(raw);
    const crc = zlib.crc32 ? zlib.crc32(raw) : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(e.store ? 0 : 8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([lh, name, body]));

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(e.store ? 0 : 8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([ch, name]));
    offset += locals[locals.length - 1].length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test('the zip reader uses the inflate it is handed', async () => {
  const zip = zipOf([
    { name: 'set_2.txt', text: 'Z1MAG,"9.99"\n' },
    { name: 'set_1.txt', text: 'Z1MAG,"7.80"\nZ1ANG,"84.50"\n' },
    { name: 'set_G.txt', text: 'CTR,"240"\n', store: true },
    { name: 'thumb.png', text: 'not text' }
  ]);

  // Stands in for the browser's DecompressionStream: asynchronous, and
  // handing back a plain Uint8Array rather than a Buffer.
  let used = 0;
  const injected = async (raw) => {
    used += 1;
    return new Uint8Array(zlib.inflateRawSync(raw));
  };

  const files = sortSources(await readZip(zip, injected));
  assert.strictEqual(used, 2, 'both deflated entries went through the injected inflate');
  assert.deepStrictEqual(files.map((f) => f.name), ['set_1.txt', 'set_2.txt', 'set_G.txt']);
  assert.ok(files[0].text.includes('7.80'));
  assert.ok(files[2].text.includes('CTR'), 'a stored entry needs no inflate at all');

  // And the same bytes read the same way without one.
  const byDefault = sortSources(await readZip(zip));
  assert.deepStrictEqual(byDefault.map((f) => f.text), files.map((f) => f.text));
});

/* -------------------------------------------------------- module graph --- */

/*
 * The browser's loader, near enough: the same resolution rule and the same
 * stubs, run over the bundle the build actually produces.
 */
function loaderFor(modules) {
  const cache = Object.create(null);
  const STUBS = {
    fs: {},
    zlib: {},
    // Only the names the modules destructure at load time; nothing here is
    // called, because this test asks whether the graph resolves, not what it
    // draws.
    'pdf-lib': { PDFDocument: {}, StandardFonts: {}, rgb: () => ({}) },
    path: {
      basename: (p) => String(p).split(/[\\/]/).pop() || '',
      extname: () => '',
      join: (...a) => a.join('/'),
      relative: (f, t) => t
    }
  };
  function requireFrom(from) {
    return function req(spec) {
      let id = spec;
      if (spec[0] === '.') {
        const base = from.split('/').slice(0, -1);
        for (const part of spec.split('/')) {
          if (part === '.' || part === '') continue;
          else if (part === '..') base.pop();
          else base.push(part);
        }
        id = base.join('/').replace(/\.js$/, '');
      }
      if (id in STUBS) return STUBS[id];
      if (cache[id]) return cache[id].exports;
      const def = modules[id];
      if (!def) throw new Error('Unknown module: ' + spec + ' (as ' + id + ') from ' + from);
      const module = { exports: {} };
      cache[id] = module;
      def(requireFrom(id), module, module.exports);
      return module.exports;
    };
  }
  return requireFrom;
}

let built = null;
function site() {
  if (!built) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ender-web-'));
    build(dir);
    built = dir;
  }
  return built;
}

test('every module in the web bundle resolves through the browser loader', () => {
  const dir = site();
  const src = fs.readFileSync(path.join(dir, 'modules.js'), 'utf8');

  /*
   * The bundle itself only touches `window`, but the modules inside it run in
   * whatever realm their functions were created in, so the sandbox has to
   * carry the web platform globals a browser would have. TextDecoder and
   * friends are host objects, not language builtins, so a bare context has
   * none of them.
   */
  const sandbox = {
    window: {},
    TextDecoder,
    TextEncoder,
    Blob,
    Response,
    console
  };
  vm.runInNewContext(src, sandbox, { filename: 'modules.js' });
  const modules = sandbox.window.__enderModules;
  assert.ok(modules && Object.keys(modules).length > 10, 'the bundle holds the modules');

  const requireFrom = loaderFor(modules);
  const failed = [];
  for (const id of Object.keys(modules)) {
    try {
      // A fresh graph per module, so one that only works because another
      // pulled it in first still has to stand on its own.
      loaderFor(modules)('test')('./' + id);
    } catch (err) {
      failed.push(id + ': ' + err.message);
    }
  }
  assert.deepStrictEqual(failed, [], 'modules that would not load in a browser:\n' + failed.join('\n'));

  // And the entry point the page calls is really there.
  assert.strictEqual(typeof requireFrom('test')('./web/bridge').install, 'function');
});

test('the web build ships what the page asks for', () => {
  const dir = site();
  const manifest = fs.readFileSync(path.join(dir, 'manifest.js'), 'utf8');
  const json = JSON.parse(manifest.slice(manifest.indexOf('{'), manifest.lastIndexOf('}') + 1));

  const bare = (url) => url.split('?')[0];
  for (const name of json.scripts) {
    assert.ok(fs.existsSync(path.join(dir, bare(name))), 'missing view script: ' + name);
  }
  assert.deepStrictEqual(json.scripts.map(bare), VIEW_SCRIPTS);

  for (const name of [
    'index.html', 'boot.js', 'modules.js', 'styles.css',
    'vendor/pdf-lib.min.js',
    'samples/DEMO_ALPHA_LN1_Settings.html',
    'samples/DEMO_BRAVO_LN1_Settings.html'
  ]) {
    assert.ok(fs.existsSync(path.join(dir, name)), 'missing: ' + name);
  }

  const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  for (const tag of ['vendor/pdf-lib.min.js', 'manifest.js', 'modules.js', 'boot.js']) {
    assert.ok(page.includes(tag), 'the page does not load ' + tag);
  }
  /*
   * The loader runs functions the build wrote, never source from a string, so
   * the page keeps a policy that forbids eval. If that ever has to be relaxed
   * it should be a decision, not a drift.
   */
  const csp = /<meta http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]*)"/.exec(page);
  assert.ok(csp, 'the page declares no content security policy');
  assert.ok(!/unsafe-eval/.test(csp[1]), 'the policy should not need to allow eval');
  assert.ok(/script-src 'self'/.test(csp[1]));
});

test('a stale cache cannot serve half of one build and half of another', () => {
  /*
   * Pages serves every file with max-age=600 and gives no way to change it,
   * so without a stamp on each URL a browser can hold a fresh index.html and
   * a ten-minute-old modules.js at once -- running a mixture of two builds on
   * a page whose job is working out test quantities.
   */
  const dir = site();
  const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const manifest = fs.readFileSync(path.join(dir, 'manifest.js'), 'utf8');
  const json = JSON.parse(manifest.slice(manifest.indexOf('{'), manifest.lastIndexOf('}') + 1));

  assert.match(json.stamp, /^[0-9a-f]{10}$/);

  const refs = [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 4);
  for (const url of refs) {
    if (url === 'manifest.js') continue;   // it is what carries the stamp
    assert.ok(url.endsWith('?v=' + json.stamp), url + ' is not stamped');
  }
  // boot.js adds the view scripts itself, so those need it too.
  for (const url of json.scripts) {
    assert.ok(url.endsWith('?v=' + json.stamp), url + ' is not stamped');
  }

  // The stamp has to follow the content. Same sources, same stamp -- or a
  // deploy that changed nothing would pointlessly re-download everything.
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'ender-web2-'));
  try {
    assert.strictEqual(build(second).stamp, json.stamp, 'same sources should give the same stamp');
  } finally {
    fs.rmSync(second, { recursive: true, force: true });
  }

  /*
   * And the part that matters: a changed module has to change it. Checked by
   * digesting the shipped files the same way the build does, with one byte
   * different, rather than by editing a source file out from under the repo.
   */
  const stampOf = (edit) => {
    const digest = crypto.createHash('sha256');
    const names = ['modules.js', 'boot.js', 'styles.css', 'vendor/pdf-lib.min.js']
      .concat(VIEW_SCRIPTS)
      .concat(['samples/DEMO_ALPHA_LN1_Settings.html', 'samples/DEMO_BRAVO_LN1_Settings.html'])
      .sort();
    for (const rel of names) {
      let body = fs.readFileSync(path.join(dir, rel));
      if (rel === edit) body = Buffer.concat([body, Buffer.from('/* changed */')]);
      digest.update(rel).update(body);
    }
    return digest.digest('hex').slice(0, 10);
  };
  assert.strictEqual(stampOf(null), json.stamp, 'the digest is over the shipped files');
  assert.notStrictEqual(stampOf('modules.js'), json.stamp, 'a changed module must change the stamp');
});

test('the bundle carries the source unchanged, not a transformed copy', () => {
  /*
   * The reason the web build shares src/core at all is that a report must not
   * depend on which build produced it. That only holds while the shipped text
   * is the tested text, so the bundle is checked against the file on disk.
   */
  const dir = site();
  const bundle = fs.readFileSync(path.join(dir, 'modules.js'), 'utf8');
  for (const name of ['complex', 'testplan', 'plot', 'session', 'pdf']) {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'core', name + '.js'), 'utf8'
    ).replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
    assert.ok(bundle.includes(source), 'core/' + name + '.js was altered on the way in');
  }
});

test('the desktop and the web start from the same defaults', () => {
  // Two stores, one set of assumptions. A report run in a browser and the
  // same report run on the desktop have to rest on the same numbers.
  const desktop = require('../src/main/store');
  const shared = require('../src/core/defaults');
  assert.deepStrictEqual(desktop.DEFAULT_CONFIG, shared.DEFAULT_CONFIG);
  assert.deepStrictEqual(desktop.DEFAULT_THEME, shared.DEFAULT_THEME);
  assert.strictEqual(shared.mergeConfig({}).defaults.vnom, 67.0);
  assert.strictEqual(shared.mergeConfig({ defaults: { vnom: 115 } }).defaults.testCurrent, 5.0);
  // A site that has written its own labels does not want ours back underneath.
  assert.deepStrictEqual(shared.mergeConfig({ labels: [{ code: 'X' }] }).labels, [{ code: 'X' }]);
});

test.after(() => {
  if (built) fs.rmSync(built, { recursive: true, force: true });
});
