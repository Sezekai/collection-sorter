'use strict';
// Ascii2D (ascii2d.net): colour / shape based search, strong on re-saved and resized copies. Direct file upload, no key.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

let blockedUntil = 0;
const BASE = () => process.env.ASCII2D_URL || 'https://ascii2d.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const text = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

// each result is an "item-box": thumbnail, "1200x900 JPG 345.6KB", and links to the source (title, artist, site). The first box is your own picture.
function parse(html) {
  const out = [];
  const boxes = String(html).split(/<div class=["'][^"']*\bitem-box\b[^"']*["']/i).slice(2);
  for (const b of boxes) {
    const m = /(\d+)\s*x\s*(\d+)\s+([A-Za-z0-9]+)\s+([\d.]+)\s*(KB|MB|B)/i.exec(text(b));
    const links = [...b.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((x) => ({ url: x[1], label: text(x[2]) })).filter((x) => /^https?:/i.test(x.url) && !/ascii2d\.net/i.test(x.url));
    if (!m && !links.length) continue;
    out.push({ engine: 'ascii2d', url: links[0] ? links[0].url : '', title: links[0] ? links[0].label : '', artist: links[1] ? links[1].label : '', w: m ? +m[1] : null, h: m ? +m[2] : null, similarity: null, site: links[0] ? new URL(links[0].url).hostname.replace(/^www\./, '') : '' });
  }
  return out;
}

async function lookup(file) {
  const st = fs.statSync(file); let buf, name = path.basename(file);
  if (st.size <= 5 * 1024 * 1024 && /\.(jpe?g|png|gif|webp)$/i.test(file)) buf = fs.readFileSync(file);
  else { buf = await sharp(file, { failOn: 'none', limitInputPixels: false }).rotate().resize({ width: 2500, height: 2500, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer(); name = 'upload.jpg'; }
  if (blockedUntil > Date.now()) throw new Error('Ascii2D is blocking this PC right now, so it is skipped for a while (it retries by itself later).');
  const base = BASE();
  const common = { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9,ja;q=0.8', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' };
  // like a browser: open the home page first to get the session cookie and the form's security token, then upload with them
  let cookie = '', token = '';
  try {
    const home = await fetch(base + '/', { headers: { ...common, accept: 'text/html,application/xhtml+xml', 'sec-fetch-site': 'none' }, redirect: 'follow' });
    const sc = typeof home.headers.getSetCookie === 'function' ? home.headers.getSetCookie() : [];
    cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const html = await home.text();
    const m = /name=["']authenticity_token["'][^>]*value=["']([^"']+)["']/i.exec(html) || /value=["']([^"']+)["'][^>]*name=["']authenticity_token["']/i.exec(html) || /name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i.exec(html);
    if (m) token = m[1];
  } catch { /* try the upload anyway */ }
  const send = async (withToken) => {
    const form = new FormData(); if (withToken && token) form.append('authenticity_token', token); form.append('file', new Blob([buf]), name);
    const hdr = { ...common, accept: 'text/html,application/xhtml+xml', referer: base + '/', origin: base }; if (cookie) hdr.cookie = cookie;
    return fetch(base + '/search/file', { method: 'POST', body: form, headers: hdr, redirect: 'follow' });
  };
  let res = await send(true);
  if (res.status === 403 || res.status === 422) { await new Promise((r) => setTimeout(r, 2500)); res = await send(true); }
  if (res.status === 429) { const e = new Error('Ascii2D is busy'); e.rate = true; throw e; }
  if (res.status === 403) { blockedUntil = Date.now() + 30 * 60 * 1000; throw new Error('Ascii2D refused the request even like a browser (it blocks some PCs / VPNs). It is skipped for 30 minutes; IQDB and SauceNAO still run. Turn Ascii2D off in Settings if this keeps happening.'); }
  if (!res.ok) throw new Error(`Ascii2D HTTP ${res.status}`);
  return parse(await res.text());
}
module.exports = { lookup, parse };
