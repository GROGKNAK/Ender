'use strict';
/*
 * Assembles the static site published to GitHub Pages.
 *
 * Today that is the UI mockups plus an index, so a design can be reviewed from
 * a link rather than a screenshot. When the web build lands, copy its output
 * into site/ here and the Pages workflow needs no change at all.
 *
 * Pages are DISCOVERED rather than listed. The mockup set changes often, and a
 * hardcoded list silently drops new screens while reporting success.
 *
 *   node scripts/build-site.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MOCKUP = path.join(ROOT, 'mockup');
const SITE = path.join(ROOT, 'site');

/* Optional one-liners, keyed by filename stem. A page with no entry still
 * publishes; it just gets no description. */
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

/* Prefer the page's own <title>, minus the app-name prefix it carries. */
function titleOf(html, fallback) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return fallback;
  const t = m[1].replace(/\s+/g, ' ').replace(/^Ender\s*[—–-]\s*/i, '').trim();
  return t || fallback;
}

/* "03-distance" -> "Distance" */
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

// Regenerate first, so the published site can never lag the source.
execFileSync(process.execPath, [path.join(MOCKUP, 'build.js')], { stdio: 'inherit' });

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });

const files = fs.readdirSync(MOCKUP)
  .filter((f) => f.toLowerCase().endsWith('.html'))
  .sort();

if (!files.length) {
  console.error('no mockup pages found in ' + MOCKUP);
  process.exit(1);
}

const entries = [];
for (const file of files) {
  const html = fs.readFileSync(path.join(MOCKUP, file), 'utf8');
  fs.writeFileSync(path.join(SITE, file), html);
  const stem = file.replace(/\.html$/i, '');
  entries.push({ file, title: titleOf(html, fromName(stem)), blurb: BLURBS[stem] || '' });
}

const cards = entries.map((e) => `      <a class="card" href="${esc(e.file)}">
        <h2>${esc(e.title)}</h2>
        <p>${esc(e.blurb)}</p>
      </a>`).join('\n');

fs.writeFileSync(path.join(SITE, 'index.html'), `<!doctype html>
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
`);

// Pages runs Jekyll unless told otherwise, which drops underscore-prefixed files.
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');

console.log('site/ built: index + ' + entries.length + ' pages');
for (const e of entries) console.log('  ' + e.file.padEnd(24) + e.title);
