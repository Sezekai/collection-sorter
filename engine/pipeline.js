'use strict';
// Orchestrates the long-running jobs and reports progress to the UI.
const EventEmitter = require('events');
const db = require('./db');
const settingsMod = require('./settings');
const { readCatalog, destinationChoices } = require('./catalog');
const { scanSources, scanReferences } = require('./scanner');
const { analyzeFiles, analyzeRefs } = require('./analyze');
const { findDupes, findSets } = require('./groups');
const { buildRules, ROUTED } = require('./rules');
const { decideAll } = require('./decide');
const models = require('./models');
const mover = require('./mover');
const reset = require('./reset');
const destFolders = require('./folders');
const { log } = require('./util');

const bus = new EventEmitter();
const state = { job: null, ctl: { paused: false, cancelled: false }, progress: null, models: null, modelError: null, message: '', queue: [], steps: null, gpu: null, last: null };
const JOB_LABELS = { analysis: 'Scan & tag files', learn: 'Learn from examples', decide: 'Re-run suggestions', apply: 'Move approved files', undo: 'Put files back', regroup: 'Re-detect sets & duplicates', rescan: 'Check for changes', download: 'Download models', retag: 'Tag again', relocate: 'Move data', diagnose: 'Diagnose' };
// the steps of a scan, each shown as Done / now / Queued (STANDARDS.md "Progress you can trust")
const STEP_OF = { scan: 'scan', refscan: 'learn', refs: 'learn', models: 'read', analyze: 'read', retag: 'read', dupes: 'dupes', sets: 'sets', decide: 'choose' };
const STEP_LABEL = { scan: 'Scan folders', learn: 'Learn from examples', read: 'Read and tag', dupes: 'Duplicates', sets: 'Connected sets', choose: 'Choose folders' };

// Every progress message also carries what is running it and how long it will take, worked out from the phase's own speed.
const pace = { phase: null, t0: 0, d0: 0, last: [] };
function emit(ev) {
  const now = Date.now();
  if (ev.total && ev.done != null && ev.phase !== 'download') {
    if (pace.phase !== ev.phase || ev.done < pace.d0) { pace.phase = ev.phase; pace.t0 = now; pace.d0 = ev.done; pace.last = []; }
    pace.last.push([now, ev.done]); while (pace.last.length > 12) pace.last.shift();
    const a = pace.last[0], b = pace.last[pace.last.length - 1];
    const recent = b[0] > a[0] ? (b[1] - a[1]) / ((b[0] - a[0]) / 1000) : 0;
    const overall = now > pace.t0 ? (ev.done - pace.d0) / ((now - pace.t0) / 1000) : 0;
    const rate = recent > 0 ? (recent * 0.6 + overall * 0.4) : overall;
    ev = { ...ev, elapsed: Math.round((now - pace.t0) / 1000), rate: rate > 0 ? +rate.toFixed(2) : null, eta: rate > 0 && ev.done < ev.total ? Math.round((ev.total - ev.done) / rate) : null };
  } else if (ev.phase === 'download' && ev.got != null) {   // downloads: bytes, speed and time left
    if (pace.phase !== 'download:' + (ev.file || '') || ev.got < pace.d0) { pace.phase = 'download:' + (ev.file || ''); pace.t0 = now; pace.d0 = ev.got; pace.last = []; }
    pace.last.push([now, ev.got]); while (pace.last.length > 12) pace.last.shift();
    const a = pace.last[0], b = pace.last[pace.last.length - 1]; const rate = b[0] > a[0] ? (b[1] - a[1]) / ((b[0] - a[0]) / 1000) : 0;
    ev = { ...ev, elapsed: Math.round((now - pace.t0) / 1000), rate: rate > 0 ? Math.round(rate) : null, eta: rate > 0 && ev.total ? Math.round((ev.total - ev.got) / rate) : null };
  } else if (pace.phase && ev.phase !== pace.phase) pace.phase = null;
  const mi = state.models;
  if (mi) ev = { ...ev, model: (mi.label || mi.key) + (mi.jt ? ' + JoyTag' : ''), device: mi.provider === 'dml' ? 'Graphics card (DirectML)' + (mi.gpu ? ': ' + mi.gpu : '') : mi.provider === 'cpu' ? 'Processor' : mi.provider };
  if (state.steps) { const cur = STEP_OF[ev.phase]; const i = state.steps.findIndex((x) => x.key === cur); if (i >= 0) state.steps.forEach((x, j) => { if (j < i && x.state !== 'skip') x.state = 'done'; else if (j === i) x.state = 'now'; }); if (ev.finished) state.steps.forEach((x) => { if (x.state !== 'skip') x.state = 'done'; }); ev = { ...ev, steps: state.steps.filter((x) => x.state !== 'skip').map((x) => ({ label: STEP_LABEL[x.key], state: x.state })) }; }
  if (state.gpu && (ev.phase === 'retag' || (STEP_OF[ev.phase] && ['learn', 'read'].includes(STEP_OF[ev.phase])))) ev = { ...ev, gpu: state.gpu };
  state.progress = ev; bus.emit('progress', ev);
}
function modelDir() { return models.modelDir(settingsMod.load(), settingsMod.DATA_DIR); }
const taggerKey = () => models.taggerKey((settingsMod.load().tagger || {}).model);
function joytagReady() { const f = models.missing(modelDir(), taggerKey(), true); return !f.some((x) => x.key === 'joy' || x.key === 'joytags'); }
const wantJoy = () => (settingsMod.load().classify || {}).useJoytag !== false;
function modelsReady() { return models.missing(modelDir(), taggerKey(), wantJoy()).length === 0; }

