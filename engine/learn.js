'use strict';
// Learns two things from YOUR library instead of guessing: "is this a real photo/video or art?" and "is it general / NSFW / Very?".
// Training data: your example folders (their folder tells the answer), plus every correction you make in the app.
// The model is a small logistic regression on [CLIP picture embedding + tagger ratings + a few tag scores]; it trains in seconds.
const path = require('path');
const db = require('./db');
const fromBlob = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const { normTag } = require('./models/wd14');

const NSFW_TAGS = ['pussy', 'penis', 'sex', 'vaginal', 'anal', 'fellatio', 'cum', 'cum in pussy', 'cumshot', 'ejaculation', 'spread pussy', 'uncensored', 'erection', 'testicles', 'oral', 'paizuri', 'handjob', 'hetero', 'nipples', 'anus', 'clitoris', 'semen', 'penetration', 'sex from behind', 'missionary', 'cowgirl position', 'bukkake', 'fingering', 'masturbation', 'censored', 'mosaic censoring', 'bar censor', 'pussy juice', 'spread legs', 'nude', 'completely nude', 'topless', 'bottomless', 'areolae', 'breasts out', 'no panties', 'no bra', 'cameltoe', 'pubic hair', 'panties', 'underwear', 'lingerie', 'bra', 'bikini', 'swimsuit', 'cleavage', 'large breasts', 'huge breasts', 'underboob', 'sideboob', 'naked', 'covered nipples', 'see-through', 'groin', 'ass', 'butt crack', 'thong', 'bare breasts', 'pantyshot', 'upskirt', 'micro bikini', 'slingshot swimsuit', 'nipple slip', 'naked towel', 'naked apron', 'navel', 'thighs', 'shirtless', 'bondage', 'bdsm', 'tentacles', 'ahegao', 'open mouth', 'sweat', 'blush'];
const REAL_TAGS = ['realistic', 'photorealistic', 'photo (medium)', 'real life', '3d', 'monochrome', 'greyscale', 'lips', 'solo', '1girl', '1boy', 'blurry', 'depth of field', 'blurry background', 'looking at viewer', 'portrait', 'outdoors', 'indoors', 'sunglasses', 'no humans', 'sketch', 'traditional media', 'painting (medium)', 'watercolor (medium)', 'pixel art', 'comic', 'text focus', 'scenery', 'cosplay', 'wig', 'real world location', 'lens flare'];

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

function featNsfw(emb, r, g) {
  const x = new Float32Array(emb.length + 4 + NSFW_TAGS.length);
  x.set(emb, 0); let o = emb.length;
  x[o++] = r.general || 0; x[o++] = r.sensitive || 0; x[o++] = r.questionable || 0; x[o++] = r.explicit || 0;
  for (const t of NSFW_TAGS) x[o++] = g.get(t) || 0;
  return x;
}
function featReal(emb, r, g) {
  const x = new Float32Array(emb.length + 4 + REAL_TAGS.length);
  x.set(emb, 0); let o = emb.length;
  x[o++] = r.general || 0; x[o++] = r.sensitive || 0; x[o++] = r.questionable || 0; x[o++] = r.explicit || 0;
  for (const t of REAL_TAGS) x[o++] = g.get(t) || 0;
  return x;
}

