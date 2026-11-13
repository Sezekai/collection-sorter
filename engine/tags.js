'use strict';
// A flat tag table (file, tag, confidence) so the Tags screen can mix and match tags quickly, like TagGUI.
const db = require('./db');

const parse = (j) => { try { return JSON.parse(j || '{}'); } catch { return {}; } };
// WD tags carry characters and series (cat 4 / 3); JoyTag tags are all general. Which one a picture shows follows your "tag source" setting for art / real pictures; "both" keeps the higher confidence per tag.
function rowsFor(id, wdJson, joyJson, source) {
  const out = new Map();
  const add = (n, p, cat) => { const o = out.get(n); if (!o || p > o[2]) out.set(n, [id, n, p, cat]); };
  const wd = parse(wdJson), jt = parse(joyJson);
  const useWd = source === 'wd' || source === 'both' || !joyJson, useJoy = (source === 'joytag' || source === 'both') && !!joyJson;
  if (useWd) { for (const [n, p] of wd.g || []) add(n, p, 0); for (const [n, p] of wd.c || []) add(n, p, 4); for (const [n, p] of wd.y || []) add(n, p, 3); }
  if (useJoy) for (const [n, p] of jt.g || []) add(n, p, 0);
  return [...out.values()];
}
const sourceFor = (realness, S) => { const ts = S.tagSource || {}; return realness === 'real' ? ts.real || 'joytag' : ts.art || 'wd'; };

// (Re)write the tag rows of these files from their stored tag JSON.
function fill(ids) {
  const d = db.get(); const S = require('./settings').load();
  const sel = d.prepare('select id,tags,jtags,realness,p_clip,p_joy from files where id=? and (tags is not null or jtags is not null)');
  const del = d.prepare('delete from file_tags where file_id=?');
  const ins = d.prepare('insert or replace into file_tags(file_id,tag,conf,cat) values(?,?,?,?)');
  db.tx(() => {
    for (const id of ids) {
      const r = sel.get(id); del.run(id); if (!r) continue;
      const guess = r.realness || (((r.p_clip ?? 0) + (r.p_joy ?? 0)) / ((r.p_clip != null) + (r.p_joy != null) || 1) >= 0.5 ? 'real' : 'art');
      for (const x of rowsFor(r.id, r.tags, r.jtags, sourceFor(guess, S))) ins.run(...x);
    }
  });
}
function fillAll() { const ids = db.get().prepare('select id from files where (tags is not null or jtags is not null) and analyzed=1').all().map((r) => r.id); for (let i = 0; i < ids.length; i += 400) fill(ids.slice(i, i + 400)); return ids.length; }

// One-time build for files analysed before the table existed.
function ensureBuilt() {
  if (db.kvGet('file_tags_v1', false)) return 0;
  const d = db.get();
  const ids = d.prepare(`select id from files where tags is not null and analyzed=1`).all().map((r) => r.id);
  for (let i = 0; i < ids.length; i += 400) fill(ids.slice(i, i + 400));
  db.kvSet('file_tags_v1', true);
  return ids.length;
}

module.exports = { fill, fillAll, ensureBuilt, rowsFor };
