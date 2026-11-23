'use strict';
// Reads each file once: quality metrics, perceptual hashes, WD14 tags + rating, CLIP embedding, thumbnail.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { pool, log } = require('./util');
const { analyzeImage, decodeWork, thumbFromWork } = require('./metrics');
const { fingerprint } = require('./hashing');
const { assess } = require('./quality');
const video = require('./video');
const { thumbPath } = require('./thumbs');
const tagsMod = require('./tags');
const classify = require('./classify');

const toBlob = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

function mergeFrames(tagsList) {
  // videos: union of frame tags using the highest probability, rating = max over frames
  const g = new Map(), c = new Map(), y = new Map(), a = new Map();
  const rating = { general: 0, sensitive: 0, questionable: 0, explicit: 0 };
  const up = (m, list) => { for (const [n, p] of list || []) m.set(n, Math.max(m.get(n) || 0, p)); };
  for (const t of tagsList) {
    if (t.rating) for (const k of Object.keys(rating)) rating[k] = Math.max(rating[k], t.rating[k] || 0);
    up(g, t.general); up(c, t.character); up(y, t.copyright); up(a, t.artist);
  }
  const top = (m, n) => [...m].sort((x1, x2) => x2[1] - x1[1]).slice(0, n);
  return { rating, general: top(g, 120), character: top(c, 12), copyright: top(y, 8), artist: top(a, 6) };
}
function meanEmb(list) {
  const d = list[0].length, o = new Float32Array(d);
  for (const v of list) for (let i = 0; i < d; i++) o[i] += v[i];
  let s = 0; for (let i = 0; i < d; i++) s += o[i] * o[i]; s = Math.sqrt(s) || 1;
  for (let i = 0; i < d; i++) o[i] /= s;
  return o;
}

// Decode one file into { works: [work...], m: metrics }
async function load(row, settings) {
  if (row.kind === 'image') {
    const { work, m } = await analyzeImage(row.path, row.ext, row.size);
    return { works: [work], m, primary: work };
  }
  const { info, frames } = await video.frames(row.path, settings.videoFrames || 4, 768);
  const works = [];
  for (const f of frames) { try { works.push((await decodeWork(f)).work); } catch { /* skip bad frame */ } }
  if (!works.length) throw new Error('could not read video frames');
  const m = { w: info.w || works[0].width, h: info.h || works[0].height, duration: info.duration || null, sharp: null, bpp: null, grey: null, colorful: null };
  return { works, m, primary: works[Math.floor(works.length / 2)] };
}

function mergeJoy(list) {
  const g = new Map(); for (const t of list) for (const [n, p] of t.general) g.set(n, Math.max(g.get(n) || 0, p));
  return { general: [...g].sort((a, b) => b[1] - a[1]).slice(0, 160) };
}
async function runOne(row, models, settings) {
  const { works, m, primary } = await load(row, settings);
  // JoyTag first: it also tells photos from art; then the anime tagger (ratings, characters) on everything
  const jts = models.jt ? await models.jt.tag(works) : null;
  const tags = await models.wd.tag(works);
  const embs = await models.clip.embedImages(works);
  const t = works.length === 1 ? tags[0] : mergeFrames(tags);
  const e = works.length === 1 ? embs[0] : meanEmb(embs);
  const jt = jts ? (works.length === 1 ? { general: jts[0].general } : mergeJoy(jts)) : null;
  const pj = jt ? classify.joyPrior(new Map(jt.general)) : null;
  const pc = classify.clipPrior(e, models.photoEmb);
  return { m, primary, t, e, jt, pj, pc };
}

const packTags = (t) => tagsMod.pack(t);

