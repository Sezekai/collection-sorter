'use strict';
const fs = require('fs');
const crypto = require('crypto');

// Fast fingerprint: size + first 64 KB + last 64 KB. Same bytes always give the same value, so it keys caches
// (tags, SauceNAO results) and finds exact-duplicate candidates without reading whole files.
async function fingerprint(file, size) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const n = Math.min(65536, size);
    const head = Buffer.alloc(n);
    await fh.read(head, 0, n, 0);
    let tail = Buffer.alloc(0);
    if (size > 65536) { tail = Buffer.alloc(Math.min(65536, size - 65536)); await fh.read(tail, 0, tail.length, size - tail.length); }
    return crypto.createHash('sha1').update(String(size)).update(head).update(tail).digest('hex');
  } finally { await fh.close(); }
}

function fullSha(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    s.on('data', (b) => h.update(b));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function hamming64(a, b) {
  // a, b: 16-char hex strings
  let d = 0;
  for (let i = 0; i < 16; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

module.exports = { fingerprint, fullSha, hamming64 };
