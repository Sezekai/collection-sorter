'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { kindOf, isJunk, pkey } = require('./util');


function skipDir(abs, name, settings, root, excludes) {
  const rel = path.relative(root, abs).replace(/\\/g, '/').toLowerCase();
  const sub = (settings.ignoreSubfolders || []).map((s) => s.toLowerCase());
  const n = name.toLowerCase();
  if (sub.includes(n) || sub.includes(rel)) return true;
  // also match a destination-root relative form for "Folder/Sub" ignore entries
  for (const s of sub) if (s.includes('/') && rel.endsWith(s)) return true;
  for (const e of excludes || []) {
    const x = e.replace(/\\/g, '/').toLowerCase().replace(/^\/+|\/+$/g, '');
    if (rel === x || rel.startsWith(x + '/')) return true;
  }
  return false;
}

// Walk a folder and yield { abs, size, mtime, kind } for media files.
// Never blocks the app: the disk is read asynchronously and the walk pauses every ~25 ms so clicks are answered.
// With a cache (folder -> its modified time and subfolders from the last full walk), a folder whose modified time hasn't
// changed is not listed again: Windows updates a folder's modified time whenever a file in it is added, removed or renamed.
async function* walk(root, settings, excludes, topIgnore, opts = {}) {
  const fsp = fs.promises; const stack = [root]; let t0 = Date.now();
  const pause = async () => { if (Date.now() - t0 > 25) { await new Promise((r) => setImmediate(r)); t0 = Date.now(); } };
  const cache = opts.cache || null, fresh = opts.fresh || null; const wantStat = opts.stat !== false;
  while (stack.length) {
    const dir = stack.pop(); const rel = path.relative(root, dir).replace(/\\/g, '/') || '.';
    let dst; try { dst = await fsp.stat(dir); } catch { continue; }
    const c = cache && cache[rel]; let subs;
    if (c && c.m === dst.mtimeMs) subs = c.s;
    else {
      let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
      subs = []; const files = [];
      for (const e of ents) { if (e.isDirectory()) subs.push(e.name); else if (e.isFile() && !isJunk(e.name)) { const kind = kindOf(e.name); if (kind) files.push([path.join(dir, e.name), kind]); } }
      for (let i = 0; i < files.length; i += 16) {
        const part = files.slice(i, i + 16);
        const sts = wantStat ? await Promise.all(part.map(([abs]) => fsp.stat(abs).catch(() => null))) : part.map(() => ({ size: null, mtimeMs: null }));
        for (let j = 0; j < part.length; j++) { if (!sts[j]) continue; yield { abs: part[j][0], size: sts[j].size, mtime: sts[j].mtimeMs, kind: part[j][1] }; }
        await pause();
      }
    }
    if (fresh) fresh[rel] = { m: dst.mtimeMs, s: subs };
    for (const name of subs) {
      if (dir === root && topIgnore && topIgnore.has(name.toLowerCase())) continue;
      const abs = path.join(dir, name);
      if (!skipDir(abs, name, settings, root, excludes)) stack.push(abs);
    }
    await pause();
  }
}

// The walk cache is trusted only while nothing else changed what was found before: the same settings for what is scanned,
// the same number of rows in the table it fills, and less than a week old. Otherwise everything is listed again.
const WEEK = 7 * 24 * 3600 * 1000;
function walkKey(settings, kind) {
  const S = settings; return JSON.stringify(kind === 'src' ? [(S.sources || []).map((x) => [x.path, x.excludes]), S.ignoreSubfolders, S.destinationRoot] : [S.referenceRoots, S.referenceMap, S.ignoreFolders, S.ignoreSubfolders, S.dupesFolder]);
}
const rowCount = (kind) => (kind === 'src' ? db.get().prepare('select count(*) c from files').get().c : db.get().prepare('select (select count(*) from refs) + (select count(*) from refs_extra) c').get().c);
function loadWalkCache(settings, kind, full) {
  if (full) return null;
  const c = db.kvGet('walk_' + kind, null);
  if (!c || c.key !== walkKey(settings, kind) || c.rows !== rowCount(kind) || Date.now() - c.ts > WEEK) return null;
  return c.roots || {};
}
function saveWalkCache(settings, kind, roots) { db.kvSet('walk_' + kind, { key: walkKey(settings, kind), rows: rowCount(kind), ts: Date.now(), roots }); }

