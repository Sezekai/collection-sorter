'use strict';
// Anime / illustration taggers. Each one is described by a spec (input size, colour order, normalisation, padding, where its tag list
// comes from and how its outputs read), so one class runs them all: Haruka, PixAI v1.0, Camie v2 and the SmilingWolf WD v3 family.
// Every tagger returns the same shape: { rating:{general,sensitive,questionable,explicit}, general, character, copyright, artist } with [name, p] pairs.
const fs = require('fs');
const sharp = require('sharp');
const { ort, createSession } = require('./ort');

const normTag = (t) => String(t).toLowerCase().replace(/\\/g, '').replace(/_/g, ' ').trim();
const IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };

// cat: what each tag is. WD / PixAI csv numbers: 0 general, 1 artist, 3 copyright, 4 character, 5 meta, 9 rating
const CSV_CAT = { 0: 'general', 1: 'artist', 3: 'copyright', 4: 'character', 5: 'meta', 9: 'rating' };
const RATING_OF = (name) => { const m = /^(?:rating[ :_]?)?(g|general|s|sensitive|q|questionable|e|explicit)$/.exec(name); if (!m) return null; return { g: 'general', s: 'sensitive', q: 'questionable', e: 'explicit' }[m[1][0]]; };

const SPECS = {
  haruka: {
    label: 'Haruka (98,000 tags: characters, series and artists; about 0.8 GB)', short: 'Haruka', repo: 'KaraKaraWitch/haruka-tagger', dir: 'haruka',
    files: [{ key: 'model', file: 'haruka-tagger.onnx', size: 822e6 }, { key: 'tags', file: 'haruka-tagger_metadata.json', size: 12.7e6 }],
    size: 448, layout: 'nchw', order: 'rgb', unit: 1 / 255, ...IMAGENET, pad: [255, 255, 255], fit: 'letterbox', kernel: 'cubic', sigmoid: true, tagList: 'haruka',
    keep: { general: 0.2, character: 0.25, copyright: 0.25, artist: 0.2 }, batch: 8,
  },
  pixai: {
    label: 'PixAI v1.0 (31,000 tags, reads at 1008 px: most detailed but slowest; about 0.95 GB)', short: 'PixAI', repo: 'Mexes/pixai-tagger-v1.0-onnx-fp32-fp16-int8', dir: 'pixai-v1',
    files: [{ key: 'model', file: 'model_fp16.onnx', size: 947e6 }, { key: 'tags', file: 'selected_tags.csv', size: 0.8e6 }],
    size: 1008, layout: 'nchw', order: 'rgb', unit: 1 / 255, mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], pad: [0, 0, 0], fit: 'letterbox', kernel: 'cubic', sigmoid: false, tagList: 'csv',
    keep: { general: 0.17, character: 0.27, copyright: 0.24, artist: 0.15 }, batch: 1, cpuRamGB: 9,   // reads at 1008 px: one picture needs ~4 GB on the card, ~7 GB of memory on the processor
  },
  camie: {
    label: 'Camie v2 (70,000 tags; about 0.8 GB)', short: 'Camie', repo: 'Camais03/camie-tagger-v2', dir: 'camie-v2',
    files: [{ key: 'model', file: 'camie-tagger-v2.onnx', size: 789e6 }, { key: 'tags', file: 'camie-tagger-v2-metadata.json', size: 7.8e6 }],
    size: 512, layout: 'nchw', order: 'rgb', unit: 1 / 255, ...IMAGENET, pad: [124, 116, 104], fit: 'letterbox', kernel: 'lanczos3', sigmoid: true, tagList: 'camie', output: 'refined',
    keep: { general: 0.5, character: 0.6, copyright: 0.6, artist: 0.6 }, batch: 8,
  },
  'eva02-large': { label: 'WD EVA02-Large v3 (about 1.3 GB)', short: 'WD EVA02', repo: 'SmilingWolf/wd-eva02-large-tagger-v3', dir: 'wd14-eva02-large', wd: true },
  'vit-large': { label: 'WD ViT-Large v3 (about 1.3 GB)', short: 'WD ViT', repo: 'SmilingWolf/wd-vit-large-tagger-v3', dir: 'wd14-vit-large', wd: true },
  swinv2: { label: 'WD SwinV2 v3 (fast, about 0.45 GB)', short: 'WD SwinV2', repo: 'SmilingWolf/wd-swinv2-tagger-v3', dir: 'wd14', wd: true },
};
for (const s of Object.values(SPECS)) if (s.wd) Object.assign(s, {
  files: [{ key: 'model', file: 'model.onnx', size: 0 }, { key: 'tags', file: 'selected_tags.csv', size: 0 }],
  size: 448, layout: 'auto', order: 'bgr', unit: 1, mean: null, std: null, pad: [255, 255, 255], fit: 'letterbox', kernel: 'auto', sigmoid: false, tagList: 'csv',
  keep: { general: 0.15, character: 0.2, copyright: 0.2, artist: 0.2 }, batch: 8,
});
const DEFAULT_TAGGER = 'haruka';
const taggerKey = (k) => (SPECS[k] ? k : DEFAULT_TAGGER);

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean); const head = lines.shift().split(',');
  const iName = head.indexOf('name'), iCat = head.indexOf('category');
  return lines.map((l) => {
    const cells = []; let rest = l;
    while (rest.length) {
      if (rest[0] === '"') { const e = rest.indexOf('"', 1); cells.push(rest.slice(1, e)); rest = rest.slice(e + 2); }
      else { const e = rest.indexOf(','); if (e === -1) { cells.push(rest); rest = ''; } else { cells.push(rest.slice(0, e)); rest = rest.slice(e + 1); } }
    }
    return { name: cells[iName], cat: CSV_CAT[parseInt(cells[iCat], 10)] || 'general' };
  });
}
function readTagList(spec, file) {
  const text = fs.readFileSync(file, 'utf8');
  let list;
  if (spec.tagList === 'csv') list = parseCsv(text);
  else {
    const j = JSON.parse(text);
    const map = spec.tagList === 'camie' ? j.dataset_info.tag_mapping : j;
    const n = spec.tagList === 'camie' ? j.dataset_info.total_tags : j.total_tags;
    list = []; for (let i = 0; i < n; i++) { const name = map.idx_to_tag[String(i)]; list.push({ name, cat: map.tag_to_category[name] || 'general' }); }
  }
  return list.map((t) => { const name = normTag(t.name); const r = (t.cat === 'rating' || /^rating/.test(name)) ? RATING_OF(name) : null; return r ? { name: r, cat: 'rating' } : { name, cat: t.cat === 'style' ? 'artist' : t.cat }; });
}

