'use strict';
// Chooses a destination for every analysed file. Everything is a suggestion; nothing moves until approved.
const path = require('path');
const db = require('./db');
const { fromBlob } = require('./analyze');
const { assessRow } = require('./quality');
const { normTag } = require('./models/wd14');
const { log } = require('./util');
const learn = require('./learn');
const classify = require('./classify');
const { PHOTO_ART } = require('./prompts');
const tagsMod = require('./tags');
const knowledge = require('./knowledge');

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const noisyOr = (parts) => 1 - parts.reduce((a, [s, w]) => a * (1 - clamp(s) * w), 1);
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const seriesOf = (tag) => { const m = /\(([^()]+)\)\s*$/.exec(tag); return m ? m[1].trim() : null; };

// ---- prompt (zero-shot) embeddings, cached ----
async function promptEmbeddings(prompts, embedTexts) {
  const cache = db.kvGet('promptEmbs', {});
  const need = [...new Set(prompts)].filter((p) => !cache[p]);
  if (need.length && embedTexts) {
    const embs = await embedTexts(need);
    need.forEach((p, i) => { cache[p] = Buffer.from(embs[i].buffer, embs[i].byteOffset, embs[i].byteLength).toString('base64'); });
    db.kvSet('promptEmbs', cache);
  }
  const out = new Map();
  for (const p of prompts) if (cache[p]) { const b = Buffer.from(cache[p], 'base64'); out.set(p, new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))); }
  return out;
}

