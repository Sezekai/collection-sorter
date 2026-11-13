'use strict';
// Duplicate groups and Connected Art sets. Both run over already-analysed files.
const path = require('path');
const db = require('./db');
const { fullSha, hamming64 } = require('./hashing');
const { fromBlob } = require('./analyze');
const { assessRow } = require('./quality');

class UF { constructor() { this.p = new Map(); } find(x) { if (!this.p.has(x)) this.p.set(x, x); let r = x; while (this.p.get(r) !== r) r = this.p.get(r); this.p.set(x, r); return r; } union(a, b) { this.p.set(this.find(a), this.find(b)); } }
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function loadEmbs(ids) {
  const g = db.get().prepare('select v from emb where file_id=?');
  const m = new Map();
  for (const id of ids) { const r = g.get(id); if (r) m.set(id, fromBlob(r.v)); }
  return m;
}

// Which duplicate to keep: biggest picture, then biggest file, then oldest, then shortest path.
function betterFirst(a, b) {
  return ((b.w * b.h) - (a.w * a.h)) || (b.size - a.size) || (a.mtime - b.mtime) || (a.path.length - b.path.length);
}

async function findDupes(settings, onProgress) {
  const d = db.get();
  const rows = d.prepare(`select id,path,size,mtime,kind,fp,sha,w,h,phash,qscore from files where analyzed=1 and status='new' and id not in (select file_id from dupe_ignore)`).all();
  const uf = new UF(); const exact = new Set();
  // 1. exact: same fast fingerprint, confirmed by full hash
  const byFp = new Map();
  for (const r of rows) { if (!r.fp) continue; (byFp.get(r.fp) || byFp.set(r.fp, []).get(r.fp)).push(r); }
  const setSha = d.prepare('update files set sha=? where id=?');
  let n = 0;
  for (const grp of byFp.values()) {
    if (grp.length < 2) continue;
    const by = new Map();
    for (const r of grp) { if (!r.sha) { r.sha = await fullSha(r.path).catch(() => null); if (r.sha) setSha.run(r.sha, r.id); } if (r.sha) (by.get(r.sha) || by.set(r.sha, []).get(r.sha)).push(r); }
    for (const same of by.values()) if (same.length > 1) { for (const r of same) { uf.union(same[0].id, r.id); exact.add(r.id); } }
    if (++n % 50 === 0 && onProgress) onProgress({ phase: 'dupes', note: 'exact' });
  }
  // 2. near: perceptual hash within Hamming distance, confirmed by CLIP similarity (images only)
  const imgs = rows.filter((r) => r.kind === 'image' && r.phash);
  const maxH = settings.dupes.maxHamming, minSim = settings.dupes.minClipSimilarity;
  const bands = 8, bw = 8; // 8 bands x 8 bits: any hash within 7 flips shares at least one whole band
  const buckets = new Map();
  const bandOf = (h, i) => h.slice(i * 2, i * 2 + 2);
  for (const r of imgs) for (let i = 0; i < bands; i++) { const k = i + ':' + bandOf(r.phash, i); (buckets.get(k) || buckets.set(k, []).get(k)).push(r); }
  const embs = loadEmbs(imgs.map((r) => r.id));
  const seen = new Set();
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 400) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
      if (seen.has(key)) continue; seen.add(key);
      if (uf.find(a.id) === uf.find(b.id)) continue;
      if (hamming64(a.phash, b.phash) > maxH) continue;
      const ea = embs.get(a.id), eb = embs.get(b.id);
      if (!ea || !eb || dot(ea, eb) < minSim) continue;
      uf.union(a.id, b.id);
    }
  }
  // 3. write groups
  const groups = new Map();
  for (const r of rows) { if (!uf.p.has(r.id)) continue; const root = uf.find(r.id); (groups.get(root) || groups.set(root, []).get(root)).push(r); }
  const prev = new Map(d.prepare('select file_id, decision from dupe_members where decision is not null').all().map((r) => [r.file_id, r.decision])); // what you already decided survives a re-detect
  db.tx(() => {
    d.exec('delete from dupe_members; delete from dupe_groups');
    const gi = d.prepare('insert into dupe_groups(kind) values(?)'), mi = d.prepare('insert into dupe_members(group_id,file_id,keep) values(?,?,?)');
    for (const m of groups.values()) {
      if (m.length < 2) continue;
      m.sort(betterFirst);
      const kind = m.every((r) => exact.has(r.id) && r.sha === m[0].sha) ? 'exact' : 'near';
      const id = Number(gi.run(kind).lastInsertRowid);
      m.forEach((r, i) => mi.run(id, r.id, i === 0 ? 1 : 0));
      for (const r of m) if (prev.has(r.id)) d.prepare('update dupe_members set decision=? where group_id=? and file_id=?').run(prev.get(r.id), id, r.id);
      if (m.every((r) => prev.has(r.id))) d.prepare(`update dupe_groups set state='done' where id=?`).run(id);
    }
  });
  return d.prepare('select count(*) c from dupe_groups').get().c;
}