class Tagger {
  constructor(spec, opts = {}) { this.spec = spec; this.opts = opts; this._q = Promise.resolve(); this._pending = []; this._busy = false; }
  // one run at a time on the session: parallel runs make DirectML run out of memory or fail outright
  _run(feeds) { const r = this._q.then(() => this.session.run(feeds)); this._q = r.catch(() => {}); return r; }
  async recover() {
    const cpuOk = !this.spec.cpuRamGB || require('os').totalmem() / 1e9 >= this.spec.cpuRamGB + 4;   // PixAI on a small PC would take the engine down
    const tries = this.provider === 'cpu' ? [] : [{ device: this.opts.device, label: 'gpu1' }, ...(cpuOk ? [{ device: 'cpu', label: 'cpu' }] : [])];
    if (this.provider === 'cpu' && this.batch > 1) { this.batch = 1; return true; }
    for (const t of tries) {
      try { const old = this.session; const r = await createSession(this.modelFile, { ...this.opts, device: t.device }); this.session = r.session; this.provider = r.provider; this.batch = 1; this.recovered = t.label === 'cpu' ? 'cpu' : 'gpu1'; this._q = Promise.resolve(); if (old && old.release) old.release(); return true; } catch { /* next */ }
    }
    return false;
  }
  release() { if (this.session && this.session.release) this.session.release(); this.session = null; }
  async init(modelFile, tagsFile) {
    this.tags = readTagList(this.spec, tagsFile);
    this.modelFile = modelFile;
    const r = await createSession(modelFile, this.opts);
    this.session = r.session; this.provider = r.provider; this.deviceId = r.deviceId;
    this.inputName = this.session.inputNames[0];
    const outs = this.session.outputNames;
    this.outputName = this.spec.output === 'refined' && outs.length > 1 ? (outs.find((n) => /refined/i.test(n)) || outs[1]) : (outs.find((n) => /prediction|output|logits/i.test(n)) || outs[0]);
    let nchw = this.spec.layout === 'nchw';
    if (this.spec.layout === 'auto') { try { const meta = this.session.inputMetadata; const dims = (Array.isArray(meta) ? meta[0] : meta[this.inputName]).shape; nchw = !!dims && dims[1] === 3; } catch { nchw = false; } }
    this.nchw = nchw; this.size = this.spec.size;
    this.batch = Math.max(1, Math.min(this.opts.batch || this.spec.batch || 8, this.spec.batch || 8));
    this.idx = { rating: [], general: [], character: [], copyright: [], artist: [] };
    this.tags.forEach((t, i) => { if (this.idx[t.cat]) this.idx[t.cat].push(i); });
    return this;
  }
  async selfTest() {
    const t0 = Date.now(); const r = await this.runPrepared([new Float32Array(this.size * this.size * 3).fill(0.5)]);
    if (!r.length || !r[0].rating) throw new Error('the tagger returned nothing');
    return { ms: Date.now() - t0 };
  }

