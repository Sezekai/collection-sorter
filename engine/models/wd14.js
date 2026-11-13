'use strict';
// WD14 anime tagger (SmilingWolf wd-*-tagger-v3: EVA02-Large, ViT-Large or SwinV2): rating, general tags and character tags.
const fs = require('fs');
const sharp = require('sharp');
const { ort, createSession } = require('./ort');

const SIZE = 448;

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(',');
  const col = (n) => head.indexOf(n);
  const iName = col('name'), iCat = col('category');
  return lines.map((l) => {
    // names can contain commas only in quoted csv; the tag list is plain, but handle quotes defensively
    const m = l.match(/("([^"]*)"|[^,]*)(,|$)/g) || [];
    const cells = []; let rest = l;
    while (rest.length) {
      if (rest[0] === '"') { const e = rest.indexOf('"', 1); cells.push(rest.slice(1, e)); rest = rest.slice(e + 2); }
      else { const e = rest.indexOf(','); if (e === -1) { cells.push(rest); rest = ''; } else { cells.push(rest.slice(0, e)); rest = rest.slice(e + 1); } }
    }
    return { name: cells[iName], cat: parseInt(cells[iCat], 10) };
  });
}

const normTag = (t) => t.toLowerCase().replace(/\\/g, '').replace(/_/g, ' ').trim();

class WD14 {
  constructor(opts = {}) { this.opts = opts; this._q = Promise.resolve(); this._pending = []; this._busy = false; }
  // one run at a time on the session: parallel runs make DirectML run out of memory or fail outright
  _run(feeds) { const r = this._q.then(() => this.session.run(feeds)); this._q = r.catch(() => {}); return r; }
  async recover() {
    const tries = this.provider === 'cpu' ? [] : [{ device: this.opts.device, label: 'gpu1' }, { device: 'cpu', label: 'cpu' }];
    if (this.provider === 'cpu' && this.batch > 1) { this.batch = 1; return true; }
    for (const t of tries) {
      try { const r = await createSession(this.modelFile, { ...this.opts, device: t.device }); this.session = r.session; this.provider = r.provider; this.batch = 1; this.recovered = t.label === 'cpu' ? 'cpu' : 'gpu1'; this._q = Promise.resolve(); return true; } catch { /* next */ }
    }
    return false;
  }
  async selfTest() {
    const blank = new Float32Array(SIZE * SIZE * 3).fill(200);
    const t0 = Date.now(); const r = await this.runPrepared([blank]);
    if (!r.length || !r[0].rating) throw new Error('the tagger returned nothing');
    return { ms: Date.now() - t0 };
  }
  async init(modelFile, tagsFile) {
    this.tags = parseCsv(fs.readFileSync(tagsFile, 'utf8')).map((t) => ({ name: normTag(t.name), cat: t.cat }));
    this.modelFile = modelFile;
    const r = await createSession(modelFile, this.opts);
    this.session = r.session; this.provider = r.provider; this.deviceId = r.deviceId;
    this.inputName = this.session.inputNames[0];
    this.outputName = this.session.outputNames[0];
    const meta = this.session.inputMetadata;
    let nchw = false;
    try { const dims = (Array.isArray(meta) ? meta[0] : meta[this.inputName]).shape; nchw = dims && dims[1] === 3; } catch { /* default NHWC */ }
    this.nchw = nchw;
    this.batch = this.opts.batch || 8;
    this.ratingIdx = []; this.generalIdx = []; this.characterIdx = []; this.copyrightIdx = [];
    this.tags.forEach((t, i) => { if (t.cat === 9) this.ratingIdx.push(i); else if (t.cat === 4) this.characterIdx.push(i); else if (t.cat === 3) this.copyrightIdx.push(i); else this.generalIdx.push(i); });
    return this;
  }

  // work: { data, width, height, channels:3 } RGB. Pads to a white square, resizes, returns BGR floats 0..255.
  async prepare(work) {
    const { data, width, height } = work;
    const s = Math.max(width, height);
    const top = Math.floor((s - height) / 2), left = Math.floor((s - width) / 2);
    const buf = await sharp(data, { raw: { width, height, channels: 3 } })
      .extend({ top, bottom: s - height - top, left, right: s - width - left, background: { r: 255, g: 255, b: 255 } })
      .resize(SIZE, SIZE, { fit: 'fill', kernel: s > SIZE ? 'lanczos3' : 'cubic' }).raw().toBuffer();
    const n = SIZE * SIZE;
    const out = new Float32Array(n * 3);
    if (this.nchw) { for (let i = 0; i < n; i++) { out[i] = buf[i * 3 + 2]; out[n + i] = buf[i * 3 + 1]; out[2 * n + i] = buf[i * 3]; } }
    else { for (let i = 0; i < n; i++) { out[i * 3] = buf[i * 3 + 2]; out[i * 3 + 1] = buf[i * 3 + 1]; out[i * 3 + 2] = buf[i * 3]; } }
    return out;
  }

  // Pictures from several callers are collected and sent to the graphics card together (up to `batch` at once), so the card is not left waiting
  runPrepared(items) {
    return Promise.all(items.map((data) => new Promise((resolve, reject) => { this._pending.push({ data, resolve, reject }); this._kick(); })));
  }
  _kick() { if (this._busy) return; this._busy = true; setImmediate(() => this._drain()); }
  async _drain() {
    const per = SIZE * SIZE * 3;
    try {
      while (this._pending.length) {
        const chunk = this._pending.splice(0, this.batch); const B = chunk.length;
        const input = new Float32Array(B * per);
        chunk.forEach((c, i) => input.set(c.data, i * per));
        const shape = this.nchw ? [B, 3, SIZE, SIZE] : [B, SIZE, SIZE, 3];
        let out;
        try { out = await this._run({ [this.inputName]: new ort.Tensor('float32', input, shape) }); }
        catch (e) { // a crashed graphics-card session stays dead, so build a fresh one: first one picture at a time on the card, then on the processor
          if (!this.batchNote) this.batchNote = e.message;
          if (await this.recover()) { this._pending.unshift(...chunk); continue; }
          chunk.forEach((c) => c.reject(e)); continue;
        }
        const probs = out[this.outputName].data; const N = this.tags.length;
        chunk.forEach((c, i) => { try { c.resolve(this.decode(probs.subarray(i * N, (i + 1) * N))); } catch (e) { c.reject(e); } });
      }
    } finally { this._busy = false; if (this._pending.length) this._kick(); }
  }

  decode(p) {
    const rating = {};
    const names = ['general', 'sensitive', 'questionable', 'explicit'];
    for (const i of this.ratingIdx) rating[this.tags[i].name] = p[i];
    const R = { general: rating.general || 0, sensitive: rating.sensitive || 0, questionable: rating.questionable || 0, explicit: rating.explicit || 0 };
    const pick = (idx, min, max) => idx.map((i) => [this.tags[i].name, +p[i].toFixed(4)]).filter((x) => x[1] >= min).sort((a, b) => b[1] - a[1]).slice(0, max);
    return {
      rating: R,
      general: pick(this.generalIdx, 0.15, 100),
      character: pick(this.characterIdx, 0.2, 12),
      copyright: pick(this.copyrightIdx, 0.2, 8),
    };
  }

  async tag(works) {
    const prepared = [];
    for (const w of works) prepared.push(await this.prepare(w));
    return this.runPrepared(prepared);
  }
}

module.exports = { WD14, normTag };
