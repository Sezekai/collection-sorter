'use strict';
// Change folders: point the app at another destination (and other sources) without losing what it has learned.
// Everything the app knows about a destination folder is stored under the folder's NAME (relative to the destination),
// never its full path: the rules and priority order, which examples teach which folder, the series assignments, the
// examples-folder mappings and the per-folder sample sizes. So a destination with the same layout simply carries on.
// This module compares the two trees, maps any names that differ, and (optionally) forgets the files of the old setup:
// their file records, thumbnails, previews, duplicates, sets, suggestions and move history. The files on disk are never touched.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const settingsMod = require('./settings');
const { readCatalog, destinationChoices } = require('./catalog');
const { pkey, log } = require('./util');
const folders = require('./folders');

const norm = (s) => String(s || '').toLowerCase();
const under = (p, root) => { const k = pkey(p), r = pkey(root); return k === r || k.startsWith(r + '/'); };

// folders the app makes itself when it needs them (not "missing" when the new tree hasn't got them yet)
function madeByApp(S) { return new Set([S.dupesFolder, S.lowQualityFolder, S.fhqManualFolder, 'Dupes', 'Average & LQ', 'Find Higher Quality Manually'].filter(Boolean).map(norm)); }

function choicesFor(root, S) {
  if (!root || !fs.existsSync(root)) return null;
  return destinationChoices(readCatalog(root, S), S);
}

// what the app knows about one folder name (for the list of names that differ)
function knowledgeOf(name, rules) {
  const d = db.get();
  return {
    rule: !!(rules && rules.folders && rules.folders[name]),
    rank: rules && rules.order ? rules.order.indexOf(name) + 1 : 0,
    examples: d.prepare(`select count(*) c from refs where folder=? or lower(folder) like lower(?) || '/%'`).get(name, name).c,
  };
}

function oldFiles(S, oldDest, oldSources) {
  const d = db.get(); const out = { ids: [], fresh: 0, moved: 0, movedLearnable: 0 };
  const roots = [oldDest, ...oldSources].filter(Boolean);
  if (!roots.length) return out;
  for (const r of d.prepare(`select f.id, f.path, f.status, (e.file_id is not null and f.analyzed=1) learnable from files f left join emb e on e.file_id=f.id`).all()) {
    if (!roots.some((x) => under(r.path, x))) continue;
    out.ids.push(r.id);
    if (r.status === 'moved') { out.moved++; if (r.learnable && oldDest && under(r.path, oldDest)) out.movedLearnable++; } else out.fresh++;
  }
  return out;
}
function oldHistory(oldDest, oldSources) {
  const roots = [oldDest, ...oldSources].filter(Boolean); if (!roots.length) return [];
  return db.get().prepare('select id, batch_id, src, dst from journal').all().filter((j) => roots.some((x) => (j.dst && under(j.dst, x)) || (j.src && under(j.src, x)))).map((j) => j.id);
}

