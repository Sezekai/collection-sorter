'use strict';
// Rules = what the app knows about each folder and the ranking it walks. Stored in the database so edits survive.
const { SERIES, OTHER, CATCHALL } = require('./seed');

const ROUTED = new Set(['Average & LQ', 'Connected Art', 'Dupes', 'Real', 'Photographs (Environments & Landscapes)', 'Photographs (People, Objects & Other Stuff)', 'Football', 'Games - Screenshots & Videos', 'Gifs & Vids', 'Animations & Anime Videos', 'Find Higher Quality Manually']);
const SPECIAL = {
  'Manga-Style and B&W': { type: 'mono', tags: ['monochrome', 'greyscale', 'sketch', 'lineart', 'comic', 'screentone', 'manga (style)', 'ink (medium)'], prompts: ['a black and white manga page', 'a monochrome ink drawing', 'a greyscale illustration'], threshold: 0.7, notes: 'All monochrome / greyscale / black-and-white art. Always ranked first.' },
  'Manga': { type: 'style', tags: ['manga', 'comic', 'speech bubble', 'screentone', 'translation request', 'page number', 'multiple views'], prompts: ['a manga page with panels and speech bubbles', 'a coloured manga page', 'a manga chapter page'], threshold: 0.6, notes: 'Manga pages (colour ones that are not B&W).' },
};

const STYLE_ORDER = ['Pixel Art', 'Painterly', 'Manga Style (Coloured)', 'Concept Art, CG & 3D', 'Fine & Classical Art', 'Sketches, Studies, RKGK & Unfinished', 'Traditional', 'Cartoony', 'Realistic', 'Semi-Realistic', 'Sakuga'];
const SUBJECT_ORDER = ['Manhwa, Manhua, Webtoons', 'Comics', 'LNs & WNs', 'Magazines & Covers', 'Books', 'Memes & Funny Images', 'Movies - TV', 'Cyberpunk Aesthetic', 'Mecha', 'Dragons', 'Elves', 'Demi-Humans', 'Weapons & Armour', 'Cars & Vehicles', 'Space & Sci-Fi', 'Horror, Dark & Scary', 'Animals & Creatures', 'Buildings, Architecture & Interiors', 'Exterior Design', 'Interior Design', 'Environments & Landscapes', 'Food, Flora & Objects', 'Historical', 'Sports', 'Eyes', 'Fantasy', 'People - Art', 'Crossovers & Compilations', 'Pictures & Images', 'Illustrations'];
const CATCH_ORDER = ['Anime', 'Games', 'Anime Style', 'Characters', 'Characters (3D)', 'Characters and Background', 'AI', 'All Other Art'];

const display = (n) => n.replace(/^FF/, 'Final Fantasy ');

function ruleFor(name) {
  if (SPECIAL[name]) return { enabled: true, ...SPECIAL[name], series: [], chars: [] };
  if (SERIES[name]) {
    const s = SERIES[name];
    return { enabled: true, type: 'series', series: s.series, chars: s.chars, tags: [], prompts: [`anime or game artwork featuring characters from ${display(name)}`, `fan art of ${display(name)}`] };
  }
  if (OTHER[name]) return { enabled: true, ...OTHER[name], series: [], chars: [] };
  if (CATCHALL[name]) return { enabled: true, ...CATCHALL[name], series: [], chars: [] };
  // a folder the app has never heard of: treat it as a series named after itself; the learned examples do the rest
  return { enabled: true, type: 'series', series: [name.toLowerCase()], chars: [], tags: [], prompts: [`fan art of ${name}`], notes: 'New folder: add example files so the app can learn it.' };
}

// Build default rules for the folders found in the destination. Existing (user-edited) rules are kept.
function buildRules(catalogFolders, existing, extraNames) {
  const ex = existing || { order: [], folders: {} };
  const subs = (extraNames || []).filter(Boolean);
  const names = catalogFolders.filter((f) => !f.ignored && !ROUTED.has(f.name)).map((f) => f.name).concat(subs);
  const have = new Set(names);
  const folders = { ...ex.folders };
  const order = ex.order.filter((n) => have.has(n));
  const inOrder = new Set(order);
  const add = (n) => { if (have.has(n) && !inOrder.has(n)) { order.push(n); inOrder.add(n); } };
  if (!ex.order.length) {
    add('Manga-Style and B&W'); add('Manga');
    const series = names.filter((n) => (SERIES[n] || (!OTHER[n] && !CATCHALL[n] && !SPECIAL[n]))).sort((a, b) => {
      // specific Final Fantasy games before the generic one
      if (a === 'Final Fantasy Games - All') return 1; if (b === 'Final Fantasy Games - All') return -1; return a.localeCompare(b);
    });
    series.forEach(add);
    STYLE_ORDER.forEach(add); SUBJECT_ORDER.forEach(add);
    names.filter((n) => OTHER[n]).forEach(add);
    CATCH_ORDER.forEach(add);
  } else {
    // new folders found since last time: drop them just before the catch-alls
    const idx = order.findIndex((n) => (folders[n] || ruleFor(n)).type === 'catchall');
    for (const n of names) if (!inOrder.has(n)) { order.splice(idx < 0 ? order.length : idx, 0, n); inOrder.add(n); }
  }
  if ((ex.version || 1) < 2 && have.has('People - Art')) { // v2: People - Art is only for real, recognisable people, and is checked before the Realistic style folders
    folders['People - Art'] = ruleFor('People - Art');
    const i = order.indexOf('People - Art'); if (i >= 0) order.splice(i, 1);
    let at = order.findIndex((n) => n === 'Realistic' || n === 'Semi-Realistic'); if (at < 0) at = order.findIndex((n) => (folders[n] || ruleFor(n)).type === 'catchall'); if (at < 0) at = order.length;
    order.splice(at, 0, 'People - Art');
  }
  for (const n of names) if (!folders[n]) folders[n] = subs.includes(n) ? { ...ruleFor(n), type: 'subject', series: [], chars: [], prompts: [`artwork that belongs in the category “${n.split('/').pop()}”`], notes: 'A subfolder used as a target of its own. It learns from the example folders you map to it.' } : ruleFor(n);
  for (const n of Object.keys(folders)) if (!have.has(n)) delete folders[n];
  return { version: 2, order, folders };
}

module.exports = { buildRules, ruleFor, ROUTED };
