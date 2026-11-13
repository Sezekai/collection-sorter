'use strict';
// JoyTag (fpgaminer/joytag): a tagger trained on Danbooru art AND on photographs, with a good grasp of NSFW concepts.
// Used to tell real photos / videos from art, and to tag the real ones. Input: 448x448 RGB, padded white, CLIP-style normalisation; output: one score per tag.
const fs = require('fs');
const sharp = require('sharp');
const { ort, createSession } = require('./ort');
const { WD14, normTag } = require('./wd14');

const SIZE = 448;
const MEAN = [0.48145466, 0.4578275, 0.40821073], STD = [0.26862954, 0.26130258, 0.27577711];

class JoyTag extends WD14 {
  async init(modelFile, tagsFile) {
    this.modelFile = modelFile;
    this.names = fs.readFileSync(tagsFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(normTag);
    this.tags = this.names.map((name) => ({ name, cat: 0 }));
    const r = await createSession(modelFile, this.opts);
    this.session = r.session; this.provider = r.provider; this.deviceId = r.deviceId;
    this.inputName = this.session.inputNames[0]; this.outputName = this.session.outputNames[0];
    let nchw = true;
    try { const meta = this.session.inputMetadata; const dims = (Array.isArray(meta) ? meta[0] : meta[this.inputName]).shape; if (dims && dims.length === 4 && dims[3] === 3) nchw = false; } catch { /* default NCHW */ }
    this.nchw = nchw; this.batch = this.opts.batch || 4;
    if (this.session.outputNames.length && this.names.length) { /* the output length is checked on the first run */ }
    return this;
  }
  async prepare(work) {
    const { data, width, height } = work; const s = Math.max(width, height);
    const top = Math.floor((s - height) / 2), left = Math.floor((s - width) / 2);
    const buf = await sharp(data, { raw: { width, height, channels: 3 } })
      .extend({ top, bottom: s - height - top, left, right: s - width - left, background: { r: 255, g: 255, b: 255 } })
      .resize(SIZE, SIZE, { fit: 'fill', kernel: s > SIZE ? 'lanczos3' : 'cubic' }).raw().toBuffer();
    const n = SIZE * SIZE; const out = new Float32Array(n * 3);
    if (this.nchw) { for (let i = 0; i < n; i++) { out[i] = (buf[i * 3] / 255 - MEAN[0]) / STD[0]; out[n + i] = (buf[i * 3 + 1] / 255 - MEAN[1]) / STD[1]; out[2 * n + i] = (buf[i * 3 + 2] / 255 - MEAN[2]) / STD[2]; } }
    else { for (let i = 0; i < n; i++) { out[i * 3] = (buf[i * 3] / 255 - MEAN[0]) / STD[0]; out[i * 3 + 1] = (buf[i * 3 + 1] / 255 - MEAN[1]) / STD[1]; out[i * 3 + 2] = (buf[i * 3 + 2] / 255 - MEAN[2]) / STD[2]; } }
    return out;
  }
  decode(p) {
    if (this._logit === undefined) { let mn = Infinity, mx = -Infinity; for (let i = 0; i < p.length; i++) { if (p[i] < mn) mn = p[i]; if (p[i] > mx) mx = p[i]; } this._logit = mn < 0 || mx > 1; }
    const hits = [];
    for (let i = 0; i < this.names.length; i++) { const v = this._logit ? 1 / (1 + Math.exp(-p[i])) : p[i]; if (v >= 0.1) hits.push([this.names[i], +v.toFixed(4)]); }
    hits.sort((a, b) => b[1] - a[1]);
    return { rating: null, general: hits.slice(0, 160), character: [], copyright: [] };
  }
  async selfTest() {
    const blank = new Float32Array(SIZE * SIZE * 3).fill(0.5);
    const t0 = Date.now();
    const o = await this._run({ [this.inputName]: new ort.Tensor('float32', blank, this.nchw ? [1, 3, SIZE, SIZE] : [1, SIZE, SIZE, 3]) });
    const len = o[this.outputName].data.length;
    if (len !== this.names.length) throw new Error(`JoyTag gives ${len} scores but its tag list has ${this.names.length} tags`);
    return { ms: Date.now() - t0 };
  }
}
module.exports = { JoyTag };