// ---- Connected Art sets ----
const stem = (n) => n.replace(/\.[^.]+$/, '');
function related(a, b) {
  const x = stem(path.basename(a)), y = stem(path.basename(b));
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  if (i >= 4) return true;
  const sx = x.replace(/[\s._-]*(p|page|img|image)?[\s._-]*\d+$/i, ''), sy = y.replace(/[\s._-]*(p|page|img|image)?[\s._-]*\d+$/i, '');
  return sx.length > 0 && sx === sy;
}
const safeName = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Set';

function meanPair(ids, embs) {
  let s = 0, n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { s += dot(embs.get(ids[i]), embs.get(ids[j])); n++; }
  return n ? s / n : 0;
}

function findSets(settings) {
  const d = db.get(); const cfg = settings.sets;
  const dupeLosers = new Set(d.prepare(`select m.file_id from dupe_members m join dupe_groups g on g.id=m.group_id where m.keep=0 and m.decision is null and g.state='pending'`).all().map((r) => r.file_id));
  const rows = d.prepare(`select id,path,mtime,tags,rating_q,rating_e,w,h,sharp,bpp,blk,ext from files where analyzed=1 and status='new' and kind='image'`).all()
    .filter((r) => !dupeLosers.has(r.id))
    .filter((r) => !assessRow(r, settings.quality).flagged); // low quality files never join a set
  const byDir = new Map();
  for (const r of rows) { const k = path.dirname(r.path); (byDir.get(k) || byDir.set(k, []).get(k)).push(r); }
  const embs = loadEmbs(rows.map((r) => r.id));
  const out = [];
  for (const [dir, list] of byDir) {
    list.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path));
    let cur = [];
    const flush = () => { if (cur.length >= cfg.minSize) out.push({ dir, members: cur }); cur = []; };
    for (const r of list) {
      if (!cur.length) { cur = [r]; continue; }
      const last = cur[cur.length - 1];
      if ((r.mtime - last.mtime) / 1000 <= cfg.maxMtimeGapSec && related(last.path, r.path)) cur.push(r); else { flush(); cur = [r]; }
    }
    flush();
  }
  // verify visually: drop the odd-one-out until the group is coherent
  const sets = [];
  for (const c of out) {
    let ids = c.members.map((m) => m.id).filter((id) => embs.has(id));
    let score = ids.length >= 2 ? meanPair(ids, embs) : 0;
    while (ids.length >= cfg.minSize && score < cfg.minSimilarity) {
      let worst = -1, ws = 2;
      ids.forEach((id, i) => { let s = 0; ids.forEach((o) => { if (o !== id) s += dot(embs.get(id), embs.get(o)); }); s /= ids.length - 1; if (s < ws) { ws = s; worst = i; } });
      ids.splice(worst, 1); score = ids.length >= 2 ? meanPair(ids, embs) : 0;
    }
    if (ids.length >= cfg.minSize && score >= cfg.minSimilarity) sets.push({ dir: c.dir, ids, score, members: c.members.filter((m) => ids.includes(m.id)) });
  }
  // names: most common character/series tag, else the folder name
  const used = new Set();
  db.tx(() => {
    d.exec('delete from set_members; delete from sets_');
    const si = d.prepare('insert into sets_(name,score,kind) values(?,?,?)'), mi = d.prepare('insert into set_members(set_id,file_id) values(?,?)');
    for (const s of sets) {
      const cnt = new Map();
      for (const m of s.members) { try { const t = JSON.parse(m.tags); for (const [n, p] of [...(t.y || []), ...(t.c || [])]) if (p >= 0.5) cnt.set(n, (cnt.get(n) || 0) + 1); } catch { /* ignore */ } }
      const top = [...cnt].sort((a, b) => b[1] - a[1])[0];
      let base = safeName(top && top[1] >= Math.ceil(s.members.length / 2) ? top[0] : path.basename(s.dir) || 'Set');
      let name = base, k = 2; while (used.has(name.toLowerCase())) name = `${base} ${k++}`;
      used.add(name.toLowerCase());
      const id = Number(si.run(name, +s.score.toFixed(3), 'comic').lastInsertRowid);
      for (const m of s.members) mi.run(id, m.id);
    }
  });
  return sets.length;
}

module.exports = { findDupes, findSets, related };
