
// ---------- panels: every side panel can be made wider / narrower and collapsed ----------
const PANELS = { nav: { v: '--navw', min: 56, max: 440, def: 240 }, sb: { v: '--sbw', min: 170, max: 640, def: 260 }, vs: { v: '--vsw', min: 260, max: 820, def: 340 }, sec: { v: '--secw', min: 150, max: 560, def: 250 }, kl: { v: '--klw', min: 200, max: 700, def: 320 } };
function setPanelW(key, w, save = true) {
  const p = PANELS[key]; w = Math.round(Math.max(p.min, Math.min(p.max, w)));
  PREFS.widths = PREFS.widths || {}; PREFS.widths[key] = w;
  document.documentElement.style.setProperty(p.v, w + 'px');
  if (key === 'nav') document.body.classList.toggle('navnarrow', w < 130);
  if (save) savePrefs();
}
function applyPanelPrefs() { for (const k of Object.keys(PANELS)) setPanelW(k, (PREFS.widths || {})[k] ?? PANELS[k].def, false); }
// drag handle on the edge of a panel. edge: 'right' = panel sits on the left (drag right to widen); 'left' = panel on the right.
function addResizer(panel, key, edge) {
  const old = panel.querySelector(':scope > .rz'); if (old) old.remove();
  const h = document.createElement('div'); h.className = 'rz rz-' + edge; h.title = 'Drag to resize (double-click to reset)'; panel.appendChild(h);
  h.onpointerdown = (e) => {
    e.preventDefault(); h.setPointerCapture(e.pointerId); const x0 = e.clientX, w0 = panel.getBoundingClientRect().width; document.body.classList.add('resizing');
    h.onpointermove = (ev) => setPanelW(key, w0 + (edge === 'right' ? ev.clientX - x0 : x0 - ev.clientX), false);
    h.onpointerup = () => { h.onpointermove = null; h.onpointerup = null; document.body.classList.remove('resizing'); savePrefs(); };
  };
  h.ondblclick = () => setPanelW(key, PANELS[key].def);
}

