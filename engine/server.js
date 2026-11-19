'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const settingsMod = require('./settings');
const db = require('./db');
const P = require('./pipeline');
const { readCatalog, destinationChoices } = require('./catalog');
const { ensureThumb, thumbPath } = require('./thumbs');
const mover = require('./mover');
const sauce = require('./saucenao');
const { log } = require('./util');
const resetMod = require('./reset');
const UIFILE = path.join(settingsMod.DATA_DIR, 'ui.json');
const readUi = () => { try { return JSON.parse(fs.readFileSync(UIFILE, 'utf8')); } catch { return {}; } };

const UI = path.join(__dirname, '..', 'ui');
const TOKEN = process.env.CS_TOKEN || '';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const FILE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.avif': 'image/avif' };

const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(b); };
const body = (req) => new Promise((resolve, reject) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { try { resolve(c.length ? JSON.parse(Buffer.concat(c).toString('utf8')) : {}); } catch (e) { reject(e); } }); req.on('error', reject); });

// --- review queries ---
const EFF = `coalesce(s.user_folder, s.folder)`;
// pictures that are still waiting in the Duplicates or Connected sets screens are not shown in Review until you have dealt with them there
const HIDE = `f.id not in (select m.file_id from dupe_members m join dupe_groups g on g.id=m.group_id where g.state='pending' and m.decision is null) and f.id not in (select sm.file_id from set_members sm join sets_ st on st.id=sm.set_id where st.state='pending')`;
const fhqName = () => String(settingsMod.load().fhqFolder || 'Find Higher Quality').toLowerCase();
// scope: new = waiting for review | fhq = moved into a Find Higher Quality folder | sauce = sent to SauceNAO (any status)
function fromSql(scope) {
  if (scope === 'new') return `from suggestions s join files f on f.id=s.file_id left join sauce sa on sa.fp=f.fp`;
  return `from files f left join suggestions s on s.file_id=f.id left join sauce sa on sa.fp=f.fp`;
}

// ---- duplicate groups: keep / send to Dupes / not duplicates, per picture or per group ----
const dupeBetter = (a, b) => ((b.w * b.h) - (a.w * a.h)) || (b.size - a.size) || (a.mtime - b.mtime) || (a.path.length - b.path.length);
function dupeAct(action, group, fileIds) {
  const D = db.get(); const S = settingsMod.load(); const moveIds = [];
  const mem = D.prepare(`select m.file_id id, m.decision, f.status, f.path, f.w, f.h, f.size, f.mtime from dupe_members m join files f on f.id=m.file_id where m.group_id=?`).all(group).sort(dupeBetter);
  const open = mem.filter((x) => !x.decision && x.status === 'new');
  const pick = (ids) => (ids && ids.length ? open.filter((x) => ids.includes(x.id)) : []);
  const setKeep = (ids) => { // it goes to the normal Review, with the folder it would have had
    for (const id of ids) {
      D.prepare(`update dupe_members set decision='keep' where group_id=? and file_id=?`).run(group, id);
      D.prepare(`update suggestions set lane=case when (select kind from files where id=?)='video' then 'video' when (select realness from files where id=?)='real' then 'photo' else 'art' end,
        folder=coalesce(fallback,folder), score=coalesce(fallback_score,score), rating=coalesce(fallback_rating,rating), fallback=null, fallback_score=null, fallback_rating=null, reason='kept from a duplicate group'
        where file_id=? and lane='dupe' and state='pending'`).run(id, id, id);
    }
  };
  const setDupes = (ids) => { // moved straight to the Dupes folder
    for (const id of ids) {
      D.prepare(`update dupe_members set decision='dupes' where group_id=? and file_id=?`).run(group, id);
      D.prepare(`update suggestions set lane='dupe', folder=?, user_folder=null, state='approved', reason='sent to Dupes by you', fhq=0 where file_id=?`).run(S.dupesFolder || 'Dupes', id);
      moveIds.push(id);
    }
  };
  db.tx(() => {
    if (action === 'keep') setKeep(pick(fileIds).map((x) => x.id));
    else if (action === 'dupes') setDupes(pick(fileIds).map((x) => x.id));
    else if (action === 'keepBest') { const best = open[0]; if (best) { setKeep([best.id]); setDupes(open.slice(1).map((x) => x.id)); } }
    else if (action === 'notDupes') { // these pictures are not duplicates: never group them again, they go to Review
      for (const x of mem) D.prepare('insert or ignore into dupe_ignore(file_id) values(?)').run(x.id);
      setKeep(open.map((x) => x.id)); D.prepare(`update dupe_groups set state='rejected' where id=?`).run(group);
    }
    const left = D.prepare(`select count(*) c from dupe_members m join files f on f.id=m.file_id where m.group_id=? and m.decision is null and f.status='new'`).get(group).c;
    if (!left && D.prepare('select state from dupe_groups where id=?').get(group).state === 'pending') D.prepare(`update dupe_groups set state='done' where id=?`).run(group);
  });
  return { moveIds, left: D.prepare(`select count(*) c from dupe_members m join files f on f.id=m.file_id where m.group_id=? and m.decision is null and f.status='new'`).get(group).c };
}

function reviewWhere(q) {
  const scope = q.scope || 'new';
  const w = [], a = [];
  if (scope === 'new') { w.push(`f.status='new'`); if (!q.ids) w.push(HIDE); }
  else if (scope === 'fhq') { w.push(`f.status='moved'`); w.push(`lower(replace(f.path,'\\','/')) like ?`); a.push(`%/${fhqName()}/%`); }
  else if (scope === 'sauce') { w.push(`(f.status='new' or (f.status='moved' and lower(replace(f.path,'\\','/')) like ?))`); a.push(`%/${fhqName()}/%`); w.push(`sa.fp is not null`); if (q.sstate === 'done') w.push(`sa.state='done'`); else if (q.sstate === 'waiting') w.push(`sa.state in ('queued','error')`); }
  if (q.ids) { const ids = String(q.ids).split(',').map(Number).filter(Boolean); w.push(`f.id in (${ids.map(() => '?').join(',') || 'null'})`); a.push(...ids); }
  if (q.lane) { w.push('s.lane=?'); a.push(q.lane); }
  if (q.state) { w.push('s.state=?'); a.push(q.state); }
  if (q.folder === '__none__') w.push(`${EFF} is null`); else if (q.folder) { w.push(`${EFF}=?`); a.push(q.folder); }
  if (q.series) { w.push('s.series=?'); a.push(q.series); }
  if (q.q) { w.push('f.path like ?'); a.push('%' + q.q + '%'); }
  if (q.kind) { w.push('f.kind=?'); a.push(q.kind); }
  if (q.realm === 'art' || q.realm === 'real') { w.push(`coalesce(f.realness,'art')=?`); a.push(q.realm); }
  if (q.fhq === '1') w.push('s.fhq=1');
  if (q.hq === '1') w.push(`json_extract(sa.result,'$.hq') is not null`);
  if (q.minScore) { w.push('s.score>=?'); a.push(+q.minScore); }
  if (q.maxScore) { w.push('s.score<=?'); a.push(+q.maxScore); }
  if (q.rating) { w.push(`coalesce(s.user_rating,s.rating)=?`); a.push(q.rating); }
  // tags: include (all / any) and exclude, above a minimum confidence
  const tmin = q.tmin !== undefined && q.tmin !== '' ? +q.tmin : ((settingsMod.load().tagger || {}).minConfidence ?? 0.35);
  const inc = q.tinc ? String(q.tinc).split('|').filter(Boolean) : [], exc = q.texc ? String(q.texc).split('|').filter(Boolean) : [];
  if (inc.length) {
    const ph = inc.map(() => '?').join(',');
    w.push(`(select count(distinct t.tag) from file_tags t where t.file_id=f.id and t.conf>=? and t.tag in (${ph})) ${q.tmode === 'any' ? '>= 1' : '= ' + inc.length}`); a.push(tmin, ...inc);
  }
  if (exc.length) { w.push(`not exists (select 1 from file_tags t where t.file_id=f.id and t.conf>=? and t.tag in (${exc.map(() => '?').join(',')}))`); a.push(tmin, ...exc); }
  return { sql: w.join(' and ') || '1=1', args: a, scope };
}
const ORDER = {
  score_desc: 's.score desc, f.id', score_asc: 's.score asc, f.id',
  path: 'f.path collate nocase', path_desc: 'f.path collate nocase desc',
  size: 'f.size desc', size_asc: 'f.size asc',
  res: '(f.w*f.h) desc', res_asc: '(f.w*f.h) asc',
  newest: 'f.mtime desc', oldest: 'f.mtime asc',
  folder: `coalesce(s.user_folder, s.folder) collate nocase, f.id`, folder_desc: `coalesce(s.user_folder, s.folder) collate nocase desc, f.id`,
  rating: `case coalesce(s.user_rating, s.rating) when 'very' then 2 when 'nsfw' then 1 else 0 end desc, f.id`, rating_asc: `case coalesce(s.user_rating, s.rating) when 'very' then 2 when 'nsfw' then 1 else 0 end asc, f.id`,
  moved: 'f.moved_at desc, f.id', moved_asc: 'f.moved_at asc, f.id',
  sauce: 'sa.ts desc', sauce_asc: 'sa.ts asc',
  hq: `coalesce(json_extract(sa.result,'$.hq.factor'),0) desc, sa.ts desc`, hq_asc: `case when json_extract(sa.result,'$.hq.factor') is null then 1 else 0 end, json_extract(sa.result,'$.hq.factor') asc`,
};

