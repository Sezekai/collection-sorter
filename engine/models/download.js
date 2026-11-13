'use strict';
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('../util');

const HF = () => (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '');

// The tagger that reads every picture. All three are SmilingWolf WD v3 taggers (the same family TagGUI offers); they differ in accuracy and speed.
const TAGGERS = {
  'eva02-large': { repo: 'SmilingWolf/wd-eva02-large-tagger-v3', dir: 'wd14-eva02-large', label: 'WD EVA02-Large v3 (most accurate, about 1.3 GB)' },
  'vit-large': { repo: 'SmilingWolf/wd-vit-large-tagger-v3', dir: 'wd14-vit-large', label: 'WD ViT-Large v3 (accurate, about 1.3 GB)' },
  'swinv2': { repo: 'SmilingWolf/wd-swinv2-tagger-v3', dir: 'wd14', label: 'WD SwinV2 v3 (fast, about 0.45 GB)' },
};
const taggerKey = (k) => (TAGGERS[k] ? k : 'eva02-large');

// JoyTag (fpgaminer/joytag): tags real photos far better than the anime-only WD taggers, and helps decide photo vs art
const JOYTAG_FILES = [
  { key: 'joy', name: 'model.onnx', repo: 'fancyfeast/joytag', file: 'model.onnx', dest: 'joytag/model.onnx', label: 'JoyTag (photos and art, about 0.37 GB)' },
  { key: 'joytags', name: 'top_tags.txt', repo: 'fancyfeast/joytag', file: 'top_tags.txt', dest: 'joytag/top_tags.txt', label: 'JoyTag tag list' },
];
const filesFor = (tk, joy) => {
  const t = TAGGERS[taggerKey(tk)];
  return [
    { key: 'wd14', name: 'model.onnx', repo: t.repo, file: 'model.onnx', dest: `${t.dir}/model.onnx`, label: 'Anime tagger — ' + t.label },
    { key: 'wd14tags', name: 'selected_tags.csv', repo: t.repo, file: 'selected_tags.csv', dest: `${t.dir}/selected_tags.csv`, label: 'Tagger tag list' },
    ...CLIP_FILES,
    ...(joy ? JOYTAG_FILES : []),
  ];
};
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
    try {
      let have = 0;
      try { have = fs.statSync(part).size; } catch { /* fresh */ }
      const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow', signal });
      if (res.status === 416) { fs.renameSync(part, dest); return; }
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${url}`);
      const total = (res.status === 206 ? have : 0) + Number(res.headers.get('content-length') || 0);
      const ws = fs.createWriteStream(part, { flags: res.status === 206 ? 'a' : 'w' });
      let got = res.status === 206 ? have : 0;
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!ws.write(value)) await new Promise((r) => ws.once('drain', r));
        got += value.length;
        if (onProgress) onProgress({ file: f.label, got, total });
      }
      await new Promise((r) => ws.end(r));
      if (total && got < total) throw new Error('download ended early');
      fs.renameSync(part, dest);
      return;
    } catch (e) {
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

module.exports = { TAGGERS, taggerKey, filesFor, modelPaths, missing, ensureModels, downloadOne };
