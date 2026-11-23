
// =====================================================================================
//  BULK BAR, actions, views
// =====================================================================================
function nativeDrag(it) { if (window.csNative) window.csNative.startDrag(it.path); }
const selItems = () => RV.items.filter((i) => RV.sel.has(i.id));
const folderMatch = (v) => CHOICES.find((c) => c.toLowerCase() === String(v || '').trim().toLowerCase());

// run something on picture ids, then bring the visible copies up to date (moved ones leave the list)
async function act(ids, body, msg, opts = {}) {
  try {
    const r = await api(opts.url || '/suggestion', { ids, ...body });
    if (r && r.error) toast(r.error, true);
    else if (msg) toast(typeof msg === 'function' ? msg(r) : msg);
    const s = await Browse.syncIds(ids);
    refreshState();
    return { r, gone: (s && s.gone) || [] };
  } catch (e) { toast(e.message, true); return { r: null, gone: [] }; }
}
const approveMsg = (r) => (r && r.moved ? `Approved. ${fmtNum(r.moved)} moved${r.failed ? `, ${r.failed} failed` : ''}.` : r && r.queued ? 'Approved. They move as soon as the current job finishes.' : 'Approved.');

Object.assign(Browse, {
  ids() { return [...RV.sel]; },
  commonRating() { const its = selItems(); if (!its.length) return ''; const r = effRating(its[0]); return its.every((i) => effRating(i) === r) ? r : 'mixed'; },
  bulk() {
    const b = $('#bulk'); if (!b) return; const n = RV.sel.size; const c = RV.cfg; const its = selItems(); const moved = c.scope !== 'new' && its.length && its.every((i) => i.status === 'moved');
    const dis = n ? '' : 'disabled';
    const cr = this.commonRating();
    const toReal = !its.length ? RV.realm !== 'real' : its.some((x) => (x.realness || 'art') === 'art');
    const dests = [...new Set(its.map((i) => destOf(i)).filter(Boolean))];
    const okLabel = !n ? 'Approve' : dests.length === 1 ? `Approve → ${esc(dests[0])}` : dests.length > 1 ? `Approve (${dests.length} folders)` : 'Approve';
    b.innerHTML = `<div class="bgrp"><b class="selcount">${n ? fmtNum(n) + ' selected' : 'Nothing selected'}</b>${n ? '<button class="ghost sm" id="b_none" title="Deselect all (Esc)">Deselect</button>' : ''}<button class="ghost sm" id="b_all" title="Select everything shown (Ctrl + A)">Select all</button></div>
      ${c.scope === 'new' ? `<div class="bgrp"><button class="ok" id="b_ok" ${dis} title="Approve: they are moved right away (A)${dests.length === 1 ? ' to ' + esc(dests[0]) : ''}">${okLabel} <kbd>A</kbd></button><button class="bad" id="b_no" ${dis} title="Reject (R)">Reject <kbd>R</kbd></button></div>` : ''}
      ${moved ? '' : `<div class="bgrp">${rateSeg('b_rate', cr, dis)}</div>`}
      <div class="bgrp">${folderSelect('b_folder', '', 'class="fbox bfold" title="Pick a folder: they move there straight away (/)"')}</div>
      <div class="bgrp"><button id="b_look" ${dis} title="Send to the Look Up folder (L)">${icon('lookup')}Look Up <kbd>L</kbd></button>${moved ? '' : `<button id="b_fhq" ${dis} title="Find higher quality on / off (Q): approved files go to the Find Higher Quality folder">Find HQ <kbd>Q</kbd></button><button id="b_real" ${dis} title="Wrong side? Moves them to the ${toReal ? 'Real life' : 'Art'} list (P)">${toReal ? 'To Real' : 'To Art'} <kbd>P</kbd></button>`}<button id="b_tag" ${dis} title="Tag again with another tagger">${icon('tagagain')}Tag again ▾</button><button class="dg" id="b_del" ${dis} title="Send to the Recycle Bin (Delete)">${icon('trash')}Delete</button>${c.scope === 'new' ? `<button class="ghost" id="b_rs" ${dis} title="Forget my approval / rejection / folder / rating choice for these">Undo choice</button>` : ''}</div>
      <span class="grow"></span>${c.scope === 'new' ? `<button id="b_allok" ${RV.total ? '' : 'disabled'} title="Approve everything matching the tab, folder and filters">Approve all ${fmtNum(RV.total)}</button>` : ''}`;
    const ids = () => [...RV.sel];
    const on = (id, fn) => { const e = $('#' + id); if (e) e.onclick = fn; };
    on('b_none', () => this.deselectAll()); on('b_all', () => this.selectAll());
    $$('#b_rate [data-r]').forEach((x) => (x.onclick = async () => { await this.setRating(ids(), x.dataset.r); this.bulk(); }));
    const fi = $('#b_folder');
    const go = async () => { const f = folderMatch(fi.value); if (!n) return toast('Select pictures first', true); if (!f) return toast('Pick one of the listed folders', true); await act(ids(), { folder: f, fhq: its.every((i) => i.fhq) ? 1 : 0 }, (x) => (x && x.moved ? `Moved ${fmtNum(x.moved)} to ${f}` : `Sent to ${f}`), { url: '/move-to' }); fi.value = ''; };
    fi.addEventListener('fbpick', go);
    on('b_ok', () => this.approve()); on('b_no', () => act(ids(), { action: 'reject' }, 'Rejected')); on('b_rs', () => act(ids(), { action: 'clearChoice' }, 'Choices cleared'));
    on('b_fhq', () => this.toggleFhq()); on('b_real', () => this.markReal()); on('b_look', () => this.lookUp()); on('b_del', () => this.recycle());
    on('b_tag', (e) => tagAgainMenu(e.currentTarget, ids()));
    on('b_allok', async () => { if (!(await confirmBox('Approve and move everything shown?', `This approves all ${fmtNum(RV.total)} files matching the current tab, folder and filters. They are moved straight away — you can put them back from the Undo screen.`, 'Approve &amp; move'))) return; try { const r = await api('/suggestion', { filter: this.filterBody(), action: 'approve' }); toast(approveMsg(r)); RV.sel.clear(); this.refresh(); refreshState(); } catch (e) { toast(e.message, true); } });
  },
  filterBody() { const c = RV.cfg; return { scope: c.scope, lane: RV.lane, folder: RV.folder, state: RV.state || 'pending', q: RV.q, rating: RV.rating, kind: RV.kind, fhq: RV.fhq, tinc: RV.tinc.join('|'), texc: RV.texc.join('|'), tmode: RV.tmode, tmin: RV.tmin }; },
  async approve(ids) { ids = ids || this.ids(); if (!ids.length) return; const { r } = await act(ids, { action: 'approve' }, approveMsg); return r; },
  async toggleFhq(ids) {
    ids = ids || this.ids(); if (!ids.length) return;
    if (selItems().some((i) => i.status === 'moved')) return toast('Pictures that are already moved: pick a folder instead.', true);
    await act(ids, { action: 'toggleFhq' }, (r) => (r && r.fhq ? 'Marked “Find higher quality” — approve to move them into that subfolder' : 'Find higher quality removed'));
  },
  async markReal(real, ids) {
    ids = ids || this.ids(); if (!ids.length) return;
    if (real === undefined) { const its0 = RV.items.filter((i) => ids.includes(i.id)); real = its0.some((i) => (i.realness || 'art') === 'art'); }
    const { r } = await act(ids, { action: 'setReal', real }, null);
    if (r && r.note) toast(r.note);
    const its = RV.items.filter((i) => ids.includes(i.id)); const f = its[0] && (its[0].userFolder || its[0].folder);
    toast(`Marked as ${real ? 'real photos / videos' : 'art'}${its.length === 1 && f ? ' — now goes to ' + f : ''}.`);
  },
  async setRating(ids, rating) { ids = ids || this.ids(); if (!ids.length) return; const n = { general: 'General', nsfw: 'NSFW', very: 'Very' }[rating]; await act(ids, { action: 'setRating', rating }, ids.length > 1 ? `${fmtNum(ids.length)} set to ${n}` : `Rating: ${n}`); },
  // Look Up (L): straight into the Look Up folder (NSFW / Very, Videos and Real life go in their own subfolders)
  async lookUp(ids) {
    ids = ids || this.ids(); if (!ids.length) return;
    try { const r = await api('/lookup', { ids }); if (r.error && !r.moved) return toast(r.error, true); toast(`${fmtNum(r.moved)} sent to Look Up${r.failed ? `, ${r.failed} could not be moved: ${r.error}` : ''}.`, !!r.failed); await Browse.syncIds(ids); refreshState(); return r; } catch (e) { toast(e.message, true); }
  },
  // Delete: to the Recycle Bin through Windows (never deleted for good). Without the Recycle Bin nothing is deleted.
  async recycle(ids) {
    ids = ids || this.ids(); if (!ids.length) return;
    if (!(window.csNative && window.csNative.trash)) return toast('The Recycle Bin can only be reached from the desktop app, so nothing was deleted.', true);
    const its = RV.items.filter((i) => ids.includes(i.id)); if (!its.length) return;
    if (its.length > 1 && !(await confirmBox(`Send ${fmtNum(its.length)} files to the Recycle Bin?`, 'You can restore them from the Recycle Bin. Nothing is deleted for good.', 'Send to Recycle Bin', true))) return;
    let res; try { res = await window.csNative.trash(its.map((i) => i.path)); } catch (e) { return toast('Could not reach the Recycle Bin: ' + e.message + '. Nothing was deleted.', true); }
    const okPaths = new Set(res.filter((r) => r.ok).map((r) => r.file)); const okIds = its.filter((i) => okPaths.has(i.path)).map((i) => i.id);
    if (okIds.length) { try { await api('/deleted', { ids: okIds }); } catch { /* recorded next scan */ } this.removeIds(okIds); refreshState(); }
    const bad = res.filter((r) => !r.ok);
    toast(bad.length ? `${okIds.length} sent to the Recycle Bin. ${bad.length} could not be sent, so they were left alone: ${bad[0].error}` : `${okIds.length === 1 ? 'Sent' : fmtNum(okIds.length) + ' sent'} to the Recycle Bin.`, !!bad.length);
  },
});

