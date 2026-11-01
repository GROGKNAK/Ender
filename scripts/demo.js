'use strict';
/*
 * Opens the mockups as a real desktop window so the flow can be clicked
 * through before any of it is built for real.
 *
 *   npm run demo
 *
 * This is the mockup, not the app: the sidebar and the Back / Continue
 * buttons navigate, the sliders and dropdowns work, and nothing else does.
 */

const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const MOCKUP = path.join(__dirname, '..', 'mockup');
const START = path.join(MOCKUP, '01-settings.html');
const STATE = path.join(__dirname, '..', 'tmp', 'demo-state.json');

/*
 * Shared state. Renaming a station on the first screen has to reach every
 * other screen, so it is held here rather than in any one page.
 */
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeState(next) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(next, null, 2));
}

ipcMain.handle('state:get', () => readState());
ipcMain.handle('state:set', (_e, patch) => {
  const next = Object.assign(readState(), patch || {});
  writeState(next);
  return next;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#12151a',
    show: false,
    title: 'Ender — mockup',
    webPreferences: {
      preload: path.join(MOCKUP, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // The pages are plain files; keep the title we set rather than each page's.
  win.on('page-title-updated', (e) => e.preventDefault());

  win.loadFile(START);
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  // A trimmed menu: reload and devtools are genuinely useful while reviewing,
  // the rest is noise for a mockup.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'quit' }
      ]
    }
  ]));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
