'use strict';
// Photo / video of real life, or art? Two independent opinions are kept for every picture, so you can see which one is right more often:
//   clip    = CLIP's zero-shot opinion ("a photograph taken with a camera" vs "an anime illustration"...) + what the learned examples say
//   joytag  = JoyTag's tags (photo, realistic, real life...) + what it learned from your examples
// Your own corrections (the P key) are the answer key: the Setup screen shows how often each opinion disagreed with you.
const db = require('./db');
const { PHOTO_N } = require('./prompts');
const learn = require('./learn');

const fromBlob = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const softmax = (xs, t = 100) => { const m = Math.max(...xs); const e = xs.map((x) => Math.exp((x - m) * t)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };

// tags that say "this is a photograph"
const REAL_TAG = /^(photo|photo \(medium\)|photograph|photorealistic|realistic|real life|irl|selfie|photo background|real world location|film grain|instant photo)$/;
function joyPrior(jt) { // jt: Map(name -> p)
  let best = 0, second = 0;
  for (const [n, p] of jt) if (REAL_TAG.test(n)) { if (p > best) { second = best; best = p; } else if (p > second) second = p; }
  return clamp(best + second * 0.25);
}
function clipPrior(emb, photoEmb) {
  if (!emb || !photoEmb || photoEmb.length < 3) return null;
  const sm = softmax(photoEmb.map((p) => dot(emb, p)));
  let s = 0; for (let i = 0; i < PHOTO_N; i++) s += sm[i]; return s;
}
const mapOf = (json) => { try { return new Map(JSON.parse(json || '{}').g || []); } catch { return new Map(); } };

// ---- learned opinions (small logistic regressions from your folders and corrections) ----
const realOfFolder = (f, rules) => {
  const n = String(f || '');
  if (/^(real|photographs|football)\b/i.test(n)) return 1;
  if (/^(gifs & vids)$/i.test(n)) return null;
  if (/^(average & lq|dupes|connected art)/i.test(n)) return null;
  if (rules && rules.folders && rules.folders[n]) return 0;
  if (/^(games - screenshots|animations & anime)/i.test(n)) return 0;
  return null;
};
function gather(settings, rules) {
  const d = db.get(); const S = [];
  for (const r of d.prepare(`select folder,jtags,v from refs where analyzed=1 and v is not null`).all()) {
    const real = realOfFolder(r.folder, rules); if (real === null) continue;
    S.push({ emb: fromBlob(r.v), jt: mapOf(r.jtags), real, w: 1 });
  }
  const root = (settings.destinationRoot || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const lab = new Map(d.prepare('select fp,real from labels').all().map((r) => [r.fp, r.real]));
  for (const f of d.prepare(`select f.fp,f.path,f.status,f.jtags,e.v emb from files f join emb e on e.file_id=f.id where f.analyzed=1`).all()) {
    let real = lab.has(f.fp) ? lab.get(f.fp) : null, w = 3;
    if (real === null && f.status === 'moved' && root) { const p = f.path.replace(/\\/g, '/'); if (p.toLowerCase().startsWith(root + '/')) { const rr = realOfFolder(p.slice(root.length + 1).split('/')[0], rules); if (rr !== null) { real = rr; w = 1; } } }
    if (real === null) continue;
    S.push({ emb: fromBlob(f.emb), jt: mapOf(f.jtags), real, w });
  }
  return S;
}
function fit(S, feat, minEach = 15) {
  const counts = [0, 0]; S.forEach((s) => { counts[s.real]++; });
  if (counts[0] < minEach || counts[1] < minEach) return { model: null, counts };
  const CAP = 3000; let use = S;
  if (S.length > CAP * 2) { use = []; for (const k of [0, 1]) { const l = S.filter((s) => s.real === k); const st = Math.max(1, l.length / CAP); for (let i = 0; i < Math.min(l.length, CAP); i++) use.push(l[Math.floor(i * st)]); } }
  const X = use.map(feat), y = use.map((s) => s.real);
  const cw = [use.length / (2 * Math.max(1, use.filter((s) => s.real === 0).length)), use.length / (2 * Math.max(1, use.filter((s) => s.real === 1).length))];
  const w = use.map((s, i) => s.w * Math.min(8, cw[y[i]]));
  const idx = use.map((_, i) => i); const va = idx.filter((i) => i % 5 === 0), tr = idx.filter((i) => i % 5 !== 0);
  const m1 = learn.train(tr.map((i) => X[i]), tr.map((i) => y[i]), 2, tr.map((i) => w[i]), { epochs: 30 });
  let hit = 0; for (const i of va) { const p = learn.predict(m1, X[i]); if ((p[1] >= 0.5 ? 1 : 0) === y[i]) hit++; }
  const model = learn.train(X, y, 2, w, { epochs: 30 });
  return { model, counts, n: use.length, accuracy: va.length ? hit / va.length : null };
}

// Everything needed to give the two opinions for a picture. Build once per run, then call opinions() per picture.
function prepare(settings, rules, refs) {
  const d = db.get();
  const sig = JSON.stringify([d.prepare('select count(*) c from refs where analyzed=1').get().c, d.prepare('select count(*) c from labels').get().c, d.prepare(`select count(*) c from files where status='moved'`).get().c, d.prepare(`select count(*) c from files where jtags is not null`).get().c > 0]);
  let cache = db.kvGet('classifier', null);
  if (!cache || cache.sig !== sig) {
    const S = gather(settings, rules);
    // vocabulary for the JoyTag model: tags seen often enough in the samples
    const freq = new Map(); for (const s of S) for (const [n, p] of s.jt) if (p >= 0.2) freq.set(n, (freq.get(n) || 0) + 1);
    const vocab = [...freq].filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1]).slice(0, 1500).map(([n]) => n);
    const idxOf = new Map(vocab.map((n, i) => [n, i]));
    const fJoy = (s) => { const x = new Float32Array(vocab.length); for (const [n, p] of s.jt) { const i = idxOf.get(n); if (i !== undefined) x[i] = p; } return x; };
    const fClip = (s) => s.emb;
    const clip = fit(S, fClip), joy = vocab.length >= 20 && S.some((s) => s.jt.size) ? fit(S, fJoy) : { model: null, counts: [0, 0] };
    cache = { sig, ts: Date.now(), vocab, clip, joy };
    db.kvSet('classifier', cache);
  }
  const idxOf = new Map((cache.vocab || []).map((n, i) => [n, i]));
  const vecJoy = (jt) => { const x = new Float32Array(cache.vocab.length); for (const [n, p] of jt) { const i = idxOf.get(n); if (i !== undefined) x[i] = p; } return x; };
  const kReal = (emb) => { // how many of the nearest example pictures sit in photo folders
    if (!refs || !refs.length) return 0; const top = [];
    for (const r of refs) { const s = dot(emb, r.v); if (top.length < 9) { top.push([s, r.real]); top.sort((a, b) => a[0] - b[0]); } else if (s > top[0][0]) { top[0] = [s, r.real]; top.sort((a, b) => a[0] - b[0]); } }
    let tot = 0, re = 0; for (const [s, rl] of top) { const w = Math.exp((s - 1) / 0.05); tot += w; re += w * rl; } return tot ? re / tot : 0;
  };
  return {
    info: { ts: cache.ts, clip: { trained: !!cache.clip.model, counts: cache.clip.counts, accuracy: cache.clip.accuracy }, joytag: { trained: !!cache.joy.model, counts: cache.joy.counts, accuracy: cache.joy.accuracy } },
    // the two opinions, each 0..1 (1 = real life)
    opinions(emb, jt, photoEmb) {
      let pc = clipPrior(emb, photoEmb); const kn = refs && refs.length ? kReal(emb) : null;
      if (pc === null && kn !== null) pc = kn; else if (pc !== null && kn !== null) pc = 1 - (1 - pc * 0.8) * (1 - kn * 0.85);
      if (cache.clip.model && emb) pc = 0.75 * learn.predict(cache.clip.model, emb)[1] + 0.25 * (pc ?? 0.5);
      let pj = jt && jt.size ? joyPrior(jt) : null;
      if (cache.joy.model && jt && jt.size) pj = 0.75 * learn.predict(cache.joy.model, vecJoy(jt))[1] + 0.25 * (pj ?? 0.5);
      return { clip: pc, joytag: pj };
    },
  };
}