async function copyImage(it) {
  if (!it) return;
  try {
    const blob = await (await fetch(fileUrl(it.id))).blob(); let png = blob;
    if (blob.type !== 'image/png') { const bm = await createImageBitmap(blob); const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; cv.getContext('2d').drawImage(bm, 0, 0); png = await new Promise((r) => cv.toBlob(r, 'image/png')); }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); toast('Image copied — paste it into Google Images or Lens.');
  } catch (e) { toast('Could not copy the image (' + e.message + '). Drag it instead.', true); }
}
async function revealFile(it) { try { await api('/open-folder', { which: 'file', id: it.id }); } catch (e) { toast(e.message, true); } }

// General / NSFW / Very buttons: green, orange, red; G, N and V on the keyboard
function rateSeg(id, cur, dis = '') { return `<span class="seg rateseg" id="${id}" title="General / NSFW / Very (G, N, V)">${[['general', 'General', 'G'], ['nsfw', 'NSFW', 'N'], ['very', 'Very', 'V']].map(([k, l, key]) => `<button data-r="${k}" class="r-${k} ${cur === k ? 'on' : ''}" ${dis}>${l} <kbd>${key}</kbd></button>`).join('')}</span>`; }

// a small menu at a point or under a button: [[label, fn, {danger, disabled, note}] | '-' ]
function popMenu(x, y, items, id = 'ctxmenu') {
  const old = $('#' + id); if (old) old.remove();
  const m = document.createElement('div'); m.id = id; m.className = 'popmenu ctx';
  m.innerHTML = items.map((it, i) => (it === '-' ? '<div class="sep"></div>' : typeof it === 'string' ? `<div class="mh">${esc(it)}</div>` : `<button class="mi ${it[2] && it[2].danger ? 'danger' : ''}" data-i="${i}" ${it[2] && it[2].disabled ? 'disabled' : ''}>${it[2] && it[2].icon ? icon(it[2].icon) : '<span class="ic"></span>'}<span>${esc(it[0])}</span>${it[2] && it[2].key ? `<kbd>${esc(it[2].key)}</kbd>` : it[2] && it[2].note ? `<span class="faint small">${esc(it[2].note)}</span>` : ''}</button>`)).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect(); m.style.left = Math.max(6, Math.min(innerWidth - r.width - 6, x)) + 'px'; m.style.top = Math.max(6, Math.min(innerHeight - r.height - 6, y)) + 'px';
  $$('[data-i]', m).forEach((b) => (b.onclick = () => { m.remove(); items[+b.dataset.i][1](); }));
  setTimeout(() => { const off = (e) => { if (!m.isConnected) return document.removeEventListener('pointerdown', off, true); if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true); }, 0);
  const esc2 = (e) => { if (e.key === 'Escape' && m.isConnected) { e.stopPropagation(); m.remove(); document.removeEventListener('keydown', esc2, true); } }; document.addEventListener('keydown', esc2, true);
  return m;
}
// "Tag again" choices: every tagger (the ones not downloaded yet say so) and JoyTag. The new tags are kept next to the old ones.
function tagAgainItems(ids) {
  const opts = ((S.tagger || {}).options || []); const cur = (S.tagger || {}).model;
  const go = async (key) => { try { const r = await api('/retag', { tagger: key, ids }); if (r.error) return toast(r.error, true); toast(`Tagging ${fmtNum(ids.length)} with ${key === 'joytag' ? 'JoyTag' : (opts.find((o) => o.key === key) || {}).short || key}${r.queued ? ' after the current job' : ''}. Its tags are kept next to the others.`, 'info'); } catch (e) { toast(e.message, true); } };
  return [`Tag ${ids.length === 1 ? 'this' : fmtNum(ids.length) + ' files'} again with`, ...opts.map((o) => [o.short + (o.key === cur ? ' (used for sorting)' : ''), () => (o.ready ? go(o.key) : toast(`${o.short} isn’t downloaded yet. Download it in Setup → AI models.`, true)), { note: o.ready ? '' : 'not downloaded' }]), ['JoyTag (photos and real life)', () => go('joytag')]];
}
function tagAgainMenu(btn, ids) { if (!ids.length) return; const r = btn.getBoundingClientRect(); popMenu(r.left, r.bottom + 4, tagAgainItems(ids), 'tagmenu'); }
// right-click on pictures (one, or the whole selection)
function ctxMenu(x, y, ids, inViewer) {
  if (!ids.length) return; const its = RV.items.filter((i) => ids.includes(i.id)); const one = its.length === 1 ? its[0] : null;
  const isNew = its.some((i) => i.status === 'new');
  const n = ids.length > 1 ? ` (${fmtNum(ids.length)})` : '';
  const items = [
    ...(isNew ? [['Approve' + n, () => Browse.approve(ids), { key: 'A', icon: 'check' }], ['Reject' + n, () => act(ids, { action: 'reject' }, 'Rejected'), { key: 'R', icon: 'x' }], '-',
      ['General', () => Browse.setRating(ids, 'general'), { key: 'G' }], ['NSFW', () => Browse.setRating(ids, 'nsfw'), { key: 'N' }], ['Very', () => Browse.setRating(ids, 'very'), { key: 'V' }], '-',
      ['Find higher quality on / off', () => Browse.toggleFhq(ids), { key: 'Q' }], [(its.some((i) => (i.realness || 'art') === 'art') ? 'Move to Real life' : 'Move to Art'), () => Browse.markReal(undefined, ids), { key: 'P' }]] : []),
    ['Look Up' + n, () => (inViewer ? vLook() : Browse.lookUp(ids)), { key: 'L', icon: 'lookup' }],
    '-', ...tagAgainItems(ids).slice(1).map((t) => [t[0].startsWith('JoyTag') ? 'Tag again with JoyTag' : 'Tag again with ' + t[0], t[1], t[2]]),
    '-', ...(one ? [['Show the file in Explorer', () => revealFile(one), { icon: 'examples' }], ...(one.kind === 'image' ? [['Copy the image', () => copyImage(one)]] : []), ['Open in the viewer', () => openViewer(one.id)]] : []),
    '-', ['Send to the Recycle Bin' + n, () => (inViewer ? vDelete() : Browse.recycle(ids)), { key: 'Del', icon: 'trash', danger: true }],
  ];
  popMenu(x, y, items.filter((it, i, a) => !(it === '-' && (i === 0 || a[i - 1] === '-' || i === a.length - 1))));
}

