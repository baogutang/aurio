import { app, BrowserWindow, Tray, Menu, shell, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win = null;
let tray = null;

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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  try { tray = new Tray(icon); } catch { return; }
  const menu = Menu.buildFromTemplate([
    { label: '显示 Aurio', click: () => win?.show() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip('Aurio');
  tray.setContextMenu(menu);
  tray.on('click', () => win?.show());
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

app.whenReady().then(async () => {
  // 仅打包后把可写目录指向 userData（asar 内只读）；开发时保持项目根不变。
  // 必须在动态 import server 之前设置，config.js 在 import 时即读取它。
  if (app.isPackaged) {
    process.env.AURIO_DATA_DIR = app.getPath('userData');
    seedUserDir(process.env.AURIO_DATA_DIR);
  }

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
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    else win?.show();
  });
});

app.on('window-all-closed', () => {
  // Keep running in the tray (radio keeps playing).
  if (process.platform !== 'darwin') { /* stay alive in tray */ }
});
