'use strict';
/*
 * Assembles the static site published to GitHub Pages.
 *
 * The app is published at the root and the design mockups go under
 * /mockups/, where they stay useful as a record of how the screens were
 * arrived at without being mistaken for the thing itself.
 *
 * Pages serves this project at /Ender/, NOT at the domain root. Anything the
 * app loads with a leading slash ("/core/plot.js") will 404 in production
 * while working perfectly in local development, which is a miserable way to
 * find out. Every path the web build emits is relative for that reason.
 *
 *   node scripts/build-site.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MOCKUP = path.join(ROOT, 'mockup');
const SITE = path.join(ROOT, 'site');

/* Checked in order; the first that exists is published as the app. */

/* The repository name is the path prefix on a project Pages site. */
const BASE_PATH = '/' + path.basename(ROOT) + '/';

const BLURBS = {
  '01-settings': 'Drop in the export from each end; cross-check what was parsed.',
  '02-system': 'Derived line constants, k0, and the fault model.',
  '03-distance': 'Mho characteristic with slider-driven test points.',
  '04-differential': 'Alpha plane built from 87LR and 87LANG.',
  '05-report': 'Test matrix and injected quantities for both ends.',
  '06-findings': 'What the cross-check turned up across the two ends.',
  '07-reports': 'Every report generated on this machine.',
  '08-appearance': 'Theme and colour-role customisation.',
  '09-config': 'Application configuration.'
};

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function titleOf(html, fallback) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return fallback;
  const t = m[1].replace(/\s+/g, ' ').replace(/^Ender\s*[—–-]\s*/i, '').trim();
  return t || fallback;
}

function fromName(stem) {
  return stem.replace(/^\d+[-_]?/, '').replace(/[-_]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function version() {
  try {
    return require(path.join(ROOT, 'package.json')).version;
  } catch (err) {
    return '0.0.0';
  }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

// Regenerate the mockups so the published site can never lag the source.
execFileSync(process.execPath, [path.join(MOCKUP, 'build.js')], { stdio: 'inherit' });

/*
 * The app itself is the site now. build-web clears and fills the directory,
 * so it runs first and the mockups are laid in afterwards, one level down:
 * they are a record of how the screens were designed, not the product.
 */
const { build: buildWeb } = require('./build-web');
const built = buildWeb(SITE);
console.log('publishing the web build: ' + built.files.length + ' shared modules, v' + built.version);

const mockRoot = path.join(SITE, 'mockups');
fs.mkdirSync(mockRoot, { recursive: true });

const files = fs.readdirSync(MOCKUP)
  .filter((f) => f.toLowerCase().endsWith('.html'))
  .sort();

const entries = [];
for (const file of files) {
  const html = fs.readFileSync(path.join(MOCKUP, file), 'utf8');
  fs.writeFileSync(path.join(mockRoot, file), html);
  const stem = file.replace(/\.html$/i, '');
  entries.push({ file, title: titleOf(html, fromName(stem)), blurb: BLURBS[stem] || '' });
}

const cards = entries.map((e) => `      <a class="card" href="${esc(e.file)}">
        <h2>${esc(e.title)}</h2>
        <p>${esc(e.blurb)}</p>
      </a>`).join('\n');

const indexHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ender &mdash; UI mockups</title>
<style>
  :root{ --bg:#12151a; --panel:#1a1f27; --line:#2a313c; --text:#e6e9ef;
         --muted:#8b95a5; --accent:#4f9dff; }
  *{box-sizing:border-box}
  body{margin:0;padding:40px 16px;background:var(--bg);color:var(--text);
    font:15px/1.6 "Segoe UI",system-ui,sans-serif}
  main{max-width:880px;margin:0 auto}
  h1{margin:0 0 6px;font-size:26px;letter-spacing:-0.02em}
  .sub{color:var(--muted);margin:0 0 6px}
  .note{color:var(--muted);font-size:13px;margin:0 0 28px;
    border-left:2px solid var(--line);padding-left:12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:14px}
  .card{display:block;background:var(--panel);border:1px solid var(--line);
    border-radius:10px;padding:16px 18px;text-decoration:none;color:inherit}
  .card:hover{border-color:var(--accent)}
  .card h2{margin:0 0 5px;font-size:15px;font-weight:600}
  .card p{margin:0;color:var(--muted);font-size:13px}
  footer{margin-top:34px;color:var(--muted);font-size:12.5px;
    border-top:1px solid var(--line);padding-top:14px}
  @media (max-width:600px){ body{padding:24px 16px} }
</style>
</head>
<body>
  <main>
    <h1>Ender</h1>
    <p class="sub">Line protection test builder &mdash; SEL 87L and 21 elements</p>
    <p class="note">These are interactive UI mockups, not the application. The
      plots respond to the sliders; nothing is calculated from a real settings
      file here.</p>
    <div class="grid">
${cards}
    </div>
    <footer>Built from <code>mockup/</code> at version ${version()}.</footer>
  </main>
</body>
</html>
`;

fs.writeFileSync(path.join(mockRoot, 'index.html'), indexHtml);

/*
 * Pages has no server-side rewrite, so a deep link to a client-side route
 * returns its 404 page. Serving the app from 404.html makes the router pick
 * the URL up instead. Harmless when the app uses hash routing.
 */
const appIndex = path.join(SITE, 'index.html');
if (fs.existsSync(appIndex)) {
  fs.copyFileSync(appIndex, path.join(SITE, '404.html'));
}

// Pages runs Jekyll unless told otherwise, which drops underscore-prefixed files.
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');

console.log('base path: ' + BASE_PATH + '  (asset URLs must be relative to this)');
console.log('site/ built: the app at the root, ' + entries.length + ' mockup pages under /mockups/');
for (const e of entries) console.log('  ' + e.file.padEnd(24) + e.title);