// =====================================================================================
//  VIEWER (no slideshow)
// =====================================================================================
const VW = { idx: 0, id: null, s: 1, tx: 0, ty: 0, nw: 0, nh: 0, fit: 1, open: false, ctx: null };
function vIt() { return RV.items[VW.idx]; }
function viewerOpen() { return !$('#viewer').classList.contains('hidden'); }
async function openViewer(id) {
  if (!RV.items.length) return;
  VW.idx = Math.max(0, RV.items.findIndex((i) => i.id === id)); const v = $('#viewer'); v.classList.remove('hidden', 'noui'); document.body.classList.add('viewing'); await vShow(); navPush();
}
// closing with ✕ / Esc steps back in the history when the viewer was opened as a step, so Back and Close agree
function closeViewer() { if (viewerOpen() && !NVH.lock && history.state && history.state.viewer != null) { history.back(); return; } closeViewerNow(); }
function closeViewerNow() { const v = $('#viewer'); const m = $('#v_media'); if (m && m.pause) { m.pause(); m.removeAttribute('src'); try { m.load(); } catch { /* gone */ } }   /* let go of the file: Windows cannot move or recycle a file that is open */ v.classList.add('hidden'); v.innerHTML = ''; document.body.classList.remove('viewing'); VW.id = null; VW.ctx = null; Browse.paintSel && Browse.paintSel(); const t = VW.lastId && $(`.tile[data-id="${VW.lastId}"]`); if (t) t.scrollIntoView({ block: 'nearest' }); }
function viewerAfterRemove(gone) {
  if (!viewerOpen()) return;
  if (!RV.items.length) return closeViewer();
  if (!gone.has(VW.id)) { VW.idx = Math.max(0, RV.items.findIndex((i) => i.id === VW.id)); const c = $('#v_count'); if (c) c.textContent = `${VW.idx + 1} of ${fmtNum(RV.total)}`; return; }
  VW.idx = Math.min(VW.idx, RV.items.length - 1); vShow();
}
function vMove(d) {
  const n = VW.idx + d; if (n < 0) return;
  if (n >= RV.items.length) { if (RV.items.length < RV.total) Browse.load(false).then(() => { if (RV.items.length > n) { VW.idx = n; vShow(); } }); return; }
  VW.idx = n; vShow();
}
// act on the open picture; if it stays in the list go on to the next one
async function vDo(fn, advance) {
  const it = vIt(); if (!it) return; const id = it.id; const r = await fn(it);
  if (advance && viewerOpen() && VW.id === id && RV.items.some((i) => i.id === id)) vMove(1);
  return r;
}
const volPct = () => Math.round((PREFS.muted ? 0 : PREFS.volume) * 100);
function setVolume(v, save = true) { v = Math.max(0, Math.min(1, v)); PREFS.volume = v; if (v > 0) PREFS.muted = false; applyVol(); if (save) savePrefs(); osd(`Volume ${Math.round(v * 100)}%`); }
function toggleMute() { if (!PREFS.muted && !(PREFS.volume > 0)) PREFS.volume = 0.5; PREFS.muted = !PREFS.muted; applyVol(); savePrefs(); osd(PREFS.muted ? 'Muted' : `Volume ${Math.round(PREFS.volume * 100)}%`); }
function applyVol() { const m = $('#v_media'); if (m && m.tagName === 'VIDEO') { m.volume = PREFS.volume; m.muted = !!PREFS.muted; } const s = $('#vc_vol'); if (s) s.value = PREFS.muted ? 0 : PREFS.volume; const b = $('#vc_mute'); if (b) { b.innerHTML = icon(PREFS.muted || !PREFS.volume ? 'mute' : 'vol'); b.title = (PREFS.muted || !PREFS.volume ? 'Unmute' : 'Mute') + ' (U)'; } }
let osdT; function osd(t) { const o = $('#v_osd'); if (!o) return; o.textContent = t; clearTimeout(osdT); osdT = setTimeout(() => { o.textContent = ''; }, 2500); }
const mmss = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

