'use strict';
// Destination folders that were renamed, merged or deleted outside the app.
// The app knows folders by name, so a rename looks like "one gone, one new". This module remembers what the gone folders knew
// (their rule, their examples, their mappings) until you say what happened, then moves that knowledge to the right folder.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const settingsMod = require('./settings');
const { readCatalog, destinationChoices } = require('./catalog');

const norm = (s) => String(s).toLowerCase();
const under = (n, base) => norm(n) === norm(base) || norm(n).startsWith(norm(base) + '/');
const swap = (n, from, to) => (norm(n) === norm(from) ? to : to + String(n).slice(from.length));

// ---- tracking: what disappeared, what appeared (since the last time we looked) ----
function pending() { return db.kvGet('folderPending', null) || { gone: [], added: [] }; }
function track(S, choices) {
  const prev = db.kvGet('catalogChoices', null); const cur = choices.slice(); const has = new Set(cur.map(norm));
  const pend = pending();
  const prevSet = new Set((prev || []).map(norm));
  const newlyGone = prev ? prev.filter((x) => !has.has(norm(x))) : [];
  const newlyAdded = prev ? cur.filter((x) => !prevSet.has(norm(x))) : [];
  const uniq = (a) => { const seen = new Set(); return a.filter((x) => (seen.has(norm(x)) ? false : (seen.add(norm(x)), true))); };
  pend.gone = uniq([...(pend.gone || []), ...newlyGone]).filter((x) => !has.has(norm(x)));
  pend.added = uniq([...(pend.added || []), ...newlyAdded]).filter((x) => has.has(norm(x)));
  if (!pend.gone.length) pend.added = [];
  db.kvSet('folderPending', pend); db.kvSet('catalogChoices', cur);
  return { added: newlyAdded, removed: newlyGone };
}
// keep the rule of a folder that vanished, so a rename / merge can carry it over
function stashDropped(existing, namesNow) {
  const stash = db.kvGet('goneRules', null) || {}; const now = new Set([...namesNow].map(norm));
  if (existing && existing.folders) {
    for (const n of Object.keys(existing.folders)) if (!now.has(norm(n))) stash[n] = { rule: existing.folders[n], idx: (existing.order || []).indexOf(n) };
  }
  for (const n of Object.keys(stash)) if (now.has(norm(n))) delete stash[n];
  db.kvSet('goneRules', stash);
}

// ---- suggestions ----
function lev(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let p = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; }
const toks = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1));
function similarity(a, b) {
  const la = norm(a.split('/').pop()), lb = norm(b.split('/').pop());
  const ta = toks(la), tb = toks(lb); let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  const jac = ta.size || tb.size ? inter / (ta.size + tb.size - inter) : 0;
  const ed = 1 - lev(la, lb) / Math.max(la.length, lb.length, 1);
  const contain = la && lb && (la.includes(lb) || lb.includes(la)) ? 0.75 : 0;
  let s = Math.max(jac, ed, contain);
  const pa = a.split('/').slice(0, -1).join('/'), pb = b.split('/').slice(0, -1).join('/');
  if (norm(pa) === norm(pb)) s = Math.min(1, s + 0.08); else s *= 0.7;
  return s;
}
function suggest(gone, cands) {
  const out = {}; const pairs = [];
  for (const g of gone) for (const c of cands) pairs.push({ g, c, s: similarity(g, c) });
  pairs.sort((x, y) => y.s - x.s); const usedG = new Set(), usedC = new Set();
  for (const p of pairs) { if (p.s < 0.45 || usedG.has(p.g) || usedC.has(p.c)) continue; out[p.g] = { to: p.c, score: +p.s.toFixed(2), why: 'similar name' }; usedG.add(p.g); usedC.add(p.c); }
  const restG = gone.filter((g) => !usedG.has(g)), restC = cands.filter((c) => !usedC.has(c));
  if (restG.length === 1 && restC.length === 1) out[restG[0]] = { to: restC[0], score: 0.5, why: 'the only folder that disappeared and the only new one' };
  return out;
}
function siblings(S, name) { // folders next to a vanished one that are not (yet) targets of their own
  const parent = name.split('/').slice(0, -1); const base = path.join(S.destinationRoot || '', ...parent); let out = [];
  try { out = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !['nsfw', 'very'].includes(e.name.toLowerCase())).map((e) => [...parent, e.name].join('/')); } catch { /* none */ }
  return out;
}

