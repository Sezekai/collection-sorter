'use strict';
const fs = require('fs');
const path = require('path');
const { WD14 } = require('./wd14');
const { Clip } = require('./clip');
const { modelPaths, missing, ensureModels, taggerKey, TAGGERS } = require('./download');
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
  const order = [want, ...Object.keys(TAGGERS).filter((k) => k !== want && k === 'swinv2')];
  const notes = []; let lastErr = null;
  for (const key of order) {
    const p = modelPaths(dir, key);
    if (!fs.existsSync(p.wd14) || !fs.existsSync(p.wd14tags)) { if (key === want) throw new Error('The model files for ' + TAGGERS[key].label + ' are missing. Press "Download models".'); continue; }
    const attempts = [{ ...base }];
    if (base.device !== 'cpu') { // a big model with 8 pictures at once can crash a graphics card ("device removed"), so start small and step down
      const small = Math.min(base.batch, 4); attempts.length = 0;
      const cfgId = settings.tagger && Number.isInteger(settings.tagger.deviceId) ? settings.tagger.deviceId : -1;
      const gpus = gpuOrder(listGpus());
      const ids = cfgId >= 0 ? [{ id: cfgId, name: gpus.length ? (listGpus()[cfgId] || 'card ' + cfgId) : 'card ' + cfgId }] : gpus.length ? gpus.slice(0, 3) : [{ id: 0, name: 'default card' }];
      if (ids.length > 1 || gpus.length) log('graphics cards: ' + listGpus().map((n, i) => i + '=' + n).join(' | ') + ' -> trying ' + ids.map((g) => g.id + ' ' + g.name).join(', '));
      ids.forEach((g, i) => { attempts.push({ ...base, deviceId: g.id, gpuName: g.name, batch: small }); if (small > 2) attempts.push({ ...base, deviceId: g.id, gpuName: g.name, batch: 2 }); if (small > 1 || i > 0) attempts.push({ ...base, deviceId: g.id, gpuName: g.name, batch: 1 }); });
      attempts.push({ ...base, device: 'cpu', batch: 4 });
    }
    for (const opts of attempts) {
      try {
        const wd = await new WD14(opts).init(p.wd14, p.wd14tags);
        const clip = await new Clip({ ...opts, device: 'cpu' }).init(p.clipv, p.clipt); // small model: the processor is fast enough and it keeps the card free for the tagger
        const t1 = await wd.selfTest(); const t2 = await clip.selfTest();
        let photoEmb = null; try { photoEmb = await clip.embedTexts(PHOTO_ART); } catch (e) { log('models: photo prompts failed: ' + e.message); }
        let jt = null, t3 = null;
        if ((settings.classify || {}).useJoytag !== false && fs.existsSync(p.joy) && fs.existsSync(p.joytags)) {
          try { jt = await new JoyTag({ ...opts }).init(p.joy, p.joytags); t3 = await jt.selfTest(); }
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
        lastErr = e; log(`models: ${key} ${opts.device}/batch ${opts.batch} failed: ${e.stack || e.message}`);
        notes.push(`${TAGGERS[key].label} on ${opts.device === 'cpu' ? 'the processor' : opts.gpuName ? 'the ' + opts.gpuName : 'the graphics card'} with ${opts.batch} at a time failed: ${short(e)}.`);
      }
    }
  }
  const err = new Error('The AI models would not start. ' + notes.slice(-3).join(' ') + ' Details are in engine.log.'); err.cause = lastErr; throw err;
}

module.exports = { loadModels, modelDir, missing, ensureModels, modelPaths, taggerKey, TAGGERS };
