// =====================================================================================
//  THE LOOK (DESIGN.md "Appearance"): themes, presets, every colour, fonts, corners, density,
//  button style, outline / highlight, plus the Collection Sorter extras the owner kept.
//  Kept in appearance.json in the data folder. Theme files are the suite's shared *.theme.json.
// =====================================================================================
const T = window.Theme;
const LOOK = { current: T.normalize(T.DEFAULT_THEME), activeId: 'default', saved: [], sizes: null };
// Sizes are the app's own (not part of a theme), so switching themes never makes everything smaller or bigger.
const SIZE_PRESETS = {
  small: { name: 'Small', text: 13, heading: 125, menuText: 13, menuIcon: 16, brand: 26, icon: 15, control: 28, row: 24 },
  medium: { name: 'Medium', text: 14, heading: 130, menuText: 15, menuIcon: 19, brand: 32, icon: 16, control: 32, row: 28 },
  large: { name: 'Large', text: 15, heading: 135, menuText: 16, menuIcon: 21, brand: 38, icon: 18, control: 36, row: 30 },
  xlarge: { name: 'Extra large', text: 17, heading: 140, menuText: 18, menuIcon: 24, brand: 44, icon: 20, control: 40, row: 34 },
};
const SIZE_FIELDS = [['text', 'Text', 11, 22, 'px', 'Buttons, lists, drop-downs, fields and most other text'], ['heading', 'Screen titles', 110, 180, '%', 'How much bigger the title of each screen is than the text'],
  ['menuText', 'Menu text', 11, 24, 'px', 'The side menu'], ['menuIcon', 'Menu icons', 14, 32, 'px', 'The icons in the side menu'], ['brand', 'Logo and name', 22, 60, 'px', 'Collection Sorter at the top of the menu'],
  ['icon', 'Other icons', 12, 28, 'px', 'Icons in buttons and the title bar'], ['control', 'Buttons and fields', 24, 56, 'px', 'How tall buttons, drop-downs and boxes are'], ['row', 'Rows', 20, 52, 'px', 'Rows in lists and tables']];
const DEFAULT_SIZES = () => ({ preset: 'large', scale: 100, ...Object.fromEntries(Object.entries(SIZE_PRESETS.large).filter(([k]) => k !== 'name')) });
function normSizes(z) {
  const d = DEFAULT_SIZES(); const o = { ...d, ...(z || {}) };
  for (const [k, , lo, hi] of SIZE_FIELDS) { const v = Number(o[k]); o[k] = Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d[k]; }
  o.scale = Math.max(70, Math.min(200, Math.round(Number(o.scale) || 100)));
  o.preset = Object.keys(SIZE_PRESETS).find((k) => SIZE_FIELDS.every(([f]) => SIZE_PRESETS[k][f] === o[f])) || null;
  return o;
}
function applySizes() {
  const z = LOOK.sizes || (LOOK.sizes = normSizes(null)); const st = document.documentElement.style; const px = (v) => Math.round(v) + 'px';
  const set = { fs: z.text, 'fs-s': z.text * 0.88, 'fs-xs': z.text * 0.8, 'fs-h': z.text * 1.14, 'fs-t': (z.text * z.heading) / 100, 'nav-fs': z.menuText, 'nav-ic': z.menuIcon, brand: z.brand, ic: z.icon,
    ch: z.control, rh: z.row, 'ch-s': Math.max(22, z.control - 6), chip: Math.max(18, z.text * 0.88 * 1.75), tb: Math.max(32, z.text * 2.3), sb: Math.max(36, z.text * 2.6) };
  for (const [k, v] of Object.entries(set)) st.setProperty('--' + k, px(v));
  const f = z.scale / 100; st.setProperty('--zoom', String(f));
  if (window.csNative && window.csNative.setZoom) window.csNative.setZoom(f); else st.zoom = f === 1 ? '' : String(f);
  const bg = LOOK.current.background;
  if (window.csNative && window.csNative.setTitleBar) window.csNative.setTitleBar({ color: bg.ground, symbolColor: bg.sec, height: Math.round(Math.max(32, z.text * 2.3) * f) - 1 });
}
function setSizes(next, rerender = true) { LOOK.sizes = normSizes(next); applySizes(); persistLook(); if (rerender && curRoute() === 'look') views.look.form(); }
function stepScale(dir) { const z = { ...(LOOK.sizes || normSizes(null)) }; z.scale = dir === 0 ? 100 : Math.max(70, Math.min(200, Math.round((z.scale + dir * 10) / 10) * 10)); setSizes(z); toast(`Overall size ${z.scale}%`, 'info'); }
let CUSTOM_FONTS = []; const LOADED_FONTS = new Set();

