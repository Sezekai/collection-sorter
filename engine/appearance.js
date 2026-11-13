'use strict';
// The look: appearance.json (current look, active theme, saved themes) and the fonts the owner adds.
// Kept in the data folder, so new versions of the program keep them. Theme files (*.theme.json) are the
// suite's shared format, so a theme exported from another app imports here and the other way round.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./settings');

const FILE = () => path.join(DATA_DIR, 'appearance.json');
const FONTS = () => path.join(DATA_DIR, 'fonts');
const INDEX = () => path.join(FONTS(), 'index.json');
const FONT_EXT = ['.ttf', '.otf', '.woff', '.woff2'];

function read() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return null; }
}
function write(data) {
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE());
}

const WEIGHT_WORDS = [
  [/hairline|thin/i, 100], [/extra-?light|ultra-?light/i, 200], [/light/i, 300], [/semi-?bold|demi-?bold/i, 600],
  [/extra-?bold|ultra-?bold/i, 800], [/black|heavy/i, 900], [/medium/i, 500], [/bold/i, 700], [/regular|normal|book|roman/i, 400],
];
// Guesses weight, style and family from a font file name such as "Satoshi-BoldItalic.otf".
function describeFontFile(file) {
  const P = file.includes('\\') ? path.win32 : path;
  const base = P.parse(file).name;
  const variable = /variable|\[wght/i.test(base);
  let weight = 400;
  for (const [re, w] of WEIGHT_WORDS) if (re.test(base)) { weight = w; break; }
  const italic = /italic|oblique/i.test(base);
  const family = base.replace(/[-_ ]?(variable|vf)\b.*$/i, '').replace(/\[.*?\]/g, '')
    .replace(/[-_ ]?(hairline|thin|extra-?light|ultra-?light|light|regular|normal|book|roman|medium|semi-?bold|demi-?bold|extra-?bold|ultra-?bold|bold|black|heavy)?(italic|oblique)?$/i, '')
    .replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || base;
  return { file, name: P.basename(file), weight: variable ? '100 900' : weight, style: italic ? 'italic' : 'normal', family };
}
function fonts() {
  try { const l = JSON.parse(fs.readFileSync(INDEX(), 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; }
}
function writeFonts(list) { fs.mkdirSync(FONTS(), { recursive: true }); fs.writeFileSync(INDEX(), JSON.stringify(list, null, 2)); }
function addFont(family, files) {
  family = String(family || '').trim().slice(0, 80);
  if (!family) throw new Error('Give the font a name.');
  const ok = (files || []).filter((f) => FONT_EXT.includes(path.extname(f).toLowerCase()) && fs.existsSync(f));
  if (!ok.length) throw new Error('None of those files is a font (.ttf, .otf, .woff or .woff2).');
  const list = fonts().filter((x) => x.family.toLowerCase() !== family.toLowerCase());
  const id = family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + crypto.randomBytes(3).toString('hex');
  const dir = path.join(FONTS(), id); fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const f of ok) { const d = describeFontFile(f); fs.copyFileSync(f, path.join(dir, d.name)); out.push({ name: d.name, weight: d.weight, style: d.style }); }
  list.push({ id, family, files: out }); writeFonts(list);
  return list;
}
function removeFont(id) {
  const list = fonts(); const f = list.find((x) => x.id === id);
  if (f) { try { fs.rmSync(path.join(FONTS(), path.basename(id)), { recursive: true, force: true }); } catch { /* already gone */ } }
  const rest = list.filter((x) => x.id !== id); writeFonts(rest); return rest;
}
function fontFile(id, name) {
  const p = path.join(FONTS(), path.basename(id), path.basename(name));
  return p.startsWith(FONTS()) && fs.existsSync(p) ? p : null;
}
function importThemes(files) {
  const out = [];
  for (const f of files || []) {
    let t;
    try { t = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`${path.basename(f)} is not a theme file (${e.message}).`); }
    if (!t || typeof t !== 'object' || !t.background) throw new Error(`${path.basename(f)} is not a theme file.`);
    out.push(t);
  }
  return out;
}
function exportTheme(file, theme) {
  if (!/\.json$/i.test(file)) file += '.theme.json';
  fs.writeFileSync(file, JSON.stringify(theme, null, 2)); return file;
}

module.exports = { read, write, fonts, addFont, removeFont, fontFile, importThemes, exportTheme, describeFontFile, FONT_EXT };
