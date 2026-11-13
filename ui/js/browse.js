
// =====================================================================================
//  BROWSE: the picture lists (Review, Unsorted, Tags, Find Higher Quality, Source lookup)
// =====================================================================================
const MODES = {
  review: { scope: 'new', realm: 'art', sidebar: 'folders', lanes: true, sort: 'score_desc', title: 'Art', sub: 'Art waiting to be sorted. Approving moves a file straight away into the folder shown; anything can be put back from Undo. Duplicates and possible sets wait in their own screens until you have dealt with them.' },
  real: { scope: 'new', realm: 'real', sidebar: 'folders', lanes: true, sort: 'score_desc', title: 'Real life', sub: 'Photos and videos of real people waiting to be sorted. Approving moves a file straight away; anything can be put back from Undo.' },
  unsorted: { scope: 'new', lane: 'unsorted', sidebar: null, sort: 'path', title: 'Unsorted', sub: 'Files the app could not place with enough confidence. Pick a folder for them, or send them on with “Approve”.' },
  tags: { scope: 'new', realmPick: true, sidebar: 'tags', lanes: true, sort: 'score_desc', title: 'Tags', sub: 'Pick tags on the left to find pictures by what is in them. Click a tag to include it, Alt+click to exclude it.' },
  fhq: { scope: 'fhq', sidebar: null, moved: true, drag: true, sort: 'moved', title: 'Find Higher Quality', sub: 'Pictures you marked “Find higher quality” (Q) after they were moved. Drag one onto Google Images or Lens, or look it up on SauceNAO; when you find a better copy, “Found Higher Quality” sends this one to the Recycle Bin.' },
  sauce_wait: { scope: 'sauce', sstate: 'waiting', sidebar: null, sort: 'sauce_asc' },
  sauce_done: { scope: 'sauce', sstate: 'done', sidebar: null, drag: true, sort: 'hq' },
};
const LANES = [['', 'Everything'], ['art', 'Art'], ['photo', 'Photos'], ['video', 'Videos'], ['lowq', 'Low quality'], ['unsorted', 'Unsorted']];
const SORTS = [
  ['Confidence', [['score_desc', 'Most confident first'], ['score_asc', 'Least confident first']]],
  ['Folder', [['folder', 'A → Z'], ['folder_desc', 'Z → A']]],
  ['Rating', [['rating', 'Very first'], ['rating_asc', 'General first']]],
  ['File name', [['path', 'A → Z'], ['path_desc', 'Z → A']]],
  ['File size', [['size', 'Largest first'], ['size_asc', 'Smallest first']]],
  ['Resolution', [['res', 'Highest first'], ['res_asc', 'Lowest first']]],
  ['Date modified', [['newest', 'Newest first'], ['oldest', 'Oldest first']]],
  ['Other', [['random', 'Random']]],
];
const SORTS_FHQ = [['Moved here', [['moved', 'Most recent first'], ['moved_asc', 'Oldest first']]], ...SORTS.slice(1)];
const SORTS_SAUCE = [['Bigger copy found', [['hq', 'Biggest improvement first'], ['hq_asc', 'Smallest improvement first']]], ['Looked up', [['sauce', 'Most recent first'], ['sauce_asc', 'Oldest first']]], ...SORTS.slice(1)];
const SHOW_OPTS = [['name', 'File name'], ['dest', 'Folder it goes to'], ['rating', 'NSFW / Very label'], ['conf', 'Confidence % (corner)'], ['res', 'Resolution'], ['size', 'File size'], ['flags', 'Flags (low quality, set, dupe, video length…)'], ['why', 'Why it was chosen (cards)'], ['tags', 'Top tags (cards)']];

const BS = {}; // one state per mode, kept while the app is open
function bstate(mode) {
  return BS[mode] || (BS[mode] = { mode, cfg: MODES[mode], lane: MODES[mode].lane || '', folder: '', state: '', sort: MODES[mode].sort, q: '', rating: '', kind: '', fhq: '', hq: '', items: [], total: 0, sel: new Set(), last: null, loading: false, seed: 1, realm: MODES[mode].realm || (MODES[mode].realmPick ? 'art' : ''), tinc: [], texc: [], tmode: 'all', tq: '', tmin: '', tags: [], gen: 0 });
}
let RV = bstate('review'); // the state that is on screen (the viewer and shortcuts work on this)
const modeSorts = (RV) => (RV.cfg.scope === 'fhq' ? SORTS_FHQ : RV.cfg.scope === 'sauce' ? SORTS_SAUCE : SORTS);
const effRating = (it) => it.userRating || it.rating || 'general';
const relFolder = (p) => { const root = (S.settings.destinationRoot || '').replace(/\\/g, '/').replace(/\/+$/, ''); const q = String(p || '').replace(/\\/g, '/'); const rel = root && q.toLowerCase().startsWith(root.toLowerCase() + '/') ? q.slice(root.length + 1) : q; return rel.split('/').slice(0, -1).join('/'); };
const destOf = (it) => (it.status === 'moved' ? relFolder(it.path) : it.userFolder || it.folder);
const sauceLine = (it) => { const r = it.sauce && it.sauce.result; const t = r && r.top; const hq = r && r.hq; return it.sauce ? (it.sauce.state === 'done' ? (hq ? `⬆ ${hq.w}×${hq.h} (${hq.factor}× bigger, ${hq.engine}${hq.certain ? '' : ', possible'})` : t ? `${t.series || t.title || 'match'} · ${t.similarity}%` : 'no certain match') : it.sauce.state === 'error' ? 'lookup failed' : 'waiting for lookup') : ''; };

