'use strict';
/*
 * Screenshot the report-plot preview page.
 *
 *   node scripts/plotpreview.js && electron scripts/plotshot.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const page = path.join(__dirname, '..', 'tmp', 'plot-preview.html');
const out = path.join(__dirname, '..', 'tmp', 'plot-preview.png');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 760, height: 480, show: false, backgroundColor: '#ffffff' });
  await win.loadFile(page);
  await wait(400);
  const need = await win.webContents.executeJavaScript(
    '[Math.ceil(document.body.scrollWidth) + 24, Math.ceil(document.body.scrollHeight) + 24]'
  );
  win.setContentSize(Math.min(need[0], 1600), Math.min(need[1], 1600));
  await wait(300);
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log(out);
  app.exit(0);
});
