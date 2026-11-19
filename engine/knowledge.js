'use strict';
// What the app has learned about each folder, and where from.
//  - profile: from the tags of your example pictures, a "tag fingerprint" per folder. A new picture is compared to every fingerprint,
//    so a folder is chosen because its examples really look like this picture, not only because of a hand-written keyword list.
//  - overview / probe / remap: which of your example subfolders feed which destination folder (and which are switched off).
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { normName, pkey } = require('./util');
const { refTargetsFor, walk } = require('./scanner');

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const MIN_EXAMPLES = 4;          // fewer examples than this: no fingerprint
const TAG_AT = 0.35, CHAR_AT = 0.4;

let cache = null;                // { sig, data }

function parseTags(s) {
  try { const t = JSON.parse(s || '{}'); return { g: t.g || [], c: t.c || [], y: t.y || [] }; } catch { return { g: [], c: [], y: [] }; }
}

// Builds the fingerprints (cached until the examples change).
function build() {
  const d = db.get();
  const c0 = d.prepare(`select count(*) c, coalesce(max(id),0) m, coalesce(sum(length(folder)),0) f from refs where analyzed=1`).get();
  const c1 = d.prepare(`select count(*) c, coalesce(sum(length(folder)),0) f from refs_extra`).get();
  const sig = `${c0.c}:${c0.m}:${c0.f}:${c1.c}:${c1.f}`;
  if (cache && cache.sig === sig) return cache.data;
  const per = new Map();   // folder -> { n, cnt: Map(key->examples having it), sum: Map(key->sum p) }
  for (const r of d.prepare(`select folder,tags from refs where analyzed=1 and tags is not null union all select e.folder,r.tags from refs_extra e join refs r on r.id=e.ref_id where r.analyzed=1 and r.tags is not null`).iterate()) {
    if (!r.folder) continue;
    let f = per.get(r.folder); if (!f) per.set(r.folder, f = { n: 0, cnt: new Map(), sum: new Map() });
    f.n++;
    const t = parseTags(r.tags);
    for (const [tag, p] of t.g) if (p >= 0.2) { const k = 't:' + tag; f.sum.set(k, (f.sum.get(k) || 0) + p); if (p >= TAG_AT) f.cnt.set(k, (f.cnt.get(k) || 0) + 1); }
    for (const [tag, p] of t.c) if (p >= 0.2) { const k = 'c:' + tag; f.sum.set(k, (f.sum.get(k) || 0) + p); if (p >= CHAR_AT) f.cnt.set(k, (f.cnt.get(k) || 0) + 1); }
  }
  const names = [...per.keys()].filter((n) => per.get(n).n >= MIN_EXAMPLES);
  const F = names.length;
  const df = new Map();
  for (const n of names) { const f = per.get(n); for (const [k, s] of f.sum) if (s / f.n >= 0.12) df.set(k, (df.get(k) || 0) + 1); }
  const idf = new Map(); for (const [k, v] of df) idf.set(k, Math.log((F + 1) / (v + 0.5)) * (k[0] === 'c' ? 1.4 : 1));
  const inv = new Map(); const norm = new Array(F).fill(0);
  names.forEach((n, i) => {
    const f = per.get(n);
    for (const [k, s] of f.sum) {
      const m = s / f.n; if (m < 0.12) continue; const w = m * (idf.get(k) || 0); if (w <= 0) continue;
      let a = inv.get(k); if (!a) inv.set(k, a = []); a.push([i, w]); norm[i] += w * w;
    }
  });
  for (let i = 0; i < F; i++) norm[i] = Math.sqrt(norm[i]) || 1;
  const index = new Map(names.map((n, i) => [n, i]));
  const data = { per, names, index, idf, inv, norm, F };
  cache = { sig, data };
  return data;
}

// Compares a picture's tags with every folder fingerprint. Returns Map(folder -> 0..1 score).
function score(P, g, c) {
  const out = new Map(); if (!P.F) return out;
  const x = new Map(); let xn = 0;
  for (const [tag, p] of g) { if (p < 0.2) continue; const k = 't:' + tag; const w = P.idf.get(k); if (w) { x.set(k, p * w); xn += p * w * p * w; } }
  for (const [tag, p] of c) { if (p < 0.2) continue; const k = 'c:' + tag; const w = P.idf.get(k); if (w) { x.set(k, p * w); xn += p * w * p * w; } }
  if (!x.size) return out;
  xn = Math.sqrt(xn) || 1;
  const acc = new Float64Array(P.F);
  for (const [k, xv] of x) { const post = P.inv.get(k); if (post) for (const [i, w] of post) acc[i] += xv * w; }
  for (let i = 0; i < P.F; i++) if (acc[i] > 0) { const sim = acc[i] / (xn * P.norm[i]); out.set(P.names[i], clamp((sim - 0.22) / 0.45)); }
  return out;
}

