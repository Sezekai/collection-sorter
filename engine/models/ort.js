'use strict';
// ONNX sessions live in worker threads (see ortworker.js): the engine itself never blocks on a model.
// The rest of the code uses them like onnxruntime sessions: session.run(feeds) -> { name: { data, dims } }.
const path = require('path');
const { Worker } = require('worker_threads');

class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
const ort = { Tensor };

class RemoteSession {
  constructor(w, info) { this.w = w; this.inputNames = info.inputNames; this.outputNames = info.outputNames; this.inputMetadata = info.inputMetadata; this.n = 0; this.wait = new Map(); this.dead = null;
    w.on('message', (m) => { const p = this.wait.get(m.id); if (!p) return; this.wait.delete(m.id); if (m.op === 'result') p.resolve(m.out); else p.reject(new Error(m.error)); });
    const die = (e) => { this.dead = e || new Error('the model thread stopped'); for (const p of this.wait.values()) p.reject(this.dead); this.wait.clear(); };
    w.on('error', die); w.on('exit', () => die());
  }
  run(feeds) {
    if (this.dead) return Promise.reject(this.dead);
    const id = ++this.n; const f = {}; const transfer = [];
    for (const [k, t] of Object.entries(feeds)) { f[k] = { type: t.type, data: t.data, dims: t.dims }; }
    return new Promise((resolve, reject) => { this.wait.set(id, { resolve, reject }); this.w.postMessage({ op: 'run', id, feeds: f }, transfer); });
  }
  async release() { try { this.w.postMessage({ op: 'release' }); } catch { /* gone */ } setTimeout(() => this.w.terminate().catch(() => {}), 2000).unref(); }
}

// Create a session. On Windows the GPU goes through DirectML (works on any DirectX 12 GPU, no CUDA install), with the processor as fallback.
function createSession(file, opts = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'ortworker.js'), { workerData: { file, opts: { device: opts.device || 'auto', deviceId: opts.deviceId || 0 } } });
    const first = (m) => {
      if (m.op === 'ready') { w.off('message', first); resolve({ session: new RemoteSession(w, m), provider: m.provider, deviceId: opts.deviceId || 0 }); }
      else if (m.op === 'failed') { w.off('message', first); w.terminate().catch(() => {}); reject(new Error(m.error)); }
    };
    w.on('message', first); w.once('error', reject);
  });
}

// Names of the graphics adapters, in Windows' own order (DirectML's "deviceId" is the position in this list).
// Laptops with two cards (e.g. AMD integrated + NVIDIA RTX) often list the weak integrated one first, and DirectML then picks it by default.
let gpuCache = null;
async function listGpus() {
  if (gpuCache) return gpuCache;
  if (process.platform !== 'win32') return (gpuCache = []);
  gpuCache = await new Promise((resolve) => require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) -join '|'"], { timeout: 8000, windowsHide: true, encoding: 'utf8' },
    (err, out) => resolve(err ? [] : String(out).trim().split('|').map((x) => x.trim()).filter(Boolean))));
  return gpuCache;
}
const listGpusCached = () => gpuCache || [];
// best card first: NVIDIA RTX/GTX, then other dedicated cards, then integrated ones
function gpuOrder(names) {
  const score = (n) => (/nvidia|geforce|rtx|gtx|quadro/i.test(n) ? 3 : /radeon rx|radeon pro|arc a\d/i.test(n) ? 2 : /microsoft basic|remote|virtual/i.test(n) ? -1 : 1);
  return names.map((n, i) => ({ id: i, name: n, score: score(n) })).filter((g) => g.score >= 0).sort((a, b) => b.score - a.score || a.id - b.id);
}

module.exports = { ort, createSession, listGpus, listGpusCached, gpuOrder };