// ---------- logistic regression (softmax) with Adam ----------
function train(X, y, K, w, opts = {}) {
  const N = X.length, D = X[0].length;
  const mean = new Float32Array(D), sd = new Float32Array(D);
  for (const x of X) for (let j = 0; j < D; j++) mean[j] += x[j] / N;
  for (const x of X) for (let j = 0; j < D; j++) { const d = x[j] - mean[j]; sd[j] += d * d / N; }
  for (let j = 0; j < D; j++) sd[j] = Math.sqrt(sd[j]) + 1e-3;
  const Z = X.map((x) => { const z = new Float32Array(D); for (let j = 0; j < D; j++) z[j] = (x[j] - mean[j]) / sd[j]; return z; });
  const W = Array.from({ length: K }, () => new Float32Array(D)), b = new Float32Array(K);
  const mW = Array.from({ length: K }, () => new Float32Array(D)), vW = Array.from({ length: K }, () => new Float32Array(D)), mb = new Float32Array(K), vb = new Float32Array(K);
  const epochs = opts.epochs || 40, lr = opts.lr || 0.01, l2 = opts.l2 ?? 0.01, BS = 64;
  const idx = Array.from({ length: N }, (_, i) => i);
  let step = 0, seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const probs = new Float32Array(K);
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (let s = 0; s < N; s += BS) {
      const gW = Array.from({ length: K }, () => new Float32Array(D)), gb = new Float32Array(K);
      const bi = idx.slice(s, s + BS);
      for (const i of bi) {
        const z = Z[i]; let m = -1e9;
        for (let k = 0; k < K; k++) { let a = b[k]; const Wk = W[k]; for (let j = 0; j < D; j++) a += Wk[j] * z[j]; probs[k] = a; if (a > m) m = a; }
        let sum = 0; for (let k = 0; k < K; k++) { probs[k] = Math.exp(probs[k] - m); sum += probs[k]; }
        for (let k = 0; k < K; k++) {
          const g = ((probs[k] / sum) - (k === y[i] ? 1 : 0)) * w[i] / bi.length; gb[k] += g;
          const gk = gW[k]; for (let j = 0; j < D; j++) gk[j] += g * z[j];
        }
      }
      step++;
      const c1 = 1 - Math.pow(0.9, step), c2 = 1 - Math.pow(0.999, step);
      for (let k = 0; k < K; k++) {
        for (let j = 0; j < D; j++) { const g = gW[k][j] + l2 * W[k][j]; mW[k][j] = 0.9 * mW[k][j] + 0.1 * g; vW[k][j] = 0.999 * vW[k][j] + 0.001 * g * g; W[k][j] -= lr * (mW[k][j] / c1) / (Math.sqrt(vW[k][j] / c2) + 1e-8); }
        mb[k] = 0.9 * mb[k] + 0.1 * gb[k]; vb[k] = 0.999 * vb[k] + 0.001 * gb[k] * gb[k]; b[k] -= lr * (mb[k] / c1) / (Math.sqrt(vb[k] / c2) + 1e-8);
      }
    }
  }
  return { W: W.map((a) => Array.from(a)), b: Array.from(b), mean: Array.from(mean), sd: Array.from(sd), K };
}
function predict(m, x) {
  const K = m.K, D = x.length, out = new Array(K);
  let mx = -1e9;
  for (let k = 0; k < K; k++) { let a = m.b[k]; const Wk = m.W[k]; for (let j = 0; j < D; j++) a += Wk[j] * ((x[j] - m.mean[j]) / m.sd[j]); out[k] = a; if (a > mx) mx = a; }
  let s = 0; for (let k = 0; k < K; k++) { out[k] = Math.exp(out[k] - mx); s += out[k]; }
  return out.map((v) => v / s);
}

// ---------- training data ----------
const realOfFolder = (f, rules) => {
  const n = String(f || '');
  if (/^(real|photographs|football)\b/i.test(n)) return 1;
  if (/^(gifs & vids)$/i.test(n)) return null;            // a mix of both: no lesson
  if (/^(average & lq|dupes|connected art)/i.test(n)) return null;
  if (rules && rules.folders && rules.folders[n]) return 0;
  if (/^(games - screenshots|animations & anime)/i.test(n)) return 0;
  return null;
};
const ratingOfPath = (p) => { const s = p.replace(/\\/g, '/').toLowerCase(); return /\/very(\/|$)/.test(s) ? 'very' : /\/nsfw(\/|$)/.test(s) ? 'nsfw' : 'general'; };

function parse(tags, rating) {
  let g = new Map(); try { g = new Map(JSON.parse(tags || '{}').g || []); } catch { /* none */ }
  let r = {}; try { r = typeof rating === 'string' ? JSON.parse(rating || '{}') : rating || {}; } catch { /* none */ }
  return { g, r };
}

