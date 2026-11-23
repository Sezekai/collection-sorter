'use strict';
// Tags. Every tagger's result is kept as its own "tag set" (tagsets / ref_tagsets), so tagging again with another tagger loses nothing.
// The sorting uses one of them: the tagger chosen in Settings for art, JoyTag for real-life photos and videos (Settings → Tags used).
// files.tags / rating_* / jtags always hold the sets the sorting uses, so the rest of the app reads them as before.
// file_tags is a flat table (file, source, tag, confidence) for the Tags screen and the tag filters: source '' = the sorting tags,
// otherwise the tagger key, so any tagger's tags can be browsed.
const db = require('./db');

const parse = (j) => { try { return JSON.parse(j || '{}') || {}; } catch { return {}; } };
const pack = (t) => JSON.stringify({ g: t.general || [], c: t.character || [], y: t.copyright || [], a: t.artist || [] });
const ANIME = () => Object.keys(require('./models/tagger').SPECS);
const sortKey = (S) => require('./models/tagger').taggerKey(((S || require('./settings').load()).tagger || {}).model);
const sourceFor = (realness, S) => { const ts = S.tagSource || {}; return realness === 'real' ? ts.real || 'joytag' : ts.art || 'wd'; };
const CAT = { g: 0, a: 1, y: 3, c: 4 };

// ---- storing ----
function storeSet(fileId, tagger, t) {
  db.get().prepare('insert or replace into tagsets(file_id,tagger,tags,rating,ts) values(?,?,?,?,?)').run(fileId, tagger, tagger === 'joytag' ? JSON.stringify({ g: t.general || [] }) : pack(t), t.rating ? JSON.stringify(t.rating) : null, Date.now());
}
function storeRefSet(refId, tagger, t) {
  db.get().prepare('insert or replace into ref_tagsets(ref_id,tagger,tags,rating,ts) values(?,?,?,?,?)').run(refId, tagger, tagger === 'joytag' ? JSON.stringify({ g: t.general || [] }) : pack(t), t.rating ? JSON.stringify(t.rating) : null, Date.now());
}
const setsOf = (fileId) => db.get().prepare('select tagger,tags,rating,ts from tagsets where file_id=? order by ts desc').all(fileId);

// ---- which set the sorting uses ----
// the chosen tagger's set; without one yet, the most recent set of another anime tagger
function pickAnime(sets, key) { return sets.find((s) => s.tagger === key) || sets.filter((s) => s.tagger !== 'joytag').sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] || null; }
function applyActive(ids, S) {
  S = S || require('./settings').load(); const key = sortKey(S); const d = db.get();
  const sel = d.prepare('select tagger,tags,rating,ts from tagsets where file_id=?');
  const upd = d.prepare('update files set tags=?, tagger=?, jtags=?, rating_g=?, rating_s=?, rating_q=?, rating_e=? where id=?');
  db.tx(() => {
    for (const id of ids) {
      const sets = sel.all(id); if (!sets.length) continue;
      const a = pickAnime(sets, key); const j = sets.find((s) => s.tagger === 'joytag');
      const r = a ? parse(a.rating) : {};
      upd.run(a ? a.tags : null, a ? a.tagger : null, j ? j.tags : null, r.general ?? null, r.sensitive ?? null, r.questionable ?? null, r.explicit ?? null, id);
    }
  });
  fill(ids);
}
async function applyActiveRefs(S) {
  S = S || require('./settings').load(); const key = sortKey(S); const d = db.get(); let n = 0;
  const rows = d.prepare(`select ref_id, tags, rating from ref_tagsets where tagger=?`).all(key);
  const upd = d.prepare('update refs set tags=?, rating=?, tagger=? where id=? and coalesce(tagger,\'\')!=?');
  for (let i = 0; i < rows.length; i += 300) { db.tx(() => { for (const r of rows.slice(i, i + 300)) n += upd.run(r.tags, r.rating, key, r.ref_id, key).changes; }); await new Promise((r) => setTimeout(r, 2)); }
  return n;
}

