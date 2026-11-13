// Folders that were renamed, merged or deleted outside the app: ask what happened, then move what the app knows.
const FC = { open: false, later: 0, data: null, pick: new Set(), mode: 'list', keep: {} };
async function showFolderChanges(force) {
  if (FC.open) return;
  let d; try { d = await api('/destchanges'); } catch { return; }
  if (!d.gone.length) { if (force) toast('No folders are waiting to be sorted out.'); return; }
  FC.open = true; FC.data = d; FC.pick = new Set(); FC.mode = 'list'; FC.keep = {}; FC.sel = {};
  d.gone.forEach((g) => { FC.sel[g.name] = g.suggest ? g.suggest.to : ''; });
  fcDraw();
}
async function fcOnClose() { FC.open = false; try { FC.later = (await api('/state')).folderChanges; } catch { /* ignore */ } }
function fcClose() { closeModal(); }
function fcOpts(d, cur, skip) {
  const added = d.added.filter((x) => !skip || !skip.includes(x)); const rest = d.choices.filter((x) => !d.added.includes(x) && !d.gone.some((g) => g.name === x));
  return `<option value="">— choose the folder it became —</option>${added.length ? `<optgroup label="New folders">${added.map((x) => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('')}</optgroup>` : ''}<optgroup label="Existing folders">${rest.map((x) => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('')}</optgroup>`;
}
function fcDraw() {
  const d = FC.data;
  if (!d.gone.length) { fcClose(); toast('All folder changes are sorted out.'); refreshState(); if (typeof loadChoices === 'function') loadChoices(); if (curRoute() === 'setup') views.setup.render($('#view')); return; }
  if (FC.mode === 'merge') return fcDrawMerge();
  const nSug = d.gone.filter((g) => FC.sel[g.name]).length;
  const rows = d.gone.map((g, i) => `<tr><td style="width:28px"><input type="checkbox" data-pk="${i}" ${FC.pick.has(g.name) ? 'checked' : ''} title="Tick two or more to merge them"></td>
    <td><b>${esc(g.name)}</b><div class="small muted">${g.hasRule ? 'its rule is kept · ' : ''}${fmtNum(g.examples)} learned example(s) · ${fmtNum(g.pending)} waiting in Review</div></td>
    <td><select data-to="${i}" style="max-width:300px">${fcOpts(d, FC.sel[g.name])}</select>${g.suggest && g.suggest.to === FC.sel[g.name] ? `<div class="small muted">Suggested: ${esc(g.suggest.why)}${g.suggest.score >= 0.5 ? ` (${Math.round(g.suggest.score * 100)}%)` : ''}</div>` : ''}</td>
    <td class="num"><button class="sm" data-ok="${i}" ${FC.sel[g.name] ? '' : 'disabled'}>Yes, it was renamed</button> <button class="ghost sm" data-del="${i}" title="It was deleted. Forget what the app knows about it.">Deleted</button></td></tr>`).join('');
  modal(`<h1>Folders changed</h1><p class="small">These folders in your destination can no longer be found. The app knows folders by name, so it needs you to say what happened to each one. What it has learned about a folder (its rule, learned examples, example mappings, undo history) moves to the folder you choose. Nothing on disk is touched.</p>
    <table class="exTable" style="width:100%"><tr><th></th><th>Missing folder</th><th>It is now called</th><th></th></tr>${rows}</table>
    <div class="row wrap" style="margin-top:14px"><button id="fcall" ${nSug ? '' : 'disabled'}>Accept all suggestions (${nSug})</button><button class="ghost" id="fcmerge" disabled>Merge ticked folders into one…</button><span class="grow"></span><button class="ghost" id="fclater">Decide later</button></div>
    <p class="small muted" style="margin:8px 0 0">Two folders merged into one? Tick both (or just the one that disappeared) and press “Merge ticked folders into one…”. A folder that is genuinely new needs no answer.</p>`, fcOnClose, 'fc');
  const upd = () => { $('#fcmerge').disabled = FC.pick.size < 1; $('#fcmerge').title = FC.pick.size ? '' : 'Tick one or more folders first'; };
  $$('[data-pk]').forEach((c) => (c.onchange = () => { const n = d.gone[+c.dataset.pk].name; c.checked ? FC.pick.add(n) : FC.pick.delete(n); upd(); }));
  $$('[data-to]').forEach((s) => (s.onchange = () => { FC.sel[d.gone[+s.dataset.to].name] = s.value; const b = $(`[data-ok="${s.dataset.to}"]`); if (b) b.disabled = !s.value; const all = $('#fcall'); if (all) { const n = d.gone.filter((g) => FC.sel[g.name]).length; all.disabled = !n; all.textContent = `Accept all suggestions (${n})`; } }));
  const run = async (actions) => { try { FC.data = await api('/destchanges/resolve', { actions }); FC.data.gone.forEach((g) => { if (FC.sel[g.name] === undefined || (!FC.sel[g.name] && g.suggest)) FC.sel[g.name] = g.suggest ? g.suggest.to : ''; }); fcDraw(); } catch (e) { toast(e.message, true); } };
  $$('[data-ok]').forEach((b) => (b.onclick = () => run([{ type: 'merge', from: [d.gone[+b.dataset.ok].name], to: FC.sel[d.gone[+b.dataset.ok].name] }])));
  $$('[data-del]').forEach((b) => (b.onclick = async () => { const n = d.gone[+b.dataset.del].name; if (await confirmBox('Mark it as deleted?', `“${esc(n)}” is forgotten: its rule is removed and it stops being a target. Examples it learned stay in the app's memory but nothing points at them.`, 'Yes, it was deleted', true)) { FC.open = true; run([{ type: 'deleted', name: n }]); } else fcDraw(); }));
  $('#fcall').onclick = () => run(d.gone.filter((g) => FC.sel[g.name]).map((g) => ({ type: 'merge', from: [g.name], to: FC.sel[g.name] })));
  $('#fcmerge').onclick = () => { FC.mode = 'merge'; FC.tgt = ''; fcDraw(); };
  $('#fclater').onclick = fcClose; upd();
}
function fcDrawMerge() {
  const d = FC.data; const from = d.gone.filter((g) => FC.pick.has(g.name));
  if (!from.length) { FC.mode = 'list'; return fcDraw(); }
  from.forEach((g) => { FC.keep[g.name] = FC.keep[g.name] || { rules: true, examples: true, mappings: true }; });
  modal(`<h1>Merge into one folder</h1><p class="small">Choose the folder everything ended up in. The app combines what it knows about each folder you merge into that one. Untick anything you do <b>not</b> want to carry over from a particular folder.</p>
    <label>Merged folder (new name or an existing folder)</label><select id="fctgt" style="max-width:420px">${fcOpts(d, FC.tgt, from.map((g) => g.name))}</select>
    <table class="exTable" style="width:100%;margin-top:10px"><tr><th>Folder that disappeared</th><th>Rule: words, series, characters</th><th>Learned examples</th><th>Example mappings &amp; sample sizes</th></tr>${from.map((g, i) => `<tr><td><b>${esc(g.name)}</b><div class="small muted">${fmtNum(g.examples)} example(s)</div></td>
      <td><input type="checkbox" data-k="${i}|rules" ${FC.keep[g.name].rules ? 'checked' : ''}></td><td><input type="checkbox" data-k="${i}|examples" ${FC.keep[g.name].examples ? 'checked' : ''}></td><td><input type="checkbox" data-k="${i}|mappings" ${FC.keep[g.name].mappings ? 'checked' : ''}></td></tr>`).join('')}</table>
    <p class="small muted">Combining means the target ends up with every folder's keywords, series and characters, and the learned pictures of all of them. If the merged folder is a brand-new name, the first folder's rule is used as the base. Pictures waiting in Review that pointed at the old folders now point at the merged one.</p>
    <div class="row" style="margin-top:12px"><button id="fcgo" ${FC.tgt ? '' : 'disabled'}>Merge</button><button class="ghost" id="fcback">Back</button></div>`, fcOnClose, 'fc');
  $('#fctgt').onchange = (e) => { FC.tgt = e.target.value; $('#fcgo').disabled = !FC.tgt; };
  $$('[data-k]').forEach((c) => (c.onchange = () => { const [i, k] = c.dataset.k.split('|'); FC.keep[from[+i].name][k] = c.checked; }));
  $('#fcback').onclick = () => { FC.mode = 'list'; fcDraw(); };
  $('#fcgo').onclick = async () => { try { FC.data = await api('/destchanges/resolve', { actions: from.map((g) => ({ type: 'merge', from: [g.name], to: FC.tgt, keep: FC.keep[g.name] })) }); FC.pick = new Set(); FC.mode = 'list'; FC.data.gone.forEach((g) => { FC.sel[g.name] = g.suggest ? g.suggest.to : ''; }); fcDraw(); } catch (e) { toast(e.message, true); } };
}
