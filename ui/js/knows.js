// =====================================================================================
//  EXAMPLES (which of your folders teach which folder) and WHAT IT KNOWS (what each folder looks for)
// =====================================================================================

// ---------- Examples to learn from ----------
views.examples = {
  soft: false,
  async render(el) {
    el.style.padding = '18px 22px'; await refreshState();
    let ov = await api('/refs/overview'); this.open = this.open || new Set(); this.kids = this.kids || {};
    const KS = '|::|';
    const draw = () => {
      const unmatched = ov.roots.reduce((a, R) => a + R.groups.filter((g) => g.use && !g.ok).length, 0);
      const row = (R, g, depth) => {
        const key = `${R.root}${KS}${g.rel}`; const tgt = g.targets || [];
        const chips = !g.use ? '<span class="chip">not used</span>' : (g.auto && depth ? `<span class="chip">same as its parent</span> ` : g.auto ? '' : '') + tgt.map((t) => `<span class="kc ${ov.dests.some((x) => x === t || x.toLowerCase() === t.toLowerCase()) ? '' : 'badc'}" title="${ov.dests.includes(t) ? 'This destination folder exists' : 'No destination folder with this name'}">${esc(t)}${g.auto && !depth ? '' : ` <i data-rt="${esc(g.rel)}|${esc(t)}" title="Stop teaching this folder">×</i>`}</span>`).join(' ');
        const warn = g.use && !g.ok ? `<span class="chip bad">no destination folder “${esc(g.folder || g.name)}”</span>${g.suggested ? ` <button class="ghost sm" data-sug="${esc(g.rel)}" data-to="${esc(g.suggested)}">Use ${esc(g.suggested)}</button>` : ''}` : '';
        const opts = `<option value="">＋ teach another folder…</option>${ov.dests.filter((x) => !tgt.includes(x)).map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}`;
        const files = g.scanned ? fmtNum(g.files) : g.est != null ? `${fmtNum(g.est)}${g.more ? '+' : ''}` : '—';
        return `<tr class="${depth ? 'kid' : ''} ${!g.use ? 'off' : ''}"><td style="width:34px"><input type="checkbox" data-use="${esc(g.rel)}" ${g.use ? 'checked' : ''} title="Learn from this folder"></td>
          <td style="padding-left:${6 + depth * 22}px"><span class="exp" data-exp="${esc(key)}" title="Show its subfolders">${this.open.has(key) ? '▾' : '▸'}</span> <b>${esc(g.name)}</b></td>
          <td class="num">${files}</td><td class="num">${g.scanned ? fmtNum(g.learned) : '—'}</td>
          <td><div class="kchips" style="max-height:none">${chips}</div>${warn}${g.use ? `<select class="addt" data-add="${esc(g.rel)}">${opts}</select>` : ''}</td>
          <td class="num"><input type="number" min="0" max="5000" style="width:66px" placeholder="${ov.cap}" data-cap="${esc(g.folder || g.name)}" value="${g.cap ?? ''}" title="New pictures to learn from this folder each time you press Learn (empty = ${ov.cap})"></td>
          <td class="num">${g.use && g.learned ? `<button class="ghost sm" data-relearn="${esc(g.rel)}" title="Read again the pictures it has already learned from in this folder">Re-learn</button>` : ''}${g.use ? `<button class="ghost sm" data-learn="${esc(g.rel)}" title="Learn new pictures from this folder only">Learn more</button>` : ''}</td></tr>`;
      };
      const rowsOf = (R, list, depth) => list.map((g) => { const key = `${R.root}${KS}${g.rel}`; return row(R, g, depth) + (this.open.has(key) ? (((this.kids[key] || {}).dirs || []).length ? rowsOf(R, this.kids[key].dirs, depth + 1) : `<tr class="kid"><td></td><td colspan="6" class="small muted" style="padding-left:${30 + depth * 22}px">${this.kids[key] ? 'No subfolders.' : 'Loading…'}</td></tr>`) : ''); }).join('');
      el.innerHTML = `<h1>Examples to learn from</h1>
        <p class="sub">Your own sorted folders teach the app what each destination folder looks like. By default a folder teaches the destination folder <b>with the same name</b>. Open any folder (▸) to see its subfolders, however deep, and give each its own destination. One examples folder can teach <b>several</b> destination folders, and several examples folders can teach the same one. Untick folders that should not teach (unsorted piles, to-do folders). Nothing here ever moves or changes your files.</p>
        <div class="card"><div class="row wrap"><button id="exlearn" title="Learn from new example pictures (pictures it already learned from are not read again)">Learn from new examples</button><button class="ghost" id="exrelearn" title="Read again every picture it has already learned from">Re-learn what it already learned…</button><button class="ghost" id="exrescan" title="Look for new example folders and files">Check for new folders &amp; files</button><button class="ghost" id="exauto" title="Send every folder whose name matches no destination folder to the closest destination folder">Match names automatically${unmatched ? ` (${unmatched} unmatched)` : ''}</button><button class="ghost" id="exadd">Add examples folder…</button><span class="grow"></span>
          <label class="small" title="Each time you press Learn, up to this many NEW pictures are learned from every folder. Pressing it again learns more, different ones.">Learn up to <input type="number" id="excap" min="5" max="5000" value="${ov.cap}" style="width:76px"> new pictures per folder each time</label></div>
          <p class="small muted" style="margin:8px 0 0">Every press of “Learn” takes <b>new, different</b> pictures (spread evenly through each folder) and adds them to what it knows — it does not repeat the ones it has seen. “Re-learn” is for reading the same ones again (for example after changing the AI model).</p></div>
        ${ov.roots.length ? ov.roots.map((R) => `<div class="card"><div class="row"><h2 style="margin:0;word-break:break-all">${esc(R.root)}</h2><span class="grow"></span><span class="small muted">${R.exists ? `${fmtNum(R.total)} files found · ${fmtNum(R.learned)} learned` : '<b class="bad">folder not found</b>'}</span></div>
          ${R.total ? '' : '<p class="small muted">Nothing scanned yet. Untick what you don’t want, then press “Learn from new examples”. File counts below are rough (counting stops at 400 per folder).</p>'}
          <table class="exTable"><tr><th></th><th>Folder in your examples</th><th>Files</th><th>Learned</th><th>Teaches these destination folders</th><th>New per press</th><th></th></tr>${rowsOf(R, R.groups, 0)}</table></div>`).join('') : '<div class="card"><p class="muted">No examples folders yet.</p><button id="exadd2">Add examples folder…</button></div>'}`;
      wire();
    };
    const apply = (r) => { ov = r; draw(); };
    // find a row (top level or loaded kid) by its rel
    const find = (rel) => { for (const R of ov.roots) { const g = R.groups.find((x) => x.rel === rel); if (g) return { R, g }; } for (const k of Object.keys(this.kids)) { const g = ((this.kids[k] || {}).dirs || []).find((x) => x.rel === rel); if (g) return { R: ov.roots.find((r) => k.startsWith(r.root + KS)), g }; } return null; };
    const setTargets = async (rel, list) => apply(list.length ? await api('/refs/map', { rel, folder: list }) : await api('/refs/use', { rel, use: false }));
    const reloadKids = async () => { for (const key of [...this.open]) { const [root, rel] = key.split(KS); try { const p = await api('/refs/probe?' + new URLSearchParams({ root, rel }).toString()); this.kids[key] = { dirs: p.dirs }; } catch { this.kids[key] = { dirs: [] }; } } };
    const act = async (fn) => { const r = await fn(); await reloadKids(); apply(r); };
    const wire = () => {
      $$('[data-use]').forEach((c) => (c.onchange = () => act(() => api('/refs/use', { rel: c.dataset.use, use: c.checked }))));
      $$('[data-add]').forEach((s) => (s.onchange = () => { const f = find(s.dataset.add); const v = s.value; if (!f || !v) return; const cur = f.g.ok ? (f.g.targets || []) : []; act(() => api('/refs/map', { rel: s.dataset.add, folder: [...cur, v] })); }));
      $$('[data-rt]').forEach((i) => (i.onclick = () => { const [rel, t] = i.dataset.rt.split('|'); const f = find(rel); if (!f) return; const list = (f.g.targets || []).filter((x) => x !== t); act(() => (list.length ? api('/refs/map', { rel, folder: list }) : api('/refs/use', { rel, use: false }))); }));
      $$('[data-sug]').forEach((b) => (b.onclick = () => act(() => api('/refs/map', { rel: b.dataset.sug, folder: [b.dataset.to] }))));
      $$('[data-cap]').forEach((i) => (i.onchange = () => act(() => api('/refs/cap', { folder: i.dataset.cap, cap: i.value === '' ? null : +i.value }))));
      $$('[data-exp]').forEach((e) => (e.onclick = async () => {
        const key = e.dataset.exp; if (this.open.has(key)) { this.open.delete(key); return draw(); }
        const [root, rel] = key.split(KS); this.open.add(key); draw();
        try { const p = await api('/refs/probe?' + new URLSearchParams({ root, rel }).toString()); this.kids[key] = { dirs: p.dirs }; } catch { this.kids[key] = { dirs: [] }; }
        draw();
      }));
      const learn = async (body, msg) => { try { await api('/learn', body); toast(msg); } catch (e) { toast(e.message, true); } };
      $$('[data-learn]').forEach((b) => (b.onclick = () => { const f = find(b.dataset.learn); if (f) learn({ folders: f.g.targets }, `Learning new pictures for ${f.g.targets.join(', ')}…`); }));
      $$('[data-relearn]').forEach((b) => (b.onclick = async () => { const f = find(b.dataset.relearn); if (!f) return; if (await confirmBox('Re-learn these pictures?', `The pictures it has already learned from in “${esc(f.g.name)}” are read again. New pictures are not added by this.`, 'Re-learn')) learn({ folders: f.g.targets, relearn: true }, 'Re-learning…'); }));
      const a = $('#excap'); if (a) a.onchange = async () => apply(await api('/refs/cap', { all: +a.value }));
      const au = $('#exauto'); if (au) au.onclick = async () => { const r = await api('/refs/automatch', {}); apply(r); toast(r.matched ? `Matched ${r.matched} folder(s). Check the list, then press Learn.` : 'Nothing to match: every folder already has a destination, or no close name was found.'); };
      const L = $('#exlearn'); if (L) L.onclick = () => learn({}, 'Learning new pictures from your examples…');
      const RL = $('#exrelearn'); if (RL) RL.onclick = async () => { if (await confirmBox('Re-learn everything it already learned?', 'Every example picture it has already learned from is read again (this takes as long as the first time). It does not add new pictures; use “Learn from new examples” for that.', 'Re-learn')) learn({ relearn: true }, 'Re-learning…'); };
      const RS = $('#exrescan'); if (RS) RS.onclick = async () => { try { await api('/rescan', {}); toast('Checking…'); setTimeout(async () => { await reloadKids(); apply(await api('/refs/overview')); }, 2500); } catch (e) { toast(e.message, true); } };
      const add = async () => { const r = await api('/pick-folder', {}); if (!r.path) { if (r.unsupported) toast('The folder picker only works in the app window.', true); return; } const s = await api('/settings'); const roots = s.referenceRoots || []; if (!roots.includes(r.path)) { await api('/settings', { referenceRoots: [...roots, r.path] }); } apply(await api('/refs/overview')); this.autoProbe(ov, apply); };
      const b1 = $('#exadd'), b2 = $('#exadd2'); if (b1) b1.onclick = add; if (b2) b2.onclick = add;
    };
    draw(); this.autoProbe(ov, apply);
  },
  // a root that has never been scanned: count its subfolders so there is something to tick
  async autoProbe(ov, apply) {
    let changed = false;
    for (const R of ov.roots) {
      if (R.total || !R.exists) continue;
      try { const p = await api('/refs/probe?' + new URLSearchParams({ root: R.root, rel: '' }).toString()); for (const g of R.groups) { const d = p.dirs.find((x) => x.name === g.name); if (d) { g.est = d.est; g.more = d.more; changed = true; } } } catch { /* ignore */ }
    }
    if (changed) apply(ov);
  },
  afterJob() { if (curRoute() === 'examples') this.render($('#view')); },
};

