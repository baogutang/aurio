import { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain, globalShortcut } from 'electron';
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
let downloadedVersion = '';
let downloading = false;

function requestQuit() {
  app.isQuitting = true;
  try { tray?.destroy(); } catch { /* ignore tray teardown failures */ }
  app.quit();
}

function describeRuntimeError(error) {
  if (!error) return 'Unknown runtime error';
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

function handleRuntimeError(error) {
  const message = describeRuntimeError(error);
  console.error('[Aurio runtime]', message);
  try {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('aurio:runtime-warning', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } catch { /* keep non-fatal runtime errors non-fatal */ }
}

process.on('uncaughtException', handleRuntimeError);
process.on('unhandledRejection', handleRuntimeError);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
// The shipped macOS app is genuinely unsigned (build.mac sets identity: null,
// sign: false — no Apple Developer ID). With no signature to verify, ShipIt's
// code-signature check has nothing to check and would reject every in-app
// update, so we disable it. Update integrity does NOT rest on code signing
// here: electron-updater verifies each artifact's SHA512 from latest-mac.yml,
// which is fetched over HTTPS from GitHub Releases. TLS + that SHA512 are the
// integrity guarantee today. The real fix is a signed build (Developer ID +
// CI signing); see SECURITY.md.
if (process.platform === 'darwin') {
  autoUpdater.verifyUpdateCodeSignature = false;
}

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

autoUpdater.on('download-progress', (progress) => {
  downloading = true;
  emitUpdate('download-progress', { progress });
});
autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true;
  downloadedVersion = info?.version || '';
  downloading = false;
  emitUpdate('update-downloaded', { version: info?.version || '' });
});
autoUpdater.on('error', (e) => {
  downloading = false;
  emitUpdate('error', { message: e.message });
});

function updateStatus() {
  return {
    version: app.getVersion(),
    downloaded: updateDownloaded,
    downloadedVersion,
    downloading,
  };
}

ipcMain.handle('aurio:update:status', () => updateStatus());

ipcMain.handle('aurio:update:check', async () => {
  if (!app.isPackaged) {
    return { ok: false, status: 'dev', version: app.getVersion(), detail: 'updates are only available in packaged builds' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version || app.getVersion();
    const updateAvailable = newerThan(latest, app.getVersion());
    if (updateDownloaded && downloadedVersion && downloadedVersion !== latest) {
      updateDownloaded = false;
      downloadedVersion = '';
    }
    return {
      ok: true,
      version: app.getVersion(),
      latestVersion: latest,
      updateAvailable,
      downloaded: updateDownloaded && downloadedVersion === latest,
      downloading,
      info: result?.updateInfo || null,
    };
  } catch (e) {
    return { ok: false, status: 'error', version: app.getVersion(), detail: e.message };
  }
});

ipcMain.handle('aurio:update:download', async () => {
  if (!app.isPackaged) return { ok: false, status: 'dev', detail: 'updates are only available in packaged builds' };
  if (updateDownloaded) return { ok: true, status: 'already-downloaded' };
  if (downloading) return { ok: true, status: 'downloading' };
  try {
    downloading = true;
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    downloading = false;
    return { ok: false, status: 'error', detail: e.message };
  }
});

ipcMain.handle('aurio:update:install', async () => {
  if (!updateDownloaded) return { ok: false, status: 'not-downloaded' };
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
});

ipcMain.on('aurio:tray:onAir', (_event, onAir) => {
  if (!tray) return;
  const icon = loadTrayImage(Boolean(onAir));
  if (!icon.isEmpty()) tray.setImage(icon);
});

function createWindow(port) {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 520,
    height: 820,
    minWidth: 440,
    minHeight: 680,
    useContentSize: true,
    title: 'Aurio',
    frame: !isMac,
    ...(isMac ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
    } : {}),
    backgroundColor: '#030303',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Tray radio: audio must start without a click, and Chromium must not
      // throttle rAF/timers while the window is hidden or the spectrum, clock,
      // and audio scheduling drift.
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });

  win.webContents.setBackgroundThrottling(false);

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

