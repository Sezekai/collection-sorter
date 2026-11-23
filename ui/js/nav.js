// ---------- back / forward ----------
// Every step you take (a tag, a folder, a tab, opening a picture, a new screen) is one history entry, so the mouse Back / Forward buttons
// (and Alt+Left / Alt+Right) walk through them like a browser: back from a tag selection goes to the previous selection, back from that to the picture, and so on.
const NVH = { lock: false, pendingViewer: null, gate: 0 };
const NVH_KEYS = ['lane', 'folder', 'state', 'sort', 'q', 'rating', 'kind', 'fhq', 'tmode', 'tmin', 'tq', 'seed', 'tsrc'];
function navSnap() {
  const r = curRoute(); const st = { r, viewer: null };
  try {
    const B = views[r] && views[r].browse && typeof bstate === 'function' ? bstate(r) : null;
    if (B) { st.rv = { tinc: B.tinc.slice(), texc: B.texc.slice() }; for (const k of NVH_KEYS) if (B[k] !== undefined) st.rv[k] = B[k]; }
    if (typeof viewerOpen === 'function' && viewerOpen() && VW.id != null) st.viewer = VW.id;
  } catch { /* snapshot is best effort */ }
  return st;
}
function navPush() {
  if (NVH.lock) return;
  try { const a = JSON.stringify(history.state), b = JSON.stringify(navSnap()); if (a === b) return; history.pushState(navSnap(), '', location.href); } catch { /* no history */ }
}
function navReplace() { try { history.replaceState(navSnap(), '', location.href); } catch { /* no history */ } }
function navGo(d) { const t = Date.now(); if (t - NVH.gate < 250) return; NVH.gate = t; history.go(d); }
async function navApplyViewer() {
  const id = NVH.pendingViewer; NVH.pendingViewer = null;
  const open = typeof viewerOpen === 'function' && viewerOpen();
  if (id == null) { if (open) closeViewerNow(); return; }
  for (let i = 0; i < 80 && (RV.loading || !RV.items.length); i++) await new Promise((r) => setTimeout(r, 60));
  if (RV.items.some((x) => x.id === id)) { if (!open || VW.id !== id) await openViewer(id); } else if (open) closeViewerNow();
}
window.addEventListener('popstate', async (e) => {
  const st = e.state && e.state.r ? e.state : { r: curRoute(), viewer: null }; // an entry made by clicking a menu item has no saved state: show it as it is, with no picture open
  NVH.lock = true; const before = JSON.stringify(navSnap().rv || null);
  try {
    if (st.rv) { const B = bstate(st.r); Object.assign(B, st.rv, { tinc: st.rv.tinc.slice(), texc: st.rv.texc.slice() }); }
    NVH.pendingViewer = st.viewer ?? null;
    if (typeof viewerOpen === 'function' && viewerOpen() && st.viewer == null) closeViewerNow(); // closing is instant
    if (st.r === curRoute()) {
      const v = views[st.r];
      if (v && v.browse && st.rv) { const same = RV.mode === st.r && before === JSON.stringify(st.rv); if (!same) route(); }
      await navApplyViewer();
    } // otherwise the hashchange handler shows the other screen, then finishes with navApplyViewer
  } finally { setTimeout(() => { NVH.lock = false; }, 50); }
});
// mouse side buttons
window.addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); navGo(-1); } else if (e.button === 4) { e.preventDefault(); navGo(1); } });
window.addEventListener('auxclick', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
if (window.csNative && window.csNative.onNav) window.csNative.onNav((d) => navGo(d));
