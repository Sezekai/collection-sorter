'use strict';
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('../util');

const HF = () => (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '');

// The tagger that reads every picture (Haruka by default; PixAI, Camie and the WD v3 family as options). See tagger.js for what each one needs.
const { SPECS, taggerKey } = require('./tagger');
const TAGGERS = Object.fromEntries(Object.entries(SPECS).map(([k, s]) => [k, { repo: s.repo, dir: s.dir, label: s.label, short: s.short }]));

// JoyTag (fpgaminer/joytag): tags real photos far better than the anime taggers, and helps decide photo vs art
const JOYTAG_FILES = [
  { key: 'joy', name: 'model.onnx', repo: 'fancyfeast/joytag', file: 'model.onnx', dest: 'joytag/model.onnx', label: 'JoyTag (photos and art, about 0.37 GB)' },
  { key: 'joytags', name: 'top_tags.txt', repo: 'fancyfeast/joytag', file: 'top_tags.txt', dest: 'joytag/top_tags.txt', label: 'JoyTag tag list' },
];
// the two files of one tagger (its model and its tag list)
const taggerFiles = (tk) => { const s = SPECS[taggerKey(tk)]; return s.files.map((f) => ({ key: f.key === 'model' ? 'wd14' : 'wd14tags', name: f.file, repo: s.repo, file: f.file, dest: `${s.dir}/${f.file}`, size: f.size || 0, label: f.key === 'model' ? s.short + ' tagger' : s.short + ' tag list' })); };
const filesFor = (tk, joy) => [...taggerFiles(tk), ...CLIP_FILES, ...(joy ? JOYTAG_FILES : [])];
const CLIP_FILES = [
  { key: 'clipv', name: 'vision_model.onnx', repo: 'Xenova/clip-vit-base-patch32', file: 'onnx/vision_model.onnx', dest: 'clip/vision_model.onnx', label: 'CLIP image model' },
  { key: 'clipt', name: 'text_model.onnx', repo: 'Xenova/clip-vit-base-patch32', file: 'onnx/text_model.onnx', dest: 'clip/text_model.onnx', label: 'CLIP text model' },
];

function modelPaths(dir, tk, joy = true) {
  return Object.fromEntries(filesFor(tk, joy).map((f) => [f.key, path.join(dir, f.dest)]));
}
function missing(dir, tk, joy) { return filesFor(tk, joy).filter((f) => !fs.existsSync(path.join(dir, f.dest))); }

async function downloadOne(f, dir, onProgress, signal) {
  const dest = path.join(dir, f.dest);
  ensureDir(path.dirname(dest));
  const part = dest + '.part';
  const url = `${HF()}/${f.repo}/resolve/main/${f.file}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let ws = null;
    const closeWs = () => new Promise((r) => { if (!ws || ws.closed) return r(); ws.once('close', r); ws.destroy(); });
    try {
      let have = 0;
      try { have = fs.statSync(part).size; } catch { /* fresh */ }
      const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow', signal });
      if (res.status === 416) { fs.renameSync(part, dest); return; }
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${url}`);
      const total = (res.status === 206 ? have : 0) + Number(res.headers.get('content-length') || 0);
      ws = fs.createWriteStream(part, { flags: res.status === 206 ? 'a' : 'w' });
      let got = res.status === 206 ? have : 0;
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!ws.write(value)) await new Promise((r) => ws.once('drain', r));
        got += value.length;
        if (onProgress) onProgress({ file: f.label, got, total });
      }
      await new Promise((r, j) => { ws.once('close', r); ws.once('error', j); ws.end(); });   // closed, not just flushed, before it is renamed
      if (total && got < total) throw new Error('download ended early');
      fs.renameSync(part, dest);
      return;
    } catch (e) {
      await closeWs();
      if (signal && signal.aborted) throw e;
      if (attempt === 4) throw new Error(`Could not download ${f.label}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function ensureModels(dir, tk, onProgress, signal, joy) {
  ensureDir(dir);
  for (const f of missing(dir, tk, joy)) await downloadOne(f, dir, onProgress, signal);
  return modelPaths(dir, tk, joy);
}

const taggerReady = (dir, tk) => taggerFiles(tk).every((f) => fs.existsSync(path.join(dir, f.dest)));
module.exports = { TAGGERS, taggerKey, taggerFiles, taggerReady, filesFor, modelPaths, missing, ensureModels, downloadOne };