// Analyse pending files. ctl = { paused, cancelled }
async function analyzeFiles(models, settings, ctl, onProgress) {
  const d = db.get();
  const rows = d.prepare(`select id,path,size,ext,kind from files where analyzed=0 and status='new' order by id`).all();
  const total = rows.length; let done = 0, failed = 0;
  const upd = d.prepare(`update files set fp=?,w=?,h=?,duration=?,dhash=?,phash=?,sharp=?,bpp=?,grey=?,colorful=?,blk=?,qscore=?,
    rating_g=?,rating_s=?,rating_q=?,rating_e=?,tags=?,vtags=?,analyzed=1,err=null,tagger=?,jtags=?,p_joy=?,p_clip=? where id=?`);
  const embIns = d.prepare(`insert or replace into emb(file_id,v) values(?,?)`);
  const fail = d.prepare(`update files set analyzed=2, err=? where id=?`);
  const CH = 8; let firstErr = '';
  if (onProgress && total) onProgress({ phase: 'analyze', done: 0, total, failed: 0, note: 'Reading pictures...' });
  for (let s = 0; s < rows.length; s += CH) {
    while (ctl.paused && !ctl.cancelled) await new Promise((r) => setTimeout(r, 300));
    if (ctl.cancelled) break;
    const chunk = rows.slice(s, s + CH);
    const results = await pool(chunk, 4, async (row) => {
      try {
        const fp = await fingerprint(row.path, row.size);
        const r = await runOne(row, models, settings);
        try { await thumbFromWork(r.primary, thumbPath(row.id)); } catch { /* thumbnail is optional */ }
        return { row, fp, ...r };
      } catch (e) { return { row, error: e.message }; }
    });
    db.tx(() => {
      for (const r of results) {
        if (r.error) { fail.run(r.error.slice(0, 300), r.row.id); failed++; if (!firstErr) { firstErr = r.error; log('read failed:', r.row.path, r.error); } continue; }
        const { m, t, e, row, fp } = r;
        const q = row.kind === 'image' ? assess(m, row.ext, settings.quality) : { score: null };
        upd.run(fp, m.w, m.h, m.duration || null, m.dhash || null, m.phash || null, m.sharp, m.bpp, m.grey, m.colorful, m.blockiness || null, q.score ?? null,
          t.rating.general, t.rating.sensitive, t.rating.questionable, t.rating.explicit, packTags(t), null, models.key || null, r.jt ? JSON.stringify({ g: r.jt.general }) : null, r.pj, r.pc, row.id);
        embIns.run(row.id, toBlob(e));
        if (models.key) tagsMod.storeSet(row.id, models.key, t);
        if (r.jt) tagsMod.storeSet(row.id, 'joytag', r.jt);
      }
    });
    tagsMod.applyActive(results.filter((r) => !r.error).map((r) => r.row.id), settings);
    done += chunk.length;
    if (onProgress) onProgress({ phase: 'analyze', done, total, failed, note: failed ? `(first problem: ${firstErr.slice(0, 120)})` : '' });
    if (done >= 16 && failed >= done) throw new Error(`Every file failed to read, so the scan was stopped. First problem: ${firstErr.slice(0, 250)}`);
  }
  if (onProgress) onProgress({ phase: 'analyze', done, total, failed, finished: !ctl.cancelled });
  return { done, failed, total };
}

