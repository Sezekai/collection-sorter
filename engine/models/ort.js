'use strict';
const ort = require('onnxruntime-node');

// Create an ONNX session. On Windows the GPU goes through DirectML (works on any DirectX 12 GPU, no CUDA install).
async function createSession(file, { device = 'auto', deviceId = 0 } = {}) {
  const win = process.platform === 'win32';
  let order;
  if (device === 'cpu') order = ['cpu'];
  else if (device === 'cuda') order = ['cuda', 'cpu'];
  else order = win ? ['dml', 'cpu'] : ['cpu'];
  let lastErr = null;
  for (const name of order) {
    try {
      const opts = { executionProviders: [name === 'dml' || name === 'cuda' ? { name, deviceId } : name], graphOptimizationLevel: 'all' };
      if (name === 'dml') { opts.enableMemPattern = false; opts.executionMode = 'sequential'; }
      const session = await ort.InferenceSession.create(file, opts);
      return { session, provider: name, deviceId };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('could not create ONNX session');
}

// Names of the graphics adapters, in Windows' own order (DirectML's "deviceId" is the position in this list).
// Laptops with two cards (e.g. AMD integrated + NVIDIA RTX) often list the weak integrated one first, and DirectML then picks it by default.
let gpuCache = null;
function listGpus() {
  if (gpuCache) return gpuCache;
  gpuCache = [];
  if (process.platform !== 'win32') return gpuCache;
  try {
    const out = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) -join '|'"], { timeout: 8000, windowsHide: true, encoding: 'utf8' });
    gpuCache = out.trim().split('|').map((x) => x.trim()).filter(Boolean);
  } catch { /* unknown: DirectML default is used */ }
  return gpuCache;
}
// best card first: NVIDIA RTX/GTX, then other dedicated cards, then integrated ones
function gpuOrder(names) {
  const score = (n) => (/nvidia|geforce|rtx|gtx|quadro/i.test(n) ? 3 : /radeon rx|radeon pro|arc a\d/i.test(n) ? 2 : /microsoft basic|remote|virtual/i.test(n) ? -1 : 1);
  return names.map((n, i) => ({ id: i, name: n, score: score(n) })).filter((g) => g.score >= 0).sort((a, b) => b.score - a.score || a.id - b.id);
}

module.exports = { ort, createSession, listGpus, gpuOrder };
