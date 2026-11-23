'use strict';
// Look Up and Find Higher Quality are plain folders now (no lookup sites, no sections in the app):
//   Look Up (L):  <lookupRoot>[/Videos | /Real/Images | /Real/Videos][/NSFW[/Very]]
//   Find HQ (Q):  <fhqRoot>/<the folder it would have gone to>[/NSFW[/Very]]   e.g. …\Find Higher Quality\Anime\NSFW
// Both moves are journaled like any other, so Undo and Ctrl+Z put them back.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const settingsMod = require('./settings');
const { destDir } = require('./catalog');
const { ensureDir, pkey, log } = require('./util');

function need(dir, what) {
  if (!dir) { const e = new Error(`Set the ${what} folder first (Setup → Destination).`); e.code = 'no_folder'; throw e; }
  // made when first used (with any missing parents); only a drive that isn't there stops it
  const top = path.parse(path.resolve(dir)).root;
  if (top && !fs.existsSync(top)) { const e = new Error(`The ${what} folder can't be made: ${top} isn't there (is the drive connected?).`); e.code = 'no_folder'; throw e; }
  return dir;
}
function lookupDir(S, row, rating) {
  const root = need(S.lookupRoot, 'Look Up');
  const real = (row.realness || 'art') === 'real'; const vid = row.kind === 'video';
  const sub = real ? (vid ? 'Real/Videos' : 'Real/Images') : vid ? 'Videos' : '';
  return destDir(root, sub, rating);
}
function fhqDir(S, folder, rating) { return destDir(need(S.fhqRoot, 'Find Higher Quality'), folder || '', rating); }

// Move files (waiting for review, or already sorted) to Look Up. ids -> { moved, failed }
async function sendToLookup(ids) {
  const S = settingsMod.load(); const d = db.get(); const mover = require('./mover');
  need(S.lookupRoot, 'Look Up');
  const rows = []; for (const id of ids) { const r = d.prepare(`select f.id,f.path,f.size,f.kind,f.status,f.realness,s.rating,s.user_rating from files f left join suggestions s on s.file_id=f.id where f.id=?`).get(id); if (r && (r.status === 'new' || r.status === 'moved')) rows.push(r); }
  let moved = 0, failed = 0, firstErr = '';
  for (const kind of ['new', 'moved']) {
    const list = rows.filter((r) => r.status === kind); if (!list.length) continue;
    const batch = Number(d.prepare('insert into batches(ts,kind,note) values(?,?,?)').run(Date.now(), kind === 'new' ? 'apply' : 'relocate', 'Look Up').lastInsertRowid);
    for (const r of list) {
      let jid = null;
      try {
        if (!fs.existsSync(r.path)) throw new Error('file no longer exists');
        const rating = r.user_rating || r.rating || mover.ratingOfPath(r.path);
        const dir = lookupDir(S, r, rating); ensureDir(dir);
        const dst = mover.uniquePath(dir, path.basename(r.path));
        jid = Number(d.prepare('insert into journal(batch_id,file_id,src,dst,size,fp,ts,status) values(?,?,?,?,?,?,?,?)').run(batch, r.id, r.path, dst, r.size, null, Date.now(), 'pending').lastInsertRowid);
        await mover.safeMove(r.path, dst);
        d.prepare(`update journal set status='moved', dst=? where id=?`).run(dst, jid);
        d.prepare(`update files set status='moved', path=?, pkey=?, moved_at=? where id=?`).run(dst, pkey(dst), Date.now(), r.id);
        d.prepare(`update suggestions set state='moved' where file_id=?`).run(r.id);
        moved++;
      } catch (e) { failed++; if (!firstErr) firstErr = e.message; if (jid) d.prepare(`update journal set status='failed', err=? where id=?`).run(String(e.message).slice(0, 300), jid); }
    }
  }
  return { moved, failed, error: firstErr || undefined, folder: S.lookupRoot };
}

// Files that went to the Recycle Bin (the window does that through Windows): forget them and note it in the log.
function recordDeleted(ids) {
  const d = db.get(); let n = 0, still = 0;
  for (const id of ids) {
    const f = d.prepare('select id,path,fp,status from files where id=?').get(id); if (!f) continue;
    if (fs.existsSync(f.path)) { still++; continue; }
    db.tx(() => { d.prepare(`update files set status='deleted' where id=?`).run(id); d.prepare('delete from suggestions where file_id=?').run(id); d.prepare('insert into hq_log(ts,file_id,fp,name,path,event,detail) values(?,?,?,?,?,?,?)').run(Date.now(), id, f.fp, path.basename(f.path), f.path, 'recycled', null); });
    log(`Sent to the Recycle Bin: ${f.path}`); n++;
  }
  return { recorded: n, stillThere: still };
}

