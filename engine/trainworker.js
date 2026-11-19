'use strict';
// Trains the small NSFW / Very and art-or-real models in a separate thread, so the app stays responsive while it learns.
// It writes the results to the database (kv 'learned' and 'classifier'); the main thread then just reads them.
const { workerData, parentPort } = require('worker_threads');
try {
  require('./db').open();
  const { settings, rules } = workerData;
  if (!require('./learn').isFresh(rules)) require('./learn').prepare(settings, rules);
  if (!require('./classify').isFresh()) require('./classify').prepare(settings, rules, null);
  require('./db').close();
  parentPort.postMessage({ ok: true });
} catch (e) { parentPort.postMessage({ ok: false, error: (e && e.stack) || String(e) }); }
