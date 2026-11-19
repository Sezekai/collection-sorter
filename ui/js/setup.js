// ---------- SETUP ----------
const RESETS = [
  { what: 'decisions', title: 'Clear my review choices', text: 'Removes every approval, rejection and folder or rating you chose by hand, so each picture goes back to “needs review” with the app’s own suggestion. Nothing is moved.', btn: 'Clear choices', after: 'redecide' },
  { what: 'examples', title: 'Forget the learned examples', text: 'Clears everything learned from your example folders (for example after adding the wrong folder). The files themselves are never touched.', btn: 'Forget examples' },
  { what: 'examplesLearning', title: 'Learn the examples again', text: 'Keeps the list of example files but learns them again from scratch on the next scan.', btn: 'Re-learn' },
  { what: 'files', title: 'Forget the list of files to sort', text: 'Clears the scanned file list and everything read from those files (not yet moved). The next scan starts from nothing.', btn: 'Forget file list' },
  { what: 'analysis', title: 'Read all files again', text: 'Keeps the file list but throws away what was read from each picture (tags, ratings, fingerprints), so every file is read again on the next scan. Use this after changing the models or if results look wrong.', btn: 'Read again' },
  { what: 'series', title: 'Forget series assignments', text: 'Removes the choices made on the Unmapped series screen.', btn: 'Forget assignments', after: 'redecide' },
  { what: 'rules', title: 'Reset rules and ranking', text: 'Puts every folder’s rules and the whole ranking back to the built-in defaults.', btn: 'Reset rules', after: 'redecide' },
  { what: 'sauce', title: 'Clear source-lookup answers', text: 'Forgets the answers and queue of SauceNAO lookups.', btn: 'Clear answers' },
  { what: 'thumbs', title: 'Clear the thumbnail cache', text: 'Deletes the small preview pictures. They are rebuilt when needed.', btn: 'Clear thumbnails' },
  { what: 'settings', title: 'Reset all settings to recommended', text: 'Puts every setting back to its recommended value and forgets the folders you added. Your files and learned data stay.', btn: 'Reset settings' },
  { what: 'history', title: 'Clear the move history', text: 'Deletes the journal of moves. Files that were already moved can then no longer be undone from this app.', btn: 'Clear history', danger: true },
  { what: 'everything', title: 'Start completely fresh', text: 'Clears the file list, everything learned, suggestions, sets, duplicates and assignments. Your settings, the downloaded models and the move history are kept.', btn: 'Start fresh', danger: true },
];
views.setup = {
  sec: null,
  async render(el) {
    await refreshState(); await loadChoices();
    const defs = await api('/settings/defaults'); const di = await api('/datainfo').catch(() => ({}));
    const s = S.settings; const c = S.counts;
    const srcRows = (s.sources || []).map((x, i) => `<div class="card" style="max-width:none;margin:6px 0;padding:10px"><div class="pathrow"><input type="text" data-src="${i}" value="${esc(x.path)}"><button class="ghost" data-rmsrc="${i}">Remove</button></div>
      <label>Folders inside it to skip (one per line, relative to this folder)</label><textarea data-ex="${i}" style="min-height:44px">${esc((x.excludes || []).join('\n'))}</textarea></div>`).join('');
    const refRows = (s.referenceRoots || []).map((x, i) => `<div class="pathrow"><input type="text" data-ref="${i}" value="${esc(x)}"><button class="ghost" data-rmref="${i}">Remove</button></div>`).join('');
    const kept = await api('/refs/kept').catch(() => []);
    const keptRows = kept.length ? `<div class="card" style="max-width:none;margin:8px 0;padding:10px"><b class="small">Removed folders whose learning is kept (never scanned again)</b>${kept.map((k) => `<div class="pathrow" style="margin-top:6px"><code style="flex:1;word-break:break-all">${esc(k.path)}</code><span class="small muted">${fmtNum(k.learned)} learned</span><button class="ghost sm" data-forgetkept="${esc(k.path)}">Forget what it learned</button></div>`).join('')}</div>` : '';
    const T = S.todo || { files: 0, refs: 0, refsMore: 0 }; const CH = S.changes || {}; const LR = S.lastRescan;
    const chLines = [];
    if (CH.destAdded && CH.destAdded.length) chLines.push(`New destination folders: ${CH.destAdded.map(esc).join(', ')}`);
    if (CH.destRemoved && CH.destRemoved.length) chLines.push(`Destination folders gone or renamed: ${CH.destRemoved.map(esc).join(', ')}`);
    if (CH.newExampleFolders && CH.newExampleFolders.length) chLines.push(`New examples folders: ${CH.newExampleFolders.map(esc).join(', ')} (see <a href="#examples">Examples to learn from</a>)`);
    const busy = ''; const qlab = (t) => (S.job ? `Add “${t}” to the queue` : t);
    const tagBanner = `<div class="card" id="chcard"><div class="row wrap"><h2 style="margin:0">New or changed folders &amp; files</h2><span class="grow"></span><span class="small muted">${LR ? 'Last checked ' + new Date(LR.ts || LR).toLocaleString() : 'Not checked yet'}${s.autoRescan === false ? ' · automatic check at start is off' : ' · checked automatically each time the app starts'}</span></div>
      <p class="small" style="margin:6px 0">${T.files ? `<b>${fmtNum(T.files)}</b> file(s) not scanned and tagged yet` : 'No unscanned files'} · ${T.refs ? `<b>${fmtNum(T.refs)}</b> example picture(s) not learned from yet` : 'No unlearned example pictures'}${T.refsMore ? ` · ${fmtNum(T.refsMore)} more example pictures are waiting (each Learn press takes a fresh batch)` : ''}.</p>
      ${chLines.length ? `<ul class="small" style="margin:4px 0 8px 18px">${chLines.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
      ${S.folderChanges > 0 ? `<div class="row wrap" style="margin:0 0 8px"><span class="chip warn">${S.folderChanges} destination folder(s) can no longer be found</span><button id="fcopen">Renamed, merged or deleted? Sort it out…</button></div>` : ''}<div class="row wrap"><button id="chcheck">${qlab('Check for changes now')}</button><button id="chlearn" title="Learn from example pictures that are new or not yet used">${qlab('Learn from new examples only')}</button><button id="chscan" title="Scan and tag only files not yet processed">${qlab('Scan & tag new files only')}</button><button class="pri" id="chboth">${qlab('Do both')}</button>${chLines.length ? '<button class="ghost sm" id="chclear">Dismiss list</button>' : ''}</div></div>`;
    const destTree = `<div class="card" id="destcard"><h2 style="margin:0 0 6px">Subfolders as separate destinations</h2><p class="small muted">Tick any folder, however deep, inside your destination folders to make it its own target (like Real/Videos/General). New, renamed and deleted folders are noticed when the app checks for changes.</p><div id="desttree" class="small muted">Loading…</div></div>`;
    const pr = S.problems || { files: [], refs: [] };
    const CL = S.classifier || {}; const sbp = (k) => { const x = (CL.scoreboard || {})[k] || {}; return `<td>${fmtNum(x.checked || 0)}</td><td>${fmtNum(x.wrong || 0)}</td><td>${x.accuracy == null ? '–' : Math.round(x.accuracy * 100) + '%'}</td>`; };
    const sbCard = `<div class="card"><h2 style="margin:0 0 6px">Art or real life — how the two AIs are doing</h2><p class="small muted">Each time you press P (move to the other side), the app notes which AI got that picture wrong. Right now <b>${esc({ both: 'both averaged', clip: 'CLIP', joytag: 'JoyTag' }[CL.using] || CL.using || 'both averaged')}</b> decides${CL.joytag ? '' : '; <b>JoyTag is not downloaded yet</b> (use “Download models” below), so only CLIP is used'}.</p><table class="logtable"><tr><th>AI</th><th>Your corrections it saw</th><th>Wrong</th><th>Right</th></tr><tr><td>CLIP</td>${sbp('clip')}</tr><tr><td>JoyTag</td>${sbp('joytag')}</tr></table><p class="small muted">${fmtNum((CL.scoreboard || {}).corrections || 0)} correction(s) so far. ${S.counts ? fmtNum(S.counts.art_pending || 0) + ' pending in Art, ' + fmtNum(S.counts.real_pending || 0) + ' in Real life.' : ''}</p></div>`;
    const probCard = (pr.files.length || pr.refs.length) ? `<div class="card warnbox"><b>Some pictures could not be read.</b> They are retried on every scan.${[...pr.refs.map((x) => ['example', x]), ...pr.files.map((x) => ['file', x])].map(([k, x]) => `<div class="small">${fmtNum(x.n)} ${k}${x.n === 1 ? '' : 's'}: <code>${esc(x.err || 'unknown reason')}</code></div>`).join('')}</div>` : '';
    const L = S.learned; const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
    const lrow = (name, o) => o ? `<tr><td>${name}</td><td>${o.trained ? '<span class="chip ok">learned</span>' : '<span class="chip warn">not enough examples</span>'}</td><td>${Object.entries(o.counts || {}).map(([k, v]) => `${esc(k)}: ${fmtNum(v)}`).join(' · ') || '—'}</td><td>${o.trained ? pct(o.accuracy) + ' right on its own training check' : 'using the fixed limits'}</td></tr>` : '';
    const learnCard = L ? `<div class="card"><h2 style="margin-top:0">What the app has learned from your folders</h2><p class="small muted">After each scan it trains small models on your example folders and your corrections. These decide NSFW / Very and photo-or-art. More examples in <code>NSFW</code> / <code>Very</code> folders, and correcting wrong ones (R, P, Shift+P and the rating box), make them better.</p><table><tr><th>Decides</th><th>State</th><th>Examples</th><th>How it does</th></tr>${lrow('NSFW / Very', L.nsfw)}${lrow('Real photo / video or art', L.real)}</table></div>` : '';
    const field = (f) => {
      const val = getPath(s, f.path) ?? f.def; let input;
      if (f.type === 'select') input = `<select data-path="${f.path}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      else if (f.type === 'text') input = `<input type="text" data-path="${f.path}" value="${esc(val)}" placeholder="Paste your key here" spellcheck="false" autocomplete="off">`;
      else input = `<input type="number" data-path="${f.path}" value="${val}" step="${f.step}" min="${f.min}" max="${f.max}">`;
      return `<div class="field" data-tipid="${f.path}" style="${f.wide ? 'grid-column:1/-1' : ''}"><label>${esc(f.label)} <i class="info">i</i></label><div class="in">${input}<button class="ghost rs sm" data-def="${f.path}" title="Back to the recommended value">↺</button></div><div class="def">Recommended: ${esc(f.rec)}</div></div>`;
    };
    const nsrc = (s.sources || []).length; const nref = (s.referenceRoots || []).length;
    const parts = [
      ['sources', '1. Folders to sort', nsrc ? `${nsrc} folder${nsrc === 1 ? '' : 's'}` : 'None yet', !nsrc, `<div class="card"><div class="row"><h2 style="margin:0">Folders to sort (sources)</h2><span class="grow"></span><button id="swopen2">Change folders…</button></div>
        ${srcRows || '<p class="muted">No source folders yet.</p>'}
        <div class="row" style="margin-top:8px"><button id="addsrc">Add folder…</button><span class="small muted">Any number of folders; subfolders are included. Removing a folder here also forgets its files (the files themselves are never touched).</span></div></div>`],
      ['dest', '2. Destination', s.destinationRoot ? s.destinationRoot.split(/[\\/]/).filter(Boolean).pop() : 'Not set', !s.destinationRoot, `<div class="card"><div class="row"><h2 style="margin:0">Destination (where the sorted folders live)</h2><span class="grow"></span><button class="pri" id="swopen">Change folders…</button></div>
        <div class="pathrow" style="margin-top:8px"><input type="text" id="dest" value="${esc(s.destinationRoot || '')}"><button class="ghost" id="pickdest">Browse…</button></div>
        <p class="small muted"><b>Moving to another destination, or from test files to real ones?</b> Use <b>Change folders…</b>: it checks the new folder against what the app knows, carries the rules, ranking, examples and what it knows about each folder across, and can forget the old files and their history.</p></div>${destTree}`],
      ['examples', '3. Examples to learn from', `${fmtNum(c.refs_done)} learned`, false, `<div class="card"><h2 style="margin-top:0">Examples to learn from (optional, read-only)</h2>
        <p class="small muted">Files already in the right folders teach the app what each folder looks like. They are never moved or changed. The app only learns from a sample of each folder (see “Examples learned per folder” in Settings), so a huge folder is fine — and removing a folder here forgets everything learned from it.</p>
        ${refRows}${keptRows}<div class="row wrap" style="margin-top:8px"><button id="addref" class="ghost">Add examples folder…</button><a class="btnlink" href="#examples">Choose subfolders &amp; where each goes →</a>
        <span class="small muted">${fmtNum(c.refs)} example files found · ${fmtNum(c.refs_done)} learned · ${fmtNum(c.refs_skipped)} skipped (sampling)</span><span class="grow"></span><button class="ghost sm" data-reset="examples">Forget all learned examples</button></div></div>`],
      ['changes', '4. New and changed', (T.files || T.refs || S.folderChanges) ? 'Something to do' : 'Up to date', !!(S.folderChanges > 0), tagBanner],
      ['models', '5. AI models', S.modelsReady ? 'Ready' : 'Not downloaded', !S.modelsReady, `<div class="card"><h2 style="margin-top:0">AI models</h2>
        ${S.modelsReady ? `<p><span class="chip ok">Ready</span> <span class="small muted">${S.provider ? 'Running on ' + (S.provider === 'dml' ? 'your graphics card (DirectML)' : S.provider) + '.' : 'Loaded when the first scan starts.'}</span> <button class="ghost sm" id="testmodels">Test the AI models</button></p>${S.modelNote ? `<div class="card warnbox"><b>Heads up:</b> ${esc(S.modelNote)}</div>` : ''}<div id="modeltest" class="small"></div>${probCard}`
          : `<p><span class="chip warn">Not downloaded</span> About 1.7 GB in total (tagger, CLIP and JoyTag), one time, into <code>${esc(di.modelDir || '')}</code>. They run on your graphics card through DirectML, so no extra drivers are needed.</p><button class="pri" id="dlmodels">Download the AI models (about 1.7 GB)</button>`}</div>`],
      ['learn', '6. Learn and scan', `${fmtNum(c.analyzed)} of ${fmtNum(c.files)} read`, false, `<div class="card"><h2 style="margin-top:0">Learn and scan</h2>
        <p class="small muted">Two separate steps. <b>Learn from examples</b> reads a sample of your example folders and teaches the app what each folder looks like (it does not touch your new files). <b>Scan &amp; tag files</b> finds the new files, reads and tags every picture and video with the chosen model, finds duplicates and sets, and prepares suggestions. Both can be paused or cancelled and pick up where they stopped.${S.retag ? ` <b>${fmtNum(S.retag)} pictures were tagged by a different model</b> and will be read again with the chosen one on the next scan, so the new tags replace the old.` : ''}</p>
        <div class="row wrap"><button id="learn">${qlab('Learn from examples')}</button><button id="run">${qlab('Scan & tag files')}</button><button class="pri" id="runboth">${qlab('Do both')}</button><button id="redecide">${qlab('Re-run suggestions only')}</button></div>
        <p class="small muted" style="margin-top:8px">${fmtNum(c.refs_done)} examples learned · ${fmtNum(c.analyzed)} of ${fmtNum(c.files)} files read${c.failed ? `, ${c.failed} unreadable` : ''}</p></div>`],
      ['learned', '7. What it has learned', L ? 'NSFW, Very, art or real' : 'Nothing yet', false, `${learnCard}${sbCard}`],
    ];
    if (!parts.some((x) => x[0] === this.sec)) this.sec = (parts.find((x) => x[3]) || parts[0])[0];
    el.innerHTML = `<h1>Setup</h1><p class="sub">Tell the app where your files are, where they should end up, and let it read them. Approving a picture moves it straight away (and you can put it back from the Undo screen). Changes here are saved automatically. Options, storage, the graphics card and Reset are in <a href="#settings">Settings</a> (S); the look is on <a href="#look">Look</a>.</p>
      <div class="secpage"><div class="card secnav" id="setupnav"><div class="flist">${parts.map(([id, t, hint, warn]) => `<div class="fitem sitem ${id === this.sec ? 'on' : ''}" data-part="${id}"><span>${esc(t)}<small class="${warn ? 'warnc' : ''}">${esc(hint)}</small></span></div>`).join('')}</div></div>
        <div class="secbody">${parts.map(([id, , , , html]) => `<div class="spart ${id === this.sec ? '' : 'hidden'}" data-partbody="${id}">${html}</div>`).join('')}</div></div>`;
    $$('[data-part]').forEach((x) => (x.onclick = () => { this.sec = x.dataset.part; $$('[data-part]').forEach((y) => y.classList.toggle('on', y === x)); $$('[data-partbody]').forEach((y) => y.classList.toggle('hidden', y.dataset.partbody !== this.sec)); $('#view').scrollTop = 0; }));
    addResizer($('#setupnav'), 'sec', 'right');
    $('#swopen').onclick = () => changeFolders(); $('#swopen2').onclick = () => changeFolders();
    $('#device') && 0;
    const collect = () => {
      const o = clone(S.settings);
      o.sources = $$('[data-src]').map((i) => ({ path: i.value.trim(), excludes: $(`[data-ex="${i.dataset.src}"]`).value.split('\n').map((x) => x.trim()).filter(Boolean) })).filter((x) => x.path);
      o.referenceRoots = $$('[data-ref]').map((i) => i.value.trim()).filter(Boolean);
      o.destinationRoot = $('#dest').value.trim();
      $$('[data-path]').forEach((i) => { const f = FIELD_BY_PATH[i.dataset.path]; let v = i.value; if (f.type === 'number') { v = parseFloat(v); if (isNaN(v)) v = f.def; v = Math.min(f.max, Math.max(f.min, v)); } else if (f.type === 'select') v = v === 'true' ? true : v === 'false' ? false : v; else v = v.trim(); setPath(o, i.dataset.path, v); });
      return o;
    };
    const saveNow = async (quiet) => {
      const r = await api('/settings?report=1', collect()); S.settings = r.settings;
      if (r.cleaned && (r.cleaned.filesRemoved || r.cleaned.examplesRemoved)) toast(`Forgot ${fmtNum(r.cleaned.filesRemoved)} files and ${fmtNum(r.cleaned.examplesRemoved)} examples from removed folders.`);
      else if (!quiet) toast('Saved');
    };
    const pick = async (cb) => { const r = await api('/pick-folder', {}); if (r.path) cb(r.path); else if (r.unsupported) toast('The folder picker only works in the app window. Type the path instead.', true); };
    const rerender = async () => { await saveNow(true); await refreshState(); this.render(el); };
    $('#addsrc').onclick = () => pick(async (p) => { const o = collect(); o.sources.push({ path: p, excludes: [] }); S.settings = await api('/settings', o); this.render(el); });
    const fo = $('#fcopen'); if (fo) fo.onclick = () => showFolderChanges(true);
    const jobGo = async (fn, msg) => { try { const r = await fn(); toast(r && r.queued ? 'Added to the queue. It starts when the current job finishes.' : msg, 'info'); } catch (e) { toast(e.message, true); } };
    $('#chcheck').onclick = () => jobGo(() => api('/rescan', {}), 'Checking…');
    $('#chlearn').onclick = () => jobGo(() => api('/learn', {}), 'Learning from new examples…');
    $('#chscan').onclick = () => jobGo(() => api('/run', { refs: false }), 'Scanning and tagging new files…');
    $('#chboth').onclick = () => jobGo(() => api('/run', { refs: true }), 'Scanning, learning and tagging…');
    const cc = $('#chclear'); if (cc) cc.onclick = async () => { await api('/changes/clear', {}); views.setup.render(el); };
    const tree = async (box, rel, depth) => {
      const r = await api('/dest/tree?rel=' + encodeURIComponent(rel));
      box.innerHTML = (r.dirs.length ? '' : '<span class="muted">No subfolders.</span>') + r.dirs.map((d) => `<div style="padding-left:${depth * 18}px"><span class="exp" data-dx="${esc(d.rel)}">${d.kids ? '▸' : '·'}</span> <label><input type="checkbox" data-dt="${esc(d.rel)}" ${d.on ? 'checked' : ''}> ${esc(d.name)}</label><div data-dk="${esc(d.rel)}"></div></div>`).join('') + (rel === '' && r.missing && r.missing.length ? `<p class="small bad">Chosen but not found on disk (renamed or deleted?): ${r.missing.map(esc).join(', ')}</p>` : '');
      box.querySelectorAll(':scope > div > label input[data-dt]').forEach((c) => (c.onchange = async () => { await api('/dest/target', { rel: c.dataset.dt, on: c.checked }); await loadChoices(); toast(c.checked ? 'Now a separate destination.' : 'No longer separate.'); }));
      box.querySelectorAll(':scope > div > [data-dx]').forEach((x) => (x.onclick = async () => { const k = box.querySelector(`[data-dk="${CSS.escape(x.dataset.dx)}"]`); if (k.innerHTML) { k.innerHTML = ''; x.textContent = '▸'; } else { x.textContent = '▾'; await tree(k, x.dataset.dx, depth + 1); } }));
    };
    tree($('#desttree'), '', 0).catch(() => { $('#desttree').textContent = 'Could not read the destination folder.'; });
    $('#addref').onclick = () => pick(async (p) => { const o = collect(); o.referenceRoots.push(p); S.settings = await api('/settings', o); toast('Added. Now untick any subfolders you don’t want it to learn from, and check where each one goes.'); location.hash = '#examples'; });
    $('#pickdest').onclick = () => pick((p) => { $('#dest').value = p; saveNow(); });
    $$('[data-rmsrc]').forEach((b) => (b.onclick = async () => { const o = collect(); o.sources.splice(+b.dataset.rmsrc, 1); const r = await api('/settings?report=1', o); S.settings = r.settings; toast(`Removed. Forgot ${fmtNum(r.cleaned.filesRemoved)} scanned files.`); await refreshState(); this.render(el); }));
    $$('[data-rmref]').forEach((b) => (b.onclick = async () => {
      const path = $(`[data-ref="${b.dataset.rmref}"]`).value.trim();
            const choice = await new Promise((res) => {
        modal(`<h1>Stop using this examples folder?</h1><p><code>${esc(path)}</code></p><p>The app will stop scanning it and learning from it right away (also if a scan is running). What should happen to what it already learned from it?</p>
          <div class="row wrap" style="margin-top:14px"><button id="rk_keep">Keep what it learned</button><button class="bad" id="rk_forget">Forget it too</button><button class="ghost" id="rk_no">Cancel</button></div>
          <p class="small muted" style="margin-top:10px">Kept examples still help the suggestions. You can forget them later from the list under this section.</p>`);
        $('#rk_keep').onclick = () => { closeModal(); res('keep'); }; $('#rk_forget').onclick = () => { closeModal(); res('forget'); }; $('#rk_no').onclick = () => { closeModal(); res(null); };
      });
      if (!choice) return;
      await api('/refs/remove', { path, keep: choice === 'keep' }); toast(choice === 'keep' ? 'Folder removed. What it learned is kept.' : 'Folder removed and its learned data forgotten.');
      await refreshState(); this.render(el);
    }));
    $$('[data-forgetkept]').forEach((b) => (b.onclick = async () => { if (!(await confirmBox('Forget what was learned?', 'Everything learned from <code>' + esc(b.dataset.forgetkept) + '</code> is removed. The files themselves are not touched.', 'Forget it', true))) return; const r = await api('/refs/forget-kept', { path: b.dataset.forgetkept }); toast(`Forgot ${fmtNum(r.removed)} learned examples.`); await refreshState(); this.render(el); }));
    $$('[data-src],[data-ex],[data-ref],[data-path],#dest').forEach((i) => (i.onchange = () => saveNow(true).then(() => refreshState())));
    $$('[data-def]').forEach((b) => (b.onclick = () => { const f = FIELD_BY_PATH[b.dataset.def]; const i = $(`[data-path="${f.path}"]`); i.value = String(f.def); saveNow(true); toast(`${f.label}: back to ${f.rec}`); }));
    if (0) $$('[data-grpreset]').forEach((b) => (b.onclick = async () => { const g = SETTING_GROUPS.find((x) => x.id === b.dataset.grpreset); g.fields.forEach((f) => { if (f.path !== 'saucenao.apiKey') { const i = $(`[data-path="${f.path}"]`); if (i) i.value = String(f.def); } }); await saveNow(true); toast(`${g.title}: back to the recommended values`); }));
    const tm = $('#testmodels'); if (tm) tm.onclick = async () => { const o = $('#modeltest'); tm.disabled = true; o.textContent = 'Loading the models and running a test picture… (the big model can take a minute)'; try { const r = await api('/models/test', {}); o.innerHTML = r.ok ? `<span class="chip ok">Works</span> ${esc(r.model)} on ${r.provider === 'dml' ? 'your graphics card (DirectML' + (r.gpu ? ': ' + esc(r.gpu) : '') + ')' : esc(r.provider)}, ready in ${r.seconds}s.${r.note ? ' <br>' + esc(r.note) : ''}` : `<span class="chip bad">Failed</span> ${esc(r.error)}`; } catch (e) { o.textContent = 'Test failed: ' + e.message; } tm.disabled = false; };
    const dl = $('#dlmodels'); if (dl) dl.onclick = async () => { const r = await api('/models/download', {}); toast(r.queued ? 'The download is queued after the current job.' : 'Downloading… the status bar shows the progress.', 'info'); };
    const start = (url, body) => async () => { await saveNow(true); try { const r = await api(url, body); toast(r && r.queued ? 'Added to the queue. It starts when the current job finishes.' : 'Started', 'info'); } catch (e) { toast(e.message, true); } };
    $('#run').onclick = start('/run', { refs: false }); $('#learn').onclick = start('/learn', {}); $('#runboth').onclick = start('/run', { refs: true });
    $('#redecide').onclick = async () => { await saveNow(true); await api('/redecide', {}); };
    $$('[data-open]').forEach((b) => (b.onclick = async () => { const r = await api('/open-folder', { which: b.dataset.open }); if (!r.ok) toast('Opening folders only works in the app window: ' + r.path); }));
    $$('[data-reset]').forEach((b) => (b.onclick = async () => {
      const r = RESETS.find((x) => x.what === b.dataset.reset); if (!r) return;
      if (!(await confirmBox(r.title + '?', esc(r.text) + '<br><br>Your pictures and videos are not touched.', r.btn, !!r.danger))) return;
      try { const res = await api('/reset', { what: r.what }); toast(res.message); if (r.after === 'redecide') await api('/redecide', {}); await refreshState(); this.render(el); } catch (e) { toast(e.message, true); }
    }));
  },
};