async function getModels() {
  if (state.models) return state.models;
  if (!modelsReady()) { const e = new Error('The AI models are not downloaded yet. Open Settings and press "Download models".'); e.code = 'models_missing'; throw e; }
  emit({ phase: 'models', note: 'Loading models (first time can take a minute)...' });
  const S0 = settingsMod.load(); if (process.env.CS_SAFE) S0.tagger = { ...(S0.tagger || {}), device: 'cpu' };   // safe mode: the graphics card stays off
  state.models = await models.loadModels(S0, modelDir());
  state.models.label = (models.TAGGERS[state.models.key] || {}).label || state.models.key;
  state.modelNote = state.models.note || '';
  if (state.modelNote) emit({ phase: 'models', note: state.modelNote });
  return state.models;
}
function dropModels() { try { models.releaseModels(state.models); } catch { /* gone */ } state.models = null; state.modelNote = ''; }

// one more tagger (to try it, or to tag pictures again with it); the chosen tagger comes with "Download the AI models"
function downloadTagger(key) {
  const k = models.TAGGERS[key] ? key : taggerKey();
  return job('download', async () => {
    const dl = require('./models/download'); const dir = modelDir(); require('./util').ensureDir(dir);
    for (const f of dl.taggerFiles(k)) if (!require('fs').existsSync(require('path').join(dir, f.dest))) await dl.downloadOne(f, dir, (p) => emit({ phase: 'download', ...p }));
    emit({ phase: 'download', note: 'done', finished: true }); return {};
  }, `Download ${models.TAGGERS[k].short}`);
}
function downloadModels() {
  return job('download', async () => {
    await models.ensureModels(modelDir(), taggerKey(), (p) => emit({ phase: 'download', ...p }), undefined, wantJoy());
    emit({ phase: 'download', note: 'done', finished: true }); return {};
  }, 'Download the AI models');
}

