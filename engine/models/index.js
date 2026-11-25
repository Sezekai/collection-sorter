'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Tagger, SPECS } = require('./tagger');
const { Clip } = require('./clip');
const { modelPaths, missing, ensureModels, taggerKey, TAGGERS, taggerReady, taggerFiles } = require('./download');
const { log } = require('../util');
const { JoyTag } = require('./joytag');
const { PHOTO_ART } = require('../prompts');
const { listGpus, gpuOrder } = require('./ort');

function modelDir(settings) { return require('../storage').modelDir(settings); }
const short = (e) => String((e && e.message) || e).replace(/\s+/g, ' ').replace(/^.*?onnxruntime\.dll!\S+:? ?(\(caller[^)]*\) ?)?/, '').slice(0, 300);

// Load a tagger + CLIP and prove they really run (one blank picture). If the chosen setup fails, step down until something works:
// same model one picture at a time -> same model on the processor -> the fast SwinV2 model if it is on disk. Returns what happened in `note`.
async function loadModels(settings, dir, force) {
  const want = taggerKey(settings.tagger && settings.tagger.model);
  const base = { device: (settings.tagger && settings.tagger.device) || 'auto', batch: (settings.tagger && settings.tagger.batch) || 8 };
  const order = [want, ...Object.keys(TAGGERS).filter((k) => k !== want && taggerReady(dir, k))];   // another tagger that is on disk, if the chosen one won't start
  const notes = []; let lastErr = null;
  for (const key of order) {
    const p = modelPaths(dir, key);
    if (!fs.existsSync(p.wd14) || !fs.existsSync(p.wd14tags)) { if (key === want) throw new Error('The model files for ' + TAGGERS[key].label + ' are missing. Press "Download models".'); continue; }
    const attempts = [{ ...base }];
    if (base.device !== 'cpu') { // a big model with 8 pictures at once can crash a graphics card ("device removed"), so start small and step down
      const small = Math.min(base.batch, 4, SPECS[key].batch || 8); attempts.length = 0;
      const cfgId = settings.tagger && Number.isInteger(settings.tagger.deviceId) ? settings.tagger.deviceId : -1;
      const names = await listGpus(); const gpus = gpuOrder(names);
      const ids = cfgId >= 0 ? [{ id: cfgId, name: gpus.length ? (names[cfgId] || 'card ' + cfgId) : 'card ' + cfgId }] : gpus.length ? gpus.slice(0, 3) : [{ id: 0, name: 'default card' }];
      if (ids.length > 1 || gpus.length) log('graphics cards: ' + names.map((n, i) => i + '=' + n).join(' | ') + ' -> trying ' + ids.map((g) => g.id + ' ' + g.name).join(', '));
      ids.forEach((g, i) => { attempts.push({ ...base, deviceId: g.id, gpuName: g.name, batch: small }); if (small > 2) attempts.push({ ...base, deviceId: g.id, gpuName: g.name, batch: 2 }); if (small > 1 || i > 0) attempts.push({ ...base, deviceId: g.id, gpuName: g.name, batch: 1 }); });
      attempts.push({ ...base, device: 'cpu', batch: Math.min(4, SPECS[key].batch || 8) });
    }
    for (const opts of attempts) {
      if (opts.device === 'cpu' && !roomOnCpu(key)) { notes.push(cpuNoRoom(key)); continue; }
      const made = [];
      try {
        const wd = await new Tagger(SPECS[key], opts).init(p.wd14, p.wd14tags);
        made.push(wd); const clip = await new Clip({ ...opts, device: 'cpu' }).init(p.clipv, p.clipt); made.push(clip); // small model: the processor is fast enough and it keeps the card free for the tagger
        const t1 = await wd.selfTest(); const t2 = await clip.selfTest();
        let photoEmb = null; try { photoEmb = await clip.embedTexts(PHOTO_ART); } catch (e) { log('models: photo prompts failed: ' + e.message); }
        let jt = null, t3 = null;
        if ((settings.classify || {}).useJoytag !== false && fs.existsSync(p.joy) && fs.existsSync(p.joytags)) {
          try { jt = await new JoyTag({ ...opts }).init(p.joy, p.joytags); made.push(jt); t3 = await jt.selfTest(); }
          catch (e) { jt = null; notes.push(`JoyTag could not start (${short(e)}); photos and art are told apart by CLIP only.`); log('models: JoyTag failed: ' + (e.stack || e.message)); }
        }
        if (wd.recovered) notes.push(`The graphics card crashed while tagging (${short({ message: wd.batchNote })}); the tagger was restarted ${wd.recovered === 'cpu' ? 'on the processor' : 'one picture at a time'}.`);
        else if (wd.batchNote) notes.push(`${TAGGERS[key].label} could not run ${opts.batch} pictures at once on the graphics card (${short({ message: wd.batchNote })}); it now does one at a time.`);
        if (key !== want) notes.push(`Using ${TAGGERS[key].label} instead of ${TAGGERS[want].label} because the chosen model would not run on this PC.`);
        if (opts.device === 'cpu' && base.device !== 'cpu') notes.push('The graphics card could not run the AI models, so the processor is used (slower).');
        const note = notes.join(' ');
        if (note) log('models: ' + note);
        log(`models ready: ${key} on ${wd.provider}, tagger ${t1.ms} ms, clip ${t2.ms} ms for a test picture`);
        return { wd, clip, jt, photoEmb, provider: wd.provider, key, gpu: opts.gpuName || '', note, ms: { tagger: t1.ms, clip: t2.ms, joytag: t3 && t3.ms } };
      } catch (e) {
        for (const x of made) try { x.release(); } catch { /* gone */ }
        lastErr = e; log(`models: ${key} ${opts.device}/batch ${opts.batch} failed: ${e.stack || e.message}`);
        // a problem with the file itself fails the same way on every card: say it once and move on
        if (/Load model from .* failed|Protobuf parsing failed|No such file/i.test(String(e.message))) { notes.push(`${TAGGERS[key].short}'s model file could not be opened (${short(e)}). If it keeps happening, delete the "${TAGGERS[key].dir || key}" folder in the Models folder and download it again.`); break; }
        notes.push(`${TAGGERS[key].label} on ${opts.device === 'cpu' ? 'the processor' : opts.gpuName ? 'the ' + opts.gpuName : 'the graphics card'} with ${opts.batch} at a time failed: ${short(e)}.`);
      }
    }
  }
  const err = new Error('The AI models would not start. ' + notes.slice(-3).join(' ') + ' Details are in engine.log.'); err.cause = lastErr; throw err;
}

