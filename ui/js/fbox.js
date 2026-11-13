// =====================================================================================
//  FOLDER BOX: every "Type or pick a folder" box shows its full list as soon as you click into it.
//  Typing narrows it. One match is highlighted so Enter sends it; with several, use ↑ ↓ then Enter.
//  Clicking away or Esc closes it and does nothing. A pick fires "fbpick" on the box.
// =====================================================================================
const FB = { input: null, matches: [], hi: -1, pop: null };
const fbNorm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9/]+/g, ' ').trim();
function fbPop() { if (!FB.pop) { FB.pop = document.createElement('div'); FB.pop.id = 'fbpop'; FB.pop.className = 'hidden'; document.body.appendChild(FB.pop); FB.pop.addEventListener('mousedown', (e) => { e.preventDefault(); const it = e.target.closest('[data-i]'); if (it) fbPick(FB.matches[+it.dataset.i]); }); } return FB.pop; }
function fbMatches(inp) {
  const q = fbNorm(inp.value); const all = typeof CHOICES !== 'undefined' ? CHOICES : [];
  if (!q) return all.slice();
  const words = q.split(' ');
  return all.filter((c) => { const n = fbNorm(c); return words.every((w) => n.includes(w)); }).sort((a, b) => (fbNorm(a).startsWith(q) ? 0 : 1) - (fbNorm(b).startsWith(q) ? 0 : 1));
}
function fbShow(inp, keepHi) {
  FB.input = inp; FB.matches = fbMatches(inp);
  if (!keepHi) FB.hi = FB.matches.length === 1 ? 0 : -1;
  const pop = fbPop();
  if (!FB.matches.length) { pop.innerHTML = '<div class="fbn">No folder matches</div>'; } else pop.innerHTML = FB.matches.map((c, i) => `<div class="fbi ${i === FB.hi ? 'on' : ''}" data-i="${i}">${esc(c)}</div>`).join('');
  const r = inp.getBoundingClientRect(); const below = innerHeight - r.bottom, above = r.top;
  const up = below < 260 && above > below; const h = Math.min(340, Math.max(120, (up ? above : below) - 12));
  pop.style.left = Math.max(6, Math.min(r.left, innerWidth - Math.max(r.width, 300) - 6)) + 'px'; pop.style.minWidth = Math.max(r.width, 280) + 'px'; pop.style.maxHeight = h + 'px';
  if (up) { pop.style.top = 'auto'; pop.style.bottom = innerHeight - r.top + 2 + 'px'; } else { pop.style.bottom = 'auto'; pop.style.top = r.bottom + 2 + 'px'; }
  pop.classList.remove('hidden');
  const on = pop.querySelector('.fbi.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function fbClose() { if (FB.pop) FB.pop.classList.add('hidden'); FB.input = null; FB.hi = -1; }
function fbPick(c) { const inp = FB.input; if (!inp || !c) return; inp.value = c; fbClose(); inp.dispatchEvent(new CustomEvent('fbpick', { detail: c })); }
function fbOpenFor(sel) { const e = typeof sel === 'string' ? $(sel) : sel; if (!e) return false; const v = $('#viewer'); if (v && !v.classList.contains('hidden')) v.classList.remove('noside', 'noui'); e.focus(); e.select(); fbShow(e); return true; }
document.addEventListener('focusin', (e) => { if (e.target.classList && e.target.classList.contains('fbox')) fbShow(e.target); });
document.addEventListener('focusout', (e) => { if (e.target.classList && e.target.classList.contains('fbox')) fbClose(); });
document.addEventListener('click', (e) => { const t = e.target; if (t.classList && t.classList.contains('fbox') && FB.input !== t) fbShow(t); });
document.addEventListener('input', (e) => { if (e.target.classList && e.target.classList.contains('fbox')) fbShow(e.target); });
document.addEventListener('keydown', (e) => {
  const t = e.target; if (!(t.classList && t.classList.contains('fbox'))) return;
  const open = FB.pop && !FB.pop.classList.contains('hidden');
  const stop = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { stop(); if (!open) return fbShow(t); const n = FB.matches.length; if (!n) return; FB.hi = e.key === 'ArrowDown' ? (FB.hi + 1) % n : (FB.hi <= 0 ? n - 1 : FB.hi - 1); return fbShow(t, true); }
  if (e.key === 'Enter') {
    stop(); const exact = (typeof folderMatch === 'function' ? folderMatch(t.value) : null);
    if (open && FB.hi >= 0) return fbPick(FB.matches[FB.hi]);
    if (FB.matches.length === 1) return fbPick(FB.matches[0]);
    if (exact) return fbPick(exact);
    return;
  }
  if (e.key === 'Escape') { stop(); fbClose(); t.blur(); return; }
  if (e.key === '/' && !t.value) { stop(); fbClose(); t.blur(); return; }   // "/" again on an empty box closes it
  if (e.key === 'Tab') { fbClose(); return; }
  e.stopPropagation();   // typing never triggers the picture shortcuts
}, true);
