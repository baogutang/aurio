import { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win = null;
let tray = null;
let hasTray = false;
let updateDownloaded = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function versionParts(v = '') {
  return v.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
}

function newerThan(a = '', b = '') {
  const av = versionParts(a);
  const bv = versionParts(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    if ((av[i] || 0) > (bv[i] || 0)) return true;
    if ((av[i] || 0) < (bv[i] || 0)) return false;
  }
  return false;
}

function emitUpdate(event, payload = {}) {
  win?.webContents.send('aurio:update:event', { event, ...payload });
}

function safeOpenExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href);
  } catch { /* ignore invalid urls */ }
}

function isLocalAppUrl(url, port) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === 'localhost' && u.port === String(port);
  } catch {
    return false;
  }
}

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port);
  });
}

async function findAvailablePort(startPort) {
  const start = Number.isFinite(startPort) && startPort > 0 ? startPort : 8080;
  for (let port = start; port < start + 100; port++) {
    if (await canListen(port)) return port;
  }
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.once('listening', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : start;
      probe.close(() => resolve(port));
    });
    probe.listen(0);
  });
}

autoUpdater.on('download-progress', (progress) => emitUpdate('download-progress', { progress }));
autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true;
  emitUpdate('update-downloaded', { version: info?.version || '' });
});
autoUpdater.on('error', (e) => emitUpdate('error', { message: e.message }));

ipcMain.handle('aurio:update:check', async () => {
  if (!app.isPackaged) {
    return { ok: false, status: 'dev', version: app.getVersion(), detail: 'updates are only available in packaged builds' };
  }
  try {
    updateDownloaded = false;
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version || app.getVersion();
    return {
      ok: true,
      version: app.getVersion(),
      latestVersion: latest,
      updateAvailable: newerThan(latest, app.getVersion()),
      info: result?.updateInfo || null,
    };
  } catch (e) {
    return { ok: false, status: 'error', version: app.getVersion(), detail: e.message };
  }
});

ipcMain.handle('aurio:update:download', async () => {
  if (!app.isPackaged) return { ok: false, status: 'dev', detail: 'updates are only available in packaged builds' };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 'error', detail: e.message };
  }
});

ipcMain.handle('aurio:update:install', async () => {
  if (!updateDownloaded) return { ok: false, status: 'not-downloaded' };
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
});

function createWindow(port) {
  win = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 360,
    minHeight: 600,
    title: 'Aurio',
    backgroundColor: '#030303',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`http://localhost:${port}`);

  // Open external links in the system browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isLocalAppUrl(url, port)) return;
    event.preventDefault();
    safeOpenExternal(url);
  });

  win.on('close', (e) => {
    // Only minimize-to-tray if there's an actual tray icon to restore from;
    // otherwise let the close quit normally so the app can't get stuck hidden.
    if (!app.isQuitting && hasTray) { e.preventDefault(); win.hide(); }
  });
}

// Returns true if a usable (non-empty) tray icon was created.
function createTray() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png'), path.join(__dirname, '..', 'pwa', 'aurio-logo.png')]
    : [path.join(__dirname, '..', 'build', 'icon.png'), path.join(__dirname, '..', 'pwa', 'aurio-logo.png')];
  let icon = nativeImage.createEmpty();
  for (const iconPath of candidates) {
    icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) break;
  }
  if (icon.isEmpty()) return false; // no real icon → don't trap the window on close
  icon = icon.resize({ width: 16, height: 16 });
  try { tray = new Tray(icon); } catch { return false; }
  const menu = Menu.buildFromTemplate([
    { label: '显示 Aurio', click: () => win?.show() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip('Aurio');
  tray.setContextMenu(menu);
  tray.on('click', () => win?.show());
  return true;
}

// 打包后首次启动，把只读的品味模板播种到可写的 userData/user，供用户编辑。
function seedUserDir(dataRoot) {
  try {
    const dest = path.join(dataRoot, 'user');
    if (fs.existsSync(dest)) return;
    const src = path.join(process.resourcesPath, 'user');
    if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true });
  } catch (e) { console.error('seed user dir failed:', e.message); }
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  // 仅打包后把可写目录指向 userData（asar 内只读）；开发时保持项目根不变。
  // 必须在动态 import server 之前设置，config.js 在 import 时即读取它。
  if (app.isPackaged) {
    process.env.AURIO_DATA_DIR = app.getPath('userData');
    seedUserDir(process.env.AURIO_DATA_DIR);
  }

  const desiredPort = Number(process.env.PORT || 8080);
  process.env.PORT = String(await findAvailablePort(desiredPort));

  let port = 8080;
  try {
    const { config } = await import('../server/config.js');
    const { startServer } = await import('../server/index.js');
    port = config.port;
    await startServer();
  } catch (e) {
    console.error('Failed to start Aurio server:', e);
  }

  createWindow(port);
  hasTray = createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    else win?.show();
  });
});

app.on('window-all-closed', () => {
  // With a tray we keep running in the background (radio keeps playing). Without
  // one, there'd be no way back to the app, so quit (except on macOS, which keeps
  // apps alive via the dock by convention).
  if (process.platform !== 'darwin' && !hasTray) app.quit();
});
