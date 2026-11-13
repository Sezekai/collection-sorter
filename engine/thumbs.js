'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { DATA_DIR } = require('./settings');
const { ensureDir } = require('./util');
const video = require('./video');

// small thumbnails stay on the fast drive (the owner chose this for the huge library); the folder can be moved in Settings → Storage
let DIR = require('./storage').thumbDir(); ensureDir(DIR);
function refreshDirs() { DIR = require('./storage').thumbDir(); ensureDir(DIR); module.exports.DIR = DIR; }
const thumbPath = (id) => path.join(DIR, `${id}.jpg`);

const inflight = new Map();
async function ensureThumb(row) {
  const out = thumbPath(row.id);
  if (fs.existsSync(out)) return out;
  if (inflight.has(row.id)) return inflight.get(row.id);
  const p = (async () => {
    if (row.kind === 'video') {
      const info = await video.probe(row.path).catch(() => ({ duration: 0 }));
      const buf = await video.frameAt(row.path, (info.duration || 0) * 0.25, 360);
      await sharp(buf, { failOn: 'none' }).resize({ width: 360, height: 360, fit: 'inside' }).jpeg({ quality: 72 }).toFile(out);
    } else {
      await sharp(row.path, { failOn: 'none', limitInputPixels: 1e9 }).rotate().flatten({ background: '#ffffff' })
        .resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toFile(out);
    }
    return out;
  })().finally(() => inflight.delete(row.id));
  inflight.set(row.id, p);
  return p;
}

module.exports = { thumbPath, ensureThumb, DIR, refreshDirs };