async function vShow() {
  const it = vIt(); const v = $('#viewer'); if (!it) return closeViewer();
  VW.id = VW.lastId = it.id; const mine = it.id;
  try { if (!NVH.lock && history.state && history.state.viewer != null) history.replaceState({ ...history.state, viewer: it.id }, '', location.href); } catch { /* ok */ }
  if (VW.idx > RV.items.length - 6 && RV.items.length < RV.total) Browse.load(false);
  const isVid = it.kind === 'video' && !/\.gif$/i.test(it.name); const moved = it.status === 'moved';
  const dctx = VW.ctx && VW.ctx.kind === 'dupes' ? VW.ctx : null; const dm = dctx ? dctx.members.find((m) => m.id === it.id) : null;
  const alt = moved ? [] : (it.alt || []).filter((a) => a.folder);
  v.classList.toggle('isvid', isVid);
  const rateNow = effRating(it);
  v.innerHTML = `<div class="stage" id="stage">
      ${isVid ? `<video id="v_media" src="${fileUrl(it.id)}" autoplay loop playsinline></video>
      <div class="vov" id="vov"><button class="vb" id="vc_play" title="Play / pause (Space)">${icon('pause')}</button><span class="vt" id="vc_t">0:00</span><input type="range" id="vc_seek" min="0" max="1000" value="0"><span class="vt" id="vc_d">0:00</span><button class="vb" id="vc_mute" title="Mute (U)">${icon('vol')}</button><input type="range" id="vc_vol" class="vvol" min="0" max="1" step="0.01"><button class="vb" id="vc_full" title="Full screen (F)">${icon('full')}</button></div>` : `<img id="v_media" src="${fileUrl(it.id)}" alt="" draggable="false">`}</div>
    <div class="side" id="vside"><div class="sidebody">
      <div class="vtop"><h1 class="vname">${esc(it.name)}</h1><span class="faint small" id="v_count" style="white-space:nowrap">${VW.idx + 1} of ${fmtNum(RV.total)}</span></div>
      <p class="vpath" title="Click to copy the path" id="v_path">${esc(it.path)}</p>
      ${dctx && dm ? `<div class="vbadge ${dm.best ? 'best' : ''}">${dm.best ? '★ Highest quality' : 'Lower quality than the best copy'}${dm.decision === 'keep' ? ' · kept' : dm.decision === 'dupes' ? ' · sent to Dupes' : ''}</div>` : ''}
      <div class="kv"><div>${moved ? 'Is in' : 'Goes to'}</div><div><b>${esc(destOf(it) || '—')}</b>${it.score != null && !moved ? ` · ${Math.round(it.score * 100)}%` : ''}${it.fhq ? ' <span class="chip fhq">Find HQ</span>' : ''}</div>
        ${moved ? '' : `<div>Why</div><div>${esc(it.reason || '—')}</div>${it.fallback ? `<div>Otherwise</div><div>${esc(it.fallback)}</div>` : ''}`}
        <div>Resolution</div><div>${it.w ? it.w + '×' + it.h : '?'}${it.kind === 'video' && it.duration ? ' · ' + dur(it.duration) : ''} · ${it.size ? fmtSize(it.size) : '?'}</div>
        ${it.series ? `<div>Series</div><div>${esc(it.series)}</div>` : ''}<div>Status</div><div>${esc(moved ? 'moved' : it.state)}</div><div>Art or real?</div><div>${(it.realness || 'art') === 'real' ? 'Real life' : 'Art'}${it.realBy === 'you' ? ' (you decided)' : ''}${it.pClip != null ? ` · CLIP ${Math.round(it.pClip * 100)}% real` : ''}${it.pJoy != null ? ` · JoyTag ${Math.round(it.pJoy * 100)}%` : ''}</div></div>
      ${alt.length ? `<h2>Other candidates · click to move there</h2><div class="row wrap" style="gap:4px">${alt.map((a) => `<span class="chip click" data-fold="${esc(a.folder)}">${esc(a.folder)} ${Math.round(a.score * 100)}%</span>`).join('')}</div>` : ''}
      ${dctx ? '' : `<h2>Move to a folder</h2>${folderSelect('v_folder', '', 'title="Pick or search a folder (/): it moves straight away"')}`}
      ${moved || dctx ? '' : rateSeg('v_rate', rateNow)}
      ${dctx ? dupePanel(dctx, dm) : ''}
      ${moved || dctx ? '' : `<div class="vrow"><button class="ok grow" id="v_ok" title="Approve and move (A)">Approve → ${esc(destOf(it) || 'choose a folder first')} <kbd>A</kbd></button><button class="bad" id="v_no" title="Reject (R)">Reject <kbd>R</kbd></button></div>`}
      <div class="vbtns">${moved || dctx ? '' : `<button id="v_fhq" title="Find higher quality (Q)">${it.fhq ? '✓ ' : ''}Find HQ <kbd>Q</kbd></button><button id="v_real" title="Wrong side? Move it to the other list (P)">${(it.realness || 'art') === 'art' ? 'To Real' : 'To Art'} <kbd>P</kbd></button>`}<button id="v_look" title="Send to the Look Up folder (L)">${icon('lookup')}Look Up <kbd>L</kbd></button><button id="v_tag" title="Tag again with another tagger">${icon('tagagain')}Tag again ▾</button>${moved || dctx ? '' : '<button id="v_rs" title="Forget my choices for this one">Undo choice</button>'}${it.kind === 'image' ? '<button id="v_copy">Copy</button>' : ''}<button id="v_reveal">Show file</button>${dctx ? '' : `<button id="v_sel" title="Select / deselect this picture (X)">${RV.sel.has(it.id) ? '✓ Selected' : 'Select'} <kbd>X</kbd></button>`}<button class="dg" id="v_del" title="Send to the Recycle Bin (Delete)">${icon('trash')}Delete</button></div>
      ${it.kind === 'image' ? `<div class="dragpad" id="v_drag" draggable="true" title="Drag this onto Google Images / Lens / TinEye in your browser">⠿ Drag the picture to Google Images</div>` : ''}
      <h2>Tags</h2><div class="ttabs" id="v_ttabs"></div><div id="v_tags" class="tags small muted">…</div></div>
      <div class="vfoot">
        <div class="vstat" id="v_osd"></div>
        <div class="vrow"><button class="sm" id="v_prev" title="Previous (←)">‹ Prev</button><button class="sm" id="v_next" title="Next (→)">Next ›</button></div>
        <div class="vrow"><span class="small faint">Zoom</span><span class="grow"></span><button class="sm ghost" id="v_out" title="Zoom out (− or ↓)">−</button><span class="small faint" id="v_zoom" style="min-width:3.2em;text-align:center">100%</span><button class="sm ghost" id="v_in" title="Zoom in (+ or ↑)">+</button><button class="sm" id="v_fit" title="Fit (0)">Fit</button><button class="sm" id="v_100" title="Actual size (1)">1:1</button></div>
        <div class="vrow"><button class="sm ghost" id="v_hide" title="Just the picture (H)">Hide panel</button><button class="sm ghost" id="v_full" title="Full screen (F)">${icon('full')}Full screen</button><span class="grow"></span><button class="sm" id="v_close" title="Close (T or Esc)">${icon('x')}Close</button></div>
        <div class="vhint"><kbd>←</kbd> <kbd>→</kbd> move · <kbd>A</kbd> approve · <kbd>R</kbd> reject · <kbd>G</kbd> <kbd>N</kbd> <kbd>V</kbd> rating · <kbd>L</kbd> look up · <kbd>Del</kbd> recycle · <kbd>/</kbd> folder · <kbd>↑</kbd> <kbd>↓</kbd> ${isVid ? 'volume' : 'zoom'} · <kbd>K</kbd> all keys</div></div></div>`;
  addResizer($('#vside'), 'vs', 'left');
  const media = $('#v_media'), stage = $('#stage');
  // media sizing
  const place = () => { media.style.transform = `translate(${VW.tx - VW.nw * VW.s / 2}px,${VW.ty - VW.nh * VW.s / 2}px) scale(${VW.s})`; $('#v_zoom').textContent = Math.round(VW.s * 100) + '%'; fitOverlay(); };
  // the video controls sit on the bottom edge of the video itself (clipped to the stage when zoomed in)
  const fitOverlay = () => { const ov = $('#vov'); if (!ov || !VW.nw) return; const sw = stage.clientWidth, sh = stage.clientHeight;
    const x0 = sw / 2 + VW.tx - VW.nw * VW.s / 2, y1 = sh / 2 + VW.ty + VW.nh * VW.s / 2, x1 = x0 + VW.nw * VW.s; const l = Math.max(0, x0), r = Math.min(sw, x1);
    ov.style.left = l + 'px'; ov.style.right = 'auto'; ov.style.width = Math.max(260, r - l) + 'px'; ov.style.bottom = Math.max(0, sh - y1) + 'px'; if (r - l < 260) ov.style.left = Math.max(0, Math.min(sw - 260, (l + r) / 2 - 130)) + 'px'; };
  const fitNow = () => { const r = stage.getBoundingClientRect(); VW.fit = Math.min((r.width - 20) / VW.nw, (r.height - 20) / VW.nh, 3); VW.s = VW.fit; VW.tx = 0; VW.ty = 0; place(); };
  const ready = () => { VW.nw = media.naturalWidth || media.videoWidth || 1; VW.nh = media.naturalHeight || media.videoHeight || 1; media.style.width = VW.nw + 'px'; media.style.height = VW.nh + 'px'; fitNow(); media.classList.add('ready'); };
  if (isVid) media.addEventListener('loadedmetadata', ready); else if (media.complete && media.naturalWidth) ready(); else media.addEventListener('load', ready);
  VW.fitNow = fitNow; VW.place = place;
  const zoomAt = (f, cx, cy) => { const r = stage.getBoundingClientRect(); const x = (cx ?? r.left + r.width / 2) - r.left - r.width / 2, y = (cy ?? r.top + r.height / 2) - r.top - r.height / 2; const s2 = Math.min(40, Math.max(0.05, VW.s * f)); VW.tx = x - (x - VW.tx) * s2 / VW.s; VW.ty = y - (y - VW.ty) * s2 / VW.s; VW.s = s2; place(); };
  VW.zoomAt = zoomAt;
  stage.onwheel = (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };
  let drag = null;
  stage.onpointerdown = (e) => { if (e.target.closest('.vov')) return; drag = { x: e.clientX, y: e.clientY, tx: VW.tx, ty: VW.ty, moved: false }; stage.classList.add('drag'); stage.setPointerCapture(e.pointerId); };
  stage.onpointermove = (e) => { if (!drag) return; if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true; VW.tx = drag.tx + e.clientX - drag.x; VW.ty = drag.ty + e.clientY - drag.y; place(); };
  stage.onpointerup = () => { const was = drag; drag = null; stage.classList.remove('drag'); if (isVid && was && !was.moved && media.paused !== undefined) { /* click toggles play */ media.paused ? media.play() : media.pause(); } };
  stage.ondblclick = (e) => { if (Math.abs(VW.s - VW.fit) < 0.01) zoomAt(1 / VW.s, e.clientX, e.clientY); else fitNow(); };
  $('#v_in').onclick = () => zoomAt(1.25); $('#v_out').onclick = () => zoomAt(0.8); $('#v_fit').onclick = fitNow; $('#v_100').onclick = () => zoomAt(1 / VW.s);
  $('#v_close').onclick = closeViewer; $('#v_full').onclick = toggleFull; $('#v_hide').onclick = () => { v.classList.add('noui'); osd('Press H or Esc to bring the panel back'); };
  $('#v_path').onclick = () => navigator.clipboard.writeText(it.path).then(() => osd('Path copied')).catch(() => {});
  $('#v_prev').onclick = () => vMove(-1); $('#v_next').onclick = () => vMove(1);
  if ($('#v_sel')) $('#v_sel').onclick = () => vToggleSelect();
  // video controls
  if (isVid) {
    applyVol(); const seek = $('#vc_seek');
    const tEl = $('#vc_t'), dEl = $('#vc_d'), pEl = $('#vc_play');   // held here: the events can still fire just after the viewer closes
    media.addEventListener('timeupdate', () => { if (!seek.dataset.drag) seek.value = media.duration ? (media.currentTime / media.duration) * 1000 : 0; tEl.textContent = mmss(media.currentTime); });
    media.addEventListener('loadedmetadata', () => { dEl.textContent = mmss(media.duration); if (media.isConnected) applyVol(); });
    media.addEventListener('play', () => (pEl.innerHTML = icon('pause'))); media.addEventListener('pause', () => (pEl.innerHTML = icon('play')));
    $('#vc_play').onclick = () => (media.paused ? media.play() : media.pause());
    seek.oninput = () => { seek.dataset.drag = 1; if (media.duration) media.currentTime = (seek.value / 1000) * media.duration; }; seek.onchange = () => delete seek.dataset.drag;
    $('#vc_mute').onclick = toggleMute; $('#vc_vol').oninput = (e) => setVolume(+e.target.value); $('#vc_full').onclick = toggleFull;
    // the controls sit over the bottom of the video, see-through; when the mouse stops over the video they (and the pointer) hide. Moving, or resting on the controls, keeps them.
    const vov = $('#vov'); let idleT = null; let onBar = false;
    const wake = () => { stage.classList.remove('vidle'); clearTimeout(idleT); idleT = setTimeout(() => { if (!onBar && VW.id === mine) stage.classList.add('vidle'); }, 1800); };
    stage.addEventListener('pointermove', wake); stage.addEventListener('pointerenter', wake);
    vov.addEventListener('pointerenter', () => { onBar = true; wake(); }); vov.addEventListener('pointerleave', () => { onBar = false; wake(); });
    vov.addEventListener('pointerdown', (e) => e.stopPropagation()); vov.addEventListener('dblclick', (e) => e.stopPropagation());
    wake();
    media.play().catch(() => {});
    media.addEventListener('error', () => { if (VW.id !== mine || stage.querySelector('.vfail')) return; stage.insertAdjacentHTML('beforeend', `<img class="vfail" src="${thumb(mine)}" alt="">`); osd('This video can’t be played in this window — showing its preview'); });
  }
  // actions
  const reload = async () => { await Browse.syncIds([mine]); if (viewerOpen() && VW.id === mine) vShow(); };
  const moveTo = (f) => vDo(async (x) => { const fi = folderMatch(f) || f; await act([x.id], { folder: fi, fhq: x.fhq ? 1 : 0 }, (r) => (r && r.moved ? `Moved to ${fi}` : `Sent to ${fi}`), { url: '/move-to' }); }, true);
  $$('[data-fold]', v).forEach((c) => (c.onclick = () => moveTo(c.dataset.fold)));
  const fi = $('#v_folder'); const go = () => { const f = folderMatch(fi.value); if (!f) return toast('Pick one of the listed folders', true); moveTo(f); };
  if (fi) fi.addEventListener('fbpick', go);
  if (dctx) wireDupePanel(dctx, it);
  const on = (id, fn) => { const e = $('#' + id); if (e) e.onclick = fn; };
  on('v_ok', () => vApprove()); on('v_no', () => vReject()); on('v_rs', () => vDo((x) => act([x.id], { action: 'clearChoice' }, 'Choice cleared')).then(() => viewerOpen() && vShow()));
  on('v_fhq', () => vFhq()); on('v_real', () => vReal()); on('v_look', () => vLook()); on('v_del', () => vDelete()); on('v_copy', () => copyImage(it)); on('v_reveal', () => revealFile(it));
  on('v_tag', (e) => tagAgainMenu(e.currentTarget, [it.id]));
  stage.addEventListener('contextmenu', (e) => { e.preventDefault(); ctxMenu(e.clientX, e.clientY, [it.id], true); });
  $$('#v_rate [data-r]').forEach((b) => (b.onclick = () => vRate(b.dataset.r)));
  const dg = $('#v_drag'); if (dg) dg.addEventListener('dragstart', (e) => { if (window.csNative) { e.preventDefault(); nativeDrag(it); } else { e.dataTransfer.setData('DownloadURL', `image/jpeg:${it.name}:${location.origin}${fileUrl(it.id)}`); e.dataTransfer.setData('text/uri-list', location.origin + fileUrl(it.id)); } });
  // tags (loaded after the picture appears)
  api('/tags/file?id=' + it.id).then((r) => {
    if (VW.id !== mine) return; const el = $('#v_tags'), tabs = $('#v_ttabs'); if (!el) return;
    const min = (S.settings.tagger || {}).minConfidence ?? 0.35; const sets = r.sets || [];
    if (!sets.length) { el.textContent = 'No tags yet. Tag it with “Tag again”, or scan the files.'; return; }
    const lab = (src) => (src === '' ? `Used for sorting${(it.realness || 'art') === 'real' ? ' (JoyTag)' : r.sortTagger ? ' (' + tagSrcName(r.sortTagger) + ')' : ''}` : tagSrcName(src));
    const show = (src) => { VW.tsrc = src; const set = sets.find((x) => x.src === src) || sets[0]; tabs.innerHTML = sets.map((x) => `<button class="tab ${x.src === set.src ? 'on' : ''}" data-src="${esc(x.src)}">${esc(lab(x.src))} <span class="faint">${x.tags.filter((t) => t.conf >= min).length}</span></button>`).join(''); $$('[data-src]', tabs).forEach((b) => (b.onclick = () => show(b.dataset.src)));
      el.innerHTML = set.tags.map((t) => `<span class="tg ${t.conf < min ? 'dim' : ''} c${t.cat}" data-tag="${esc(t.tag)}" title="${Math.round(t.conf * 100)}% sure — click to find pictures with this tag">${esc(t.tag)} <i>${Math.round(t.conf * 100)}</i></span>`).join('') || 'No tags from this tagger.';
      $$('.tg[data-tag]', el).forEach((t) => (t.onclick = (ev) => { const tag = t.dataset.tag; closeViewerNow(); const B = bstate('tags'); B.tsrc = set.src; Browse.pickTag(tag, ev.altKey); })); };
    show(sets.some((x) => x.src === VW.tsrc) ? VW.tsrc : '');
  }).catch(() => {});
  // preload neighbours
  for (const k of [1, -1]) { const nx = RV.items[VW.idx + k]; if (nx && nx.kind !== 'video') new Image().src = fileUrl(nx.id); }
}
function vToggleSelect() { const it = vIt(); if (!it) return; RV.sel.has(it.id) ? RV.sel.delete(it.id) : RV.sel.add(it.id); const b = $('#v_sel'); if (b) b.textContent = (RV.sel.has(it.id) ? '✓ Selected' : 'Select') + ' (X)'; osd(RV.sel.has(it.id) ? `Selected (${RV.sel.size})` : `Deselected (${RV.sel.size})`); }
const vApprove = () => vDo((x) => Browse.approve([x.id]), true);
const vReject = () => vDo((x) => act([x.id], { action: 'reject' }, 'Rejected'), true);
const vRate = async (r) => { const x = vIt(); if (!x || x.status === 'moved') return; await act([x.id], { action: 'setRating', rating: r }, null); osd('Rating: ' + { general: 'General', nsfw: 'NSFW', very: 'Very' }[r]); if (viewerOpen() && VW.id === x.id) { const c = vIt(); if (c) $$('#v_rate [data-r]').forEach((b) => b.classList.toggle('on', b.dataset.r === effRating(c))); } };
const vLook = () => vDo((x) => Browse.lookUp([x.id]), false);
const vDelete = () => vDo((x) => Browse.recycle([x.id]), false);
const vFhq = async () => { const x = vIt(); if (!x) return; await Browse.toggleFhq([x.id]); if (viewerOpen() && VW.id === x.id) vShow(); };
const vReal = async () => { const x = vIt(); if (!x) return; const real = (x.realness || 'art') === 'art'; await Browse.markReal(real, [x.id]); if (viewerOpen() && VW.id === x.id) vShow(); };

