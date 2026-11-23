#!/usr/bin/env node
'use strict';
// Builds the app icon from the logo shown in the side menu (the grid-and-tick mark on the Blue → Cyan accent):
// app/icons/icon.png (512 px, window / taskbar) and app/icons/icon.ico (16–256 px, the .exe). Run: node scripts/make-icon.js
const fs = require('fs'); const path = require('path'); const sharp = require('sharp');
const OUT = path.join(__dirname, '..', 'app', 'icons');
const glyph = '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5l2.5 2.5 4.5-5"/>';
const svg = (S) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 256 256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b98ff"/><stop offset="1" stop-color="#3fd3f0"/></linearGradient></defs>
  <rect x="8" y="8" width="240" height="240" rx="58" fill="url(#g)"/>
  <g transform="translate(46 46) scale(6.83)" fill="none" stroke="#06121f" stroke-width="${S <= 32 ? 2.6 : 2}" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await sharp(Buffer.from(svg(512))).png().toFile(path.join(OUT, 'icon.png'));
  const sizes = [16, 24, 32, 48, 64, 128, 256]; const pngs = [];
  for (const s of sizes) pngs.push(await sharp(Buffer.from(svg(s))).resize(s, s).png().toBuffer());
  // ICO container with PNG images inside (Windows Vista and later)
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  const dir = Buffer.alloc(16 * sizes.length); let off = 6 + dir.length;
  sizes.forEach((s, i) => { const b = pngs[i]; const o = i * 16; dir.writeUInt8(s >= 256 ? 0 : s, o); dir.writeUInt8(s >= 256 ? 0 : s, o + 1); dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3); dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(b.length, o + 8); dir.writeUInt32LE(off, o + 12); off += b.length; });
  fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([head, dir, ...pngs]));
  console.log('icons written to', OUT);
})();
