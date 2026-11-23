// open the big viewer on the pictures of one set / duplicate group (arrows step through that group only)
async function viewGroup(ids, startId, ctx) {
  try {
    const r = await api('/review?' + new URLSearchParams({ scope: 'any', ids: ids.join(','), limit: 500 }));
    const byId = new Map(r.items.map((i) => [i.id, i])); const items = ids.map((i) => byId.get(i)).filter(Boolean);
    if (!items.length) return toast('Could not load those pictures', true);
    RV.items = items; RV.total = items.length; RV.sel = new Set(); VW.ctx = ctx || null; await openViewer(startId);
  } catch (e) { toast(e.message, true); }
}
// ---------- SETS ----------
views.sets = {
  soft: false,
  async render(el) {
    el.style.padding = '18px 22px';
    const sets = await api('/sets'); const pend = sets.length;
    el.innerHTML = `<h1>Connected sets</h1><p class="sub">Groups of related pictures saved together (comic pages, multi-image posts). <b>Approve</b> moves the whole set into <b>Connected Art / set name</b> straight away. <b>Reject</b> sends its pictures back to the normal Review, each with its own folder — you’ll be told where they went. Sets you have dealt with disappear from this screen.</p>
      <div class="row wrap" style="margin-bottom:10px"><button class="ok" id="sa" ${pend ? '' : 'disabled'}>Approve &amp; move all ${pend} sets</button><button class="ghost" id="sregroup" title="Looks for duplicates and sets again from scratch, using the current settings.">Re-detect sets &amp; duplicates</button></div>
      ${sets.map((s) => `<div class="setcard card" data-id="${s.id}" style="max-width:none"><div class="row wrap"><input type="text" value="${esc(s.name)}" data-name="${s.id}" style="max-width:340px"><span class="small muted">${s.n} images · similarity ${s.score}</span><span class="grow"></span><button class="ok sm" data-a="approve">Approve &amp; move</button><button class="bad sm" data-a="reject">Reject set</button></div>
        <div class="strip">${s.members.map((m) => `<div class="m"><img class="zoomable" data-view="${m.id}" title="Click to open the viewer" loading="lazy" src="${thumb(m.id)}" alt=""><div class="fn">${esc(m.name)}</div><button class="ghost sm" data-rm="${m.id}" title="Take this picture out of the set; it goes to the normal Review">Remove</button></div>`).join('')}</div></div>`).join('') || '<div class="empty">No sets waiting.</div>'}`;
    const where = async (ids) => { // tell the user where rejected / removed pictures are going now
      try { const r = await api('/review?' + new URLSearchParams({ scope: 'any', ids: ids.join(','), limit: 500 })); const c = new Map(); for (const i of r.items) { const f = i.userFolder || i.folder || 'no folder yet'; c.set(f, (c.get(f) || 0) + 1); } return [...c].map(([f, n]) => `${f} (${n})`).join(', '); } catch { return ''; }
    };
    const act = async (b, ids, msg) => { try { await api('/sets/action', b); } catch (e) { return toast(e.message, true); } const w = ids ? await where(ids) : ''; toast(msg + (w ? ' They are in Review now, going to: ' + w : '')); setTimeout(() => this.render(el), 500); refreshState(); };
    $('#sa').onclick = async () => { if (!(await confirmBox('Approve every set?', `All ${pend} sets are approved and moved into Connected Art straight away. You can put them back from the Undo screen.`, 'Approve &amp; move'))) return; for (const s of sets) await api('/sets/action', { id: s.id, action: 'approve' }); toast('Approved — moving'); setTimeout(() => this.render(el), 900); refreshState(); };
    $('#sregroup').onclick = async () => { if (await confirmBox('Re-detect sets and duplicates?', 'Sets and duplicate groups are rebuilt from the current settings. Your choices on them are reset. Pictures are not touched.', 'Re-detect')) { await api('/regroup', {}); toast('Started'); } };
    $$('.setcard').forEach((c) => { const id = +c.dataset.id; const set = sets.find((x) => x.id === id); const ids = set.members.map((m) => m.id);
      $$('[data-view]', c).forEach((im) => (im.onclick = () => viewGroup(ids, +im.dataset.view)));
      $$('[data-a]', c).forEach((b) => (b.onclick = () => act({ id, action: b.dataset.a }, b.dataset.a === 'reject' ? ids : null, b.dataset.a === 'approve' ? 'Set approved — moving it.' : 'Set rejected.')));
      $$('[data-rm]', c).forEach((b) => (b.onclick = () => act({ id, action: 'removeMember', fileId: +b.dataset.rm }, [+b.dataset.rm], 'Removed from the set.')));
      $(`[data-name="${id}"]`, c).onchange = (e) => api('/sets/action', { id, action: 'rename', name: e.target.value }).then(() => toast('Renamed')); });
  },
  afterJob() { if (curRoute() === 'sets') this.render($('#view')); },
};