// ---------- Change folders: another destination and/or other folders to sort, keeping what the app learned ----------
async function changeFolders(pre) {
  await refreshState(); const s = S.settings;
  const st = pre || { dest: s.destinationRoot || '', sources: (s.sources || []).map((x) => ({ ...x, keep: true })) };
  const draw = () => {
    modal(`<h1>Change folders</h1><p class="muted">Point the app at another destination or other folders to sort. Everything it knows about a destination folder is kept under the folder’s name, so a destination with the same layout carries straight on. The next step shows exactly what carries over before anything changes.</p>
      <h2>Destination</h2><div class="pathrow"><input type="text" id="sw_dest" value="${esc(st.dest)}" placeholder="For example E:\\Pictures\\Temporary"><button id="sw_pick">Browse…</button></div>
      ${s.destinationRoot ? `<p class="small faint">Now: <code>${esc(s.destinationRoot)}</code></p>` : ''}
      <h2>Folders to sort</h2><div class="mlist">${st.sources.map((x, i) => `<label class="swopt"><input type="checkbox" data-swsrc="${i}" ${x.keep ? 'checked' : ''}><span><code>${esc(x.path)}</code>${x.isNew ? ' <span class="chip ok">new</span>' : ''}<br><span class="small faint">${x.keep ? 'Kept' : 'Removed: the app forgets its files (they stay on disk)'}</span></span></label>`).join('') || '<p class="small muted">None yet.</p>'}</div>
      <div class="row" style="margin-top:6px"><button id="sw_addsrc">${icon('plus')}Add folder…</button></div>
      <div class="acts"><button class="ghost" id="sw_cancel">Cancel</button><button class="pri" id="sw_next">Check what carries over</button></div>`, null, 'switch');
    $('#sw_dest').oninput = (e) => { st.dest = e.target.value; };
    $('#sw_pick').onclick = async () => { const r = await api('/pick-folder', {}); if (r.path) { st.dest = r.path; draw(); } else if (r.unsupported) toast('The folder picker only works in the app window. Type the path instead.', true); };
    $('#sw_addsrc').onclick = async () => { const r = await api('/pick-folder', {}); if (r.path) { st.sources.push({ path: r.path, excludes: [], keep: true, isNew: true }); draw(); } else if (r.unsupported) toast('The folder picker only works in the app window.', true); };
    $$('[data-swsrc]').forEach((c) => (c.onchange = () => { st.sources[+c.dataset.swsrc].keep = c.checked; draw(); }));
    $('#sw_cancel').onclick = closeModal;
    $('#sw_next').onclick = async () => { st.dest = $('#sw_dest').value.trim(); let pv; try { pv = await api('/switch/preview', { dest: st.dest, sources: st.sources.filter((x) => x.keep) }); } catch (e) { return toast(e.message, true); } review(pv); };
  };
  const review = (pv) => {
    const F = pv.folders, K = pv.knowledge, O = pv.old; const destChanged = pv.oldDest.toLowerCase() !== pv.newDest.toLowerCase();
    const opts = (cur) => `<option value="">Keep what it knows (folder made when needed)</option><option value="__forget" ${cur === '__forget' ? 'selected' : ''}>Forget what it knows about it</option>${F.choices.map((c) => `<option value="${esc(c)}" ${cur === c ? 'selected' : ''}>Carry it over to: ${esc(c)}</option>`).join('')}`;
    const match = F.total ? `${fmtNum(F.same + F.renamed.length)} of ${fmtNum(F.total)}` : '0';
    modal(`<h1>Change folders: what carries over</h1>
      <p class="muted"><code>${esc(pv.oldDest || '(none)')}</code> → <code>${esc(pv.newDest)}</code></p>
      <div class="swstat"><div><b>${match}</b>folder names match${F.missing.length ? '' : ' — everything lines up'}</div><div><b>${fmtNum(K.ranked)}</b>folders keep their rules and place in the priority order</div><div><b>${fmtNum(K.examples)}</b>learned examples across ${fmtNum(K.exampleFolders)} folders</div><div><b>${K.learned ? 'Kept' : '—'}</b>what it learned about NSFW, Very and art or real</div></div>
      <p class="small muted">Also kept: ${fmtNum(K.mappings)} examples-folder mapping${K.mappings === 1 ? '' : 's'}, ${fmtNum(K.series)} series assignment${K.series === 1 ? '' : 's'}, your settings and the AI models. The examples folders (${K.exampleRoots.map((x) => `<code>${esc(x)}</code>`).join(', ') || 'none'}) don’t change.</p>
      ${F.renamed.length ? `<h2>Same folder, different capitals (${F.renamed.length})</h2><p class="small muted">Carried over automatically.</p><div class="swlist">${F.renamed.map((r) => `<div class="swrow"><span>${esc(r.from)}</span><span class="k">→</span><span>${esc(r.to)}</span></div>`).join('')}</div>` : ''}
      ${F.missing.length ? `<h2>Not in the new destination (${F.missing.length})</h2><p class="small muted">Say what each one became. Nothing is lost if you keep it: the folder is made the first time something is approved into it.</p><div class="swlist">${F.missing.map((m) => `<div class="swrow"><span><b>${esc(m.name)}</b><br><span class="k">${m.rank ? '#' + m.rank + ' in the order · ' : ''}${fmtNum(m.examples)} examples</span></span><span class="k">→</span><select data-swmap="${esc(m.name)}">${opts(m.suggest)}</select></div>`).join('')}</div>` : ''}
      ${F.added.length ? `<h2>Only in the new destination (${F.added.length})</h2><p class="small muted">They get a starting rule and go just before the catch-all folders; add examples so the app learns them.</p><p class="small">${F.added.map(esc).join(' · ')}</p>` : ''}
      ${O.files || O.history ? `<h2>The old setup</h2>
        <label class="swopt"><input type="checkbox" id="sw_forget" checked><span><b>Forget the old files</b> — ${fmtNum(O.files)} file record${O.files === 1 ? '' : 's'} (${fmtNum(O.moved)} already moved${destChanged ? ' into the old destination' : ''}, ${fmtNum(O.fresh)} waiting for review), their thumbnails, previews, duplicates, sets and suggestions, and the history of ${fmtNum(O.history)} move${O.history === 1 ? '' : 's'}.<br><span class="small faint">Nothing on disk is touched. Moves made in the old setup can no longer be undone from the app afterwards.</span></span></label>
        ${O.movedLearnable ? `<label class="swopt" style="margin-left:24px"><input type="checkbox" id="sw_keepappr" checked><span><b>Keep what your approvals taught it</b> — the ${fmtNum(O.movedLearnable)} pictures you approved become learned examples for their folders (they were already read, so nothing is read again).</span></label>` : ''}` : ''}
      ${pv.busy ? `<p class="warnline">A job is running. Changing folders waits until it has finished, or stop it first.</p>` : ''}
      <div class="acts"><button class="ghost" id="sw_back">Back</button><button class="pri" id="sw_go">Change folders</button></div>`, null, 'switch');
    const fg = $('#sw_forget'), ka = $('#sw_keepappr'); if (fg && ka) fg.onchange = () => { ka.disabled = !fg.checked; };
    $('#sw_back').onclick = () => draw();
    $('#sw_go').onclick = async () => {
      const map = {}; $$('[data-swmap]').forEach((x) => { if (x.value === '__forget') map[x.dataset.swmap] = ''; else if (x.value) map[x.dataset.swmap] = x.value; });
      const body = { dest: pv.newDest, sources: st.sources.filter((x) => x.keep).map((x) => ({ path: x.path, excludes: x.excludes || [] })), map, forget: fg ? fg.checked : false, keepApprovals: ka ? ka.checked : false };
      let r; try { r = await api('/switch', body); } catch (e) { return toast(e.message, true); }
      closeModal(); await refreshState();
      const bits = [r.filesForgotten ? `forgot ${fmtNum(r.filesForgotten)} old file records and ${fmtNum(r.historyForgotten)} moves` : '', r.examplesKept ? `kept ${fmtNum(r.examplesKept)} approvals as examples` : '', r.renamed ? `carried ${r.renamed} folder name${r.renamed === 1 ? '' : 's'} over` : ''].filter(Boolean);
      toast(`Folders changed${bits.length ? ': ' + bits.join(', ') : ''}. Checking the new folders now; then use Learn and scan.`);
      views.setup.sec = 'learn'; if (curRoute() === 'setup') views.setup.render($('#view')); else location.hash = '#setup';
    };
  };
  draw();
}
