// Minimal preload (CommonJS — required because the project is "type": "module").
// The PWA talks to the local server over plain HTTP/WS, so it needs almost
// nothing here. Exposed for future native hooks (notifications etc.).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('aurio', {
  isElectron: true,
  platform: process.platform,
});