// Returns a tray image (22pt @2x). macOS uses template (mono black) assets.
function loadTrayImage(onAir = false) {
  const file = onAir ? 'trayOnAir.png' : 'trayTemplate.png';
  const candidates = app.isPackaged
    ? [
      path.join(process.resourcesPath, file),
      path.join(process.resourcesPath, 'icon.png'),
      path.join(__dirname, '..', 'pwa', 'aurio-logo.png'),
    ]
    : [
      path.join(__dirname, '..', 'build', file),
      path.join(__dirname, '..', 'build', 'icon.png'),
      path.join(__dirname, '..', 'pwa', 'aurio-logo.png'),
    ];
  let icon = nativeImage.createEmpty();
  for (const iconPath of candidates) {
    if (!fs.existsSync(iconPath)) continue;
    icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) break;
  }
  if (icon.isEmpty()) return icon;
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  else if (icon.getSize().width !== 22) icon = icon.resize({ width: 22, height: 22 });
  return icon;
}

// Returns true if a usable (non-empty) tray icon was created.
function createTray() {
  const icon = loadTrayImage(false);
  if (icon.isEmpty()) return false;
  try { tray = new Tray(icon); } catch { return false; }
  const menu = Menu.buildFromTemplate([
    { label: '显示 Aurio', click: () => win?.show() },
    { type: 'separator' },
    { label: '退出', click: requestQuit },
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

function sendMediaCommand(command) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send('aurio:media:command', command);
}

// Hardware media keys, so an always-on tray radio can be paused/skipped while
// another app is focused. Registration can fail (another app owns the key, or
// Wayland has no global shortcut support) — that's non-fatal; log once.
function registerMediaKeys() {
  const bindings = [
    ['MediaPlayPause', 'playpause'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'prev'],
    ['MediaStop', 'stop'],
  ];
  for (const [accelerator, command] of bindings) {
    let ok = false;
    try { ok = globalShortcut.register(accelerator, () => sendMediaCommand(command)); }
    catch (e) { console.warn(`[Aurio] media key ${accelerator} registration threw:`, e.message); continue; }
    if (!ok) console.warn(`[Aurio] media key ${accelerator} unavailable (already claimed or unsupported)`);
  }
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.on('before-quit', (e) => {
  // Handled in whenReady after server starts.
  if (!stopServerFn) app.isQuitting = true;
});

let stopServerFn = null;
let shutdownInProgress = false;

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
  let serverStarted = false;
  let startupError = null;
  try {
    const { config } = await import('../server/config.js');
    const { startServer, stopServer } = await import('../server/index.js');
    stopServerFn = stopServer;
    port = config.port;
    await startServer();
    serverStarted = true;
  } catch (e) {
    startupError = e;
    console.error('Failed to start Aurio server:', e);
  }

  if (!serverStarted) {
    const { dialog } = await import('electron');
    const detail = startupError instanceof Error ? startupError.message : String(startupError || 'unknown error');
    dialog.showErrorBox(
      'Aurio 无法启动',
      `后端服务启动失败。请检查端口占用或查看终端日志。\n\n${detail}`,
    );
    app.quit();
    return;
  }

  createWindow(port);
  try {
    hasTray = createTray();
  } catch (e) {
    hasTray = false;
    console.error('[Aurio] tray creation failed — running without a tray icon:', describeRuntimeError(e));
  }
  if (!hasTray) {
    console.error('[Aurio] no tray icon; the window is the only way back to the app.');
  }
  registerMediaKeys();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    else win?.show();
  });

  app.on('before-quit', (e) => {
    if (shutdownInProgress || !stopServerFn) {
      app.isQuitting = true;
      return;
    }
    e.preventDefault();
    shutdownInProgress = true;
    app.isQuitting = true;
    stopServerFn().catch((err) => console.error('[Aurio] shutdown error:', err)).finally(() => {
      app.exit(0);
    });
  });
});

app.on('window-all-closed', () => {
  // With a tray we keep running in the background (radio keeps playing). Without
  // one, there'd be no way back to the app, so quit (except on macOS, which keeps
  // apps alive via the dock by convention).
  if (process.platform !== 'darwin' && !hasTray) app.quit();
});
