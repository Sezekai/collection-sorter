'use strict';
// Where Collection Sorter keeps things (STANDARDS.md "Where things live", "Settings → Storage").
//   %LOCALAPPDATA%\Collection Sorter   settings, database, undo list, look, fonts, logs, small thumbnails (fast drive)
//   <root>\Models                      the AI models (about 1.7 GB)
//   <root>\Cache                       video previews and other big, safe-to-delete files
// <root> is the folder above the program's "App" folder (E:\Pictures\Collection Sorter), given by the shell as CS_ROOT.
// Without CS_ROOT (tests, running from source) everything stays in the data folder.
const fs = require('fs');
const path = require('path');
const settingsMod = require('./settings');
const { DATA_DIR } = settingsMod;
const ROOT = process.env.CS_ROOT ? path.resolve(process.env.CS_ROOT) : null;

const hasFiles = (d) => { try { return fs.readdirSync(d).length > 0; } catch { return false; } };
function modelDir(S = settingsMod.load()) {
  if (S.models && S.models.dir) return S.models.dir;
  const old = path.join(DATA_DIR, 'models');
  return ROOT && !hasFiles(old) ? path.join(ROOT, 'Models') : old;
}
function thumbDir(S = settingsMod.load()) { return (S.storage && S.storage.thumbs) || path.join(DATA_DIR, 'thumbs'); }
function cacheDir(S = settingsMod.load()) { return (S.storage && S.storage.cache) || (ROOT ? path.join(ROOT, 'Cache') : path.join(DATA_DIR, 'cache')); }
const logsDir = () => path.join(DATA_DIR, 'logs');

function places() {
  const S = settingsMod.load();
  return [
    { key: 'data', what: 'Settings, database, undo list, look and fonts', path: DATA_DIR, move: true, clear: false, note: 'Moving it needs a restart of the app.' },
    { key: 'models', what: 'AI models (tagger, CLIP, JoyTag)', path: modelDir(S), move: true, clear: false },
    { key: 'thumbs', what: 'Thumbnails (small, for the grid)', path: thumbDir(S), move: true, clear: true },
    { key: 'cache', what: 'Video previews and other cache', path: cacheDir(S), move: true, clear: true },
    { key: 'logs', what: 'Logs and crash reports', path: logsDir(), move: false, clear: false },
  ];
}
const pathOf = (key) => { const p = places().find((x) => x.key === key); return p ? p.path : null; };

// sizes are worked out in the background ("Working out…" until then) and kept for a minute
const sizes = new Map(); let sizing = null;
async function dirSize(dir, skip) {
  let n = 0, files = 0; const stack = [dir];
  while (stack.length) {
    const d = stack.pop(); let ents; try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) { const p = path.join(d, e.name); if (skip && skip(p)) continue; if (e.isDirectory()) stack.push(p); else { try { n += (await fs.promises.stat(p)).size; files++; } catch { /* gone */ } } }
  }
  return { bytes: n, files };
}
function info() {
  const list = places().map((p) => { const s = sizes.get(p.path); const exists = fs.existsSync(p.path); const drive = /^[a-z]:/i.test(p.path) ? p.path.slice(0, 2).toUpperCase() : null; const driveOk = !drive || process.platform !== 'win32' || fs.existsSync(drive + '\\');
    return { ...p, exists, missingDrive: driveOk ? null : drive, size: s && Date.now() - s.t < 60000 ? s.bytes : null, files: s ? s.files : null }; });
  if (!sizing) sizing = (async () => { for (const p of places()) { const others = places().filter((o) => o.path !== p.path && o.path.startsWith(p.path + path.sep)).map((o) => o.path); const r = await dirSize(p.path, (x) => others.some((o) => x === o || x.startsWith(o + path.sep))); sizes.set(p.path, { ...r, t: Date.now() }); } })().finally(() => { sizing = null; });
  return list;
}

