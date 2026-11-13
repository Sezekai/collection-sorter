'use strict';
// Lets the page start a real file drag (to a browser tab, Explorer, ...) so you can drop a picture on Google Images.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('csNative', {
  startDrag: (file) => ipcRenderer.send('cs-drag', file), onNav: (fn) => ipcRenderer.on('cs-nav', (_e, d) => fn(d)), trash: (files) => ipcRenderer.invoke('cs-trash', files),
  // the title bar is drawn by the page; Windows' own minimise / maximise / close buttons follow the theme
  setTitleBar: (c) => ipcRenderer.send('cs-titlebar', c), fullScreen: () => ipcRenderer.send('cs-fullscreen'), onWindowState: (fn) => ipcRenderer.on('cs-winstate', (_e, d) => fn(d)),
  onEngine: (fn) => ipcRenderer.on('cs-engine', (_e, d) => fn(d)), restartEngine: () => ipcRenderer.send('cs-restart'), openLog: () => ipcRenderer.send('cs-openlog'),
});