function item(r) {
  let sauceRes = null; try { sauceRes = r.sauce_result ? JSON.parse(r.sauce_result) : null; } catch { /* none */ }
  return {
    id: r.fid, name: path.basename(r.path), path: r.path, kind: r.kind, w: r.w, h: r.h, size: r.size, duration: r.duration, status: r.fstatus,
    lane: r.lane, folder: r.folder, userFolder: r.user_folder, score: r.score, reason: r.reason, rating: r.rating, userRating: r.user_rating,
    fallback: r.fallback, fallbackRating: r.fallback_rating, alt: r.alt ? JSON.parse(r.alt) : [], series: r.series, state: r.state || (r.fstatus === 'moved' ? 'moved' : 'pending'), setId: r.set_id,
    fhq: r.fhq ? 1 : 0, tagger: r.tagger_used || null, realness: r.realness_ || 'art', realBy: r.real_by_ || null, pClip: r.pclip_, pJoy: r.pjoy_, sauce: r.sauce_state ? { state: r.sauce_state, result: sauceRes } : null, mtime: r.mtime,
  };
}
const ITEM_COLS = `s.*, f.id fid, f.status fstatus, f.path, f.w, f.h, f.size, f.kind, f.duration, f.mtime, f.tagger tagger_used, f.realness realness_, f.real_by real_by_, f.p_clip pclip_, f.p_joy pjoy_, sa.state sauce_state, sa.result sauce_result`;

// ---- Find Higher Quality: scan the folders on disk ----
async function refreshFhq() {
  const S = settingsMod.load(); const root = S.destinationRoot; const d = db.get();
  const { kindOf, pkey } = require('./util'); const sharp = require('sharp'); const { fingerprint } = require('./hashing');
  if (!root || !fs.existsSync(root)) return { added: 0, missing: 0 };
  const want = fhqName(); let added = 0, missing = 0;
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name.toLowerCase() === want) collect(abs); else walk(abs, depth + 1); }
    }
  };
  const collect = (dir) => { let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of ents) { const abs = path.join(dir, e.name); if (e.isDirectory()) collect(abs); else if (e.isFile() && kindOf(e.name)) found.push(abs); } };
  walk(root, 0);
  const have = new Set(d.prepare(`select pkey from files`).all().map((r) => r.pkey));
  for (const abs of found) {
    const k = pkey(abs); if (have.has(k)) continue;
    let st; try { st = fs.statSync(abs); } catch { continue; }
    const kind = kindOf(path.basename(abs)); let w = 0, h = 0;
    if (kind === 'image') { try { const m = await sharp(abs, { failOn: 'none' }).metadata(); w = m.width || 0; h = m.height || 0; } catch { /* unknown size */ } }
    let fp = null; try { fp = await fingerprint(abs, st.size); } catch { /* none */ }
    d.prepare(`insert or ignore into files(path,pkey,size,mtime,kind,ext,w,h,fp,analyzed,status,moved_at) values(?,?,?,?,?,?,?,?,?,4,'moved',?)`).run(abs, k, st.size, st.mtimeMs, kind, path.extname(abs).toLowerCase(), w, h, fp, st.mtimeMs);
    added++;
  }
  const hasAny = new Set(found.map(pkey));
  for (const r of d.prepare(`select id,path,pkey from files where status='moved'`).all()) {
    if (lowerSlash(r.path).includes('/' + want + '/') && !hasAny.has(r.pkey) && !fs.existsSync(r.path)) { d.prepare(`update files set status='gone' where id=?`).run(r.id); missing++; }
  }
  return { added, missing, total: found.length };
}
const lowerSlash = (p) => p.replace(/\\/g, '/').toLowerCase();

// ---- hover preview for videos: a strip of frames, cached ----
const spriteInflight = new Map();
async function spriteFor(row) {
  const sharp = require('sharp'); const video = require('./video'); const { DIR } = require('./thumbs');
  const cd = require('./storage').cacheDir(); fs.mkdirSync(cd, { recursive: true }); const out = path.join(cd, `sprite_${row.id}.jpg`); if (fs.existsSync(out)) return out;
  if (spriteInflight.has(row.id)) return spriteInflight.get(row.id);
  const N = 12, H = 200;
  const pr = (async () => {
    const dur = row.duration || (await video.probe(row.path)).duration || 0;
    const frames = new Array(N).fill(null);
    let next = 0;
    await Promise.all([0, 1, 2].map(async () => { while (next < N) { const i = next++; try { frames[i] = await video.frameAt(row.path, dur ? dur * ((i + 0.5) / N) : 0, 360); } catch { /* skip */ } } }));
    const ok = frames.filter(Boolean); if (!ok.length) throw new Error('no frames');
    const tiles = []; let W = 0;
    for (const f of frames) { const b = await sharp(f || ok[0]).resize({ height: H }).jpeg({ quality: 70 }).toBuffer(); const m = await sharp(b).metadata(); tiles.push({ b, w: m.width }); W = Math.max(W, m.width); }
    const comp = []; tiles.forEach((t, i) => comp.push({ input: t.b, left: i * W + Math.floor((W - t.w) / 2), top: 0 }));
    await sharp({ create: { width: W * N, height: H, channels: 3, background: '#000' } }).composite(comp).jpeg({ quality: 70 }).toFile(out);
    return out;
  })().finally(() => spriteInflight.delete(row.id));
  spriteInflight.set(row.id, pr); return pr;
}

function learnedInfo() {
  const L = db.kvGet('learned', null); if (!L || !L.nsfw) return null;
  const f = (c) => ({ trained: !!c.model, n: c.n, counts: c.counts, accuracy: c.accuracy, kind: c.kind });
  return { ts: L.ts, nsfw: f(L.nsfw), real: f(L.real) };
}

