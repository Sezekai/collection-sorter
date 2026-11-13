// ---------- boot ----------
(async () => {
  try { const u = await api('/ui'); if (u && typeof u === 'object') PREFS = { ...PREFS, ...u, show: { ...PREFS.show, ...(u.show || {}) } }; } catch { /* defaults */ }
  await loadLook(); applyPanelPrefs(); buildNav(); setNav(PREFS.nav !== false);
  await refreshState(); connectEvents(); Status.draw(); if (S.job) { Status.job({ running: true, name: S.job }); showProgress(S.progress); }
  route(); navReplace(); setInterval(refreshState, 15000);
})();
// the engine stopped (crash): say so in the app, with Restart and the log (no Windows pop-up)
if (window.csNative && window.csNative.onEngine) window.csNative.onEngine((d) => {
  if (!d || !d.stopped) return;
  modal(`<h1>The engine stopped</h1><p>The part of Collection Sorter that reads and moves files stopped unexpectedly${d.code != null ? ` (code ${esc(String(d.code))})` : ''}. Nothing is lost: moves already made are in Undo, and anything half-done picks up where it stopped.</p><div class="acts"><button class="ghost" id="en_log">Open the log</button><button class="pri" id="en_restart">Restart it</button></div>`, null, 'confirm');
  $('#en_log').onclick = () => window.csNative.openLog(); $('#en_restart').onclick = () => window.csNative.restartEngine();
});