// Analyse reference examples (existing sorted files) the same way, so the app can learn from them.
async function analyzeRefs(models, settings, ctl, onProgress, opts = {}) {
  const d = db.get();
  // Learn from a sample per folder (evenly spread) so a huge example folder doesn't take days.
  const cap = (settings.refs && settings.refs.maxPerFolder) || 150;
  const settingsMod = require('./settings');
  const { pkey } = require('./util');
  const active = () => (settingsMod.load().referenceRoots || []).filter(Boolean).map(pkey);
  const underActive = (p, roots) => { const k = pkey(p); return roots.some((x) => k.startsWith(x + '/')); };
  const roots0 = active();
  const inFolders = opts.folders && opts.folders.length ? new Set(opts.folders) : null;
  let relearnIds = null;
  if (opts.relearn) { // read again the examples it has already learned from (all, or just the chosen folders), instead of taking new ones
    relearnIds = new Set(d.prepare(`select id,folder from refs where analyzed=1`).all().filter((r) => !inFolders || inFolders.has(r.folder)).map((r) => r.id));
    if (relearnIds.size) db.tx(() => { const u = d.prepare('update refs set analyzed=0 where id=?'); for (const id of relearnIds) u.run(id); });
  }
  const all = d.prepare(`select id,path,kind,folder,analyzed from refs where analyzed in (0,3) order by id`).all().filter((r) => underActive(r.path, roots0) && (!inFolders || inFolders.has(r.folder)) && (!relearnIds || relearnIds.has(r.id)));
  const doneBy = new Map(); // each run learns up to the sample size of NEW pictures per folder, so repeating it keeps widening what it knows
  const byFolder = new Map();
  for (const r of all) (byFolder.get(r.folder) || byFolder.set(r.folder, []).get(r.folder)).push(r);
  const picked = [], skipped = [];
  for (const [folder, list] of byFolder) {
    const room = relearnIds ? Infinity : Math.max(0, (((settings.refs || {}).perFolder || {})[folder] ?? cap) - (doneBy.get(folder) || 0));
    const step = room ? list.length / room : Infinity;
    const keep = new Set(); if (room) for (let i = 0; i < Math.min(room, list.length); i++) keep.add(Math.floor(i * Math.max(1, step)));
    list.forEach((r, i) => (keep.has(i) ? picked : skipped).push(r));
  }
  if (skipped.length) db.tx(() => { const u = d.prepare('update refs set analyzed=3 where id=?'); for (const r of skipped) u.run(r.id); });
  const rows = picked.map((r) => ({ ...r, ext: path.extname(r.path).toLowerCase(), size: 0 }));
  const total = rows.length; let done = 0, failed = 0;
  const upd = d.prepare(`update refs set tags=?,v=?,metrics=?,rating=?,analyzed=1,tagger=?,jtags=? where id=?`);
  const bad = d.prepare(`update refs set analyzed=2, err=? where id=?`); let firstErr = '';
  if (onProgress && total) onProgress({ phase: 'refs', done: 0, total, failed: 0, note: 'Learning from your examples...' });
  for (let s = 0; s < rows.length; s += 8) {
    while (ctl.paused && !ctl.cancelled) await new Promise((r) => setTimeout(r, 300));
    if (ctl.cancelled) break;
    const live = active();
    const chunk = rows.slice(s, s + 8).filter((r) => underActive(r.path, live)); // folder removed meanwhile: stop learning from it
    if (!chunk.length) continue;
    const results = await pool(chunk, 4, async (row) => {
      try { row.size = fs.statSync(row.path).size; return { row, ...(await runOne(row, models, settings)) }; } catch (e) { return { row, error: e.message }; }
    });
    db.tx(() => {
      for (const r of results) {
        if (r.error) { bad.run(r.error.slice(0, 300), r.row.id); failed++; if (!firstErr) { firstErr = r.error; log('example failed:', r.row.path, r.error); } continue; }
        const q = r.row.kind === 'image' ? { w: r.m.w, h: r.m.h, sharp: r.m.sharp, bpp: (r.row.size * 8) / Math.max(1, r.m.w * r.m.h), blk: r.m.blockiness, grey: r.m.grey, colorful: r.m.colorful } : null;
        upd.run(packTags(r.t), toBlob(r.e), q ? JSON.stringify(q) : null, JSON.stringify(r.t.rating), models.key || null, r.jt ? JSON.stringify({ g: r.jt.general }) : null, r.row.id);
        if (models.key) tagsMod.storeRefSet(r.row.id, models.key, r.t);
        if (r.jt) tagsMod.storeRefSet(r.row.id, 'joytag', r.jt);
      }
    });
    done += chunk.length;
    if (onProgress) onProgress({ phase: 'refs', done, total, failed, note: failed ? `(first problem: ${firstErr.slice(0, 120)})` : '' });
    if (done >= 16 && failed >= done) throw new Error(`Every example failed to read, so learning was stopped. First problem: ${firstErr.slice(0, 250)}`);
  }
  return { done, failed, total };
}

module.exports = { load, analyzeFiles, analyzeRefs, fromBlob, toBlob, mergeFrames, meanEmb };
