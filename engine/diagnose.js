'use strict';
// Diagnose and repair (STANDARDS.md): real checks, each finding in plain words with the evidence and a "Fix:" line.
// Repairs the app can do itself are offered as buttons (re-download a missing or broken model, recreate a folder).
const fs = require('fs');
const path = require('path');
const settingsMod = require('./settings');
const storage = require('./storage');

const MB = 1024 * 1024;
async function freeSpace(dir) { try { const s = await fs.promises.statfs(dir); return s.bavail * s.bsize; } catch { return null; } }

async function run(P, onProgress = () => {}) {
  const S = settingsMod.load(); const out = []; const add = (f) => out.push(f);
  const step = (n, note) => onProgress({ phase: 'diagnose', done: n, total: 8, note });
  // 1. models on disk
  step(0, 'Checking the AI model files');
  const dl = require('./models/download'); const dir = storage.modelDir(S); const tk = dl.taggerKey(S.tagger && S.tagger.model);
  const files = dl.filesFor(tk, true); const broken = [];
  for (const f of files) { const p = path.join(dir, f.dest); let sz = -1; try { sz = fs.statSync(p).size; } catch { /* missing */ } if (sz < (f.name.endsWith('.onnx') ? MB : 10)) broken.push({ ...f, sz }); }
  if (!broken.length) add({ level: 'ok', title: 'All AI model files are there', evidence: `${files.length} files in ${dir}` });
  else add({ level: 'danger', title: `${broken.length} AI model file${broken.length === 1 ? ' is' : 's are'} missing or too small`, evidence: broken.map((b) => `${b.dest}${b.sz < 0 ? ' (missing)' : ` (${b.sz} bytes)`}`).join(', '), fix: 'Download them again. Only the missing files are fetched.', repair: 'models' });
  // 2. the AI runtime and the graphics card
  step(1, 'Checking the AI runtime');
  let ort = null; try { ort = require('onnxruntime-node'); add({ level: 'ok', title: 'The AI runtime (ONNX Runtime) loads', evidence: `onnxruntime-node ${(() => { try { return require('onnxruntime-node/package.json').version; } catch { return ''; } })()}` }); }
  catch (e) { add({ level: 'danger', title: 'The AI runtime does not load', evidence: e.message, fix: 'The program folder is damaged or incomplete. Download the latest release again and replace the App folder.' }); }
  step(2, 'Looking at the graphics cards');
  const { listGpus } = require('./models/ort'); const gpus = listGpus();
  const nv = await require('./gpu').sample();
  if (nv) add({ level: 'ok', title: `NVIDIA card found: ${nv.name}`, evidence: `driver ${nv.driver}, ${nv.memUsed} of ${nv.memTotal} MB in use, ${nv.load}% busy` });
  else if (gpus.length) add({ level: 'info', title: 'Graphics cards found', evidence: gpus.join(' · ') + '. nvidia-smi was not found, so load and memory can’t be shown.', fix: 'Nothing needed for DirectML. To see load and memory, install the latest NVIDIA driver.' });
  else add({ level: 'warn', title: 'No graphics card was found', evidence: process.platform === 'win32' ? 'Windows reported none.' : 'Not running on Windows.', fix: 'The AI runs on the processor (slower). Update the graphics driver if you have a card.' });
  if (process.env.CS_SAFE) add({ level: 'warn', title: 'Safe mode is on', evidence: 'The app closed unexpectedly twice in a row, so it started with the graphics card off.', fix: 'Turn safe mode off in Settings → GPU once things look fine.' });
  // 3. a real run of the models (only when nothing else is running)
  step(3, 'Running the models on a test picture');
  if (P.state.job && P.state.job !== 'diagnose') add({ level: 'info', title: 'The model test was skipped', evidence: `“${P.state.job}” is running.`, fix: 'Run Diagnose again when it has finished.' });
  else if (!broken.length && ort) {
    try { P.dropModels(); const t0 = Date.now(); const m = await P.getModels(); const sec = ((Date.now() - t0) / 1000).toFixed(1);
      if (m.provider === 'cpu') add({ level: 'warn', title: 'The models run on the processor, not the graphics card', evidence: (m.note || 'DirectML did not start on any card.') + ` Ready in ${sec} s.`, fix: S.tagger && S.tagger.device === 'cpu' ? 'Settings → GPU is set to CPU. Set it to Auto.' : 'Update the graphics driver, restart Windows, then run Diagnose again.' });
      else add({ level: 'ok', title: 'The models run on the graphics card', evidence: `${m.label || m.key} through DirectML${m.gpu ? ' on ' + m.gpu : ''}, ready in ${sec} s.${m.note ? ' ' + m.note : ''}` });
    } catch (e) { add({ level: 'danger', title: 'The models did not start', evidence: e.message, fix: 'Download the models again (Repair). If that does not help, set Settings → GPU to CPU.', repair: 'models' }); }
  }
  // 4. ffmpeg for videos
  step(4, 'Checking the video tool');
  const ff = require('./video').findFfmpeg();
  try { await require('./video').run(['-version'], { timeoutMs: 8000, binary: false }); add({ level: 'ok', title: 'The video tool (FFmpeg) works', evidence: ff }); }
  catch (e) { add({ level: 'warn', title: 'The video tool (FFmpeg) does not run', evidence: `${ff}: ${e.message}`, fix: 'Videos get no previews or tags. Download the latest release again and replace the App folder.' }); }
  // 5. folders
  step(5, 'Checking your folders');
  const dest = S.destinationRoot;
  if (!dest) add({ level: 'warn', title: 'No destination folder is set', evidence: 'Setup → Destination is empty.', fix: 'Choose the destination folder on the Setup screen.' });
  else if (!fs.existsSync(dest)) add({ level: 'danger', title: 'The destination folder can’t be found', evidence: dest, fix: /^[a-z]:/i.test(dest) ? `Connect drive ${dest.slice(0, 2).toUpperCase()}, or choose the folder again on the Setup screen.` : 'Choose the folder again on the Setup screen.' });
  else add({ level: 'ok', title: 'The destination folder is there', evidence: dest });
  const goneSrc = (S.sources || []).filter((x) => !fs.existsSync(x.path));
  if (goneSrc.length) add({ level: 'warn', title: `${goneSrc.length} source folder${goneSrc.length === 1 ? ' is' : 's are'} missing`, evidence: goneSrc.map((x) => x.path).join(', '), fix: 'Connect the drive, or remove the folder on the Setup screen.' });
  // 6. storage places and free space
  step(6, 'Checking free space');
  for (const p of storage.places()) {
    if (!fs.existsSync(p.path)) { if (p.key !== 'logs') add({ level: 'warn', title: `${p.what}: the folder is missing`, evidence: p.path, fix: 'Recreate it (Repair), or choose a new place in Settings → Storage.', repair: 'mkdir:' + p.key }); continue; }
    const free = await freeSpace(p.path); if (free != null && free < 2 * 1024 * MB) add({ level: 'warn', title: `Little free space where the ${p.what.toLowerCase()} live`, evidence: `${(free / 1024 / MB).toFixed(1)} GB free on ${p.path.slice(0, 3)}`, fix: 'Free some space, or move it in Settings → Storage.' });
  }
  if (storage.needsModelMove(S)) add({ level: 'info', title: 'The AI models are still on the C: drive', evidence: path.join(settingsMod.DATA_DIR, 'models'), fix: 'Move them next to the program (Repair).', repair: 'movemodels' });
  step(8, 'Done');
  const ok = out.filter((x) => x.level === 'ok').length; const bad = out.filter((x) => x.level === 'danger' || x.level === 'warn').length;
  const text = [`Collection Sorter diagnosis, ${new Date().toLocaleString()}`, `${ok} fine, ${bad} to look at`, '', ...out.map((f) => `[${f.level.toUpperCase()}] ${f.title}\n    ${f.evidence || ''}${f.fix ? `\n    Fix: ${f.fix}` : ''}`)].join('\n');
  let file = null; try { fs.mkdirSync(storage.logsDir(), { recursive: true }); file = path.join(storage.logsDir(), `diagnose-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`); fs.writeFileSync(file, text); } catch { /* report still shown */ }
  return { findings: out, text, file, ts: Date.now() };
}
module.exports = { run };
