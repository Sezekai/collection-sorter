'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { kindOf, isJunk, pkey } = require('./util');

const tick = () => new Promise((r) => setImmediate(r));

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
async function* walk(root, settings, excludes, topIgnore) {
  const stack = [root];
  let n = 0;
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (dir === root && topIgnore && topIgnore.has(e.name.toLowerCase())) continue;
        if (!skipDir(abs, e.name, settings, root, excludes)) stack.push(abs);
      } else if (e.isFile()) {
        if (isJunk(e.name)) continue;
        const kind = kindOf(e.name);
        if (!kind) continue;
        let st; try { st = fs.statSync(abs); } catch { continue; }
        yield { abs, size: st.size, mtime: st.mtimeMs, kind };
        if (++n % 500 === 0) await tick();
      }
    }
  }
}

// Add files from the configured sources. Existing paths are left alone.
async function scanSources(settings, onProgress, ctl) {
  const d = db.get();
  const ins = d.prepare(`insert or ignore into files(path,pkey,source,size,mtime,kind,ext) values(?,?,?,?,?,?,?)`);
  let seen = 0, added = 0;
  const destRoot = settings.destinationRoot ? pkey(settings.destinationRoot) : null;
  for (const src of settings.sources || []) {
    if (!src.path || !fs.existsSync(src.path)) continue;
    let batch = [];
    const flush = () => { if (!batch.length) return; db.tx(() => { for (const r of batch) { const res = ins.run(...r); if (res.changes) added++; } }); batch = []; };
    for await (const f of walk(src.path, settings, src.excludes)) {
      if (ctl && ctl.cancelled) break;
      // never pick up files that are already inside the destination tree
      if (destRoot && pkey(f.abs).startsWith(destRoot + '/')) continue;
      seen++;
      batch.push([f.abs, pkey(f.abs), src.path, f.size, f.mtime, f.kind, path.extname(f.abs).toLowerCase()]);
      if (batch.length >= 400) { flush(); if (onProgress) onProgress({ phase: 'scan', seen, added }); }
    }
    flush();
    if (ctl && ctl.cancelled) break;
  }
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

async function scanReferences(settings, onProgress, ctl) {
  const d = db.get();
  const ins = d.prepare(`insert or ignore into refs(path,folder,kind,label) values(?,?,?,?)`);
  const insX = d.prepare('insert or ignore into refs_extra(ref_id,folder) select id,? from refs where path=?');
  const top = new Set((settings.ignoreFolders || []).map((s) => s.toLowerCase()));
  let seen = 0, added = 0, checked = 0;
  for (const root of settings.referenceRoots || []) {
    if (!fs.existsSync(root)) continue;
    let batch = [];
    const flush = () => { if (!batch.length) return; db.tx(() => { for (const r of batch) { if (ins.run(r[0], r[1], r[2], r[3]).changes) added++; for (const x of r[4] || []) insX.run(x, r[0]); } }); batch = []; };
    for await (const f of walk(root, settings, [], top)) {
      if (ctl && ctl.cancelled) break;
      if (++checked % 300 === 0 && !(require('./settings').load().referenceRoots || []).includes(root)) break; // removed while scanning
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
  }
  if (onProgress) onProgress({ phase: 'refscan', seen, added, done: true });
  return { seen, added };
}

module.exports = { scanSources, scanReferences, walk, refFolderFor, refTargetsFor };
