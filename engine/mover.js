'use strict';
// Moves approved files, journals every move, and can undo per file, per folder or per batch. Never overwrites, never deletes media.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { destDir } = require('./catalog');
const { fingerprint } = require('./hashing');
const { ensureDir, pkey } = require('./util');

const FORCE_COPY = () => process.env.CS_FORCE_COPY === '1';

function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext);
  let p = path.join(dir, name), i = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

// Rename, or copy -> verify -> remove when the destination is on another drive.
async function safeMove(src, dst) {
  try {
    if (FORCE_COPY()) { const e = new Error('forced'); e.code = 'EXDEV'; throw e; }
    fs.renameSync(src, dst); return { copied: false };
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
  }
  const size = fs.statSync(src).size;
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  try {
    const st = fs.statSync(dst);
    if (st.size !== size || (await fingerprint(dst, size)) !== (await fingerprint(src, size))) throw new Error('copy did not match the original');
  } catch (err) { try { fs.unlinkSync(dst); } catch { /* ignore */ } throw err; }
  fs.unlinkSync(src);
  return { copied: true };
}

const ratingOfPath = (p) => { const s = p.replace(/\\/g, '/').toLowerCase(); return /\/very(\/|$)/.test(s) ? 'very' : /\/nsfw(\/|$)/.test(s) ? 'nsfw' : 'general'; };

// Move files that were already moved (for example out of a Find Higher Quality folder) to another destination folder. Journaled and undoable.
async function relocate(settings, ids, folder, rating, note = '', onProgress) {
  const d = db.get(); const root = settings.destinationRoot;
  if (!root) throw new Error('No destination folder is set.');
  const rows = ids.map((id) => d.prepare(`select id,path,size from files where id=? and status='moved'`).get(id)).filter(Boolean);
  if (!rows.length) return { batch: null, moved: 0, failed: 0 };
  const batch = Number(d.prepare('insert into batches(ts,kind,note) values(?,?,?)').run(Date.now(), 'relocate', note).lastInsertRowid);
  const jIns = d.prepare('insert into journal(batch_id,file_id,src,dst,size,fp,ts,status) values(?,?,?,?,?,?,?,?)');
  let moved = 0, failed = 0;
  for (const r of rows) {
    let jid = null;
    try {
      if (!fs.existsSync(r.path)) throw new Error('file no longer exists');
      const dir = destDir(root, folder, rating || ratingOfPath(r.path));
      ensureDir(dir);
      const dst = uniquePath(dir, path.basename(r.path));
      jid = Number(jIns.run(batch, r.id, r.path, dst, r.size, null, Date.now(), 'pending').lastInsertRowid);
      await safeMove(r.path, dst);
      d.prepare(`update journal set status='moved', dst=? where id=?`).run(dst, jid);
      d.prepare(`update files set path=?, pkey=? where id=?`).run(dst, pkey(dst), r.id);
      moved++;
    } catch (e) { failed++; if (jid) d.prepare(`update journal set status='failed', err=? where id=?`).run(String(e.message).slice(0, 300), jid); }
    if (onProgress) onProgress({ phase: 'move', done: moved + failed, total: rows.length, moved, failed });
  }
  return { batch, moved, failed };
}

function effective(row, settings) {
  const folder = row.user_folder || row.folder;
  let rating = row.user_rating || row.rating || 'general';
  if (row.lane === 'dupe' || row.lane === 'set') rating = 'general';
  return { folder, rating };
}

// Apply approved suggestions. ids = optional list of file ids; otherwise every approved one.
async function applyApproved(settings, { ids = null, note = '' } = {}, onProgress) {
  const d = db.get();
  const root = settings.destinationRoot;
  if (!root) throw new Error('No destination folder is set.');
  const rows = d.prepare(`select s.*, f.path, f.size from suggestions s join files f on f.id=s.file_id where s.state='approved' and f.status='new'`).all()
    .filter((r) => (!ids || ids.includes(r.file_id)) && (r.user_folder || r.folder));
  if (!rows.length) return { batch: null, moved: 0, failed: 0 };
  const batch = Number(d.prepare('insert into batches(ts,kind,note) values(?,?,?)').run(Date.now(), 'apply', note).lastInsertRowid);
  const jIns = d.prepare('insert into journal(batch_id,file_id,src,dst,size,fp,ts,status) values(?,?,?,?,?,?,?,?)');
  const jDone = d.prepare('update journal set status=?, err=?, dst=? where id=?');
  let moved = 0, failed = 0, n = 0;
  for (const r of rows) {
    const { folder, rating } = effective(r, settings);
    let dir = null;
    let jid = null;
    try {
      dir = r.fhq ? require('./lookup').fhqDir(settings, folder, rating) : destDir(root, folder, rating);   // Find higher quality: the Find Higher Quality folder, in the same folder layout
      if (!fs.existsSync(r.path)) throw new Error('file no longer exists');
      ensureDir(dir);
      const dst = uniquePath(dir, path.basename(r.path));
      jid = Number(jIns.run(batch, r.file_id, r.path, dst, r.size, null, Date.now(), 'pending').lastInsertRowid);
      await safeMove(r.path, dst);
      jDone.run('moved', null, dst, jid);
      d.prepare(`update files set status='moved', path=?, pkey=?, moved_at=? where id=?`).run(dst, pkey(dst), Date.now(), r.file_id);
      d.prepare(`update suggestions set state='moved' where file_id=?`).run(r.file_id);
      moved++;
    } catch (e) {
      failed++;
      if (jid) jDone.run('failed', String(e.message).slice(0, 300), null, jid);
      else { const j2 = Number(jIns.run(batch, r.file_id, r.path, null, r.size, null, Date.now(), 'failed').lastInsertRowid); d.prepare('update journal set err=? where id=?').run(String(e.message).slice(0, 300), j2); }
    }
    if (onProgress && ++n % 20 === 0) onProgress({ phase: 'move', done: n, total: rows.length, moved, failed });
  }
  if (onProgress) onProgress({ phase: 'move', done: n, total: rows.length, moved, failed, finished: true });
  return { batch, moved, failed };
}

