
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
    const b = $('#bulk'); if (!b) return; const n = RV.sel.size; const c = RV.cfg; const moved = c.scope !== 'new' && selItems().every((i) => i.status === 'moved');
    const dis = n ? '' : 'disabled';
    const left = `<b class="selcount">${n ? n + ' selected' : 'Nothing selected'}</b>${n ? '<button class="ghost" id="b_none" title="Deselect all (Esc)">Deselect all</button>' : ''}<button class="ghost" id="b_all">Select all shown</button>`;
    const send = `<button class="ghost" id="b_sn" ${dis} title="Look these pictures up on SauceNAO in the background">Send to SauceNAO</button>`;
    const fhq = c.scope === 'sauce' ? '' : `<button class="ghost" id="b_fhq" ${dis} title="Mark / unmark as “Find higher quality” (Q)">Find HQ</button>`;
    const folder = `${folderSelect('b_folder', '', 'style="width:230px" title="Pick a folder — the pictures move there straight away"')}`;
    const rate = moved ? '' : `<select id="b_rate" ${dis} title="NSFW / Very label — applies at once and keeps them selected"><option value="" hidden>Rating…</option><option value="general">General</option><option value="nsfw">NSFW</option><option value="very">Very</option><option value="mixed" hidden>Rating: mixed</option></select>`;
    const toReal = !selItems().length ? RV.realm !== 'real' : selItems().some((x) => (x.realness || 'art') === 'art');
    const real = moved ? '' : `<button class="ghost" id="b_real" ${dis} title="Wrong side? Moves the selected to the ${toReal ? 'Real life' : 'Art'} list and tells the app which model was wrong (P)">${toReal ? 'Move to Real (P)' : 'Move to Art (P)'}</button>`;
    let mid;
    const dests = [...new Set(selItems().map((i) => destOf(i)).filter(Boolean))];
    const okLabel = !n ? 'Approve &amp; move' : dests.length === 1 ? `Approve → ${esc(dests[0])}` : dests.length > 1 ? `Approve (${dests.length} folders)` : 'Approve';
    if (c.scope === 'new') mid = `<button class="ok" id="b_ok" ${dis} title="Approve — they are moved right away (A)${dests.length === 1 ? ' to ' + esc(dests[0]) : ''}">${okLabel} (A)</button><button class="bad" id="b_no" ${dis} title="Reject (R)">Reject (R)</button><button class="ghost" id="b_rs" ${dis} title="Forget my approval / rejection / folder / rating choice for these">Undo choice</button>`;
    else if (c.scope === 'sauce') mid = c.sstate === 'waiting' ? `<button class="ghost" id="b_dq" ${dis}>Remove from queue</button>` : `<button class="ghost" id="b_rq" ${dis}>Look up again</button><button class="ghost" id="b_use" ${dis} title="Move to the folder the best match points to">Use matched folder</button>`;
    else mid = '';
    const hqb = (c.scope === 'fhq' || c.scope === 'sauce') ? `<button class="ok" id="b_found" ${dis} title="A better copy was found: this one goes to the Recycle Bin and is noted in the log">Found Higher Quality</button><button class="ghost" id="b_manual" ${dis} title="No better copy found: move to the “Find Higher Quality Manually” folder">Send to Find HQ Manually</button>` : '';
    mid += hqb;
    const one = n === 1 && RV.cfg.scope !== 'new' ? '<button class="ghost" id="b_copy">Copy image</button><button class="ghost" id="b_reveal">Show file</button>' : '';
    const all = c.scope === 'new' ? `<span class="grow"></span><button id="b_allok" ${RV.total ? '' : 'disabled'}>Approve all ${fmtNum(RV.total)} matching</button>` : '<span class="grow"></span>';
    b.innerHTML = left + '<span class="sp"></span>' + mid + folder + rate + fhq + real + (c.scope === 'sauce' ? '' : send) + one + all;
    const ids = () => [...RV.sel];
    if ($('#b_none')) $('#b_none').onclick = () => this.deselectAll();
    $('#b_all').onclick = () => this.selectAll();
    if (rate) { const sel = $('#b_rate'); const cr = this.commonRating(); if (cr) sel.value = cr; sel.onchange = async () => { if (!sel.value || sel.value === 'mixed') return; await act(ids(), { action: 'setRating', rating: sel.value }, 'Rating set'); this.bulk(); }; }
    const fi = $('#b_folder');
    const go = async () => { const f = folderMatch(fi.value); if (!n) return toast('Select pictures first', true); if (!f) return toast('Pick one of the listed folders', true); const its = selItems(); const r = await act(ids(), { folder: f, fhq: its.every((i) => i.fhq) ? 1 : 0 }, (x) => (x && x.moved ? `Moved ${fmtNum(x.moved)} to ${f}` : `Sent to ${f}`), { url: '/move-to' }); fi.value = ''; };
    fi.addEventListener('fbpick', go);
    const on = (id, fn) => { const e = $('#' + id); if (e) e.onclick = fn; };
    on('b_ok', () => this.approve()); on('b_no', () => act(ids(), { action: 'reject' }, 'Rejected')); on('b_rs', () => act(ids(), { action: 'clearChoice' }, 'Choices cleared'));
    on('b_fhq', () => this.toggleFhq()); on('b_real', () => this.markReal());
    on('b_sn', () => this.sendSauce()); on('b_dq', async () => { await api('/sauce/dequeue', { ids: ids() }); toast('Removed from the queue'); this.afterSauceChange(ids()); });
    on('b_rq', async () => { await api('/sauce/requeue', { ids: ids() }); toast('Queued again'); this.afterSauceChange(ids()); });
    on('b_use', () => this.useSauceFolder()); on('b_found', () => this.foundHq()); on('b_manual', () => this.hqManual());
    on('b_copy', () => copyImage(selItems()[0])); on('b_reveal', () => revealFile(selItems()[0]));
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
  async sendSauce(ids) {
    ids = ids || this.ids(); if (!ids.length) return;
    if (selItems().some((i) => i.kind === 'video')) toast('Videos can’t be looked up; only pictures are sent.');
    try {
      const one = ids.length === 1; // one picture: go there and look it up at once; several: go there and wait for you to press Start
      const r = await api('/sauce/queue', { ids, start: one }); refreshState();
      if (viewerOpen()) closeViewerNow();
      views.sauce.tab = 'waiting'; location.hash = '#sauce';
      toast(r.needKey ? `${r.queued} queued, but no lookup site is turned on — see Setup → Source lookup.` : one ? 'Looking it up now.' : `${r.queued} sent. Press Start when you are ready.`, !!r.needKey);
    } catch (e) { toast(e.message, true); }
  },
  // a better copy was found: the old picture goes to the Recycle Bin (through Windows), and is recorded
  async foundHq(ids) {
    ids = ids || this.ids(); if (!ids.length) return;
    if (!(window.csNative && window.csNative.trash)) return toast('The Recycle Bin is only available in the desktop app.', true);
    if (ids.length > 1 && !(await confirmBox('Found a higher quality copy of these?', `${ids.length} pictures go to the Recycle Bin (you can restore them from there) and are noted in the log.`, 'Move to Recycle Bin', true))) return;
    const its = RV.items.filter((i) => ids.includes(i.id));
    const res = await window.csNative.trash(its.map((i) => i.path)); const okPaths = new Set(res.filter((r) => r.ok).map((r) => r.file));
    const okIds = its.filter((i) => okPaths.has(i.path)).map((i) => i.id);
    if (okIds.length) { await api('/hq/found', { ids: okIds }); this.removeIds(okIds); refreshState(); }
    const bad = res.filter((r) => !r.ok); toast(`${okIds.length} moved to the Recycle Bin and logged.${bad.length ? ' ' + bad.length + ' could not be moved: ' + bad[0].error : ''}`, !!bad.length);
  },
  async hqManual(ids) {
    ids = ids || this.ids(); if (!ids.length) return;
    try { const r = await api('/hq/manual', { ids }); this.removeIds(ids); refreshState(); toast(`${r.moved} moved to “${r.folder}”.`); } catch (e) { toast(e.message, true); }
  },
  afterSauceChange(ids) { if (RV.cfg.scope === 'sauce') this.removeIds(ids); },
  async useSauceFolder() {
    const its = selItems().filter((i) => i.sauce && i.sauce.result && i.sauce.result.folder); if (!its.length) return toast('None of the selected have a matched folder.', true);
    const by = new Map(); its.forEach((i) => { const f = i.sauce.result.folder; (by.get(f) || by.set(f, []).get(f)).push(i.id); });
    for (const [f, ids] of by) await act(ids, { folder: f }, `Moved ${ids.length} to ${f}`, { url: '/move-to' });
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
function closeViewerNow() { const v = $('#viewer'); const m = $('#v_media'); if (m && m.pause) m.pause(); v.classList.add('hidden'); v.innerHTML = ''; document.body.classList.remove('viewing'); VW.id = null; VW.ctx = null; Browse.paintSel && Browse.paintSel(); const t = VW.lastId && $(`.tile[data-id="${VW.lastId}"]`); if (t) t.scrollIntoView({ block: 'nearest' }); }
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
function applyVol() { const m = $('#v_media'); if (m && m.tagName === 'VIDEO') { m.volume = PREFS.volume; m.muted = !!PREFS.muted; } const s = $('#vc_vol'); if (s) s.value = PREFS.muted ? 0 : PREFS.volume; const b = $('#vc_mute'); if (b) b.textContent = PREFS.muted || !PREFS.volume ? 'Unmute' : 'Mute'; }
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
  const t = it.sauce && it.sauce.result && it.sauce.result.top; const sr = it.sauce && it.sauce.result;
  const mrow = (m) => `<div class="mrow"><span class="chip">${esc(m.engine)}</span> ${m.w ? `<b>${m.w}×${m.h}</b>` : '<span class="muted">size unknown</span>'}${m.similarity != null ? ` · ${m.similarity}%` : ''}${m.title || m.site ? `<div class="small muted">${esc([m.title, m.series, m.creator].filter(Boolean).join(' · ') || m.site)}</div>` : ''}${m.url ? `<a class="small" style="color:var(--accent)" target="_blank" rel="noreferrer" href="${esc(m.url)}">Open page</a>` : ''}</div>`;
  const hq = sr && sr.hq;
  const sauce = !it.sauce ? '' : it.sauce.state !== 'done' ? `<h2>Source lookup</h2><p class="small muted">${it.sauce.state === 'error' ? 'The lookup failed — it will be tried again.' : 'Waiting in the lookup queue.'}</p>` :
    `<h2>Source lookup</h2>${hq ? `<p><span class="chip ok">Bigger copy</span> <b>${hq.w}×${hq.h}</b> <span class="muted">vs yours ${it.w}×${it.h} — ${hq.factor}× the pixels${hq.certain ? '' : ' (a possible match, check it)'}</span>${hq.url ? `<br><a style="color:var(--accent)" target="_blank" rel="noreferrer" href="${esc(hq.url)}">Open the bigger copy’s page</a>` : ''}</p>` : '<p class="small muted">No clearly bigger copy found.</p>'}
    ${t ? `<p>${esc(t.series || t.title || 'a match')} <span class="chip ok">${t.similarity}%</span>${sr.folder ? ` <button class="sm" data-fold="${esc(sr.folder)}">Move to ${esc(sr.folder)}</button>` : ''}</p>` : '<p class="small muted">No certain match.</p>'}
    ${(sr.others || []).length ? `<div class="mlist">${sr.others.map(mrow).join('')}</div>` : ''}${sr.errors ? `<p class="small muted">${Object.entries(sr.errors).map(([k, v]) => esc(k + ': ' + v)).join(' · ')}</p>` : ''}`;
  v.classList.toggle('isvid', isVid);
  const rateNow = effRating(it);
  v.innerHTML = `<div class="stage" id="stage">
      ${isVid ? `<video id="v_media" src="${fileUrl(it.id)}" autoplay loop playsinline></video>` : `<img id="v_media" src="${fileUrl(it.id)}" alt="" draggable="false">`}</div>
    <div class="side" id="vside"><div class="sidebody">
      <div class="vtop"><h1 class="vname">${esc(it.name)}</h1><span class="faint small" id="v_count" style="white-space:nowrap">${VW.idx + 1} of ${fmtNum(RV.total)}</span></div>
      <p class="vpath" title="Click to copy the path" id="v_path">${esc(it.path)}</p>
      ${dctx && dm ? `<div class="vbadge ${dm.best ? 'best' : ''}">${dm.best ? '★ Highest quality' : 'Lower quality than the best copy'}${dm.decision === 'keep' ? ' · kept' : dm.decision === 'dupes' ? ' · sent to Dupes' : ''}</div>` : ''}
      <div class="kv"><div>${moved ? 'Is in' : 'Goes to'}</div><div><b>${esc(destOf(it) || '—')}</b>${it.score != null && !moved ? ` · ${Math.round(it.score * 100)}%` : ''}${it.fhq ? ' <span class="chip fhq">Find HQ</span>' : ''}</div>
        ${moved ? '' : `<div>Why</div><div>${esc(it.reason || '—')}</div>${it.fallback ? `<div>Otherwise</div><div>${esc(it.fallback)}</div>` : ''}`}
        <div>Resolution</div><div>${it.w ? it.w + '×' + it.h : '?'}${it.kind === 'video' && it.duration ? ' · ' + dur(it.duration) : ''} · ${it.size ? fmtSize(it.size) : '?'}</div>
        ${it.series ? `<div>Series</div><div>${esc(it.series)}</div>` : ''}<div>Status</div><div>${esc(moved ? 'moved' : it.state)}</div><div>Art or real?</div><div>${(it.realness || 'art') === 'real' ? 'Real life' : 'Art'}${it.realBy === 'you' ? ' (you decided)' : ''}${it.pClip != null ? ` · CLIP ${Math.round(it.pClip * 100)}% real` : ''}${it.pJoy != null ? ` · JoyTag ${Math.round(it.pJoy * 100)}%` : ''}</div>
        <div>Tagged by</div><div>${esc(((S.tagger && S.tagger.options || []).find((o) => o.key === it.tagger) || {}).label || it.tagger || 'not tagged yet')}</div></div>
      ${alt.length ? `<h2>Other candidates · click to move there</h2><div class="row wrap" style="gap:4px">${alt.map((a) => `<span class="chip click" data-fold="${esc(a.folder)}">${esc(a.folder)} ${Math.round(a.score * 100)}%</span>`).join('')}</div>` : ''}
      ${sauce}
      ${dctx ? '' : `<h2>Move to a folder</h2>${folderSelect('v_folder', '', 'title="Pick or search a folder (/) — it moves straight away"')}`}
      ${moved || dctx ? '' : `<span class="seg" id="v_rate" title="NSFW / Very label">${[['general', 'General'], ['nsfw', 'NSFW'], ['very', 'Very']].map(([k, l]) => `<button data-r="${k}" class="${rateNow === k ? 'on' : ''}">${l}</button>`).join('')}</span>`}
      ${dctx ? dupePanel(dctx, dm) : ''}
      ${moved || dctx ? '' : `<div class="vrow"><button class="ok grow" id="v_ok" title="Approve and move (A)">Approve → ${esc(destOf(it) || 'choose a folder first')} (A)</button><button class="bad" id="v_no" title="Reject (R)">Reject (R)</button></div>`}
      <div class="vrow">${moved || dctx ? '' : `<button id="v_rs">Undo choice</button><button id="v_fhq" title="Find higher quality (Q)">${it.fhq ? '✓ Find HQ' : 'Find HQ'} (Q)</button><button id="v_real" title="Wrong side? Move it to the other list (P)">${(it.realness || 'art') === 'art' ? 'To Real (P)' : 'To Art (P)'}</button>`}</div>
      <div class="vrow">${it.kind === 'image' ? `<button id="v_sn">SauceNAO</button>${RV.cfg.scope === 'fhq' || RV.cfg.scope === 'sauce' ? '<button class="ok" id="v_found" title="Found a better copy: this one goes to the Recycle Bin and is logged">Found Higher Quality</button><button id="v_manual" title="Move to the Find Higher Quality Manually folder">Find HQ Manually</button>' : ''}<button id="v_copy">Copy</button>` : ''}<button id="v_reveal">Show file</button>${dctx ? '' : `<button id="v_sel" title="Select / deselect this picture (X)">${RV.sel.has(it.id) ? '✓ Selected' : 'Select'} (X)</button>`}</div>
      ${it.kind === 'image' ? `<div class="dragpad" id="v_drag" draggable="true" title="Drag this onto Google Images / Lens / TinEye in your browser">⠿ Drag the picture to Google Images</div>` : ''}
      <h2>Tags</h2><div id="v_tags" class="tags small muted">…</div></div>
      <div class="vfoot">
        ${isVid ? `<div class="vcontrols"><div class="vrow"><button class="sm" id="vc_play" title="Play / pause (Space)">Pause</button><span class="small" id="vc_t">0:00</span><input type="range" id="vc_seek" min="0" max="1000" value="0" class="grow" style="width:auto"><span class="small" id="vc_d">0:00</span></div><div class="vrow"><button class="sm" id="vc_mute" title="Mute (U)">Mute</button><input type="range" id="vc_vol" min="0" max="1" step="0.01" class="grow" style="width:auto"></div></div>` : ''}
        <div class="vstat" id="v_osd"></div>
        <div class="vrow"><button class="sm" id="v_prev" title="Previous (←)">‹ Prev</button><button class="sm" id="v_next" title="Next (→)">Next ›</button><span class="grow"></span><button class="sm" id="v_close" title="Close (T or Esc)">${icon('x')}Close</button></div>
        <div class="vrow"><button class="sm ghost" id="v_out" title="Zoom out (− or ↓)">−</button><span class="small faint" id="v_zoom" style="min-width:36px;text-align:center">100%</span><button class="sm ghost" id="v_in" title="Zoom in (+ or ↑)">+</button><button class="sm" id="v_fit" title="Fit (0)">Fit</button><button class="sm" id="v_100" title="Actual size (1)">1:1</button><span class="grow"></span><button class="sm ghost" id="v_hide" title="Just the picture (H)">Hide panel</button><button class="sm ghost" id="v_full" title="Full screen (F)">${icon('full')}</button></div>
        <div class="vhint"><kbd>←</kbd> <kbd>→</kbd> move · <kbd>A</kbd> approve · <kbd>R</kbd> reject · <kbd>X</kbd> select · <kbd>/</kbd> folder · <kbd>↑</kbd> <kbd>↓</kbd> ${isVid ? 'volume' : 'zoom'} · <kbd>0</kbd> fit · <kbd>H</kbd> just the picture · <kbd>K</kbd> all keys</div></div></div>`;
  addResizer($('#vside'), 'vs', 'left');
  const media = $('#v_media'), stage = $('#stage');
  // media sizing
  const place = () => { media.style.transform = `translate(${VW.tx - VW.nw * VW.s / 2}px,${VW.ty - VW.nh * VW.s / 2}px) scale(${VW.s})`; $('#v_zoom').textContent = Math.round(VW.s * 100) + '%'; };
  const fitNow = () => { const r = stage.getBoundingClientRect(); VW.fit = Math.min((r.width - 20) / VW.nw, (r.height - 20) / VW.nh, 3); VW.s = VW.fit; VW.tx = 0; VW.ty = 0; place(); };
  const ready = () => { VW.nw = media.naturalWidth || media.videoWidth || 1; VW.nh = media.naturalHeight || media.videoHeight || 1; media.style.width = VW.nw + 'px'; media.style.height = VW.nh + 'px'; fitNow(); media.classList.add('ready'); };
  if (isVid) media.addEventListener('loadedmetadata', ready); else if (media.complete && media.naturalWidth) ready(); else media.addEventListener('load', ready);
  VW.fitNow = fitNow; VW.place = place;
  const zoomAt = (f, cx, cy) => { const r = stage.getBoundingClientRect(); const x = (cx ?? r.left + r.width / 2) - r.left - r.width / 2, y = (cy ?? r.top + r.height / 2) - r.top - r.height / 2; const s2 = Math.min(40, Math.max(0.05, VW.s * f)); VW.tx = x - (x - VW.tx) * s2 / VW.s; VW.ty = y - (y - VW.ty) * s2 / VW.s; VW.s = s2; place(); };
  VW.zoomAt = zoomAt;
  stage.onwheel = (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };
  let drag = null;
  stage.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, tx: VW.tx, ty: VW.ty, moved: false }; stage.classList.add('drag'); stage.setPointerCapture(e.pointerId); };
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
    media.addEventListener('timeupdate', () => { if (!seek.dataset.drag) seek.value = media.duration ? (media.currentTime / media.duration) * 1000 : 0; $('#vc_t').textContent = mmss(media.currentTime); });
    media.addEventListener('loadedmetadata', () => { $('#vc_d').textContent = mmss(media.duration); applyVol(); });
    media.addEventListener('play', () => ($('#vc_play').textContent = 'Pause')); media.addEventListener('pause', () => ($('#vc_play').textContent = 'Play'));
    $('#vc_play').onclick = () => (media.paused ? media.play() : media.pause());
    seek.oninput = () => { seek.dataset.drag = 1; if (media.duration) media.currentTime = (seek.value / 1000) * media.duration; }; seek.onchange = () => delete seek.dataset.drag;
    $('#vc_mute').onclick = toggleMute; $('#vc_vol').oninput = (e) => setVolume(+e.target.value);
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
  on('v_fhq', () => vFhq()); on('v_real', () => vReal()); on('v_sn', () => Browse.sendSauce([it.id])); on('v_found', () => vDo((x) => Browse.foundHq([x.id]), false)); on('v_manual', () => vDo((x) => Browse.hqManual([x.id]), false)); on('v_copy', () => copyImage(it)); on('v_reveal', () => revealFile(it));
  $$('#v_rate [data-r]').forEach((b) => (b.onclick = async () => { await act([it.id], { action: 'setRating', rating: b.dataset.r }, null); osd('Rating: ' + b.textContent); if (viewerOpen() && VW.id === mine) { const c = vIt(); if (c) $$('#v_rate [data-r]').forEach((x) => x.classList.toggle('on', x.dataset.r === effRating(c))); } }));
  const dg = $('#v_drag'); if (dg) dg.addEventListener('dragstart', (e) => { if (window.csNative) { e.preventDefault(); nativeDrag(it); } else { e.dataTransfer.setData('DownloadURL', `image/jpeg:${it.name}:${location.origin}${fileUrl(it.id)}`); e.dataTransfer.setData('text/uri-list', location.origin + fileUrl(it.id)); } });
  // tags (loaded after the picture appears)
  api('/tags/file?id=' + it.id).then((rows) => { if (VW.id !== mine) return; const min = (S.settings.tagger || {}).minConfidence ?? 0.35; const el = $('#v_tags'); if (!el) return; el.innerHTML = rows.map((r) => `<span class="tg ${r.conf < min ? 'dim' : ''} c${r.cat}" data-tag="${esc(r.tag)}" title="${Math.round(r.conf * 100)}% sure — click to select this tag">${esc(r.tag)} <i>${Math.round(r.conf * 100)}</i></span>`).join('') || 'No tags yet — read the files again after choosing a tag model.'; $$('.tg[data-tag]', el).forEach((t) => (t.onclick = (ev) => { const tag = t.dataset.tag; closeViewerNow(); Browse.pickTag(tag, ev.altKey); })); }).catch(() => {});
  // preload neighbours
  for (const k of [1, -1]) { const nx = RV.items[VW.idx + k]; if (nx && nx.kind !== 'video') new Image().src = fileUrl(nx.id); }
}
function vToggleSelect() { const it = vIt(); if (!it) return; RV.sel.has(it.id) ? RV.sel.delete(it.id) : RV.sel.add(it.id); const b = $('#v_sel'); if (b) b.textContent = (RV.sel.has(it.id) ? '✓ Selected' : 'Select') + ' (X)'; osd(RV.sel.has(it.id) ? `Selected (${RV.sel.size})` : `Deselected (${RV.sel.size})`); }
const vApprove = () => vDo((x) => Browse.approve([x.id]), true);
const vReject = () => vDo((x) => act([x.id], { action: 'reject' }, 'Rejected'), true);
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
  if (e.ctrlKey && k !== 'a') return;
  if (k === 'k') { used(); return shortcutsDialog(); }
  if (modalOpen) { if (k === 'escape') { used(); closeModal(); } else if (k === 'enter' && $('#cbok')) { used(); $('#cbok').click(); } else if (k.length === 1) used(); return; }
  if (k === 'l') { used(); return Log.toggle(); }
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
    if (dupesCtx && ['a', 'r', 'q', 'p', 'x'].includes(k)) { used(); return; }   // approving / rejecting is not done from a duplicate group
    if (k === 'a') { used(); return vApprove(); } if (k === 'r') { used(); return vReject(); } if (k === 'x') { used(); return vToggleSelect(); }
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
}, true);

// =====================================================================================
//  views
// =====================================================================================
const browseView = (mode) => ({
  browse: true, soft: false,
  async render(el) { await loadChoices(); await refreshState(); if (mode === 'fhq') { try { await api('/fhq/refresh', {}); } catch { /* folder missing */ } } Browse.mount(el, mode); },
  afterJob() { if (document.body.classList.contains('isbrowse')) { Browse.refresh(true, true); } },
  afterSauce() { if (curRoute() === 'sauce') Browse.refresh(); },
});
views.review = browseView('review'); views.real = browseView('real'); views.unsorted = browseView('unsorted'); views.tags = browseView('tags'); views.fhq = browseView('fhq');


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
