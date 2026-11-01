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