// The tags that made a picture look like a folder ("tags like its examples: a, b, c").
function explain(P, g, c, folder, k = 3) {
  const i = P.index.get(folder); if (i === undefined) return [];
  const hits = [];
  const look = (pre, list) => { for (const [tag, p] of list) { const key = pre + tag; const post = P.inv.get(key); if (!post) continue; const e = post.find((a) => a[0] === i); if (e) hits.push([p * (P.idf.get(key) || 0) * e[1], tag]); } };
  look('t:', g); look('c:', c);
  return hits.sort((a, b) => b[0] - a[0]).slice(0, k).map((h) => h[1]);
}

// ---------- the "What it knows" summary ----------
function learnedSummary(folder) {
  const P = build(); const f = P.per.get(folder);
  if (!f) return { n: 0, tags: [], chars: [] };
  const rows = [];
  for (const [k, c] of f.cnt) { const share = c / f.n; if (share < 0.08 || c < 2) continue; rows.push({ k, share, rank: share * (P.idf.get(k) ?? 0.3) }); }
  rows.sort((a, b) => b.rank - a.rank);
  const pick = (pre, n) => rows.filter((r) => r.k[0] === pre).slice(0, n).map((r) => [r.k.slice(2), +r.share.toFixed(2)]);
  return { n: f.n, tags: pick('t', 24), chars: pick('c', 10) };
}

// ---------- examples folders ----------
const relOf = (root, p) => { const a = pkey(root), b = pkey(p); return b.startsWith(a + '/') ? String(p).replace(/\\/g, '/').slice(String(root).replace(/[\\/]+$/, '').length + 1) : null; };

// Best matching destination folder for an examples folder name, or null.
function suggestMap(name, dests) {
  const n = normName(name); if (!n) return null;
  const nd = dests.map((d) => [d, normName(d)]);
  const exact = nd.find(([, x]) => x === n); if (exact) return exact[0];
  const tok = (s) => new Set(normName(s).split(' ').filter((w) => w && w !== 'and'));
  const a = tok(name); let best = null, bs = 0;
  for (const [d] of nd) { const b = tok(d); if (!a.size || !b.size) continue; let i = 0; for (const w of a) if (b.has(w)) i++; const j = i / (a.size + b.size - i); if (j > bs) { bs = j; best = d; } }
  if (bs >= 0.6) return best;
  const sub = nd.find(([, x]) => x.length >= 4 && (n.startsWith(x + ' ') || n.endsWith(' ' + x)));
  return sub ? sub[0] : null;
}