// copy, check, switch, then remove the old copy (this is the app's own data, so a normal delete is fine)
async function copyTree(src, dst, onProgress, ctl) {
  const all = []; const stack = [src];
  while (stack.length) { const d = stack.pop(); let ents; try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; } for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) stack.push(p); else all.push(p); } }
  let total = 0; const st = new Map(); for (const f of all) { try { const s = await fs.promises.stat(f); st.set(f, s.size); total += s.size; } catch { /* gone */ } }
  let done = 0, i = 0; const t0 = Date.now();
  for (const f of all) {
    if (ctl && ctl.cancelled) throw new Error('Stopped. Nothing was switched; the old place is still used.');
    const rel = path.relative(src, f); const out = path.join(dst, rel);
    await fs.promises.mkdir(path.dirname(out), { recursive: true }); await fs.promises.copyFile(f, out);
    done += st.get(f) || 0; i++;
    if (i % 20 === 0 || i === all.length) { const sec = (Date.now() - t0) / 1000; const rate = sec > 0 ? done / sec : 0; onProgress({ phase: 'relocate', done: i, total: all.length, note: `${(done / 1e9).toFixed(2)} GB of ${(total / 1e9).toFixed(2)} GB${rate ? ` · ${(rate / 1e6).toFixed(1)} MB/s` : ''}` }); }
  }
  // check: every file is there with the same size
  for (const f of all) { const out = path.join(dst, path.relative(src, f)); let s; try { s = fs.statSync(out).size; } catch { s = -1; } if (s !== st.get(f)) throw new Error(`The copy of ${path.basename(f)} doesn't match. Nothing was switched; the old place is still used.`); }
  return { files: all.length, bytes: total };
}
async function move(key, dest, onProgress, ctl) {
  const p = places().find((x) => x.key === key); if (!p || !p.move) throw new Error('That one can’t be moved.');
  dest = path.resolve(dest); const name = { models: 'Models', cache: 'Cache', thumbs: 'thumbs', data: 'Collection Sorter' }[key];
  if (hasFiles(dest) && !dest.toLowerCase().endsWith(path.sep + name.toLowerCase())) dest = path.join(dest, name);
  if (dest === p.path) throw new Error('That is where it already is.');
  if (dest.startsWith(p.path + path.sep)) throw new Error('Pick a place outside the current folder.');
  if (hasFiles(dest)) throw new Error(`${dest} already has files in it. Pick an empty folder.`);
  await fs.promises.mkdir(dest, { recursive: true });
  if (key === 'data') { require('./db').close(); }
  const r = await copyTree(p.path, dest, onProgress, ctl);
  if (key === 'models') settingsMod.save({ models: { dir: dest } });
  if (key === 'thumbs') settingsMod.save({ storage: { thumbs: dest } });
  if (key === 'cache') settingsMod.save({ storage: { cache: dest } });
  if (key === 'data') { // the shell reads this pointer at the next start; the old copy is removed then
    return { ...r, dest, restart: true };
  }
  require('./thumbs').refreshDirs && require('./thumbs').refreshDirs();
  await fs.promises.rm(p.path, { recursive: true, force: true }).catch(() => {});
  sizes.clear();
  return { ...r, dest };
}
async function clear(key) {
  const p = places().find((x) => x.key === key); if (!p || !p.clear) throw new Error('That one can’t be cleared.');
  const s = await dirSize(p.path); await fs.promises.rm(p.path, { recursive: true, force: true }); await fs.promises.mkdir(p.path, { recursive: true }); sizes.clear();
  return { freed: s.bytes };
}
// models still in the data folder (C:) while the program sits in an App folder: moved to <root>\Models once, with progress
function needsModelMove(S = settingsMod.load()) { return !!ROOT && !(S.models && S.models.dir) && hasFiles(path.join(DATA_DIR, 'models')); }

module.exports = { ROOT, modelDir, thumbDir, cacheDir, logsDir, places, pathOf, info, move, clear, copyTree, needsModelMove, dirSize };
