'use strict';
// SauceNAO reverse image search. Free API key, direct upload, paced by the limits the account reports. Results are suggestions only.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('./db');
const { sleep } = require('./util');
const { normTag } = require('./models/wd14');

const ENDPOINT = () => process.env.SAUCENAO_URL || 'https://saucenao.com/search.php';

async function prepareUpload(file) {
  // keep uploads small and always JPEG/PNG; videos use their thumbnail instead (handled by the caller)
  const buf = fs.readFileSync(file);
  if (buf.length <= 3 * 1024 * 1024 && /\.(jpe?g|png|gif|webp)$/i.test(file)) return { buf, name: path.basename(file) };
  const out = await sharp(file, { failOn: 'none', limitInputPixels: false }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return { buf: out, name: 'upload.jpg' };
}

async function lookup(file, apiKey) {
  const up = await prepareUpload(file);
  const form = new FormData();
  form.append('file', new Blob([up.buf]), up.name);
  const url = `${ENDPOINT()}?output_type=2&numres=6&db=999&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: 'POST', body: form });
  if (res.status === 429) { const e = new Error('rate limited'); e.rate = true; throw e; }
  if (!res.ok) throw new Error(`SauceNAO HTTP ${res.status}`);
  const j = await res.json();
  const h = j.header || {};
  if (h.status && h.status !== 0 && !(j.results && j.results.length)) {
    const e = new Error(`SauceNAO said: status ${h.status}${h.message ? ' - ' + h.message : ''}`); if (h.status === -2 || /limit/i.test(h.message || '')) e.rate = true; throw e;
  }
  const results = (j.results || []).map((r) => {
    const hd = r.header || {}, dt = r.data || {};
    return { similarity: parseFloat(hd.similarity) || 0, db: hd.index_name || '', title: dt.title || dt.jp_name || dt.eng_name || '', series: dt.material || dt.source || '', characters: String(dt.characters || '').split(',').map((s) => s.trim()).filter(Boolean), creator: dt.creator || dt.member_name || dt.author_name || '', urls: dt.ext_urls || [] };
  }).sort((a, b) => b.similarity - a.similarity);
  return { results, remaining: { short: h.short_remaining, long: h.long_remaining }, limit: { short: h.short_limit, long: h.long_limit } };
}

// Map a series name from SauceNAO onto one of our folders using the rules' series names / folder names
function folderForSeries(series, rules) {
  if (!series) return null;
  const s = normTag(series).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let best = null;
  for (const [name, r] of Object.entries(rules.folders || {})) {
    if (r.type !== 'series') continue;
    const cands = [name, ...(r.series || [])].map((x) => normTag(x).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const c of cands) {
      if (c === s) return name;
      if (c.length >= 5 && (s.includes(c) || c.includes(s)) && (!best || c.length > best[1])) best = [name, c.length];
    }
  }
  return best ? best[0] : null;
}

// Send files (any status: waiting for review, or already moved into a Find Higher Quality folder) to the lookup queue.
async function queue(ids) {
  const d = db.get(); const { fingerprint } = require('./hashing');
  const sel = d.prepare('select id,fp,path,size,status from files where id=?'), ins = d.prepare(`insert into sauce(fp,state,ts) values(?,?,?) on conflict(fp) do update set state=case when sauce.state='done' then 'done' else 'queued' end`);
  let n = 0;
  for (const id of ids) {
    const r = sel.get(id); if (!r) continue;
    let fp = r.fp;
    if (!fp) { try { fp = await fingerprint(r.path, r.size); d.prepare('update files set fp=? where id=?').run(fp, id); } catch { continue; } }
    ins.run(fp, 'queued', Date.now()); n++;
  }
  return n;
}
function dequeue(ids) {
  const d = db.get();
  db.tx(() => { for (const id of ids) { const r = d.prepare('select fp from files where id=?').get(id); if (r && r.fp) d.prepare(`delete from sauce where fp=? and state in ('queued','error')`).run(r.fp); } });
}
function requeue(ids) { // look it up again (clears an old answer)
  const d = db.get();
  db.tx(() => { for (const id of ids) { const r = d.prepare('select fp from files where id=?').get(id); if (r && r.fp) d.prepare(`update sauce set state='queued', result=null where fp=?`).run(r.fp); } });
}

// Which sites are asked. SauceNAO needs your key; IQDB and Ascii2D need nothing.
function enginesFor(cfg) { const e = []; if (cfg.apiKey) e.push('saucenao'); if (cfg.useIqdb !== false) e.push('iqdb'); if (cfg.useAscii2d !== false) e.push('ascii2d'); return e; }

// Put every site's answers into one list and work out (a) the best match and series, (b) whether a clearly bigger copy exists.
function combine(parts, yours, cfg, rules) {
  const minSim = cfg.minSimilarity || 80, factor = cfg.biggerFactor || 1.2;
  const matches = [];
  for (const r of parts.saucenao || []) matches.push({ engine: 'saucenao', similarity: r.similarity, title: r.title, series: r.series, characters: r.characters, creator: r.creator, url: (r.urls || [])[0] || '', urls: r.urls || [], w: null, h: null, site: r.db });
  for (const r of parts.iqdb || []) matches.push({ engine: 'iqdb', similarity: r.similarity, title: r.site || r.kind, series: '', url: r.url, urls: r.url ? [r.url] : [], w: r.w, h: r.h, site: r.site, tags: r.tags });
  for (const r of (parts.ascii2d || []).slice(0, 4)) matches.push({ engine: 'ascii2d', similarity: null, title: r.title, series: '', creator: r.artist, url: r.url, urls: r.url ? [r.url] : [], w: r.w, h: r.h, site: r.site });
  matches.sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1));
  const good = matches.filter((m) => m.similarity != null && m.similarity >= minSim);
  const withSeries = good.find((m) => m.series);
  const top = withSeries || good[0] || null;
  const folder = withSeries ? folderForSeries(withSeries.series, rules) : null;
  let hq = null;
  const area = yours && yours.w && yours.h ? yours.w * yours.h : 0;
  if (area) {
    const big = (x, y) => y.w * y.h - x.w * x.h, sized = matches.filter((m) => m.w && m.h);
    // a match with a trusted similarity beats one without a score (Ascii2D), whatever its size
    const cand = sized.filter((m) => m.similarity != null && m.similarity >= minSim).sort(big)[0] || sized.filter((m) => m.similarity == null).sort(big)[0];
    if (cand && (cand.w * cand.h) / area >= factor) hq = { w: cand.w, h: cand.h, factor: Math.round(((cand.w * cand.h) / area) * 100) / 100, url: cand.url, engine: cand.engine, site: cand.site, similarity: cand.similarity, certain: cand.similarity != null };
  }
  return { top, others: matches.slice(0, 10), folder, hq, yours: yours && yours.w ? { w: yours.w, h: yours.h } : null };
}

// Works through the queue one picture at a time, slowly enough to respect each site's limits. ctl = { paused, cancelled }.
async function run(settings, rules, ctl, onProgress) {
  const cfg = settings.saucenao || {};
  const engines = enginesFor(cfg);
  if (!engines.length) throw new Error('Turn on at least one lookup site on the Setup screen (SauceNAO needs your API key).');
  const lookups = { saucenao: (f) => lookup(f, cfg.apiKey), iqdb: (f) => require('./lookup/iqdb').lookup(f), ascii2d: (f) => require('./lookup/ascii2d').lookup(f) };
  const d = db.get();
  let done = 0, found = 0, wait = 4000; const partial = new Map();
  const next = () => d.prepare(`select s.fp, f.id, f.path, f.kind, f.w, f.h from sauce s join files f on f.fp=s.fp where s.state='queued' and f.status in ('new','moved') order by s.ts limit 1`).get();
  for (;;) {
    if (ctl.cancelled) break;
    while (ctl.paused && !ctl.cancelled) await sleep(300);
    const it = next(); if (!it) break;
    const parts = partial.get(it.fp) || {}; const errs = {}; partial.set(it.fp, parts); let rateHit = false, limits = null, remaining = null;
    try {
      if (!fs.existsSync(it.path)) throw new Error('file no longer exists');
      const file = it.kind === 'video' ? require('./thumbs').thumbPath(it.id) : it.path;
      if (it.kind === 'video') await require('./thumbs').ensureThumb({ id: it.id, path: it.path, kind: 'video' });
      for (const eng of engines) {
        if (ctl.cancelled) break;
        if (parts[eng]) continue;
        try {
          const r = await lookups[eng](file);
          if (eng === 'saucenao') { parts.saucenao = r.results; remaining = r.remaining; limits = r.limit; } else parts[eng] = r;
        } catch (e) {
          if (e.rate && eng === 'saucenao') { rateHit = true; break; }
          errs[eng] = e.message; parts[eng] = [];
        }
        if (eng !== 'saucenao') await sleep(eng === 'iqdb' ? 3500 : 5000);
      }
      if (ctl.cancelled) break;
      if (rateHit) { if (onProgress) onProgress({ done, found, note: 'SauceNAO rate limit: pausing 35s' }); await sleep(35000); continue; }
      if (Object.keys(errs).length === engines.length) throw new Error(Object.values(errs)[0]);
      const c = combine(parts, { w: it.w, h: it.h }, cfg, rules);
      d.prepare(`update sauce set state='done', result=?, ts=? where fp=?`).run(JSON.stringify({ ...c, remaining, errors: Object.keys(errs).length ? errs : undefined }), Date.now(), it.fp);
      partial.delete(it.fp);
      if (c.top || c.hq) found++;
      if (limits && limits.short) wait = Math.max(wait, Math.ceil(30000 / limits.short) + 500);
      if (remaining && remaining.long !== undefined && remaining.long <= 0) { if (onProgress) onProgress({ done, found, note: 'SauceNAO daily limit reached; try again tomorrow' }); break; }
    } catch (e) {
      d.prepare(`update sauce set state='error', result=?, ts=? where fp=?`).run(JSON.stringify({ error: e.message }), Date.now(), it.fp); partial.delete(it.fp);
    }
    done++;
    if (onProgress) onProgress({ done, found, note: '' });
    await sleep(wait);
  }
  return { done, found };
}

module.exports = { lookup, folderForSeries, queue, dequeue, requeue, run, combine, enginesFor };