const softmax = (xs, t = 100) => { const m = Math.max(...xs); const e = xs.map((x) => Math.exp((x - m) * t)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };

// ---- reference library ----
function loadRefs(maxPerFolder) {
  const rows = db.get().prepare(`select folder,kind,tags,v from refs where analyzed=1 and v is not null union all select e.folder,r.kind,r.tags,r.v from refs_extra e join refs r on r.id=e.ref_id where r.analyzed=1 and r.v is not null`).all();
  const byFolder = new Map(); const charCount = new Map();
  for (const r of rows) {
    (byFolder.get(r.folder) || byFolder.set(r.folder, []).get(r.folder)).push(r);
    if (r.kind === 'image' || r.kind === 'video') {
      try { const t = JSON.parse(r.tags); for (const [n, p] of t.c || []) if (p >= 0.4) { const m = charCount.get(n) || new Map(); m.set(r.folder, (m.get(r.folder) || 0) + 1); charCount.set(n, m); } } catch { /* skip */ }
    }
  }
  const refs = [];
  for (const [folder, list] of byFolder) {
    // evenly spaced sample so a huge folder doesn't dominate the search time
    const step = Math.max(1, Math.ceil(list.length / maxPerFolder));
    for (let i = 0; i < list.length; i += step) refs.push({ folder, kind: list[i].kind, v: fromBlob(list[i].v) });
  }
  // learned characters: a character seen mostly inside one folder points to that folder
  const learned = new Map();
  for (const [ch, m] of charCount) {
    const total = [...m.values()].reduce((a, b) => a + b, 0); const [bf, bn] = [...m].sort((a, b) => b[1] - a[1])[0];
    if (total >= 2 && bn / total >= 0.7) learned.set(ch, bf);
  }
  return { refs, learned, folders: byFolder };
}

function knn(emb, refs, K = 9, kindFilter = null) {
  const top = [];
  for (const r of refs) {
    if (kindFilter && r.kind !== kindFilter) continue;
    const s = dot(emb, r.v);
    if (top.length < K) { top.push([s, r.folder]); top.sort((a, b) => a[0] - b[0]); }
    else if (s > top[0][0]) { top[0] = [s, r.folder]; top.sort((a, b) => a[0] - b[0]); }
  }
  const scores = new Map(); let tot = 0; const best = top.length ? top[top.length - 1][0] : 0;
  for (const [s, f] of top) { const w = Math.exp((s - 1) / 0.05); tot += w; scores.set(f, (scores.get(f) || 0) + w); }
  const conf = clamp((best - 0.6) / 0.3);
  for (const [f, w] of scores) scores.set(f, (w / (tot || 1)) * conf);
  return scores;
}

// ---- helpers on a file ----
function parseFile(r) {
  let t = { g: [], c: [], y: [] };
  try { t = { g: [], c: [], y: [], ...JSON.parse(r.tags || '{}') }; } catch { /* keep empty */ }
  const g = new Map(t.g); const c = new Map(t.c); const y = new Map(t.y);
  return { g, c, y, emb: null };
}

function ratingFolder(r, th) {
  const e = r.rating_e || 0, q = r.rating_q || 0;
  if (e >= th.veryMin) return 'very';
  if (e + q >= th.nsfwMin) return 'nsfw';
  return 'general';
}
// General / NSFW / Very. Learned from your own folders when there is enough to learn from, otherwise tagger ratings + tell-tale tags.
function rateFile(r, f, emb, L, th) {
  const rt = { general: r.rating_g || 0, sensitive: r.rating_s || 0, questionable: r.rating_q || 0, explicit: r.rating_e || 0 };
  const h = learn.heuristic(rt, f.g);
  let nsfw = h.nsfw, very = h.very, how = 'tagger';
  if (L && L.nsfw && emb) {
    const p = L.nsfw(emb, rt, f.g);
    if (L.nsfwKind === 3) { nsfw = p[1] + p[2]; very = p[2]; } else { nsfw = p[1]; very = Math.max(h.very * (p[1] > 0.5 ? 1 : 0.5), 0); }
    how = 'learned';
  }
  const rating = very >= th.veryMin && nsfw >= Math.min(th.nsfwMin, th.veryMin) ? 'very' : nsfw >= th.nsfwMin ? 'nsfw' : 'general';
  return { rating, nsfw, very, how };
}

function matchSeries(f, rule, learned, ownName) {
  // returns [score, why] for series-type rules
  const names = new Set((rule.series || []).map(normTag)); const chars = new Set((rule.chars || []).map(normTag));
  let best = 0, why = '';
  for (const [tag, p] of f.c) {
    const sr = seriesOf(tag);
    let s = 0;
    if (chars.has(tag)) s = p; else if (sr && names.has(normTag(sr))) s = p; else if (learned.get(tag) === ownName) s = p * 0.9;
    if (s > best) { best = s; why = `character "${tag}"`; }
  }
  for (const [tag, p] of f.y) if (names.has(tag) && p > best) { best = p; why = `series tag "${tag}"`; }
  for (const [tag, p] of f.g) if (names.has(tag) && p > best) { best = p; why = `tag "${tag}"`; }
  return [best, why];
}

function matchTags(f, rule) {
  const set = new Set((rule.tags || []).map(normTag));
  const hits = [];
  for (const [tag, p] of f.g) if (set.has(tag)) hits.push([p, tag]);
  if (!hits.length) return [0, ''];
  hits.sort((a, b) => b[0] - a[0]);
  const s = noisyOr(hits.slice(0, 3).map(([p], i) => [p, i === 0 ? 0.95 : 0.35]));
  return [s, `tag "${hits[0][1]}"`];
}

const W = {
  series: { tag: 0.97, knn: 0.9, zs: 0.45 },
  mono: { tag: 0.9, knn: 0.85, zs: 0.6 },
  style: { tag: 0.8, knn: 0.88, zs: 0.8 },
  subject: { tag: 0.75, knn: 0.88, zs: 0.8 },
  catchall: { tag: 0.6, knn: 0.8, zs: 0.65 },
};

function trainOffThread(settings, rules) {
  return new Promise((resolve) => {
    let w; try { w = new (require('worker_threads').Worker)(require('path').join(__dirname, 'trainworker.js'), { workerData: { settings, rules } }); } catch (e) { log.warn('training thread failed to start:', e.message); return resolve(); }
    w.once('message', (m) => { if (!m.ok) log.warn('training thread:', m.error); resolve(); });
    w.once('error', (e) => { log.warn('training thread error:', e.message); resolve(); });
    w.once('exit', () => resolve());   // whatever happens, the main thread trains itself if the results aren't there
  });
}
// ---- main ----
async function decideAll(settings, rules, catalog, deps, onProgress) {
  const d = db.get(); const th = { photo: 0.6, ...settings.thresholds, ...settings.rating };
  if (!learn.isFresh(rules) || !classify.isFresh()) {   // learning takes seconds with a big examples library: do it off the main thread
    if (onProgress) onProgress({ phase: 'decide', done: 0, total: 0, note: 'Learning from your examples and corrections…' });
    await trainOffThread(settings, rules);
  }
  const L = (settings.rating && settings.rating.learn === false) ? null : learn.prepare(settings, rules);
  const labelOf = new Map(d.prepare('select fp,real from labels').all().map((r) => [r.fp, r.real]));
  const PK = knowledge.build(); // tag fingerprints learned from your example folders
  const refData = loadRefs((settings.knn && settings.knn.maxPerFolder) || 60);
  const { refs, learned } = refData;
  const artRefs = refs.filter((r) => rules.folders[r.folder]); // only folders that art can be sorted into
  // zero-shot prompts
  const allPrompts = [];
  for (const [n, r] of Object.entries(rules.folders)) for (const p of r.prompts || []) allPrompts.push(p);
  const PH = {
    photoVsArt: ['a photograph taken with a camera', 'a real photo of real life', 'an anime illustration', 'a digital painting', 'a 3d render', 'a cartoon drawing'],
    photoClass: ['a photo of a woman', 'a selfie of a girl', 'a photo of a man', 'a photograph of a landscape or nature', 'a photo of a city street or building', 'a photo of an object, food or animal', 'a photo of a football match', 'a photo of soccer players on a pitch'],
    cosplay: ['a photo of a person in an anime cosplay costume with a wig', 'a cosplayer posing at a convention', 'an ordinary photo of a woman, not wearing a costume'],
    video: ['a video game screenshot or gameplay footage', 'a funny short video clip', 'an anime scene', '3d animation or cartoon', 'a video of a real woman', 'a video of real people or animals'],
  };
  // People - Art is only for art of real, recognisable people: CLIP can often recognise famous faces, so each name you list gets its own prompt
  const peopleNames = ((rules.folders['People - Art'] || {}).chars || []).map((s) => String(s).trim()).filter(Boolean);
  for (const nm of peopleNames) { allPrompts.push(`a drawing or painting of ${nm}`); allPrompts.push(`fan art portrait of the celebrity ${nm}`); }
  for (const v of Object.values(PH)) allPrompts.push(...v);
  const pe = await promptEmbeddings(allPrompts, deps && deps.embedTexts);
  const hasZs = pe.size > 0;
  // photo or art: two opinions (CLIP, JoyTag), your corrections as the answer key
  const labeledRefs = refs.map((r) => ({ v: r.v, real: classify.realOfFolder(r.folder, rules) })).filter((r) => r.real !== null);
  const C = classify.prepare(settings, rules, labeledRefs);
  const sb = classify.scoreboard((settings.classify || {}).photoAt ?? 0.5); const realModel = classify.chooseModel(settings, sb); const photoAt = (settings.classify || {}).photoAt ?? 0.5;
  const photoEmb = PHOTO_ART.every((p) => pe.has(p)) ? PHOTO_ART.map((p) => pe.get(p)) : null;
  const updReal = d.prepare('update files set realness=?, p_clip=?, p_joy=?, real_by=? where id=?'); const realChanged = [];
  const modelName = { clip: 'CLIP', joytag: 'JoyTag', both: 'CLIP + JoyTag' };
  const zsGroup = (emb, prompts) => (hasZs && prompts.every((p) => pe.has(p)) ? softmax(prompts.map((p) => dot(emb, pe.get(p)))) : null);
  // zero-shot per folder, normalised within the type so scores are comparable
  const folderPrompts = {}; for (const [n, r] of Object.entries(rules.folders)) folderPrompts[n] = (r.prompts || []).filter((p) => pe.has(p));
  if (folderPrompts['People - Art']) for (const nm of peopleNames) for (const p of [`a drawing or painting of ${nm}`, `fan art portrait of the celebrity ${nm}`]) if (pe.has(p)) folderPrompts['People - Art'].push(p);

  const seriesMap = new Map(d.prepare('select series,folder from series_map').all().map((r) => [r.series, r.folder]));
  const setOf = new Map(); for (const r of d.prepare('select m.file_id,s.id,s.name,s.state from set_members m join sets_ s on s.id=m.set_id').all()) setOf.set(r.file_id, r);
  const dupeLoser = new Set(d.prepare(`select m.file_id from dupe_members m join dupe_groups g on g.id=m.group_id where m.keep=0 and m.decision is null and g.state='pending'`).all().map((r) => r.file_id));

  let files = d.prepare(`select f.*, e.v as emb from files f left join emb e on e.file_id=f.id where f.analyzed=1 and f.status='new'`).all();
  if (deps && deps.onlyIds) { const only = new Set(deps.onlyIds); files = files.filter((x) => only.has(x.id)); }
  const upsert = d.prepare(`insert into suggestions(file_id,lane,folder,score,reason,rating,fallback,fallback_score,fallback_rating,alt,series,state,set_id,updated)
    values(?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)
    on conflict(file_id) do update set lane=excluded.lane,folder=excluded.folder,score=excluded.score,reason=excluded.reason,rating=excluded.rating,fallback=excluded.fallback,
      fallback_score=excluded.fallback_score,fallback_rating=excluded.fallback_rating,alt=excluded.alt,series=excluded.series,set_id=excluded.set_id,updated=excluded.updated
    where suggestions.state='pending' and suggestions.user_folder is null`);

  const order = rules.order.filter((n) => rules.folders[n] && rules.folders[n].enabled !== false);
  const unmapped = new Map();
  const artFlow = (f, emb, r, mono) => {
    const knnS = knn(emb, artRefs);
    // zero-shot across all folder prompts of each type
    const zsScore = {};
    if (hasZs) {
      const flat = []; for (const n of order) for (const p of folderPrompts[n] || []) flat.push([n, p]);
      if (flat.length) { const sm = softmax(flat.map(([, p]) => dot(emb, pe.get(p))), 100); flat.forEach(([n], i) => { zsScore[n] = (zsScore[n] || 0) + sm[i]; }); }
    }
    const scored = [];
    const prof = knowledge.score(PK, f.g, f.c);
    let bestSeries = null; // [name, p]
    for (const [tag, p] of f.c) { const sr = seriesOf(tag); if (sr && p >= 0.5 && (!bestSeries || p > bestSeries[1])) bestSeries = [sr, p]; }
    for (const n of order) {
      const rule = rules.folders[n]; const w = W[rule.type] || W.subject;
      let [ts, why] = rule.type === 'series' ? matchSeries(f, rule, learned, n) : matchTags(f, rule);
      if (n === 'People - Art' && peopleNames.length) { const low = String(r.path || '').toLowerCase(); const hit = peopleNames.find((nm) => low.includes(nm.toLowerCase())); if (hit && ts < 0.9) { ts = 0.9; why = `name "${hit}" in the file path`; } }
      if (rule.type === 'mono') { const m = clamp(((r.grey || 0) - 0.55) / 0.4); if (m > ts) { ts = m; why = `${Math.round((r.grey || 0) * 100)}% grey pixels`; } }
      const ks = knnS.get(n) || 0; const zs = clamp((zsScore[n] || 0) * (rule.type === 'catchall' ? 1 : 1.6));
      const ps = rule.type === 'catchall' ? 0 : prof.get(n) || 0;   // its examples' tags look like this picture's tags
      const parts = [[ts, w.tag], [ks, w.knn], [zs, w.zs], [ps, 0.8]];
      let s = noisyOr(parts);
      if ((rule.avoid || []).length) { const bad = (rule.avoid || []).map(normTag).find((t) => (f.g.get(t) || 0) >= 0.5); if (bad) { s *= 0.25; why = ''; } }   // a tag you said never belongs here
      if (!why) why = ps >= ks && ps >= zs && ps > 0.1 ? `tags like its examples (${knowledge.explain(PK, f.g, f.c, n).join(', ')})` : ks > zs ? 'looks like files already in this folder' : zs > 0.05 ? 'matches the folder description' : '';
      else if (ps > 0.3) why += ' + tags like its examples';
      else if (ks > 0.3) why += ' + similar to existing files';
      scored.push({ n, s, why, type: rule.type, th: rule.threshold ?? th[rule.type] ?? th.catchall ?? 0.4, ord: order.indexOf(n) });
    }
    // series folder chosen by the user in the "unmapped series" screen
    let claim = null;
    // 1. a series you assigned by hand
    if (bestSeries && !scored.some((x) => x.type === 'series' && x.s >= x.th) && seriesMap.has(bestSeries[0])) claim = { n: seriesMap.get(bestSeries[0]), s: bestSeries[1], why: `series "${bestSeries[0]}" assigned by you`, type: 'series' };
    // 2. the strongest folder that reached its own threshold (specific folders beat the broad ones; your ranking only breaks near-ties)
    const BONUS = { series: 1.12, mono: 1.05, style: 1, subject: 1, catchall: 0.7 };
    const eff = (c) => c.s * (BONUS[c.type] || 1);
    const passing = scored.filter((c) => c.s >= c.th && (!mono || c.type !== 'mono'));
    if (!claim && passing.length) {
      const mx = Math.max(...passing.map(eff));
      claim = passing.filter((c) => eff(c) >= mx - 0.05).sort((a, b) => a.ord - b.ord)[0];
    }
    const top = [...scored].sort((a, b) => b.s - a.s).slice(0, 4);
    if (!claim) {
      const specific = scored.filter((c) => c.type !== 'catchall').sort((a, b) => eff(b) - eff(a))[0];
      const best = Math.max(top[0] ? top[0].s : 0, 0);
      if (best < (th.unsortedBelow ?? 0.12)) claim = { n: null, s: best, why: 'nothing matched at all', type: 'none' };
      else if (specific && specific.s >= (th.bestGuess ?? 0.2)) claim = { ...specific, why: `best guess (not sure enough to be certain): ${specific.why || 'closest folder'}`, guess: true };
      else { const last = order[order.length - 1]; const c = scored.find((x) => x.n === 'All Other Art') || scored.find((x) => x.n === last); claim = c ? { ...c, why: 'fits no folder well, so it goes to the catch-all' } : { n: null, s: best, why: 'no catch-all folder', type: 'none' }; }
    }
    const runner = top.find((x) => x.n !== claim.n && x.s > 0.1);
    if (runner && claim.n && claim.type !== 'none') claim = { ...claim, why: `${claim.why} · next best: ${runner.n} ${Math.round(runner.s * 100)}%` };
    let unm = null;
    if (bestSeries && claim.type !== 'series' && !(scored.some((x) => x.type === 'series' && x.s >= x.th))) {
      unm = bestSeries[0];
      // a recognised series with no folder of its own goes to the Anime catch-all until you assign it (Unmapped series screen)
      if (!claim.n || claim.type === 'none') { const an = scored.find((x) => x.n === 'Anime'); if (an) claim = { n: 'Anime', s: Math.max(an.s, bestSeries[1] * 0.6), why: `series "${unm}" has no folder yet`, type: 'catchall' }; }
    }
    return { claim, top, series: bestSeries ? bestSeries[0] : null, unmappedSeries: unm };
  };

  const photoFlow = (f, emb, r) => {
    const c = zsGroup(emb, PH.photoClass) || [0, 0, 0, 0, 0, 0, 0, 0];
    const cls = { woman: c[0] + c[1], man: c[2], landscape: c[3] + c[4], other: c[5], football: c[6] + c[7] };
    const k = knn(emb, refs.filter((x) => /^(real|photographs|football)/i.test(x.folder)), 9);
    const kc = { woman: 0, man: 0, landscape: 0, other: 0, football: 0 };
    for (const [folder, s] of k) { if (/^real\//i.test(folder) || /^real$/i.test(folder)) kc.woman += s; else if (/landscapes/i.test(folder)) kc.landscape += s; else if (/football/i.test(folder)) kc.football += s; else kc.other += s; }
    const tot = {}; for (const key of Object.keys(cls)) tot[key] = 0.6 * cls[key] + 0.4 * kc[key];
    const girl = (f.g.get('1girl') || 0) + (f.g.get('solo') || 0) * 0 ; if (girl > 0.6) tot.woman += 0.1;
    const [best] = Object.entries(tot).sort((a, b) => b[1] - a[1]);
    const cos = zsGroup(emb, PH.cosplay);
    const cosplayP = cos ? cos[0] + cos[1] : 0;
    const names = { landscape: 'Photographs (Environments & Landscapes)', other: 'Photographs (People, Objects & Other Stuff)', man: 'Photographs (People, Objects & Other Stuff)', football: 'Football', woman: cosplayP >= 0.5 ? 'Real/Images/Cosplay' : 'Real/Images/General' };
    return { n: names[best[0]], s: clamp(best[1]), why: `photo of ${best[0] === 'other' ? 'an object or scene' : best[0]}${best[0] === 'woman' ? (cosplayP >= 0.5 ? ' (cosplay)' : ' (not cosplay)') : ''}` };
  };

  const videoFlow = (f, emb, isReal) => {
    const c = zsGroup(emb, PH.video) || [0, 0, 0, 0, 0, 0];
    const k = knn(emb, refs.filter((x) => x.kind === 'video'), 9, 'video');
    const cls = { game: c[0], funny: c[1], anime: c[2] + c[3], woman: c[4], real: c[5] };
    const kf = (name) => { let s = 0; for (const [folder, v] of k) if (folder.toLowerCase() === name) s += v; return s; };
    const kreal = [...k].filter(([fo]) => /^real\/videos\/cosplay/i.test(fo)).reduce((a, [, v]) => a + v, 0) + [...k].filter(([fo]) => /^real\/videos\/general/i.test(fo)).reduce((a, [, v]) => a + v, 0);
    const tot = { game: 0.6 * cls.game + 0.4 * kf('games - screenshots & videos'), funny: 0.6 * cls.funny + 0.4 * kf('gifs & vids'), anime: 0.6 * cls.anime + 0.4 * kf('animations & anime videos'), woman: 0.6 * cls.woman + 0.4 * kreal, real: cls.real };
    if (isReal === true) { tot.game = 0; tot.anime = 0; tot.woman += 0.15; tot.real += 0.15; }   // you / your folders say it is real life
    if (isReal === false) { tot.woman = 0; tot.real = 0; }
    const [best] = Object.entries(tot).sort((a, b) => b[1] - a[1]);
    const cos = zsGroup(emb, PH.cosplay); const cosplayP = cos ? cos[0] + cos[1] : 0;
    const names = { game: 'Games - Screenshots & Videos', funny: 'Gifs & Vids', real: 'Gifs & Vids', anime: 'Animations & Anime Videos', woman: cosplayP >= 0.5 ? 'Real/Videos/Cosplay' : 'Real/Videos/General' };
    if (best[1] < 0.25) return { n: 'Gifs & Vids', s: best[1], why: 'default for videos' };
    return { n: names[best[0]], s: clamp(best[1]), why: `video looks like: ${best[0]}` };
  };

  let done = 0;
  const total = files.length;
  // work in slices of about 25 ms and let the app answer clicks in between
  for (let s = 0; s < files.length;) {
    const t0 = Date.now(); let e = s;
    db.tx(() => {
      for (; e < files.length && (e === s || Date.now() - t0 < 25); e++) {
        const r = files[e];
        const f = parseFile(r); const emb = r.emb ? fromBlob(r.emb) : null;
        const rated = rateFile(r, f, emb, L, th); const rating = rated.rating; let realWhy = '';
        let main = null, lane = 'unsorted', series = null, alt = [], setId = null, fallback = null, fScore = null;
        if (emb) {
          // photo / video of real life, or art?
          const op = C.opinions(emb, classify.mapOf(r.jtags), photoEmb);
          let pReal = classify.finalP(op, realModel); let by = realModel;
          if (pReal == null) pReal = 0;
          if (labelOf.has(r.fp)) { pReal = labelOf.get(r.fp) ? 1 : 0; by = 'you'; }
          const isReal = pReal >= photoAt;
          const realness = isReal ? 'real' : 'art';
          if (realness !== r.realness || r.real_by !== by) realChanged.push(r.id);
          updReal.run(realness, op.clip ?? null, op.joytag ?? null, by, r.id);
          realWhy = by === 'you' ? ' (you marked it)' : ` (${modelName[by] || by} ${Math.round(pReal * 100)}% real life)`;
          if (r.kind === 'video') { const v = videoFlow(f, emb, isReal); main = v; main.why += realWhy; lane = 'video'; }
          else if (isReal) { main = photoFlow(f, emb, r); main.why += realWhy; lane = 'photo'; }
          else {
            const a = artFlow(f, emb, r, false);
            main = { n: a.claim.n, s: a.claim.s, why: a.claim.why }; lane = a.claim.n ? 'art' : 'unsorted'; series = a.series;
            alt = a.top.map((x) => ({ folder: x.n, score: +x.s.toFixed(2) }));
            if (a.unmappedSeries) { series = a.unmappedSeries; const u = unmapped.get(series) || { n: 0 }; u.n++; unmapped.set(series, u); }
          }
        } else { main = { n: null, s: 0, why: 'no embedding' }; }
        let folder = main.n, score = main.s, reason = main.why;
        // overrides, each keeping the normal choice as the fallback
        const q = r.kind === 'image' ? assessRow(r, settings.quality) : { flagged: false, reasons: [] };
        if (dupeLoser.has(r.id)) { fallback = folder; fScore = score; folder = settings.dupesFolder; lane = 'dupe'; reason = 'duplicate of a better copy'; score = 1; }
        else if (q.flagged && settings.quality.enabled !== false) { fallback = folder; fScore = score; folder = settings.lowQualityFolder; lane = 'lowq'; reason = q.reasons.join(', '); score = 1; }
        else if (setOf.has(r.id) && setOf.get(r.id).state !== 'rejected') { const st = setOf.get(r.id); fallback = folder; fScore = score; folder = `Connected Art/${st.name}`; lane = 'set'; reason = `part of set "${st.name}"`; score = 1; setId = st.id; }
        upsert.run(r.id, lane, folder, score == null ? null : +score.toFixed(3), reason, lane === 'set' ? 'general' : rating, fallback, fScore == null ? null : +fScore.toFixed(3), fallback ? rating : null, JSON.stringify(alt), series, setId, Date.now());
      }
    });
    s = e; done = s;
    if (onProgress) onProgress({ phase: 'decide', done, total });
    await new Promise((r) => setImmediate(r));
  }
  if (realChanged.length) for (let i = 0; i < realChanged.length; i += 400) tagsMod.fill(realChanged.slice(i, i + 400)); // the picture's tags follow its new art / real side
  return { total, realModel, scoreboard: sb, unmapped: [...unmapped].map(([series, v]) => ({ series, n: v.n })) };
}

module.exports = { decideAll, ratingFolder, knn, promptEmbeddings };
