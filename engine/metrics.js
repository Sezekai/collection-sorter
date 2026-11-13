'use strict';
// One decode per image: a working copy (longest side <= 768, white background) feeds every later step.
const sharp = require('sharp');

const WORK_MAX = 768;
const OPTS = { failOn: 'none', limitInputPixels: 1e9 };

async function decodeWork(input) {
  const meta = await sharp(input, OPTS).metadata();
  const swap = meta.orientation && meta.orientation >= 5;
  const w = swap ? meta.height : meta.width, h = swap ? meta.width : meta.height;
  const { data, info } = await sharp(input, OPTS)
    .rotate().flatten({ background: '#ffffff' })
    .resize({ width: WORK_MAX, height: WORK_MAX, fit: 'inside', withoutEnlargement: true })
    .removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { work: { data, width: info.width, height: info.height, channels: info.channels }, w, h, meta };
}

function greyArray(work) {
  const { data, width, height, channels } = work;
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += channels) g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  return g;
}

// Edge strength: 99th percentile of |Laplacian| on a 0..255 scale. Soft or upscaled images score low.
function sharpness(g, width, height) {
  if (width < 8 || height < 8) return 0;
  const hist = new Uint32Array(1024);
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - width] - g[i + width]);
      hist[Math.min(1023, v | 0)]++; n++;
    }
  }
  const target = n * 0.99; let acc = 0;
  for (let k = 0; k < 1024; k++) { acc += hist[k]; if (acc >= target) return k; }
  return 1023;
}

function colorStats(work) {
  const { data, width, height, channels } = work;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)));
  let sum = 0, cnt = 0, big = 0;
  const diffs = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const j = (y * width + x) * channels;
      const r = data[j], gg = data[j + 1], b = data[j + 2];
      const d = Math.max(Math.abs(r - gg), Math.abs(gg - b), Math.abs(r - b));
      sum += d; cnt++; if (d > 14) big++; diffs.push(d);
    }
  }
  diffs.sort((a, b) => a - b);
  const p95 = diffs[Math.floor(diffs.length * 0.95)] || 0;
  const mean = cnt ? sum / cnt : 0;
  // grey: practically no colour anywhere (black and white, greyscale scans)
  const grey = mean < 4 && p95 < 14 ? 1 : (big / Math.max(1, cnt) < 0.02 ? 0.6 : 0);
  return { grey, colorful: mean };
}

async function smallGrey(work, w, h) {
  const { data, info } = await sharp(work.data, { raw: { width: work.width, height: work.height, channels: work.channels } })
    .greyscale().resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  return data;
}

async function dhash(work) {
  const d = await smallGrey(work, 9, 8);
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += d[y * 9 + x] < d[y * 9 + x + 1] ? '1' : '0';
  return bitsToHex(bits);
}

const COS = (() => {
  const N = 32, K = 8, t = [];
  for (let k = 0; k < K; k++) { const row = new Float64Array(N); for (let n = 0; n < N; n++) row[n] = Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N)); t.push(row); }
  return t;
})();
async function phash(work) {
  const N = 32, d = await smallGrey(work, N, N);
  const coef = [];
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
    let s = 0;
    for (let y = 0; y < N; y++) { const cy = COS[u][y]; for (let x = 0; x < N; x++) s += d[y * N + x] * cy * COS[v][x]; }
    coef.push(s);
  }
  const rest = coef.slice(1).sort((a, b) => a - b);
  const med = rest[Math.floor(rest.length / 2)];
  let bits = '';
  for (let i = 0; i < 64; i++) bits += coef[i] > med ? '1' : '0';
  return bitsToHex(bits);
}
function bitsToHex(bits) { let h = ''; for (let i = 0; i < 64; i += 4) h += parseInt(bits.slice(i, i + 4), 2).toString(16); return h; }

// JPEG blockiness on a native resolution crop aligned to the 8x8 grid (>1 means visible blocks).
async function blockiness(file, w, h) {
  if (w < 160 || h < 160) return 1;
  const size = Math.min(512, (Math.min(w, h) >> 3) << 3);
  const left = (((w - size) >> 1) >> 3) << 3, top = (((h - size) >> 1) >> 3) << 3;
  const { data } = await sharp(file, OPTS).extract({ left, top, width: size, height: size }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let bnd = 0, bn = 0, oth = 0, on = 0;
  for (let y = 0; y < size; y++) for (let x = 1; x < size; x++) {
    const dd = Math.abs(data[y * size + x] - data[y * size + x - 1]);
    if (x % 8 === 0) { bnd += dd; bn++; } else { oth += dd; on++; }
  }
  return (bnd / Math.max(1, bn)) / Math.max(0.01, oth / Math.max(1, on));
}

async function analyzeImage(file, ext, size) {
  const { work, w, h } = await decodeWork(file);
  const g = greyArray(work);
  const m = {
    w, h,
    sharp: sharpness(g, work.width, work.height),
    bpp: size ? (size * 8) / Math.max(1, w * h) : 0,
    ...colorStats(work),
  };
  m.dhash = await dhash(work);
  m.phash = await phash(work);
  m.blockiness = /^\.(jpe?g|jfif)$/.test(ext) ? await blockiness(file, w, h).catch(() => 1) : 1;
  return { work, m };
}

async function thumbFromWork(work, outFile, max = 360) {
  await sharp(work.data, { raw: { width: work.width, height: work.height, channels: work.channels } })
    .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: false }).toFile(outFile);
}

module.exports = { decodeWork, analyzeImage, thumbFromWork, greyArray, sharpness, colorStats, dhash, phash, WORK_MAX };
