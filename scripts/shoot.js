'use strict';
/*
 * Screenshots every mockup page at the app's real window size.
 *
 * Rendered by Electron rather than a headless browser so what you see is what
 * the packaged app will draw.
 *
 *   npm run shots
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'mockup');
const OUT = path.join(SRC, 'shots');
const SIZE = { width: 1440, height: 960 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const pages = fs.readdirSync(SRC).filter((f) => f.endsWith('.html')).sort();
  const win = new BrowserWindow({
    ...SIZE,
    show: false,
    backgroundColor: '#12151a',
    webPreferences: { offscreen: false }
  });

  for (const file of pages) {
    await win.loadFile(path.join(SRC, file));
    await wait(450);               // let the slider-driven SVGs finish drawing

    // Grow the window to the full page so nothing is cut off at the fold.
    const need = await win.webContents.executeJavaScript(
      'Math.ceil(document.querySelector("main").scrollHeight) + 44'
    );
    win.setContentSize(SIZE.width, Math.min(Math.max(SIZE.height, need), 4400));
    await wait(250);

    const img = await win.webContents.capturePage();
    const out = path.join(OUT, file.replace('.html', '.png'));
    fs.writeFileSync(out, img.toPNG());
    console.log('  ' + path.basename(out));
  }

  app.exit(0);
});