// ---------- DUPES ----------
views.dupes = {
  soft: false,
  async render(el) {
    el.style.padding = '18px 22px';
    const r = await api('/dupes?limit=200'); this.groups = r.groups;
    el.innerHTML = `<h1>Duplicates</h1><p class="sub">Copies and resized versions of the same picture. The <b>highest quality</b> copy (largest picture, then largest file) is marked ★. For each group you can <b>keep</b> any copies you want (they go to the normal Review), <b>send</b> copies to <b>Dupes</b> (moved at once, never deleted), or say they are <b>not duplicates</b>. Copies you have decided stay greyed out until the whole group is decided; then the group disappears. Pictures in this section are not shown in Review until you have dealt with them here.</p>
      <div class="row wrap" style="margin-bottom:10px"><button class="ok" id="da" ${r.total ? '' : 'disabled'} title="In every group: keep the highest quality copy, send the other copies to Dupes">Keep the best in every group, rest to Dupes (${r.total})</button><button class="ghost" id="dregroup">Re-detect sets &amp; duplicates</button><span class="small muted">${r.total} group(s) to decide</span></div>
      ${r.groups.map((g) => { const open = g.members.filter((m) => !m.decision).length; return `<div class="dupecard card" data-g="${g.id}" style="max-width:none"><div class="row wrap"><span class="chip">${g.kind === 'exact' ? 'exact copies' : 'same picture, different file'}</span><span class="small muted">${open} of ${g.members.length} still to decide</span><span class="grow"></span>
        <button class="ok sm" data-ga="keepBest" title="Keep the highest quality copy and send the other undecided copies to Dupes">Keep best, rest to Dupes</button><button class="ghost sm" data-gt="keep" title="Keep the ticked copies (they go to Review)">Keep ticked</button><button class="ghost sm" data-gt="dupes" title="Send the ticked copies to Dupes">Dupes for ticked</button><button class="ghost sm" data-ga="notDupes">Not duplicates</button></div>
        <div class="strip">${g.members.map((m) => `<div class="m ${m.best ? 'best' : ''} ${m.decision ? 'done' : ''}"><div class="mi"><img class="zoomable" data-view="${m.id}" title="Click to open the viewer" loading="lazy" src="${thumb(m.id)}" alt="">${m.best ? '<span class="star">★ Highest quality</span>' : ''}${m.decision ? `<span class="dec">${m.decision === 'keep' ? 'Kept → Review' : m.decision === 'dupes' ? 'Sent to Dupes' : 'Moved'}</span>` : ''}</div><div class="fn" title="${esc(m.path)}">${esc(m.name)}</div><div>${m.w || '?'}×${m.h || '?'} · ${fmtSize(m.size)}</div>
          ${m.decision ? '' : `<label class="small"><input type="checkbox" data-t="${m.id}"> pick</label><div class="row" style="justify-content:center"><button class="ghost sm" data-one="keep:${m.id}">Keep</button><button class="ghost sm" data-one="dupes:${m.id}">Dupes</button></div>`}</div>`).join('')}</div></div>`; }).join('') || '<div class="empty">No duplicate groups waiting. Nothing to do here.</div>'}`;
    const again = () => { this.render(el); refreshState(); };
    const call = async (b, msg) => { try { await api('/dupes/action', b); if (msg) toast(msg); } catch (e) { return toast(e.message, true); } setTimeout(again, 500); };
    $('#da').onclick = async () => { if (!(await confirmBox('Keep the best of every group?', `In all ${r.total} groups the highest quality copy is kept (it goes to Review) and the others move to Dupes straight away. You can put them back from the Undo screen.`, 'Do it'))) return; const x = await api('/dupes/approve-all', {}); toast(`Done — ${x.moved} moved to Dupes`); setTimeout(again, 800); };
    $('#dregroup').onclick = async () => { if (await confirmBox('Re-detect sets and duplicates?', 'Duplicate groups and sets are rebuilt from the current settings. What you already decided on duplicates is remembered. Pictures are not touched.', 'Re-detect')) { await api('/regroup', {}); toast('Started'); } };
    $$('.dupecard').forEach((c) => {
      const g = r.groups.find((x) => x.id === +c.dataset.g); const ids = g.members.map((m) => m.id);
      const ctx = () => ({ kind: 'dupes', group: g.id, members: g.members.map((m) => ({ id: m.id, best: m.best, decision: m.decision })) });
      $$('[data-view]', c).forEach((im) => (im.onclick = () => viewGroup(ids, +im.dataset.view, ctx())));
      $$('[data-ga]', c).forEach((b) => (b.onclick = () => call({ action: b.dataset.ga, group: g.id }, b.dataset.ga === 'notDupes' ? 'Not duplicates — they are in Review now.' : null)));
      $$('[data-gt]', c).forEach((b) => (b.onclick = () => { const t = $$('[data-t]:checked', c).map((x) => +x.dataset.t); if (!t.length) return toast('Tick the copies first (the “pick” boxes).', true); call({ action: b.dataset.gt, group: g.id, fileIds: t }); }));
      $$('[data-one]', c).forEach((b) => (b.onclick = () => { const [a, id] = b.dataset.one.split(':'); call({ action: a, group: g.id, fileIds: [+id] }); }));
    });
  },
  afterJob() { if (curRoute() === 'dupes') this.render($('#view')); },
};