function changes() {
  const S = settingsMod.load(); const cat = readCatalog(S.destinationRoot, S); const choices = destinationChoices(cat, S);
  const pend = pending(); const has = new Set(choices.map(norm));
  let gone = (pend.gone || []).filter((x) => !has.has(norm(x)));
  gone = gone.filter((x) => !gone.some((y) => norm(y) !== norm(x) && under(x, y)));   // a vanished parent covers its subfolders
  const d = db.get(); const stash = db.kvGet('goneRules', null) || {};
  const cands = [...new Set([...(pend.added || []), ...gone.filter((g) => g.includes('/')).flatMap((g) => siblings(S, g)).filter((c) => !has.has(norm(c)))])].filter((c) => has.has(norm(c)) || fs.existsSync(path.join(S.destinationRoot || '', ...c.split('/')))).filter((c) => !gone.some((g) => norm(g) === norm(c)));
  const sug = suggest(gone, cands);
  const info = (n) => ({
    name: n, hasRule: !!stash[n] || !!(db.kvGet('rules', null) || { folders: {} }).folders[n],
    examples: d.prepare(`select count(*) c from refs where folder=? or lower(folder) like lower(?) || '/%'`).get(n, n).c,
    pending: d.prepare(`select count(*) c from suggestions s join files f on f.id=s.file_id where f.status='new' and (s.folder=? or s.user_folder=?)`).get(n, n).c,
    suggest: sug[n] || null,
  });
  const all = [...new Set([...choices, ...cands])].filter((x) => !x.includes('/') || true).sort((a, b) => a.localeCompare(b));
  return { gone: gone.map(info), added: cands, choices: all };
}

