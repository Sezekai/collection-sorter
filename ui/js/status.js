// =====================================================================================
//  STATUS BAR, TITLE-BAR PILLS, LOG DRAWER  (STANDARDS.md "Progress you can trust", DESIGN.md "Status bar")
// =====================================================================================
const PHASES = { scan: 'Scanning folders', refscan: 'Scanning examples', refs: 'Learning from examples', analyze: 'Reading files', dupes: 'Finding duplicates', sets: 'Finding connected sets', decide: 'Choosing folders', move: 'Moving', undo: 'Putting back', sauce: 'Source lookup', download: 'Downloading models', models: 'Loading the AI models', rescan: 'Checking for changes', relocate: 'Moving data', diagnose: 'Diagnosing', done: 'Finished', error: 'Problem' };
const hms = (sec) => { sec = Math.max(0, Math.round(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const STALL_S = 20;

const Status = {
  p: null, last: null, lastAt: 0, lastDone: -1, result: null, paused: false, gpu: null,
  progress(e) {
    if (!e) return;
    const prog = e.done != null ? e.done : e.got != null ? e.got : e.seen;
    if (prog !== this.lastDone || e.phase !== (this.p && this.p.phase)) { this.lastDone = prog; this.lastAt = Date.now(); }
    this.p = e;
    if (e.phase === 'error') { logLine(e.note || 'Something went wrong.', 'e'); toast(e.note || 'Something went wrong.', true); }
    if (e.gpu) this.gpu = e.gpu;
    this.draw(); this.pills();
  },
  job(j) {
    if (j.running) { this.result = null; this.paused = false; if (!this.p || this.p.finished) this.p = { phase: j.name === 'learn' ? 'refs' : j.name === 'rescan' ? 'rescan' : 'scan', note: '' }; this.lastAt = Date.now(); }
    else { this.result = j.result || this.finishedText(); this.p = null; this.gpu = null; if (j.error) logLine(j.error, 'e'); }
    this.draw(); this.pills();
  },
  finishedText() { const p = this.p; if (!p) return { ok: true, text: 'Finished' }; if (p.phase === 'error') return { ok: false, text: p.note || 'Stopped with a problem. The log has the details.' }; return { ok: true, text: `Finished: ${PHASES[p.phase] ? PHASES[p.phase].toLowerCase() : p.phase}${p.total ? ` · ${fmtNum(p.done || p.total)} of ${fmtNum(p.total)}` : ''}${p.failed ? ` · ${fmtNum(p.failed)} unreadable` : ''}${p.elapsed != null ? ` · took ${hms(p.elapsed)}` : ''}` }; },
  // what the bar knows: name, what it is on, percent (never 100 until the end), times, stalled?
  info() {
    const e = this.p; if (!e) return null;
    const name = PHASES[e.phase] || e.phase; let on = e.note || ''; let pct = null; let unknown = false;
    if (e.phase === 'download') { if (e.got) on = `${e.file || ''}: ${fmtSize(e.got)}${e.total ? ' of ' + fmtSize(e.total) : ''}${e.rate ? ` · ${(e.rate / 1e6).toFixed(1)} MB/s` : ''}`; pct = e.total ? (e.got / e.total) * 100 : null; unknown = !e.total; }
    else if (e.total) { pct = (e.done / e.total) * 100; on = `${fmtNum(e.done)} of ${fmtNum(e.total)}${e.note ? ' · ' + e.note : ''}${e.rate ? ` · ${e.rate >= 1 ? e.rate.toFixed(1) + ' / s' : (e.rate * 60).toFixed(1) + ' / min'}` : ''}`; }
    else { unknown = true; if (e.seen != null) on = `${fmtNum(e.seen)} found${e.added != null ? `, ${fmtNum(e.added)} new` : ''} · size not known yet${e.note ? ' · ' + e.note : ''}`; }
    if (pct != null && !e.finished) pct = Math.min(99, Math.floor(pct));
    const stalled = !this.paused && Date.now() - this.lastAt > STALL_S * 1000;
    const el = e.elapsed != null ? e.elapsed : null;
    let times = el != null ? `${hms(el)} elapsed` : '';
    if (this.paused) times += (times ? ' · ' : '') + 'paused';
    else if (stalled) times = `No progress for ${hms((Date.now() - this.lastAt) / 1000)} · the log shows what is running`;
    else if (e.eta != null && !unknown) times += ` · about ${hms(e.eta)} left${e.eta > 5400 ? ` (around ${new Date(Date.now() + e.eta * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}`;
    else if (unknown || pct == null || (pct < 1 && (el || 0) < 8)) times += (times ? ' · ' : '') + 'working out time left…';
    const queued = (S.queue || []).length;
    return { name, on, pct, unknown, times, stalled, queued, step: e.step, steps: e.steps, model: e.model, device: e.device, e };
  },
  draw() {
    const sb = $('#statusbar'); if (!sb) return; const i = this.info();
    const logB = `<button class="ghost" id="sb_log" title="Open or close the log (L)">${icon('log')}Log</button>`;
    if (!i) {
      const r = this.result; const q = (S.queue || []).length;
      sb.innerHTML = r ? `<span class="jn ${r.ok ? 'ok' : 'bad'}">${r.ok ? 'Finished' : 'Stopped'}</span><span class="on" title="${esc(r.text)}">${esc(r.text.replace(/^Finished: /, ''))}</span><span class="sp"></span>${r.next ? `<button class="pri" id="sb_next">${esc(r.next.label)}</button>` : ''}${logB}`
        : `<span class="jn">Ready</span><span class="on">${q ? `${q} job${q === 1 ? '' : 's'} queued` : 'Nothing running'}</span><span class="sp"></span>${logB}`;
    } else {
      const gpu = this.gpuChip();
      const q = i.queued ? ` · ${i.queued} more queued` : '';
      sb.innerHTML = `<span class="jn">${esc(i.name)}</span><span class="on" id="sb_on" title="${esc(i.on)}">${esc(i.on + q)}</span><span class="sbar ${i.unknown ? 'slide' : ''}"><i style="width:${i.unknown ? 30 : i.pct || 0}%"></i></span><span class="pc">${i.unknown ? '' : (i.pct || 0) + '%'}</span><span class="tm ${i.stalled ? 'warn' : ''}">${esc(i.times)}</span><span class="sp"></span>${gpu}
        <button id="sb_pause">${this.paused ? 'Resume' : 'Pause'}</button><button id="sb_stop" title="${i.queued ? 'Stops this job and empties the queue. Finished work is kept.' : 'Stops after the current step. Finished work is kept.'}">${i.queued ? 'Stop all' : 'Stop'}</button>${logB}`;
      $('#sb_pause').onclick = async () => { await api('/job', { action: this.paused ? 'resume' : 'pause' }); this.paused = !this.paused; this.lastAt = Date.now(); this.draw(); this.pills(); };
      $('#sb_stop').onclick = async () => { await api('/job', { action: 'cancel' }); toast('Stopping after the current step…', 'info'); };
      $('#sb_on').onclick = (ev) => this.pop(ev.currentTarget);
    }
    $('#sb_log').onclick = () => Log.toggle();
    const nx = $('#sb_next'); if (nx) nx.onclick = () => { if (this.result.next.route === 'log') Log.open(); else location.hash = '#' + this.result.next.route; };
  },
  gpuChip() {
    const g = this.gpu; const p = this.p; if (!p) return '';
    const ai = ['analyze', 'refs', 'models'].includes(p.phase); if (!ai) return '';
    if (g && g.cpu) return '<span class="gchip cpu"><span class="gl"></span><span>On the CPU (slow)</span></span>';
    if (g && g.name) return `<span class="gchip" title="${esc(g.name)}"><span class="gl"><i style="height:${g.load != null ? g.load : 0}%"></i></span><span>${esc(g.name)}${g.load != null ? ` · ${g.load}%` : ''}${g.memUsed != null && g.memTotal ? ` · ${(g.memUsed / 1024).toFixed(1)} / ${(g.memTotal / 1024).toFixed(1)} GB` : ''}</span></span>`;
    if (p.device) return `<span class="gchip ${/cpu|processor/i.test(p.device) ? 'cpu' : ''}"><span class="gl"></span><span>${/cpu|processor/i.test(p.device) ? 'On the CPU (slow)' : esc(p.device)}</span></span>`;
    return '';
  },
  // title-bar pills: the full text when there is room; cut short with "…" otherwise, and a click shows everything
  pills() {
    const host = $('#pills'); if (!host) return; const out = []; const i = this.info();
    if (i) out.push({ id: 'job', warn: i.stalled, text: `${i.name}${i.e.total ? ` ${fmtNum(i.e.done)}/${fmtNum(i.e.total)}` : ''}${i.e.note && !i.e.total ? ' · ' + i.e.note : ''}${i.queued ? ` · ${i.queued} queued` : ''}`, pct: i.unknown ? null : i.pct });
    const sc = S.sauce; if (sc && sc.running) out.push({ id: 'sauce', text: `Source lookup${sc.paused ? ' · paused' : ''}${sc.done != null && sc.total ? ` ${fmtNum(sc.done)}/${fmtNum(sc.total)}` : ''}${sc.current ? ' · ' + sc.current : ''}`, pct: sc.total ? Math.min(99, Math.floor((sc.done / sc.total) * 100)) : null });
    host.innerHTML = out.map((p) => `<span class="pill ${p.warn ? 'warn' : ''}" data-pill="${p.id}" title="Click for the details"><span class="led"></span><span class="pt">${esc(p.text)}</span>${p.pct != null ? `<span class="mini"><i style="width:${p.pct}%"></i></span><span class="pc">${p.pct}%</span>` : ''}</span>`).join('');
    $$('[data-pill]', host).forEach((el) => (el.onclick = () => this.pop(el, el.dataset.pill)));
    const tp = $('#pillpop'); if (tp && tp.dataset.kind) this.pop(null, tp.dataset.kind, true);
  },
  pop(anchor, kind = 'job', refresh = false) {
    let m = $('#pillpop');
    if (m && !refresh && m.dataset.kind === kind) { m.remove(); return; }
    if (refresh && !m) return;
    const i = this.info(); const sc = S.sauce || {};
    if (kind === 'job' && !i) { if (m) m.remove(); return; }
    if (kind === 'sauce' && !sc.running) { if (m) m.remove(); return; }
    const rows = kind === 'job'
      ? [['Job', i.name], ['Working on', i.on || '—'], ['Done', i.unknown ? 'size not known yet' : `${i.pct}%`], ['Time', i.times], i.model && ['Model', i.model], i.device && ['Running on', i.device], i.queued && ['Queued', (S.queue || []).map((q) => q.label).join(', ')], (i.steps || []).length && ['Steps', i.steps.map((s) => `${s.label}: ${s.state === 'done' ? 'done' : s.state === 'now' ? 'now' : 'queued'}`).join(' · ')]].filter(Boolean)
      : [['Job', 'Source lookup'], ['State', sc.paused ? 'paused' : 'working'], sc.total && ['Done', `${fmtNum(sc.done || 0)} of ${fmtNum(sc.total)}`], sc.current && ['Picture', sc.current]].filter(Boolean);
    if (!m) { m = document.createElement('div'); m.id = 'pillpop'; m.className = 'pillpop'; document.body.appendChild(m); setTimeout(() => { const off = (e) => { if (!m.isConnected) return document.removeEventListener('pointerdown', off, true); if (!m.contains(e.target) && !e.target.closest('[data-pill],#sb_on')) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true); }, 0); }
    m.dataset.kind = kind;
    m.innerHTML = `<div class="ttl">${esc(kind === 'job' ? i.name : 'Source lookup')}</div><div class="kvs">${rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(String(v))}</span>`).join('')}</div><div class="row">${kind === 'job' ? `<button id="pp_pause">${this.paused ? 'Resume' : 'Pause'}</button><button id="pp_stop">Stop</button>` : '<button id="pp_go">Open Source lookup</button>'}<span class="grow"></span><button class="ghost" id="pp_log">${icon('log')}Log</button></div>`;
    if (anchor) { const r = anchor.getBoundingClientRect(); const w = Math.min(380, innerWidth - 16); m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px'; if (r.top > innerHeight / 2) { m.style.top = ''; m.style.bottom = innerHeight - r.top + 6 + 'px'; } else { m.style.bottom = ''; m.style.top = r.bottom + 6 + 'px'; } }
    const on = (id, fn) => { const b = $('#' + id, m); if (b) b.onclick = fn; };
    on('pp_pause', () => $('#sb_pause') && $('#sb_pause').click()); on('pp_stop', () => $('#sb_stop') && $('#sb_stop').click());
    on('pp_go', () => { m.remove(); location.hash = '#sauce'; }); on('pp_log', () => { m.remove(); Log.open(); });
  },
};
setInterval(() => { if (Status.p) { Status.draw(); Status.pills(); } }, 1000);
function showProgress(e) { Status.progress(e); }

// ---------- the log: a drawer over the bottom of the screen (L), opened by itself on an error ----------
const Log = {
  lines: [], max: 2000,
  add(text, level = 'i', ts = Date.now()) { this.lines.push({ text: String(text), level, ts }); if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max); if (this.isOpen()) this.paint(); if (level === 'e' && !this.isOpen() && !document.body.classList.contains('viewing')) this.open(); },
  isOpen() { return !$('#logdrawer').classList.contains('hidden'); },
  async open() {
    const d = $('#logdrawer'); d.classList.remove('hidden');
    if (!this.loaded) { this.loaded = true; try { const r = await api('/log?lines=400'); const old = (r.lines || []).map((x) => ({ text: x.text, level: x.level || 'i', ts: x.ts || 0 })); this.lines = [...old, ...this.lines.filter((l) => !old.some((o) => o.text === l.text && o.ts === l.ts))]; } catch { /* engine log not available */ } }
    d.innerHTML = `<div class="lh"><b>Log</b><span class="small faint">${esc(this.where || '')}</span><span class="grow"></span><button class="ghost sm" id="lg_copy">Copy</button><button class="ghost sm" id="lg_clear">Clear</button><button class="ghost sm" id="lg_folder">Open logs folder</button><button class="ghost sm" id="lg_close" title="Close (L or Esc)">${icon('x')}</button></div><pre id="lg_pre"></pre>`;
    $('#lg_close').onclick = () => this.close(); $('#lg_clear').onclick = () => { this.lines = []; this.paint(); };
    $('#lg_copy').onclick = () => navigator.clipboard.writeText(this.text()).then(() => toast('Log copied')).catch(() => toast('Could not copy the log', true));
    $('#lg_folder').onclick = async () => { const r = await api('/open-folder', { which: 'logs' }); if (!r.ok) toast('Opening folders works in the app window: ' + r.path, true); };
    this.paint();
  },
  close() { $('#logdrawer').classList.add('hidden'); },
  toggle() { this.isOpen() ? this.close() : this.open(); },
  text() { return this.lines.map((l) => `${l.ts ? new Date(l.ts).toLocaleTimeString() : ''} ${l.text}`).join('\n'); },
  paint() { const p = $('#lg_pre'); if (!p) return; p.innerHTML = this.lines.map((l) => `<span class="${l.level === 'e' ? 'e' : l.level === 'w' ? 'w' : ''}">${esc(`${l.ts ? new Date(l.ts).toLocaleTimeString() : ''}  ${l.text}`)}</span>`).join('\n'); p.scrollTop = p.scrollHeight; },
};
function logLine(text, level, ts) { Log.add(text, level, ts); }
