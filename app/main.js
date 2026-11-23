'use strict';
// Thin desktop shell: starts the engine (local server) and shows its UI in a window.
const { app, BrowserWindow, dialog, shell, Menu, ipcMain, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const appRoot = path.join(__dirname, '..');
// Your data (settings, database, models, thumbnails, log) lives OUTSIDE the program folder, so you can replace the
// program with a newer version without moving anything:  %LOCALAPPDATA%\Collection Sorter
const exeDir = app.isPackaged ? path.dirname(process.execPath) : appRoot;
const base = process.env.LOCALAPPDATA || app.getPath('appData');
const homeData = path.join(base, 'Collection Sorter');
// The data folder can be moved (Settings → Storage); a pointer file in the usual place remembers where it went.
const pointerFile = path.join(homeData, 'location.json');
function readPointer() { try { return JSON.parse(fs.readFileSync(pointerFile, 'utf8')); } catch { return null; } }
const ptr = process.env.CS_DATA ? null : readPointer();
const dataDir = process.env.CS_DATA || (ptr && ptr.dataDir && fs.existsSync(path.join(ptr.dataDir, 'settings.json')) ? ptr.dataDir : homeData);
fs.mkdirSync(dataDir, { recursive: true });
// after a move, the old copy is removed at the next start (the pointer file itself stays)
if (ptr && ptr.cleanup && dataDir === ptr.dataDir && fs.existsSync(path.join(ptr.dataDir, 'sorter.db'))) {
  try { for (const n of fs.readdirSync(ptr.cleanup)) if (n !== 'location.json') fs.rmSync(path.join(ptr.cleanup, n), { recursive: true, force: true }); fs.writeFileSync(pointerFile, JSON.stringify({ dataDir: ptr.dataDir }, null, 2)); } catch { /* try again next time */ }
}
// The big things (AI models, video previews) live beside the program: E:\Pictures\Collection Sorter\Models and \Cache.
// The root is the folder above "App"; when run from source it is dev-root inside the project, never the real folders.
const rootDir = process.env.CS_ROOT || (app.isPackaged ? (path.basename(exeDir).toLowerCase() === 'app' ? path.dirname(exeDir) : exeDir) : path.join(appRoot, 'dev-root'));
// Logs: one file per run in logs\, keeping the last few runs (STANDARDS.md "The log")
const logsDir = path.join(dataDir, 'logs'); fs.mkdirSync(logsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
try { const old = fs.readdirSync(logsDir).filter((n) => /^engine-.*\.log$/.test(n)).sort(); for (const n of old.slice(0, Math.max(0, old.length - 5))) fs.rmSync(path.join(logsDir, n), { force: true }); } catch { /* ignore */ }
const crashFile = (what, text) => { try { fs.writeFileSync(path.join(logsDir, `crash-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`), `Collection Sorter: ${what}\n${new Date().toString()}\n\n${text}\n`); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => crashFile('window process error', e.stack || e.message));
// Safe mode: two unclean exits in a row start the app with the graphics card off (it says why and offers to turn it back on)
const flagFile = path.join(dataDir, 'running.flag'), crashCountFile = path.join(dataDir, 'crashes.json');
let crashCount = 0; try { crashCount = JSON.parse(fs.readFileSync(crashCountFile, 'utf8')).count || 0; } catch { /* none */ }
if (fs.existsSync(flagFile)) { crashCount++; crashFile('the app did not close properly last time', 'The previous run ended without closing normally (a crash, a power cut or the process being killed).'); }
else crashCount = 0;
try { fs.writeFileSync(crashCountFile, JSON.stringify({ count: crashCount })); fs.writeFileSync(flagFile, String(process.pid)); } catch { /* ignore */ }
const safeMode = crashCount >= 2;
if (safeMode) app.disableHardwareAcceleration();
// One-time move of a "data" folder that an earlier portable version created next to the program.
try {
  const old = path.join(exeDir, 'data');
  const marker = path.join(dataDir, '.migrated');
  if (!process.env.CS_DATA && fs.existsSync(old) && !fs.existsSync(marker) && fs.existsSync(path.join(old, 'settings.json')) && !fs.existsSync(path.join(dataDir, 'settings.json'))) {
    fs.cpSync(old, dataDir, { recursive: true, filter: (src) => !/[\\/]shell([\\/]|$)/.test(src) });
    fs.writeFileSync(marker, 'copied from ' + old + '\nYou can delete that old folder.');
  }
} catch (e) { try { fs.appendFileSync(path.join(dataDir, 'shell.log'), 'migration failed: ' + e.message + '\n'); } catch { /* ignore */ } }
app.setPath('userData', path.join(dataDir, 'shell'));

let win = null, engine = null, quitting = false, restarting = false;
const BLANK = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// move files to the Recycle Bin (never a permanent delete)
ipcMain.handle('cs-trash', async (e, files) => {
  const out = [];
  for (const f of Array.isArray(files) ? files : []) { try { await shell.trashItem(f); out.push({ file: f, ok: true }); } catch (err) { out.push({ file: f, ok: false, error: String(err.message || err) }); } }
  return out;
});
ipcMain.on('cs-drag', (e, file) => {
  try {
    if (typeof file !== 'string' || !fs.existsSync(file)) return;
    let icon = nativeImage.createFromPath(file);
    icon = icon.isEmpty() ? nativeImage.createFromBuffer(Buffer.from(BLANK, 'base64')).resize({ width: 64, height: 64 }) : icon.resize({ width: 96 });
    e.sender.startDrag({ file, icon });
  } catch (err) { try { fs.appendFileSync(path.join(logsDir, 'shell.log'), 'drag failed: ' + err.message + '\n'); } catch { /* ignore */ } }
});
const token = crypto.randomBytes(16).toString('hex');
const logFile = path.join(logsDir, `engine-${stamp}.log`);

function startEngine() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', CS_DATA: dataDir, CS_ROOT: rootDir, CS_LOGFILE: logFile, CS_TOKEN: token, NODE_NO_WARNINGS: '1', ...(safeMode ? { CS_SAFE: '1' } : {}) };
    engine = spawn(process.execPath, [path.join(appRoot, 'engine', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    const log = fs.createWriteStream(logFile, { flags: 'a' });
    let buf = '', done = false;
    engine.stdout.on('data', (d) => { log.write(d); buf += d.toString(); const m = /ENGINE_PORT=(\d+)/.exec(buf); if (m && !done) { done = true; resolve(+m[1]); } });
    engine.stderr.on('data', (d) => log.write(d));
    engine.on('error', reject);
    engine.on('exit', (code) => { if (done && !quitting && !restarting) crashFile('the engine stopped', 'exit code ' + code + '. See ' + logFile); if (!done) reject(new Error('The engine stopped before it started (code ' + code + '). The log has the details.')); else if (!quitting && !restarting) { if (win && !win.isDestroyed()) win.webContents.send('cs-engine', { stopped: true, code, log: logFile }); } });
    engine.on('message', async (msg) => {
      if (msg && msg.type === 'open-path') { if (msg.reveal) shell.showItemInFolder(msg.path); else shell.openPath(msg.path); return; }
      if (msg && msg.type === 'data-moved') { try { fs.mkdirSync(homeData, { recursive: true }); fs.writeFileSync(pointerFile, JSON.stringify({ dataDir: msg.dataDir, cleanup: dataDir }, null, 2)); } catch { /* ignore */ } quitting = true; app.relaunch(); app.exit(0); return; }
      if (msg && msg.type === 'safe-off') { try { fs.writeFileSync(crashCountFile, JSON.stringify({ count: 0 })); } catch { /* ignore */ } quitting = true; app.relaunch(); app.exit(0); return; }
      if (msg && msg.type === 'pick') {
        let paths = [];
        if (msg.mode === 'folder') { const r = await dialog.showOpenDialog(win, { title: msg.title, properties: ['openDirectory', 'createDirectory'] }); if (!r.canceled) paths = r.filePaths; }
        else if (msg.mode === 'save') { const r = await dialog.showSaveDialog(win, { title: msg.title, defaultPath: msg.defaultPath, filters: msg.filters }); if (!r.canceled && r.filePath) paths = [r.filePath]; }
        else { const r = await dialog.showOpenDialog(win, { title: msg.title, filters: msg.filters, properties: ['openFile', ...(msg.multi ? ['multiSelections'] : [])] }); if (!r.canceled) paths = r.filePaths; }
        engine.send({ type: 'picked', id: msg.id, paths }); return;
      }
      if (msg && msg.type === 'pick-folder') {
        const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
        engine.send({ type: 'picked', id: msg.id, path: r.canceled ? null : r.filePaths[0] });
      }
    });
    setTimeout(() => { if (!done) reject(new Error('The engine did not start in time. See ' + logFile)); }, 60000);
  });
}

// The window has no menu bar. Its 32 px title bar is drawn by the page in the theme's colours; Windows still draws
// minimise / maximise / close (coloured to match). The overlay is 1 px shorter so the strip's line runs under them.
const OVERLAY = { color: '#0a0a0b', symbolColor: '#a0a0a7', height: 31 };
async function createWindow() {
  win = new BrowserWindow({ width: 1500, height: 940, minWidth: 1100, minHeight: 680, backgroundColor: '#0a0a0b', title: 'Collection Sorter', icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'), titleBarStyle: 'hidden', titleBarOverlay: OVERLAY, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') } });
  Menu.setApplicationMenu(null);
  win.on('app-command', (e, cmd) => { if (cmd === 'browser-backward') win.webContents.send('cs-nav', -1); else if (cmd === 'browser-forward') win.webContents.send('cs-nav', 1); });
  const ws = () => { if (!win.isDestroyed()) win.webContents.send('cs-winstate', { fullScreen: win.isFullScreen(), maximized: win.isMaximized() }); };
  win.on('enter-full-screen', ws); win.on('leave-full-screen', ws); win.on('maximize', ws); win.on('unmaximize', ws);
  // Ctrl+Shift+I developer tools, Ctrl+Shift+R reload (there is no menu bar to hold them)
  win.webContents.on('before-input-event', (e, input) => { if (input.type !== 'keyDown' || !input.control || !input.shift) return; const k = String(input.key || '').toLowerCase(); if (k === 'i') { win.webContents.toggleDevTools(); e.preventDefault(); } else if (k === 'r') { win.webContents.reload(); e.preventDefault(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('http://127.0.0.1') && !url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  await boot();
}
// start (or restart) the engine and show the app; if it can't start, an in-app page says why (no Windows pop-up)
async function boot() {
  try {
    const port = await startEngine();
    await win.loadURL(`http://127.0.0.1:${port}/?t=${token}`);
    if (process.env.CS_SELFTEST) selfTest();
  } catch (e) {
    if (process.env.CS_SELFTEST) { try { fs.writeFileSync(path.join(process.env.CS_SELFTEST, 'selftest.log'), 'FAILED to start: ' + (e.stack || e.message)); } catch { /* ignore */ } quitting = true; app.exit(1); return; }
    await win.loadFile(path.join(__dirname, 'error.html'), { query: { msg: String(e.message || e), log: logFile } });
  }
}
// Self-test of the packaged app (CI, STANDARDS.md "Testing"): open every screen, save screenshots and a log,
// and fail when a screen doesn't come up or the page reports an error.
async function selfTest() {
  const dir = process.env.CS_SELFTEST; fs.mkdirSync(dir, { recursive: true });
  const lines = []; const errs = []; const say = (t) => { lines.push(t); try { fs.writeFileSync(path.join(dir, 'selftest.log'), lines.join('\n')); } catch { /* ignore */ } };
  win.webContents.on('console-message', (e, ...a) => { const lvl = e.level != null ? e.level : a[0]; const msg = e.message != null ? e.message : a[1]; if (lvl === 'error' || lvl >= 3) errs.push(String(msg)); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(4000);
  for (const r of ['setup', 'review', 'real', 'tags', 'dupes', 'sets', 'examples', 'knows', 'rules', 'undo', 'look', 'settings']) {
    await win.webContents.executeJavaScript(`location.hash = '#${r}'`); await wait(1500);
    const st = await win.webContents.executeJavaScript(`({ nav: document.querySelectorAll('#nav a').length, header: !!document.querySelector('#view .hd h1'), status: (document.querySelector('#statusbar') || {}).textContent || '', title: (document.querySelector('#tscr') || {}).textContent || '', sideways: document.querySelector('#view').scrollWidth > document.querySelector('#view').clientWidth + 1 })`);
    const ok = st.nav > 10 && st.header && st.status && !st.sideways;
    say(`${ok ? 'OK  ' : 'FAIL'} #${r}: menu items ${st.nav}, header ${st.header}, title "${st.title}", status "${st.status.trim().slice(0, 60)}"${st.sideways ? ', scrolls sideways' : ''}`);
    if (!ok) errs.push(`screen ${r} did not come up properly`);
    try { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(dir, `screen-${r}.png`), img.toPNG()); } catch (e) { say('screenshot failed: ' + e.message); }
  }
  try { // Look → Sizes → Overall size zooms the real window (Ctrl + =)
    const [w0, w1] = await win.webContents.executeJavaScript(`new Promise((r) => { const w = innerWidth; stepScale(1); setTimeout(() => { const w2 = innerWidth; stepScale(0); r([w, w2]); }, 500); })`);
    const zok = w1 < w0 - 20; say(`${zok ? 'OK  ' : 'FAIL'} overall size: page width ${w0} -> ${w1} at 110%`); if (!zok) errs.push('Overall size did not zoom the window');
  } catch (e) { errs.push('zoom check failed: ' + e.message); }
  say(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'No errors.');
  quitting = true; app.exit(errs.length ? 1 : 0);
}
ipcMain.on('cs-titlebar', (e, c) => { try { if (win && c) win.setTitleBarOverlay({ color: c.color || OVERLAY.color, symbolColor: c.symbolColor || OVERLAY.symbolColor, height: Math.max(24, Math.min(90, Math.round(c.height || OVERLAY.height))) }); } catch { /* not supported here */ } });
ipcMain.on('cs-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.on('cs-openlog', () => shell.openPath(logFile));
ipcMain.on('cs-restart', async () => { restarting = true; try { if (engine) engine.kill(); } catch { /* gone */ } await new Promise((r) => setTimeout(r, 400)); restarting = false; await boot(); });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; if (engine) { try { engine.kill(); } catch { /* already gone */ } } });
  app.on('will-quit', () => { try { fs.rmSync(flagFile, { force: true }); fs.writeFileSync(crashCountFile, JSON.stringify({ count: 0 })); } catch { /* ignore */ } });   // a clean exit
  app.on('render-process-gone', (e, wc, d) => crashFile('the window crashed', JSON.stringify(d)));
  app.on('child-process-gone', (e, d) => { if (d.type !== 'Utility') crashFile('a helper process crashed', JSON.stringify(d)); });
}