// PixAI reads at 1008 px: on the processor one picture needs ~7 GB of memory, and running out takes the whole engine down
const roomOnCpu = (key) => !SPECS[key].cpuRamGB || os.totalmem() / 1e9 >= SPECS[key].cpuRamGB + 4;
const cpuNoRoom = (key) => `${TAGGERS[key].short} is too big for the processor on this PC (it needs about ${SPECS[key].cpuRamGB} GB of free memory), so it only runs on the graphics card.`;
// One more tagger next to the loaded models (to tag pictures again with another tagger). Same card and settings as the main one.
async function loadTagger(settings, dir, key, like) {
  const files = taggerFiles(key); const fm = files.find((f) => f.key === 'wd14'), ft = files.find((f) => f.key === 'wd14tags');
  if (!taggerReady(dir, key)) { const e = new Error(`${TAGGERS[key].short} is not downloaded yet.`); e.code = 'models_missing'; throw e; }
  const dev = (settings.tagger && settings.tagger.device) || 'auto';
  const deviceId = like ? like.deviceId || 0 : 0; const b = SPECS[key].batch || 8;
  // the card first (as many at once as the model allows, then one at a time), the processor last and only if there is room
  const tries = dev === 'cpu' || (like && like.provider === 'cpu') ? [{ device: 'cpu', batch: Math.min(4, b) }] : [{ device: dev, deviceId, batch: b }, ...(b > 1 ? [{ device: dev, deviceId, batch: 1 }] : []), { device: 'cpu', batch: Math.min(4, b) }];
  const notes = []; let lastErr = null;
  for (const opts of tries) {
    if (opts.device === 'cpu' && !roomOnCpu(key)) { notes.push(cpuNoRoom(key)); continue; }
    let t = null;
    try {
      t = await new Tagger(SPECS[key], opts).init(path.join(dir, fm.dest), path.join(dir, ft.dest));
      await t.selfTest();
      log(`extra tagger ready: ${key} on ${t.provider}, ${opts.batch} at a time`);
      return t;
    } catch (e) {
      if (t) try { t.release(); } catch { /* gone */ }
      lastErr = e; log(`extra tagger ${key} ${opts.device}/batch ${opts.batch} failed: ${e.stack || e.message}`);
      notes.push(`${opts.device === 'cpu' ? 'On the processor' : 'On the graphics card'} with ${opts.batch} at a time: ${short(e)}.`);
    }
  }
  const err = new Error(`${TAGGERS[key].short} would not start. ${notes.join(' ')}`); err.cause = lastErr; throw err;
}
function releaseModels(m) { if (!m) return; for (const x of [m.wd, m.clip, m.jt]) try { if (x && x.release) x.release(); } catch { /* gone */ } }
module.exports = { SPECS, loadTagger, releaseModels, loadModels, modelDir, missing, ensureModels, modelPaths, taggerKey, TAGGERS };
