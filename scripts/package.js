#!/usr/bin/env node
'use strict';
// Builds the portable Windows package (works on Windows and Linux):
//   dist/CollectionSorter-v<version>-win-x64.zip
//     Collection Sorter/
//       App/Collection Sorter.exe   <- the program; replaced by each update
//       READ ME FIRST.txt
// Unzipped into E:\Pictures it becomes E:\Pictures\Collection Sorter\App\…; the AI models (Models\) and the cache (Cache\)
// are made beside App\ on first use, and settings stay in %LOCALAPPDATA%\Collection Sorter. Nothing else is touched.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');
const pkg = require(path.join(HERE, 'package.json'));
const ELECTRON = process.env.ELECTRON_VER || pkg.electronVersion || '44.9.0';
const OUT = path.join(HERE, 'dist');
const TOP = path.join(OUT, 'Collection Sorter');
const APPDIR = path.join(TOP, 'App');
const win = process.platform === 'win32';
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function download(url, file) {
  return new Promise((resolve, reject) => {
    const get = (u, n) => https.get(u, { headers: { 'user-agent': 'collection-sorter-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && n < 8) { res.resume(); return get(new URL(res.headers.location, u).toString(), n + 1); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url}: HTTP ${res.statusCode}`)); }
      const out = fs.createWriteStream(file); res.pipe(out); out.on('finish', () => out.close(resolve)); out.on('error', reject);
    }).on('error', reject);
    get(url, 0);
  });
}
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

(async () => {
  rm(OUT); fs.mkdirSync(path.join(OUT, 'dl'), { recursive: true }); fs.mkdirSync(APPDIR, { recursive: true });
  console.log(`== Electron ${ELECTRON} (win32-x64)`);
  const ez = path.join(OUT, 'dl', 'electron.zip');
  await download(`https://github.com/electron/electron/releases/download/v${ELECTRON}/electron-v${ELECTRON}-win32-x64.zip`, ez);
  if (win) sh('tar', ['-xf', ez, '-C', APPDIR]); else sh('unzip', ['-q', ez, '-d', APPDIR]);
  fs.renameSync(path.join(APPDIR, 'electron.exe'), path.join(APPDIR, 'Collection Sorter.exe'));
  // the program's own icon (the logo from the side menu) and name in Explorer / the taskbar; rcedit runs on Windows only
  if (win) { try { const rcedit = require('rcedit'); await rcedit(path.join(APPDIR, 'Collection Sorter.exe'), { icon: path.join(HERE, 'app', 'icons', 'icon.ico'), 'version-string': { FileDescription: 'Collection Sorter', ProductName: 'Collection Sorter', CompanyName: 'Sezekai', OriginalFilename: 'Collection Sorter.exe' }, 'file-version': pkg.version, 'product-version': pkg.version }); console.log('== icon set'); } catch (e) { console.error('!! could not set the .exe icon:', e.message); if (process.env.CI) process.exit(1); } }
  rm(path.join(APPDIR, 'resources', 'default_app.asar'));
  const APP = path.join(APPDIR, 'resources', 'app'); fs.mkdirSync(APP, { recursive: true });
  for (const d of ['app', 'engine', 'ui']) fs.cpSync(path.join(HERE, d), path.join(APP, d), { recursive: true });
  const lean = { name: pkg.name, version: pkg.version, description: pkg.description, main: pkg.main, private: true, dependencies: pkg.dependencies };
  fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify(lean, null, 2));
  console.log('== Windows-only dependencies');
  sh(win ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--os=win32', '--cpu=x64', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: APP, shell: win });
  // keep only the Windows x64 native files
  const nm = path.join(APP, 'node_modules');
  for (const p of ['onnxruntime-node/bin/napi-v6/linux', 'onnxruntime-node/bin/napi-v6/darwin', 'onnxruntime-node/bin/napi-v6/win32/arm64']) rm(path.join(nm, p));
  for (const base of ['@img', '@ffmpeg-installer']) { const d = path.join(nm, base); if (!fs.existsSync(d)) continue; for (const n of fs.readdirSync(d)) if (/linux|darwin|arm64|wasm|ia32/.test(n)) rm(path.join(d, n)); }
  fs.copyFileSync(path.join(HERE, 'README-WINDOWS.txt'), path.join(TOP, 'READ ME FIRST.txt'));
  console.log('== zip');
  const zip = path.join(OUT, `CollectionSorter-v${pkg.version}-win-x64.zip`);
  if (win) sh('7z', ['a', '-tzip', '-mx=5', zip, 'Collection Sorter'], { cwd: OUT }); else sh('zip', ['-qr', zip, 'Collection Sorter'], { cwd: OUT });
  rm(path.join(OUT, 'dl'));
  console.log(`== ${zip} (${(fs.statSync(zip).size / 1e6).toFixed(0)} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