// ---------- preview ----------
function preview(b) {
  const S = settingsMod.load();
  const oldDest = S.destinationRoot || ''; const newDest = String(b.dest || '').trim();
  const oldSources = (S.sources || []).map((x) => x.path).filter(Boolean);
  const newSources = Array.isArray(b.sources) ? b.sources.map((x) => String(x.path || x).trim()).filter(Boolean) : oldSources;
  const dropSources = oldSources.filter((x) => !newSources.some((y) => pkey(y) === pkey(x)));
  if (!newDest) throw new Error('Choose the new destination folder.');
  if (!fs.existsSync(newDest)) throw new Error(`${newDest} can't be found.`);
  if (oldDest && pkey(oldDest) === pkey(newDest) && !dropSources.length && newSources.length === oldSources.length) throw new Error('That is already the destination, and the folders to sort are the same.');
  for (const src of newSources) if (under(src, newDest) || under(newDest, src)) throw new Error(`A folder to sort can't be inside the destination (or the other way round): ${src}`);
  const rules = db.kvGet('rules', null);
  const oldC = (oldDest && choicesFor(oldDest, S)) || db.kvGet('catalogChoices', null) || [];
  const newC = choicesFor(newDest, S) || [];
  const app = madeByApp(S); const newBy = new Map(newC.map((x) => [norm(x), x]));
  const same = [], renamed = [], missing = [];
  for (const n of oldC) {
    if (app.has(norm(n))) continue;
    const hit = newBy.get(norm(n));
    if (hit === n) same.push(n);
    else if (hit) renamed.push({ from: n, to: hit, why: 'Only the capital letters differ' });
    else if (/^real\//i.test(n)) same.push(n);   // the Real leaves are made when first needed
    else missing.push(n);
  }
  const oldSet = new Set(oldC.map(norm)); const added = newC.filter((x) => !oldSet.has(norm(x)) && !app.has(norm(x)));
  const sug = folders.suggest(missing, added);
  const d = db.get(); const k = (sql) => d.prepare(sql).get().c;
  const ex = (S.sources || []).map((x) => x.path);
  const of = oldFiles(S, oldDest && pkey(oldDest) !== pkey(newDest) ? oldDest : '', dropSources);
  const hist = oldHistory(oldDest && pkey(oldDest) !== pkey(newDest) ? oldDest : '', dropSources);
  return {
    oldDest, newDest, oldSources: ex, newSources, dropSources,
    folders: { total: oldC.length, same: same.length, choices: newC, renamed, missing: missing.map((n) => ({ name: n, ...knowledgeOf(n, rules), suggest: sug[n] ? sug[n].to : '' })), added },
    knowledge: {
      rules: rules ? Object.keys(rules.folders || {}).length : 0, ranked: rules ? (rules.order || []).length : 0,
      examples: k('select count(*) c from refs where analyzed=1'), exampleFolders: k('select count(distinct folder) c from refs where analyzed=1'),
      series: k('select count(*) c from series_map'), mappings: Object.keys(S.referenceMap || {}).length, learned: !!db.kvGet('learned', null),
      exampleRoots: S.referenceRoots || [],
    },
    old: { files: of.ids.length, fresh: of.fresh, moved: of.moved, movedLearnable: of.movedLearnable, history: hist.length },
    busy: !!require('./pipeline').state.job,
  };
}

// ---------- apply ----------
// b: { dest, sources:[{path,excludes}], map:{ oldName: newName | '' (forget) }, forget: bool, keepApprovals: bool }
function apply(b) {
  const P = require('./pipeline'); if (P.state.job) throw new Error(`Wait until “${P.state.job}” has finished (or stop it), then change folders.`);
  const pv = preview(b); const S0 = settingsMod.load(); const d = db.get(); const report = { renamed: 0, forgotFolders: 0, examplesKept: 0, filesForgotten: 0, historyForgotten: 0 };
  const oldDest = pv.oldDest; const destChanged = !oldDest || pkey(oldDest) !== pkey(pv.newDest);
  log(`Changing folders: destination ${oldDest || '(none)'} -> ${pv.newDest}; sources ${pv.oldSources.join(', ') || '(none)'} -> ${pv.newSources.join(', ') || '(none)'}`);

  // 1. approvals made in the old destination become learned examples (their pictures were already read, nothing to do again)
  if (b.forget && b.keepApprovals && destChanged && oldDest) {
    const rows = d.prepare(`select f.*, e.v emb, s.folder sf, s.user_folder uf, s.user_rating ur, s.rating sr from files f join emb e on e.file_id=f.id left join suggestions s on s.file_id=f.id where f.status='moved' and f.analyzed=1`).all().filter((r) => under(r.path, oldDest));
    const ins = d.prepare(`insert or ignore into refs(path,folder,fp,kind,tags,v,metrics,rating,analyzed,size,label,tagger,jtags) values(?,?,?,?,?,?,?,?,1,?,?,?,?)`);
    db.tx(() => {
      for (const r of rows) {
        const rel = path.relative(oldDest, r.path).replace(/\\/g, '/'); const low = rel.toLowerCase();
        const folder = r.uf || r.sf || rel.split('/')[0]; if (!folder) continue;
        const label = /(^|\/)very(\/|$)/.test(low) ? 'very' : /(^|\/)nsfw(\/|$)/.test(low) ? 'nsfw' : (r.ur || 'general');
        const metrics = r.kind === 'image' ? JSON.stringify({ w: r.w, h: r.h, sharp: r.sharp, bpp: r.bpp, blk: r.blk, grey: r.grey, colorful: r.colorful }) : null;
        const rating = JSON.stringify({ general: r.rating_g, sensitive: r.rating_s, questionable: r.rating_q, explicit: r.rating_e });
        const res = ins.run(r.path, folder, r.fp, r.kind, r.tags, r.emb, metrics, rating, r.size, label, r.tagger, r.jtags);
        if (res.changes) report.examplesKept++;
      }
    });
  }

  // 2. forget the old setup's files, their history and their cached previews
  if (b.forget) {
    const { delFiles } = require('./reset');
    const of = oldFiles(S0, destChanged ? oldDest : '', pv.dropSources);
    const fps = of.ids.length ? new Set() : null;
    if (fps) for (let i = 0; i < of.ids.length; i += 400) { const c = of.ids.slice(i, i + 400); for (const r of d.prepare(`select fp from files where id in (${c.map(() => '?').join(',')})`).all(...c)) if (r.fp) fps.add(r.fp); }
    delFiles(of.ids); report.filesForgotten = of.ids.length;
    const still = (fp) => d.prepare('select 1 from files where fp=? limit 1').get(fp);
    if (fps) db.tx(() => { for (const fp of fps) if (!still(fp)) { d.prepare('delete from labels where fp=?').run(fp); d.prepare('delete from sauce where fp=?').run(fp); d.prepare('delete from hq_log where fp=?').run(fp); } });
    const hist = oldHistory(destChanged ? oldDest : '', pv.dropSources);
    db.tx(() => { for (let i = 0; i < hist.length; i += 400) { const c = hist.slice(i, i + 400); d.prepare(`delete from journal where id in (${c.map(() => '?').join(',')})`).run(...c); } });
    d.exec('delete from batches where id not in (select distinct batch_id from journal where batch_id is not null)');
    d.exec('delete from dupe_ignore where file_id not in (select id from files)');
    report.historyForgotten = hist.length;
    try { const ST = require('./storage'); const dir = ST.cacheDir(); for (const f of fs.readdirSync(dir)) { try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); } catch { /* in use */ } } } catch { /* no cache yet */ }
  }

  // 3. the new folders
  const kept = [...(S0.keptReferenceRoots || [])];
  if (b.forget && b.keepApprovals && destChanged && oldDest && report.examplesKept && !kept.some((x) => pkey(x) === pkey(oldDest))) kept.push(oldDest);
  const sources = Array.isArray(b.sources) ? b.sources.map((x) => (typeof x === 'string' ? { path: x, excludes: [] } : { path: String(x.path || '').trim(), excludes: x.excludes || [] })).filter((x) => x.path) : S0.sources;
  settingsMod.save({ destinationRoot: pv.newDest, sources, keptReferenceRoots: kept });

  // 4. names that differ: carry rules, priority, examples and mappings across (or forget them)
  const map = { ...Object.fromEntries(pv.folders.renamed.map((r) => [r.from, r.to])), ...(b.map || {}) };
  for (const [from, to] of Object.entries(map)) {
    if (to) { try { folders.merge({ from: [from], to }); report.renamed++; } catch (e) { log.warn('Could not carry', from, '->', to, e.message); } }
    else if (to === '') { folders.markDeleted(from); report.forgotFolders++; }
  }

  // 5. start the "folders changed" tracking from the new tree, so the switch itself isn't reported as renames
  const S = settingsMod.load(); const choices = choicesFor(S.destinationRoot, S) || [];
  db.kvSet('catalogChoices', choices); db.kvSet('folderPending', { gone: [], added: [] }); db.kvSet('goneRules', {});
  db.kvSet('changes', { ts: Date.now(), destAdded: [], destRemoved: [], newExampleFolders: [] });
  try { P.currentRules(); } catch (e) { log.warn('rules refresh failed', e.message); }
  if (b.forget) { try { require('./reset').cleanup(S); } catch (e) { log.warn('cleanup failed', e.message); } }
  log(`Changed folders: ${report.renamed} name(s) carried over, ${report.forgotFolders} forgotten, ${report.examplesKept} approvals kept as examples, ${report.filesForgotten} old file record(s) and ${report.historyForgotten} move(s) of history forgotten`);
  return report;
}

module.exports = { preview, apply };