// Add files from the configured sources. Existing paths are left alone.
async function scanSources(settings, onProgress, ctl, opts = {}) {
  const d = db.get(); const cache = loadWalkCache(settings, 'src', opts.full); const fresh = {}; let complete = true;
  const ins = d.prepare(`insert or ignore into files(path,pkey,source,size,mtime,kind,ext) values(?,?,?,?,?,?,?)`);
  let seen = 0, added = 0;
  const destRoot = settings.destinationRoot ? pkey(settings.destinationRoot) : null;
  for (const src of settings.sources || []) {
    if (!src.path || !fs.existsSync(src.path)) continue;
    let batch = [];
    const flush = () => { if (!batch.length) return; db.tx(() => { for (const r of batch) { const res = ins.run(...r); if (res.changes) added++; } }); batch = []; };
    fresh[src.path] = {};
    for await (const f of walk(src.path, settings, src.excludes, null, { cache: cache && cache[src.path], fresh: fresh[src.path] })) {
      if (ctl && ctl.cancelled) { complete = false; break; }
      // never pick up files that are already inside the destination tree
      if (destRoot && pkey(f.abs).startsWith(destRoot + '/')) continue;
      seen++;
      batch.push([f.abs, pkey(f.abs), src.path, f.size, f.mtime, f.kind, path.extname(f.abs).toLowerCase()]);
      if (batch.length >= 400) { flush(); if (onProgress) onProgress({ phase: 'scan', seen, added }); }
    }
    flush();
    if (ctl && ctl.cancelled) { complete = false; break; }
  }
  if (complete) saveWalkCache(settings, 'src', fresh);
  if (onProgress) onProgress({ phase: 'scan', seen, added, done: true });
  return { seen, added };
}

// Reference library: existing sorted files that teach the app. Folder = top level folder name unless mapped.
// Which destination folders an example teaches: a list (empty = not used). The longest mapped prefix wins; a map value is a folder, a list of folders, or null (don't use).
function refTargetsFor(rel, settings) {
  const parts = rel.split('/');
  const map = settings.referenceMap || {};
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const low = rel.toLowerCase();
  for (const k of keys) {
    const kl = k.toLowerCase();
    if (low === kl || low.startsWith(kl + '/')) { const v = map[k]; return v === null || v === undefined ? [] : Array.isArray(v) ? v.filter(Boolean) : [v]; }
  }
  return parts[0] ? [parts[0]] : [];
}
function refFolderFor(rel, settings) { return refTargetsFor(rel, settings)[0] || null; }

async function scanReferences(settings, onProgress, ctl, opts = {}) {
  const d = db.get(); const cache = loadWalkCache(settings, 'ref', opts.full); const fresh = {}; let complete = true;
  const ins = d.prepare(`insert or ignore into refs(path,folder,kind,label) values(?,?,?,?)`);
  const insX = d.prepare('insert or ignore into refs_extra(ref_id,folder) select id,? from refs where path=?');
  const top = new Set((settings.ignoreFolders || []).map((s) => s.toLowerCase()));
  let seen = 0, added = 0, checked = 0;
  for (const root of settings.referenceRoots || []) {
    if (!fs.existsSync(root)) continue;
    let batch = [];
    const flush = () => { if (!batch.length) return; db.tx(() => { for (const r of batch) { if (ins.run(r[0], r[1], r[2], r[3]).changes) added++; for (const x of r[4] || []) insX.run(x, r[0]); } }); batch = []; };
    fresh[root] = {};
    for await (const f of walk(root, settings, [], top, { stat: false, cache: cache && cache[root], fresh: fresh[root] })) {
      if (ctl && ctl.cancelled) { complete = false; break; }
      if (++checked % 300 === 0 && !(require('./settings').load().referenceRoots || []).includes(root)) { complete = false; break; } // removed while scanning
      const rel = path.relative(root, f.abs).replace(/\\/g, '/');
      const targets = refTargetsFor(rel, settings).filter((x) => x.toLowerCase() !== String(settings.dupesFolder || 'dupes').toLowerCase());
      const folder = targets[0];
      if (!folder) continue;
      seen++;
      const pl = f.abs.replace(/\\/g, '/').toLowerCase();
      if (/\/find higher quality\//.test(pl)) continue;
      batch.push([f.abs, folder, f.kind, /\/very(\/|$)/.test(pl) ? 'very' : /\/nsfw(\/|$)/.test(pl) ? 'nsfw' : 'general', targets.slice(1)]);
      if (batch.length >= 400) { flush(); if (onProgress) onProgress({ phase: 'refscan', seen, added }); }
    }
    flush();
    if (ctl && ctl.cancelled) { complete = false; break; }
  }
  if (complete) saveWalkCache(settings, 'ref', fresh);
  if (onProgress) onProgress({ phase: 'refscan', seen, added, done: true });
  return { seen, added };
}

module.exports = { scanSources, scanReferences, walk, refFolderFor, refTargetsFor };
