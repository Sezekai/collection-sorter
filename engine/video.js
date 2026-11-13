'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let ffmpegPath = null;
function findFfmpeg() {
  if (ffmpegPath) return ffmpegPath;
  const cands = [];
  if (process.env.FFMPEG_PATH) cands.push(process.env.FFMPEG_PATH);
  try { cands.push(require('@ffmpeg-installer/ffmpeg').path); } catch { /* optional */ }
  const here = path.resolve(__dirname, '..');
  cands.push(path.join(here, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  for (const c of cands) { try { if (c && fs.existsSync(c)) { ffmpegPath = c; return c; } } catch { /* next */ } }
  ffmpegPath = 'ffmpeg'; // rely on PATH
  return ffmpegPath;
}

function run(args, { timeoutMs = 60000, binary = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(findFfmpeg(), args, { windowsHide: true });
    const out = [], err = [];
    const to = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg timeout')); }, timeoutMs);
    p.stdout.on('data', (b) => out.push(b));
    p.stderr.on('data', (b) => err.push(b));
    p.on('error', (e) => { clearTimeout(to); reject(e); });
    p.on('close', (code) => { clearTimeout(to); resolve({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString('utf8') }); });
  });
}

// Duration, size and fps parsed from ffmpeg's banner (no ffprobe needed).
async function probe(file) {
  const r = await run(['-hide_banner', '-i', file], { timeoutMs: 30000 });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.err);
  const duration = m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
  const s = /Stream #\d+:\d+.*Video:.*?,\s*(\d{2,5})x(\d{2,5})/.exec(r.err);
  return { duration, w: s ? +s[1] : 0, h: s ? +s[2] : 0 };
}

// One JPEG frame at time t (seconds), scaled so the longest side is `max`.
async function frameAt(file, t, max = 512) {
  const vf = `scale='if(gt(iw,ih),${max},-2)':'if(gt(iw,ih),-2,${max})'`;
  const r = await run(['-v', 'error', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1'], { timeoutMs: 60000 });
  if (!r.out.length) throw new Error('no frame');
  return r.out;
}

// n frames spread over the video (skipping the very start and end).
async function frames(file, n = 4, max = 512) {
  const info = await probe(file);
  const d = info.duration || 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = d > 0 ? d * (0.12 + (0.76 * (n === 1 ? 0.5 : i / (n - 1)))) : 0;
    try { out.push(await frameAt(file, t, max)); } catch (e) { if (i === 0) { try { out.push(await frameAt(file, 0, max)); } catch { /* give up */ } } }
  }
  return { info, frames: out };
}

module.exports = { findFfmpeg, probe, frameAt, frames, run };
