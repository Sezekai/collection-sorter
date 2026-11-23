'use strict';
// CLIP ViT-B/32 via ONNX: image embeddings (for similarity, examples and zero-shot) and text embeddings (prompts).
const sharp = require('sharp');
const { ort, createSession } = require('./ort');
const { ClipTokenizer } = require('./tokenizer');

const SIZE = 224;
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

function l2(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / s; return o; }
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

class Clip {
  constructor(opts = {}) { this.opts = opts; this.tok = new ClipTokenizer(); this._q = Promise.resolve(); }
  _run(sess, feeds) { const r = this._q.then(() => sess.run(feeds)); this._q = r.catch(() => {}); return r; }
  release() { for (const s of [this.vision, this.text]) try { if (s && s.release) s.release(); } catch { /* gone */ } this.vision = this.text = null; }
  async selfTest() { const t0 = Date.now(); const e = await this.embedPrepared([new Float32Array(3 * SIZE * SIZE)]); if (!e.length) throw new Error('CLIP returned nothing'); return { ms: Date.now() - t0 }; }
  async init(visionFile, textFile) {
    const v = await createSession(visionFile, this.opts);
    this.vision = v.session; this.provider = v.provider;
    this.visionIn = this.vision.inputNames[0];
    this.visionOut = this.vision.outputNames.find((n) => /image.?embed/i.test(n)) || this.vision.outputNames.find((n) => /embed/i.test(n)) || this.vision.outputNames[0];
    if (textFile) {
      const t = await createSession(textFile, { ...this.opts, device: this.opts.device });
      this.text = t.session;
      this.textOut = this.text.outputNames.find((n) => /text.?embed/i.test(n)) || this.text.outputNames.find((n) => /embed/i.test(n)) || this.text.outputNames[0];
    }
    this.batch = this.opts.batch || 8;
    return this;
  }

  async prepare(work) {
    const buf = await sharp(work.data, { raw: { width: work.width, height: work.height, channels: 3 } })
      .resize({ width: SIZE, height: SIZE, fit: 'cover', position: 'centre', kernel: 'cubic' }).raw().toBuffer();
    const n = SIZE * SIZE, out = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = (buf[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    return out;
  }

  async embedPrepared(items) {
    const per = 3 * SIZE * SIZE, B = this.batch, res = [];
    for (let s = 0; s < items.length; s += B) {
      const chunk = items.slice(s, s + B);
      const input = new Float32Array(B * per);
      for (let i = 0; i < B; i++) input.set(chunk[Math.min(i, chunk.length - 1)], i * per);
      let out; try { out = await this._run(this.vision, { [this.visionIn]: new ort.Tensor('float32', input, [B, 3, SIZE, SIZE]) }); } catch (e) { if (B > 1) { this.batch = 1; return this.embedPrepared(items); } throw e; }
      const o = out[this.visionOut], D = o.dims[o.dims.length - 1];
      for (let i = 0; i < chunk.length; i++) res.push(l2(o.data.subarray(i * D, (i + 1) * D)));
    }
    return res;
  }
  async embedImages(works) { const p = []; for (const w of works) p.push(await this.prepare(w)); return this.embedPrepared(p); }

  async embedTexts(texts) {
    if (!this.text) throw new Error('text model not loaded');
    const out = [];
    for (let s = 0; s < texts.length; s += 16) {
      const chunk = texts.slice(s, s + 16);
      const ids = new BigInt64Array(chunk.length * 77);
      chunk.forEach((t, i) => this.tok.tokenize(t).forEach((x, j) => { ids[i * 77 + j] = BigInt(x); }));
      const feeds = { [this.text.inputNames[0]]: new ort.Tensor('int64', ids, [chunk.length, 77]) };
      if (this.text.inputNames.length > 1) {
        const mask = new BigInt64Array(chunk.length * 77);
        chunk.forEach((t, i) => { const n = Array.from(this.tok.tokenize(t)).indexOf(this.tok.eot) + 1; for (let j = 0; j < 77; j++) mask[i * 77 + j] = j < n ? 1n : 0n; });
        feeds[this.text.inputNames[1]] = new ort.Tensor('int64', mask, [chunk.length, 77]);
      }
      const o = (await this._run(this.text, feeds))[this.textOut];
      const D = o.dims[o.dims.length - 1];
      for (let i = 0; i < chunk.length; i++) out.push(l2(o.data.subarray(i * D, (i + 1) * D)));
    }
    return out;
  }
}

module.exports = { Clip, dot, l2 };
