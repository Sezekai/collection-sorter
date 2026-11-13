'use strict';
// IQDB (iqdb.org): anime-art reverse search. Direct file upload, no key. Gives the matched picture's width x height.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ENDPOINT = () => process.env.IQDB_URL || 'https://iqdb.org/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const text = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const absUrl = (u) => (!u ? '' : u.startsWith('//') ? 'https:' + u : u.startsWith('/') ? 'https://iqdb.org' + u : u);

// One result table per match: caption row, picture + link, source name, "WxH [Rating]", "NN% similarity".
function parse(html) {
  const out = [];
  if (/No relevant matches|No matches/i.test(html) && !/similarity/i.test(html)) return out;
  const tables = String(html).match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const t of tables) {
    const head = text((t.match(/<th[^>]*>([\s\S]*?)<\/th>/i) || [])[1]);
    if (!head || /your image/i.test(head)) continue;
    const href = (t.match(/<a[^>]*href=["']?([^"'\s>]+)/i) || [])[1];
    const alt = (t.match(/<img[^>]*alt=["']([^"']*)["']/i) || [])[1] || '';
    const rows = (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map(text);
    const size = rows.map((r) => /(\d+)\s*[×x]\s*(\d+)/.exec(r)).find(Boolean);
    const sim = rows.map((r) => /(\d+(?:\.\d+)?)\s*%\s*similarity/i.exec(r)).find(Boolean);
    if (!href && !size) continue;
    const tagsM = /Tags:\s*(.*)$/i.exec(text(alt));
    out.push({
      engine: 'iqdb', kind: head, url: absUrl(href), w: size ? +size[1] : null, h: size ? +size[2] : null,
      similarity: sim ? parseFloat(sim[1]) : null, site: rows.find((r, i) => i === 2 && !/similarity|\d+\s*[×x]\s*\d+/i.test(r)) || '',
      tags: tagsM ? tagsM[1].split(/\s+/).filter(Boolean).slice(0, 30) : [],
    });
  }
  return out;
}

async function prepare(file) { // IQDB accepts up to 8 MB and 7500 px; downscale only when needed
  const st = fs.statSync(file); const ok = /\.(jpe?g|png|gif)$/i.test(file) && st.size <= 7.5 * 1024 * 1024;
  if (ok) { const m = await sharp(file, { failOn: 'none' }).metadata().catch(() => ({})); if (!m.width || (m.width <= 7000 && m.height <= 7000)) return { buf: fs.readFileSync(file), name: path.basename(file) }; }
  return { buf: await sharp(file, { failOn: 'none', limitInputPixels: false }).rotate().resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(), name: 'upload.jpg' };
}

async function lookup(file) {
  const up = await prepare(file);
  const form = new FormData();
  form.append('MAX_FILE_SIZE', '8388608'); form.append('file', new Blob([up.buf]), up.name);
  for (const s of ['1', '2', '3', '4', '5', '6']) form.append('service[]', s); // all the sites IQDB searches
  const res = await fetch(ENDPOINT(), { method: 'POST', body: form, headers: { 'user-agent': UA } });
  if (res.status === 429 || res.status === 503) { const e = new Error('IQDB is busy'); e.rate = true; throw e; }
  if (!res.ok) throw new Error(`IQDB HTTP ${res.status}`);
  const html = await res.text();
  if (/class=["']err["']/i.test(html)) { const m = /class=["']err["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i.exec(html); throw new Error('IQDB said: ' + text(m && m[1]).slice(0, 120)); }
  return parse(html);
}
module.exports = { lookup, parse };
