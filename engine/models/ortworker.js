'use strict';
// One ONNX session per worker thread. Loading a model and running it are synchronous calls in onnxruntime-node, so doing
// them here keeps the engine free to answer the window while a model loads (seconds) or a batch of pictures is tagged.
const { workerData, parentPort } = require('worker_threads');
const ort = require('onnxruntime-node');

async function create(file, { device = 'auto', deviceId = 0 } = {}) {
  const win = process.platform === 'win32';
  const order = device === 'cpu' ? ['cpu'] : device === 'cuda' ? ['cuda', 'cpu'] : win ? ['dml', 'cpu'] : ['cpu'];
  let lastErr = null;
  for (const name of order) {
    try {
      const opts = { executionProviders: [name === 'dml' || name === 'cuda' ? { name, deviceId } : name], graphOptimizationLevel: 'all' };
      if (name === 'dml') { opts.enableMemPattern = false; opts.executionMode = 'sequential'; }
      try { return { session: await ort.InferenceSession.create(file, opts), provider: name }; }
      catch (e) {
        // "system error number 13" = the file is open elsewhere for writing (an unfinished download, antivirus): read it ourselves
        if (!/system error number 13|Permission denied/i.test(String(e && e.message))) throw e;
        const bytes = new Uint8Array(require('fs').readFileSync(file));
        return { session: await ort.InferenceSession.create(bytes, opts), provider: name };
      }
    } catch (e) { lastErr = e; if (/system error number|No such file|Protobuf parsing failed|Load model from .* failed/i.test(String(e && e.message)) && !/provider|DML|dml|CUDA/i.test(String(e.message))) break; }
  }
  throw lastErr || new Error('could not create ONNX session');
}
const meta = (s) => { try { const m = s.inputMetadata; const arr = Array.isArray(m) ? m : Object.entries(m || {}).map(([name, v]) => ({ name, ...v })); return arr.map((x) => ({ name: x.name, shape: x.shape ? [...x.shape].map((d) => (typeof d === 'bigint' ? Number(d) : d)) : null })); } catch { return []; } };

(async () => {
  let session;
  try {
    const r = await create(workerData.file, workerData.opts || {}); session = r.session;
    parentPort.postMessage({ op: 'ready', provider: r.provider, inputNames: [...session.inputNames], outputNames: [...session.outputNames], inputMetadata: meta(session) });
  } catch (e) { parentPort.postMessage({ op: 'failed', error: String((e && e.message) || e) }); return; }
  parentPort.on('message', async (m) => {
    if (m.op === 'release') { try { await session.release(); } catch { /* gone */ } parentPort.postMessage({ op: 'released' }); return; }
    if (m.op !== 'run') return;
    try {
      const feeds = {}; for (const [k, t] of Object.entries(m.feeds)) feeds[k] = new ort.Tensor(t.type, t.data, t.dims);
      const out = await session.run(feeds); const res = {}; const transfer = [];
      for (const [k, t] of Object.entries(out)) { const data = t.data; res[k] = { type: t.type, data, dims: [...t.dims] }; if (data && data.buffer && !transfer.includes(data.buffer)) transfer.push(data.buffer); }
      parentPort.postMessage({ op: 'result', id: m.id, out: res }, transfer);
    } catch (e) { parentPort.postMessage({ op: 'error', id: m.id, error: String((e && e.message) || e) }); }
  });
})();