// ---------- UNMAPPED ----------
views.unmapped = {
  async render(el) {
    await loadChoices(); el.style.padding = '18px 22px';
    const { rows, assigned } = await api('/unmapped');
    el.innerHTML = `<h1>Unmapped series</h1><p class="sub">These series were recognised but have no folder of their own, so they are sitting in Anime or Games. Tick the ones that belong together and choose where they go, in bulk. The choice is remembered, and can be removed again below.</p>
      <div class="card"><div class="row wrap"><label style="margin:0">Send ticked series to</label><div style="width:320px">${folderSelect('um_folder', 'Anime')}</div><button id="um_go">Assign</button><button class="ghost" id="um_games">Games</button><button class="ghost" id="um_anime">Anime</button><button class="ghost" id="um_all">Tick all</button></div></div>
      <div class="card"><table><tr><th></th><th>Series</th><th>Files</th><th>Example</th></tr>${rows.map((r) => `<tr><td><input type="checkbox" data-s="${esc(r.series)}"></td><td>${esc(r.series)}</td><td>${r.n}</td><td><img src="${thumb(r.sample)}" style="height:56px;border-radius:5px"></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing to assign.</td></tr>'}</table></div>
      <div class="card"><div class="row"><h2 style="margin:0">Already assigned (${assigned.length})</h2><span class="grow"></span><button class="ghost sm" id="um_unall" ${assigned.length ? '' : 'disabled'}>Remove all assignments</button></div>
      <table>${assigned.map((a) => `<tr><td>${esc(a.series)}</td><td>→ ${esc(a.folder)}</td><td><button class="ghost sm" data-un="${esc(a.series)}">Remove</button></td></tr>`).join('') || '<tr><td class="muted">None.</td></tr>'}</table></div>`;
    const go = async (folder) => { const series = $$('[data-s]:checked').map((c) => c.dataset.s); if (!series.length) return toast('Tick at least one series', true); await api('/unmapped/assign', { series, folder }); toast(`Assigned ${series.length} series to ${folder}`); this.render(el); refreshState(); };
    $('#um_go').onclick = () => go($('#um_folder').value.trim() || 'Anime'); $('#um_games').onclick = () => go('Games'); $('#um_anime').onclick = () => go('Anime');
    $('#um_all').onclick = () => $$('[data-s]').forEach((c) => (c.checked = true));
    const un = async (series) => { await api('/unmapped/unassign', { series }); toast('Removed'); setTimeout(() => this.render(el), 700); };
    $$('[data-un]').forEach((b) => (b.onclick = () => un([b.dataset.un])));
    $('#um_unall').onclick = () => un(assigned.map((a) => a.series));
  },
};

// ---------- RULES ----------
views.rules = {
  async render(el) {
    el.style.padding = '18px 22px';
    const rules = await api('/rules'); const defs = await api('/rules/defaults'); this.open = this.open || new Set();
    const typeLabel = { series: 'series / game', style: 'style', subject: 'subject', catchall: 'catch-all', mono: 'monochrome' };
    el.innerHTML = `<h1>Rules &amp; ranking</h1><p class="sub">Each picture is scored against every folder below and the <b>strongest</b> match wins (specific series and styles beat the broad catch-alls). This order only decides between near-equal scores. The “What it knows” page shows what each folder learned from your examples. Drag rows (or use the arrows) to change the order. Open a row to change what it looks for. Every folder can be reset on its own, the order can be reset on its own, or everything at once.</p>
      <div class="row wrap" style="margin-bottom:10px"><button id="rsave">Save &amp; re-run suggestions</button><button class="ghost" id="rord" title="Put the folders back in the built-in order, keeping your edits to what each folder looks for">Reset order only</button><button class="ghost" id="rreset">Reset everything to defaults</button><input type="text" id="rfilter" placeholder="Filter folders…" style="max-width:240px"></div><div id="rlist"></div>`;
    const draw = () => {
      const f = ($('#rfilter').value || '').toLowerCase();
      $('#rlist').innerHTML = rules.order.map((n, i) => ({ n, i })).filter((x) => !f || x.n.toLowerCase().includes(f)).map(({ n, i }) => { const r = rules.folders[n]; const o = this.open.has(n); return `<div class="rule" draggable="true" data-n="${esc(n)}"><div class="head"><span class="rank">${i + 1}</span><span class="nm" data-open="${esc(n)}">${esc(n)}</span><span class="chip">${typeLabel[r.type] || r.type}</span><label style="margin:0;display:flex;gap:4px;align-items:center"><input type="checkbox" data-en="${esc(n)}" ${r.enabled !== false ? 'checked' : ''}>on</label><button class="ghost sm" data-up="${esc(n)}">↑</button><button class="ghost sm" data-dn="${esc(n)}">↓</button><button class="ghost sm" data-top="${esc(n)}">Top</button>${defs.folders[n] ? `<button class="ghost sm" data-fr="${esc(n)}" title="Reset this folder’s rules and place in the order">Reset</button>` : ''}</div>
        ${o ? `<div class="body"><div class="row wrap"><div><label>Type</label><select data-ty="${esc(n)}">${Object.keys(typeLabel).map((t) => `<option value="${t}" ${r.type === t ? 'selected' : ''}>${typeLabel[t]}</option>`).join('')}</select></div><div><label>Confidence needed (blank = default)</label><input type="number" step="0.05" data-th="${esc(n)}" value="${r.threshold ?? ''}"></div></div>
        <label>Tags it looks for (one per line)</label><textarea data-tags="${esc(n)}">${esc((r.tags || []).join('\n'))}</textarea>
        <label>Series names (the part in brackets after a character, one per line)</label><textarea data-series="${esc(n)}">${esc((r.series || []).join('\n'))}</textarea>
        <label>Character names (one per line)</label><textarea data-chars="${esc(n)}">${esc((r.chars || []).join('\n'))}</textarea>
        <label>Descriptions for the “looks like” check (one per line)</label><textarea data-prompts="${esc(n)}">${esc((r.prompts || []).join('\n'))}</textarea>${r.notes ? `<p class="small muted">${esc(r.notes)}</p>` : ''}</div>` : ''}</div>`; }).join('');
      $$('[data-open]').forEach((e) => (e.onclick = () => { const n = e.dataset.open; this.open.has(n) ? this.open.delete(n) : this.open.add(n); draw(); }));
      const move = (n, to) => { const i = rules.order.indexOf(n); rules.order.splice(i, 1); rules.order.splice(Math.max(0, Math.min(rules.order.length, to)), 0, n); draw(); };
      $$('[data-up]').forEach((b) => (b.onclick = () => move(b.dataset.up, rules.order.indexOf(b.dataset.up) - 1)));
      $$('[data-dn]').forEach((b) => (b.onclick = () => move(b.dataset.dn, rules.order.indexOf(b.dataset.dn) + 1)));
      $$('[data-top]').forEach((b) => (b.onclick = () => move(b.dataset.top, 0)));
      $$('[data-fr]').forEach((b) => (b.onclick = () => { const n = b.dataset.fr; rules.folders[n] = clone(defs.folders[n]); const di = defs.order.indexOf(n); const prev = defs.order.slice(0, di).reverse().find((x) => rules.order.includes(x) && x !== n); rules.order.splice(rules.order.indexOf(n), 1); rules.order.splice(prev ? rules.order.indexOf(prev) + 1 : 0, 0, n); draw(); toast(n + ': reset (press Save to apply)'); }));
      $$('[data-en]').forEach((b) => (b.onchange = () => { rules.folders[b.dataset.en].enabled = b.checked; }));
      $$('[data-ty]').forEach((b) => (b.onchange = () => { rules.folders[b.dataset.ty].type = b.value; }));
      $$('[data-th]').forEach((b) => (b.onchange = () => { const v = parseFloat(b.value); rules.folders[b.dataset.th].threshold = isNaN(v) ? undefined : v; }));
      for (const key of ['tags', 'series', 'chars', 'prompts']) $$(`[data-${key}]`).forEach((b) => (b.onchange = () => { rules.folders[b.dataset[key]][key] = b.value.split('\n').map((x) => x.trim()).filter(Boolean); }));
      let dragged = null;
      $$('.rule').forEach((r) => { r.ondragstart = () => { dragged = r.dataset.n; r.classList.add('drag'); }; r.ondragend = () => r.classList.remove('drag'); r.ondragover = (e) => e.preventDefault(); r.ondrop = (e) => { e.preventDefault(); if (dragged && dragged !== r.dataset.n) move(dragged, rules.order.indexOf(r.dataset.n)); }; });
    };
    $('#rfilter').oninput = draw; draw();
    $('#rord').onclick = () => { const known = defs.order.filter((n) => rules.folders[n]); const rest = rules.order.filter((n) => !known.includes(n)); rules.order = [...known, ...rest]; draw(); toast('Order reset (press Save to apply)'); };
    $('#rsave').onclick = async () => { await api('/rules', rules); await api('/redecide', {}); toast('Saved. Re-running suggestions…'); };
    $('#rreset').onclick = async () => { if (await confirmBox('Reset all rules?', 'This puts every folder back to the built-in rules and ranking.', 'Reset')) { await api('/rules/reset', {}); await api('/redecide', {}); this.render(el); } };
  },
};

// ---------- UNDO ----------
views.undo = {
  soft: false,
  async render(el) {
    el.style.padding = '18px 22px'; await refreshState();
    const hist = await api('/history');
    const when = (t) => new Date(t).toLocaleString(); const base = (p) => String(p || '').split(/[\\/]/).pop();
    const dirOf = (p) => String(p || '').split(/[\\/]/).slice(0, -1).join('/');
    el.innerHTML = `<h1>Undo</h1><p class="sub">Approving moves files straight away, so this is where you put them back. Every move is written to a journal: undo a whole batch, or a single picture. Files are moved, never copied or overwritten, and nothing is ever deleted.</p>
      <div class="card"><h2 style="margin-top:0">Single pictures</h2>${hist.singles.length ? `<div class="singles">${hist.singles.map((x) => `<div class="single ${x.status}">${x.fid ? `<img loading="lazy" src="${thumb(x.fid)}" alt="">` : '<div class="noimg"></div>'}<div class="si"><div class="fn" title="${esc(x.src)}">${esc(base(x.dst || x.src))}</div><div class="small muted">${x.w ? x.w + '×' + x.h + ' · ' : ''}${x.size ? fmtSize(x.size) + ' · ' : ''}${when(x.ts)}</div><div class="small">${x.status === 'moved' ? '→ ' + esc(dirOf(x.dst)) : esc(x.status)}</div>${x.err ? `<div class="small muted">${esc(x.err)}</div>` : ''}</div>${x.status === 'moved' ? `<button class="ghost sm" data-uj="${x.jid}">Put back</button>` : ''}</div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}</div>
      <div class="card"><h2 style="margin-top:0">Batches</h2><table><tr><th>Batch</th><th>When</th><th>Moved</th><th>Put back</th><th>Failed</th><th></th></tr>
      ${hist.batches.map((b) => `<tr><td>#${b.id} ${esc(b.note || '')}</td><td>${when(b.ts)}</td><td>${b.moved}</td><td>${b.undone}</td><td>${b.failed}</td><td><button class="ghost sm" data-look="${b.id}">Details</button> <button class="ghost sm" data-undo="${b.id}" ${b.moved ? '' : 'disabled'}>Undo batch</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No batches yet.</td></tr>'}</table></div>
      <div class="card"><h2 style="margin-top:0">Undo a whole folder</h2><div class="row"><div style="width:360px">${folderSelect('uf', '')}</div><button class="ghost" id="ufb">Put back everything moved into this folder</button></div></div>
      <div class="card"><h2 style="margin-top:0">Approved but not moved</h2><p class="small muted">Normally empty, because approving moves at once. Files approved while a job was running, or that couldn’t be moved, wait here.</p><p><b id="waitn">…</b> waiting <button class="ghost sm" id="mvwait">Move them now</button></p></div>`;
    api('/review?' + new URLSearchParams({ state: 'approved', limit: 1 })).then((r) => { $('#waitn').textContent = fmtNum(r.total); $('#mvwait').disabled = !r.total; $('#mvwait').onclick = async () => { await api('/apply', { note: new Date().toLocaleString() }); toast('Moving…'); }; });
    $('#ufb').onclick = async () => { const f = $('#uf').value.trim(); if (!f) return toast('Pick a folder', true); const root = (S.settings.destinationRoot || '').replace(/[\\/]+$/, ''); if (await confirmBox('Put files back?', `Everything the app moved into “${esc(f)}” (including NSFW / Very inside it) goes back where it came from.`, 'Put back')) await api('/undo', { folder: root + '\\' + f.replace(/\//g, '\\') }); };
    $$('[data-undo]').forEach((b) => (b.onclick = async () => { if (await confirmBox('Undo this batch?', 'Every file from this batch goes back to where it was.', 'Undo batch')) await api('/undo', { batch: +b.dataset.undo }); }));
    $$('[data-uj]').forEach((b) => (b.onclick = async () => { await api('/undo', { journal: +b.dataset.uj }); toast('Putting it back…'); }));
    $$('[data-look]').forEach((b) => (b.onclick = async () => {
      const j = (await api('/history?batch=' + b.dataset.look + '&limit=500')).journal;
      modal(`<h1>Batch #${b.dataset.look}</h1><table><tr><th></th><th>From</th><th>To</th><th>Status</th><th></th></tr>${j.map((x) => `<tr><td>${x.file_id ? `<img src="${thumb(x.file_id)}" style="height:44px;border-radius:4px">` : ''}</td><td class="small" style="word-break:break-all">${esc(x.src)}</td><td class="small" style="word-break:break-all">${esc(x.dst || '')}</td><td>${x.status}${x.err ? `<div class="small muted">${esc(x.err)}</div>` : ''}</td><td>${x.status === 'moved' ? `<button class="ghost sm" data-uj2="${x.id}">Put back</button>` : ''}</td></tr>`).join('')}</table><div class="row" style="margin-top:10px"><button class="ghost" id="mx">Close</button></div>`);
      $('#mx').onclick = closeModal; $$('[data-uj2]').forEach((u) => (u.onclick = async () => { await api('/undo', { journal: +u.dataset.uj2 }); closeModal(); }));
    }));
  },
  afterJob() { if (curRoute() === 'undo') this.render($('#view')); },
};