// ---- applying ----
const ARR = (v) => (Array.isArray(v) ? v : v ? [v] : []);
function mergeRule(base, extra) {
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    if (Array.isArray(extra[k])) { const seen = new Set(ARR(out[k]).map((x) => (typeof x === 'string' ? x.toLowerCase() : JSON.stringify(x)))); out[k] = ARR(out[k]).slice(); for (const x of extra[k]) { const key = typeof x === 'string' ? x.toLowerCase() : JSON.stringify(x); if (!seen.has(key)) { seen.add(key); out[k].push(x); } } }
    else if (out[k] === undefined) out[k] = extra[k];
  }
  return out;
}
// action: { from:[names], to, keep:{rules,examples,mappings} }
function merge(action) {
  const S = settingsMod.load(); const from = (action.from || []).filter(Boolean); const to = String(action.to || '').trim();
  if (!from.length || !to) throw new Error('Choose the folder it became.');
  const keep = { rules: true, examples: true, mappings: true, ...(action.keep || {}) };
  const d = db.get(); const D = S.destinationRoot || '';
  const K = require('./knowledge');
  const stash = db.kvGet('goneRules', null) || {}; const rules = db.kvGet('rules', null);
  const pend = pending(); const mergedT = db.kvGet('mergedTargets', null) || []; const wasNew = !mergedT.some((x) => norm(x) === norm(to)) && ((pend.added || []).some((x) => norm(x) === norm(to)) || !rules || !rules.folders[to]);
  // every name affected: the folder itself and anything below it (sub-targets, example mappings, learned data)
  const names = new Set(from);
  const scan = [];
  for (const r of d.prepare('select distinct folder f from refs where folder is not null').all()) scan.push(r.f);
  for (const r of d.prepare('select distinct folder f from refs_extra').all()) scan.push(r.f);
  scan.push(...(S.subTargets || []), ...Object.keys(S.refs.perFolder || {}), ...Object.keys(stash), ...(pend.gone || []));
  for (const n of scan) if (n && from.some((f) => under(n, f))) names.add(n);
  const pairs = [...names].map((n) => { const f = from.find((x) => under(n, x)); return [n, swap(n, f, to)]; });
  const mapped = new Map(pairs.map(([a, b]) => [norm(a), b]));
  const mp = (n) => (n && mapped.has(norm(n)) ? mapped.get(norm(n)) : n);
  // example folders that teach it by sharing its name: make that explicit before the name disappears
  const refMap = { ...(S.referenceMap || {}) };
  if (keep.mappings) {
    try {
      const ov = K.overview(S, destinationChoices(readCatalog(D, S), S));
      for (const R of ov.roots) for (const g of R.groups) if (g.use && (g.targets || []).some((t) => mapped.has(norm(t))) && refMap[g.rel] === undefined) refMap[g.rel] = g.targets;
    } catch { /* overview needs the examples folders; fine if they are not there */ }
    for (const k of Object.keys(refMap)) { const v = refMap[k]; if (v == null) continue; const arr = ARR(v).map(mp); refMap[k] = Array.isArray(v) ? [...new Set(arr)] : arr[0]; }
  } else for (const k of Object.keys(refMap)) { const v = refMap[k]; if (v != null && ARR(v).some((t) => mapped.has(norm(t)))) delete refMap[k]; }
  const subT = []; for (const x of (S.subTargets || [])) { const y = mp(x); if (!subT.some((z) => norm(z) === norm(y))) subT.push(y); }
  const perFolder = {}; for (const [k, v] of Object.entries(S.refs.perFolder || {})) { if (!keep.mappings && mapped.has(norm(k))) continue; perFolder[mp(k)] = v; }
  const ign = (a) => (a || []).map(mp);
  d.exec('begin');
  try {
    for (const [a, b] of pairs) {
      if (keep.examples) {
        d.prepare('update refs set folder=? where folder=?').run(b, a);
        d.prepare('update or ignore refs_extra set folder=? where folder=?').run(b, a); d.prepare('delete from refs_extra where folder=?').run(a);
      } else {
        d.prepare('delete from refs_extra where ref_id in (select id from refs where folder=?)').run(a); d.prepare('delete from refs where folder=?').run(a);
      }
      d.prepare('update suggestions set folder=? where folder=?').run(b, a); d.prepare('update suggestions set user_folder=? where user_folder=?').run(b, a); d.prepare('update suggestions set fallback=? where fallback=?').run(b, a);
      d.prepare('update series_map set folder=? where folder=?').run(b, a);
    }
    // files already moved into the old folder: keep the undo history pointing at where they are now
    const absOf = (n) => path.join(D, ...n.split('/'));
    for (const [a, b] of pairs) {
      const A = absOf(a).toLowerCase(), B = absOf(b);
      for (const row of d.prepare(`select id,dst from journal where status='moved'`).all()) if (row.dst && row.dst.toLowerCase().startsWith(A + path.sep)) d.prepare('update journal set dst=? where id=?').run(B + row.dst.slice(A.length), row.id);
      for (const row of d.prepare(`select id,path from files where status='moved'`).all()) if (row.path && row.path.toLowerCase().startsWith(A + path.sep)) d.prepare('update files set path=? where id=?').run(B + row.path.slice(A.length), row.id);
    }
    d.exec('commit');
  } catch (e) { d.exec('rollback'); throw e; }
  settingsMod.replace({ ...S, referenceMap: refMap, subTargets: subT, refs: { ...S.refs, perFolder }, ignoreFolders: ign(S.ignoreFolders), ignoreSubfolders: ign(S.ignoreSubfolders) });
  // the rule: a renamed folder takes its old rule; a merge adds the words, series and characters of every folder into one
  if (rules) {
    const srcRules = from.map((f) => (stash[f] ? stash[f].rule : rules.folders[f])).filter(Boolean);
    if (keep.rules && srcRules.length) {
      let base = wasNew ? srcRules[0] : rules.folders[to] || srcRules[0]; const rest = wasNew ? srcRules.slice(1) : srcRules;
      for (const r of rest) base = mergeRule(base, r);
      rules.folders[to] = base;
      if (!rules.order.includes(to)) { const idx = from.map((f) => (stash[f] ? stash[f].idx : -1)).filter((i) => i >= 0)[0]; rules.order.splice(idx >= 0 ? Math.min(idx, rules.order.length) : rules.order.length, 0, to); }
    }
    for (const [a, b] of pairs) {
      if (norm(a) === norm(b)) continue;
      if (b !== to && keep.rules) { const r = stash[a] ? stash[a].rule : rules.folders[a]; if (r && !rules.folders[b]) { rules.folders[b] = r; if (!rules.order.includes(b)) rules.order.push(b); } }
      delete rules.folders[a]; rules.order = rules.order.filter((x) => norm(x) !== norm(a));
    }
    db.kvSet('rules', rules);
  }
  db.kvSet('mergedTargets', [...mergedT, to]);
  const st2 = db.kvGet('goneRules', null) || {}; for (const [a] of pairs) delete st2[a]; db.kvSet('goneRules', st2);
  const p2 = pending(); p2.gone = (p2.gone || []).filter((x) => !mapped.has(norm(x))); p2.added = (p2.added || []).filter((x) => norm(x) !== norm(to));
  if (!p2.gone.length) { p2.added = []; db.kvSet('mergedTargets', []); } db.kvSet('folderPending', p2);
  return { moved: pairs.length };
}
function markDeleted(name) {
  const stash = db.kvGet('goneRules', null) || {}; const pend = pending(); const S = settingsMod.load();
  const hit = (n) => under(n, name);
  for (const k of Object.keys(stash)) if (hit(k)) delete stash[k]; db.kvSet('goneRules', stash);
  pend.gone = (pend.gone || []).filter((x) => !hit(x)); if (!pend.gone.length) pend.added = []; db.kvSet('folderPending', pend);
  const rules = db.kvGet('rules', null); if (rules) { for (const k of Object.keys(rules.folders)) if (hit(k)) delete rules.folders[k]; rules.order = rules.order.filter((x) => !hit(x)); db.kvSet('rules', rules); }
  settingsMod.replace({ ...S, subTargets: (S.subTargets || []).filter((x) => !hit(x)) });
  return { ok: true };
}
function dismissAdded() { const p = pending(); p.added = []; db.kvSet('folderPending', p); return { ok: true }; }

module.exports = { track, stashDropped, changes, merge, markDeleted, dismissAdded, similarity, suggest, pending };
