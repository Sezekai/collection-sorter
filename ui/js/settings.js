// =====================================================================================
//  SETTINGS (S): the options in sections, Storage, GPU (with Diagnose) and Reset. Changes apply straight away.
// =====================================================================================
const GPU_PATHS = ['tagger.device', 'tagger.deviceId'];
views.settings = {
  soft: false, sec: 'storage',
  sections() { return [...SETTING_GROUPS.map((g) => ({ id: g.id, title: g.title, blurb: g.blurb })), { id: 'storage', title: 'Storage', blurb: 'Every place Collection Sorter keeps anything, how big it is, and where it can go.' }, { id: 'gpu', title: 'GPU', blurb: 'The graphics card runs the AI; if it fails, the processor takes over.' }, { id: 'reset', title: 'Reset', blurb: 'Clear one part at a time. Your pictures and videos are never touched.' }]; },
  async render(el) {
    await refreshState(); const secs = this.sections(); if (!secs.some((x) => x.id === this.sec)) this.sec = 'storage';
    el.innerHTML = `<h1>Settings</h1><p class="sub">Changes apply straight away. Hover the ⓘ next to a setting for what it does and a good value.</p>
      ${S.safeMode ? `<div class="banner"><b>Safe mode</b><span>The app closed unexpectedly twice in a row, so it started with the graphics card off.</span><span class="grow"></span><button class="pri" id="st_safeoff">Turn the graphics card back on</button></div>` : ''}
      <div class="knows" style="grid-template-columns:220px minmax(0,1fr)"><div class="card kleft" style="padding:6px"><div class="flist">${secs.map((x) => `<div class="fitem ${x.id === this.sec ? 'on' : ''}" data-sec="${x.id}"><span>${esc(x.title)}</span></div>`).join('')}</div></div><div id="st_body" style="display:flex;flex-direction:column;gap:8px;min-width:0"></div></div>`;
    $$('[data-sec]').forEach((x) => (x.onclick = () => { this.sec = x.dataset.sec; this.render(el); }));
    const so = $('#st_safeoff'); if (so) so.onclick = async () => { if (await confirmBox('Turn the graphics card back on?', 'The app restarts with the graphics card on. If it closes unexpectedly again, run Settings → GPU → Diagnose.', 'Restart')) await api('/safemode/off', {}); };
    const body = $('#st_body'); const sec = secs.find((x) => x.id === this.sec);
    if (this.sec === 'storage') return this.storage(body, sec);
    if (this.sec === 'gpu') return this.gpu(body, sec);
    if (this.sec === 'reset') return this.reset(body, sec);
    this.group(body, SETTING_GROUPS.find((g) => g.id === this.sec));
  },
  field(f, s) {
    const val = getPath(s, f.path) ?? f.def; let input;
    if (f.type === 'select') input = `<select data-path="${f.path}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else if (f.type === 'text') input = `<input type="text" data-path="${f.path}" value="${esc(val)}" placeholder="Paste your key here" spellcheck="false" autocomplete="off">`;
    else input = `<input type="number" data-path="${f.path}" value="${val}" step="${f.step}" min="${f.min}" max="${f.max}">`;
    return `<div class="field" data-tipid="${f.path}" style="${f.wide ? 'grid-column:1/-1' : ''}"><label>${esc(f.label)} <i class="info">i</i></label><div class="in">${input}<button class="ghost rs sm" data-def="${f.path}" title="Back to the recommended value">↺</button></div><div class="def">Recommended: ${esc(f.rec)}</div></div>`;
  },
  async save(path, v) {
    const o = clone(S.settings); setPath(o, path, v);
    try { const r = await api('/settings?report=1', o); S.settings = r.settings; } catch (e) { toast(e.message, true); }
  },
  wireFields(host) {
    $$('[data-path]', host).forEach((i) => (i.onchange = () => { const f = FIELD_BY_PATH[i.dataset.path]; let v = i.value; if (f.type === 'number') { v = parseFloat(v); if (isNaN(v)) v = f.def; v = Math.min(f.max, Math.max(f.min, v)); i.value = v; } else if (f.type === 'select') v = v === 'true' ? true : v === 'false' ? false : v; else v = v.trim(); this.save(i.dataset.path, v); }));
    $$('[data-def]', host).forEach((b) => (b.onclick = async () => { const f = FIELD_BY_PATH[b.dataset.def]; const i = $(`[data-path="${f.path}"]`, host); i.value = String(f.def); await this.save(f.path, f.def); toast(`${f.label}: back to ${f.rec}`); }));
  },
  group(body, g) {
    const fields = g.fields.filter((f) => !GPU_PATHS.includes(f.path));
    body.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">${esc(g.title)}</h2><span class="grow"></span><button class="ghost" id="st_grp">Reset this section to recommended</button></div>${g.blurb ? `<p class="small muted">${esc(g.blurb)}</p>` : ''}<div class="fgrid">${fields.map((f) => this.field(f, S.settings)).join('')}</div></div>`;
    this.wireFields(body);
    $('#st_grp').onclick = async () => { const o = clone(S.settings); fields.forEach((f) => { if (f.path !== 'saucenao.apiKey') setPath(o, f.path, f.def); }); const r = await api('/settings?report=1', o); S.settings = r.settings; toast(`${g.title}: back to the recommended values`); this.render($('#view')); };
  },
  async storage(body, sec) {
    const draw = async () => {
      let r; try { r = await api('/storage'); } catch (e) { body.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
      const pending = r.places.some((p) => p.size == null && p.exists);
      body.innerHTML = `<div class="card"><h2 style="margin:0 0 4px">Storage</h2><p class="small muted">${esc(sec.blurb)} Moving copies everything, checks the copy, switches to it, and only then removes the old copy. Moving waits until no job is running.${r.root ? ` Big files live beside the program in <code>${esc(r.root)}</code>.` : ''}</p>
        <table class="logtable"><tr><th>What it holds</th><th>Where</th><th style="width:110px">Size</th><th style="width:230px"></th></tr>
        ${r.places.map((p) => `<tr><td>${esc(p.what)}${p.note ? `<div class="small faint">${esc(p.note)}</div>` : ''}</td><td><code style="word-break:break-all">${esc(p.path)}</code>${p.missingDrive ? `<div class="small" style="color:var(--warn)">Drive ${esc(p.missingDrive)} isn’t connected.</div>` : !p.exists ? '<div class="small" style="color:var(--warn)">This folder is missing.</div>' : ''}</td>
          <td>${!p.exists ? '—' : p.size == null ? '<span class="faint">Working out…</span>' : fmtSize(p.size) + (p.files != null ? `<div class="small faint">${fmtNum(p.files)} files</div>` : '')}</td>
          <td><div class="row wrap" style="gap:4px">${p.missingDrive || !p.exists ? `<button class="sm" data-retry="1">Retry</button>${p.move ? `<button class="sm" data-move="${p.key}">Choose a new place…</button>` : ''}` : `<button class="sm" data-open="${p.key}">Open</button>${p.move ? `<button class="sm" data-move="${p.key}" title="${S.job ? 'Waits until the current job has finished' : ''}">Move…</button>` : ''}${p.clear ? `<button class="sm dg" data-clear="${p.key}" data-size="${p.size || 0}">Clear…</button>` : ''}`}</div></td></tr>`).join('')}</table></div>`;
      $$('[data-open]', body).forEach((b) => (b.onclick = async () => { const x = await api('/open-folder', { which: b.dataset.open }); if (!x.ok) toast('Opening folders works in the app window: ' + x.path, true); }));
      $$('[data-retry]', body).forEach((b) => (b.onclick = draw));
      $$('[data-move]', body).forEach((b) => (b.onclick = async () => {
        const p = r.places.find((x) => x.key === b.dataset.move);
        if (!(await confirmBox(`Move ${p.what.toLowerCase()}?`, `Pick the new place next. Everything is copied there with progress, checked, and then the old copy is removed.${p.key === 'data' ? ' <b>The app restarts when it is done.</b>' : ''}`, 'Choose the new place…'))) return;
        try { const x = await api('/storage/move', { key: p.key }); if (x.unsupported) toast('Moving works in the app window.', true); else if (x.started) toast('Moving… the status bar shows the progress.', 'info'); } catch (e) { toast(e.message, true); }
      }));
      $$('[data-clear]', body).forEach((b) => (b.onclick = async () => {
        const p = r.places.find((x) => x.key === b.dataset.clear);
        if (!(await confirmBox(`Clear ${p.what.toLowerCase()}?`, `${p.size ? fmtSize(p.size) + ' comes back. ' : ''}They are made again when needed. Your pictures are not touched.`, 'Clear', true))) return;
        try { const x = await api('/storage/clear', { key: p.key }); toast(`Cleared. ${fmtSize(x.freed || 0)} freed.`); draw(); } catch (e) { toast(e.message, true); }
      }));
      if (pending && curRoute() === 'settings' && this.sec === 'storage') setTimeout(() => { if (curRoute() === 'settings' && this.sec === 'storage' && body.isConnected) draw(); }, 1500);
    };
    body.innerHTML = '<div class="card faint">Loading…</div>'; draw();
  },
  async gpu(body, sec) {
    const s = S.settings; const dev = (s.tagger || {}).device || 'auto'; const mi = S.modelInfo;
    const diag = await api('/diagnose').catch(() => null);
    const lv = { ok: ['ok', 'Fine'], warn: ['warn', 'Look at this'], danger: ['bad', 'Problem'], info: ['', 'Note'] };
    body.innerHTML = `<div class="card"><h2 style="margin:0 0 4px">GPU</h2><p class="small muted">${esc(sec.blurb)}</p>
      <div class="row wrap"><span class="inl" style="width:88px">Use</span><span class="seg" id="st_dev">${[['auto', 'Auto'], ['gpu', 'GPU'], ['cpu', 'CPU']].map(([k, l]) => `<button data-v="${k}" class="${dev === k || (k === 'gpu' && dev === 'dml') ? 'on' : ''}">${l}</button>`).join('')}</span>
        <span class="small muted">${S.safeMode ? 'Safe mode: the processor is used until you turn the graphics card back on.' : mi ? `Now: ${mi.provider === 'dml' ? 'graphics card through DirectML' + (mi.gpu ? ' (' + esc(mi.gpu) + ')' : '') : mi.provider === 'cpu' ? 'the processor' : esc(mi.provider)}` : 'The AI is loaded when the first job starts.'}</span></div>
      <p class="small faint" style="margin-top:6px">Auto and GPU both use the graphics card and fall back to the processor if it fails. CPU is slow but always works.</p>
      <div class="fgrid">${SETTING_GROUPS.flatMap((g) => g.fields).filter((f) => f.path === 'tagger.deviceId').map((f) => this.field(f, s)).join('')}</div></div>
      <div class="card"><div class="row"><h2 style="margin:0">Diagnose and repair</h2><span class="grow"></span>${diag ? '<button class="ghost" id="st_copy">Copy report</button>' : ''}<button class="pri" id="st_diag">${S.job ? 'Add Diagnose to the queue' : 'Diagnose'}</button></div>
        <p class="small muted">Checks the AI model files, the AI runtime, the graphics cards, a real test run of the models, the video tool, your folders and free space. Each finding says what was found and how to fix it.</p>
        ${diag ? `<p class="small faint">Last run ${new Date(diag.ts).toLocaleString()}${diag.file ? ` · saved to <code>${esc(diag.file)}</code>` : ''}</p><div class="rlist">${diag.findings.map((f) => `<div class="it"><span class="chip ${lv[f.level][0]}" style="flex:none">${lv[f.level][1]}</span><div class="t"><b>${esc(f.title)}</b><span class="small muted">${esc(f.evidence || '')}</span>${f.fix ? `<div class="small"><b style="display:inline">Fix:</b> ${esc(f.fix)}</div>` : ''}</div>${f.repair ? `<button data-repair="${esc(f.repair)}">Repair</button>` : ''}</div>`).join('')}</div>` : ''}</div>`;
    $$('#st_dev [data-v]').forEach((b) => (b.onclick = async () => { await this.save('tagger.device', b.dataset.v); toast('Used from the next job on.'); this.render($('#view')); }));
    this.wireFields(body);
    $('#st_diag').onclick = async () => { const r = await api('/diagnose', {}); toast(r.queued ? 'Diagnose is queued after the current job.' : 'Diagnosing… the status bar shows the progress.', 'info'); };
    const cp = $('#st_copy'); if (cp) cp.onclick = () => navigator.clipboard.writeText(diag.text).then(() => toast('Report copied')).catch(() => toast('Could not copy', true));
    $$('[data-repair]', body).forEach((b) => (b.onclick = async () => { try { const r = await api('/repair', { what: b.dataset.repair }); toast(r.queued ? 'Repair is queued.' : 'Repairing… the status bar shows the progress.', 'info'); } catch (e) { toast(e.message, true); } }));
  },
  reset(body, sec) {
    body.innerHTML = `<div class="card"><h2 style="margin:0 0 4px">Reset</h2><p class="small muted">${esc(sec.blurb)} Each one asks first and says what is cleared and what stays.</p>
      <div class="rlist">${RESETS.map((r) => `<div class="it"><div class="t"><b>${esc(r.title)}</b><span class="small muted">${esc(r.text)}</span></div><button class="${r.danger ? 'dg' : ''}" data-reset="${r.what}">${esc(r.btn)}…</button></div>`).join('')}</div></div>`;
    $$('[data-reset]', body).forEach((b) => (b.onclick = async () => {
      const r = RESETS.find((x) => x.what === b.dataset.reset); if (!r) return;
      if (S.job && r.what !== 'thumbs') return toast(`Wait until “${S.job}” has finished (or stop it), then reset.`, true);
      if (!(await confirmBox(r.title + '?', esc(r.text) + '<br><br>Your pictures and videos are not touched.', r.btn, true))) return;
      try { const res = await api('/reset', { what: r.what }); toast(res.message); if (r.after === 'redecide') await api('/redecide', {}); await refreshState(); } catch (e) { toast(e.message, true); }
    }));
  },
  afterJob() { if (curRoute() === 'settings' && ['storage', 'gpu'].includes(this.sec)) this.render($('#view')); },
};
