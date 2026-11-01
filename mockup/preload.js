'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/*
 * The mockup's only bridge. Station names and saved settings have to outlive a
 * page change, so they live in the main process rather than in the page --
 * which is also how the real app will hold them.
 */
contextBridge.exposeInMainWorld('demo', {
  get: () => ipcRenderer.invoke('state:get'),
  set: (patch) => ipcRenderer.invoke('state:set', patch)
});
