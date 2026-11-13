'use strict';
// ---------- helpers ----------
const TOKEN = (() => { try { const t = new URLSearchParams(location.search).get('t'); if (t) sessionStorage.setItem('cs_t', t); return sessionStorage.getItem('cs_t') || ''; } catch { return ''; } })();
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, body, method) {
  const r = await fetch('/api' + path, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'x-token': TOKEN }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const tq = TOKEN ? `?t=${encodeURIComponent(TOKEN)}` : '';
const thumb = (id) => `/api/thumb/${id}${tq}`;
const fileUrl = (id) => `/api/file/${id}${tq}`;
function toast(msg, err) { const d = document.createElement('div'); d.className = 'toast' + (err === true ? ' err' : err === 'info' ? ' info' : ''); const t = document.createElement('span'); t.textContent = msg; d.appendChild(t); $('#toasts').appendChild(d); setTimeout(() => d.remove(), err === true ? 7000 : 4000); if (err === true && typeof logLine === 'function') logLine(msg, 'e'); }
const fmtSize = (n) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB');
const fmtNum = (n) => (n ?? 0).toLocaleString();
const dur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const ratingChip = (r) => (r === 'very' ? '<span class="chip very">Very</span>' : r === 'nsfw' ? '<span class="chip nsfw">NSFW</span>' : '');
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { c[k] = c[k] && typeof c[k] === 'object' ? c[k] : {}; c = c[k]; }); c[ks[ks.length - 1]] = v; };
const clone = (o) => JSON.parse(JSON.stringify(o));
let S = { settings: {}, counts: {} };
let CHOICES = [];
const views = {};

// ---------- icons ----------
const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', shuffle: '<path d="M3 6h4l10 12h4M3 18h4l3-3.6M14 8.6L17 6h4M18 3l3 3-3 3M18 15l3 3-3 3"/>', setup: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  real: '<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/>',
  knows: '<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/>',
  examples: '<path d="M3 7h6l2 2h10v10H3z"/><path d="M8 14l2.5 2.5L16 12"/>',
  review: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  sets: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>', dupes: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  unmapped: '<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.2"/>', sauce: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  unsorted: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h0"/>', tags: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>', fhq: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  rules: '<path d="M10 6h11M10 12h11M10 18h11M3 6h2M3 12h2M3 18h2"/>', apply: '<path d="M4 12h13"/><path d="M13 6l6 6-6 6"/><path d="M4 5v14"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/><path d="M12 21c-1.5 0-2-1-1.5-2s1.5-1.5 1.5-3 2-2 4-2"/>',
  logo: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5l2.5 2.5 4.5-5"/>',
  log: '<path d="M4 6h16M4 12h16M4 18h10"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  look: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 3-4 3h-2a2 2 0 0 0-1 3.7A2 2 0 0 1 12 22z"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12l5 5 9-10"/>', chev: '<path d="M6 9l6 6 6-6"/>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h0M10 10h0M14 10h0M18 10h0M7 14h10"/>', full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};
ICONS.settings = ICONS.gear;
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;
const NAV = [['setup', 'Setup'], ['review', 'Art', 1], ['real', 'Real life', 1], ['unsorted', 'Unsorted'], ['tags', 'Tags'], ['sets', 'Connected sets'], ['dupes', 'Duplicates'], ['fhq', 'Find Higher Quality'], ['sauce', 'Source lookup'], ['knows', 'What it knows'], ['examples', 'Examples to learn from'], ['rules', 'Rules & ranking'], ['undo', 'Undo']];

// ---------- preferences (kept by the engine, so they survive restarts) ----------
let PREFS = { ap: {}, custom: [], nav: true, layout: 'grid', tile: 168, cols: 3, cardh: 190, widths: {}, volume: 0.6, muted: false, show: { name: true, dest: true, rating: true, conf: true, res: true, size: true, flags: true, why: true, tags: true } };
let prefTimer = null;
const savePrefs = () => { clearTimeout(prefTimer); prefTimer = setTimeout(() => api('/ui', PREFS).catch(() => {}), 400); };

// ---------- appearance: see look.js ----------

