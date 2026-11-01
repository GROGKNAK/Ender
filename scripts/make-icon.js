'use strict';
/*
 * Generates build/icon.ico.
 *
 * The mark is an alpha-plane restraint region -- the one shape that is
 * specific to this program rather than generically electrical. Drawn in the
 * app's own palette so the desktop icon and the UI agree.
 *
 * Electron renders it, because it is already a dependency and already knows
 * how to rasterise a page; adding an image toolchain for one file would be
 * worse. The .ico is a PNG wrapped in an icon directory, which Windows has
 * accepted since Vista.
 *
 *   npm run icon
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SIZE = 256;
const OUT_DIR = path.join(__dirname, '..', 'build');

const PAGE = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent}
  svg{display:block}
</style>
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d2531"/><stop offset="1" stop-color="#11141a"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="52" fill="url(#bg)" stroke="#2f3846" stroke-width="4"/>
  <!-- restraint region: outer arc, inner arc, swept about 180 degrees -->
  <path d="M 196 54 A 96 96 0 1 0 196 202 L 140 150 A 24 24 0 1 1 140 106 Z"
        fill="rgba(79,157,255,0.17)" stroke="#4f9dff" stroke-width="7"
        stroke-linejoin="round" transform="translate(6,0)"/>
  <circle cx="86" cy="128" r="9" fill="#3fb950"/>
  <line x1="40" y1="128" x2="216" y2="128" stroke="#4a5566" stroke-width="3"/>
  <line x1="128" y1="40" x2="128" y2="216" stroke="#4a5566" stroke-width="3"/>
</svg>`;

/** Wrap a PNG in a single-image ICO directory. */
function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);          // reserved
  header.writeUInt16LE(1, 2);          // type: icon
  header.writeUInt16LE(1, 4);          // one image

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);              // 0 means 256 px
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);              // palette size
  entry.writeUInt8(0, 3);              // reserved
  entry.writeUInt16LE(1, 4);           // colour planes
  entry.writeUInt16LE(32, 6);          // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, png]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: false }
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
  await new Promise((r) => setTimeout(r, 300));

  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), pngToIco(png));

  const { width, height } = image.getSize();
  console.log('icon ' + width + 'x' + height + ', ' + png.length + ' bytes png, ' +
    (png.length + 22) + ' bytes ico');
  app.exit(width === SIZE && height === SIZE ? 0 : 1);
});