// Counts files in a folder, stopping early (we only need "about how many").
function countCap(dir, cap = 400, until = Infinity) {
  let n = 0; const stack = [dir];
  while (stack.length && n < cap && Date.now() < until) {
    const dd = stack.pop(); let ents; try { ents = fs.readdirSync(dd, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) { if (e.isDirectory()) stack.push(path.join(dd, e.name)); else if (e.isFile()) { n++; if (n >= cap) break; } }
  }
  return { n, more: n >= cap };
}

// Subfolders of root/rel with rough file counts.
function probe(root, rel, budgetMs = 6000) {
  const base = rel ? path.join(root, rel) : root; let ents = [];
  try { ents = fs.readdirSync(base, { withFileTypes: true }); } catch { return { exists: false, dirs: [], looseFiles: 0 }; }
  const until = Date.now() + budgetMs; const dirs = [];
  for (const e of ents) if (e.isDirectory()) dirs.push(e.name);
  dirs.sort((a, b) => a.localeCompare(b));
  return { exists: true, looseFiles: ents.filter((e) => e.isFile()).length, dirs: dirs.map((name) => { const c = countCap(path.join(base, name), 400, until); return { name, rel: rel ? `${rel}/${name}` : name, n: c.n, more: c.more }; }) };
}

// Apply the current referenceMap to the examples already stored: moves them to their folder(s), drops the switched-off ones.
function remap(S) {
  const d = db.get(); let moved = 0, dropped = 0;
  const roots = (S.referenceRoots || []).filter(Boolean);
  const dupes = String(S.dupesFolder || 'dupes').toLowerCase();
  const rows = d.prepare('select id,path,folder from refs').all();
  const extras = new Map(); for (const e of d.prepare('select ref_id, folder from refs_extra').all()) (extras.get(e.ref_id) || extras.set(e.ref_id, []).get(e.ref_id)).push(e.folder);
  const upd = d.prepare('update refs set folder=? where id=?'), del = d.prepare('delete from refs where id=?');
  const delX = d.prepare('delete from refs_extra where ref_id=?'), insX = d.prepare('insert or ignore into refs_extra(ref_id,folder) values(?,?)');
  db.tx(() => {
    for (const r of rows) {
      const root = roots.find((x) => relOf(x, r.path) !== null); if (!root) continue;
      const t = refTargetsFor(relOf(root, r.path), S).filter((x) => x.toLowerCase() !== dupes);
      if (!t.length) { del.run(r.id); delX.run(r.id); dropped++; continue; }
      const have = (extras.get(r.id) || []).slice().sort().join('|'), want = t.slice(1).slice().sort().join('|');
      if (t[0] !== r.folder) { upd.run(t[0], r.id); moved++; }
      if (have !== want) { delX.run(r.id); for (const x of t.slice(1)) insX.run(r.id, x); }
    }
  });
  cache = null;
  return { moved, dropped };
}

// How one examples folder (any depth) is treated right now.
function describe(S, rel, destNames, ignoreTop) {
  const map = S.referenceMap || {}; const low = rel.toLowerCase();
  const key = Object.keys(map).find((k) => k.toLowerCase() === low);
  const explicit = key !== undefined; const top = !rel.includes('/');
  const ignored = top && !explicit && ignoreTop.has(low);
  let targets = ignored ? [] : refTargetsFor(rel, S);
  const valid = (t) => destNames.some((x) => x === t || normName(x) === normName(t));
  const use = targets.length > 0;
  const ok = !use || targets.every(valid);
  const name = rel.split('/').pop();
  return { name, rel, use, explicit, auto: !explicit, targets, folder: targets[0] || null, ok, ignored, suggested: use && !ok ? suggestMap(name, destNames) : null };
}

// Counts per examples folder prefix from the stored examples.
const countsCache = new Map();   // root -> { sig, out }: going through every example takes a second with a big library
function countsFor(S, root) {
  const d = db.get(); const sig = JSON.stringify(d.prepare('select count(*) c, max(id) m, sum(analyzed=1) a, sum(analyzed=3) s from refs').get());
  const hit = countsCache.get(root); if (hit && hit.sig === sig) return hit.out;
  const out = new Map(); countsCache.set(root, { sig, out }); const add = (rel, learned) => { const o = out.get(rel) || { files: 0, learned: 0 }; o.files++; if (learned) o.learned++; out.set(rel, o); };
  for (const r of d.prepare('select path,analyzed from refs').iterate()) {
    const rel = relOf(root, r.path); if (rel === null) continue; const parts = rel.split('/'); parts.pop();
    let acc = ''; for (const p of parts) { acc = acc ? acc + '/' + p : p; add(acc, r.analyzed === 1); }
  }
  return out;
}

// Subfolders (one level) of root/rel with how each is treated.
function children(S, root, rel, destNames) {
  const P = probe(root, rel, 8000); const counts = countsFor(S, root); const ignoreTop = new Set((S.ignoreFolders || []).map((x) => x.toLowerCase()));
  const capOf = (S.refs && S.refs.perFolder) || {};
  return { exists: P.exists, dirs: P.dirs.map((x) => { const c = counts.get(x.rel); const D = describe(S, x.rel, destNames, ignoreTop); return { ...D, files: c ? c.files : 0, learned: c ? c.learned : 0, scanned: !!c, est: x.n, more: x.more, cap: capOf[D.folder || x.name] ?? null }; }) };
}

// Everything the "Examples to learn from" page shows.
function overview(S, destNames) {
  const map = S.referenceMap || {};
  const roots = (S.referenceRoots || []).filter(Boolean);
  const cap = (S.refs && S.refs.maxPerFolder) || 150; const capOf = (S.refs && S.refs.perFolder) || {};
  const ignoreTop = new Set((S.ignoreFolders || []).map((x) => x.toLowerCase()));
  const out = roots.map((root) => {
    const exists = fs.existsSync(root); const counts = countsFor(S, root);
    const names = new Set([...counts.keys()].filter((k) => !k.includes('/')));
    if (exists) { try { for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) names.add(e.name); } catch { /* unreadable */ } }
    for (const k of Object.keys(map)) if (!k.includes('/')) names.add(k);
    let total = 0, learned = 0; for (const [k, v] of counts) if (!k.includes('/')) { total += v.files; learned += v.learned; }
    const groups = [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
      const c = counts.get(name); const D = describe(S, name, destNames, ignoreTop);
      return { ...D, files: c ? c.files : 0, learned: c ? c.learned : 0, scanned: !!c, cap: capOf[D.folder || name] ?? null, hasSub: !!Object.keys(map).find((k) => k.toLowerCase().startsWith(name.toLowerCase() + '/')) };
    });
    return { root, exists, total, learned, groups };
  });
  return { roots: out, cap, dests: destNames, map };
}

module.exports = { build, score, explain, learnedSummary, suggestMap, probe, remap, overview, children, describe, relOf, MIN_EXAMPLES };