// ---------- modal / confirm / tooltips ----------
function modal(html, onClose, kind) { const m = $('#modal'); if (m._onClose && !m.classList.contains('hidden')) { const f = m._onClose; m._onClose = null; try { f(); } catch { /* ignore */ } } m.dataset.kind = kind || ''; m.innerHTML = `<div class="mbox">${html}</div>`; m.classList.remove('hidden'); m.onclick = (e) => { if (e.target === m) closeModal(); }; m._onClose = onClose; }
function closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; if (m._onClose) m._onClose(); m._onClose = null; }
async function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    let done = false; const fin = (v) => { if (done) return; done = true; closeModal(); res(v); };
    modal(`<h1>${esc(title)}</h1><p>${text}</p><div class="acts"><button class="ghost" id="cbno">Cancel</button><button class="${danger ? 'danger' : 'pri'}" id="cbok">${esc(String(okLabel).replace(/&amp;/g, '&'))}</button></div>`, () => { if (!done) { done = true; res(false); } }, 'confirm');
    $('#cbok').onclick = () => fin(true); $('#cbno').onclick = () => fin(false); setTimeout(() => { const b = $('#cbok'); if (b) b.focus(); }, 0);
  });
}
// a small in-app dialog with one text box (no Windows pop-ups)
async function askText(title, text, value, okLabel = 'OK') {
  return new Promise((res) => {
    let done = false; const fin = (v) => { if (done) return; done = true; closeModal(); res(v); };
    modal(`<h1>${esc(title)}</h1>${text ? `<p>${text}</p>` : ''}<input type="text" id="atv" value="${esc(value || '')}" style="margin-top:8px"><div class="acts"><button class="ghost" id="atno">Cancel</button><button class="pri" id="atok">${esc(okLabel)}</button></div>`, () => { if (!done) { done = true; res(null); } }, 'confirm');
    const i = $('#atv'); i.focus(); i.select(); i.onkeydown = (e) => { if (e.key === 'Enter') fin(i.value.trim()); };
    $('#atok').onclick = () => fin(i.value.trim()); $('#atno').onclick = () => fin(null);
  });
}
const FIELD_BY_PATH = {}; SETTING_GROUPS.forEach((g) => g.fields.forEach((f) => { FIELD_BY_PATH[f.path] = f; }));
(function tooltips() {
  const tip = $('#tip');
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tipid]'); if (!t) return;
    const f = FIELD_BY_PATH[t.dataset.tipid]; if (!f) return;
    tip.innerHTML = `<b>${esc(f.label)}</b><div>${esc(f.help)}</div><div class="rec"><b>Good value:</b> ${esc(f.rec)}<br><span class="muted">${esc(f.why)}</span></div>`;
    tip.classList.remove('hidden');
    const r = t.getBoundingClientRect(); const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.right + 12; if (x + tw > innerWidth - 8) x = Math.max(8, r.left - tw - 12); if (x < 8) x = 8;
    let y = r.top; if (y + th > innerHeight - 8) y = Math.max(8, innerHeight - th - 8);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  document.addEventListener('mouseout', (e) => { const t = e.target.closest('[data-tipid]'); if (t && !t.contains(e.relatedTarget)) $('#tip').classList.add('hidden'); });
})();

// ---------- state / events ----------
async function refreshState() {
  try {
    S = await api('/state');
    try { S.lanes = await api('/lanes'); } catch { S.lanes = []; }
    const c = S.counts;
    const ns = $('#navstats'); if (ns) ns.textContent = `${fmtNum(c.files)} files · ${fmtNum(c.pending)} to review · ${fmtNum(c.moved)} moved`;
    if (typeof updateNavBadges === 'function') updateNavBadges();
    if (S.folderChanges > 0 && typeof showFolderChanges === 'function' && !FC.open && S.folderChanges !== FC.later && $('#viewer').classList.contains('hidden') && $('#modal').classList.contains('hidden')) showFolderChanges();
  } catch { /* engine restarting */ }
}
async function loadChoices() { try { CHOICES = (await api('/catalog')).choices; } catch { CHOICES = []; } }
function folderSelect(id, value, extra = '') { return `<input type="text" class="fbox" autocomplete="off" id="${id}" value="${esc(value || '')}" placeholder="Type or pick a folder" ${extra}>`; }

function connectEvents() {
  const es = new EventSource('/api/events' + tq);
  es.addEventListener('progress', (ev) => showProgress(JSON.parse(ev.data)));
  es.addEventListener('job', async (ev) => { const j = JSON.parse(ev.data); S.job = j.running ? j.name : null; if (j.queue) S.queue = j.queue; Status.job(j); await refreshState(); if (!j.running) { const v = views[curRoute()]; if (v && v.afterJob) v.afterJob(j.name); else route(true); } });
  es.addEventListener('sauce', (ev) => { S.sauce = JSON.parse(ev.data); updateNavBadges(); Status.pills(); const v = views[curRoute()]; if (v && v.status && curRoute() === 'sauce') v.status(); if (!S.sauce.running && v && v.afterSauce) v.afterSauce(); });
  es.addEventListener('hello', (ev) => { const h = JSON.parse(ev.data); S.queue = h.queue || []; if (h.job) { S.job = h.job; showProgress(h.progress); } else if (h.last && !Status.result) { Status.result = h.last; Status.draw(); } S.sauce = h.sauce; Status.pills(); });
  es.addEventListener('queue', (ev) => { S.queue = JSON.parse(ev.data); Status.draw(); Status.pills(); });
  es.addEventListener('log', (ev) => { const l = JSON.parse(ev.data); logLine(l.text, l.level, l.ts); });
  es.onerror = () => {};
}