// ---------- shell: side menu (196 px, hideable with M), title bar, shortcuts popup, full screen ----------
const SCREEN_NAMES = { setup: 'Setup', review: 'Art', real: 'Real life', unsorted: 'Unsorted', tags: 'Tags', sets: 'Connected sets', dupes: 'Duplicates', fhq: 'Find Higher Quality', sauce: 'Source lookup', knows: 'What it knows', examples: 'Examples to learn from', rules: 'Rules & ranking', undo: 'Undo', look: 'Look', settings: 'Settings', unmapped: 'Unmapped series' };
function buildNav() {
  const a = ([id, l, sub]) => `<a href="#${id}" data-r="${id}" class="${sub ? 'sub' : ''}" title="${esc(l)}">${icon(id)}<span>${l}</span><em class="nb" data-nb="${id}"></em></a>`;
  $('#nav').innerHTML = `<div class="brand"><span class="logo"><svg viewBox="0 0 24 24">${ICONS.logo}</svg></span><span>Collection Sorter</span></div><div class="navlist">${NAV.map((n) => `${n[0] === 'review' ? `<div class="navgrp" id="navgrp" title="Art and real photos / videos are reviewed separately">${icon('review')}<span>Review</span><em>▾</em></div>` : ''}${a(n)}`).join('')}</div>
    <div class="grow"></div><div class="navlist navbottom">${a(['look', 'Look'])}${a(['settings', 'Settings'])}<a href="#" id="navkeys" title="Keyboard shortcuts (K)">${icon('keys')}<span>Keys</span></a><a href="#" id="navlog" title="The log (L)">${icon('log')}<span>Log</span></a></div><div id="navstats" class="navstats"></div>`;
  $('#navgrp').onclick = () => { PREFS.revOpen = PREFS.revOpen === false; document.body.classList.toggle('revshut', PREFS.revOpen === false); savePrefs(); };
  document.body.classList.toggle('revshut', PREFS.revOpen === false);
  $('#navtoggle').innerHTML = icon('menu');
  $('#navkeys').onclick = (e) => { e.preventDefault(); shortcutsDialog(); };
  $('#navlog').onclick = (e) => { e.preventDefault(); Log.toggle(); };
  addResizer($('#nav'), 'nav', 'right');
}
function setNav(show) { PREFS.nav = show; document.body.classList.toggle('nonav', !show); savePrefs(); }
$('#navtoggle').onclick = () => setNav(document.body.classList.contains('nonav'));
function toggleFull() { if (window.csNative && window.csNative.fullScreen) window.csNative.fullScreen(); else if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
document.addEventListener('fullscreenchange', () => document.body.classList.toggle('fullscreen', !!document.fullscreenElement));
if (window.csNative && window.csNative.onWindowState) window.csNative.onWindowState((w) => document.body.classList.toggle('fullscreen', !!(w && w.fullScreen)));
if (!window.csNative) document.body.classList.add('nowin');
function updateNavBadges() {
  const set = (id, n) => { const e = $(`[data-nb="${id}"]`); if (e) e.textContent = n ? fmtNum(n) : ''; };
  const lanes = S.lanes || []; const un = lanes.find((l) => l.lane === 'unsorted'); const c = S.counts || {};
  set('review', c.art_pending); set('real', c.real_pending); set('unsorted', un ? un.n : 0); set('dupes', c.dupe_groups); set('sets', c.sets_pending);
  const st = S.sauce; set('sauce', st && st.running ? '…' : 0);
}

// The keyboard shortcuts popup (DESIGN.md): keycaps, grouped, flowing into columns so it always fits the window.
function shortcutsDialog() {
  const m = $('#modal');
  if (!m.classList.contains('hidden') && m.dataset.kind === 'keys') return closeModal();
  const keys = (k) => k.split(' ').map((x) => (x === '+' || x === '/' && k.length > 1 && k !== '/' ? `<span class="faint">${esc(x)}</span>` : `<kbd>${esc(x)}</kbd>`)).join('');
  const grp = (t, rows) => `<div class="kgrp"><h3>${t}</h3>${rows.map(([k, d]) => `<div class="krow"><span class="ks">${keys(k)}</span><span class="kd">${esc(d)}</span></div>`).join('')}</div>`;
  modal(`<div class="keyshead"><h1>Keyboard shortcuts</h1><span>K or Esc closes</span></div><div class="keycols">
    ${grp('Anywhere', [['K', 'These shortcuts'], ['S', 'Settings'], ['L', 'Open or close the log'], ['M', 'Show or hide the side menu'], ['H', 'Hide the folder panel, then everything, then show it all again'], ['F', 'Full screen (F11 too)'], ['Ctrl + Z', 'Undo the last move'], ['Ctrl + =', 'Everything bigger (Ctrl and plus)'], ['Ctrl + −', 'Everything smaller'], ['Ctrl + 0', 'Everything back to 100%'], ['Esc', 'Close a dialog, the log or the viewer']])}
    ${grp('On a list of pictures', [['Click', 'Select one'], ['Ctrl + Click', 'Add to or take from the selection'], ['Shift + Click', 'Select a range'], ['Drag', 'Draw a box to select many'], ['Ctrl + A', 'Select everything shown'], ['Esc', 'Deselect all'], ['/', 'Jump to the folder box (with pictures selected)'], ['Ctrl + F', 'Jump to the search box'], ['A', 'Approve the selected (they move straight away)'], ['R', 'Reject the selected'], ['Q', 'Find higher quality on / off'], ['P', 'Move to the other side (Art ⇄ Real life)'], ['T', 'Open the viewer'], ['Ctrl + Wheel', 'Bigger or smaller pictures'], ['Ctrl + Shift + Wheel', 'Cards: more or fewer columns']])}
    ${grp('In the viewer', [['← →', 'Previous / next'], ['PgUp PgDn', 'Previous / next'], ['Home End', 'First / last'], ['A', 'Approve (moves it)'], ['R', 'Reject'], ['X', 'Select or deselect this picture'], ['Q', 'Find higher quality on / off'], ['P', 'Move to the other side'], ['/', 'Jump to the folder box'], ['↑ ↓', 'Zoom in / out (volume on a video)'], ['+ −', 'Zoom'], ['0', 'Fit'], ['1', 'Actual size'], ['Space', 'Play / pause a video'], ['U', 'Mute / unmute a video'], ['I', 'Show or hide the side panel'], ['H', 'Just the picture'], ['T Esc', 'Close the viewer']])}
    ${grp('Dialogs', [['Enter', 'Confirm'], ['Esc', 'Cancel']])}
    </div>`, null, 'keys');
}

// The one-line header (DESIGN.md "The rest of the window"): title, then what the screen does, cut short with "…".
// Screens still write <h1> + <p class="sub">; this turns them into the header line with a "More" for the full text.
function headerLine(el) {
  const h = el.querySelector(':scope > h1'); if (!h || h.closest('.hd')) return;
  const p = h.nextElementSibling && h.nextElementSibling.classList.contains('sub') ? h.nextElementSibling : null;
  const hd = document.createElement('div'); hd.className = 'hd'; h.replaceWith(hd); hd.appendChild(h);
  if (p) {
    const full = p.innerHTML; const plain = p.textContent.trim(); const first = (plain.match(/^.*?[.!?](\s|$)/) || [plain])[0].trim().replace(/\.$/, '');
    const sp = document.createElement('span'); sp.className = 'hdsub'; sp.textContent = first; sp.title = plain; hd.appendChild(sp);
    if (plain.length > first.length + 2) { const b = document.createElement('button'); b.className = 'more'; b.textContent = 'More'; hd.appendChild(b); const box = document.createElement('p'); box.className = 'hdfull hidden'; box.innerHTML = full; hd.after(box); b.onclick = () => { box.classList.toggle('hidden'); b.textContent = box.classList.contains('hidden') ? 'More' : 'Less'; }; }
    p.remove();
  }
}

// ---------- router ----------

const ALIASES = { apply: 'undo', unmapped: 'review' };
function curRoute() { const r = (location.hash || '#setup').slice(1).split('/')[0]; return ALIASES[r] || r; }
new MutationObserver(() => headerLine($('#view'))).observe($('#view'), { childList: true });
function route(soft) {
  const r = curRoute();
  $$('nav a[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === r));
  const v = views[r] || views.setup;
  if (soft && v.soft === false) return;
  const view = $('#view'); view.style.padding = ''; view.className = v.browse ? 'browse' : '';
  document.body.classList.toggle('isbrowse', !!v.browse);
  $('#tscr').textContent = '· ' + (SCREEN_NAMES[r] || r);
  v.render(view);
}
window.addEventListener('hashchange', async () => { if (!$('#viewer').classList.contains('hidden')) closeViewerNow(); route(); if (NVH.pendingViewer != null) await navApplyViewer(); else if (!history.state || !history.state.r) navReplace(); });

// ---------- H cycles: folder panel -> everything -> back ----------
function cycleHide() {
  const b = document.body;
  if (!b.classList.contains('hideui') && b.classList.contains('isbrowse') && !b.classList.contains('nosb')) b.classList.add('nosb');
  else if (!b.classList.contains('hideui')) b.classList.add('hideui');
  else b.classList.remove('hideui', 'nosb');
}
