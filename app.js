// HQ desktop app. Starts the HQ engine and opens the city in its own window.
const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.commandLine.appendSwitch('ignore-gpu-blocklist'); // use the graphics card for the 3D city
Menu.setApplicationMenu(null);
app.setName('HQ');
if (process.platform === 'win32') app.setAppUserModelId('com.ari.hq');

let win = null;
const PORT = Number(process.env.HQ_PORT || 4747);

function open() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 900, minHeight: 600, show: false,
    title: 'HQ', backgroundColor: '#1d2128', icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true, frame: false,
    webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  const big = () => win.isMaximized() || win.isFullScreen();
  const tell = () => win.webContents.send('hq-big', big());
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((ev) => win.on(ev, tell));
  win.webContents.on('did-finish-load', tell);
  // Links (GitHub etc.) open in your normal browser, not inside HQ.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // F11 = full screen on/off, F12 = errors window, Ctrl+R = reload.
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F12') win.webContents.toggleDevTools();
    if (i.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    if ((i.control || i.meta) && i.key.toLowerCase() === 'r') win.webContents.reloadIgnoringCache();
  });
  win.webContents.session.clearCache().catch(() => {});
  const load = (n) => win.loadURL(`http://localhost:${PORT}/`).catch(() => n > 0 && setTimeout(() => load(n - 1), 500));
  load(20);
}

ipcMain.on('hq-win', (_e, what) => {
  if (!win) return;
  if (what === 'min') win.minimize();
  if (what === 'update') { update().then(() => { app.relaunch(); app.exit(0); }); }
  if (what === 'close') win.close();
  if (what === 'max') {
    if (win.isFullScreen()) win.setFullScreen(false);
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

// One HQ icon on the taskbar: make your shortcuts (Desktop, Start menu, pinned taskbar)
// carry the same app ID as the window, so Windows groups them together.
function fixShortcuts() {
  if (process.platform !== 'win32') return;
  const fs = require('fs');
  const opts = { target: process.execPath, args: '"' + __dirname + '"', cwd: __dirname, icon: path.join(__dirname, 'icon.ico'), iconIndex: 0, appUserModelId: 'com.ari.hq', description: 'HQ' };
  const places = [
    path.join(app.getPath('desktop'), 'HQ.lnk'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'HQ.lnk'),
    path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'HQ.lnk'),
  ];
  for (const p of places) { try { if (fs.existsSync(p)) shell.writeShortcutLink(p, 'replace', opts); } catch (e) {} }
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
// Auto-update: grab the latest HQ from GitHub before starting (skipped if offline or you changed files).
function update() {
  return new Promise((resolve) => {
    const fs = require('fs');
    if (!fs.existsSync(path.join(__dirname, '.git'))) return resolve();
    require('child_process').execFile('git', ['-C', __dirname, 'pull', '--ff-only', '--quiet'], { timeout: 15000, windowsHide: true }, () => resolve());
  });
}
app.whenReady().then(async () => { await update(); fixShortcuts(); require('./server.js'); open(); });
app.on('window-all-closed', () => app.quit());