// Collection Sorter's older themes, kept as ready-made themes (DESIGN.md: an app may keep what the owner asks for).
const OLD_THEMES = [
  ['classic', 'Collection Sorter classic', ['#0f1218', '#171b24', '#202636', '#2a3142', '#e8ebf2', '#8f98ad', '#6ea8ff', 14, 'Inter']],
  ['aurora', 'Aurora', ['#06100f', '#0d1e21', '#14292d', '#1f4a47', '#e6f6f2', '#82aaa3', '#4ff0c0', 20, 'Space Grotesk', 'Space Grotesk', 'radial-gradient(900px 620px at 8% -8%,rgba(64,255,190,.22),transparent 62%),radial-gradient(820px 720px at 98% 8%,rgba(125,90,255,.26),transparent 62%),radial-gradient(900px 700px at 55% 112%,rgba(30,160,255,.2),transparent 60%)']],
  ['noir', 'Noir', ['#121110', '#1a1917', '#25221e', '#38342d', '#efe9dd', '#9b9384', '#ff5a36', 3, 'DM Sans', 'Instrument Serif']],
  ['terminal', 'Terminal', ['#020503', '#040b06', '#08150b', '#12381c', '#9dffae', '#43a15a', '#39ff6a', 2, 'JetBrains Mono']],
  ['sakura', 'Sakura', ['#160f14', '#21161d', '#2d1d27', '#4a2c3d', '#fbe9f1', '#b08a9c', '#ff8fbd', 18, 'Nunito', 'Playfair Display', 'radial-gradient(800px 500px at 100% 0,rgba(255,143,189,.14),transparent 60%)']],
  ['ocean', 'Ocean', ['#08121c', '#0e1d2c', '#15293d', '#21405c', '#e4f1fb', '#7fa3bf', '#4cc3ff', 12, 'Manrope']],
  ['ember', 'Ember', ['#150d0a', '#221612', '#2f1e18', '#4a2f25', '#fbeee6', '#b58f7e', '#ff9a3c', 10, 'Outfit']],
  ['violet', 'Violet', ['#0f0b1a', '#181228', '#221a38', '#3a2d5c', '#efe9fb', '#9c8fba', '#b18cff', 16, 'Sora', 'Sora', 'radial-gradient(900px 600px at 0 0,rgba(140,100,255,.18),transparent 60%)']],
  ['forest', 'Forest', ['#0c130e', '#131e16', '#1b2b20', '#2b4733', '#e6f3e9', '#86a68e', '#7be08f', 12, 'Nunito', 'Lora']],
  ['slate', 'Slate', ['#14171a', '#1d2125', '#272c32', '#363c44', '#e6e8eb', '#8e959e', '#9fb4c8', 8, 'IBM Plex Sans']],
  ['mono', 'Mono', ['#0b0b0b', '#151515', '#1e1e1e', '#2e2e2e', '#eaeaea', '#8a8a8a', '#ffffff', 0, 'IBM Plex Mono']],
  ['daylight', 'Daylight', ['#f3f5f9', '#ffffff', '#eceff5', '#d6dbe6', '#1c2230', '#5a6479', '#2d6cdf', 14, 'Inter']],
];
function mixHex(a, b, t) { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function oldTheme([id, name, v]) {
  const [bg, panel, panel2, line, text, muted, accent, rad, font, fonth, glow] = v; const light = T.luminance(bg) > 0.4;
  const dark = light ? '#ffffff' : '#000000';
  let faint = mixHex(muted, bg, 0.18); if (T.contrast(faint, panel) < 4.5) faint = muted;
  const t = T.normalize({
    name, background: { ground: bg, rail: mixHex(bg, dark, 0.25), panel, raised: panel2, raised2: mixHex(panel2, line, 0.5), field: mixHex(bg, dark, light ? 0 : 0.3), line, line2: mixHex(line, text, 0.12), text, sec: muted, faint, stage: mixHex(bg, '#000000', 0.5) },
    accent: { stops: [accent], angle: 90, onAccent: 'auto' }, font: { family: font || 'Inter', size: 13 },
    corners: { control: Math.min(12, Math.round(rad * 0.55)), panel: Math.min(24, rad) }, density: { control: 28, row: 24 },
    extras: { headingFont: fonth && fonth !== font ? fonth : '', glowBg: glow || '' },
  });
  return { id: 'cs-' + id, name, theme: t, builtIn: true };
}
const BUILTIN = () => [{ id: 'default', name: 'Default', theme: T.normalize(T.DEFAULT_THEME), builtIn: true }, ...OLD_THEMES.map(oldTheme)];
const savedTheme = (id) => BUILTIN().find((s) => s.id === id) || LOOK.saved.find((s) => s.id === id) || null;
const themeKey = (t) => JSON.stringify({ ...T.normalize(t), name: '', font: { ...T.normalize(t).font, size: 0 }, density: null });

function patternCss(kind, a) {
  const c = `rgba(255,255,255,${a})`; const enc = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
  if (kind === 'dots') return [enc(`<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><circle cx='2' cy='2' r='1.2' fill='${c}'/></svg>`), '22px 22px'];
  if (kind === 'grid') return [enc(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><path d='M32 0H0V32' fill='none' stroke='${c}' stroke-width='1'/></svg>`), '32px 32px'];
  if (kind === 'lines') return [enc(`<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14'><path d='M0 14L14 0' stroke='${c}' stroke-width='1'/></svg>`), '14px 14px'];
  if (kind === 'noise') return [enc(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 ${a * 4} 0'/></filter><rect width='160' height='160' filter='url(#n)'/></svg>`), '160px 160px'];
  return null;
}
function applyTheme() {
  const v = T.cssVars(LOOK.current); const st = document.documentElement.style;
  for (const [k, val] of Object.entries(v)) { if (k === 'scheme') st.colorScheme = val; else st.setProperty('--' + k, val); }
  const ex = LOOK.current.extras || {}; const p = patternCss(ex.pattern, (ex.patternStrength || 8) / 100);
  st.setProperty('--bgpat', p ? p[0] : 'none'); st.setProperty('--patsize', p ? p[1] : 'auto'); st.setProperty('--glowbg', ex.glowBg || 'none');
  applySizes();
}
let lookTimer = null;
function persistLook() { clearTimeout(lookTimer); lookTimer = setTimeout(() => api('/appearance', { version: 2, current: LOOK.current, activeId: LOOK.activeId, saved: LOOK.saved, sizes: LOOK.sizes }).catch(() => {}), 300); }
async function loadLook() {
  let d = null; try { d = await api('/appearance'); } catch { /* defaults */ }
  if (d && d.current) {
    LOOK.current = T.normalize(d.current); LOOK.activeId = d.activeId || null;
    LOOK.saved = Array.isArray(d.saved) ? d.saved.filter((s) => s && s.id && s.theme).map((s) => ({ id: s.id, name: String(s.name || 'Theme'), theme: T.normalize(s.theme) })) : [];
    LOOK.sizes = normSizes(d.sizes);   // older versions had no sizes: start on Large
    if (!d.sizes) persistLook();
  } else {
    LOOK.sizes = normSizes(null);
    // first start of this version: the owner's own saved looks from the old Appearance dialog become saved themes
    for (const c of PREFS.custom || []) {
      const ap = c.ap || {}; const base = OLD_THEMES.find((x) => x[0] === (ap.theme === 'midnight' ? 'classic' : ap.theme)) || OLD_THEMES[0]; const o = oldTheme(base).theme;
      if (ap.accent) o.accent.stops = [ap.accent]; if (ap.font) o.font.family = ap.font; if (ap.fonth) o.extras.headingFont = ap.fonth;
      if (ap.pat) { o.extras.pattern = ap.pat; o.extras.patternStrength = ap.patop || 8; } if (ap.cardop) o.extras.panelOpacity = ap.cardop;
      LOOK.saved.push({ id: 'm' + Math.random().toString(36).slice(2, 8), name: String(c.name || 'My look'), theme: T.normalize({ ...o, name: c.name }) });
    }
    persistLook();
  }
  await loadCustomFonts(); applyTheme();
}
async function loadCustomFonts() {
  try { CUSTOM_FONTS = await api('/fonts'); } catch { CUSTOM_FONTS = []; }
  for (const f of CUSTOM_FONTS) for (const file of f.files || []) {
    const key = f.id + '/' + file.name; if (LOADED_FONTS.has(key)) continue;
    try { const face = new FontFace(f.family, `url(/api/fontfile?id=${encodeURIComponent(f.id)}&name=${encodeURIComponent(file.name)}&t=${encodeURIComponent(TOKEN)})`, { weight: String(file.weight), style: file.style || 'normal' }); await face.load(); document.fonts.add(face); LOADED_FONTS.add(key); } catch (e) { logLine(`Could not load the font ${file.name}: ${e.message}`, 'w'); }
  }
}
const withSizes = (t) => T.normalize({ ...t, font: { ...t.font, size: Math.min(22, LOOK.sizes.text) }, density: { control: LOOK.sizes.control, row: LOOK.sizes.row } });
function setLook(next, { rerender = true } = {}) {
  LOOK.current = T.normalize({ ...next, name: LOOK.current.name }); applyTheme(); persistLook();
  if (curRoute() === 'look') { if (rerender) views.look.render($('#view')); else views.look.themes(); }
}
const installedCache = new Map();
function systemFontInstalled(family) {
  if (installedCache.has(family)) return installedCache.get(family);
  const c = document.createElement('canvas').getContext('2d'); const text = 'mmmmmmmmmmlli1WQ sorter 0123 AaBbGg';
  const ok = ['monospace', 'serif'].some((fb) => { c.font = `20px ${fb}`; const w0 = c.measureText(text).width; c.font = `20px '${family}', ${fb}`; return c.measureText(text).width !== w0; });
  installedCache.set(family, ok); return ok;
}

views.look = {
  soft: false, title: 'Look', sub: 'How Collection Sorter looks. Changes apply straight away; save them as a theme to keep or share them',
  render(el) {
    el.innerHTML = `<div class="hd"><h1>Look</h1><span class="hdsub">${esc(this.sub)}</span></div>
      <div class="look"><div class="lthemes"><div class="asec" style="gap:6px"><div class="sh"><h3>Themes</h3></div><div id="a-themes" style="display:flex;flex-direction:column;gap:6px"></div>
        <button id="a-save">${icon('plus')}Save as theme…</button><div class="row"><button id="a-import" style="flex:1">Import…</button><button id="a-export" style="flex:1">Export…</button></div><button class="ghost" id="a-reset">Reset to default</button></div></div>
        <div class="lform" id="a-form"></div></div>`;
    this.themes(); this.form(); this.wire(el);
  },
  themes() {
    const host = $('#a-themes'); if (!host) return; const cur = themeKey(LOOK.current);
    const sw = (t) => { const b = t.background; return `<div class="sw"><i style="background:${b.ground}"></i><i style="background:${b.panel}"></i><i style="background:${b.raised}"></i><i class="g" style="background:${T.gradient(t.accent.stops, 90)}"></i></div>`; };
    host.innerHTML = [...BUILTIN(), ...LOOK.saved].map((s) => { const on = LOOK.activeId === s.id; const edited = on && themeKey(s.theme) !== cur;
      return `<div class="tcard ${on ? 'on' : ''}" data-id="${esc(s.id)}" tabindex="0">${sw(s.theme)}<div class="nm"><b>${esc(s.name)}</b><span>${esc(s.theme.font.family)}</span></div>${edited ? '<span class="chip" style="align-self:flex-start">Edited · not saved</span>' : ''}
        <div class="acts">${edited && !s.builtIn ? '<button data-a="update">Update</button>' : ''}${s.builtIn ? '' : '<button data-a="rename">Rename</button>'}<button data-a="dup">Duplicate</button><button data-a="export">Export</button>${s.builtIn ? '' : '<button class="dg" data-a="del">Delete</button>'}</div></div>`; }).join('');
  },
  form() {
    const t = LOOK.current; const d = T.describe(t); const ex = t.extras; const z = LOOK.sizes || normSizes(null);
    const fonts = { bundled: (window.BUNDLED_FONTS || []).map((f) => ({ family: f.family, kind: 'bundled', ok: true })), extra: ['Nunito', 'Lora', 'Playfair Display', 'Instrument Serif', 'IBM Plex Mono'].map((f) => ({ family: f, kind: 'extra', ok: true })), system: T.SYSTEM_FONTS.map((f) => ({ family: f, kind: 'system', ok: systemFontInstalled(f) })), custom: CUSTOM_FONTS.map((f) => ({ family: f.family, kind: 'custom', ok: true, id: f.id })) };
    const fchip = (f, key = 'font', cur = t.font.family) => `<button class="achip font ${cur === f.family ? 'on' : ''} ${f.ok ? '' : 'off'}" data-${key}="${esc(f.family)}" style="font-family:${esc(T.fontStack(f.family))}" ${f.ok ? '' : 'disabled title="Not installed on this computer"'}>${esc(f.family === 'Segoe UI Variable Text' ? 'Segoe UI Variable' : f.family)}${f.kind === 'system' ? ` <span class="note">${f.ok ? 'installed' : 'not installed'}</span>` : ''}${f.kind === 'custom' && key === 'font' ? `<span class="x" data-rmfont="${esc(f.id)}" title="Remove this font">${icon('x')}</span>` : ''}</button>`;
    const crow = (g, k, l, v) => `<div class="crow"><input type="color" value="${v}" data-cg="${g}" data-ck="${k}" aria-label="${esc(l)}"><span>${esc(l)}</span><input class="hex" value="${v}" data-hg="${g}" data-hk="${k}" spellcheck="false" aria-label="${esc(l)} hex"></div>`;
    const seg = (id, opts, on) => `<span class="seg" id="${id}">${opts.map(([k, l]) => `<button data-v="${k}" class="${String(on) === String(k) ? 'on' : ''}">${l}</button>`).join('')}</span>`;
    const onC = T.onAccent(t); const worst = Math.min(...t.accent.stops.map((s) => T.contrast(onC, s)));
    const pc = T.contrast(t.background.faint, t.background.panel);
    $('#a-form').innerHTML = `
      <div class="asec"><div class="sh"><h3>Preview</h3><span>Everything in the app updates as you change things below</span></div>
        <div class="preview"><div class="pbox"><div class="trow"><button class="pri">Scan &amp; tag</button><button>Add folder…</button><button class="ghost">Cancel</button></div><div class="trow"><select style="width:140px"><option>NSFW</option></select><label class="chk"><input type="checkbox" checked> Find HQ only</label></div></div>
          <div class="pbox"><div class="trow" style="justify-content:space-between"><b>Reading files 1,240 of 2,130</b><span>58%</span></div><div class="bar"><i style="width:58%"></i></div><span class="small muted">3:12 elapsed · about 3:14 left</span></div>
          <div class="pbox"><div class="trow"><span class="chip ok">Moved</span><span class="chip warn">Check</span><span class="chip bad">Failed</span><span class="chip nsfw">NSFW</span><span class="chip very">Very</span></div><div class="trow"><span class="tg">blue sky <i>91</i></span><span class="faint small">Faint text · contrast ${pc.toFixed(1)}:1</span></div></div></div></div>
      <div class="asec" id="a-sizes"><div class="sh"><h3>Sizes</h3><span>${z.preset ? esc(SIZE_PRESETS[z.preset].name) : 'Your own sizes'} · ${z.scale}% overall · the same in every theme</span></div>
        <div class="trow"><span class="inl lw">Preset</span>${seg('a-zpre', Object.entries(SIZE_PRESETS).map(([k, p]) => [k, p.name]), z.preset || '')}<span class="faint small">Sets everything below in one go; then change any of them</span></div>
        <div class="trow"><span class="inl lw">Overall size</span><span class="slider wide"><input type="range" min="70" max="200" step="5" value="${z.scale}" data-z="scale"><span class="v">${z.scale}%</span></span><button class="sm" data-zstep="-1">−</button><button class="sm" data-zstep="1">+</button><button class="sm ghost" data-zstep="0">Back to 100%</button><span class="faint small">Makes everything bigger or smaller together, like zooming. Ctrl + plus, Ctrl + minus and Ctrl + 0 do the same anywhere.</span></div>
        <div class="zgrid">${SIZE_FIELDS.map(([k, l, lo, hi, u, tip]) => `<div class="zrow" title="${esc(tip)}"><span class="inl">${esc(l)}</span><input type="range" min="${lo}" max="${hi}" value="${z[k]}" data-z="${k}"><span class="v">${z[k]} ${u}</span></div>`).join('')}</div></div>
      <div class="asec"><div class="sh"><h3>Background</h3><span>${d.background ? esc(T.BACKGROUNDS[d.background].name) : 'Custom'} · pick a preset, then change any colour</span></div>
        <div class="achips">${Object.entries(T.BACKGROUNDS).map(([k, b]) => `<button class="achip ${d.background === k ? 'on' : ''}" data-bg="${k}"><span class="sw" style="background:linear-gradient(135deg, ${b.ground} 0 45%, ${b.raised} 45% 75%, ${b.text} 75%)"></span>${esc(b.name)}</button>`).join('')}</div>
        <div class="colors">${T.BG_LABELS.map(([k, l]) => crow('background', k, l, t.background[k])).join('')}</div>
        <div class="subhead">State colours</div><div class="colors">${T.STATE_LABELS.map(([k, l]) => crow('states', k, l, t.states[k])).join('')}</div></div>
      <div class="asec"><div class="sh"><h3>Accent</h3><span>${d.accent ? esc(T.ACCENTS[d.accent].name) : 'Custom'} · the main button, progress, selection and the logo</span></div>
        <div class="achips">${Object.entries(T.ACCENTS).map(([k, a]) => `<button class="achip ${d.accent === k ? 'on' : ''}" data-acc="${k}"><span class="sw" style="background:${T.gradient(a.stops, 90)}"></span>${esc(a.name)}</button>`).join('')}</div>
        <div class="subhead">Gradient colours</div>
        <div class="stops">${t.accent.stops.map((s, i) => `<span class="stop"><input type="color" value="${s}" data-stop="${i}" aria-label="Colour ${i + 1}"><input class="hex" value="${s}" data-stophex="${i}" spellcheck="false" aria-label="Colour ${i + 1} hex">${t.accent.stops.length > 1 ? `<button class="ghost sm" data-rmstop="${i}" title="Remove this colour">${icon('x')}</button>` : ''}</span>`).join('')}${t.accent.stops.length < 4 ? `<button id="a-addstop">${icon('plus')}Add colour</button>` : ''}<span class="gprev" style="background:${T.gradient(t.accent.stops, t.accent.angle)}"></span></div>
        <div class="trow"><span class="inl">Direction</span><span class="slider"><input type="range" min="0" max="360" step="5" value="${t.accent.angle}" id="a-angle" ${t.accent.stops.length === 1 ? 'disabled' : ''}><span class="v" id="a-angle-v">${t.accent.angle}°</span></span>
          <span class="inl" style="margin-left:12px">Text on accent</span>${seg('a-on', [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']], t.accent.onAccent)}
          <span class="${worst < 4.5 ? 'warnline' : 'faint small'}">Contrast ${worst.toFixed(1)}:1${worst < 4.5 ? ' · hard to read, try the other text colour' : ''}</span></div></div>
      <div class="asec"><div class="sh"><h3>Font</h3><span>${esc(t.font.family)} · bundled fonts work offline; add any font you have as a file</span></div>
        <div class="subhead">Bundled</div><div class="achips">${fonts.bundled.map((f) => fchip(f)).join('')}</div>
        <div class="subhead">From the older Collection Sorter themes</div><div class="achips">${fonts.extra.map((f) => fchip(f)).join('')}</div>
        <div class="subhead">On this computer</div><div class="achips">${fonts.system.map((f) => fchip(f)).join('')}</div>
        <div class="subhead">Added by you</div><div class="achips">${fonts.custom.map((f) => fchip(f)).join('')}<button id="a-addfont">${icon('plus')}Add font…</button></div>
        <div class="faint small">Text size is under Sizes above.</div></div>
      <div class="asec"><div class="sh"><h3>Corners and buttons</h3><span>${d.corners ? esc(T.CORNERS[d.corners].name) : 'Custom'} corners · ${t.buttons.style === 'glow' ? 'Glow' : 'Flat'} buttons</span></div>
        <div class="trow"><span class="inl" style="width:88px">Corners</span>${seg('a-corners', Object.entries(T.CORNERS).map(([k, c]) => [k, c.name]), d.corners)}
          <span class="slider"><span class="inl">Controls</span><input type="range" min="0" max="16" value="${t.corners.control}" data-num="corners.control"><span class="v">${t.corners.control} px</span></span>
          <span class="slider"><span class="inl">Panels</span><input type="range" min="0" max="24" value="${t.corners.panel}" data-num="corners.panel"><span class="v">${t.corners.panel} px</span></span></div>
        <div class="trow"><span class="inl" style="width:88px">Buttons</span>${seg('a-btn', [['flat', 'Flat'], ['glow', 'Glow']], t.buttons.style)}<span class="faint small">Glow adds a soft accent glow under the main buttons</span></div></div>
      <div class="asec"><div class="sh"><h3>Outline and highlight</h3><span>The line around what is selected or focused, and the tint behind it</span></div>
        <div class="trow"><span class="inl" style="width:88px">Outline</span>${seg('a-olc', [['', 'Accent'], ['own', 'Own colour']], t.outline.colour ? 'own' : '')}${t.outline.colour ? `<input type="color" value="${t.outline.colour}" data-olc="1">` : ''}
          <span class="slider"><span class="inl">Width</span><input type="range" min="1" max="4" value="${t.outline.width}" data-num="outline.width"><span class="v">${t.outline.width} px</span></span></div>
        <div class="trow"><span class="inl" style="width:88px">Highlight</span>${seg('a-hlc', [['', 'Accent'], ['own', 'Own colour']], t.highlight.colour ? 'own' : '')}${t.highlight.colour ? `<input type="color" value="${t.highlight.colour}" data-hlc="1">` : ''}</div></div>
      <div class="asec extras"><div class="sh"><h3>Collection Sorter extras</h3><span>Kept from the older Appearance dialog. Other apps ignore these when you share a theme</span></div>
        <div class="trow"><span class="inl" style="width:88px">Pattern</span>${seg('a-pat', [['', 'None'], ['dots', 'Dots'], ['grid', 'Grid'], ['lines', 'Diagonal lines'], ['noise', 'Film grain']], ex.pattern)}
          <span class="slider"><span class="inl">Strength</span><input type="range" min="2" max="30" value="${ex.patternStrength}" data-num="extras.patternStrength"><span class="v">${ex.patternStrength}%</span></span></div>
        <div class="trow"><span class="inl" style="width:88px">Panels</span><span class="slider"><span class="inl">See-through</span><input type="range" min="30" max="100" value="${ex.panelOpacity}" data-num="extras.panelOpacity"><span class="v">${ex.panelOpacity}%</span></span><span class="faint small">100% is solid; lower lets the pattern and glow show through</span></div>
        <div class="trow"><span class="inl" style="width:88px">Glow</span>${seg('a-glow', [['', 'None'], ['on', 'Background glow']], ex.glowBg ? 'on' : '')}<span class="faint small">The soft colour glows from the Aurora, Sakura and Violet themes</span></div>
        <div class="subhead">Heading font</div><div class="achips"><button class="achip font ${ex.headingFont ? '' : 'on'}" data-hfont="">Same as the text</button>${[...fonts.bundled, ...fonts.extra, ...fonts.custom].filter((f) => !f.family.includes('Mono')).map((f) => fchip(f, 'hfont', ex.headingFont)).join('')}</div></div>`;
  },
  wire(el) {
    const self = this;
    $('#a-themes').onclick = async (e) => {
      const card = e.target.closest('.tcard'); if (!card) return; const s = savedTheme(card.dataset.id); if (!s) return; const act = e.target.closest('[data-a]') && e.target.closest('[data-a]').dataset.a;
      if (!act) { LOOK.activeId = s.id; LOOK.current = T.normalize(s.theme); applyTheme(); persistLook(); return self.render(el); }
      if (act === 'update') { s.theme = withSizes({ ...LOOK.current, name: s.name }); persistLook(); self.themes(); toast(`Saved the changes to ${s.name}`); }
      if (act === 'rename') { const v = await askText('Rename theme', '', s.name, 'Rename'); if (v) { s.name = v.slice(0, 60); s.theme.name = s.name; persistLook(); } self.render(el); }
      if (act === 'dup') { const c = { id: 't' + Date.now().toString(36), name: `${s.name} copy`, theme: T.normalize({ ...s.theme, name: `${s.name} copy` }) }; LOOK.saved.push(c); persistLook(); self.themes(); }
      if (act === 'export') self.export({ ...s.theme, name: s.name });
      if (act === 'del') { if (await confirmBox(`Delete ${s.name}?`, 'The theme is removed from this app. What you see now stays until you pick another theme.', 'Delete', true)) { LOOK.saved = LOOK.saved.filter((x) => x.id !== s.id); if (LOOK.activeId === s.id) LOOK.activeId = null; persistLook(); } self.render(el); }
    };
    $('#a-save').onclick = async () => { const v = await askText('Save as theme', 'Saves everything you see now: colours, gradient, font, corners, density and the extras.', `My theme ${LOOK.saved.length + 1}`, 'Save'); if (!v) return self.render(el); const s = { id: 't' + Date.now().toString(36), name: v.slice(0, 60), theme: withSizes({ ...LOOK.current, name: v }) }; LOOK.saved.push(s); LOOK.activeId = s.id; persistLook(); self.render(el); toast(`Saved ${s.name}`); };
    $('#a-export').onclick = () => { const s = LOOK.activeId ? savedTheme(LOOK.activeId) : null; self.export(withSizes({ ...LOOK.current, name: s ? s.name : 'Custom theme' })); };
    $('#a-import').onclick = async () => {
      try { const r = await api('/theme/import', {}); if (r.unsupported) return toast('Importing works in the app window.', true); if (!r.themes.length) return;
        for (const t of r.themes) { const n = T.normalize(t); let name = n.name; while (LOOK.saved.some((s) => s.name === name)) name += ' (imported)'; LOOK.saved.push({ id: 't' + Math.random().toString(36).slice(2, 9), name, theme: { ...n, name } }); }
        persistLook(); self.themes(); toast(`Imported ${r.themes.length} theme${r.themes.length === 1 ? '' : 's'}. Click one to use it.`);
      } catch (e) { toast(e.message, true); }
    };
    $('#a-reset').onclick = async () => { if (!(await confirmBox('Go back to the default look?', 'Obsidian, Blue → Cyan, Inter, standard corners, flat buttons, no extras. Your sizes and saved themes stay.', 'Use default'))) return self.render(el); LOOK.activeId = 'default'; LOOK.current = T.normalize(T.DEFAULT_THEME); applyTheme(); persistLook(); self.render(el); };
    const F = $('#a-form');
    F.onclick = async (e) => {
      const t = clone(LOOK.current); const q = (s) => e.target.closest(s); let b;
      if ((b = q('[data-rmfont]'))) { e.stopPropagation(); const f = CUSTOM_FONTS.find((x) => x.id === b.dataset.rmfont); if (!(await confirmBox(`Remove ${f ? f.family : 'this font'}?`, 'Its files are removed from the app’s data folder. Themes using it fall back to Inter.', 'Remove', true))) return self.render(el); CUSTOM_FONTS = await api('/fonts/remove', { id: b.dataset.rmfont }); if (f && t.font.family === f.family) t.font.family = 'Inter'; return setLook(t); }
      if ((b = q('[data-bg]'))) return setLook(T.withBackground(t, b.dataset.bg));
      if ((b = q('[data-acc]'))) { t.accent.stops = [...T.ACCENTS[b.dataset.acc].stops]; return setLook(t); }
      if ((b = q('[data-font]')) && !b.disabled) { t.font.family = b.dataset.font; return setLook(t); }
      if ((b = q('[data-hfont]'))) { t.extras.headingFont = b.dataset.hfont; return setLook(t); }
      if ((b = q('#a-zpre [data-v]'))) { const pz = SIZE_PRESETS[b.dataset.v]; return setSizes({ ...LOOK.sizes, ...pz }); }
      if ((b = q('[data-zstep]'))) return stepScale(+b.dataset.zstep);
      if ((b = q('#a-on [data-v]'))) { t.accent.onAccent = b.dataset.v; return setLook(t); }
      if ((b = q('#a-corners [data-v]'))) { const c = T.CORNERS[b.dataset.v]; t.corners = { control: c.control, panel: c.panel }; return setLook(t); }
      if ((b = q('#a-btn [data-v]'))) { t.buttons.style = b.dataset.v; return setLook(t); }
      if ((b = q('#a-olc [data-v]'))) { t.outline.colour = b.dataset.v ? (t.outline.colour || '#ffffff') : ''; return setLook(t); }
      if ((b = q('#a-hlc [data-v]'))) { t.highlight.colour = b.dataset.v ? (t.highlight.colour || '#ffffff') : ''; return setLook(t); }
      if ((b = q('#a-pat [data-v]'))) { t.extras.pattern = b.dataset.v; return setLook(t); }
      if ((b = q('#a-glow [data-v]'))) { const src = BUILTIN().find((x) => x.theme.extras.glowBg && (x.id === LOOK.activeId)) || BUILTIN().find((x) => x.id === 'cs-aurora'); t.extras.glowBg = b.dataset.v ? (LOOK.current.extras.glowBg || src.theme.extras.glowBg) : ''; return setLook(t); }
      if ((b = q('[data-rmstop]'))) { t.accent.stops = t.accent.stops.filter((_, i) => i !== +b.dataset.rmstop); return setLook(t); }
      if (q('#a-addstop')) { t.accent.stops.push(t.accent.stops[t.accent.stops.length - 1]); return setLook(t); }
      if (q('#a-addfont')) return self.addFont(el);
    };
    F.oninput = (e) => {
      const x = e.target; const t = clone(LOOK.current); const isHex = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
      if (x.dataset.cg) { t[x.dataset.cg][x.dataset.ck] = x.value; const h = $(`.hex[data-hg="${x.dataset.cg}"][data-hk="${x.dataset.ck}"]`); if (h) { h.value = x.value; h.classList.remove('bad'); } }
      else if (x.dataset.hg) { if (!isHex(x.value)) { x.classList.add('bad'); return; } x.classList.remove('bad'); t[x.dataset.hg][x.dataset.hk] = x.value.trim(); }
      else if (x.dataset.stop !== undefined) { t.accent.stops[+x.dataset.stop] = x.value; const h = $(`[data-stophex="${x.dataset.stop}"]`); if (h) h.value = x.value; }
      else if (x.dataset.stophex !== undefined) { if (!isHex(x.value)) { x.classList.add('bad'); return; } x.classList.remove('bad'); t.accent.stops[+x.dataset.stophex] = x.value.trim(); }
      else if (x.dataset.z) { const z = { ...LOOK.sizes, [x.dataset.z]: +x.value }; const f = SIZE_FIELDS.find((r) => r[0] === x.dataset.z); x.nextElementSibling.textContent = x.value + (f ? ' ' + f[4] : '%'); LOOK.sizes = normSizes(z); applySizes(); persistLook(); return; }
      else if (x.id === 'a-angle') { t.accent.angle = +x.value; $('#a-angle-v').textContent = x.value + '°'; }
      else if (x.dataset.olc) t.outline.colour = x.value;
      else if (x.dataset.hlc) t.highlight.colour = x.value;
      else if (x.dataset.num) { const [g, k] = x.dataset.num.split('.'); t[g][k] = +x.value; x.nextElementSibling.textContent = x.value + (g === 'extras' ? '%' : ' px'); }
      else return;
      setLook(t, { rerender: false }); const gp = $('.gprev'); if (gp) gp.style.background = T.gradient(LOOK.current.accent.stops, LOOK.current.accent.angle);
    };
    F.onchange = (e) => { if (e.target.matches('input[type=color], input[type=range], .hex')) self.form(); };   // a size slider re-draws the form when let go
  },
  async export(t) { try { const r = await api('/theme/export', { theme: T.normalize(t) }); if (r.unsupported) toast('Exporting works in the app window.', true); else if (r.path) toast(`Theme saved to ${r.path}`); } catch (e) { toast(e.message, true); } },
  async addFont(el) {
    let r; try { r = await api('/fonts/pick', {}); } catch (e) { return toast(e.message, true); }
    if (r.unsupported) return toast('Adding fonts works in the app window.', true); if (!r.files.length) return;
    const name = await askText('Add font', `Name the font as you want it to appear. ${r.files.length} file${r.files.length === 1 ? '' : 's'}: ${r.files.map((f) => esc(f.name)).join(', ')}`, r.files[0].family, 'Add font');
    if (!name) return this.render(el);
    try { CUSTOM_FONTS = await api('/fonts/install', { family: name, files: r.files.map((f) => f.file) }); await loadCustomFonts(); const t = clone(LOOK.current); t.font.family = name; setLook(t); toast(`Added ${name}`); } catch (e) { toast(e.message, true); this.render(el); }
  },
};