  // work: { data, width, height } RGB bytes. Letterboxes onto the spec's padding colour, resizes, then lays the numbers out the way the model wants.
  async prepare(work) {
    const { data, width, height } = work; const sp = this.spec; const S = this.size;
    const k = Math.max(width, height); const sc = S / k; const nw = Math.max(1, Math.round(width * sc)), nh = Math.max(1, Math.round(height * sc));
    const kernel = sp.kernel === 'auto' ? (k > S ? 'lanczos3' : 'cubic') : sp.kernel;
    const top = Math.floor((S - nh) / 2), left = Math.floor((S - nw) / 2);
    const buf = await sharp(data, { raw: { width, height, channels: 3 } }).resize(nw, nh, { fit: 'fill', kernel })
      .extend({ top, bottom: S - nh - top, left, right: S - nw - left, background: { r: sp.pad[0], g: sp.pad[1], b: sp.pad[2] } }).raw().toBuffer();
    const n = S * S; const out = new Float32Array(n * 3); const bgr = sp.order === 'bgr';
    const mean = sp.mean || [0, 0, 0], std = sp.std || [1, 1, 1], u = sp.unit;
    for (let c = 0; c < 3; c++) {
      const src = bgr ? 2 - c : c; const m = mean[c], s = std[c];
      if (this.nchw) { const o = c * n; for (let i = 0; i < n; i++) out[o + i] = (buf[i * 3 + src] * u - m) / s; }
      else for (let i = 0; i < n; i++) out[i * 3 + c] = (buf[i * 3 + src] * u - m) / s;
    }
    return out;
  }

  // Pictures from several callers are collected and sent to the graphics card together (up to `batch` at once), so the card is not left waiting
  runPrepared(items) { return Promise.all(items.map((data) => new Promise((resolve, reject) => { this._pending.push({ data, resolve, reject }); this._kick(); }))); }
  _kick() { if (this._busy) return; this._busy = true; setImmediate(() => this._drain()); }
  async _drain() {
    const per = this.size * this.size * 3;
    try {
      while (this._pending.length) {
        const chunk = this._pending.splice(0, this.batch); const B = chunk.length;
        const input = new Float32Array(B * per); chunk.forEach((c, i) => input.set(c.data, i * per));
        const shape = this.nchw ? [B, 3, this.size, this.size] : [B, this.size, this.size, 3];
        let out;
        try { out = await this._run({ [this.inputName]: new ort.Tensor('float32', input, shape) }); }
        catch (e) { // a crashed graphics-card session stays dead, so build a fresh one: first one picture at a time on the card, then on the processor
          if (!this.batchNote) this.batchNote = e.message;
          if (await this.recover()) { this._pending.unshift(...chunk); continue; }
          chunk.forEach((c) => c.reject(e)); continue;
        }
        const probs = out[this.outputName].data; const N = probs.length / B;
        chunk.forEach((c, i) => { try { c.resolve(this.decode(probs.subarray(i * N, (i + 1) * N))); } catch (e) { c.reject(e); } });
      }
    } finally { this._busy = false; if (this._pending.length) this._kick(); }
  }

  decode(raw) {
    const sig = this.spec.sigmoid; const p = (i) => (sig ? 1 / (1 + Math.exp(-raw[i])) : raw[i]);
    const R = { general: 0, sensitive: 0, questionable: 0, explicit: 0 };
    for (const i of this.idx.rating) R[this.tags[i].name] = p(i);
    const keep = this.spec.keep;
    const pick = (cat, max) => { const min = keep[cat]; const out = []; for (const i of this.idx[cat]) { const v = p(i); if (v >= min) out.push([this.tags[i].name, +v.toFixed(4)]); } return out.sort((a, b) => b[1] - a[1]).slice(0, max); };
    return { rating: R, general: pick('general', 120), character: pick('character', 12), copyright: pick('copyright', 8), artist: pick('artist', 6) };
  }

  async tag(works) { const prepared = []; for (const w of works) prepared.push(await this.prepare(w)); return this.runPrepared(prepared); }
}

module.exports = { Tagger, SPECS, DEFAULT_TAGGER, taggerKey, normTag, readTagList, RATING_OF };