function gather(settings, rules) {
  const d = db.get(); const S = [];
  for (const r of d.prepare(`select folder,path,tags,rating,v,label from refs where analyzed=1 and v is not null`).all()) {
    const { g, r: rt } = parse(r.tags, r.rating);
    S.push({ emb: fromBlob(r.v), g, r: rt, real: realOfFolder(r.folder, rules), nsfw: r.label || ratingOfPath(r.path), w: 1 });
  }
  const root = (settings.destinationRoot || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const lab = new Map(d.prepare('select fp,real from labels').all().map((r) => [r.fp, r.real]));
  const rows = d.prepare(`select f.fp,f.path,f.status,f.tags,f.rating_g,f.rating_s,f.rating_q,f.rating_e,e.v emb,s.user_rating,s.state from files f join emb e on e.file_id=f.id left join suggestions s on s.file_id=f.id where f.analyzed=1`).all();
  for (const f of rows) {
    const L = lab.get(f.fp);
    let real = L === undefined || L === null ? null : L, wReal = 3, nsfw = null, wN = 1;
    if (f.user_rating) { nsfw = f.user_rating; wN = 3; }
    if (f.status === 'moved') { // you approved it into that folder: that is a (weaker) lesson
      const p = f.path.replace(/\\/g, '/'); const low = p.toLowerCase();
      if (root && low.startsWith(root + '/')) { const rel = p.slice(root.length + 1); const top = rel.split('/')[0]; if (real === null) { const rr = realOfFolder(top, rules); if (rr !== null) { real = rr; wReal = 1; } } if (nsfw === null) { nsfw = ratingOfPath(rel); wN = 1; } }
    }
    if (real === null && nsfw === null) continue;
    const { g } = parse(f.tags, null);
    S.push({ emb: fromBlob(f.emb), g, r: { general: f.rating_g, sensitive: f.rating_s, questionable: f.rating_q, explicit: f.rating_e }, real, nsfw, w: real !== null ? wReal : wN, wReal, wN });
  }
  return S;
}

function split(list) { const tr = [], va = []; list.forEach((x, i) => (i % 5 === 0 ? va : tr).push(x)); return [tr, va]; }
function weights(ys, K, ws) { const c = new Array(K).fill(0); ys.forEach((y, i) => { c[y] += ws[i]; }); const tot = c.reduce((a, b) => a + b, 0); return ys.map((y, i) => ws[i] * Math.min(8, tot / (K * Math.max(1, c[y])))); }

function fitOne(samples, feat, label, K, wkey) {
  let use = samples.filter((s) => label(s) !== null && label(s) !== undefined);
  const counts = new Array(K).fill(0); use.forEach((s) => { counts[label(s)]++; });
  const CAP = 3000; // keep training quick: at most this many per class, evenly spread
  if (use.length > CAP * K) { const by = Array.from({ length: K }, () => []); use.forEach((s) => by[label(s)].push(s)); use = []; for (const l of by) { const st = Math.max(1, l.length / CAP); for (let i = 0; i < Math.min(l.length, CAP); i++) use.push(l[Math.floor(i * st)]); } }
  const ok = counts.every((c) => c >= 15) && use.length >= 60;
  if (!ok) return { model: null, counts, n: use.length };
  const run = (set) => { const X = set.map((s) => feat(s.emb, s.r, s.g)), y = set.map((s) => label(s)); return train(X, y, K, weights(y, K, set.map((s) => s[wkey] || 1))); };
  const [tr, va] = split(use);
  const mv = run(tr); let hit = 0; const per = new Array(K).fill(0), pn = new Array(K).fill(0);
  for (const s of va) { const p = predict(mv, feat(s.emb, s.r, s.g)); const k = p.indexOf(Math.max(...p)); const y = label(s); pn[y]++; if (k === y) { hit++; per[y]++; } }
  const model = run(use);
  return { model, counts, n: use.length, accuracy: va.length ? hit / va.length : null, recall: per.map((v, i) => (pn[i] ? v / pn[i] : null)) };
}

// Returns { nsfw, real } predictors (or null when there is not enough to learn from) and a summary for the UI.
function prepare(settings, rules) {
  const d = db.get();
  const sig = JSON.stringify([d.prepare(`select count(*) c from refs where analyzed=1`).get().c, d.prepare('select count(*) c from labels').get().c, d.prepare(`select count(*) c from suggestions where user_rating is not null`).get().c, d.prepare(`select count(*) c from files where status='moved'`).get().c, Object.keys((rules && rules.folders) || {}).length]);
  let cache = db.kvGet('learned', null);
  if (!cache || cache.sig !== sig) {
    const S = gather(settings, rules);
    const nsfw = fitOne(S, featNsfw, (s) => (s.nsfw === 'very' ? 2 : s.nsfw === 'nsfw' ? 1 : s.nsfw === 'general' ? 0 : null), 3, 'wN');
    let nsfw2 = null;
    if (!nsfw.model) { // not enough "Very" examples: learn general vs NSFW only
      const two = fitOne(S, featNsfw, (s) => (s.nsfw === 'very' || s.nsfw === 'nsfw' ? 1 : s.nsfw === 'general' ? 0 : null), 2, 'wN'); nsfw2 = two;
    }
    const real = fitOne(S, featReal, (s) => s.real, 2, 'wReal');
    cache = { sig, ts: Date.now(), nsfw: nsfw.model ? { ...nsfw, kind: 3 } : nsfw2 && nsfw2.model ? { ...nsfw2, kind: 2 } : { model: null, counts: nsfw.counts, n: nsfw.n }, real: { ...real } };
    db.kvSet('learned', cache);
  }
  const mk = (c, feat) => (c && c.model ? (emb, r, g) => predict(c.model, feat(emb, r, g)) : null);
  return {
    nsfw: mk(cache.nsfw, featNsfw), nsfwKind: cache.nsfw && cache.nsfw.kind, real: mk(cache.real, featReal),
    info: { ts: cache.ts, nsfw: { trained: !!(cache.nsfw && cache.nsfw.model), n: cache.nsfw && cache.nsfw.n, counts: cache.nsfw && cache.nsfw.counts, accuracy: cache.nsfw && cache.nsfw.accuracy, kind: cache.nsfw && cache.nsfw.kind }, real: { trained: !!cache.real.model, n: cache.real.n, counts: cache.real.counts, accuracy: cache.real.accuracy } },
  };
}

// Rule-of-thumb rating used until there is enough to learn from: ratings from the tagger plus tell-tale tags.
const VERY_TAGS = ['pussy', 'penis', 'sex', 'vaginal', 'anal', 'fellatio', 'cum', 'cum in pussy', 'cumshot', 'ejaculation', 'spread pussy', 'uncensored', 'erection', 'testicles', 'oral', 'paizuri', 'handjob', 'anus', 'clitoris', 'semen', 'penetration', 'sex from behind', 'missionary', 'cowgirl position', 'bukkake', 'fingering', 'masturbation', 'pussy juice'];
const NSFW_ONLY = ['nipples', 'nude', 'completely nude', 'topless', 'bottomless', 'areolae', 'breasts out', 'no panties', 'no bra', 'cameltoe', 'pubic hair', 'naked', 'bare breasts', 'nipple slip', 'naked towel', 'naked apron', 'underboob', 'micro bikini', 'slingshot swimsuit', 'censored', 'mosaic censoring', 'bar censor', 'ahegao', 'bondage', 'bdsm', 'see-through'];
function heuristic(r, g) {
  const e = r.explicit || 0, q = r.questionable || 0, s = r.sensitive || 0;
  const tv = Math.max(0, ...VERY_TAGS.map((t) => g.get(t) || 0)), tn = Math.max(0, ...NSFW_ONLY.map((t) => g.get(t) || 0));
  return { nsfw: clamp(Math.max(e + q + 0.25 * s, tn * 0.95, tv)), very: clamp(Math.max(e, tv * 0.95)) };
}

module.exports = { prepare, heuristic, featNsfw, featReal, NSFW_TAGS, REAL_TAGS, train, predict };