// =====================================================================================
//  keyboard
// =====================================================================================
function typing(e) { const t = e.target; return t && ((t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(t.type)) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
// Shared keys (STANDARDS.md "Keyboard"): K keys, S settings, L log, M menu, H hide, F full screen, Ctrl+Z undo,
// ←→ / PgUp PgDn / Home End move, ↑↓ zoom on pictures (volume on videos), Space play / pause, Esc close.
async function undoLastMove() {
  try { const r = await api('/undo-last', {}); if (r.nothing) return toast('Nothing to undo.', 'info'); toast(`${r.queued ? 'Queued: putting back' : 'Putting back'} the last move (${fmtNum(r.moved)} file${r.moved === 1 ? '' : 's'})…`, 'info'); if (document.body.classList.contains('isbrowse')) setTimeout(() => Browse.refresh(true, true), 1200); } catch (e) { toast(e.message, true); }
}
function vGo(n) { if (!RV.items.length) return; if (n === 'end') { if (RV.items.length < RV.total) return Browse.load(false).then(() => vGo('end')); n = RV.items.length - 1; } VW.idx = Math.max(0, Math.min(RV.items.length - 1, n)); vShow(); }
document.addEventListener('keydown', (e) => {
  if (e.altKey) return;
  const k = e.key.toLowerCase(); const used = () => { e.preventDefault(); e.stopPropagation(); };
  if (typing(e)) { if (e.key === 'Escape') e.target.blur(); return; }
  const modalOpen = !$('#modal').classList.contains('hidden'); const viewing = viewerOpen();
  if (e.ctrlKey && k === 'z' && !modalOpen) { used(); return undoLastMove(); }
  if (e.ctrlKey && k === 'f' && !modalOpen) { used(); if (viewing) return fbOpenFor('#v_folder'); const q = $('#rq'); if (q) { q.focus(); q.select(); } return; }
  if (e.ctrlKey && !e.altKey && ['=', '+', '-', '_', '0'].includes(e.key)) { used(); return stepScale(e.key === '0' ? 0 : e.key === '-' || e.key === '_' ? -1 : 1); }   // Look → Sizes → Overall size
  if (e.ctrlKey && k === 'l') { used(); return Log.toggle(); }
  if (e.ctrlKey && k !== 'a') return;
  if ($('#ctxmenu') || $('#tagmenu')) return;
  if (k === 'k') { used(); return shortcutsDialog(); }
  if (modalOpen) { if (k === 'escape') { used(); closeModal(); } else if (k === 'enter' && $('#cbok')) { used(); $('#cbok').click(); } else if (k.length === 1) used(); return; }
  if (k === 'escape' && Log.isOpen()) { used(); return Log.close(); }
  if (viewing) {
    const media = $('#v_media'); const isVid = media && media.tagName === 'VIDEO'; const v = $('#viewer');
    if (k === 'escape') { used(); return v.classList.contains('noui') ? v.classList.remove('noui') : closeViewer(); }
    if (k === 't') { used(); return closeViewer(); }
    if (k === 'arrowright' || k === 'pagedown') { used(); return vMove(1); } if (k === 'arrowleft' || k === 'pageup') { used(); return vMove(-1); }
    if (k === 'home') { used(); return vGo(0); } if (k === 'end') { used(); return vGo('end'); }
    if (k === 'arrowup' || k === 'arrowdown') { used(); if (isVid) setVolume(PREFS.volume + (k === 'arrowup' ? 0.03 : -0.03)); else VW.zoomAt(k === 'arrowup' ? 1.25 : 0.8); return; }
    if (k === 'u') { used(); if (isVid) toggleMute(); return; }
    if (k === ' ') { used(); if (isVid) media.paused ? media.play() : media.pause(); return; }
    if (e.key === '/') { used(); return fbOpenFor('#v_folder'); }
    const dupesCtx = VW.ctx && VW.ctx.kind === 'dupes';
    if (k === 'l') { used(); return vLook(); }
    if (k === 'delete') { used(); return vDelete(); }
    if (dupesCtx && ['a', 'r', 'q', 'p', 'x', 'g', 'n', 'v'].includes(k)) { used(); return; }   // approving / rejecting is not done from a duplicate group
    if (k === 'a') { used(); return vApprove(); } if (k === 'r') { used(); return vReject(); } if (k === 'x') { used(); return vToggleSelect(); }
    if (k === 'g' || k === 'n' || k === 'v') { used(); return vRate({ g: 'general', n: 'nsfw', v: 'very' }[k]); }
    if (k === 'q') { used(); return vFhq(); } if (k === 'p') { used(); return vReal(); }
    if (k === '+' || k === '=') { used(); return VW.zoomAt(1.25); } if (k === '-') { used(); return VW.zoomAt(0.8); } if (k === '0') { used(); return VW.fitNow(); } if (k === '1') { used(); return VW.zoomAt(1 / VW.s); }
    if (k === 'i') { used(); return v.classList.toggle('noside'); } if (k === 'h') { used(); return v.classList.toggle('noui'); } if (k === 'f' || k === 'f11') { used(); return toggleFull(); }
    if (k === 'm') { used(); return; }
    return;
  }
  if (k === 's') { used(); location.hash = '#settings'; return; }
  if (k === 'm') { used(); return setNav(document.body.classList.contains('nonav')); }
  if (k === 'f' || k === 'f11') { used(); return toggleFull(); }
  if (k === 'h') { used(); return cycleHide(); }
  const isBrowse = document.body.classList.contains('isbrowse'); if (!isBrowse) return;
  if (k === 'a' && e.ctrlKey) { used(); return Browse.selectAll(); }
  if (e.ctrlKey) return;
  if (k === 'escape') { if (RV.sel.size) { used(); Browse.deselectAll(); } return; }
  if (k === 't') { used(); const first = RV.items.find((i) => RV.sel.has(i.id)) || RV.items[0]; return first ? openViewer(first.id) : toast('Nothing to show here yet', 'info'); }
  if (!RV.sel.size) return;
  if (e.key === '/') { used(); return fbOpenFor('#b_folder'); }
  if (k === 'a' && RV.cfg.scope === 'new') { used(); return Browse.approve(); }
  if (k === 'r' && RV.cfg.scope === 'new') { used(); return act(Browse.ids(), { action: 'reject' }, 'Rejected'); }
  if (k === 'q') { used(); return Browse.toggleFhq(); }
  if (k === 'p') { used(); return Browse.markReal(); }
  if (k === 'l') { used(); return Browse.lookUp(); }
  if (k === 'delete') { used(); return Browse.recycle(); }
  if ((k === 'g' || k === 'n' || k === 'v') && RV.cfg.scope === 'new') { used(); return Browse.setRating(null, { g: 'general', n: 'nsfw', v: 'very' }[k]); }
}, true);

// =====================================================================================
//  views
// =====================================================================================
const browseView = (mode) => ({
  browse: true, soft: false,
  async render(el) { await Promise.all([loadChoices(), refreshState()]); Browse.mount(el, mode); },
  afterJob() { if (document.body.classList.contains('isbrowse')) { Browse.refresh(true, true); } },
});
views.review = browseView('review'); views.real = browseView('real'); views.unsorted = browseView('unsorted'); views.tags = browseView('tags');


// ---------- the viewer inside a duplicate group ----------
function dupePanel(ctx, dm) {
  const open = ctx.members.filter((m) => !m.decision);
  const done = dm && dm.decision;
  return `<h2>Duplicate group</h2><p class="small muted" style="margin:0">${dm && dm.best ? 'This is the <b>highest quality</b> copy (largest picture, then largest file).' : 'The highest quality copy is marked ★ in the group; this one is lower quality.'} ${open.length} of ${ctx.members.length} still to decide.</p>
    <div class="row wrap" style="margin-bottom:6px">${done ? `<span class="chip ${done === 'keep' ? 'ok' : ''}">${done === 'keep' ? 'Kept — it is in Review now' : done === 'dupes' ? 'Sent to Dupes' : 'Already moved'}</span>` : `<button id="d_keepthis">Keep this one</button><button id="d_dupethis">Send this one to Dupes</button>`}</div>
    <div class="row wrap"><button class="ok" id="d_keepbest" ${open.length ? '' : 'disabled'} title="Keep the highest quality copy and send every undecided copy to Dupes">Keep highest quality, rest to Dupes</button><button id="d_keepbestonly" ${open.length ? '' : 'disabled'} title="Keep the highest quality copy only; the others stay in this section">Keep highest quality only</button><button id="d_notdupes" title="These pictures are not duplicates">Not duplicates</button></div>`;
}
async function dupeViewerAct(ctx, action, ids) {
  let r; try { r = await api('/dupes/action', { action, group: ctx.group, fileIds: ids }); } catch (e) { return toast(e.message, true); }
  const cur = VW.id;
  const g = (await api('/dupes?limit=500')).groups.find((x) => x.id === ctx.group);
  refreshState();
  if (!g || action === 'notDupes') { closeViewerNow(); toast(action === 'notDupes' ? 'Marked as not duplicates — they are in Review now.' : 'Group finished.'); if (curRoute() === 'dupes') views.dupes.render($('#view')); return; }
  ctx.members = g.members.map((m) => ({ id: m.id, best: m.best, decision: m.decision }));
  toast(action === 'dupes' ? 'Sent to Dupes' : action === 'keep' ? 'Kept — it is in Review now' : 'Done');
  const next = ctx.members.find((m) => !m.decision && m.id !== cur) || ctx.members.find((m) => !m.decision);
  if (next && (ctx.members.find((m) => m.id === cur) || {}).decision) { VW.idx = Math.max(0, RV.items.findIndex((i) => i.id === next.id)); }
  vShow();
}
function wireDupePanel(ctx, it) {
  const on = (id, fn) => { const e = $('#' + id); if (e) e.onclick = fn; };
  const best = ctx.members.find((m) => m.best);
  on('d_keepthis', () => dupeViewerAct(ctx, 'keep', [it.id])); on('d_dupethis', () => dupeViewerAct(ctx, 'dupes', [it.id]));
  on('d_keepbest', () => dupeViewerAct(ctx, 'keepBest')); on('d_keepbestonly', () => dupeViewerAct(ctx, 'keep', best ? [best.id] : []));
  on('d_notdupes', () => dupeViewerAct(ctx, 'notDupes'));
}
