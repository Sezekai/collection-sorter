'use strict';
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./util');

const DATA_DIR = process.env.CS_DATA ? path.resolve(process.env.CS_DATA) : path.resolve(process.cwd(), 'data');
ensureDir(DATA_DIR);
const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  destinationRoot: '',            // where sorted files end up (the folder tree)
  referenceRoots: [],             // folders whose existing files teach the app (read only)
  referenceMap: { "Real/To Sort": null, "Real/Sorted/Girls": "Real/Images/General", "Real/Sorted/Cosplay": "Real/Images/Cosplay" },             // reference sub path -> destination folder, e.g. "Real/Sorted/Girls": "Real/Images/General"
  sources: [],                    // [{ path, excludes: [relative sub paths] }]
  ignoreFolders: ['Upgrade', 'Doujinshi', 'Mangas', 'Artists', 'Anthologies, Art Books & Collections', 'Palestine', 'Islamic'],
  ignoreSubfolders: ['Checked', 'Marvel, DC, Superheroes/Videos'],
  lowQualityFolder: 'Average & LQ',
  dupesFolder: 'Dupes',
  quality: { minShortSide: 500, minPixels: 400000, minSharpness: 25, minBitsPerPixel: 0.3, enabled: true },
  rating: { nsfwMin: 0.5, veryMin: 0.6, learn: true },    // NSFW / Very thresholds; learn = also learn from your example folders and corrections
  thresholds: { photo: 0.6, series: 0.55, style: 0.6, subject: 0.6, catchall: 0.4, bestGuess: 0.2, unsortedBelow: 0.12 },
  sets: { minSize: 3, minSimilarity: 0.72, maxMtimeGapSec: 4 },
  dupes: { maxHamming: 6, minClipSimilarity: 0.97 },
  videoFrames: 4,
  classify: { model: 'auto', useJoytag: true, photoAt: 0.5 }, // who decides photo vs art: auto (the one you correct least) | clip | joytag | both
  tagSource: { art: 'wd', real: 'joytag' },          // which tags the sorting uses and the lists show: wd (= the chosen anime tagger) | joytag | both
  tagger: { model: 'haruka', device: 'auto', deviceId: -1, batch: 4, minConfidence: 0.35 },
  subTargets: ['Real/Images/Cosplay', 'Real/Images/General', 'Real/Videos/Cosplay', 'Real/Videos/General'], // destination subfolders (any depth) offered as targets of their own
  autoRescan: true,               // look for new files / folders each time the app starts
  storage: { thumbs: '', cache: '' },   // '' = the default place (see storage.js); models live in models.dir
  lookupRoot: '',                 // Look Up (L) sends pictures and videos here, in Videos / Real / NSFW / Very subfolders
  fhqRoot: '',                    // Find higher quality (Q) files go here, in the folder they would have gone to (Anime/NSFW, …)
  keptReferenceRoots: [],         // removed example folders whose already-learned data is kept (never scanned again)
  refs: { maxPerFolder: 150, perFolder: {} },    // examples learned per folder (evenly sampled); perFolder overrides it for a named folder
  models: { dir: '' },
};

function deepMerge(a, b) {
  const o = Array.isArray(a) ? a.slice() : { ...a };
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a && typeof a[k] === 'object' && !Array.isArray(a[k])) o[k] = deepMerge(a[k], b[k]);
    else o[k] = b[k];
  }
  return o;
}

let cache = null;
function load() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
  cache = deepMerge(DEFAULTS, saved);
  if (!saved.v17) {   // 1.7: Haruka is the default tagger; Look Up and Find Higher Quality are plain folders (next to the to-sort folders, when there is a "Sort" folder)
    if (!saved.tagger || !saved.tagger.model || saved.tagger.model === 'eva02-large') cache.tagger = { ...cache.tagger, model: 'haruka' };
    const sortDir = (cache.referenceRoots || []).map((r) => path.join(r, 'Sort')).find((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
    if (sortDir && !cache.lookupRoot) cache.lookupRoot = path.join(sortDir, 'Look Up');
    if (sortDir && !cache.fhqRoot) cache.fhqRoot = path.join(sortDir, 'Find Higher Quality');
    cache.v17 = true; delete cache.saucenao;
    try { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cache, null, 2)); fs.renameSync(tmp, FILE); } catch { /* read-only: try again next time */ }
  }
  const th = (saved.thresholds || {});
  if (th.bestGuess === undefined && th.unsortedBelow === 0.3) cache.thresholds.unsortedBelow = DEFAULTS.thresholds.unsortedBelow; // older default: the new "best guess" step replaces it
  return cache;
}
function save(patch) {
  cache = deepMerge(load(), patch || {});
  const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cache, null, 2)); fs.renameSync(tmp, FILE);   // a crash never leaves half a file
  return cache;
}
function replace(next) { cache = deepMerge(DEFAULTS, next); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cache, null, 2)); fs.renameSync(tmp, FILE); return cache; }

module.exports = { DATA_DIR, load, save, replace, DEFAULTS };