const Browse = {
  mount(el, mode) {
    RV = bstate(mode); const cfg = RV.cfg; this.el = el; this.mode = mode;
    el.innerHTML = `${cfg.title ? `<h1>${esc(cfg.title)}</h1><p class="sub">${esc(cfg.sub || '')}</p>` : ''}<div class="tbpanel"><div class="toolbar" id="toolbar"></div></div>
      <div class="review"><div class="sidebar" id="sidebar"></div><div class="rmain"><div class="sum" id="sum"></div>
      <div class="grid" id="grid"></div><div class="bulk" id="bulk"></div></div></div>`;
    this.drawToolbar(); this.drawSidebar(); this.applyGridPrefs();
    this.load(true);
    const g = $('#grid');
    g.addEventListener('scroll', () => { if (g.scrollTop + g.clientHeight > g.scrollHeight - 600 && RV.items.length < RV.total) this.load(false); });
    g.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    g.addEventListener('pointerdown', (e) => this.pointerDown(e));
    g.addEventListener('click', (e) => { if (this.justDragged) { this.justDragged = false; return; } const tg = RV.cfg.sidebar === 'tags' && e.target.closest('.tg[data-tag]'); if (tg) { e.stopPropagation(); return this.pickTag(tg.dataset.tag, e.altKey); } const t = e.target.closest('.tile'); if (t) this.click(t, e); });
    g.addEventListener('dblclick', (e) => { const t = e.target.closest('.tile'); if (t) openViewer(+t.dataset.id); });
    g.addEventListener('mouseover', (e) => this.hover(e)); g.addEventListener('mouseout', (e) => this.unhover(e));
    g.addEventListener('dragstart', (e) => this.dragStart(e));
    g.addEventListener('contextmenu', (e) => { const t = e.target.closest('.tile'); if (t && !RV.sel.has(+t.dataset.id)) { RV.sel.add(+t.dataset.id); this.paintSel(); } });
  },

  // ---------- toolbar / tabs ----------
  drawToolbar() {
    const cfg = RV.cfg;
    const sorts = modeSorts(RV);
    const lay = PREFS.layout;
    $('#toolbar').innerHTML = `${cfg.sidebar ? `<button class="ghost line" id="sbtoggle" title="Show / hide the ${cfg.sidebar === 'tags' ? 'tag' : 'folder'} panel (H)">${cfg.sidebar === 'tags' ? 'Tags' : 'Folders'} ◧</button>` : ''}
      <input type="text" id="rq" placeholder="Search file names…  (Ctrl+F)" value="${esc(RV.q)}">
      ${cfg.moved || cfg.scope === 'sauce' ? '' : `<select id="rstate" title="Status"><option value="">Any status</option><option value="pending">Needs review</option><option value="approved">Approved (waiting to move)</option><option value="rejected">Rejected</option></select>`}
      ${cfg.moved ? '' : `<select id="rrate" title="NSFW / Very"><option value="">Any rating</option><option value="general">General</option><option value="nsfw">NSFW</option><option value="very">Very</option></select>`}
      <select id="rkind" title="Pictures or videos"><option value="">Pictures + videos</option><option value="image">Pictures only</option><option value="video">Videos only</option></select>
      ${cfg.scope === 'sauce' && cfg.sstate === 'done' ? `<label class="chk" title="Only pictures where a clearly bigger copy was found"><input type="checkbox" id="rhq" ${RV.hq ? 'checked' : ''}> Bigger copy found</label>` : ''}
      ${cfg.moved || cfg.scope === 'sauce' ? '' : `<label class="chk" title="Only the ones marked Find higher quality"><input type="checkbox" id="rfhq" ${RV.fhq ? 'checked' : ''}> Find HQ only</label>`}
      <span class="grow"></span><button class="ghost" id="rclear">Clear filters</button>`;
    $('#sum').innerHTML = `${cfg.lanes ? `<div class="tabs" id="tabs">${LANES.map(([k, l]) => `<span class="tab ${RV.lane === k ? 'on' : ''}" data-lane="${k}">${l}</span>`).join('')}</div>` : ''}
      <span class="small faint" id="rcount"></span><span class="grow"></span>
      <select id="rsort" title="Sort order" style="width:auto;max-width:240px">${sorts.map(([g, os]) => `<optgroup label="${g}">${os.map(([v, l]) => `<option value="${v}">${g === 'Other' ? l : g + ': ' + l}</option>`).join('')}</optgroup>`).join('')}</select>
      <button class="ghost" id="rshuf" title="New random order">${icon('shuffle')}</button>
      <span class="seg" id="laysw"><button data-lay="grid" class="${lay === 'grid' ? 'on' : ''}">Grid</button><button data-lay="masonry" class="${lay === 'masonry' ? 'on' : ''}">Masonry</button><button data-lay="list" class="${lay === 'list' ? 'on' : ''}">Cards</button><button data-lay="table" class="${lay === 'table' ? 'on' : ''}">List</button></span>
      <label class="rng" title="Picture size (Ctrl + wheel)"><span id="szlab"></span><input type="range" id="rsize"></label>
      <label class="rng" id="colwrap" title="Columns (Ctrl + Shift + wheel)"><span>Columns</span><input type="range" id="rcols" min="1" max="8" step="1"></label>
      <button class="ghost" id="rinfo">Info ▾</button>`;
    $$('#tabs .tab').forEach((t) => (t.onclick = () => { RV.lane = t.dataset.lane; RV.folder = ''; navPush(); this.drawToolbar(); this.drawSidebar(); this.load(true); }));
    $('#rstate') && ($('#rstate').value = RV.state); $('#rrate') && ($('#rrate').value = RV.rating); $('#rkind').value = RV.kind; $('#rsort').value = RV.sort;
    $('#sbtoggle') && ($('#sbtoggle').onclick = () => document.body.classList.toggle('nosb'));
    let tm; $('#rq').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { RV.q = e.target.value; this.refresh(); }, 300); };
    for (const [id, k] of [['rstate', 'state'], ['rrate', 'rating'], ['rkind', 'kind'], ['rsort', 'sort']]) { const n = $('#' + id); if (n) n.onchange = (e) => { RV[k] = e.target.value; if (k === 'sort' && e.target.value === 'random') RV.seed = Math.floor(Math.random() * 1e6); this.refresh(); }; }
    $('#rhq') && ($('#rhq').onchange = (e) => { RV.hq = e.target.checked ? '1' : ''; this.refresh(); });
    $('#rfhq') && ($('#rfhq').onchange = (e) => { RV.fhq = e.target.checked ? '1' : ''; this.refresh(); });
    $('#rshuf').onclick = () => { RV.sort = 'random'; RV.seed = Math.floor(Math.random() * 1e6); $('#rsort').value = 'random'; this.refresh(); };
    $('#rclear').onclick = () => { Object.assign(RV, { lane: cfg.lane || '', folder: '', state: '', rating: '', kind: '', fhq: '', hq: '', q: '', sort: cfg.sort, tinc: [], texc: [], tq: '' }); this.drawToolbar(); this.drawSidebar(); this.load(true); };
    $$('#laysw [data-lay]').forEach((b) => (b.onclick = () => { PREFS.layout = b.dataset.lay; savePrefs(); $$('#laysw [data-lay]').forEach((x) => x.classList.toggle('on', x === b)); this.applyGridPrefs(); this.load(true); }));
    $('#rsize').oninput = (e) => this.setSize(+e.target.value);
    $('#rcols').oninput = (e) => this.setCols(+e.target.value);
    $('#rinfo').onclick = (e) => this.infoMenu(e.currentTarget);
    this.applyGridPrefs(); this.updateCount();
  },
  updateCount() { const c = $('#rcount'); if (c) c.textContent = `${fmtNum(RV.items.length)} of ${fmtNum(RV.total)} shown`; },
  refresh(quiet, keep) { if (!quiet) navPush(); this.load(true, keep); if (RV.cfg.sidebar === 'tags') this.drawTags(); },
  // choose a tag (include it; Alt = exclude it) from anywhere: a picture's tag, the viewer, the tag list
  pickTag(t, exclude) {
    if (RV.cfg.sidebar !== 'tags') { const B = bstate('tags'); B.tinc = exclude ? [] : [t]; B.texc = exclude ? [t] : []; location.hash = '#tags'; return; }
    if (exclude) { RV.tinc = RV.tinc.filter((x) => x !== t); if (!RV.texc.includes(t)) RV.texc.push(t); }
    else { RV.texc = RV.texc.filter((x) => x !== t); if (!RV.tinc.includes(t)) RV.tinc.push(t); }
    document.body.classList.remove('nosb'); this.refresh();
  },

  // ---------- layout prefs ----------
  applyGridPrefs() {
    const g = $('#grid'); if (!g) return; const lay = PREFS.layout, sh = PREFS.show || {};
    const off = SHOW_OPTS.filter(([k]) => sh[k] === false).map(([k]) => 'no-' + k);
    if (['name', 'dest', 'res', 'size', 'why', 'tags'].every((k) => sh[k] === false)) off.push('no-meta');
    if (sh.rating === false && sh.flags === false) off.push('no-badges');
    g.className = `grid ${lay} ${off.join(' ')} ${RV.cfg.drag ? 'dragmode' : ''}`;
    g.style.setProperty('--tile', PREFS.tile + 'px'); g.style.setProperty('--cols', PREFS.cols); g.style.setProperty('--cardh', PREFS.cardh + 'px'); g.style.setProperty('--thw', (PREFS.thw || 40) + 'px');
    const sz = $('#rsize'); if (sz) { if (lay === 'list') { sz.min = 70; sz.max = 420; sz.step = 5; sz.value = PREFS.cardh; $('#szlab').textContent = 'Card height'; } else if (lay === 'table') { sz.min = 18; sz.max = 160; sz.step = 2; sz.value = PREFS.thw || 40; $('#szlab').textContent = 'Thumbnails'; } else { sz.min = 90; sz.max = lay === 'masonry' ? 760 : 560; sz.step = 10; sz.value = Math.min(+sz.max, PREFS.tile); $('#szlab').textContent = 'Size'; } }
    const cw = $('#colwrap'); if (cw) { cw.style.display = lay === 'list' ? '' : 'none'; $('#rcols').value = PREFS.cols; }
  },
  setSize(v) { if (PREFS.layout === 'list') PREFS.cardh = v; else if (PREFS.layout === 'table') PREFS.thw = v; else PREFS.tile = v; savePrefs(); this.applyGridPrefs(); },
  setCols(v) { PREFS.cols = Math.max(1, Math.min(8, v)); savePrefs(); this.applyGridPrefs(); },
  wheel(e) {
    if (!e.ctrlKey) return; e.preventDefault(); const up = e.deltaY < 0;
    if (PREFS.layout === 'list') { if (e.shiftKey) this.setCols(PREFS.cols + (up ? -1 : 1)); else this.setSize(Math.max(70, Math.min(420, PREFS.cardh + (up ? 14 : -14)))); }
    else if (PREFS.layout === 'table') this.setSize(Math.max(18, Math.min(160, (PREFS.thw || 40) + (up ? 8 : -8))));
    else this.setSize(Math.max(90, Math.min(PREFS.layout === 'masonry' ? 760 : 560, PREFS.tile + (up ? 20 : -20))));
  },
  infoMenu(btn) {
    const old = $('#infomenu'); if (old) return old.remove();
    const m = document.createElement('div'); m.id = 'infomenu'; m.className = 'popmenu'; const sh = PREFS.show || (PREFS.show = {});
    m.innerHTML = `<div class="row" style="margin-bottom:6px"><b>Show on each picture</b><span class="grow"></span><button class="ghost sm" data-all="1">All on</button><button class="ghost sm" data-all="0">All off</button></div>${SHOW_OPTS.map(([k, l]) => `<label class="chk"><input type="checkbox" data-k="${k}" ${sh[k] !== false ? 'checked' : ''}> ${l}</label>`).join('')}<p class="small muted">All off leaves just the pictures.</p>`;
    document.body.appendChild(m); const r = btn.getBoundingClientRect(); m.style.left = Math.min(innerWidth - 300, r.left) + 'px'; m.style.top = r.bottom + 6 + 'px';
    const apply = () => { savePrefs(); this.applyGridPrefs(); };
    $$('[data-k]', m).forEach((c) => (c.onchange = () => { sh[c.dataset.k] = c.checked; apply(); }));
    $$('[data-all]', m).forEach((b) => (b.onclick = () => { for (const [k] of SHOW_OPTS) sh[k] = b.dataset.all === '1'; $$('[data-k]', m).forEach((c) => (c.checked = b.dataset.all === '1')); apply(); }));
    setTimeout(() => { const off = (e) => { if (!m.contains(e.target) && e.target !== btn) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true); }, 0);
  },

  // ---------- side panel: folders or tags ----------
  drawSidebar() {
    const sb = $('#sidebar'); const kind = RV.cfg.sidebar;
    if (!kind) { sb.style.display = 'none'; return; }
    sb.style.display = '';
    if (kind === 'folders') {
      sb.innerHTML = `<div class="shead">Destination folders<span class="grow"></span><span class="faint" style="font-weight:400">to check</span></div><div class="flist" id="flist"></div>`;
      this.drawFolders();
    } else {
      sb.innerHTML = `<div class="shead"><b>Tags</b><span class="grow"></span><button class="ghost sm" id="tclear">Clear</button></div>
        <div class="tagctl"><input type="text" id="tq" placeholder="Search tags…" value="${esc(RV.tq)}">
        ${RV.cfg.realmPick ? '<div class="row" style="margin:6px 0"><select id="trealm" title="Tags are kept separately for art and for real photos / videos"><option value="art">Art tags</option><option value="real">Real photo / video tags</option><option value="">Both</option></select></div>' : ''}<div class="row" style="margin:6px 0"><select id="tmode" title="How the picked tags combine"><option value="all">Has ALL picked tags</option><option value="any">Has ANY picked tag</option></select></div>
        <label class="rng" title="A tag counts for a picture only when the tagger is at least this sure"><span>Min confidence</span><input type="number" id="tmin" min="0.05" max="0.99" step="0.05" style="width:70px" value="${RV.tmin !== '' ? RV.tmin : ((S.settings.tagger || {}).minConfidence ?? 0.35)}"></label>
        <div id="tchips" class="tchips"></div></div><div class="flist" id="tlist"></div><div class="small muted" style="padding:6px">Click a tag to include it. Alt-click or “−” to exclude it.</div>`;
      $('#tmode').value = RV.tmode; if ($('#trealm')) { $('#trealm').value = RV.realm; $('#trealm').onchange = (e) => { RV.realm = e.target.value; RV.tinc = []; RV.texc = []; this.refresh(); }; }
      let tm; $('#tq').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { RV.tq = e.target.value.trim().toLowerCase(); this.drawTags(); }, 250); };
      $('#tmode').onchange = (e) => { RV.tmode = e.target.value; this.refresh(); };
      $('#tmin').onchange = (e) => { RV.tmin = Math.max(0.05, Math.min(0.99, +e.target.value || 0.35)); this.refresh(); };
      $('#tclear').onclick = () => { RV.tinc = []; RV.texc = []; RV.tq = ''; $('#tq').value = ''; this.refresh(); };
      this.drawTags();
    }
    addResizer(sb, 'sb', 'right');
  },
  async drawFolders() {
    const rows = await api('/folders?realm=' + (RV.realm || '')); const agg = new Map();
    for (const r of rows) { if (RV.lane && r.lane !== RV.lane) continue; const k = r.folder || '(no folder)'; const a = agg.get(k) || { n: 0, pending: 0, key: r.folder || '__none__' }; a.n += r.n; a.pending += r.pending || 0; agg.set(k, a); }
    const fl = $('#flist'); if (!fl) return;
    const tot = [...agg.values()].reduce((x, a) => x + a.pending, 0);
    fl.innerHTML = agg.size ? `<div class="fitem ${!RV.folder ? 'on' : ''}" data-f=""><span>All folders</span><span class="n">${fmtNum(tot)}</span></div>` + [...agg].sort((a, b) => b[1].n - a[1].n).map(([k, a]) => `<div class="fitem ${RV.folder === a.key ? 'on' : ''}" data-f="${esc(a.key)}" title="${a.pending} to check, ${a.n} in all"><span>${esc(k)}</span><span class="n">${a.pending ? fmtNum(a.pending) : '✓ ' + fmtNum(a.n)}</span></div>`).join('') : '<div class="empty">Nothing yet.<br>Press “Scan &amp; tag files” on the Setup screen.</div>';
    $$('.fitem', fl).forEach((f) => (f.onclick = () => { RV.folder = f.dataset.f; navPush(); this.drawFolders(); this.load(true); }));
  },
  async drawTags() {
    const gen = ++RV.gen2 || (RV.gen2 = 1);
    const chips = $('#tchips'); if (!chips) return;
    chips.innerHTML = RV.tinc.map((t) => `<span class="tchip inc" data-rm="inc:${esc(t)}">+ ${esc(t)} ×</span>`).join('') + RV.texc.map((t) => `<span class="tchip exc" data-rm="exc:${esc(t)}">− ${esc(t)} ×</span>`).join('');
    $$('.tchip', chips).forEach((c) => (c.onclick = () => { const [w, t] = c.dataset.rm.split(/:(.*)/s); if (w === 'inc') RV.tinc = RV.tinc.filter((x) => x !== t); else RV.texc = RV.texc.filter((x) => x !== t); this.refresh(); }));
    let r; try { r = await api('/tags?' + this.query(0, { tq: RV.tq, limit: 500 })); } catch (e) { return; }
    if (gen !== RV.gen2) return; const tl = $('#tlist'); if (!tl) return;
    const keepTop = tl.scrollTop;
    tl.innerHTML = r.tags.map((t) => { const inc = RV.tinc.includes(t.tag), exc = RV.texc.includes(t.tag); return `<div class="fitem tgrow ${inc ? 'inc' : ''} ${exc ? 'exc' : ''} c${t.cat}" data-t="${esc(t.tag)}"><span>${esc(t.tag)}</span><span class="n">${t.n} <button class="ghost sm" data-ex="${esc(t.tag)}" title="Exclude this tag">−</button></span></div>`; }).join('') || '<div class="empty">No tags at this confidence.</div>';
    tl.scrollTop = keepTop;
    $$('.fitem.tgrow', tl).forEach((f) => (f.onclick = (e) => this.pickTag(f.dataset.t, !!(e.target.closest('[data-ex]') || e.altKey))));
  },

  // ---------- data ----------
  query(offset, extra = {}) {
    const c = RV.cfg;
    const o = { scope: c.scope, realm: RV.realm || '', sstate: c.sstate || '', lane: RV.lane, folder: RV.folder, state: RV.state, sort: RV.sort, seed: RV.seed, q: RV.q, rating: RV.rating, kind: RV.kind, fhq: RV.fhq, hq: RV.hq, tinc: RV.tinc.join('|'), texc: RV.texc.join('|'), tmode: RV.tmode, tmin: RV.tmin, limit: 120, offset, withtags: (PREFS.show || {}).tags === false ? 0 : 1, ...extra };
    return new URLSearchParams(o).toString();
  },
  async load(reset, keep) {
    if (RV.loading && !reset) return;
    const gen = ++RV.gen; RV.loading = true; let top = 0, want = 0;
    try {
      if (reset) { const g = $('#grid'); if (keep && g) { top = g.scrollTop; want = RV.items.length; } RV.items = []; RV.last = null; if (g && !keep) g.scrollTop = 0; }   // keep: stay where you were (the list was only refreshed)
      const r = await api('/review?' + this.query(reset ? 0 : RV.items.length));
      if (gen !== RV.gen) return; // a newer request replaced this one
      RV.total = r.total; RV.items.push(...r.items);
      for (let n = 0; keep && RV.items.length < want && RV.items.length < r.total && n < 10; n++) { const r2 = await api('/review?' + this.query(RV.items.length)); if (gen !== RV.gen || !r2.items.length) break; RV.items.push(...r2.items); }
      const have = new Set(RV.items.map((i) => i.id)); for (const id of [...RV.sel]) if (reset && !have.has(id)) RV.sel.delete(id);
      this.draw(reset);
      if (keep) { const g = $('#grid'); if (g) { g.scrollTop = top; requestAnimationFrame(() => { g.scrollTop = top; }); } }
    } catch (e) { toast(e.message, true); } finally { if (gen === RV.gen) RV.loading = false; }
  },
  async syncIds(ids) { // re-read these pictures after an action; drop the ones that no longer belong here (moved away)
    if (!ids.length) return;
    const have = new Map(); for (let i = 0; i < ids.length; i += 200) { const r = await api('/review?' + new URLSearchParams({ scope: 'any', ids: ids.slice(i, i + 200).join(','), limit: 500, withtags: PREFS.layout === 'list' ? 1 : 0 }).toString()); for (const it of r.items) have.set(it.id, it); }
    const gone = [];
    for (const id of ids) {
      const idx = RV.items.findIndex((x) => x.id === id); if (idx < 0) continue;
      const it = have.get(id);
      if (!it || !this.belongs(it)) gone.push(id); else { RV.items[idx] = it; this.refreshTile(it); }
    }
    if (gone.length) this.removeIds(gone);
    return { gone };
  },
  belongs(it) {
    const s = RV.cfg.scope;
    if (RV.realm && (it.realness || 'art') !== RV.realm && s === 'new') return false;   // moved to the other side (P)
    if (s === 'new') return it.status === 'new';
    if (s === 'fhq') return it.status === 'moved' && relFolder(it.path).toLowerCase().split('/').includes(String(S.settings.fhqFolder || 'Find Higher Quality').toLowerCase());
    if (s === 'sauce') return !!it.sauce && (RV.cfg.sstate === 'done' ? it.sauce.state === 'done' : it.sauce.state !== 'done');
    return true;
  },
  removeIds(ids) {
    const set = new Set(ids);
    RV.items = RV.items.filter((i) => !set.has(i.id)); RV.total = Math.max(0, RV.total - ids.length);
    for (const id of ids) { RV.sel.delete(id); const t = $(`.tile[data-id="${id}"]`); if (t) t.remove(); }
    this.updateCount(); this.bulk(); this.sidebarSoon();
    if (typeof viewerAfterRemove === 'function') viewerAfterRemove(set);
  },
  sidebarSoon() { clearTimeout(this._sb); this._sb = setTimeout(() => { if (RV.cfg.sidebar === 'folders') this.drawFolders(); else if (RV.cfg.sidebar === 'tags') this.drawTags(); refreshState(); }, 400); },

  // ---------- tiles ----------
  tile(it) {
    const rate = effRating(it); const sh = PREFS.show || {}; const moved = it.status === 'moved';
    const flags = `${it.fhq ? '<span class="chip fhq">Find HQ</span>' : ''}${it.lane === 'lowq' ? '<span class="chip warn">low quality</span>' : ''}${it.lane === 'dupe' ? '<span class="chip warn">dupe</span>' : ''}${it.lane === 'set' ? '<span class="chip">set</span>' : ''}${it.kind === 'video' ? `<span class="chip">${esc(dur(it.duration) || 'video')}</span>` : ''}${it.state === 'approved' ? '<span class="chip ok">approved</span>' : it.state === 'rejected' ? '<span class="chip bad">rejected</span>' : ''}`;
    const dest = destOf(it); const sl = sauceLine(it);
    const tags = (it.tags || []).map(([n, p, c]) => `<span class="tg c${c || 0} ${it.tmin != null && p < it.tmin ? 'dim' : ''}" data-tag="${esc(n)}" title="${Math.round(p * 100)}% sure${RV.cfg.sidebar === 'tags' ? ' — click to add to your selection, Alt+click to exclude' : ''}">${esc(n)} <i>${Math.round(p * 100)}</i></span>`).join('');
    const info = `<div class="dest" title="${esc(it.reason || '')}">${esc(dest || '— choose —')}</div><div class="fn" title="${esc(it.path)}">${esc(it.name)}</div><div class="dim"><span class="res">${it.w ? `${it.w}×${it.h}` : ''}</span><span class="sz">${it.size ? fmtSize(it.size) : ''}</span></div>${sl ? `<div class="sl">${esc(sl)}</div>` : ''}<div class="why">${esc(it.reason || '')}${it.series ? ` · series: ${esc(it.series)}` : ''}</div>${tags ? `<div class="tags">${tags}</div>` : ''}`;
    const ar = it.w && it.h ? `${it.w}/${it.h}` : '1/1';
    if (PREFS.layout === 'table') return `<div class="tile ${RV.sel.has(it.id) ? 'sel' : ''} ${it.state}" data-id="${it.id}" data-kind="${it.kind}" ${RV.cfg.drag ? 'draggable="true"' : ''}><span class="tck"></span><div class="img"><img loading="lazy" draggable="false" src="${thumb(it.id)}" alt=""></div>
      <span class="c" title="${esc(it.path)}">${esc(it.name)}${it.kind === 'video' ? ` <span class="faint">${esc(dur(it.duration) || 'video')}</span>` : ''}</span><span class="c f" title="${esc(it.reason || '')}">${esc(dest || '— choose —')}${it.fhq ? ' <span class="chip fhq">Find HQ</span>' : ''}${it.lane === 'lowq' ? ' <span class="chip warn">low quality</span>' : ''}</span>
      <span class="c">${it.score != null && !moved ? Math.round(it.score * 100) + '%' : '—'}</span><span class="c">${rate === 'general' ? '<span class="faint">General</span>' : ratingChip(rate)}</span><span class="c m">${it.w ? `${it.w}×${it.h}` : '—'}</span><span class="c m">${it.size ? fmtSize(it.size) : '—'}</span></div>`;
    return `<div class="tile ${RV.sel.has(it.id) ? 'sel' : ''} ${it.state}" data-id="${it.id}" data-kind="${it.kind}" ${RV.cfg.drag ? 'draggable="true"' : ''}><div class="img" style="--ar:${ar}"><img loading="lazy" draggable="false" src="${thumb(it.id)}" alt="">
      <div class="badges">${sh.rating !== false ? ratingChip(rate) : ''}${sh.flags !== false ? flags : ''}</div>${it.score != null && !moved ? `<div class="sc">${Math.round(it.score * 100)}%</div>` : ''}<div class="chk">✓</div></div>
      <div class="meta">${info}</div></div>`;
  },
  draw(reset) {
    const g = $('#grid'); if (!g) return;
    // masonry uses CSS columns, which only scroll downwards when the columns sit in a box with no fixed height
    const mas = PREFS.layout === 'masonry', tbl = PREFS.layout === 'table';
    if (reset || (mas !== !!g.querySelector(':scope > .mas')) || (tbl !== !!g.querySelector(':scope > .thead'))) g.innerHTML = mas ? '<div class="mas"></div>' : tbl ? this.thead() : '';
    const host = mas ? g.firstElementChild : g;
    if (reset || !host.querySelector('.tile')) { const th = tbl ? this.thead() : ''; if (!RV.items.length) host.innerHTML = th + `<div class="empty" style="grid-column:1/-1">${this.emptyText()}</div>`; else host.innerHTML = th; if (tbl) this.wireThead(); }
    const start = host.querySelectorAll('.tile').length; if (tbl && !host.querySelector('.thead')) { host.insertAdjacentHTML('afterbegin', this.thead()); this.wireThead(); }
    host.insertAdjacentHTML('beforeend', RV.items.slice(start).map((i) => this.tile(i)).join(''));
    this.updateCount(); this.bulk();
  },
  // List view: a sticky header; every column with a matching sort order sorts (click again to reverse)
  thead() {
    const col = (l, a, d) => { const on = RV.sort === a || RV.sort === d; return `<span class="${a ? 's' : ''} ${on ? 'on' : ''} ${RV.sort === d ? 'up' : ''}" ${a ? `data-sa="${a}" data-sd="${d}"` : ''}>${l}</span>`; };
    const moved = RV.cfg.moved;
    return `<div class="thead"><span></span><span></span>${col('Name', 'path', 'path_desc')}${col(moved ? 'Folder' : 'Goes to', moved ? '' : 'folder', 'folder_desc')}${col('Confidence', moved ? '' : 'score_desc', 'score_asc')}${col('Rating', moved ? '' : 'rating', 'rating_asc')}${col('Resolution', 'res', 'res_asc')}${col('Size', 'size', 'size_asc')}</div>`;
  },
  wireThead() { $$('#grid .thead [data-sa]').forEach((h) => (h.onclick = () => { RV.sort = RV.sort === h.dataset.sa ? h.dataset.sd : h.dataset.sa; const so = $('#rsort'); if (so) so.value = RV.sort; this.refresh(); })); },
  emptyText() { const m = RV.cfg; return m.scope === 'fhq' ? 'Nothing in a Find Higher Quality folder yet.<br>Press Q on pictures and approve them, or use “Re-scan folders”.' : m.scope === 'sauce' ? (m.sstate === 'done' ? 'No lookup results yet.' : 'Nothing is waiting for a lookup.<br>Select pictures anywhere and press “Send to SauceNAO”.') : 'No files match.'; },
  refreshTile(it) { const t = $(`.tile[data-id="${it.id}"]`); if (t) { const n = document.createElement('div'); n.innerHTML = this.tile(it); t.replaceWith(n.firstElementChild); } },
  paintSel() { $$('#grid .tile').forEach((x) => x.classList.toggle('sel', RV.sel.has(+x.dataset.id))); this.bulk(); },

  // ---------- selection ----------
  selectAll() { RV.items.forEach((i) => RV.sel.add(i.id)); this.paintSel(); },
  deselectAll() { RV.sel.clear(); this.paintSel(); },
  click(t, e) {
    if (e.target.closest('button,a,input,select')) return;
    const id = +t.dataset.id; const tiles = $$('#grid .tile');
    if (e.shiftKey && RV.last != null) { const a = tiles.findIndex((x) => +x.dataset.id === RV.last), b = tiles.findIndex((x) => x === t); const [lo, hi] = a < b ? [a, b] : [b, a]; for (let i = lo; i <= hi; i++) RV.sel.add(+tiles[i].dataset.id); }
    else if (e.ctrlKey || e.metaKey || RV.sel.size) { RV.sel.has(id) ? RV.sel.delete(id) : RV.sel.add(id); RV.last = id; }
    else { RV.sel.add(id); RV.last = id; }
    this.paintSel();
  },
  // drag a box over pictures to select them; with something already selected the box adds to it
  pointerDown(e) {
    if (e.button !== 0 || e.target.closest('button,input,select,a,.popmenu')) return;
    const g = $('#grid'); const tile = e.target.closest('.tile');
    if (RV.cfg.drag && tile) return; // in these lists a drag on a picture drags the file itself (to a browser, for example)
    const x0 = e.clientX, y0 = e.clientY; let box = null; const base = new Set(RV.sel); const additive = e.ctrlKey || e.metaKey || e.shiftKey || RV.sel.size > 0;
    let lastE = e, raf = 0;
    const tiles = () => $$('#grid .tile');
    const update = () => {
      const x1 = lastE.clientX, y1 = lastE.clientY; const L = Math.min(x0, x1), T = Math.min(y0, y1), R = Math.max(x0, x1), B = Math.max(y0, y1);
      box.style.cssText = `left:${L}px;top:${T}px;width:${R - L}px;height:${B - T}px`;
      const next = additive ? new Set(base) : new Set();
      for (const t of tiles()) { const r = t.getBoundingClientRect(); if (r.right >= L && r.left <= R && r.bottom >= T && r.top <= B) next.add(+t.dataset.id); }
      RV.sel = next; $$('#grid .tile').forEach((x) => x.classList.toggle('sel', RV.sel.has(+x.dataset.id)));
    };
    const scrollLoop = () => { if (!box) return; const gr = g.getBoundingClientRect(); if (lastE.clientY > gr.bottom - 40) g.scrollTop += 18; else if (lastE.clientY < gr.top + 40) g.scrollTop -= 18; update(); raf = requestAnimationFrame(scrollLoop); };
    const move = (ev) => {
      lastE = ev;
      if (!box && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) { box = document.createElement('div'); box.className = 'marquee'; document.body.appendChild(box); this.unhover(); raf = requestAnimationFrame(scrollLoop); }
      if (box) update();
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); cancelAnimationFrame(raf); if (box) { box.remove(); box = null; this.justDragged = true; setTimeout(() => (this.justDragged = false), 50); this.bulk(); } };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  },
  dragStart(e) {
    const t = e.target.closest('.tile'); if (!t || !RV.cfg.drag) return;
    const it = RV.items.find((x) => x.id === +t.dataset.id); if (!it) return;
    e.preventDefault(); nativeDrag(it);
  },

  // ---------- video hover preview ----------
  hover(e) {
    const t = e.target.closest('.tile'); if (!t || t.dataset.kind !== 'video' || this.hoverTile === t || document.querySelector('.marquee')) return;
    this.unhover(); this.hoverTile = t; const id = +t.dataset.id;
    this.hoverTimer = setTimeout(() => this.previewStart(t, id), 220);
  },
  unhover(e) {
    if (e && e.relatedTarget && this.hoverTile && this.hoverTile.contains(e.relatedTarget)) return;
    clearTimeout(this.hoverTimer); clearInterval(this.hoverAnim); this.hoverTimer = this.hoverAnim = null;
    if (this.hoverTile) { const v = this.hoverTile.querySelector('.vprev'); if (v) v.remove(); this.hoverTile = null; }
  },
  previewStart(t, id) {
    if (this.hoverTile !== t) return; const imgBox = t.querySelector('.img'), img = imgBox.querySelector('img');
    const sprite = new Image(); sprite.onload = () => {
      if (this.hoverTile !== t) return;
      const br = imgBox.getBoundingClientRect(); const ar = (sprite.naturalWidth / 12) / sprite.naturalHeight; const nat = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : ar;
      let w = br.width, h = br.height; if (w / h > nat) w = h * nat; else h = w / nat;
      const v = document.createElement('div'); v.className = 'vprev'; v.style.cssText = `width:${w}px;height:${h}px;background-image:url(${sprite.src});background-size:1200% 100%;background-position:0 0`; imgBox.appendChild(v);
      let i = 0; this.hoverAnim = setInterval(() => { i = (i + 1) % 12; v.style.backgroundPosition = `${(i / 11) * 100}% 0`; }, 260);
    };
    sprite.src = `/api/sprite/${id}${tq}`;
  },
};