// ---- the flat table ----
function rowsFor(id, wdJson, joyJson, source) {   // the sorting rows ('' source)
  const out = new Map();
  const add = (n, p, cat) => { const o = out.get(n); if (!o || p > o[2]) out.set(n, [id, n, p, cat]); };
  const wd = parse(wdJson), jt = parse(joyJson);
  const useWd = source === 'wd' || source === 'both' || !joyJson, useJoy = (source === 'joytag' || source === 'both') && !!joyJson;
  if (useWd) for (const k of ['g', 'a', 'y', 'c']) for (const [n, p] of wd[k] || []) add(n, p, CAT[k]);
  if (useJoy) for (const [n, p] of jt.g || []) add(n, p, 0);
  return [...out.values()];
}
// tags below this are not put in the flat table (they never pass the lowest filter setting; the viewer reads the full sets)
const FLOOR = 0.15;
function fill(ids) {
  const d = db.get(); const S = require('./settings').load();
  const sel = d.prepare('select id,tags,jtags,realness,p_clip,p_joy from files where id=?');
  const sets = d.prepare('select tagger,tags from tagsets where file_id=?');
  const del = d.prepare('delete from file_tags where file_id=?');
  const ins = d.prepare('insert or replace into file_tags(file_id,src,tag,conf,cat) values(?,?,?,?,?)');
  for (let i = 0; i < ids.length; i += 50) db.tx(() => {
    for (const id of ids.slice(i, i + 50)) {
      const r = sel.get(id); del.run(id); if (!r) continue;
      const guess = r.realness || (((r.p_clip ?? 0) + (r.p_joy ?? 0)) / ((r.p_clip != null) + (r.p_joy != null) || 1) >= 0.5 ? 'real' : 'art');
      if (r.tags || r.jtags) for (const [fid, n, p, c] of rowsFor(r.id, r.tags, r.jtags, sourceFor(guess, S))) if (p >= FLOOR) ins.run(fid, '', n, p, c);
      for (const s of sets.all(id)) { const t = parse(s.tags); for (const k of ['g', 'a', 'y', 'c']) for (const [n, p] of t[k] || []) if (p >= FLOOR) ins.run(id, s.tagger, n, p, CAT[k]); }
    }
  });
}
// all files, a few at a time with a breather in between, so the app keeps answering while it runs (it can take a minute or two on a big library)
async function fillAll() {
  const ids = db.get().prepare(`select id from files where (tags is not null or jtags is not null or exists (select 1 from tagsets t where t.file_id=files.id)) and analyzed=1`).all().map((r) => r.id);
  let step = 8;
  for (let i = 0; i < ids.length;) {
    const t0 = Date.now(); fill(ids.slice(i, i + step)); i += step;
    const ms = Date.now() - t0; step = Math.max(1, Math.min(200, Math.round(step * (ms > 40 ? 0.6 : ms < 15 ? 1.5 : 1))));   // keep each slice near 25 ms
    await new Promise((r) => setTimeout(r, 4));
  }
  return ids.length;
}
// one-time build of the flat table (new installs, and after it got its source column)
async function ensureBuilt() {
  if (db.kvGet('file_tags_v1', false)) return 0;
  for (let attempt = 1; ; attempt++) {
    try { const n = await fillAll(); db.kvSet('file_tags_v1', true); return n; }
    catch (e) { if (!/locked|busy/i.test(e.message) || attempt >= 5) throw e; await new Promise((r) => setTimeout(r, 3000 * attempt)); }
  }
}
// which taggers have tags for how many pictures
function coverage() {
  const d = db.get();
  return { files: d.prepare(`select t.tagger tagger, count(*) n from tagsets t join files f on f.id=t.file_id where f.status='new' group by t.tagger`).all(), refs: d.prepare(`select t.tagger tagger, count(*) n from ref_tagsets t join refs r on r.id=t.ref_id where r.analyzed=1 group by t.tagger`).all(),
    totals: { files: d.prepare(`select count(*) c from files where status='new' and analyzed=1`).get().c, refs: d.prepare(`select count(*) c from refs where analyzed=1`).get().c } };
}

module.exports = { FLOOR, parse, CAT, fill, fillAll, ensureBuilt, rowsFor, storeSet, storeRefSet, setsOf, applyActive, applyActiveRefs, pack, sortKey, coverage, ANIME };
