'use strict';
// OpenAI CLIP byte-pair tokenizer (same algorithm and vocabulary file as the reference implementation).
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function bytesToUnicode() {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
  const m = new Map();
  bs.forEach((b, i) => m.set(b, String.fromCodePoint(cs[i])));
  return m;
}

class ClipTokenizer {
  constructor(bpeFile = path.join(__dirname, 'bpe_simple_vocab_16e6.txt.gz')) {
    const lines = zlib.gunzipSync(fs.readFileSync(bpeFile)).toString('utf8').split('\n');
    const merges = lines.slice(1, 49152 - 256 - 2 + 1).map((l) => l.split(' '));
    this.byteEnc = bytesToUnicode();
    let vocab = [...this.byteEnc.values()];
    vocab = vocab.concat(vocab.map((v) => v + '</w>'));
    for (const m of merges) vocab.push(m.join(''));
    vocab.push('<|startoftext|>', '<|endoftext|>');
    this.encoder = new Map(vocab.map((v, i) => [v, i]));
    this.ranks = new Map(merges.map((m, i) => [m[0] + ' ' + m[1], i]));
    this.cache = new Map([['<|startoftext|>', '<|startoftext|>'], ['<|endoftext|>', '<|endoftext|>']]);
    this.pat = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/giu;
    this.sot = this.encoder.get('<|startoftext|>');
    this.eot = this.encoder.get('<|endoftext|>');
  }
  bpe(token) {
    if (this.cache.has(token)) return this.cache.get(token);
    let word = [...token];
    word[word.length - 1] += '</w>';
    const pairsOf = (w) => { const s = new Set(); for (let i = 0; i < w.length - 1; i++) s.add(w[i] + ' ' + w[i + 1]); return s; };
    let pairs = pairsOf(word);
    if (!pairs.size) { const r = token + '</w>'; this.cache.set(token, r); return r; }
    while (true) {
      let best = null, bestRank = Infinity;
      for (const p of pairs) { const r = this.ranks.get(p); if (r !== undefined && r < bestRank) { bestRank = r; best = p; } }
      if (best === null) break;
      const [first, second] = best.split(' ');
      const nw = [];
      let i = 0;
      while (i < word.length) {
        const j = word.indexOf(first, i);
        if (j === -1) { nw.push(...word.slice(i)); break; }
        nw.push(...word.slice(i, j)); i = j;
        if (word[i] === first && i < word.length - 1 && word[i + 1] === second) { nw.push(first + second); i += 2; } else { nw.push(word[i]); i++; }
      }
      word = nw;
      if (word.length === 1) break;
      pairs = pairsOf(word);
    }
    const r = word.join(' ');
    this.cache.set(token, r);
    return r;
  }
  encode(text) {
    text = text.replace(/\s+/g, ' ').trim().toLowerCase();
    const out = [];
    for (const tok of text.match(this.pat) || []) {
      const mapped = [...Buffer.from(tok, 'utf8')].map((b) => this.byteEnc.get(b)).join('');
      for (const t of this.bpe(mapped).split(' ')) out.push(this.encoder.get(t));
    }
    return out;
  }
  // [sot] tokens [eot], zero padded to length n (77 for CLIP)
  tokenize(text, n = 77) {
    let ids = [this.sot, ...this.encode(text), this.eot];
    if (ids.length > n) { ids = ids.slice(0, n); ids[n - 1] = this.eot; }
    while (ids.length < n) ids.push(0);
    return ids;
  }
}

module.exports = { ClipTokenizer };
