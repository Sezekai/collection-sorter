'use strict';
// Reads the destination folder tree and builds destination paths (including NSFW / Very subfolders).
const fs = require('fs');
const path = require('path');
const { normName } = require('./util');

function listDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
}
function findSub(dir, name) {
  const want = name.toLowerCase();
  return listDirs(dir).find((n) => n.toLowerCase() === want) || null;
}

function readCatalog(root, settings) {
  const ignored = new Set((settings.ignoreFolders || []).map((s) => s.toLowerCase()));
  const folders = [];
  if (!root || !fs.existsSync(root)) return { root, folders, byName: {} };
  for (const name of listDirs(root)) {
    const abs = path.join(root, name);
    const subs = listDirs(abs);
    const nsfw = subs.find((s) => s.toLowerCase() === 'nsfw') || null;
    let very = null;
    if (nsfw) { const v = findSub(path.join(abs, nsfw), 'very'); if (v) very = path.join(nsfw, v); }
    if (!very) { const v = findSub(abs, 'very'); if (v) very = v; }
    const others = subs.filter((s) => !['nsfw', 'very'].includes(s.toLowerCase()));
    folders.push({ name, abs, ignored: ignored.has(name.toLowerCase()), nsfw, very, subfolders: others });
  }
  const byName = Object.fromEntries(folders.map((f) => [f.name, f]));
  return { root, folders, byName };
}

// Resolve a destination directory for a folder (relative to root, e.g. "Attack on Titan" or "Real/Images/Cosplay").
// rating: 'general' | 'nsfw' | 'very'. Missing NSFW / Very folders are created on demand by the mover.
function destDir(root, folderRel, rating) {
  const parts = folderRel.split(/[\\/]+/).filter(Boolean);
  let base = root;
  for (const p of parts) base = path.join(base, findSub(base, p) || p);
  if (rating === 'general' || !rating) return base;
  const nsfw = findSub(base, 'nsfw') || 'NSFW';
  if (rating === 'nsfw') return path.join(base, nsfw);
  // very: prefer an existing Very (inside NSFW first, then directly under the folder)
  const inNsfw = findSub(path.join(base, nsfw), 'very');
  if (inNsfw) return path.join(base, nsfw, inNsfw);
  const direct = findSub(base, 'very');
  if (direct) return path.join(base, direct);
  return path.join(base, nsfw, 'Very');
}

// Real disk spelling of a relative path (case-insensitive match per segment); null when it is not on disk.
function resolveRel(root, rel) {
  let base = root; const out = [];
  for (const seg of String(rel).split(/[\\/]+/).filter(Boolean)) { const f = findSub(base, seg); if (!f) return null; out.push(f); base = path.join(base, f); }
  return out.join('/');
}

// Every folder the user can pick as a destination: each top-level folder, plus the subfolders (any depth) they ticked as targets of their own.
// Folders that were renamed or deleted on disk simply stop being offered; new ones show up on the next look.
function destinationChoices(cat, settings) {
  const subs = ((settings && settings.subTargets) || []).filter(Boolean);
  const out = []; const seen = new Set(); const push = (x) => { if (!seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); out.push(x); } };
  for (const f of cat.folders) {
    if (f.ignored) continue;
    const mine = subs.filter((s) => s.toLowerCase().startsWith(f.name.toLowerCase() + '/'));
    if (!(f.name.toLowerCase() === 'real' && mine.length)) push(f.name);
    for (const s of mine) { const real = resolveRel(cat.root, s); if (real) push(real); else if (f.name.toLowerCase() === 'real') push(s); }   // the Real leaves are created on demand
  }
  return out;
}

// Subtargets chosen in settings that are no longer on disk (renamed or deleted).
function missingSubTargets(cat, settings) {
  return ((settings && settings.subTargets) || []).filter((s) => !resolveRel(cat.root, s) && !/^real\//i.test(s));
}

module.exports = { readCatalog, destDir, destinationChoices, missingSubTargets, resolveRel, findSub, listDirs, normName };