// ---------- What it knows ----------
views.knows = {
  soft: false,
  async render(el) {
    el.style.padding = '18px 22px'; await refreshState();
    const data = await api('/knowledge'); const rules = data.rules; this.sel = this.sel && rules.folders[this.sel] ? this.sel : data.folders[0] && data.folders[0].name; this.filter = this.filter || 'all';
    const byName = Object.fromEntries(data.folders.map((f) => [f.name, f]));
    el.innerHTML = `<h1>What it knows</h1><p class="sub">Every folder, what the app currently believes belongs in it, and where that belief comes from. Look at what a folder collects now, remove or add what it looks for, then press <b>Save &amp; re-sort</b>: only pictures you haven’t approved or moved yet are re-decided.</p>
      <div class="knows"><div class="kleft"><input type="text" id="kq" placeholder="Search folders…"><div class="row wrap" id="kf" style="margin:6px 0"></div><div class="klist" id="klist"></div></div><div class="kright" id="kdetail"></div></div>`;
    const flt = [['all', 'All'], ['has', 'Has pictures'], ['attn', 'Needs attention'], ['noex', 'No examples']];
    const attn = (f) => f.enabled && (f.guess > 0 || (f.pending >= 5 && f.avg !== null && f.avg < 0.5) || (!f.profile && f.type !== 'catchall' && f.examples < 4 && f.pending > 0));
    const drawList = () => {
      const q = ($('#kq').value || '').toLowerCase();
      $('#kf').innerHTML = flt.map(([k, l]) => `<button class="ghost sm ${this.filter === k ? 'on' : ''}" data-kf="${k}">${l}</button>`).join('');
      $$('[data-kf]').forEach((b) => (b.onclick = () => { this.filter = b.dataset.kf; drawList(); }));
      const list = data.folders.filter((f) => (!q || f.name.toLowerCase().includes(q)) && (this.filter === 'all' || (this.filter === 'has' && f.pending) || (this.filter === 'attn' && attn(f)) || (this.filter === 'noex' && !f.profile && f.type !== 'catchall')));
      $('#klist').innerHTML = list.map((f) => `<div class="kitem ${f.name === this.sel ? 'on' : ''} ${f.enabled ? '' : 'off'}" data-k="${esc(f.name)}"><div class="kn">${esc(f.name)}</div><div class="km">${fmtNum(f.pending)} waiting${f.avg !== null ? ` · ${Math.round(f.avg * 100)}% sure` : ''}${f.guess ? ` · <b class="warnc">${f.guess} guesses</b>` : ''}</div><div class="km">${f.profile ? `${fmtNum(f.learned)} examples` : f.type === 'catchall' ? 'catch-all' : '<span class="warnc">no examples learned</span>'}</div></div>`).join('') || '<p class="small muted" style="padding:8px">Nothing matches.</p>';
      $$('[data-k]').forEach((e) => (e.onclick = () => { this.sel = e.dataset.k; drawList(); drawDetail(); }));
    };
    const chips = (key, r) => `<div class="kchips" data-ch="${key}">${(r[key] || []).map((t, i) => `<span class="kc">${esc(t)} <i data-rm="${key}:${i}" title="Remove">×</i></span>`).join('') || '<span class="small muted">none</span>'}</div><div class="row"><input type="text" data-add="${key}" placeholder="Add and press Enter…" style="flex:1"></div>`;
    const drawDetail = async () => {
      const name = this.sel; const box = $('#kdetail'); if (!name) { box.innerHTML = ''; return; }
      const r = rules.folders[name]; const sum = byName[name];
      box.innerHTML = '<p class="muted">Loading…</p>';
      const D = await api('/knowledge/folder?' + new URLSearchParams({ name }).toString());
      if (this.sel !== name) return;
      const learnedTag = (arr, kind, list) => arr.map(([t, sh]) => `<span class="lc ${(r[list] || []).map((x) => x.toLowerCase()).includes(t.toLowerCase()) ? 'have' : ''}" data-lt="${list}" data-v="${esc(t)}" title="${Math.round(sh * 100)}% of its examples have this. Click to ${(r[list] || []).includes(t) ? 'it is already in the list' : 'add it to what the folder looks for'}">${esc(t)} <small>${Math.round(sh * 100)}%</small></span>`).join('') || '<span class="small muted">nothing yet</span>';
      box.innerHTML = `<div class="row wrap"><h2 style="margin:0">${esc(name)}</h2><span class="chip">${esc({ series: 'series / game', style: 'style', subject: 'subject', catchall: 'catch-all', mono: 'monochrome' }[r.type] || r.type)}</span><span class="grow"></span><label class="small"><input type="checkbox" id="ken" ${r.enabled !== false ? 'checked' : ''}> Use this folder</label></div>
        <p class="small muted" style="margin:6px 0">${fmtNum(D.pending)} picture(s) waiting here now${sum.avg !== null ? `, on average ${Math.round(sum.avg * 100)}% sure` : ''}${sum.guess ? `, ${sum.guess} of them best guesses` : ''}. <a href="#review" id="kview">Review them (least sure first) →</a></p>
        <div class="card kc2"><h3>Where its examples come from</h3>${D.sources.length ? `<table class="exTable">${D.sources.map((s) => `<tr><td>${esc(s.root ? s.root.replace(/\\/g, '/').split('/').slice(-2).join('/') : '')}/<b>${esc(s.rel)}</b></td><td class="num">${fmtNum(s.learned)} learned of ${fmtNum(s.files)}</td></tr>`).join('')}</table><p class="small muted">Learns from up to ${fmtNum(D.cap)} pictures. <a href="#examples">Change which of your folders feed this one →</a></p>` : `<p class="small muted">No example pictures feed this folder yet, so it only goes by the words below.${r.type === 'catchall' ? '' : ' <a href="#examples">Add or map examples →</a>'}</p>`}</div>
        <div class="card kc2"><h3>What its examples look like (${fmtNum(D.learned.n)} learned)</h3><div class="small muted">Tags most of its examples share. Click one to add it to “looks for”.</div><div class="lcs">${learnedTag(D.learned.tags, 't', 'tags')}</div>
          ${D.learned.chars.length ? `<div class="small muted" style="margin-top:6px">Characters seen in its examples</div><div class="lcs">${learnedTag(D.learned.chars, 'c', 'chars')}</div>` : ''}</div>
        ${D.pending ? `<div class="card kc2"><h3>What it collects right now</h3><div class="small muted">Tags most of the ${fmtNum(D.pending)} waiting pictures have. If these look wrong for this folder, remove the keywords that pull them in, or add tags to “never contains”.</div><div class="lcs">${D.currentTags.map(([t, sh]) => `<span class="lc" data-lt="avoid" data-v="${esc(t)}" title="Click to put “${esc(t)}” in “never contains” for this folder">${esc(t)} <small>${Math.round(sh * 100)}%</small></span>`).join('')}</div>
          <div class="small muted" style="margin-top:8px">Least sure pictures in it:</div><div class="kthumbs">${D.lowest.map((x) => `<a class="kth" href="#review" data-kfile="${x.id}" title="${Math.round((x.score || 0) * 100)}% — ${esc(x.reason || '')}"><img loading="lazy" src="${thumb(x.id)}" alt=""><span>${Math.round((x.score || 0) * 100)}%</span></a>`).join('')}</div></div>` : ''}
        <div class="card kc2"><h3>What it looks for <span class="small muted">(you can edit all of this)</span></h3>
          <label>Tags that point to this folder</label>${chips('tags', r)}<label>Characters</label>${chips('chars', r)}<label>Series / game names (the part in brackets after a character)</label>${chips('series', r)}
          <label>Never contains these tags <span class="small muted">(a picture with one of them is pushed away from this folder)</span></label>${chips('avoid', r)}
          <label>Descriptions for the “looks like” check <span class="small muted">(one per line)</span></label><textarea id="kprompts" rows="3">${esc((r.prompts || []).join('\n'))}</textarea>
          <div class="row wrap" style="margin-top:8px"><label class="small">Confidence needed <input type="number" id="kth" min="0.05" max="0.99" step="0.05" style="width:80px" placeholder="default" value="${r.threshold ?? ''}"></label><span class="grow"></span><button class="ghost" id="kreset">Reset this folder to built-in</button></div></div>`;
      // editing
      const redraw = () => { this.keep = name; drawDetailFromCache(); };
      const addTo = (key, v) => { v = String(v).trim(); if (!v) return; r[key] = r[key] || []; if (!r[key].some((x) => x.toLowerCase() === v.toLowerCase())) r[key].push(v); dirty(); };
      const drawDetailFromCache = () => { drawDetail(); };
      $$('[data-rm]').forEach((i) => (i.onclick = () => { const [k, n] = i.dataset.rm.split(':'); r[k].splice(+n, 1); dirty(); drawDetail(); }));
      $$('[data-add]').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') { addTo(i.dataset.add, i.value); drawDetail(); } }));
      $$('[data-lt]').forEach((c) => (c.onclick = () => { addTo(c.dataset.lt, c.dataset.v); drawDetail(); }));
      $('#kprompts').onchange = (e) => { r.prompts = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); dirty(); };
      $('#kth').onchange = (e) => { const v = parseFloat(e.target.value); r.threshold = isNaN(v) ? undefined : v; dirty(); };
      $('#ken').onchange = (e) => { r.enabled = e.target.checked; sum.enabled = e.target.checked; dirty(); drawList(); };
      $('#kreset').onclick = async () => { const defs = await api('/rules/defaults'); if (defs.folders[name]) { rules.folders[name] = clone(defs.folders[name]); dirty(); drawDetail(); toast('Reset (press Save & re-sort to apply).'); } };
      $('#kview').onclick = () => { const B = bstate('review'); B.folder = name; B.sort = 'score_asc'; B.lane = ''; B.state = ''; };
      $$('[data-kfile]').forEach((a) => (a.onclick = () => { const B = bstate('review'); B.folder = name; B.sort = 'score_asc'; B.lane = ''; B.state = ''; }));
    };
    let isDirty = false;
    const dirty = () => { isDirty = true; const b = $('#ksave'); if (b) b.textContent = 'Save & re-sort *'; };
    el.insertAdjacentHTML('beforeend', `<div class="ksavebar"><button id="ksave">Save &amp; re-sort</button><span class="small muted">Saves your edits and re-chooses folders for everything not yet approved. Pictures you moved by hand keep their folder.</span></div>`);
    $('#ksave').onclick = async () => { const self = views.knows; try { await api('/rules', rules); await api('/redecide', {}); isDirty = false; $('#ksave').textContent = 'Save & re-sort'; toast('Saved. Choosing folders again…'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1500)); const st = await api('/state'); if (st.progress && (st.progress.finished || st.progress.phase === 'done')) break; } if (curRoute() === 'knows') self.render($('#view')); } catch (e) { toast(e.message, true); } };
    $('#kq').oninput = drawList; drawList(); drawDetail();
  },
  afterJob() { if (curRoute() === 'knows') views.knows.render($('#view')); },
};