async function api(req, res, u) {
  const p = u.pathname, m = req.method, q = Object.fromEntries(u.searchParams);
  const d = () => db.get();
  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const push = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const onP = (e) => push('progress', e), onJ = (e) => push('job', e), onS = (e) => push('sauce', e), onQ = (e) => push('queue', e), onL = (e) => push('log', e);
    P.bus.on('progress', onP); P.bus.on('job', onJ); P.bus.on('sauce', onS); P.bus.on('queue', onQ); require('./util').logBus.on('line', onL);
    push('hello', { job: P.state.job, progress: P.state.progress, sauce: { ...P.sauceState }, queue: P.queueInfo(), last: P.state.last });
    const t = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(t); P.bus.off('progress', onP); P.bus.off('job', onJ); P.bus.off('sauce', onS); P.bus.off('queue', onQ); require('./util').logBus.off('line', onL); });
    return;
  }
  if (p === '/api/state') {
    const S = settingsMod.load(); const c = d().prepare(`select
      (select count(*) from files where status='new') files, (select count(*) from files where analyzed=1 and status='new') analyzed,
      (select count(*) from files where analyzed=2) failed, (select count(*) from refs) refs, (select count(*) from refs where analyzed=1) refs_done, (select count(*) from refs where analyzed=3) refs_skipped,
      (select count(*) from suggestions s join files f on f.id=s.file_id where f.status='new' and s.state='pending' and ${HIDE}) pending,
      (select count(*) from suggestions s join files f on f.id=s.file_id where f.status='new' and s.state='approved') approved,
      (select count(*) from files where status='moved') moved,
      (select count(*) from suggestions s join files f on f.id=s.file_id where f.status='new' and s.state='pending' and ${HIDE} and coalesce(f.realness,'art')='art') art_pending,
      (select count(*) from dupe_groups where state='pending') dupe_groups, (select count(*) from sets_ where state='pending') sets_pending,
      (select count(*) from suggestions s join files f on f.id=s.file_id where f.status='new' and s.state='pending' and ${HIDE} and f.realness='real') real_pending`).get();
    const todo = d().prepare(`select (select count(*) from files where status='new' and analyzed=0) files, (select count(*) from refs where analyzed=0) refs, (select count(*) from refs where analyzed=3) refsMore`).get();
    return send(res, 200, { settings: S, counts: c, todo, changes: db.kvGet('changes', null), folderChanges: ((db.kvGet('folderPending', null) || {}).gone || []).length, lastRescan: db.kvGet('lastRescan', null), job: P.state.job, queue: P.queueInfo(), last: P.state.last, safeMode: !!process.env.CS_SAFE, progress: P.state.progress, modelsReady: P.modelsReady(), modelDir: P.modelDir(), provider: P.state.models && P.state.models.provider, message: P.state.message, version: 2,
      tagger: { model: P.taggerKey(), options: Object.entries(require('./models').TAGGERS).map(([key, t]) => ({ key, label: t.label })), used: db.kvGet('taggerUsed', c.analyzed ? 'swinv2' : null) }, learned: learnedInfo(), sauce: { ...P.sauceState }, modelNote: P.state.modelNote || '', classifier: (() => { const cl = require('./classify'); const sb = cl.scoreboard(); const learnedC = db.kvGet('classifier', null); return { model: (S.classify || {}).model || 'auto', using: cl.chooseModel(S, sb), scoreboard: sb, joytag: P.joytagReady(), learned: learnedC ? { clip: { trained: !!learnedC.clip.model, counts: learnedC.clip.counts, accuracy: learnedC.clip.accuracy }, joytag: { trained: !!learnedC.joy.model, counts: learnedC.joy.counts, accuracy: learnedC.joy.accuracy } } : null }; })(), retag: P.retagCount(), modelInfo: P.state.models ? { key: P.state.models.key, label: P.state.models.label, provider: P.state.models.provider, gpu: P.state.models.gpu || '' } : null, problems: { files: d().prepare(`select err, count(*) n from files where analyzed=2 and status='new' group by err order by n desc limit 5`).all(), refs: d().prepare(`select err, count(*) n from refs where analyzed=2 group by err order by n desc limit 5`).all() } });
  }
  if (p === '/api/settings') {
    if (m === 'POST') {
      const before = JSON.stringify((settingsMod.load().tagSource) || {}); const s = settingsMod.save(await body(req)); P.dropModels();
      if (JSON.stringify(s.tagSource || {}) !== before) { try { require('./tags').fillAll(); } catch (e) { log('tag refill failed', e.message); } } // another tag source: rebuild the tag lists from what is already stored
      let cleaned = { filesRemoved: 0, examplesRemoved: 0 };
      if (!P.state.job) { try { cleaned = resetMod.cleanup(s); } catch (e) { log('cleanup failed', e.message); } }
      return send(res, 200, q.report ? { settings: s, cleaned } : s);
    }
    return send(res, 200, settingsMod.load());
  }
  if (p === '/api/refs/kept') {
    const S = settingsMod.load(); const { pkey } = require('./util');
    const rows = d().prepare('select path from refs where analyzed=1').all().map((r) => pkey(r.path));
    return send(res, 200, (S.keptReferenceRoots || []).map((root) => { const k = pkey(root); return { path: root, learned: rows.filter((x) => x.startsWith(k + '/')).length }; }));
  }
  if (p === '/api/refs/remove' && m === 'POST') {
    // Remove an examples folder. keep=true: stop scanning it but remember what was already learned from it.
    const b = await body(req); const { pkey } = require('./util'); const S0 = settingsMod.load();
    const roots = (S0.referenceRoots || []).filter((x) => pkey(x) !== pkey(b.path));
    const kept = (S0.keptReferenceRoots || []).filter((x) => pkey(x) !== pkey(b.path)); if (b.keep) kept.push(b.path);
    const s = settingsMod.save({ referenceRoots: roots, keptReferenceRoots: kept });
    const k = pkey(b.path);
    if (b.keep) { // drop the not-yet-learned files of that folder (they will never be learned), keep the learned ones
      const ids = d().prepare('select id,path from refs where analyzed!=1').all().filter((r) => pkey(r.path).startsWith(k + '/')).map((r) => r.id);
      for (let i = 0; i < ids.length; i += 400) { const c = ids.slice(i, i + 400); d().prepare(`delete from refs where id in (${c.map(() => '?').join(',')})`).run(...c); }
    } else if (!P.state.job) resetMod.cleanup(s);
    else { // a job is running: drop the folder's refs now (the running job notices the folder is gone and stops using it)
      const ids = d().prepare('select id,path from refs').all().filter((r) => pkey(r.path).startsWith(k + '/')).map((r) => r.id);
      for (let i = 0; i < ids.length; i += 400) { const c = ids.slice(i, i + 400); d().prepare(`delete from refs where id in (${c.map(() => '?').join(',')})`).run(...c); }
    }
    P.dropModels && !P.state.job && P.dropModels();
    return send(res, 200, { settings: s });
  }
  if (p === '/api/refs/forget-kept' && m === 'POST') {
    const b = await body(req); const { pkey } = require('./util'); const k = pkey(b.path); const S0 = settingsMod.load();
    const s = settingsMod.save({ keptReferenceRoots: (S0.keptReferenceRoots || []).filter((x) => pkey(x) !== k) });
    const ids = d().prepare('select id,path from refs').all().filter((r) => pkey(r.path).startsWith(k + '/') && !(s.referenceRoots || []).some((x) => pkey(r.path).startsWith(pkey(x) + '/'))).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 400) { const c = ids.slice(i, i + 400); d().prepare(`delete from refs where id in (${c.map(() => '?').join(',')})`).run(...c); }
    return send(res, 200, { removed: ids.length });
  }
  // ---------- renamed / merged / deleted destination folders ----------
  if (p === '/api/destchanges') { const F = require('./folders'); return send(res, 200, F.changes()); }
  if (p === '/api/destchanges/resolve' && m === 'POST') {
    const F = require('./folders'); const b = await body(req); let n = 0;
    try {
      for (const a of b.actions || []) { if (a.type === 'deleted') { F.markDeleted(a.name); n++; } else if (a.type === 'merge') { F.merge(a); n++; } else if (a.type === 'new') F.dismissAdded(); }
    } catch (e) { return send(res, 400, { error: e.message }); }
    P.currentRules();
    const pend = d().prepare(`select count(*) c from suggestions where state='pending'`).get().c;
    if (n && pend && !P.state.job) P.runDecide({}).catch(() => {});
    return send(res, 200, { ok: true, applied: n, ...F.changes() });
  }
  // ---------- destination subfolders as targets ----------
  if (p === '/api/dest/tree') {
    const S0 = settingsMod.load(); const cat = readCatalog(S0.destinationRoot, S0); const rel = String(q.rel || '');
    const base = rel ? path.join(cat.root || '', ...rel.split('/')) : cat.root; const subs = (S0.subTargets || []).map((x) => x.toLowerCase());
    let dirs = []; try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !['nsfw', 'very'].includes(e.name.toLowerCase())).map((e) => e.name).sort((a, b) => a.localeCompare(b)); } catch { /* missing */ }
    const kids = (nm) => { try { return fs.readdirSync(path.join(base, nm), { withFileTypes: true }).some((e) => e.isDirectory() && !['nsfw', 'very'].includes(e.name.toLowerCase())); } catch { return false; } };
    return send(res, 200, { dirs: dirs.map((nm) => { const r = rel ? `${rel}/${nm}` : nm; return { name: nm, rel: r, on: subs.includes(r.toLowerCase()), kids: kids(nm), top: !rel, ignored: !rel && cat.byName[nm] && cat.byName[nm].ignored }; }), missing: require('./catalog').missingSubTargets(cat, S0) });
  }
  if (p === '/api/dest/target' && m === 'POST') {
    const b = await body(req); const S0 = settingsMod.load(); let subs = (S0.subTargets || []).slice();
    subs = subs.filter((x) => x.toLowerCase() !== String(b.rel).toLowerCase()); if (b.on) subs.push(b.rel);
    settingsMod.replace({ ...S0, subTargets: subs }); P.currentRules();
    return send(res, 200, { subTargets: subs });
  }
  // ---------- examples manager + what the app knows ----------
  if (p.startsWith('/api/refs/') && ['overview', 'probe', 'use', 'map', 'automatch', 'cap'].includes(p.slice(10))) {
    const K = require('./knowledge'); const S0 = settingsMod.load();
    const dests = () => { const cat = readCatalog(S0.destinationRoot, S0); return destinationChoices(cat, settingsMod.load()); };
    const ov = () => K.overview(settingsMod.load(), dests());
    if (p === '/api/refs/overview') return send(res, 200, ov());
    if (p === '/api/refs/probe') return send(res, 200, K.children(S0, q.root, q.rel || '', dests()));
    const b = await body(req);
    if (p === '/api/refs/use') {              // tick / untick one examples subfolder
      const map = { ...(S0.referenceMap || {}) }; let ign = (S0.ignoreFolders || []).slice();
      const key = Object.keys(map).find((k) => k.toLowerCase() === String(b.rel).toLowerCase()) || b.rel;
      if (b.use) { delete map[key]; ign = ign.filter((x) => x.toLowerCase() !== String(b.rel).toLowerCase()); } else map[key] = null;
      settingsMod.replace({ ...S0, referenceMap: map, ignoreFolders: ign });
    }
    if (p === '/api/refs/map') {              // send an examples subfolder to a destination folder (or back to automatic)
      const map = { ...(S0.referenceMap || {}) }; const key = Object.keys(map).find((k) => k.toLowerCase() === String(b.rel).toLowerCase()) || b.rel;
      if (b.folder === 'auto' || b.folder === undefined) delete map[key]; else map[key] = Array.isArray(b.folder) ? (b.folder.length ? b.folder : null) : b.folder;
      settingsMod.replace({ ...S0, referenceMap: map, ignoreFolders: (S0.ignoreFolders || []).filter((x) => x.toLowerCase() !== String(b.rel).toLowerCase()) });
    }
    if (p === '/api/refs/automatch') {        // map every examples folder whose name doesn't match a destination to the closest one
      const d0 = dests(); const o = K.overview(S0, d0); const map = { ...(S0.referenceMap || {}) }; let n = 0;
      for (const R of o.roots) for (const g of R.groups) if (g.use && !g.ok && g.suggested) { map[g.rel] = g.suggested; n++; }
      settingsMod.replace({ ...S0, referenceMap: map }); b.matched = n;
    }
    if (p === '/api/refs/cap') {
      const pf = { ...((S0.refs || {}).perFolder || {}) };
      if (b.cap === null || b.cap === '' || b.cap === undefined) delete pf[b.folder]; else pf[b.folder] = Math.max(0, Math.min(5000, +b.cap || 0));
      if (b.all !== undefined) settingsMod.replace({ ...S0, refs: { ...(S0.refs || {}), maxPerFolder: Math.max(5, Math.min(5000, +b.all || 150)) } });
      else settingsMod.replace({ ...S0, refs: { ...(S0.refs || {}), perFolder: pf } });
    }
    const S1 = settingsMod.load(); const r = K.remap(S1);   // examples already stored follow the new mapping straight away
    if (p === '/api/refs/use' || p === '/api/refs/map' || p === '/api/refs/automatch') db.kvSet('learned', null);
    return send(res, 200, { ...ov(), remapped: r, matched: b.matched });
  }
  if (p === '/api/knowledge') {
    const { rules } = P.currentRules(); const K = require('./knowledge');
    const rows = d().prepare(`select ${EFF} fo, count(*) n, avg(s.score) avg, sum(s.reason like 'best guess%') guess, sum(s.score<0.45) low from suggestions s join files f on f.id=s.file_id where f.status='new' and s.state='pending' and s.lane='art' group by fo`).all();
    const cur = new Map(rows.map((r) => [r.fo, r]));
    const refs = new Map(d().prepare(`select folder, count(*) total, sum(analyzed=1) learned from refs group by folder`).all().map((r) => [r.folder, r]));
    const total = d().prepare(`select count(*) c from suggestions s join files f on f.id=s.file_id where f.status='new' and s.state='pending' and s.lane='art'`).get().c;
    return send(res, 200, { folders: rules.order.map((n) => { const r = rules.folders[n], c = cur.get(n) || {}, e = refs.get(n) || {}; return { name: n, type: r.type, enabled: r.enabled !== false, pending: c.n || 0, avg: c.avg == null ? null : +c.avg.toFixed(2), guess: c.guess || 0, low: c.low || 0, examples: e.total || 0, learned: e.learned || 0, profile: (e.learned || 0) >= K.MIN_EXAMPLES, keywords: (r.tags || []).length + (r.chars || []).length + (r.series || []).length }; }), totalArt: total, rules });
  }
  if (p === '/api/knowledge/folder') {
    const K = require('./knowledge'); const name = q.name; const S0 = settingsMod.load(); const { pkey } = require('./util');
    const learned = K.learnedSummary(name);
    const srcRows = d().prepare('select path,analyzed from refs where folder=?').all(name); const groups = new Map();
    for (const r of srcRows) { const root = (S0.referenceRoots || []).find((x) => K.relOf(x, r.path) !== null); const rel = root ? K.relOf(root, r.path).split('/').slice(0, root ? 1 : 0).join('/') : '(removed folder)'; const key = (root || '') + '\u0000' + rel; const g = groups.get(key) || { root: root || '', rel, files: 0, learned: 0 }; g.files++; if (r.analyzed === 1) g.learned++; groups.set(key, g); }
    const ids = d().prepare(`select f.id, s.score, s.reason, s.rating from suggestions s join files f on f.id=s.file_id where f.status='new' and s.state='pending' and ${EFF}=? order by s.score asc limit 12`).all(name);
    const cnt = d().prepare(`select count(*) c from suggestions s join files f on f.id=s.file_id where f.status='new' and s.state='pending' and ${EFF}=?`).get(name).c;
    const cur = cnt ? d().prepare(`select t.tag, count(*) n from file_tags t where t.conf>=0.35 and t.cat=0 and t.file_id in (select f.id from suggestions s join files f on f.id=s.file_id where f.status='new' and s.state='pending' and ${EFF}=?) group by t.tag order by n desc limit 16`).all(name).map((r) => [r.tag, +(r.n / cnt).toFixed(2)]) : [];
    return send(res, 200, { name, learned, sources: [...groups.values()].sort((a, b) => b.files - a.files), lowest: ids, pending: cnt, currentTags: cur, cap: ((S0.refs || {}).perFolder || {})[name] ?? (S0.refs || {}).maxPerFolder ?? 150 });
  }
  if (p === '/api/settings/defaults') return send(res, 200, settingsMod.DEFAULTS);
  if (p === '/api/ui') {
    if (m === 'POST') { const b = await body(req); fs.writeFileSync(UIFILE, JSON.stringify(b)); return send(res, 200, { ok: true }); }
    return send(res, 200, readUi());
  }
  if (p === '/api/datainfo') {
    const S = settingsMod.load();
    return send(res, 200, { dataDir: settingsMod.DATA_DIR, modelDir: P.modelDir(), logFile: path.join(settingsMod.DATA_DIR, 'engine.log'), canOpen: !!process.send, thumbs: (() => { try { return fs.readdirSync(path.join(settingsMod.DATA_DIR, 'thumbs')).length; } catch { return 0; } })(), destination: S.destinationRoot });
  }
  if (p === '/api/open-folder' && m === 'POST') {
    const b = await body(req); if (b.which === 'file') { const f = d().prepare('select path from files where id=?').get(+b.id); if (!f) return send(res, 404, { error: 'Not found' }); if (process.send) process.send({ type: 'open-path', path: f.path, reveal: true }); return send(res, 200, { ok: !!process.send, path: f.path }); }
    const target = b.which === 'models' ? P.modelDir() : b.which === 'log' ? (process.env.CS_LOGFILE || path.join(settingsMod.DATA_DIR, 'engine.log')) : b.which === 'logs' ? path.join(settingsMod.DATA_DIR, 'logs') : b.which && require('./storage').pathOf(b.which) ? require('./storage').pathOf(b.which) : settingsMod.DATA_DIR;
    if (process.send) process.send({ type: 'open-path', path: target, reveal: b.which === 'log' });
    return send(res, 200, { ok: !!process.send, path: target });
  }
  if (p === '/api/reset' && m === 'POST') {
    const b = await body(req);
    if (!resetMod.WHAT[b.what]) return send(res, 400, { error: 'unknown reset' });
    if (P.state.job && b.what !== 'thumbs') return send(res, 409, { error: `Wait for "${P.state.job}" to finish or cancel it first.` });
    const msg = resetMod.WHAT[b.what]();
    if (b.what === 'settings' || b.what === 'rules') P.dropModels();
    return send(res, 200, { message: msg });
  }
  if (p === '/api/regroup' && m === 'POST') { P.runRegroup().catch(() => {}); return send(res, 200, startedReply()); }
  if (p === '/api/catalog') {
    const S = settingsMod.load(); const cat = readCatalog(S.destinationRoot, S);
    return send(res, 200, { root: cat.root, choices: destinationChoices(cat, S), folders: cat.folders.map((f) => ({ name: f.name, ignored: f.ignored, hasNsfw: !!f.nsfw, hasVery: !!f.very })) });
  }
  // load the models fresh and run one test picture through them: tells you exactly what works on this PC
  if (p === '/api/models/test' && m === 'POST') {
    if (P.state.job) return send(res, 409, { error: `Wait for "${P.state.job}" to finish first.` });
    if (!P.modelsReady()) return send(res, 200, { ok: false, error: 'The models are not downloaded yet.' });
    try { P.dropModels(); const t0 = Date.now(); const mm = await P.getModels(); P.emit({ phase: 'models', note: 'Models ready', finished: true }); return send(res, 200, { ok: true, provider: mm.provider, gpu: mm.gpu || '', model: mm.key, seconds: Math.round((Date.now() - t0) / 100) / 10, msTagger: mm.ms.tagger, msClip: mm.ms.clip, note: mm.note || '' }); }
    catch (e) { P.dropModels(); P.emit({ phase: 'models', note: '', finished: true }); return send(res, 200, { ok: false, error: e.message }); }
  }
  if (p === '/api/models/download' && m === 'POST') { P.downloadModels().catch(() => {}); return send(res, 200, startedReply()); }
  if (p === '/api/run' && m === 'POST') { const b = await body(req); P.runAnalysis(b).catch(() => {}); return send(res, 200, startedReply()); }
  if (p === '/api/learn' && m === 'POST') { const b = await body(req); P.runAnalysis({ files: false, refs: true, refsOpts: { folders: b.folders || null, relearn: !!b.relearn } }).catch(() => {}); return send(res, 200, startedReply()); }
  if (p === '/api/switch/preview' && m === 'POST') { try { return send(res, 200, require('./switch').preview(await body(req))); } catch (e) { return send(res, 400, { error: e.message }); } }
  if (p === '/api/switch' && m === 'POST') {
    let r; try { r = require('./switch').apply(await body(req)); } catch (e) { return send(res, 400, { error: e.message }); }
    P.runRescan().catch(() => {}); return send(res, 200, r);
  }
  if (p === '/api/rescan' && m === 'POST') { P.runRescan().catch(() => {}); return send(res, 200, startedReply()); }
  if (p === '/api/changes/clear' && m === 'POST') { db.kvSet('changes', null); return send(res, 200, { ok: true }); }
  if (p === '/api/redecide' && m === 'POST') { P.runDecide().catch(() => {}); return send(res, 200, startedReply()); }
  if (p === '/api/job' && m === 'POST') { const b = await body(req); const c = P.state.ctl; if (b.action === 'pause') c.paused = true; if (b.action === 'resume') c.paused = false; if (b.action === 'cancel') { P.cancelAll(); c.paused = false; } return send(res, 200, { ok: true, paused: c.paused }); }

  if (p === '/api/review') {
    const w = reviewWhere(q); const lim = Math.min(500, +q.limit || 120), off = +q.offset || 0;
    const base = `${fromSql(w.scope)} where ${w.sql}`;
    const total = d().prepare(`select count(*) c ${base}`).get(...w.args).c;
    const orderBy = q.sort === 'random' ? `((f.id * 7919 + ${parseInt(q.seed || 1, 10) || 1} * 104729) % 1000003)` : (ORDER[q.sort] || ORDER.score_desc);
    const rows = d().prepare(`select ${ITEM_COLS} ${base} order by ${orderBy} limit ? offset ?`).all(...w.args, lim, off);
    const items = rows.map(item);
    if (q.withtags === '1' && items.length) { // top tags for the card view
      const tmin = q.tmin !== undefined && q.tmin !== '' ? +q.tmin : ((settingsMod.load().tagger || {}).minConfidence ?? 0.35);
      const st = d().prepare('select tag,conf,cat from file_tags where file_id=? order by conf desc limit 160'); // every stored tag, even the unsure ones; the page dims those under the minimum
      for (const it of items) it.tags = st.all(it.id).map((t) => [t.tag, t.conf, t.cat]);
      for (const it of items) it.tmin = tmin;
    }
    return send(res, 200, { total, items });
  }
  if (p === '/api/folders') {
    const rows = d().prepare(`select ${EFF} folder, s.lane, count(*) n, sum(s.state='approved') approved, sum(s.state='pending') pending,
      sum(coalesce(s.user_rating,s.rating)='nsfw') nsfw, sum(coalesce(s.user_rating,s.rating)='very') very, round(avg(s.score),2) avg
      from suggestions s join files f on f.id=s.file_id where f.status='new' and ${HIDE}${q.realm === 'art' || q.realm === 'real' ? ` and coalesce(f.realness,'art')='${q.realm}'` : ''} group by 1,2 order by 3 desc`).all();
    return send(res, 200, rows);
  }
  if (p === '/api/lanes') {
    return send(res, 200, d().prepare(`select s.lane, count(*) n, sum(s.state='approved') approved from suggestions s join files f on f.id=s.file_id where f.status='new' and ${HIDE} group by 1`).all());
  }
  if (p === '/api/suggestion' && m === 'POST') {
    const b = await body(req); let ids = b.ids;
    if (b.filter) { const w = reviewWhere(b.filter); ids = d().prepare(`select f.id id ${fromSql(w.scope)} where ${w.sql}`).all(...w.args).map((r) => r.id); }
    if (!ids || !ids.length) return send(res, 200, { changed: 0, moved: 0 });
    const S = settingsMod.load(); let out = { changed: ids.length, moved: 0 };
    db.tx(() => {
      const run = (sql, ...a) => { const st = d().prepare(sql); for (const id of ids) st.run(...a, id); };
      if (b.action === 'approve') run(`update suggestions set state='approved' where state!='moved' and coalesce(user_folder,folder) is not null and file_id=?`);
      if (b.action === 'reject') run(`update suggestions set state='rejected' where state!='moved' and file_id=?`);
      if (b.action === 'reset') run(`update suggestions set state='pending' where state!='moved' and file_id=?`);
      if (b.action === 'setFolder') run(`update suggestions set user_folder=?, state='approved' where state!='moved' and file_id=?`, b.folder || null);
      if (b.action === 'setRating') run(`update suggestions set user_rating=? where state!='moved' and file_id=?`, b.rating || null);
      if (b.action === 'useFallback') run(`update suggestions set user_folder=fallback, user_rating=fallback_rating, lane='art', state='approved', fhq=0 where state!='moved' and file_id=? and fallback is not null`);
      if (b.action === 'clearChoice') run(`update suggestions set user_folder=null, user_rating=null, fhq=0, state='pending' where state!='moved' and file_id=?`);
      if (b.action === 'clearFolder') run(`update suggestions set user_folder=null, state='pending' where state!='moved' and file_id=?`);
      if (b.action === 'setFhq') run(`update suggestions set fhq=? where state!='moved' and file_id=?`, b.value ? 1 : 0);
      if (b.action === 'toggleFhq') { // if every picked file already has it, turn it off; otherwise turn it on for all
        const on = ids.every((id) => (d().prepare('select fhq from suggestions where file_id=?').get(id) || {}).fhq);
        for (const id of ids) d().prepare(`update suggestions set fhq=? where state!='moved' and file_id=?`).run(on ? 0 : 1, id);
        out.fhq = on ? 0 : 1;
      }
      if (b.action === 'approveFhq') run(`update suggestions set fhq=1, state='approved' where state!='moved' and coalesce(user_folder,folder) is not null and file_id=?`);
      if (b.action === 'setReal') { for (const id of ids) { const f = d().prepare('select fp from files where id=?').get(id); if (f && f.fp) d().prepare('insert or replace into labels(fp,real,ts) values(?,?,?)').run(f.fp, b.real ? 1 : 0, Date.now()); d().prepare('update files set realness=?, real_by=? where id=?').run(b.real ? 'real' : 'art', 'you', id); } }
      if (b.action === 'clearReal') { for (const id of ids) { const f = d().prepare('select fp from files where id=?').get(id); if (f && f.fp) d().prepare('delete from labels where fp=?').run(f.fp); } }
    });
    if (['approve', 'setFolder', 'useFallback', 'approveFhq'].includes(b.action)) { try { Object.assign(out, await P.autoApply(ids)); } catch (e) { out.error = e.message; } }
    if (b.action === 'setReal') require('./tags').fill(ids); // its tags now come from the other side's tag source
    if (b.action === 'setReal' || b.action === 'clearReal') { // re-decide just these files so they land in the right section
      try { if (P.state.job) out.note = 'Saved. The new section is applied when the current job finishes.'; else await P.runDecide({ onlyIds: ids }); } catch (e) { out.error = e.message; }
    }
    return send(res, 200, out);
  }
  // move files to a folder, whatever state they are in: waiting for review (approved and moved now) or already moved (relocated)
  if (p === '/api/move-to' && m === 'POST') {
    const b = await body(req); const ids = b.ids || []; const S = settingsMod.load();
    if (!b.folder) return send(res, 400, { error: 'Pick a folder first.' });
    const news = [], moved = [];
    for (const id of ids) { const f = d().prepare('select status from files where id=?').get(id); if (f) (f.status === 'moved' ? moved : news).push(id); }
    let result = { moved: 0 };
    if (news.length) {
      db.tx(() => { for (const id of news) { d().prepare(`update suggestions set user_folder=?, user_rating=coalesce(?,user_rating), fhq=?, state='approved' where file_id=?`).run(b.folder, b.rating || null, b.fhq ? 1 : 0, id); } });
      Object.assign(result, await P.autoApply(news));
    }
    if (moved.length) { if (P.state.job) return send(res, 409, { error: `Wait for "${P.state.job}" to finish first.` }); const r = await P.job('move', async () => mover.relocate(S, moved, b.folder, b.rating || null, 'Moved from a list')); result.moved = (result.moved || 0) + r.moved; result.failed = r.failed; }
    return send(res, 200, result);
  }
  // Find Higher Quality: nothing better found -> park the pictures in one manual folder in the main directory
  if (p === '/api/hq/manual' && m === 'POST') {
    const b = await body(req); const ids = (b.ids || []).map(Number).filter(Boolean); const S = settingsMod.load();
    if (!S.destinationRoot) return send(res, 400, { error: 'Set the destination folder first.' });
    if (!ids.length) return send(res, 400, { error: 'Select pictures first.' });
    if (P.state.job) return send(res, 409, { error: `Wait for "${P.state.job}" to finish first.` });
    const folder = S.fhqManualFolder || 'Find Higher Quality Manually';
    const rows = d().prepare(`select id,path,fp,status from files where id in (${ids.map(() => '?').join(',')})`).all(...ids);
    const r = await P.job('move', async () => mover.relocate(S, rows.filter((x) => x.status === 'moved').map((x) => x.id), folder, 'general', 'Find Higher Quality: sent to the manual folder'));
    const news = rows.filter((x) => x.status === 'new').map((x) => x.id);
    let n2 = { moved: 0 };
    if (news.length) { db.tx(() => { for (const id of news) d().prepare(`update suggestions set user_folder=?, user_rating='general', fhq=0, state='approved' where file_id=?`).run(folder, id); }); n2 = await P.autoApply(news); }
    const ins = d().prepare('insert into hq_log(ts,file_id,fp,name,path,event,detail) values(?,?,?,?,?,?,?)');
    for (const x of rows) ins.run(Date.now(), x.id, x.fp, path.basename(x.path), x.path, 'manual', JSON.stringify({ folder }));
    return send(res, 200, { moved: ((r && r.moved) || 0) + (n2.moved || 0), folder });
  }
  // Find Higher Quality: a better copy was found, so the old one went to the Recycle Bin (the app did that through Windows); keep a record
  if (p === '/api/hq/found' && m === 'POST') {
    const b = await body(req); const ids = (b.ids || []).map(Number).filter(Boolean); let n = 0, kept = 0;
    const ins = d().prepare('insert into hq_log(ts,file_id,fp,name,path,event,detail) values(?,?,?,?,?,?,?)');
    for (const id of ids) {
      const f = d().prepare('select f.id,f.path,f.fp,f.w,f.h,f.size,sa.result sr from files f left join sauce sa on sa.fp=f.fp where f.id=?').get(id); if (!f) continue;
      if (require('fs').existsSync(f.path)) { kept++; continue; } // not actually gone: leave it alone
      let hq = null; try { hq = JSON.parse(f.sr || 'null').hq || null; } catch { /* none */ }
      db.tx(() => { d().prepare(`update files set status='deleted' where id=?`).run(id); d().prepare('delete from suggestions where file_id=?').run(id); ins.run(Date.now(), id, f.fp, path.basename(f.path), f.path, 'trashed', JSON.stringify({ w: f.w, h: f.h, size: f.size, hq })); });
      n++;
    }
    return send(res, 200, { recorded: n, stillThere: kept });
  }
  // the log: every picture that was looked up, where it is now, and what happened to it
  if (p === '/api/lookup-log') {
    const rows = d().prepare(`select sa.fp, sa.ts, sa.result, f.id fid, f.path, f.status, f.w, f.h from sauce sa left join files f on f.fp=sa.fp where sa.state='done' order by sa.ts desc limit ?`).all(+q.limit || 500);
    const hq = d().prepare('select file_id, event, detail, ts from hq_log order by id').all(); const last = new Map(); for (const h of hq) last.set(h.file_id, h);
    const root = (settingsMod.load().destinationRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const out = rows.map((r) => {
      let res = null; try { res = JSON.parse(r.result || 'null'); } catch { /* none */ }
      const t = res && res.top; const h = last.get(r.fid); const pth = String(r.path || '').replace(/\\/g, '/');
      const where = r.status === 'deleted' ? 'Moved to the Recycle Bin (higher quality found)' : h && h.event === 'manual' && r.status === 'moved' && pth.includes('/' + (settingsMod.load().fhqManualFolder || 'Find Higher Quality Manually')) ? 'Sent to the manual folder' : r.status === 'moved' ? 'Moved to ' + (root && pth.toLowerCase().startsWith(root.toLowerCase() + '/') ? pth.slice(root.length + 1).replace(/\/[^/]*$/, '') : pth) : r.status === 'new' ? 'Still waiting for review' : '';
      return { ts: r.ts, name: pth.split('/').pop(), w: r.w, h: r.h, match: t ? (t.series || t.title || '') : '', similarity: t ? t.similarity : null, hq: res && res.hq ? { w: res.hq.w, h: res.hq.h, factor: res.hq.factor, url: res.hq.url } : null, where };
    });
    return send(res, 200, { rows: out });
  }
  // tags: what tags exist (with counts) inside the current selection, like TagGUI's tag list
  if (p === '/api/tags') {
    const w = reviewWhere(q); const tmin = q.tmin !== undefined && q.tmin !== '' ? +q.tmin : ((settingsMod.load().tagger || {}).minConfidence ?? 0.35);
    const base = `${fromSql(w.scope)} where ${w.sql}`;
    const total = d().prepare(`select count(*) c ${base}`).get(...w.args).c;
    const args = [tmin, ...w.args]; let like = '';
    if (q.tq) { like = ' and t.tag like ?'; args.push('%' + String(q.tq).toLowerCase() + '%'); }
    const rows = d().prepare(`select t.tag, t.cat, count(*) n, round(avg(t.conf),2) avg from file_tags t where t.conf>=? and t.file_id in (select f.id ${base})${like} group by t.tag order by n desc, t.tag limit ?`).all(...args, +q.limit || 500);
    return send(res, 200, { total, tags: rows });
  }
  if (p === '/api/tags/file') {
    const rows = d().prepare('select tag,conf,cat from file_tags where file_id=? order by conf desc').all(+q.id);
    return send(res, 200, rows);
  }
  // Find Higher Quality: re-scan the folders on disk so files you put there by hand show up too
  if (p === '/api/fhq/refresh' && m === 'POST') { return send(res, 200, await refreshFhq()); }
  if (p === '/api/sauce/queue' && m === 'POST') {
    const b = await body(req); let ids = b.ids || [];
    if (b.auto) ids = d().prepare(`select s.file_id id from suggestions s join files f on f.id=s.file_id where f.status='new' and f.kind='image' and (s.lane='unsorted' or (s.lane in ('art','photo') and s.score<?))`).all(+b.below || 0.5).map((r) => r.id);
    const n = await sauce.queue(ids); const started = b.start === false ? false : P.sauceStart();
    return send(res, 200, { queued: n, started, needKey: b.start !== false && !started && !P.sauceState.running });
  }
  if (p === '/api/sauce/dequeue' && m === 'POST') { const b = await body(req); sauce.dequeue(b.ids || []); return send(res, 200, { ok: true }); }
  if (p === '/api/sauce/requeue' && m === 'POST') { const b = await body(req); sauce.requeue(b.ids || []); P.sauceStart(); return send(res, 200, { ok: true }); }
  if (p === '/api/sauce/run' && m === 'POST') { return send(res, 200, { started: P.sauceStart() }); }
  if (p === '/api/sauce/control' && m === 'POST') { const b = await body(req); const st = P.sauceState; if (b.action === 'pause') st.paused = true; if (b.action === 'resume') st.paused = false; if (b.action === 'cancel') { st.cancelled = true; st.paused = false; } return send(res, 200, { ...st }); }
  if (p === '/api/sauce/stats') {
    const r = d().prepare(`select sum(sa.state='queued') queued, sum(sa.state='done') done, sum(sa.state='error') error from sauce sa join files f on f.fp=sa.fp and f.status in ('new','moved')`).get();
    return send(res, 200, { queued: r.queued || 0, done: r.done || 0, error: r.error || 0, worker: { ...P.sauceState } });
  }
  if (p.startsWith('/api/sprite/')) { // a strip of frames spread over a video, for hover preview
    const id = +p.split('/').pop(); const row = d().prepare('select id,path,kind,duration from files where id=?').get(id);
    if (!row || row.kind !== 'video' || !fs.existsSync(row.path)) return send(res, 404, {});
    try { const f = await spriteFor(row); res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' }); return fs.createReadStream(f).pipe(res); } catch { return send(res, 404, {}); }
  }
  if (p.startsWith('/api/thumb/')) {
    const id = +p.split('/').pop(); const row = d().prepare('select id,path,kind,ext from files where id=?').get(id);
    if (!row) return send(res, 404, {});
    try { const tp = await ensureThumb(row); res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' }); return fs.createReadStream(tp || thumbPath(id)).pipe(res); } catch { return send(res, 404, {}); }
  }
  if (p.startsWith('/api/file/')) {
    const id = +p.split('/').pop(); const row = d().prepare('select path from files where id=?').get(id);
    if (!row || !fs.existsSync(row.path)) return send(res, 404, {});
    const ext = path.extname(row.path).toLowerCase(); const st = fs.statSync(row.path);
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      const [a, b2] = range.replace('bytes=', '').split('-'); const start = +a || 0, end = b2 ? +b2 : st.size - 1;
      res.writeHead(206, { 'content-type': FILE_MIME[ext] || 'application/octet-stream', 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
      return fs.createReadStream(row.path, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': FILE_MIME[ext] || 'application/octet-stream', 'content-length': st.size, 'accept-ranges': 'bytes' });
    return fs.createReadStream(row.path).pipe(res);
  }

  // sets
  if (p === '/api/sets') {
    const sets = d().prepare(`select s.id,s.name,s.score,s.state,(select count(*) from set_members m join files f on f.id=m.file_id where m.set_id=s.id and f.status='new') n from sets_ s where s.state='pending' order by s.id`).all().filter((x) => x.n > 0);
    const mem = d().prepare(`select m.set_id, m.file_id, f.path from set_members m join files f on f.id=m.file_id where f.status='new' order by f.path`).all();
    return send(res, 200, sets.map((s) => ({ ...s, members: mem.filter((x) => x.set_id === s.id).map((x) => ({ id: x.file_id, name: path.basename(x.path) })) })));
  }
  if (p === '/api/sets/action' && m === 'POST') {
    const b = await body(req); const id = b.id;
    db.tx(() => {
      if (b.action === 'rename') { d().prepare('update sets_ set name=? where id=?').run(String(b.name).replace(/[<>:"/\\|?*]/g, ' ').trim(), id); const nm = d().prepare('select name from sets_ where id=?').get(id).name; d().prepare(`update suggestions set folder=? where set_id=? and lane='set'`).run(`Connected Art/${nm}`, id); }
      if (b.action === 'approve') { d().prepare(`update sets_ set state='approved' where id=?`).run(id); d().prepare(`update suggestions set state='approved' where set_id=? and lane='set'`).run(id); }
      if (b.action === 'reject') { d().prepare(`update sets_ set state='rejected' where id=?`).run(id); d().prepare(`update suggestions set lane='art', folder=fallback, rating=coalesce(fallback_rating,rating), state='pending', set_id=null where set_id=? and lane='set'`).run(id); }
      if (b.action === 'restore') { d().prepare(`update sets_ set state='pending' where id=?`).run(id); }
      if (b.action === 'removeMember') { d().prepare('delete from set_members where set_id=? and file_id=?').run(id, b.fileId); d().prepare(`update suggestions set lane='art', folder=fallback, rating=coalesce(fallback_rating,rating), state='pending', set_id=null where file_id=? and lane='set'`).run(b.fileId); }
    });
    if (b.action === 'restore') P.runDecide().catch(() => {});
    if (b.action === 'reject' && !P.state.job) { const ids = d().prepare(`select file_id from suggestions where state='pending' and lane!='set' and file_id in (select file_id from set_members where set_id=?)`).all(id).map((r) => r.file_id); if (ids.length) await P.runDecide({ onlyIds: ids }).catch(() => {}); } // rejected set: each picture goes back to the normal review with its own suggestion
    if (b.action === 'approve') { const ids = d().prepare(`select file_id from set_members where set_id=?`).all(id).map((r) => r.file_id); P.autoApply(ids).catch(() => {}); } // approving a set moves it now
    return send(res, 200, { ok: true });
  }
  // duplicates
  if (p === '/api/dupes') {
    d().prepare(`update dupe_groups set state='done' where state='pending' and id not in (select m.group_id from dupe_members m join files f on f.id=m.file_id where m.decision is null and f.status='new')`).run();
    const g = d().prepare(`select id,kind,state from dupe_groups where state='pending' order by id limit ? offset ?`).all(+q.limit || 100, +q.offset || 0);
    const total = d().prepare(`select count(*) c from dupe_groups where state='pending'`).get().c;
    const mem = d().prepare(`select m.group_id,m.file_id,m.keep,m.decision,f.status,f.path,f.w,f.h,f.size,f.mtime from dupe_members m join files f on f.id=m.file_id where m.group_id in (${g.map(() => '?').join(',') || 'null'})`).all(...g.map((x) => x.id));
    return send(res, 200, { total, groups: g.map((x) => { const ms = mem.filter((y) => y.group_id === x.id).sort(dupeBetter); return { ...x, members: ms.map((y, i) => ({ id: y.file_id, best: i === 0, decision: y.decision || (y.status !== 'new' ? 'gone' : null), name: path.basename(y.path), path: y.path, w: y.w, h: y.h, size: y.size })) }; }) });
  }
  if (p === '/api/dupes/action' && m === 'POST') {
    const b = await body(req); const out = dupeAct(b.action, b.group, b.fileIds || (b.fileId ? [b.fileId] : null));
    if (out.moveIds.length) P.autoApply(out.moveIds).catch(() => {});
    return send(res, 200, { ok: true, ...out, moveIds: undefined });
  }
  if (p === '/api/dupes/approve-all' && m === 'POST') {   // every pending group: keep the best, the rest go to Dupes
    const gs = d().prepare(`select id from dupe_groups where state='pending'`).all(); let moveIds = [];
    for (const x of gs) moveIds = moveIds.concat(dupeAct('keepBest', x.id).moveIds);
    if (moveIds.length) P.autoApply(moveIds).catch(() => {});
    return send(res, 200, { ok: true, groups: gs.length, moved: moveIds.length });
  }
  // rules
  if (p === '/api/rules') {
    if (m === 'POST') { const b = await body(req); db.kvSet('rules', b); return send(res, 200, { ok: true }); }
    const { rules } = P.currentRules(); return send(res, 200, rules);
  }
  if (p === '/api/rules/defaults') { const { rules } = P.defaultRules(); return send(res, 200, rules); }
  if (p === '/api/rules/reset' && m === 'POST') { db.kvSet('rules', null); const { rules } = P.currentRules(); return send(res, 200, rules); }
  // unmapped series
  if (p === '/api/unmapped') {
    const rows = d().prepare(`select s.series, count(*) n, min(s.file_id) sample from suggestions s join files f on f.id=s.file_id where f.status='new' and s.series is not null and s.lane='art' and s.state='pending' and coalesce(s.user_folder,s.folder) in ('Anime','Games') group by s.series order by n desc`).all();
    const mapped = new Map(d().prepare('select series,folder from series_map').all().map((r) => [r.series, r.folder]));
    return send(res, 200, { rows: rows.map((r) => ({ ...r, mapped: mapped.get(r.series) || null })), assigned: [...mapped].map(([series, folder]) => ({ series, folder })) });
  }
  if (p === '/api/unmapped/unassign' && m === 'POST') {
    const b = await body(req); for (const x of b.series) d().prepare('delete from series_map where series=?').run(x);
    P.runDecide().catch(() => {}); return send(res, 200, { ok: true });
  }
  if (p === '/api/unmapped' || (p === '/api/unmapped/assign' && m === 'POST')) {
    const b = await body(req);
    db.tx(() => {
      for (const s of b.series) {
        d().prepare('insert into series_map(series,folder) values(?,?) on conflict(series) do update set folder=excluded.folder').run(s, b.folder);
        d().prepare(`update suggestions set user_folder=?, state='approved' where series=? and lane='art' and state='pending' and coalesce(user_folder,folder) in ('Anime','Games')`).run(b.folder, s);
      }
    });
    return send(res, 200, { ok: true });
  }
  // apply / history / undo
  if (p === '/api/apply' && m === 'POST') { const b = await body(req); P.runApply({ ids: b.ids || null, note: b.note || '' }).catch(() => {}); return send(res, 200, startedReply()); }
  // Ctrl+Z: put back the most recent move (one approve, one folder move, or one batch)
  if (p === '/api/undo-last' && m === 'POST') {
    const b = mover.history(50).find((x) => x.moved > 0); if (!b) return send(res, 200, { nothing: true });
    P.runUndo('batch', b.id).catch(() => {}); return send(res, 200, { ...startedReply(), moved: b.moved, note: b.note });
  }
  if (p === '/api/history') {
    const all = mover.history(300);
    const batches = all.filter((b) => b.moved + b.undone + b.failed > 1);
    const sids = all.filter((b) => b.moved + b.undone + b.failed === 1).map((b) => b.id);
    const singles = sids.length ? d().prepare(`select j.id jid, j.batch_id, j.src, j.dst, j.status, j.ts, j.err, b.kind bkind, f.id fid, f.w, f.h, f.size, f.kind from journal j join batches b on b.id=j.batch_id left join files f on f.id=j.file_id where j.batch_id in (${sids.map(() => '?').join(',')}) order by j.id desc limit 300`).all(...sids) : [];
    const j = q.batch ? d().prepare(`select j.id,j.src,j.dst,j.status,j.err,j.file_id from journal j where j.batch_id=? order by j.id limit ? offset ?`).all(+q.batch, +q.limit || 200, +q.offset || 0) : [];
    return send(res, 200, { batches, singles, journal: j });
  }
  if (p === '/api/undo' && m === 'POST') {
    const b = await body(req);
    const kind = b.batch ? 'batch' : b.journal ? 'file' : 'folder'; const arg = b.batch || b.journal || b.folder;
    const qd = P.busy(); P.runUndo(kind, arg).catch(() => {}); return send(res, 200, { started: !qd, queued: qd });
  }
  // ---------- Settings → Storage ----------
  if (p === '/api/storage') return send(res, 200, { places: require('./storage').info(), root: require('./storage').ROOT, busy: P.state.job });
  if (p === '/api/storage/move' && m === 'POST') {
    const b = await body(req); const ST = require('./storage');
    if (P.state.job) return send(res, 409, { error: `Moving waits until “${P.state.job}” has finished (or stop it first).` });
    let dest = b.dest;
    if (!dest) { const r = await askMain({ type: 'pick', mode: 'folder', title: 'Choose the new place' }); if (r.unsupported) return send(res, 200, { unsupported: true }); dest = (r.paths || [])[0]; }
    if (!dest) return send(res, 200, { cancelled: true });
    const key = String(b.key || ''); const what = (ST.places().find((x) => x.key === key) || {}).what || key;
    P.job('relocate', async (ctl) => { const r = await ST.move(key, dest, P.emit, ctl); P.emit({ phase: 'done', finished: true, note: `Moved to ${r.dest}` }); if (r.restart && process.send) process.send({ type: 'data-moved', dataDir: r.dest }); if (key === 'models') P.dropModels(); return { moved: r.files, dest: r.dest, restart: !!r.restart }; }, `Move ${what.toLowerCase()}`).catch(() => {});
    return send(res, 200, { started: true, dest });
  }
  if (p === '/api/storage/clear' && m === 'POST') { const b = await body(req); try { return send(res, 200, await require('./storage').clear(String(b.key || ''))); } catch (e) { return send(res, 400, { error: e.message }); } }
  // ---------- Diagnose and repair ----------
  if (p === '/api/diagnose' && m === 'GET') return send(res, 200, P.state.diagnosis || null);
  if (p === '/api/diagnose' && m === 'POST') {
    P.job('diagnose', async () => { const r = await require('./diagnose').run(P, P.emit); P.state.diagnosis = r; P.emit({ phase: 'done', finished: true, note: `${r.findings.filter((x) => x.level === 'danger' || x.level === 'warn').length} thing(s) to look at` }); return { checked: r.findings.length }; }).catch(() => {});
    return send(res, 200, startedReply());
  }
  if (p === '/api/repair' && m === 'POST') {
    const b = await body(req); const what = String(b.what || '');
    if (what === 'models') { P.downloadModels().catch(() => {}); return send(res, 200, startedReply()); }
    if (what === 'movemodels') { const ST = require('./storage'); const dest = ST.ROOT ? require('path').join(ST.ROOT, 'Models') : null; if (!dest) return send(res, 400, { error: 'The program is not in an App folder, so there is no place beside it.' }); P.job('relocate', async (ctl) => { const r = await ST.move('models', dest, P.emit, ctl); P.dropModels(); P.emit({ phase: 'done', finished: true, note: 'Models moved to ' + r.dest }); return { moved: r.files }; }, 'Move the AI models').catch(() => {}); return send(res, 200, startedReply()); }
    if (what.startsWith('mkdir:')) { const pth = require('./storage').pathOf(what.slice(6)); if (pth) fs.mkdirSync(pth, { recursive: true }); return send(res, 200, { ok: true }); }
    return send(res, 400, { error: 'Unknown repair' });
  }
  // ---------- safe mode (after two unclean exits in a row) ----------
  if (p === '/api/safemode/off' && m === 'POST') { if (process.send) process.send({ type: 'safe-off' }); return send(res, 200, { ok: !!process.send }); }
  // ---------- the log (the current run's file, for the log drawer) ----------
  if (p === '/api/log') {
    const n = Math.min(2000, +(q.lines || 400)); const U = require('./util');
    return send(res, 200, { lines: U.logRing.slice(-n), file: process.env.CS_LOGFILE || '' });
  }
  // ---------- the look: appearance.json, added fonts, theme files ----------
  if (p === '/api/appearance') {
    const A = require('./appearance');
    if (m === 'POST') { A.write(await body(req)); return send(res, 200, { ok: true }); }
    return send(res, 200, A.read() || {});
  }
  if (p === '/api/fonts') return send(res, 200, require('./appearance').fonts());
  if (p === '/api/fontfile') {
    const f = require('./appearance').fontFile(u.searchParams.get('id') || '', u.searchParams.get('name') || '');
    if (!f) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res);
  }
  if (p === '/api/fonts/pick' && m === 'POST') {
    const A = require('./appearance');
    const r = await askMain({ type: 'pick', mode: 'open', multi: true, title: 'Pick the font files (every weight of one font)', filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }] });
    if (r.unsupported) return send(res, 200, { unsupported: true, files: [] });
    return send(res, 200, { files: (r.paths || []).map((x) => A.describeFontFile(x)) });
  }
  if (p === '/api/fonts/install' && m === 'POST') { const b = await body(req); try { return send(res, 200, require('./appearance').addFont(b.family, b.files)); } catch (e) { return send(res, 400, { error: e.message }); } }
  if (p === '/api/fonts/remove' && m === 'POST') { const b = await body(req); return send(res, 200, require('./appearance').removeFont(String(b.id || ''))); }
  if (p === '/api/theme/export' && m === 'POST') {
    const b = await body(req); const safe = String((b.theme && b.theme.name) || 'theme').replace(/[\\/:*?"<>|]+/g, '_');
    const r = await askMain({ type: 'pick', mode: 'save', title: 'Save theme file', defaultPath: safe + '.theme.json', filters: [{ name: 'Theme', extensions: ['json'] }] });
    if (r.unsupported) return send(res, 200, { unsupported: true });
    if (!r.paths || !r.paths[0]) return send(res, 200, { path: null });
    return send(res, 200, { path: require('./appearance').exportTheme(r.paths[0], b.theme) });
  }
  if (p === '/api/theme/import' && m === 'POST') {
    const r = await askMain({ type: 'pick', mode: 'open', multi: true, title: 'Open theme files', filters: [{ name: 'Theme', extensions: ['json'] }] });
    if (r.unsupported) return send(res, 200, { unsupported: true, themes: [] });
    try { return send(res, 200, { themes: require('./appearance').importThemes(r.paths || []) }); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // SauceNAO
  if (p === '/api/pick-folder' && m === 'POST') {
    if (!process.send) return send(res, 200, { path: null, unsupported: true });
    const id = crypto.randomUUID();
    const reply = await new Promise((resolve) => { const h = (msg) => { if (msg && msg.type === 'picked' && msg.id === id) { process.off('message', h); resolve(msg.path); } }; process.on('message', h); process.send({ type: 'pick-folder', id }); });
    return send(res, 200, { path: reply });
  }
  return send(res, 404, { error: 'not found' });
}

// ask the desktop shell for something only it can do (a file dialog); { unsupported: true } when run without it
// after starting a job: was it started now, or added to the queue behind another one?
// crash safety: anything unexpected is written to logs\crash-<date>.txt with what was running
function crashLog(kind, e) {
  try { const dir = require('./storage').logsDir(); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `crash-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`);
    fs.writeFileSync(f, `Collection Sorter engine: ${kind}\n${new Date().toString()}\nRunning: ${P.state.job || 'nothing'}\nLast progress: ${JSON.stringify(P.state.progress || null)}\n\n${(e && e.stack) || e}\n`); log.error(`${kind}: ${(e && e.message) || e} (written to ${f})`); } catch { /* nothing more to do */ }
}
process.on('uncaughtException', (e) => { crashLog('uncaught error', e); });
process.on('unhandledRejection', (e) => { crashLog('unhandled promise rejection', e); });
function startedReply() { const q = P.queueInfo(); return P.state.job && q.length ? { started: false, queued: true, position: q.length, running: P.state.job } : { started: true }; }
function askMain(msg) {
  if (!process.send) return Promise.resolve({ unsupported: true });
  const id = crypto.randomUUID();
  return new Promise((resolve) => { const h = (r) => { if (r && r.type === 'picked' && r.id === id) { process.off('message', h); resolve({ paths: r.paths || (r.path ? [r.path] : []) }); } }; process.on('message', h); process.send({ ...msg, id }); });
}

function staticFile(req, res, u) {
  let rel = decodeURIComponent(u.pathname); if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(UI, rel));
  if (!file.startsWith(UI) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function start(port = 0) {
  db.open();
  try { mover.recover(); } catch { /* ignore */ }
  try { const ST = require('./storage'); fs.mkdirSync(ST.logsDir(), { recursive: true }); fs.mkdirSync(ST.cacheDir(), { recursive: true }); } catch { /* a missing drive is reported in Settings → Storage */ }
  // the AI models used to live on C:; when the program sits in an App folder they move next to it once, with progress
  setTimeout(() => { try { const ST = require('./storage'); if (ST.needsModelMove()) { log('Moving the AI models next to the program:', require('path').join(ST.ROOT, 'Models')); P.job('relocate', async (ctl) => { const r = await ST.move('models', require('path').join(ST.ROOT, 'Models'), P.emit, ctl); P.dropModels(); P.emit({ phase: 'done', finished: true, note: 'Models moved to ' + r.dest }); return { moved: r.files }; }, 'Move the AI models to ' + ST.ROOT).catch((e) => log.error('Moving the models failed:', e.message)); } } catch (e) { log.error('model move check failed', e.message); } }, 1500);
  setTimeout(() => { try { const S0 = settingsMod.load(); if (S0.autoRescan !== false && ((S0.sources || []).length || (S0.referenceRoots || []).length)) P.runRescan().catch((e) => log('rescan failed', e.message)); } catch (e) { log('rescan failed', e.message); } }, 1500);
  setTimeout(() => { try { require('./tags').ensureBuilt(); } catch (e) { log('tag index failed', e.message); } }, 500);
  const server = http.createServer(async (req, res) => {
    const u = new url.URL(req.url, 'http://127.0.0.1');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
    try {
      if (u.pathname.startsWith('/api/')) {
        if (TOKEN && req.headers['x-token'] !== TOKEN && u.searchParams.get('t') !== TOKEN) return send(res, 401, { error: 'unauthorised' });
        return await api(req, res, u);
      }
      return staticFile(req, res, u);
    } catch (e) { log('request error', req.url, e.stack || e.message); if (!res.headersSent) send(res, 500, { error: e.message }); else res.end(); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

if (require.main === module) {
  start(+process.env.CS_PORT || 0).then(({ port }) => { console.log(`ENGINE_PORT=${port}`); });
}
module.exports = { start };