// destination subfolders ticked as targets get a rule of their own (they learn from the examples mapped to them)
function subRuleNames(cat, S) { return destinationChoices(cat, S).filter((x) => x.includes('/') && !/^real\//i.test(x) && !ROUTED.has(x.split('/')[0])); }
function currentRules() {
  const S = settingsMod.load();
  const cat = readCatalog(S.destinationRoot, S);
  const existing = db.kvGet('rules', null); const subs = subRuleNames(cat, S);
  destFolders.stashDropped(existing, new Set(cat.folders.filter((f) => !f.ignored && !ROUTED.has(f.name)).map((f) => f.name).concat(subs)));   // a folder that vanished keeps its rule until you say what happened
  destFolders.track(S, destinationChoices(cat, S));
  const rules = buildRules(cat.folders, existing, subs);
  db.kvSet('rules', rules);
  return { rules, cat };
}

function defaultRules() {
  const S = settingsMod.load();
  const cat = readCatalog(S.destinationRoot, S);
  return { rules: buildRules(cat.folders, null, subRuleNames(cat, S)), cat };
}

// One job runs at a time; anything started meanwhile waits in a queue (STANDARDS.md "A queue, not busy").
function busy() { return !!state.job; }
function queueInfo() { return state.queue.map((q) => ({ name: q.name, label: q.label })); }
function job(name, fn, label) {
  if (state.job) {
    if (state.job === name && !state.queue.length && name !== 'apply' && name !== 'undo') return Promise.resolve({ already: true });
    if (state.queue.some((q) => q.name === name) && name !== 'apply' && name !== 'undo') return Promise.resolve({ queued: true });
    return new Promise((resolve, reject) => { state.queue.push({ name, label: label || JOB_LABELS[name] || name, start: () => job(name, fn, label).then(resolve, reject), cancel: () => resolve({ cancelled: true }) }); bus.emit('queue', queueInfo()); });
  }
  state.job = name; state.ctl = { paused: false, cancelled: false }; state.message = ''; state.steps = null; state.last = null;
  const t0 = Date.now(); let result = null, error = null;
  bus.emit('job', { name, label: label || JOB_LABELS[name] || name, running: true, queue: queueInfo() });
  log(`Started: ${label || JOB_LABELS[name] || name}`);
  return (async () => {
    try { result = await fn(state.ctl); return result; }
    catch (e) { error = e; state.message = e.message; emit({ phase: 'error', note: e.message, code: e.code }); log.error('Job failed:', name, e.stack || e.message); throw e; }
    finally {
      const took = Math.round((Date.now() - t0) / 1000); const lbl = label || JOB_LABELS[name] || name;
      const text = error ? `${lbl} stopped: ${error.message}` : result && result.cancelled ? `${lbl} stopped. Finished work is kept.` : `Finished: ${lbl}${summary(name, result)} · took ${Math.floor(took / 60)}:${String(took % 60).padStart(2, '0')}`;
      state.last = { ok: !error, text, next: nextStep(name, result, error) };
      log(text);
      state.job = null; state.steps = null; stopGpuWatch();
      const nx = state.ctl.cancelled ? null : state.queue.shift();
      if (state.ctl.cancelled) { for (const q of state.queue.splice(0)) q.cancel(); }
      bus.emit('job', { name, running: false, result: state.last, queue: queueInfo(), error: error ? error.message : null });
      if (nx) setImmediate(nx.start);
    }
  })();
}
function summary(name, r) {
  if (!r || typeof r !== 'object') return '';
  const parts = [];
  if (r.files != null) parts.push(`${r.files} files`);
  if (r.suggested != null) parts.push(`${r.suggested} suggestions`);
  if (r.moved != null) parts.push(`${r.moved} moved`); if (r.failed) parts.push(`${r.failed} failed`);
  if (r.undone != null) parts.push(`${r.undone} put back`);
  if (r.newFiles != null) parts.push(`${r.newFiles} new files, ${r.newExamples || 0} new examples`);
  return parts.length ? ' · ' + parts.join(', ') : '';
}
function nextStep(name, r, err) {
  if (err) return { label: 'Open the log', route: 'log' };
  if (['analysis', 'decide', 'rescan'].includes(name)) return { label: 'Review', route: 'review' };
  if (name === 'learn') return { label: 'What it knows', route: 'knows' };
  return null;
}
// GPU load and memory while AI work runs (every 2 s, from nvidia-smi when there is an NVIDIA card)
let gpuTimer = null;
function startGpuWatch() {
  if (gpuTimer) return; const mi = state.models;
  if (mi && mi.provider === 'cpu') { state.gpu = { cpu: true }; return; }
  const poll = () => require('./gpu').sample().then((g) => { if (gpuTimer) state.gpu = g || (mi && mi.gpu ? { name: mi.gpu } : null); }).catch(() => {});
  gpuTimer = setInterval(poll, 2000); poll();
}
function stopGpuWatch() { clearInterval(gpuTimer); gpuTimer = null; state.gpu = null; }
function cancelAll() { state.ctl.cancelled = true; for (const q of state.queue.splice(0)) q.cancel(); bus.emit('queue', queueInfo()); }

// The whole pipeline: scan -> learn from examples -> read every file -> duplicates and sets -> suggestions.
function runAnalysis(opts = {}) {
  const nm = opts.files === false ? 'learn' : 'analysis';
  const lbl = opts.files === false ? (opts.refsOpts && opts.refsOpts.relearn ? 'Re-learn examples' : 'Learn from examples') : opts.refs === false ? 'Scan & tag files' : 'Scan, learn & tag';
  return job(nm, async (ctl) => {
    const S = settingsMod.load();
    db.open();
    mover.recover();
    state.steps = ['scan', 'learn', 'read', 'dupes', 'sets', 'choose'].map((key) => ({ key, state: (key === 'learn' && (opts.refs === false || !(S.referenceRoots || []).length)) || (opts.files === false && !['scan', 'learn'].includes(key)) ? 'skip' : 'queued' }));
    if (!db.kvGet('catalogChoices', null)) { try { db.kvSet('catalogChoices', destinationChoices(readCatalog(S.destinationRoot, S), S)); } catch { /* no destination yet */ } }
    emit({ phase: 'scan', note: 'Looking for files...' });
    reset.cleanup(S);
    db.get().exec(`update files set analyzed=0, err=null where analyzed=2 and status='new'; update refs set analyzed=0 where analyzed=2`); // unreadable ones get another try
    if (opts.files !== false && opts.scan !== false) await scanSources(S, emit, ctl);
    if (ctl.cancelled) return { cancelled: true };
    if (opts.refs !== false && (S.referenceRoots || []).length) await scanReferences(S, emit, ctl);
    if (ctl.cancelled) return { cancelled: true };
    const m = await getModels(); startGpuWatch();
    if (opts.refs !== false) { await analyzeRefs(m, S, ctl, emit, opts.refsOpts || {}); if (!ctl.cancelled && missingSortTags('refs')) await retagWork({ scope: 'missingRefs' }, ctl); }
    if (ctl.cancelled) return { cancelled: true };
    if (opts.files === false) { emit({ phase: 'done', note: 'Learning finished', finished: true }); return { learned: true }; }
    await analyzeFiles(m, S, ctl, emit);
    if (ctl.cancelled) return { cancelled: true };
    if (missingSortTags('files')) await retagWork({ scope: 'missing' }, ctl);   // pictures read before by another tagger get the chosen tagger's tags too
    if (ctl.cancelled) return { cancelled: true };
    if (!db.get().prepare(`select 1 x from files where status='new' and analyzed=0 limit 1`).get()) db.kvSet('taggerUsed', m.key || taggerKey());
    emit({ phase: 'dupes', note: 'Looking for duplicates...' });
    await findDupes(S, emit);
    emit({ phase: 'sets', note: 'Looking for connected sets...' });
    findSets(S);
    const r = await decide(opts); db.kvSet('changes', null); return r;
  }, lbl);
}

// Look for new files, new example files / folders, and added / renamed / deleted destination folders. Quick: nothing is read by the AI.
const runRescan = (opts = {}) => job('rescan', async (ctl) => {   // opts.examples === false: only the folders to sort and the destination (the examples library is big and is only looked at when you ask)
  const S = settingsMod.load(); db.open(); reset.cleanup(S);
  emit({ phase: 'scan', note: 'Checking for new files and folders...' });
  const d = db.get(); const folders = () => new Set(d.prepare('select distinct folder f from refs').all().map((r) => r.f));
  const before = folders(); let newFiles = 0, newExamples = 0;
  if ((S.sources || []).length) newFiles = (await scanSources(S, emit, ctl, { full: !!opts.full })).added;
  if (ctl.cancelled) return { cancelled: true };
  if (opts.examples !== false && (S.referenceRoots || []).length) newExamples = (await scanReferences(S, emit, ctl, { full: !!opts.full })).added;
  const newExampleFolders = [...folders()].filter((f) => !before.has(f));
  const cat = readCatalog(S.destinationRoot, S); const choices = destinationChoices(cat, S);
  destFolders.stashDropped(db.kvGet('rules', null), new Set(cat.folders.filter((f) => !f.ignored && !ROUTED.has(f.name)).map((f) => f.name).concat(subRuleNames(cat, S))));
  const { added: destAdded, removed: destRemoved } = destFolders.track(S, choices);
  const old = db.kvGet('changes', null) || { destAdded: [], destRemoved: [], newExampleFolders: [] };
  const uniq = (a) => [...new Set(a)];
  const changes = { ts: Date.now(), destAdded: uniq([...(old.destAdded || []), ...destAdded]), destRemoved: uniq([...(old.destRemoved || []), ...destRemoved]), newExampleFolders: uniq([...(old.newExampleFolders || []), ...newExampleFolders]) };
  db.kvSet('changes', changes); db.kvSet('lastRescan', { ts: Date.now(), newFiles, newExamples });
  currentRules();                                   // new / renamed / deleted destination folders get (or lose) their rule
  if (destAdded.length || destRemoved.length) { emit({ phase: 'decide', note: 'Destination folders changed — choosing folders again...' }); await decide({}); }
  emit({ phase: 'done', note: `Found ${newFiles} new file(s) and ${newExamples} new example(s)`, finished: true });
  return { newFiles, newExamples, ...changes };
});

// Tagging again with another tagger: only the tagger runs (no CLIP, no metrics, nothing else is re-read). The new tags are kept
// as that tagger's own set next to the others; when it is the tagger the sorting uses, the pictures' sorting tags switch to it.
function markRetag() { return 0; }   // (a new tagger no longer means reading every file again)
function missingSortTags(kind = 'files') {
  const key = taggerKey(); const d = db.get();
  return kind === 'refs' ? d.prepare(`select count(*) n from refs r where r.analyzed=1 and not exists (select 1 from ref_tagsets t where t.ref_id=r.id and t.tagger=?)`).get(key).n
    : d.prepare(`select count(*) n from files f where f.analyzed=1 and f.status='new' and coalesce(f.realness,'art')='art' and not exists (select 1 from tagsets t where t.file_id=f.id and t.tagger=?)`).get(key).n;
}
const retagCount = () => missingSortTags('files');
// which = { tagger, ids?: [file ids], scope?: 'files' | 'refs' | 'missing' (files without the sorting tagger's tags) | 'missingRefs' }
async function retagWork(which, ctl) {
  const S = settingsMod.load(); const d = db.get(); const key = which.tagger || taggerKey();
  const isJoy = key === 'joytag'; const sortK = taggerKey();
  let rows;
  if (which.ids && which.ids.length) { const ids = which.ids.map(Number); rows = []; for (let i = 0; i < ids.length; i += 400) { const c = ids.slice(i, i + 400); rows.push(...d.prepare(`select id,path,kind,ext,size from files where id in (${c.map(() => '?').join(',')}) and status in ('new','moved')`).all(...c)); } }
  else if (which.scope === 'refs' || which.scope === 'missingRefs') rows = d.prepare(`select r.id,r.path,r.kind from refs r where r.analyzed=1 ${which.scope === 'missingRefs' ? 'and not exists (select 1 from ref_tagsets t where t.ref_id=r.id and t.tagger=?)' : ''} order by r.id`).all(...(which.scope === 'missingRefs' ? [key] : []));
  else rows = d.prepare(`select f.id,f.path,f.kind,f.ext,f.size from files f where f.analyzed=1 and f.status='new' ${which.scope === 'missing' ? "and coalesce(f.realness,'art')='art' and not exists (select 1 from tagsets t where t.file_id=f.id and t.tagger=?)" : ''} order by f.id`).all(...(which.scope === 'missing' ? [key] : []));
  const refs = which.scope === 'refs' || which.scope === 'missingRefs';
  const total = rows.length; if (!total) return { tagged: 0, failed: 0 };
  const label = isJoy ? 'JoyTag' : (models.TAGGERS[key] || {}).short || key;
  emit({ phase: 'retag', done: 0, total, note: `Loading ${label}…` });
  let tagger = null, own = false; startGpuWatch();
  if (isJoy || (state.models && state.models.key === key) || (!state.models && key === sortK)) {
    const m = await getModels();
    if (isJoy) { if (!m.jt) throw new Error('JoyTag is not loaded (it may be turned off, or not downloaded).'); tagger = m.jt; }
    else if (m.key === key) tagger = m.wd;
  }
  if (!tagger) {
    // another tagger: put the loaded models away first so it has the whole graphics card (PixAI alone needs ~5 GB of it); they load again when next needed
    const like = state.models ? { provider: state.models.wd && state.models.wd.provider, deviceId: state.models.wd && state.models.wd.deviceId } : null;
    dropModels();
    tagger = await models.loadTagger(S, modelDir(), key, like); own = true;
  }
  const slowNote = tagger.provider === 'cpu' && (models.SPECS[key] || {}).cpuRamGB ? ' on the processor: the graphics card could not run it, so expect about 40 s a picture' : '';
  const { load, mergeFrames } = require('./analyze'); const tagsMod = require('./tags');
  let done = 0, failed = 0, firstErr = ''; const touched = [];
  try {
    for (let s = 0; s < rows.length; s += 8) {
      while (ctl.paused && !ctl.cancelled) await new Promise((r) => setTimeout(r, 300));
      if (ctl.cancelled) break;
      const chunk = rows.slice(s, s + 8);
      const res = await require('./util').pool(chunk, 4, async (row) => {
        try { const { works } = await load({ ...row, ext: row.ext || require('path').extname(row.path).toLowerCase(), size: row.size || 0 }, S); const ts = await tagger.tag(works); return { row, t: ts.length === 1 ? ts[0] : mergeFrames(ts) }; }
        catch (e) { return { row, error: e.message }; }
      });
      db.tx(() => { for (const r of res) { if (r.error) { failed++; if (!firstErr) firstErr = r.error; continue; } if (refs) tagsMod.storeRefSet(r.row.id, key, r.t); else { tagsMod.storeSet(r.row.id, key, r.t); touched.push(r.row.id); } } });
      if (!refs) tagsMod.applyActive(res.filter((r) => !r.error).map((r) => r.row.id), S);   // as it goes, so the lists update and nothing big is left for the end
      done += chunk.length;
      emit({ phase: 'retag', done, total, failed, note: `Tagging with ${label}${slowNote}${failed ? ` (first problem: ${firstErr.slice(0, 100)})` : ''}` });
    }
  } finally { if (own) tagger.release(); }
  if (refs) { if (key === sortK) { await tagsMod.applyActiveRefs(S); db.kvSet('learned', null); } }
  else if (touched.length) { if ((key === sortK || isJoy) && !ctl.cancelled) await decide({ onlyIds: touched }); }
  emit({ phase: 'done', note: `Tagged ${done - failed} with ${label}`, finished: true });
  return { tagged: done - failed, failed, tagger: key };
}
const runRetag = (which) => job('retag', (ctl) => retagWork(which, ctl), `Tag again with ${which.tagger === 'joytag' ? 'JoyTag' : (models.TAGGERS[which.tagger || taggerKey()] || {}).short || which.tagger}`);
// The tagger the sorting uses changed: switch every picture to that tagger's tags where it has them (instant), re-learn, choose folders again.
async function switchSortTagger() {
  const S = settingsMod.load(); const tagsMod = require('./tags');
  const ids = db.get().prepare(`select file_id from tagsets group by file_id`).all().map((r) => r.file_id);
  for (let i = 0; i < ids.length; i += 10) { tagsMod.applyActive(ids.slice(i, i + 10), S); await new Promise((r) => setTimeout(r, 2)); }   // in small slices: the app keeps answering
  const nr = await tagsMod.applyActiveRefs(S); db.kvSet('learned', null);
  log(`Sorting tags now come from ${taggerKey()}: ${ids.length} pictures, ${nr} examples switched; ${missingSortTags('files')} pictures and ${missingSortTags('refs')} examples have no tags from it yet`);
  if (ids.length && !state.job) runDecide().catch(() => {});   // nothing to re-sort on a fresh install
}

async function decide(opts = {}) {
  const S = settingsMod.load();
  const { rules, cat } = currentRules();
  const m = await getModels().catch(() => null);
  emit({ phase: 'decide', note: 'Choosing folders...' });
  const r = await decideAll(S, rules, cat, { embedTexts: m ? (t) => m.clip.embedTexts(t) : null, onlyIds: opts.onlyIds || null }, emit);
  emit({ phase: 'done', note: 'Ready to review', finished: true });
  return r;
}
const runDecide = (opts) => job('decide', () => decide(opts || {}));

const runApply = (opts) => job('apply', async () => { const r = await mover.applyApproved(settingsMod.load(), opts, (ev) => { if (ev.total >= 20) emit(ev); }); if (r.moved >= 20 || r.failed) emit({ phase: 'done', note: `Moved ${r.moved} file(s)${r.failed ? `, ${r.failed} failed` : ''}`, finished: true }); return r; });
const runUndo = (kind, arg) => job('undo', async () => {
  const f = kind === 'batch' ? mover.undoBatch : kind === 'file' ? mover.undoFile : mover.undoFolder;
  const r = await f(arg, emit); emit({ phase: 'done', note: `Put back ${r.undone} file(s)`, finished: true }); return r;
});
// Approving moves files straight away. While another job runs (a scan, say) the move waits and happens when it ends.
state.applyQueued = false;
async function autoApply(ids) {
  if (state.job) { state.applyQueued = true; return { queued: true, moved: 0 }; }
  if (ids && ids.length > 300) { runApply({ ids, note: 'Approved' }).catch(() => {}); return { started: true, moved: 0 }; }
  const r = await runApply({ ids, note: 'Approved' }); return { moved: r.moved, failed: r.failed };
}
bus.on('job', (e) => { if (!e.running && state.applyQueued) { state.applyQueued = false; setImmediate(() => runApply({ note: 'Approved' }).catch(() => {})); } });

const runRegroup = () => job('regroup', async () => { const S = settingsMod.load(); emit({ phase: 'dupes', note: 'Looking for duplicates...' }); await findDupes(S, emit); emit({ phase: 'sets', note: 'Looking for connected sets...' }); findSets(S); return decide(); });
module.exports = { runRetag, switchSortTagger, missingSortTags, busy, queueInfo, cancelAll, JOB_LABELS, startGpuWatch, runRescan, joytagReady, retagCount, taggerKey, downloadTagger, autoApply, defaultRules, runRegroup, reset, bus, state, emit, runAnalysis, runDecide, runApply, runUndo, downloadModels, getModels, dropModels, modelsReady, modelDir, currentRules, job };