// ---- once, when 1.7 first starts ----
// Files in the old per-folder "Find Higher Quality" subfolders (and "Find Higher Quality Manually") move to the new Find Higher Quality folder,
// keeping the folder they were in (Anime/NSFW/Find Higher Quality/x.jpg -> <fhqRoot>/Anime/NSFW/x.jpg); the emptied old folders are removed.
// Files still waiting in the old Source lookup list move to Look Up. Nothing is deleted except empty folders.
async function migrate() {
  const S = settingsMod.load(); const d = db.get();
  if (db.kvGet('migrated17', false)) return null;
  const out = { fhqMoved: 0, fhqFolders: 0, lookupMoved: 0, problems: [] };
  const root = S.destinationRoot;
  const isFhq = (n) => /^find higher quality( manually)?$/i.test(n);
  const found = [];
  const walk = (dir, rel, depth) => { if (depth > 6) return; let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of ents) if (e.isDirectory()) { if (isFhq(e.name)) found.push({ dir: path.join(dir, e.name), rel }); else walk(path.join(dir, e.name), rel.concat(e.name), depth + 1); } };
  if (root && fs.existsSync(root)) walk(root, [], 0);
  let sauceIds = []; try { sauceIds = d.prepare(`select distinct f.id from sauce sa join files f on f.fp=sa.fp where f.status='new'`).all().map((r) => r.id); } catch { /* no old table */ }
  if (!found.length && !sauceIds.length) { db.kvSet('migrated17', { ts: Date.now(), ...out }); return out; }   // nothing from before 1.7 to tidy
  if (S.fhqRoot && found.length && fs.existsSync(path.parse(path.resolve(S.fhqRoot)).root)) {
    const mover = require('./mover');
    for (const f of found) {
      const list = []; const collect = (dir, sub) => { let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of ents) { const abs = path.join(dir, e.name); if (e.isDirectory()) collect(abs, sub.concat(e.name)); else if (e.isFile()) list.push({ abs, sub }); } };
      collect(f.dir, []);
      for (const x of list) {
        try {
          const dir = path.join(S.fhqRoot, ...f.rel, ...x.sub); ensureDir(dir);
          const dst = mover.uniquePath(dir, path.basename(x.abs));
          await mover.safeMove(x.abs, dst);
          d.prepare(`update files set path=?, pkey=? where pkey=?`).run(dst, pkey(dst), pkey(x.abs));
          out.fhqMoved++;
        } catch (e) { out.problems.push(`${x.abs}: ${e.message}`); }
      }
      const rmEmpty = (dir) => { let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; } let empty = true; for (const e of ents) { if (e.isDirectory() && rmEmpty(path.join(dir, e.name))) continue; empty = false; } if (empty) { try { fs.rmdirSync(dir); return true; } catch { return false; } } return false; };
      if (rmEmpty(f.dir)) out.fhqFolders++;
    }
  } else if (!S.fhqRoot && found.length) out.problems.push('The Find Higher Quality folder is not set, so the old Find Higher Quality folders were left as they are.');
  // the old Source lookup list: pictures still waiting for review there go to Look Up
  try {
    const ids = sauceIds;
    if (ids.length && S.lookupRoot) { const r = await sendToLookup(ids); out.lookupMoved = r.moved; if (r.failed) out.problems.push(`${r.failed} could not go to Look Up: ${r.error}`); }
    if (!ids.length || S.lookupRoot) d.exec('delete from sauce');
  } catch (e) { out.problems.push('Look Up: ' + e.message); }
  // done for good only once both folders are set (until then it runs again at the next start, or when they are set)
  if (S.fhqRoot && S.lookupRoot) db.kvSet('migrated17', { ts: Date.now(), ...out });
  log(`1.7 tidy-up: ${out.fhqMoved} file(s) moved out of the old Find Higher Quality folders (${out.fhqFolders} removed) into ${S.fhqRoot || '(not set)'}; ${out.lookupMoved} moved from Source lookup to Look Up${out.problems.length ? '. Problems: ' + out.problems.slice(0, 5).join(' | ') : ''}`);
  return out;
}

// a fresh install has nothing from before 1.7: no need to show a job for it
function nothingToMigrate() { const S = settingsMod.load(); let n = 0; try { n = db.get().prepare('select count(*) c from sauce').get().c; } catch { /* no table */ } return !S.destinationRoot && !n; }
module.exports = { nothingToMigrate, lookupDir, fhqDir, sendToLookup, recordDeleted, migrate };