// After a crash a 'pending' journal row may have a half-finished move. Reconcile them.
function recover() {
  const d = db.get();
  for (const j of d.prepare(`select * from journal where status='pending'`).all()) {
    const srcOk = j.src && fs.existsSync(j.src), dstOk = j.dst && fs.existsSync(j.dst);
    if (srcOk && dstOk) { try { if (fs.statSync(j.dst).size !== j.size) fs.unlinkSync(j.dst); } catch { /* leave */ } d.prepare(`update journal set status='failed', err='interrupted' where id=?`).run(j.id); }
    else if (dstOk && !srcOk) { d.prepare(`update journal set status='moved' where id=?`).run(j.id); d.prepare(`update files set status='moved', path=?, pkey=? where id=?`).run(j.dst, pkey(j.dst), j.file_id); d.prepare(`update suggestions set state='moved' where file_id=?`).run(j.file_id); }
    else d.prepare(`update journal set status='failed', err='interrupted' where id=?`).run(j.id);
  }
}

async function undoRows(rows, onProgress) {
  const d = db.get(); let ok = 0, bad = 0;
  for (const j of rows) {
    try {
      if (!j.dst || !fs.existsSync(j.dst)) throw new Error('the moved file is no longer there');
      ensureDir(path.dirname(j.src));
      const back = fs.existsSync(j.src) ? uniquePath(path.dirname(j.src), path.basename(j.src)) : j.src;
      await safeMove(j.dst, back);
      d.prepare(`update journal set status='undone' where id=?`).run(j.id);
      const bk = d.prepare('select kind from batches where id=?').get(j.batch_id);
      if (bk && bk.kind === 'relocate') d.prepare(`update files set path=?, pkey=? where id=?`).run(back, pkey(back), j.file_id); // it was already moved before: stays moved
      else { d.prepare(`update files set status='new', path=?, pkey=? where id=?`).run(back, pkey(back), j.file_id); d.prepare(`update suggestions set state='pending' where file_id=?`).run(j.file_id); }
      ok++;
    } catch (e) { bad++; d.prepare(`update journal set err=? where id=?`).run(String(e.message).slice(0, 300), j.id); }
    if (onProgress) onProgress({ phase: 'undo', done: ok + bad, total: rows.length });
  }
  return { undone: ok, failed: bad };
}

const undoBatch = (id, cb) => undoRows(db.get().prepare(`select * from journal where batch_id=? and status='moved' order by id desc`).all(id), cb);
const undoFile = (jid, cb) => undoRows(db.get().prepare(`select * from journal where id=? and status='moved'`).all(jid), cb);
// everything that ended up in a destination folder (prefix match on the folder path)
function undoFolder(dirPrefix, cb) {
  const pre = pkey(dirPrefix);
  const rows = db.get().prepare(`select * from journal where status='moved' order by id desc`).all().filter((j) => pkey(j.dst).startsWith(pre + '/'));
  return undoRows(rows, cb);
}

function history(limit = 200) {
  const d = db.get();
  return d.prepare(`select b.id,b.ts,b.note,(select count(*) from journal j where j.batch_id=b.id and j.status='moved') moved,
    (select count(*) from journal j where j.batch_id=b.id and j.status='undone') undone,
    (select count(*) from journal j where j.batch_id=b.id and j.status='failed') failed from batches b order by b.id desc limit ?`).all(limit);
}

module.exports = { relocate, ratingOfPath, applyApproved, recover, undoBatch, undoFile, undoFolder, history, uniquePath, safeMove };
