// Minimal preload (CommonJS — required because the project is "type": "module").
// The PWA talks to the local server over plain HTTP/WS, so it needs almost
// nothing here. Exposed for future native hooks (notifications etc.).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aurio', {
  isElectron: true,
  platform: process.platform,
  releasesUrl: 'https://github.com/baogutang/aurio/releases/latest',
  updates: {
    check: () => ipcRenderer.invoke('aurio:update:check'),
    download: () => ipcRenderer.invoke('aurio:update:download'),
    install: () => ipcRenderer.invoke('aurio:update:install'),
    onEvent: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('aurio:update:event', listener);
      return () => ipcRenderer.removeListener('aurio:update:event', listener);
    },
  },
});