// The scoreboard: only pictures you corrected count. A model "missed" when its opinion was on the other side of 0.5 from your answer.
function scoreboard(photoAt = 0.5) {
  const d = db.get();
  const rows = d.prepare(`select f.p_clip pc, f.p_joy pj, l.real real from labels l join files f on f.fp=l.fp where f.analyzed=1`).all();
  const sb = { corrections: rows.length, clip: { checked: 0, wrong: 0 }, joytag: { checked: 0, wrong: 0 } };
  for (const r of rows) for (const [k, p] of [['clip', r.pc], ['joytag', r.pj]]) { if (p == null) continue; sb[k].checked++; if ((p >= photoAt ? 1 : 0) !== r.real) sb[k].wrong++; }
  for (const k of ['clip', 'joytag']) sb[k].accuracy = sb[k].checked ? 1 - sb[k].wrong / sb[k].checked : null;
  return sb;
}

// Which opinion to use. 'auto' = the one you have had to correct least once there is enough to judge, otherwise both averaged.
function chooseModel(settings, sb) {
  const m = (settings.classify || {}).model || 'auto';
  if (m !== 'auto') return m;
  if (sb.clip.checked >= 20 && sb.joytag.checked >= 20) return sb.joytag.wrong < sb.clip.wrong ? 'joytag' : sb.clip.wrong < sb.joytag.wrong ? 'clip' : 'both';
  return 'both';
}
function finalP(op, model) {
  const c = op.clip, j = op.joytag;
  if (model === 'clip') return c ?? j; if (model === 'joytag') return j ?? c;
  if (c == null) return j; if (j == null) return c; return (c + j) / 2;
}

module.exports = { realOfFolder, prepare, scoreboard, chooseModel, finalP, joyPrior, clipPrior, mapOf, REAL_TAG };
