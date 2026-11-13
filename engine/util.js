'use strict';
const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.jfif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.gif', '.m4v', '.wmv', '.flv']);
const JUNK_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

function kindOf(file) {
  const e = path.extname(file).toLowerCase();
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  return null;
}
function isJunk(name) { return JUNK_NAMES.has(name.toLowerCase()); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run fn over items with limited concurrency; results keep input order.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

function normName(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Case-insensitive, separator-insensitive path key for Windows-style comparisons.
function pkey(p) { return path.resolve(p).replace(/\\/g, '/').toLowerCase(); }

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// Everything the engine does goes to its log (stdout, saved by the shell in logs\) and to the app's log drawer.
const EventEmitter = require('events');
const logBus = new EventEmitter(); logBus.setMaxListeners(50);
const logRing = [];
function logAt(level, a) {
  const text = a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  const line = { ts: Date.now(), level, text }; logRing.push(line); if (logRing.length > 1000) logRing.shift();
  (level === 'e' ? console.error : console.log)(new Date().toISOString().slice(11, 19), level === 'e' ? 'ERROR' : level === 'w' ? 'WARN' : '', text);
  logBus.emit('line', line);
}
const log = (...a) => logAt('i', a);
log.warn = (...a) => logAt('w', a);
log.error = (...a) => logAt('e', a);

module.exports = { IMAGE_EXT, VIDEO_EXT, kindOf, isJunk, sleep, pool, normName, pkey, ensureDir, log, logBus, logRing };
