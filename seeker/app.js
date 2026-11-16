// Seeker desktop app. Shows the launch home base. The emails themselves are sent by GitHub
// every weekday morning (outreach/), so they go out even when this PC is off.
'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const { Store } = require('./data');

const REPO_DIR = path.join(__dirname, '..');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
Menu.setApplicationMenu(null);
app.setName('Seeker');
if (process.platform === 'win32') app.setAppUserModelId('com.ari.seeker');

const store = new Store(REPO_DIR);
let win = null;

const run = (cmd, args, input) => new Promise((resolve) => {
  const p = execFile(cmd, args, { cwd: REPO_DIR, timeout: 15000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (err, out) => resolve(err ? '' : String(out)));
  if (input) { p.stdin.write(input); p.stdin.end(); }
});

// Which GitHub repo this is (from git), and the GitHub login git already has saved on this PC.
async function repoName() {
  const url = (await run('git', ['remote', 'get-url', 'origin'])).trim();
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+)/);
  return m ? m[1] : null;
}
let tokenCache = null;
async function token() {
  if (tokenCache) return tokenCache;
  const out = await run('git', ['credential', 'fill'], 'protocol=https\nhost=github.com\n\n');
  const m = out.match(/^password=(.+)$/m);
  return (tokenCache = m ? m[1].trim() : null);
}
function api(method, p, body) {
  return new Promise(async (resolve) => {
    const t = await token();
    if (!t) return resolve({ error: 'no-login' });
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({ host: 'api.github.com', path: p, method, timeout: 15000,
      headers: { 'User-Agent': 'seeker-app', Accept: 'application/vnd.github+json', Authorization: `Bearer ${t}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = b ? JSON.parse(b) : {}; } catch {} resolve(res.statusCode < 300 ? { ok: true, data: j } : { error: `GitHub said ${res.statusCode}` }); });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => req.destroy(new Error('timed out')));
    if (data) req.write(data);
    req.end();
  });
}

ipcMain.handle('seeker:load', async () => {
  try { return { ok: true, ...(await store.load()) }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('seeker:change', async (_e, op) => {
  try { return { ok: true, ...(await store.change(op)) }; } catch (e) { return { error: e.message }; }
});
// The last few morning runs on GitHub.
ipcMain.handle('seeker:runs', async () => {
  const repo = await repoName(); if (!repo) return { error: 'no-repo' };
  const r = await api('GET', `/repos/${repo}/actions/workflows/outreach.yml/runs?per_page=6`);
  if (r.error) return { ...r, url: `https://github.com/${repo}/actions/workflows/outreach.yml` };
  return { ok: true, url: `https://github.com/${repo}/actions/workflows/outreach.yml`,
    runs: (r.data.workflow_runs || []).map((x) => ({ at: x.created_at, status: x.status, result: x.conclusion, event: x.event, url: x.html_url })) };
});
// "Run now" (practice = prints the emails on GitHub, sends nothing).
ipcMain.handle('seeker:runNow', async (_e, practice) => {
  const repo = await repoName(); if (!repo) return { error: 'no-repo' };
  return api('POST', `/repos/${repo}/actions/workflows/outreach.yml/dispatches`, { ref: 'main', inputs: { practice: !!practice } });
});
ipcMain.on('seeker:win', (_e, what) => {
  if (!win) return;
  if (what === 'min') win.minimize();
  if (what === 'close') win.close();
  if (what === 'max') {
    if (win.isFullScreen()) win.setFullScreen(false);
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
  if (what === 'update') update().then(() => { app.relaunch(); app.exit(0); });
});
ipcMain.on('seeker:open', (_e, url) => { if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url); });

function open() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 820, minHeight: 600, show: false, title: 'Seeker',
    backgroundColor: '#0A0A0A', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true, frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  // Tell the glass buttons whether the window fills the screen (to show the right icon).
  const tell = () => win.webContents.send('seeker:big', win.isMaximized() || win.isFullScreen());
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((ev) => win.on(ev, tell));
  win.webContents.on('did-finish-load', tell);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F12') win.webContents.toggleDevTools();
    if (i.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    if ((i.control || i.meta) && i.key.toLowerCase() === 'r') win.webContents.reloadIgnoringCache();
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

// Get the newest Seeker from GitHub before starting (skipped if offline).
function update() {
  return new Promise((resolve) => execFile('git', ['-C', REPO_DIR, 'pull', '--ff-only', '--quiet'], { timeout: 15000, windowsHide: true }, () => resolve()));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => { await update(); open(); });
app.on('window-all-closed', () => app.quit());
