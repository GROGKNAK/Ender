'use strict';
/*
 * Parse every source file.
 *
 * A syntax error in the main process does not fail loudly: Electron shows a
 * modal "App threw an error during load" dialog and then sits there, so the
 * smoke test hangs with no output and no exit code. Catching it here turns a
 * silent hang into a named failure in under a second.
 */
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['src', 'scripts', 'mockup', 'test'];

function jsFiles(dir) {
  const out = [];
  const walk = (base) => {
    if (!fs.existsSync(base)) return;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const full = path.join(base, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

const files = DIRS.flatMap(jsFiles);

test('every source file parses', () => {
  assert.ok(files.length > 10, 'found ' + files.length + ' files to check');
  const broken = [];
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      broken.push(path.relative(ROOT, file) + ': ' +
        String(err.stderr || err.message).split('\n').filter((l) => /Error/.test(l))[0]);
    }
  }
  assert.deepStrictEqual(broken, [], 'files with syntax errors:\n' + broken.join('\n'));
});

test('the renderer never reaches for node or electron directly', () => {
  // The renderer is a pure UI layer; anything it needs comes over the preload
  // bridge. A require() here would mean contextIsolation had been weakened.
  const offenders = [];
  for (const file of jsFiles(path.join('src', 'renderer'))) {
    const text = fs.readFileSync(file, 'utf8');
    if (/\brequire\s*\(/.test(text) || /\bprocess\./.test(text)) {
      offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('every plot in the workflow is both drawn and wired up', () => {
  /*
   * Each plot is a pair: an <svg id> in render() and a querySelector for it
   * in mount(). Adding the markup and forgetting the wiring leaves a blank
   * square that looks like a rendering fault, and renaming one half of the
   * pair does the same, so the pairing is asserted rather than assumed.
   */
  const text = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'views', 'workflow.js'), 'utf8');

  const drawn = [...text.matchAll(/<svg id="([a-z0-9]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(drawn, ['rx', 'rx2', 'ap', 'ap2'],
    'the plots in render(), in order');

  for (const id of drawn) {
    assert.ok(text.includes("querySelector('#" + id + "')"),
      '#' + id + ' is drawn but never looked up in mount()');
  }
});

test('the second plots are redrawn when their point set changes', () => {
  // Both of them are fed by an async plan build, so the draw call has to sit
  // somewhere that runs again after the points arrive -- not only at mount.
  const text = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'views', 'workflow.js'), 'utf8');

  // drawChecks() replaces the 87L point set; without this the plot keeps
  // showing ratios from the previous characteristic.
  const drawChecks = text.slice(text.indexOf('function drawChecks('));
  assert.ok(/redraw\(\);/.test(drawChecks.slice(0, drawChecks.indexOf('\n      }'))),
    'drawChecks() must redraw the plot it just invalidated');

  // Both plots take their characteristic from the live control values, so a
  // slider preview moves them: `c` for the 87L region, the slider-derived
  // points for the distance one.
  assert.ok(/paint\(svg2, Plot\.alpha\(c, \{ chrome: false, points:/.test(text));
  assert.ok(/paint\(svg2, Plot\.rx\(model, \{ chrome: false, points:/.test(text));
});

test('the screen and the report plot from the same geometry', () => {
  /*
   * The whole reason core/plot.js exists is that a plot in a signed test
   * record must be the plot the engineer approved on screen. Either side
   * going back to drawing its own would reintroduce exactly that drift, so
   * both are held to using the shared module.
   */
  const view = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'views', 'workflow.js'), 'utf8');
  const pdf = fs.readFileSync(path.join(ROOT, 'src', 'core', 'pdf.js'), 'utf8');

  for (const [name, text] of [['the renderer', view], ['the PDF exporter', pdf]]) {
    assert.ok(/Plot\.(rx|alpha)\(/.test(text), name + ' no longer uses the shared geometry');
  }

  // And it has to reach the renderer, which has no module system of its own.
  const html = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('core/plot.js'), 'plot.js is not loaded by the renderer');
  assert.ok(html.indexOf('core/plot.js') < html.indexOf('views/workflow.js'),
    'plot.js must load before the view that uses it');
});
