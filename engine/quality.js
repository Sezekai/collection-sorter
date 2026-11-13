'use strict';
// Transparent low-quality rules: each flag has a plain reason the review screen shows.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

function assess(m, ext, q) {
  const reasons = [];
  if (!q || q.enabled === false) return { flagged: false, reasons, score: 100 };
  const minSide = Math.min(m.w || 0, m.h || 0);
  const px = (m.w || 0) * (m.h || 0);
  if (minSide < q.minShortSide || px < q.minPixels) reasons.push(`low resolution ${m.w}x${m.h}`);
  if (m.sharp != null && m.sharp < q.minSharpness) reasons.push('blurry or upscaled');
  const lossy = /^\.(jpe?g|jfif|webp)$/.test(ext || '');
  if (lossy && m.bpp > 0 && m.bpp < q.minBitsPerPixel) reasons.push('heavily compressed');
  if (/^\.(jpe?g|jfif)$/.test(ext || '') && m.blockiness > 1.7) reasons.push('visible compression blocks');
  const res = clamp(minSide / (q.minShortSide * 2));
  const sh = clamp((m.sharp || 0) / (q.minSharpness * 3));
  const comp = lossy ? clamp((m.bpp || 0) / (q.minBitsPerPixel * 3)) * clamp(1.6 - (m.blockiness || 1)) : 1;
  const score = Math.round(100 * (0.45 * res + 0.35 * sh + 0.2 * comp));
  return { flagged: reasons.length > 0, reasons, score };
}

// Same as assess() for a database row. Pixel art is small and hard-edged on purpose, so resolution and blur never count against it.
function assessRow(r, q) {
  let pixel = false;
  try { const t = JSON.parse(r.tags || '{}'); pixel = (t.g || []).some(([n, p]) => (n === 'pixel art' || n === 'pixelated') && p >= 0.6); } catch { /* no tags */ }
  const m = { w: r.w, h: r.h, sharp: r.sharp, bpp: r.bpp, blockiness: r.blk };
  if (pixel) { m.w = Math.max(m.w || 0, 99999); m.h = Math.max(m.h || 0, 99999); m.sharp = null; }
  return assess(m, r.ext, q);
}

module.exports = { assess, assessRow };
