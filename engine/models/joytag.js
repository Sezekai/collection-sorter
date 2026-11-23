'use strict';
// JoyTag (fpgaminer/joytag): a tagger trained on Danbooru art AND on photographs, with a good grasp of NSFW concepts.
// Used to tell real photos / videos from art, and to tag the real ones. Input: 448x448 RGB, padded white, CLIP-style normalisation; output: one score per tag.
const fs = require('fs');
const { ort, createSession } = require('./ort');
const { Tagger, normTag } = require('./tagger');

const SPEC = { size: 448, layout: 'nchw', order: 'rgb', unit: 1 / 255, mean: [0.48145466, 0.4578275, 0.40821073], std: [0.26862954, 0.26130258, 0.27577711], pad: [255, 255, 255], kernel: 'auto', sigmoid: false, batch: 4 };

class JoyTag extends Tagger {
  constructor(opts = {}) { super(SPEC, opts); }
  async init(modelFile, tagsFile) {
    this.modelFile = modelFile;
    this.names = fs.readFileSync(tagsFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(normTag);
    this.tags = this.names.map((name) => ({ name, cat: 'general' }));
    const r = await createSession(modelFile, this.opts);
    this.session = r.session; this.provider = r.provider; this.deviceId = r.deviceId;
    this.inputName = this.session.inputNames[0]; this.outputName = this.session.outputNames[0];
    let nchw = true;
    try { const meta = this.session.inputMetadata; const dims = (Array.isArray(meta) ? meta[0] : meta[this.inputName]).shape; if (dims && dims.length === 4 && dims[3] === 3) nchw = false; } catch { /* default NCHW */ }
    this.nchw = nchw; this.size = SPEC.size; this.batch = this.opts.batch || 4;
    return this;
  }
  decode(p) {
    if (this._logit === undefined) { let mn = Infinity, mx = -Infinity; for (let i = 0; i < p.length; i++) { if (p[i] < mn) mn = p[i]; if (p[i] > mx) mx = p[i]; } this._logit = mn < 0 || mx > 1; }
    const hits = [];
    for (let i = 0; i < this.names.length; i++) { const v = this._logit ? 1 / (1 + Math.exp(-p[i])) : p[i]; if (v >= 0.1) hits.push([this.names[i], +v.toFixed(4)]); }
    hits.sort((a, b) => b[1] - a[1]);
    return { rating: null, general: hits.slice(0, 160), character: [], copyright: [], artist: [] };
  }
  async selfTest() {
    const blank = new Float32Array(SPEC.size * SPEC.size * 3).fill(0.5);
    const t0 = Date.now();
    const o = await this._run({ [this.inputName]: new ort.Tensor('float32', blank, this.nchw ? [1, 3, SPEC.size, SPEC.size] : [1, SPEC.size, SPEC.size, 3]) });
    const len = o[this.outputName].data.length;
    if (len !== this.names.length) throw new Error(`JoyTag gives ${len} scores but its tag list has ${this.names.length} tags`);
    return { ms: Date.now() - t0 };
  }
}
module.exports = { JoyTag };
